"use client";

import Link from "next/link";
import { useEffect, useSyncExternalStore } from "react";
import { getServerSnapshot, getSnapshot, init, subscribe } from "@/lib/store";

/**
 * ログインしていない人に中身を見せないための囲い。
 *
 * 【なぜ画面ごとではなく共通の部品にするのか】
 * 以前はログインの確認が買い物リストの中にしか無かった。タブが増えて
 * 「予定」や「家計」を直接開けるようになると、そこには確認が1つも無い。
 * 予定には非公開の予定が、家計には残高が入る。入口が1つでも空いていれば
 * 囲いは無いのと同じなので、全部のタブがこれを通る形にする。
 *
 * 【ログイン切れは締め出さない】
 * 一度もログインしていない人だけを止める。トークンが切れただけの場合は、
 * 手元のリストを見せたまま画面の上に「入り直す」帯を出す(各画面の仕事)。
 * 圏外でトークンの確認が取れないだけで買い物リストが消えると、
 * スーパーの店内という一番大事な場面で使えなくなるため。
 */
export function RequireSession({
  title,
  children,
}: {
  /** ログインを促す画面に出す見出し。「予定」「家計」など */
  title: string;
  children: React.ReactNode;
}) {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  // 買い物リスト以外のタブから開かれたときも、手元のデータを読み始める
  useEffect(() => {
    void init();
  }, []);

  if (snapshot.status === "loading") {
    return (
      <main className="flex min-h-dvh items-center justify-center text-sm text-neutral-500 dark:text-neutral-400">
        読み込み中…
      </main>
    );
  }

  if (snapshot.mode === "cloud" && !snapshot.signedIn && !snapshot.authExpired) {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-6 px-8 text-center">
        <div>
          <p className="text-2xl font-bold">{title}</p>
          <p className="mt-2 text-sm text-neutral-500">
            2人で共有するには、最初に1回だけログインしてください。
          </p>
        </div>
        <Link
          href="/login"
          className="flex h-14 w-full max-w-xs items-center justify-center rounded-xl bg-emerald-600 text-base font-bold text-white"
        >
          ログインする
        </Link>
        <Link href="/help" className="text-sm text-neutral-500 underline">
          使い方を見る
        </Link>
      </main>
    );
  }

  return <>{children}</>;
}
