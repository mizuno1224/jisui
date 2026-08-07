"use client";

import { useEffect, useSyncExternalStore } from "react";
import { getServerSnapshot, getSnapshot, init, subscribe } from "./store";

export function useShoppingStore() {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  useEffect(() => {
    void init();
  }, []);
  return snapshot;
}
