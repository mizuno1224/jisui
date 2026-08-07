"use client";

// 買い物リストの状態を持つ唯一の場所。
//
// 方針(設計書 3-1):
//   1. 画面が読むのは常に手元(IndexedDB)。サーバの応答は待たない。
//   2. タップは即座にローカルへ書き、送信は outbox に積んで後から流す。
//   3. 競合は「チェック済みが勝つ」。二重購入を防ぐことを最優先する。
import * as local from "./local-db";
import { LOCAL_HOUSEHOLD_ID, localSeedItems } from "./seed-data";
import { sectionRank } from "./sections";
import { getSupabase, isSupabaseConfigured } from "./supabase/client";
import {
  isTempId,
  type ItemId,
  type Op,
  type QueuedOp,
  type ShoppingItem,
} from "./types";

const TABLE = "shopping_list";
const META_HOUSEHOLD = "household_id";
const META_MEMBERS = "members";

/**
 * 通信を打ち切るまでの時間。
 * スーパーの中は「電波は立っているのに通らない」ことがあり、
 * navigator.onLine は true のままなので、応答が返らない場合に備えて必ず切る。
 */
const REQUEST_TIMEOUT_MS = 20_000;
const abortAfterTimeout = () => AbortSignal.timeout(REQUEST_TIMEOUT_MS);

export type Snapshot = {
  items: ShoppingItem[];
  status: "loading" | "ready";
  /** cloud: Supabase と同期する / local: この端末だけで完結する(未設定時) */
  mode: "cloud" | "local";
  signedIn: boolean;
  online: boolean;
  syncing: boolean;
  /** 未送信の操作数。画面上部に出す(設計書 3-1)。 */
  pending: number;
  userId: string | null;
  householdId: string | null;
  members: Record<string, string>;
  error: string | null;
  lastSyncedAt: string | null;
};

const INITIAL: Snapshot = {
  items: [],
  status: "loading",
  mode: isSupabaseConfigured ? "cloud" : "local",
  signedIn: false,
  online: true,
  syncing: false,
  pending: 0,
  userId: null,
  householdId: null,
  members: {},
  error: null,
  lastSyncedAt: null,
};

let snapshot: Snapshot = INITIAL;
const listeners = new Set<() => void>();

function emit(patch: Partial<Snapshot>) {
  snapshot = { ...snapshot, ...patch };
  for (const l of listeners) l();
}

export function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export const getSnapshot = () => snapshot;
export const getServerSnapshot = () => INITIAL;

// -------------------------------------------------------------- ならべ替え

export function sortItems(items: ShoppingItem[]): ShoppingItem[] {
  return [...items].sort((a, b) => {
    const s = sectionRank(a.section) - sectionRank(b.section);
    if (s !== 0) return s;
    // チェック済みはセクション内で下に沈める(設計書 3-2)
    if (a.status !== b.status) return a.status === "未購入" ? -1 : 1;
    if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
    return String(a.id).localeCompare(String(b.id));
  });
}

function setItems(items: ShoppingItem[]) {
  emit({ items: sortItems(items) });
}

function upsertLocalState(row: ShoppingItem) {
  const rest = snapshot.items.filter((i) => String(i.id) !== String(row.id));
  setItems([...rest, row]);
}

async function refreshPending() {
  const ops = await local.loadOutbox<QueuedOp>("items");
  emit({ pending: ops.length });
  return ops;
}

function errorMessage(e: unknown): string {
  if (e && typeof e === "object" && "message" in e) return String((e as Error).message);
  return String(e);
}

// ------------------------------------------------------------------ 初期化

let initialized = false;
let realtimeBound = false;

export async function init() {
  if (initialized || typeof window === "undefined") return;
  initialized = true;

  emit({ online: navigator.onLine });
  window.addEventListener("online", () => {
    emit({ online: true });
    void syncNow();
  });
  window.addEventListener("offline", () => emit({ online: false }));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void syncNow();
  });

  // まず手元のデータで描く。ここまでにネットワークは一切使わない。
  const cached = await local.loadRows<ShoppingItem>("items");
  setItems(cached);
  await refreshPending();

  const supabase = getSupabase();
  if (!supabase) {
    if (cached.length === 0) {
      const seeded = localSeedItems(new Date().toISOString());
      await local.replaceRows("items", seeded);
      setItems(seeded);
    }
    emit({ status: "ready", mode: "local", householdId: LOCAL_HOUSEHOLD_ID });
    return;
  }

  // 前回の世帯 id / メンバー名は手元に残しておく(圏外でも追加できるように)
  emit({
    householdId: (await local.getMeta<string>(META_HOUSEHOLD)) ?? null,
    members: (await local.getMeta<Record<string, string>>(META_MEMBERS)) ?? {},
  });

  // 別タブでのログインや、後からトークンが復帰した場合にも追随する
  supabase.auth.onAuthStateChange((event, next) => {
    if (event === "SIGNED_OUT") {
      emit({ signedIn: false, userId: null });
    } else if (next?.user && next.user.id !== snapshot.userId) {
      emit({ signedIn: true, userId: next.user.id });
      void loadHousehold().then(() => syncNow()).then(bindRealtime);
    }
  });

  // getSession はローカルの保存済みトークンを読むだけなので、圏外でも通る。
  const { data } = await supabase.auth.getSession();
  const session = data.session;
  if (!session) {
    emit({ status: "ready", signedIn: false });
    return;
  }
  emit({ signedIn: true, userId: session.user.id, status: "ready" });

  await loadHousehold();
  await syncNow();
  bindRealtime();
}

