"use client";

// 在庫の状態。買い物リストと同じ「まず手元、送信は後追い」の方針(設計書 3-1)。
//
// 認証まわり(ログイン状態・世帯 id)は store.ts が持っているものを借りる。
// 二重に持つとログイン直後の挙動がずれるため。
import * as local from "./local-db";
import { LOCAL_HOUSEHOLD_ID } from "./seed-data";
import {
  getSnapshot as getSession,
  init as initSession,
  isPermanent,
  subscribe as subscribeSession,
} from "./store";
import { getSupabase } from "./supabase/client";
import {
  isTempId,
  type InvOp,
  type InventoryItem,
  type ItemId,
  type Location,
  type QueuedInvOp,
} from "./types";

const TABLE = "inventory";
const STORE: local.RowStore = "inventory";
const REQUEST_TIMEOUT_MS = 8_000;
const abortAfterTimeout = () => AbortSignal.timeout(REQUEST_TIMEOUT_MS);

export type InventorySnapshot = {
  items: InventoryItem[];
  status: "loading" | "ready";
  pending: number;
  syncing: boolean;
  error: string | null;
  /**
   * 送れないまま行列に残っている操作があるか。
   *
   * 「送ったが拒否された(= 捨ててよい)」と
   * 「データベース側の準備がまだで送れない(= 捨ててはいけない)」を分ける。
   * 立っている間は、成功時にエラー表示を消さない。
   */
  blocked: boolean;
};

const INITIAL: InventorySnapshot = {
  items: [],
  status: "loading",
  pending: 0,
  syncing: false,
  error: null,
  blocked: false,
};

let snapshot: InventorySnapshot = INITIAL;
const listeners = new Set<() => void>();

function emit(patch: Partial<InventorySnapshot>) {
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

/** 期限が近いものを上に、次に場所→名前(設計書 3-3)。 */
export function sortInventory(items: InventoryItem[]): InventoryItem[] {
  return [...items].sort((a, b) => {
    const ea = a.expiry ?? "9999-12-31";
    const eb = b.expiry ?? "9999-12-31";
    if (ea !== eb) return ea < eb ? -1 : 1;
    return a.name.localeCompare(b.name, "ja");
  });
}

function setItems(items: InventoryItem[]) {
  emit({ items: sortInventory(items) });
}

async function refreshPending() {
  const ops = await local.loadOutbox<QueuedInvOp>(STORE);
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

  await initSession();

  const cached = await local.loadRows<InventoryItem>(STORE);
  setItems(cached);
  await refreshPending();
  emit({ status: "ready" });

  window.addEventListener("online", () => void syncNow());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void syncNow();
  });
  /*
   * 世帯が確定した(＝ログインが通った)ときだけ取りに行く。
   *
   * 以前は store の emit すべてで発火していたため、買い物リストで
   * 1件チェックするたびに在庫を全件取り直していた。店内で30件つければ30回。
   */
  let lastHousehold = getSession().householdId;
  subscribeSession(() => {
    const now = getSession().householdId;
    if (now && now !== lastHousehold) {
      lastHousehold = now;
      void syncNow();
    }
  });

  await syncNow();
}

// -------------------------------------------------------------------- 同期

export async function syncNow() {
  const supabase = getSupabase();
  const session = getSession();
  if (!supabase || !session.householdId || !navigator.onLine || snapshot.syncing) return;

  emit({ syncing: true });
  try {
    await flushOutbox();
    await pull();
    // blocked のときは消さない。消すと「置き場所を DB が知らない」という
    // 案内が pull() の往復のあいだだけ出て消え、利用者は何が起きたか分からない。
    if (!snapshot.blocked) emit({ error: null });
    bindRealtime();
  } catch (e) {
    emit({ error: errorMessage(e) });
  } finally {
    emit({ syncing: false });
  }
}

