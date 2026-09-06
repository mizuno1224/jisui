"use client";

import { useEffect, useSyncExternalStore } from "react";
import * as inventory from "./inventory-store";
import { getServerSnapshot, getSnapshot, init, subscribe } from "./store";

export function useShoppingStore() {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  useEffect(() => {
    void init();
  }, []);
  return snapshot;
}

/**
 * 在庫の状態。買い物リストと同じ形で読む。
 *
 * 在庫画面の外(買い物タブの「次の候補」など)からも在庫を見たいので、
 * 画面ごとに useSyncExternalStore を書かずに済むようここに置く。
 */
export function useInventoryStore() {
  const snapshot = useSyncExternalStore(
    inventory.subscribe,
    inventory.getSnapshot,
    inventory.getServerSnapshot,
  );
  useEffect(() => {
    void inventory.init();
  }, []);
  return snapshot;
}