async function loadHousehold() {
  const supabase = getSupabase();
  if (!supabase || !navigator.onLine) return;
  const { data, error } = await supabase
    .from("household_members")
    .select("household_id,user_id,display_name")
    .abortSignal(abortAfterTimeout());
  if (error || !data?.length) return;

  const householdId = data[0].household_id as string;
  const members: Record<string, string> = {};
  for (const row of data) {
    if (row.display_name) members[row.user_id as string] = row.display_name as string;
  }
  emit({ householdId, members });
  await local.setMeta(META_HOUSEHOLD, householdId);
  await local.setMeta(META_MEMBERS, members);
}

// -------------------------------------------------------------------- 同期

export async function syncNow() {
  const supabase = getSupabase();
  if (!supabase || snapshot.mode !== "cloud") return;
  if (!snapshot.signedIn || !navigator.onLine || snapshot.syncing) return;

  emit({ syncing: true });
  try {
    await flushOutbox();
    await pull();
    emit({ error: null, lastSyncedAt: new Date().toISOString() });
  } catch (e) {
    emit({ error: errorMessage(e) });
  } finally {
    emit({ syncing: false });
  }
}

/** 未送信の操作を積んだ順に流す。1件でも失敗したらそこで止め、次の機会に再送する。 */
async function flushOutbox() {
  const supabase = getSupabase();
  if (!supabase) return;

  // add で採番された id を後続の操作へ貼り替えるため、1件ずつ読み直す。
  let guard = (await local.loadOutbox<QueuedOp>("items")).length + 10;
  while (guard-- > 0) {
    const ops = await local.loadOutbox<QueuedOp>("items");
    const op = ops[0];
    if (!op) break;

    try {
      await sendOp(op);
    } catch (e) {
      // Postgres のエラーコードは文字列。中断・通信断(DOMException.code は数値)と区別する。
      const permanent = typeof (e as { code?: unknown })?.code === "string";
      if (!permanent) throw e; // 通信断。積んだまま次回に回す
      // サーバに拒否された操作を先頭に残すと以降が永久に詰まるので捨てる
      emit({ error: `送信できなかった操作を1件破棄しました: ${errorMessage(e)}` });
    }
    await local.dequeue(op.opId);
    await refreshPending();
  }
}

async function sendOp(op: Op) {
  const supabase = getSupabase()!;

  if (op.kind === "add") {
    const { item } = op;

    // 応答が返る前に切れた場合、行だけ入っていることがある。
    // added_at を手元の値で送っておき、再送のときはそれで既存行を探して二重登録を防ぐ。
    const { data: existing } = await supabase
      .from(TABLE)
      .select("*")
      .eq("household_id", item.household_id)
      .eq("item", item.item)
      .eq("added_at", item.added_at)
      .abortSignal(abortAfterTimeout())
      .maybeSingle();

    let row = existing as ShoppingItem | null;
    if (!row) {
      const { data, error } = await supabase
        .from(TABLE)
        .insert({
          household_id: item.household_id,
          item: item.item,
          qty: item.qty,
          reason: item.reason,
          section: item.section,
          sort_order: item.sort_order,
          status: item.status,
          added_at: item.added_at,
        })
        .select()
        .abortSignal(abortAfterTimeout())
        .single();
      if (error) throw error;
      row = data as ShoppingItem;
    }

    await local.removeRow("items", op.tempId);
    await local.saveRows("items", [row]);
    await local.remapOutboxId("items", op.tempId, row.id);
    const rest = snapshot.items.filter((i) => String(i.id) !== op.tempId);
    setItems([...rest, row]);
    return;
  }

  // add がまだ流れていない一時 id は、この時点では触れない
  if (isTempId(op.id)) return;

  if (op.kind === "check") {
    const { error } = await supabase
      .from(TABLE)
      .update({ status: "購入済", checked_by: op.by, checked_at: op.at })
      .eq("id", op.id)
      .abortSignal(abortAfterTimeout());
    if (error) throw error;
    return;
  }

  if (op.kind === "uncheck") {
    // 自分がタップした後に相手がチェックしていたら外さない(チェック済みが勝つ)
    const { error } = await supabase
      .from(TABLE)
      .update({ status: "未購入", checked_by: null, checked_at: null })
      .eq("id", op.id)
      .lte("checked_at", op.at)
      .abortSignal(abortAfterTimeout());
    if (error) throw error;
    return;
  }

  const { error } = await supabase
    .from(TABLE)
    .delete()
    .eq("id", op.id)
    .abortSignal(abortAfterTimeout());
  if (error) throw error;
}

