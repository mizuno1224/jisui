"use client";

import { useEffect } from "react";

/**
 * Service Worker の登録。開発中は HMR とぶつかるので本番ビルドのときだけ入れる。
 * オフライン動作を試すときは `npm run build && npm start` で確認する。
 */
export function RegisterSW() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;
    const register = () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // 登録に失敗してもアプリ自体は動く(オフライン対応が効かなくなるだけ)
      });
    };
    if (document.readyState === "complete") register();
    else window.addEventListener("load", register);
    return () => window.removeEventListener("load", register);
  }, []);

  return null;
}
