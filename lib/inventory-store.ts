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
const REQUEST_TIMEOUT_MS = 20_000;
const abortAfterTimeout = () => AbortSignal.timeout(REQUEST_TIMEOUT_MS);

export type InventorySnapshot = {
  items: InventoryItem[];
  status: "loading" | "ready";
  pending: number;
  syncing: boolean;
  error: string | null;
};

const INITIAL: InventorySnapshot = {
  items: [],
  status: "loading",
  pending: 0,
  syncing: false,
  error: null,
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
  // ログインが後から通った場合にも取りに行く
  subscribeSession(() => {
    if (getSession().signedIn) void syncNow();
  });

  await syncNow();
}

// -------------------------------------------------------------------- 同期

export async function syncNow() {
  const supabase = getSupabase();
  const session = getSession();
  if (!supabase || !session.signedIn || !navigator.onLine || snapshot.syncing) return;

  emit({ syncing: true });
  try {
    await flushOutbox();
    await pull();
    emit({ error: null });
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
      const permanent = typeof (e as { code?: unknown })?.code === "string";
      if (!permanent) throw e;
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

function bindRealtime() {
  const supabase = getSupabase();
  if (!supabase || realtimeBound) return;
  realtimeBound = true;

  supabase
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
    .subscribe();
}

// ---------------------------------------------------------------- 画面操作

async function queue(op: InvOp) {
  const session = getSession();
  if (session.mode !== "cloud" || !session.signedIn) return;
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
