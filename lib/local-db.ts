// IndexedDB の薄いラッパ。ライブラリを足さずに済む範囲で最小限にしてある。
//
// 役割はひとつ: 画面が読むデータの置き場を「手元」にすること。
// 電波が無くても起動でき、タップは待たずに反映される(設計書 3-1)。
import type { ItemId } from "./types";

const DB_NAME = "jisui";
const DB_VERSION = 2;

/** 行を持つストア。買い物リストと在庫は、どちらもオフラインで書き換える。 */
export type RowStore = "items" | "inventory";
const ROW_STORES: RowStore[] = ["items", "inventory"];

/** 未送信操作。table でどちらの操作かを見分ける(古い行は買い物リスト扱い)。 */
const STORE_OUTBOX = "outbox";
/** 読み取り中心のデータ(レシピ・献立・取引)を、まるごと1件として置く。 */
const STORE_CACHE = "cache";
const STORE_META = "meta";

type AnyRow = { id: ItemId };
/** outbox に入っている行の共通部分。中身は table ごとに違うので緩く扱う。 */
type StoredOp = { opId: number; table?: RowStore; id?: ItemId };

/** プライベートモード等で IndexedDB が使えない端末向けの退避先。少なくともセッション中は動く。 */
const memory = {
  rows: new Map<string, Map<string, AnyRow>>(),
  outbox: new Map<number, StoredOp>(),
  cache: new Map<string, unknown>(),
  meta: new Map<string, unknown>(),
  nextOpId: 1,
};
let useMemory = false;

const memRows = (store: RowStore) => {
  let m = memory.rows.get(store);
  if (!m) {
    m = new Map();
    memory.rows.set(store, m);
  }
  return m;
};

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("indexedDB unavailable"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const store of ROW_STORES) {
        if (!db.objectStoreNames.contains(store)) db.createObjectStore(store, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(STORE_OUTBOX)) {
        db.createObjectStore(STORE_OUTBOX, { keyPath: "opId", autoIncrement: true });
      }
      if (!db.objectStoreNames.contains(STORE_CACHE)) db.createObjectStore(STORE_CACHE);
      if (!db.objectStoreNames.contains(STORE_META)) db.createObjectStore(STORE_META);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }).catch((err) => {
    useMemory = true;
    dbPromise = null;
    throw err;
  });
  return dbPromise;
}

function tx<T>(
  store: string,
  mode: IDBTransactionMode,
  run: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDB().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode);
        const req = run(t.objectStore(store));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

/** 複数件をまとめて書く。1件ずつ put するとトランザクションが増えて遅い。 */
function bulk(store: string, run: (s: IDBObjectStore) => void): Promise<void> {
  return openDB().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const t = db.transaction(store, "readwrite");
        run(t.objectStore(store));
        t.oncomplete = () => resolve();
        t.onerror = () => reject(t.error);
      }),
  );
}

const key = (id: ItemId) => String(id);

// ------------------------------------------------------------------ rows

export async function loadRows<T extends AnyRow>(store: RowStore): Promise<T[]> {
  if (useMemory) return [...memRows(store).values()] as T[];
  try {
    return await tx<T[]>(store, "readonly", (s) => s.getAll());
  } catch {
    useMemory = true;
    return [...memRows(store).values()] as T[];
  }
}

export async function saveRows<T extends AnyRow>(store: RowStore, rows: T[]): Promise<void> {
  if (useMemory) {
    rows.forEach((r) => memRows(store).set(key(r.id), r));
    return;
  }
  try {
    await bulk(store, (s) => rows.forEach((r) => s.put(r)));
  } catch {
    useMemory = true;
    rows.forEach((r) => memRows(store).set(key(r.id), r));
  }
}

/** サーバから引き直した結果でまるごと置き換える。 */
export async function replaceRows<T extends AnyRow>(store: RowStore, rows: T[]): Promise<void> {
  if (useMemory) {
    memRows(store).clear();
    rows.forEach((r) => memRows(store).set(key(r.id), r));
    return;
  }
  try {
    await bulk(store, (s) => {
      s.clear();
      rows.forEach((r) => s.put(r));
    });
  } catch {
    useMemory = true;
    memRows(store).clear();
    rows.forEach((r) => memRows(store).set(key(r.id), r));
  }
}

