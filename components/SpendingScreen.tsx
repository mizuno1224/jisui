"use client";

import { useMemo, useState } from "react";
import { LoadNotice, ScreenHeader } from "@/components/ScreenHeader";
import { currentMonth, formatDate, yen } from "@/lib/dates";
import { useTable } from "@/lib/use-table";
import type { CookLog, Transaction } from "@/lib/types";

/**
 * 支出サマリー(設計書 フェーズ3-13)。
 *
 * 同梱SQLのビュー(v_monthly_by_category / v_cost_per_meal)は使わず、
 * transactions と cook_log から画面側で集計している。
 * ビューは RLS を迂回してしまうため(patch_views_rls.sql 参照)、
 * 素の表だけを読むほうが安全で、月の切り替えも自由にできる。
 */
export function SpendingScreen() {
  const tx = useTable<Transaction>("transactions", { orderBy: "date", ascending: false });
  const logs = useTable<CookLog>("cook_log");
  const [month, setMonth] = useState(currentMonth());

  const months = useMemo(() => {
    const set = new Set(tx.rows.map((t) => t.date.slice(0, 7)));
    set.add(currentMonth());
    return [...set].sort().reverse();
  }, [tx.rows]);

  const inMonth = useMemo(
    () => tx.rows.filter((t) => t.date.startsWith(month)),
    [tx.rows, month],
  );

  const byCategory = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of inMonth) map.set(t.category, (map.get(t.category) ?? 0) + t.amount);
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [inMonth]);

  const total = inMonth.reduce((s, t) => s + t.amount, 0);
  const food = inMonth.filter((t) => t.category === "食費").reduce((s, t) => s + t.amount, 0);
  const cookCount = logs.rows.filter((l) => l.date.startsWith(month)).length;
  // 1食あたりコスト: 食費 ÷ その月の調理回数(設計書 5-2)
  const perMeal = cookCount > 0 ? Math.round(food / cookCount) : null;
  const needsReview = inMonth.filter((t) => t.needs_review);
  const max = byCategory[0]?.[1] ?? 1;

  return (
    <main className="min-h-dvh bg-neutral-50 pb-44 dark:bg-neutral-950">
      <ScreenHeader
        title={`${month.replace("-", "年")}月の支出`}
        subtitle={<>{yen(total)}</>}
      >
        <div className="-mx-4 mt-2 flex gap-1.5 overflow-x-auto px-4 pb-1">
          {months.slice(0, 12).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMonth(m)}
              className={`h-9 shrink-0 rounded-full px-3 text-xs font-bold ${
                m === month
                  ? "bg-emerald-600 text-white"
                  : "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"
              }`}
            >
              {m.slice(5)}月
            </button>
          ))}
        </div>
      </ScreenHeader>

      {/* 買い物中に見たいのはこの2つ */}
      <section className="grid grid-cols-2 gap-3 px-4 pt-4">
        <div className="rounded-2xl bg-white p-4 dark:bg-neutral-900">
          <p className="text-xs font-medium text-neutral-500">今月の食費</p>
          <p className="mt-1 text-2xl font-bold tabular-nums">{yen(food)}</p>
          <p className="mt-0.5 text-[11px] text-neutral-400">
            支出全体の {total > 0 ? Math.round((food / total) * 100) : 0}%
          </p>
        </div>
        <div className="rounded-2xl bg-white p-4 dark:bg-neutral-900">
          <p className="text-xs font-medium text-neutral-500">1食あたり</p>
          <p className="mt-1 text-2xl font-bold tabular-nums">
            {perMeal != null ? yen(perMeal) : "—"}
          </p>
          <p className="mt-0.5 text-[11px] text-neutral-400">
            {cookCount > 0 ? `自炊 ${cookCount} 回` : "調理記録がまだありません"}
          </p>
        </div>
      </section>

      <LoadNotice
        loading={tx.loading && tx.rows.length === 0}
        error={tx.error}
        empty={inMonth.length === 0}
        emptyText="この月の記録はありません。"
      />

      {byCategory.length > 0 && (
        <section className="mt-5">
          <h2 className="px-4 pb-2 text-xs font-bold text-neutral-500">費目別</h2>
          <ul className="divide-y divide-neutral-100 border-y border-neutral-200 bg-white dark:divide-neutral-800 dark:border-neutral-800 dark:bg-neutral-900">
            {byCategory.map(([category, amount]) => (
              <li key={category} className="px-4 py-3">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-sm font-semibold">{category}</span>
                  <span className="text-sm font-bold tabular-nums">{yen(amount)}</span>
                </div>
                <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800">
                  <div
                    className={`h-full rounded-full ${
                      category === "食費" ? "bg-emerald-500" : "bg-neutral-400"
                    }`}
                    style={{ width: `${Math.max(2, (amount / max) * 100)}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {needsReview.length > 0 && (
        <section className="mx-4 mt-5 rounded-xl bg-amber-50 px-4 py-3 dark:bg-amber-950/40">
          <h2 className="text-xs font-bold text-amber-900 dark:text-amber-200">
            重複の確認が必要 {needsReview.length} 件
          </h2>
          <p className="mt-1 text-xs text-amber-900 dark:text-amber-200">
            レシートとカード明細で二重計上になっている可能性がある行です。
            照合は Cowork(チャット)側で行います。
          </p>
          <ul className="mt-2 space-y-1">
            {needsReview.slice(0, 5).map((t) => (
              <li key={t.id} className="flex justify-between text-xs text-amber-900 dark:text-amber-100">
                <span className="truncate">
                  {formatDate(t.date)} {t.merchant_raw}
                </span>
                <span className="shrink-0 tabular-nums">{yen(t.amount)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {inMonth.length > 0 && (
        <section className="mt-5">
          <h2 className="px-4 pb-2 text-xs font-bold text-neutral-500">
            明細({inMonth.length}件)
          </h2>
          <ul className="divide-y divide-neutral-100 border-y border-neutral-200 bg-white dark:divide-neutral-800 dark:border-neutral-800 dark:bg-neutral-900">
            {inMonth.map((t) => (
              <li key={t.id} className="flex items-center gap-3 px-4 py-2.5">
                <span className="w-14 shrink-0 text-xs text-neutral-400">
                  {formatDate(t.date)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{t.merchant_raw}</span>
                  <span className="text-[10px] text-neutral-400">
                    {t.category} · {t.source}
                  </span>
                </span>
                <span className="shrink-0 text-sm font-semibold tabular-nums">{yen(t.amount)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
