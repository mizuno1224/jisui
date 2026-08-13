"use client";

import { useMemo, useState } from "react";
import { deleteTransaction, markNotDuplicate } from "@/lib/mutations";
import type { Transaction } from "@/lib/types";

const YEN = new Intl.NumberFormat("ja-JP");

export type DupPair = { a: Transaction; b: Transaction };

/**
 * 二重計上の疑いを1組ずつ見て、片方を消すか「別々でよい」と決める画面。
 *
 * 【自動で消さない】
 * 本当に2本買ったのか、二重に入ったのかは行を見ても分からない。
 * 自動で消すと本物の支出が黙って消え、家計が実態より軽く見える。
 * しかも誰も気づけない。だから必ず人に見せて選ばせる。
 *
 * 【「別々でよい」を覚える】
 * 一度決めたものが次の検査でまた出てくると、同じ判断を毎回させられる。
 * うんざりして全部無視するようになったら、この画面は無いのと同じ。
 * 決めたら dup_ok を立てて、二度と出さない。
 */
export function DuplicateSheet({
  pairs,
  onClose,
  onChanged,
}: {
  pairs: DupPair[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const [doneIds, setDoneIds] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);

  const left = useMemo(
    () => pairs.filter((p) => !doneIds.has(p.a.id) && !doneIds.has(p.b.id)),
    [pairs, doneIds],
  );
  const head = left[0];

  async function keepBoth() {
    if (!head || busy) return;
    setBusy(true);
    try {
      await markNotDuplicate([head.a.id, head.b.id]);
      setDoneIds((s) => new Set([...s, head.a.id, head.b.id]));
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function remove(t: Transaction) {
    if (busy) return;
    setBusy(true);
    try {
      await deleteTransaction(t.id);
      setDoneIds((s) => new Set([...s, head.a.id, head.b.id]));
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  const Row = ({ t }: { t: Transaction }) => (
    <div className="rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <p className="text-xs text-neutral-500">
        {t.date}・{t.source}
      </p>
      <p className="mt-1 text-sm font-bold leading-snug">{t.merchant_raw}</p>
      <p className="mt-1.5 text-xl font-bold tabular-nums">¥{YEN.format(t.amount)}</p>
      <p className="mt-0.5 text-[11px] text-neutral-500">
        {t.category}
        {t.memo ? `・${t.memo}` : ""}
      </p>
      <button
        type="button"
        disabled={busy}
        onClick={() => remove(t)}
        className="mt-3 h-10 w-full rounded-xl bg-red-50 text-sm font-bold text-red-700 active:bg-red-100 disabled:opacity-50 dark:bg-red-950/50 dark:text-red-300"
      >
        こちらを消す
      </button>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-neutral-50 dark:bg-neutral-950">
      <header className="border-b border-neutral-200 bg-white px-4 pt-[calc(env(safe-area-inset-top)+0.75rem)] pb-3 dark:border-neutral-800 dark:bg-neutral-900">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">二重計上の疑い</h2>
          <button
            type="button"
            onClick={onClose}
            className="h-9 rounded-lg px-3 text-sm text-neutral-500 active:bg-neutral-100 dark:active:bg-neutral-800"
          >
            閉じる
          </button>
        </div>
        <p className="mt-1 text-sm text-neutral-500">
          残り <span className="font-bold text-neutral-800 dark:text-neutral-200">{left.length}</span> 組
        </p>
      </header>

      {head ? (
        <div className="flex-1 overflow-y-auto px-4 py-5">
          <p className="text-sm text-neutral-600 dark:text-neutral-300">
            同じ金額で、日付が{" "}
            <span className="font-bold">
              {Math.abs(
                (new Date(head.a.date).getTime() - new Date(head.b.date).getTime()) / 86400000,
              )}
              日
            </span>{" "}
            違いです。同じ買い物が2回入っていませんか。
          </p>

          <div className="mt-4 space-y-3">
            <Row t={head.a} />
            <div className="text-center text-xs font-bold text-neutral-400">↕ 同じ買い物?</div>
            <Row t={head.b} />
          </div>

          <button
            type="button"
            disabled={busy}
            onClick={keepBoth}
            className="mt-5 h-12 w-full rounded-xl bg-neutral-900 text-sm font-bold text-white active:bg-neutral-700 disabled:opacity-50 dark:bg-white dark:text-neutral-900"
          >
            別々の買い物です(両方とも残す)
          </button>
          <p className="mt-2 text-center text-xs text-neutral-500">
            一度そう決めた組は、次の検査から出てきません。
          </p>
        </div>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
          <p className="text-4xl">✓</p>
          <p className="text-lg font-bold">疑わしい組はありません</p>
          <p className="text-sm text-neutral-500">
            同じ金額・3日以内・別のカードの組み合わせを見ています。
          </p>
          <button
            type="button"
            onClick={onClose}
            className="mt-2 h-11 rounded-xl bg-neutral-900 px-6 text-sm font-bold text-white dark:bg-white dark:text-neutral-900"
          >
            閉じる
          </button>
        </div>
      )}
    </div>
  );
}