export async function removeRow(store: RowStore, id: ItemId): Promise<void> {
  if (useMemory) {
    memRows(store).delete(key(id));
    return;
  }
  try {
    await tx(store, "readwrite", (s) => s.delete(id as IDBValidKey));
  } catch {
    useMemory = true;
    memRows(store).delete(key(id));
  }
}

// --------------------------------------------------------------- outbox

export async function loadOutbox<T>(table: RowStore): Promise<(T & { opId: number })[]> {
  const all = useMemory
    ? [...memory.outbox.values()]
    : await tx<StoredOp[]>(STORE_OUTBOX, "readonly", (s) => s.getAll()).catch(() => {
        useMemory = true;
        return [...memory.outbox.values()];
      });
  // table を持たない古い行は買い物リストの操作として扱う
  return all
    .filter((op) => (op.table ?? "items") === table)
    .sort((a, b) => a.opId - b.opId) as (T & { opId: number })[];
}

export async function enqueue<T extends object>(
  table: RowStore,
  op: T,
): Promise<T & { opId: number }> {
  const withTable = { ...op, table };
  const toMemory = () => {
    const queued = { ...withTable, opId: memory.nextOpId++ };
    memory.outbox.set(queued.opId, queued as StoredOp);
    return queued;
  };
  if (useMemory) return toMemory();
  try {
    const opId = await tx<IDBValidKey>(STORE_OUTBOX, "readwrite", (s) => s.add(withTable));
    return { ...withTable, opId: Number(opId) };
  } catch {
    useMemory = true;
    return toMemory();
  }
}

export async function dequeue(opId: number): Promise<void> {
  if (useMemory) {
    memory.outbox.delete(opId);
    return;
  }
  try {
    await tx(STORE_OUTBOX, "readwrite", (s) => s.delete(opId));
  } catch {
    useMemory = true;
    memory.outbox.delete(opId);
  }
}

/** 一時 id のまま積まれている後続操作を、サーバ採番の id に貼り替える。 */
export async function remapOutboxId(
  table: RowStore,
  from: ItemId,
  to: ItemId,
): Promise<void> {
  const ops = await loadOutbox<StoredOp>(table);
  for (const op of ops) {
    if (op.id !== undefined && String(op.id) === String(from)) {
      const next = { ...op, id: to };
      if (useMemory) memory.outbox.set(op.opId, next);
      else await tx(STORE_OUTBOX, "readwrite", (s) => s.put(next));
    }
  }
}

// ---------------------------------------------------------------- cache

/** 読み取り中心のデータ。丸ごと入れ替えるだけなので、配列を1件として置く。 */
export async function readCache<T>(name: string): Promise<T[] | undefined> {
  if (useMemory) return memory.cache.get(name) as T[] | undefined;
  try {
    return await tx<T[]>(STORE_CACHE, "readonly", (s) => s.get(name));
  } catch {
    useMemory = true;
    return memory.cache.get(name) as T[] | undefined;
  }
}

export async function writeCache<T>(name: string, rows: T[]): Promise<void> {
  if (useMemory) {
    memory.cache.set(name, rows);
    return;
  }
  try {
    await tx(STORE_CACHE, "readwrite", (s) => s.put(rows, name));
  } catch {
    useMemory = true;
    memory.cache.set(name, rows);
  }
}

export async function clearCache(): Promise<void> {
  if (useMemory) {
    memory.cache.clear();
    return;
  }
  try {
    await tx(STORE_CACHE, "readwrite", (s) => s.clear());
  } catch {
    useMemory = true;
    memory.cache.clear();
  }
}

// ----------------------------------------------------------------- meta

export async function getMeta<T>(k: string): Promise<T | undefined> {
  if (useMemory) return memory.meta.get(k) as T | undefined;
  try {
    return await tx<T>(STORE_META, "readonly", (s) => s.get(k));
  } catch {
    useMemory = true;
    return memory.meta.get(k) as T | undefined;
  }
}

export async function setMeta(k: string, value: unknown): Promise<void> {
  if (useMemory) {
    memory.meta.set(k, value);
    return;
  }
  try {
    await tx(STORE_META, "readwrite", (s) => s.put(value, k));
  } catch {
    useMemory = true;
    memory.meta.set(k, value);
  }
}
