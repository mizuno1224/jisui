"use client";

import { useEffect, useState } from "react";

/**
 * Service Worker の登録と、更新の通知。
 *
 * 開発中は HMR とぶつかるので本番ビルドのときだけ入れる。
 * オフライン動作を試すときは `npm run build && npm start` で確認する。
 *
 * 更新の通知が要る理由:
 *   ホーム画面アプリは一度開くと何日も開きっぱなしになる。
 *   新しい版を出しても、開き直すまで古い画面のままで、
 *   直したはずの不具合が直っていないように見える。
 */
export function RegisterSW() {
  const [updated, setUpdated] = useState(false);

  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;

    // 新しい Service Worker が主導権を取った = 中身が入れ替わった合図
    const onControllerChange = () => setUpdated(true);
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);

    const register = () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // 登録に失敗してもアプリ自体は動く(オフライン対応が効かなくなるだけ)
      });
    };
    if (document.readyState === "complete") register();
    else window.addEventListener("load", register);

    return () => {
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
      window.removeEventListener("load", register);
    };
  }, []);

  if (!updated) return null;

  return (
    <div className="fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+4.5rem)] z-50 flex items-center gap-3 rounded-2xl bg-neutral-900 px-4 py-3 text-white shadow-lg dark:bg-neutral-100 dark:text-neutral-900">
      <span className="flex-1 text-sm font-semibold">新しい版があります</span>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="h-10 shrink-0 rounded-xl bg-emerald-600 px-4 text-sm font-bold text-white"
      >
        更新する
      </button>
      <button
        type="button"
        aria-label="閉じる"
        onClick={() => setUpdated(false)}
        className="size-10 shrink-0 rounded-xl text-neutral-500 dark:text-neutral-400"
      >
        ×
      </button>
    </div>
  );
}
