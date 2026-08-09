"use client";

import Link from "next/link";
import { Markdown } from "@/components/Markdown";
import { HELP_MARKDOWN } from "@/lib/help-content";

/**
 * 使い方。
 *
 * 文書ファイルに置いても、毎日使う人は開かない。
 * アプリの中から読めないと意味がないので、ここに置いている。
 */
export function HelpScreen() {
  return (
    <main className="min-h-dvh bg-white pb-44 dark:bg-neutral-950">
      <header className="sticky top-0 z-30 border-b border-neutral-200 bg-white/95 px-4 pt-[calc(env(safe-area-inset-top)+0.5rem)] pb-3 backdrop-blur dark:border-neutral-800 dark:bg-neutral-900/95">
        <Link
          href="/"
          className="-ml-2 inline-flex h-9 items-center gap-1 rounded-lg px-2 text-sm text-neutral-500 active:bg-neutral-100 dark:active:bg-neutral-800"
        >
          <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth={2.5}>
            <path d="M15 5l-7 7 7 7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          戻る
        </Link>
        <h1 className="mt-0.5 text-xl font-bold leading-tight">使い方</h1>
      </header>

      <div className="px-4 py-2">
        <Markdown>{HELP_MARKDOWN}</Markdown>
      </div>
    </main>
  );
}
