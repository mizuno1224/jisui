"use client";

import type { ReactNode } from "react";

/** 各画面で共通の上部見出し。買い物リストだけは進捗バーがあるので独自に持っている。 */
export function ScreenHeader({
  title,
  subtitle,
  right,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  right?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className="sticky top-0 z-30 border-b border-neutral-200 bg-white/95 px-4 pt-[calc(env(safe-area-inset-top)+0.75rem)] pb-3 backdrop-blur dark:border-neutral-800 dark:bg-neutral-900/95">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xs font-medium tracking-wide text-neutral-500">{title}</h1>
          {subtitle && <div className="mt-0.5 text-2xl font-bold leading-tight">{subtitle}</div>}
        </div>
        {right && <div className="shrink-0">{right}</div>}
      </div>
      {children}
    </header>
  );
}

/** 読み込み・エラー・圏外を1行で伝える。画面ごとに書き分けない。 */
export function LoadNotice({
  loading,
  error,
  empty,
  emptyText,
}: {
  loading: boolean;
  error: string | null;
  empty: boolean;
  emptyText: string;
}) {
  if (loading) {
    return <p className="px-6 py-20 text-center text-sm text-neutral-500 dark:text-neutral-400">読み込み中…</p>;
  }
  if (error) {
    return (
      <p className="mx-4 mt-4 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:bg-rose-950/50 dark:text-rose-300">
        読み込めませんでした: {error}
      </p>
    );
  }
  if (empty) {
    return <p className="px-6 py-20 text-center text-sm text-neutral-500 dark:text-neutral-400">{emptyText}</p>;
  }
  return null;
}