async function flushOutbox() {
  let guard = (await local.loadOutbox<QueuedInvOp>(STORE)).length + 10;
  while (guard-- > 0) {
    const ops = await local.loadOutbox<QueuedInvOp>(STORE);
    const op = ops[0];
    if (!op) break;
    try {
      await sendOp(op);
    } catch (e) {
      // 通信失敗・中断は code:"" / status:0 で返るので拒否と区別する
      if (!isPermanent(e)) throw e;

      /*
       * 【23514(check 制約違反)は捨ててはいけない】
       *
       * これは「操作が間違っている」のではなく、
       * 「データベースがまだ新しい置き場所を知らない」だけ。
       * 冷蔵庫の区画を3つから5つに増やしたとき、SQL を流す前にアプリが出ると
       * 「氷温」「野菜」がここで弾かれる。
       *
       * 捨てると本当にどこにも残らない。買い物リストから在庫へ移す処理は
       * 先に買い物リスト側を消しているので、買い物1回分が丸ごと消える。
       * だから行列に残し、SQL を流したあとの再送で入るようにする。
       * 後続の操作も同じ理由で落ちるので、ここで止めてよい。
       */
      if ((e as { code?: string }).code === "23514") {
        emit({
          blocked: true,
          error:
            "置き場所をデータベースがまだ知りません。" +
            "supabase/12a_schema_v6_constraint.sql を実行してください。" +
            "未送信のぶんは消していません。",
        });
        return;
      }

      emit({ error: `送信できなかった操作を1件破棄しました: ${errorMessage(e)}` });
    }
    await local.dequeue(op.opId);
    await refreshPending();
  }
}

async function sendOp(op: InvOp) {
  const supabase = getSupabase()!;

  if (op.kind === "add") {
    const { item } = op;
    // 通信が切れて応答だけ失った場合の二重登録を防ぐ(updated_at を鍵に既存行を探す)
    const { data: existing } = await supabase
      .from(TABLE)
      .select("*")
      .eq("household_id", item.household_id)
      .eq("name", item.name)
      .eq("updated_at", item.updated_at)
      .abortSignal(abortAfterTimeout())
      .maybeSingle();

    let row = existing as InventoryItem | null;
    if (!row) {
      const { data, error } = await supabase
        .from(TABLE)
        .insert({
          household_id: item.household_id,
          name: item.name,
          qty: item.qty,
          unit: item.unit,
          location: item.location,
          expiry: item.expiry,
          bought_on: item.bought_on,
          price: item.price,
          updated_at: item.updated_at,
        })
        .select()
        .abortSignal(abortAfterTimeout())
        .single();
      if (error) throw error;
      row = data as InventoryItem;
    }

    await local.removeRow(STORE, op.tempId);
    await local.saveRows(STORE, [row]);
    await local.remapOutboxId(STORE, op.tempId, row.id);
    setItems([...snapshot.items.filter((i) => String(i.id) !== op.tempId), row]);
    return;
  }

  if (isTempId(op.id)) return; // add がまだ流れていない

  if (op.kind === "delete") {
    const { error } = await supabase
      .from(TABLE)
      .delete()
      .eq("id", op.id)
      .abortSignal(abortAfterTimeout());
    if (error) throw error;
    return;
  }

  // 数量は差分ではなく「押し終わった後の値」を送る。
  // 再送しても同じ結果になるので、通信が途中で切れても数が狂わない。
  const { error } = await supabase
    .from(TABLE)
    .update({ ...op.patch, updated_at: op.at })
    .eq("id", op.id)
    .abortSignal(abortAfterTimeout());
  if (error) throw error;
}

async function pull() {
  const supabase = getSupabase();
  if (!supabase) return;

  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .abortSignal(abortAfterTimeout());
  if (error) throw error;

  const ops = await local.loadOutbox<QueuedInvOp>(STORE);
  const pendingIds = new Set(ops.map((op) => ("id" in op ? String(op.id) : op.tempId)));
  const byId = new Map(snapshot.items.map((i) => [String(i.id), i]));

  const merged = (data as InventoryItem[]).map((row) => {
    const mine = byId.get(String(row.id));
    return mine && pendingIds.has(String(row.id)) ? mine : row;
  });
  const serverIds = new Set((data as InventoryItem[]).map((r) => String(r.id)));
  const localOnly = snapshot.items.filter(
    (i) => !serverIds.has(String(i.id)) && pendingIds.has(String(i.id)),
  );

  const next = [...merged, ...localOnly];
  await local.replaceRows(STORE, next);
  setItems(next);
}

let channel: ReturnType<NonNullable<ReturnType<typeof getSupabase>>["channel"]> | null = null;

