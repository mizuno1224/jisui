"use client";

import { useEffect } from "react";

/**
 * 直前の操作を取り消す帯。
 *
 * 行全体がタップ領域なので、片手でスクロールしていると親指の擦れで
 * 隣の行を踏む。チェックが入ると行は売り場の下へ沈むため、何を押したのか
 * 見えないまま消え、押していない物が「購入済」になって店を出るまで気づかない。
 * 削除はさらに戻せなかった。だから「何をしたか」と「取り消す」を必ず出す。
 */
export function Snackbar({
  message,
  actionLabel = "取り消す",
  onAction,
  onDismiss,
  timeoutMs = 5000,
}: {
  message: string;
  actionLabel?: string;
  onAction: () => void;
  onDismiss: () => void;
  timeoutMs?: number;
}) {
  useEffect(() => {
    const t = window.setTimeout(onDismiss, timeoutMs);
    return () => window.clearTimeout(t);
  }, [onDismiss, timeoutMs, message]);

  return (
    <div
      role="status"
      className="fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+4.5rem)] z-50 flex items-center gap-2 rounded-2xl bg-neutral-900 py-2 pl-4 pr-2 text-white shadow-lg dark:bg-neutral-100 dark:text-neutral-900"
    >
      <span className="min-w-0 flex-1 truncate text-sm font-semibold">{message}</span>
      <button
        type="button"
        onClick={onAction}
        className="h-11 shrink-0 rounded-xl bg-emerald-600 px-4 text-sm font-bold text-white"
      >
        {actionLabel}
      </button>
    </div>
  );
}
