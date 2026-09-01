"use client";

import Link from "next/link";
import { useMemo } from "react";
import { LoadNotice, ScreenHeader } from "@/components/ScreenHeader";
import { formatDate, yen } from "@/lib/dates";
import { useTable } from "@/lib/use-table";
import type { ReceiptItem, Transaction } from "@/lib/types";

/**
 * レシートの明細。
 *
 * 【いちばん長いあいだ見えていなかった記録】
 * receipt_items はレシートを取り込むたびに増えるのに、読む画面が1つも無かった。
 * 家計画面に出るのは合計金額だけなので、
 * 「先週の3,240円のうち、卵はいくらだったか」は誰にも分からない。
 * 品目と値段は、次に同じものを買うときの相場の記憶になる。
 *
 * 【合計の食い違いを隠さない】
 * レシートの明細を全部読めているとは限らない(値引き・ポイント・税の丸め)。
 * 明細の合計と支出額が違うときは、その差をそのまま出す。
 * 合わせて見せると、明細が全部あるかのように読めてしまう。
 */
export function ReceiptItemsScreen() {
  // 明細のある取引だけを出すので、取引側は列を絞って読む。
  // レシート本文まで引くとこの画面がいちばん重くなる(ホームと同じ注意)。
  const tx = useTable<Transaction>("transactions", {
    select: "id,date,amount,merchant_raw,category,source",
    orderBy: "date",
    ascending: false,
  });
  const items = useTable<ReceiptItem>("receipt_items");

  const groups = useMemo(() => {
    const byTx = new Map<number, ReceiptItem[]>();
    for (const it of items.rows) {
      const list = byTx.get(it.transaction_id);
      if (list) list.push(it);
      else byTx.set(it.transaction_id, [it]);
    }
    return [...tx.rows]
      .sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id)
      .map((t) => ({ tx: t, items: byTx.get(t.id) ?? [] }))
      .filter((g) => g.items.length > 0);
  }, [tx.rows, items.rows]);

  /** レシートとして入っている支出のうち、明細まで残っているものがどれだけあるか。 */
  const receipts = tx.rows.filter((t) => t.source === "レシート").length;

  return (
    <main className="min-h-dvh bg-neutral-50 pb-44 dark:bg-neutral-950">
      <ScreenHeader
        title="記録"
        subtitle="レシートの明細"
        right={
          <Link
            href="/records"
            className="flex h-10 items-center rounded-xl bg-neutral-100 px-3 text-xs font-bold text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"
          >
            もどる
          </Link>
        }
      >
        <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
          品目 {items.rows.length} 件 ・ 明細のある買い物 {groups.length} 件
          {receipts > groups.length && `(レシートの支出 ${receipts} 件のうち)`}
        </p>
      </ScreenHeader>

      <LoadNotice
        loading={items.loading || tx.loading}
        error={items.error ?? tx.error}
        empty={groups.length === 0}
        emptyText="明細はまだありません。レシートを品目つきで取り込むと、ここに残ります。"
      />

      <div className="space-y-3 px-4 pt-3">
        {groups.map(({ tx: t, items: list }) => {
          const known = list.filter((i) => i.price != null);
          const sum = known.reduce((s, i) => s + (i.price ?? 0), 0);
          // 【全部の品目に値段があるときだけ差を出す】。
          // 値段の無い品目が混ざったままの差額は、ただの読み落としであって食い違いではない。
          const diff = known.length === list.length ? t.amount - sum : null;
          return (
            <section
              key={t.id}
              className="overflow-hidden rounded-2xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900"
            >
              <div className="flex items-baseline justify-between gap-2 px-4 pt-3.5">
                <div className="min-w-0">
                  <span className="text-sm font-bold">{t.merchant_raw}</span>
                  <span className="ml-2 text-[11px] text-neutral-500 dark:text-neutral-400">
                    {formatDate(t.date)} ・ {t.category}
                  </span>
                </div>
                <span className="shrink-0 text-sm font-bold tabular-nums">{yen(t.amount)}</span>
              </div>

              <ul className="px-4 py-2">
                {list.map((i) => (
                  <li key={i.id} className="flex items-baseline gap-2 py-1">
                    <span className="min-w-0 flex-1 truncate text-[13px]">{i.item}</span>
                    {i.registered && (
                      <span className="shrink-0 text-[10px] font-bold text-emerald-600 dark:text-emerald-400">
                        在庫へ
                      </span>
                    )}
                    <span className="shrink-0 text-[13px] tabular-nums text-neutral-600 dark:text-neutral-300">
                      {i.price != null ? yen(i.price) : "—"}
                    </span>
                  </li>
                ))}
              </ul>

              <p className="border-t border-neutral-100 px-4 py-2 text-[11px] text-neutral-500 dark:border-neutral-800 dark:text-neutral-400">
                明細の合計 {yen(sum)}
                {known.length < list.length && `(値段のある ${known.length}/${list.length} 件ぶん)`}
                {diff != null && diff !== 0 && (
                  <span className="ml-1 text-amber-700 dark:text-amber-400">
                    ・支出との差 {yen(diff)}(値引きや税の丸めなど)
                  </span>
                )}
              </p>
            </section>
          );
        })}
      </div>
    </main>
  );
}