/** サーバの内容で手元を引き直す。未送信の操作がある行だけは手元を優先する。 */
async function pull() {
  const supabase = getSupabase();
  if (!supabase) return;

  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .abortSignal(abortAfterTimeout());
  if (error) throw error;

  const ops = await local.loadOutbox<QueuedOp>("items");
  const pendingIds = new Set(
    ops.map((op) => ("id" in op ? String(op.id) : op.tempId)),
  );
  const byId = new Map(snapshot.items.map((i) => [String(i.id), i]));

  const merged = (data as ShoppingItem[]).map((row) => {
    const mine = byId.get(String(row.id));
    return mine && pendingIds.has(String(row.id)) ? mine : row;
  });

  // まだサーバに届いていない自分の追加行を残す
  const serverIds = new Set((data as ShoppingItem[]).map((r) => String(r.id)));
  const localOnly = snapshot.items.filter(
    (i) => !serverIds.has(String(i.id)) && pendingIds.has(String(i.id)),
  );

  const next = [...merged, ...localOnly];
  await local.replaceRows("items", next);
  setItems(next);
}

function bindRealtime() {
  const supabase = getSupabase();
  if (!supabase || realtimeBound) return;
  realtimeBound = true;

  supabase
    .channel("shopping_list_changes")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: TABLE },
      async (payload) => {
        const ops = await local.loadOutbox<QueuedOp>("items");
        const pendingIds = new Set(ops.map((op) => ("id" in op ? String(op.id) : op.tempId)));

        if (payload.eventType === "DELETE") {
          const id = (payload.old as { id?: ItemId })?.id;
          if (id == null) return;
          await local.removeRow("items", id);
          setItems(snapshot.items.filter((i) => String(i.id) !== String(id)));
          return;
        }

        const row = payload.new as ShoppingItem;
        if (!row?.id) return;
        // 自分の未送信操作があるうちは、相手の更新で上書きしない
        if (pendingIds.has(String(row.id))) return;
        await local.saveRows("items", [row]);
        upsertLocalState(row);
      },
    )
    .subscribe();
}

// ---------------------------------------------------------------- 画面操作

async function queue(op: Op) {
  if (snapshot.mode !== "cloud" || !snapshot.signedIn) return;
  await local.enqueue("items", op);
  await refreshPending();
  void syncNow();
}

/** チェックの入り切り。ローカルへ即書きして画面を更新し、送信は後追い。 */
export async function toggle(id: ItemId) {
  const item = snapshot.items.find((i) => String(i.id) === String(id));
  if (!item) return;

  const at = new Date().toISOString();
  const checking = item.status === "未購入";
  const next: ShoppingItem = checking
    ? { ...item, status: "購入済", checked_by: snapshot.userId, checked_at: at }
    : { ...item, status: "未購入", checked_by: null, checked_at: null };

  await local.saveRows("items", [next]);
  upsertLocalState(next);
  await queue(checking ? { kind: "check", id, at, by: snapshot.userId } : { kind: "uncheck", id, at });
}

export type NewItem = {
  item: string;
  qty: string | null;
  section: string;
  reason: string | null;
};

export async function addItem(input: NewItem) {
  const householdId = snapshot.householdId ?? LOCAL_HOUSEHOLD_ID;
  const sameSection = snapshot.items.filter((i) => i.section === input.section);
  const sortOrder = sameSection.reduce((max, i) => Math.max(max, i.sort_order), 0) + 10;

  const row: ShoppingItem = {
    id: `tmp_${crypto.randomUUID()}`,
    household_id: householdId,
    item: input.item,
    qty: input.qty,
    reason: input.reason,
    section: input.section,
    sort_order: sortOrder,
    status: "未購入",
    checked_by: null,
    checked_at: null,
    added_at: new Date().toISOString(),
  };

  await local.saveRows("items", [row]);
  upsertLocalState(row);
  await queue({ kind: "add", tempId: row.id as string, item: row });
}

export async function removeItem(id: ItemId) {
  await local.removeRow("items", id);
  setItems(snapshot.items.filter((i) => String(i.id) !== String(id)));
  await queue({ kind: "delete", id });
}

export async function signOut() {
  const supabase = getSupabase();
  await supabase?.auth.signOut();
  await local.replaceRows("items", []);
  emit({ items: [], signedIn: false, userId: null, members: {}, householdId: null });
}