function bindRealtime() {
  const supabase = getSupabase();
  if (!supabase || realtimeBound) return;
  realtimeBound = true;
  if (channel) void supabase.removeChannel(channel);

  channel = supabase
    .channel("inventory_changes")
    .on("postgres_changes", { event: "*", schema: "public", table: TABLE }, async (payload) => {
      const ops = await local.loadOutbox<QueuedInvOp>(STORE);
      const pendingIds = new Set(ops.map((op) => ("id" in op ? String(op.id) : op.tempId)));

      if (payload.eventType === "DELETE") {
        const id = (payload.old as { id?: ItemId })?.id;
        if (id == null) return;
        await local.removeRow(STORE, id);
        setItems(snapshot.items.filter((i) => String(i.id) !== String(id)));
        return;
      }
      const row = payload.new as InventoryItem;
      if (!row?.id || pendingIds.has(String(row.id))) return;
      await local.saveRows(STORE, [row]);
      setItems([...snapshot.items.filter((i) => String(i.id) !== String(row.id)), row]);
    })
    .subscribe((status) => {
      // 切れたら張り直す。買い物リスト側だけ直して在庫に残っていた
      if (status === "CLOSED" || status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        realtimeBound = false;
        window.setTimeout(() => {
          if (!realtimeBound) void syncNow();
        }, 3000);
      }
    });
}

// ---------------------------------------------------------------- 画面操作

async function queue(op: InvOp) {
  const session = getSession();
  // signedIn ではなく householdId で見る。圏外でトークンの確認が取れなくても
  // 冷蔵庫の前での操作は必ず積む(買い物リストと同じ理由)。
  if (session.mode !== "cloud" || !session.householdId) return;
  await local.enqueue(STORE, op);
  await refreshPending();
  void syncNow();
}

async function patchLocal(id: ItemId, patch: Partial<InventoryItem>) {
  const item = snapshot.items.find((i) => String(i.id) === String(id));
  if (!item) return null;
  const at = new Date().toISOString();
  const next: InventoryItem = { ...item, ...patch, updated_at: at };
  await local.saveRows(STORE, [next]);
  setItems([...snapshot.items.filter((i) => String(i.id) !== String(id)), next]);
  await queue({ kind: "upsert", id, patch, at });
  return next;
}

/** +/- ボタン。0 未満にはしない(「使い切った」は削除で表す)。 */
export async function adjustQty(id: ItemId, delta: number) {
  const item = snapshot.items.find((i) => String(i.id) === String(id));
  if (!item) return;
  const current = item.qty ?? 0;
  const next = Math.round((current + delta) * 10) / 10;
  await patchLocal(id, { qty: Math.max(0, next) });
}

export async function setQty(id: ItemId, qty: number) {
  await patchLocal(id, { qty: Math.max(0, qty) });
}

export async function setLocation(id: ItemId, location: Location) {
  await patchLocal(id, { location });
}

export async function setExpiry(id: ItemId, expiry: string | null) {
  await patchLocal(id, { expiry });
}

/**
 * 詳細シートの「保存」。数量・期限・場所をまとめて1回で書く。
 *
 * 以前は3つの関数を続けて呼んでいたが、どれも呼ばれた時点の状態から
 * 作り直すため、待たずに続けて呼ぶと互いに古い値を書き戻していた
 * (数量を変えて保存すると、期限の書き込みで数量が元に戻る)。
 */
export async function saveDetails(
  id: ItemId,
  patch: { qty?: number; expiry?: string | null; location?: Location },
) {
  const next: Partial<InventoryItem> = {};
  if (patch.qty !== undefined) next.qty = Math.max(0, patch.qty);
  if (patch.expiry !== undefined) next.expiry = patch.expiry;
  if (patch.location !== undefined) next.location = patch.location;
  await patchLocal(id, next);
}

export async function removeItem(id: ItemId) {
  await local.removeRow(STORE, id);
  setItems(snapshot.items.filter((i) => String(i.id) !== String(id)));
  await queue({ kind: "delete", id });
}

export type NewInventory = {
  name: string;
  qty: number | null;
  unit: string | null;
  location: Location;
  expiry?: string | null;
  bought_on?: string | null;
  price?: number | null;
};

export async function addItem(input: NewInventory): Promise<InventoryItem> {
  const session = getSession();
  const row: InventoryItem = {
    id: `tmp_${crypto.randomUUID()}`,
    household_id: session.householdId ?? LOCAL_HOUSEHOLD_ID,
    name: input.name,
    qty: input.qty,
    unit: input.unit,
    location: input.location,
    expiry: input.expiry ?? null,
    bought_on: input.bought_on ?? null,
    price: input.price ?? null,
    updated_at: new Date().toISOString(),
  };
  await local.saveRows(STORE, [row]);
  setItems([...snapshot.items, row]);
  await queue({ kind: "add", tempId: row.id as string, item: row });
  return row;
}

/** 買い物リストのチェック済みを在庫へ流し込む(設計書 フェーズ2-8)。 */
export async function addMany(inputs: NewInventory[]) {
  for (const input of inputs) await addItem(input);
}
