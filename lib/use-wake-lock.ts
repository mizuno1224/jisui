"use client";

import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";

const STORAGE_KEY = "jisui_keep_screen_on";

/*
 * 「画面を消さない」の入り切りは、レシピを開き直しても引き継ぎたい。
 * React の state ではなくモジュール側に置き、useSyncExternalStore で読む。
 * 端末が対応しているかどうかも同じ扱い(どちらも React の外にある事実)。
 */
let enabled = false;
let loaded = false;
const listeners = new Set<() => void>();

function readStored(): boolean {
  if (!loaded) {
    enabled = typeof localStorage !== "undefined" && localStorage.getItem(STORAGE_KEY) === "on";
    loaded = true;
  }
  return enabled;
}

function setStored(next: boolean) {
  enabled = next;
  loaded = true;
  try {
    localStorage.setItem(STORAGE_KEY, next ? "on" : "off");
  } catch {
    // プライベートモード等。設定が残らないだけで動作に影響はない
  }
  for (const l of listeners) l();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

const noopSubscribe = () => () => {};
const isSupported = () => typeof navigator !== "undefined" && "wakeLock" in navigator;

/**
 * レシピを見ている間、画面を消さない。
 *
 * カードは「なすをレンジで3分30秒」「玉ねぎを15分置く」のように待ち時間だらけで、
 * 待っている間に自動ロックが必ず走る。濡れた手・粉のついた手では顔認証も指も
 * 通らないので、手を拭く→解錠→読んでいた工程を探し直す、が一皿の調理中に何度も起きる。
 *
 * 対応していない端末では黙って何もしない(トグル自体を出さない)。
 */
export function useWakeLock() {
  const supported = useSyncExternalStore(noopSubscribe, isSupported, () => false);
  const on = useSyncExternalStore(subscribe, readStored, () => false);
  const sentinel = useRef<WakeLockSentinel | null>(null);

  useEffect(() => {
    if (!supported) return;

    const release = () => {
      void sentinel.current?.release().catch(() => {});
      sentinel.current = null;
    };
    const acquire = async () => {
      try {
        sentinel.current = await navigator.wakeLock.request("screen");
      } catch {
        // 電池残量が少ない等で断られることがある。諦めて普通に表示する。
      }
    };

    if (on) void acquire();
    else release();

    // 他のアプリに切り替えて戻ると解除されるので取り直す
    const onVisible = () => {
      if (document.visibilityState === "visible" && on) void acquire();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      release();
    };
  }, [supported, on]);

  const toggle = useCallback(() => setStored(!readStored()), []);

  return { supported, enabled: on, toggle };
}
