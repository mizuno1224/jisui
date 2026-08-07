// IndexedDB の薄いラッパ。ライブラリを足さずに済む範囲で最小限にしてある。
//
// 役割はひとつ: 画面が読むデータの置き場を「手元」にすること。
// 電波が無くても起動でき、タップは待たずに反映される(設計書 3-1)。
import type { ItemId, Op, QueuedOp, ShoppingItem } from "./types";

const DB_NAME = "jisui";
const DB_VERSION = 1;
const STORE_ITEMS = "items";
const STORE_OUTBOX = "outbox";
const STORE_META = "meta";

/** プライベートモード等で IndexedDB が使えない端末向けの退避先。少なくともセッション中は動く。 */
const memory = {
  items: new Map<string, ShoppingItem>(),
  outbox: new Map<number, QueuedOp>(),
  meta: new Map<string, unknown>(),
  nextOpId: 1,
};
let useMemory = false;

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("indexedDB unavailable"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_ITEMS)) {
        db.createObjectStore(STORE_ITEMS, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(STORE_OUTBOX)) {
        db.createObjectStore(STORE_OUTBOX, { keyPath: "opId", autoIncrement: true });
      }
      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }).catch((err) => {
    useMemory = true;
    dbPromise = null;
    throw err;
  }) as Promise<IDBDatabase>;
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

const key = (id: ItemId) => String(id);

// ---------------------------------------------------------------- items

export async function loadItems(): Promise<ShoppingItem[]> {
  if (useMemory) return [...memory.items.values()];
  try {
    return await tx<ShoppingItem[]>(STORE_ITEMS, "readonly", (s) => s.getAll());
  } catch {
    useMemory = true;
    return [...memory.items.values()];
  }
}

export async function saveItems(items: ShoppingItem[]): Promise<void> {
  if (useMemory) {
    items.forEach((it) => memory.items.set(key(it.id), it));
    return;
  }
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const t = db.transaction(STORE_ITEMS, "readwrite");
      const store = t.objectStore(STORE_ITEMS);
      items.forEach((it) => store.put(it));
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
    });
  } catch {
    useMemory = true;
    items.forEach((it) => memory.items.set(key(it.id), it));
  }
}

/** サーバから引き直した結果でまるごと置き換える。 */
export async function replaceItems(items: ShoppingItem[]): Promise<void> {
  if (useMemory) {
    memory.items.clear();
    items.forEach((it) => memory.items.set(key(it.id), it));
    return;
  }
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const t = db.transaction(STORE_ITEMS, "readwrite");
      const store = t.objectStore(STORE_ITEMS);
      store.clear();
      items.forEach((it) => store.put(it));
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
    });
  } catch {
    useMemory = true;
    memory.items.clear();
    items.forEach((it) => memory.items.set(key(it.id), it));
  }
}

export async function removeItem(id: ItemId): Promise<void> {
  if (useMemory) {
    memory.items.delete(key(id));
    return;
  }
  try {
    await tx(STORE_ITEMS, "readwrite", (s) => s.delete(id as IDBValidKey));
  } catch {
    useMemory = true;
    memory.items.delete(key(id));
  }
}

// --------------------------------------------------------------- outbox

export async function loadOutbox(): Promise<QueuedOp[]> {
  if (useMemory) return [...memory.outbox.values()].sort((a, b) => a.opId - b.opId);
  try {
    const ops = await tx<QueuedOp[]>(STORE_OUTBOX, "readonly", (s) => s.getAll());
    return ops.sort((a, b) => a.opId - b.opId);
  } catch {
    useMemory = true;
    return [...memory.outbox.values()].sort((a, b) => a.opId - b.opId);
  }
}

export async function enqueue(op: Op): Promise<QueuedOp> {
  if (useMemory) {
    const queued = { ...op, opId: memory.nextOpId++ } as QueuedOp;
    memory.outbox.set(queued.opId, queued);
    return queued;
  }
  try {
    const opId = await tx<IDBValidKey>(STORE_OUTBOX, "readwrite", (s) => s.add(op));
    return { ...op, opId: Number(opId) } as QueuedOp;
  } catch {
    useMemory = true;
    const queued = { ...op, opId: memory.nextOpId++ } as QueuedOp;
    memory.outbox.set(queued.opId, queued);
    return queued;
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
export async function remapOutboxId(from: ItemId, to: ItemId): Promise<void> {
  const ops = await loadOutbox();
  for (const op of ops) {
    if ("id" in op && String(op.id) === String(from)) {
      const next = { ...op, id: to };
      if (useMemory) {
        memory.outbox.set(op.opId, next as QueuedOp);
      } else {
        await tx(STORE_OUTBOX, "readwrite", (s) => s.put(next));
      }
    }
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
