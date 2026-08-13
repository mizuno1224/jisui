"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { BudgetMeters } from "@/components/BudgetMeters";
import { LoadNotice, ScreenHeader } from "@/components/ScreenHeader";
import { SpendingChart } from "@/components/SpendingChart";
import { DuplicateSheet, type DupPair } from "@/components/DuplicateSheet";
import { SettlementCard } from "@/components/SettlementCard";
import { setShare } from "@/lib/mutations";
import { ShareSheet } from "@/components/ShareSheet";
import { TransactionSheet } from "@/components/TransactionSheet";
import { BudgetSheet } from "@/components/BudgetSheet";
import { addMonths, currentMonth, formatDate, monthLabel, yen } from "@/lib/dates";
import { useTable } from "@/lib/use-table";
import type { Budget, CookLog, Transaction } from "@/lib/types";

/**
 * 家計。
 *
 * 同梱SQLのビュー(v_monthly_by_category / v_cost_per_meal)は使わず、
 * transactions と cook_log から画面側で集計している。ビューは RLS を
 * 迂回してしまう作りだったため(06_patch_views_rls.sql 参照)、素の表だけを読む。
 */
export function SpendingScreen() {
  const tx = useTable<Transaction>("transactions", { orderBy: "date", ascending: false });
  const logs = useTable<CookLog>("cook_log");
  const budgets = useTable<Budget>("budgets");

  const [month, setMonth] = useState(currentMonth());
  const [chartCategory, setChartCategory] = useState("食費");
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [adding, setAdding] = useState(false);
  const [budgetOpen, setBudgetOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [dupOpen, setDupOpen] = useState(false);
  /** 一覧の絞り込み。null = 全部 */
  const [walletFilter, setWalletFilter] = useState<"夫婦" | "夫" | "妻" | "未分類" | null>(
    null,
  );

  const months = useMemo(() => {
    const set = new Set(tx.rows.map((t) => t.date.slice(0, 7)));
    set.add(currentMonth());
    return [...set].sort().reverse();
  }, [tx.rows]);

  const inMonth = useMemo(
    () => tx.rows.filter((t) => t.date.startsWith(month)),
    [tx.rows, month],
  );

  /*
   * 誰のぶんか。
   *
   * 【未分類は月をまたいで全部見る】
   * 表示中の月だけを見ると、先月の未分類が画面から消えて忘れられる。
   * 振り分けは月に関係なく片付けたいので、ここだけ全期間を見る。
   */
  const unclassified = useMemo(
    () => tx.rows.filter((t) => t.share === "未分類"),
    [tx.rows],
  );

  /*
   * 二重計上の疑い。
   *
   * 同じ金額・3日以内・【出どころが違う】組を探す。
   * 出どころが同じ同額は除く。ETC の「同じ日・同じ金額」は
   * 別々の料金所を通った本物の2件で、それを疑い始めると
   * 正しい記録まで印が付いて読めなくなる。
   *
   * 【月で絞らない】。カード明細は月をまたいで届くので、
   * 表示中の月だけ見ると、月末の買い物と翌月の明細の組が見つからない。
   */
  const dupPairs = useMemo<DupPair[]>(() => {
    const rows = tx.rows.filter((t) => !t.dup_ok);
    const byAmount = new Map<number, typeof rows>();
    for (const t of rows) {
      const list = byAmount.get(t.amount) ?? [];
      list.push(t);
      byAmount.set(t.amount, list);
    }
    const out: DupPair[] = [];
    for (const list of byAmount.values()) {
      if (list.length < 2) continue;
      for (let i = 0; i < list.length; i++) {
        for (let k = i + 1; k < list.length; k++) {
          const a = list[i];
          const b = list[k];
          if (a.source === b.source) continue;
          const days =
            Math.abs(new Date(a.date).getTime() - new Date(b.date).getTime()) / 86400000;
          if (days <= 3) out.push({ a, b });
        }
      }
    }
    return out;
  }, [tx.rows]);

  const byShare = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of inMonth) map.set(t.share, (map.get(t.share) ?? 0) + t.amount);
    return map;
  }, [inMonth]);

  const byCategory = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of inMonth) map.set(t.category, (map.get(t.category) ?? 0) + t.amount);
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [inMonth]);

  /** その月の予算。月指定があればそちらを優先し、無ければ毎月の既定を使う。 */
  const budgetFor = (category: string): number | null => {
    const specific = budgets.rows.find((b) => b.category === category && b.year_month === month);
    if (specific) return specific.amount;
    const fallback = budgets.rows.find((b) => b.category === category && b.year_month === null);
    return fallback?.amount ?? null;
  };

  const budgetRows = useMemo(() => {
    const categories = new Set(budgets.rows.map((b) => b.category));
    return [...categories]
      .map((category) => ({
        category,
        spent: inMonth.filter((t) => t.category === category).reduce((s, t) => s + t.amount, 0),
        budget: budgetFor(category) ?? 0,
      }))
      .filter((r) => r.budget > 0)
      .sort((a, b) => b.spent / b.budget - a.spent / a.budget);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [budgets.rows, inMonth, month]);

  /** 推移は直近6ヶ月。記録が無い月も0として並べる(抜けると傾向が読めない) */
  const trend = useMemo(() => {
    const out: { month: string; amount: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const m = addMonths(month, -i);
      out.push({
        month: m,
        amount: tx.rows
          .filter((t) => t.date.startsWith(m) && t.category === chartCategory)
          .reduce((s, t) => s + t.amount, 0),
      });
    }
    return out;
  }, [tx.rows, month, chartCategory]);

  /*
   * 一覧に出すぶん。お財布で絞り込める。
   *
   * 【絞り込んでも件数は元の数を出す】
   * 「明細(3件)」とだけ出ると、他が消えたのか元から3件なのか分からない。
   * 絞っていることを画面に残す。
   */
  const listed = useMemo(
    () => (walletFilter ? inMonth.filter((t) => t.share === walletFilter) : inMonth),
    [inMonth, walletFilter],
  );

  const total = inMonth.reduce((s, t) => s + t.amount, 0);
  const food = inMonth.filter((t) => t.category === "食費").reduce((s, t) => s + t.amount, 0);
  const foodBudget = budgetFor("食費");
  const cookCount = logs.rows.filter((l) => l.date.startsWith(month)).length;
  const perMeal = cookCount > 0 ? Math.round(food / cookCount) : null;
  const needsReview = inMonth.filter((t) => t.needs_review);
  const max = byCategory[0]?.[1] ?? 1;

  return (
    <main className="min-h-dvh bg-neutral-50 pb-44 dark:bg-neutral-950">
      <ScreenHeader
        title={`${monthLabel(month)}の支出`}
        subtitle={<>{yen(total)}</>}
        right={
          <Link
            href="/spending/assets"
            className="flex h-10 items-center rounded-xl bg-neutral-100 px-3 text-xs font-bold text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"
          >
            資産・収入
          </Link>
        }
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
              {Number(m.slice(5))}月
            </button>
          ))}
        </div>
      </ScreenHeader>

      {/*
        * 未分類があることを、いちばん上で知らせる。
        * 下のほうに置くと、スクロールしない人には一生見えない。
        */}
      {unclassified.length > 0 && (
        <button
          type="button"
          onClick={() => setShareOpen(true)}
          className="mx-4 mt-4 flex w-[calc(100%-2rem)] items-center justify-between rounded-2xl bg-amber-50 px-4 py-3.5 text-left active:bg-amber-100 dark:bg-amber-950/40 dark:active:bg-amber-900/40"
        >
          <span>
            <span className="block text-sm font-bold text-amber-900 dark:text-amber-200">
              誰のぶんか決めていない支出が {unclassified.length} 件
            </span>
            <span className="mt-0.5 block text-xs text-amber-800/80 dark:text-amber-300/80">
              合計 {yen(unclassified.reduce((n, t) => n + t.amount, 0))}・1タップで振り分けられます
            </span>
          </span>
          <span className="text-lg text-amber-700 dark:text-amber-300">›</span>
        </button>
      )}

      {dupPairs.length > 0 && (
        <button
          type="button"
          onClick={() => setDupOpen(true)}
          className="mx-4 mt-3 flex w-[calc(100%-2rem)] items-center justify-between rounded-2xl bg-red-50 px-4 py-3.5 text-left active:bg-red-100 dark:bg-red-950/40 dark:active:bg-red-900/40"
        >
          <span>
            <span className="block text-sm font-bold text-red-900 dark:text-red-200">
              二重計上かもしれない組が {dupPairs.length} 組
            </span>
            <span className="mt-0.5 block text-xs text-red-800/80 dark:text-red-300/80">
              同じ金額・3日以内・別のカード。1組ずつ確かめられます
            </span>
          </span>
          <span className="text-lg text-red-700 dark:text-red-300">›</span>
        </button>
      )}

      <SettlementCard
        rows={tx.rows}
        month={month}
        onFixUnclassified={() => setShareOpen(true)}
      />

      {/* 誰のぶんか。折半の精算に使う */}
      <section className="px-4 pt-4">
        <div className="grid grid-cols-3 gap-2">
          {(["夫婦", "夫", "妻"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setWalletFilter(walletFilter === s ? null : s)}
              className={`rounded-2xl p-3 text-left ${
                walletFilter === s
                  ? "bg-emerald-600 text-white"
                  : "bg-white dark:bg-neutral-900"
              }`}
            >
              <p
                className={`text-[11px] font-medium ${
                  walletFilter === s ? "text-white/80" : "text-neutral-500"
                }`}
              >
                {s}
              </p>
              <p className="mt-0.5 text-lg font-bold tabular-nums">
                {yen(byShare.get(s) ?? 0)}
              </p>
            </button>
          ))}
        </div>
      </section>

      {/* 買い物中に見たいのはこの2つ */}
      <section className="grid grid-cols-2 gap-3 px-4 pt-4">
        <div className="rounded-2xl bg-white p-4 dark:bg-neutral-900">
          <p className="text-xs font-medium text-neutral-500">今月の食費</p>
          <p className="mt-1 text-2xl font-bold tabular-nums">{yen(food)}</p>
          <p className="mt-0.5 text-[11px] text-neutral-500 dark:text-neutral-400">
            {foodBudget
              ? food > foodBudget
                ? `予算を ${yen(food - foodBudget)} 超過`
                : `残り ${yen(foodBudget - food)}`
              : `支出全体の ${total > 0 ? Math.round((food / total) * 100) : 0}%`}
          </p>
        </div>
        <div className="rounded-2xl bg-white p-4 dark:bg-neutral-900">
          <p className="text-xs font-medium text-neutral-500">1食あたり</p>
          <p className="mt-1 text-2xl font-bold tabular-nums">
            {perMeal != null ? yen(perMeal) : "—"}
          </p>
          <p className="mt-0.5 text-[11px] text-neutral-500 dark:text-neutral-400">
            {cookCount > 0 ? `自炊 ${cookCount} 回` : "調理記録がまだありません"}
          </p>
        </div>
      </section>

      <BudgetMeters rows={budgetRows} onEdit={() => setBudgetOpen(true)} />

      <div className="mt-5">
        <SpendingChart
          data={trend}
          budget={budgetFor(chartCategory)}
          label={chartCategory}
        />
      </div>

      <LoadNotice
        loading={tx.loading && tx.rows.length === 0}
        error={tx.error}
        empty={inMonth.length === 0}
        emptyText="この月の記録はありません。右下の + から追加できます。"
      />

      {byCategory.length > 0 && (
        <section className="mt-5">
          <h2 className="px-4 pb-2 text-xs font-bold text-neutral-500">
            費目別(タップすると上のグラフが切り替わります)
          </h2>
          <ul className="divide-y divide-neutral-100 border-y border-neutral-200 bg-white dark:divide-neutral-800 dark:border-neutral-800 dark:bg-neutral-900">
            {byCategory.map(([category, amount]) => (
              <li key={category}>
                <button
                  type="button"
                  onClick={() => setChartCategory(category)}
                  className={`w-full px-4 py-3 text-left ${
                    category === chartCategory ? "bg-emerald-50/60 dark:bg-emerald-950/30" : ""
                  }`}
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-sm font-semibold">{category}</span>
                    <span className="text-sm font-bold tabular-nums">{yen(amount)}</span>
                  </div>
                  <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800">
                    <div
                      className={`h-full rounded-full ${
                        category === chartCategory ? "bg-emerald-500" : "bg-neutral-400"
                      }`}
                      style={{ width: `${Math.max(2, (amount / max) * 100)}%` }}
                    />
                  </div>
                </button>
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
        </section>
      )}

      {inMonth.length > 0 && (
        <section className="mt-5">
          <div className="flex items-baseline justify-between px-4 pb-2">
            <h2 className="text-xs font-bold text-neutral-500">
              明細({listed.length}件・タップで修正)
            </h2>
            {walletFilter && (
              <button
                type="button"
                onClick={() => setWalletFilter(null)}
                className="text-xs font-bold text-emerald-700 dark:text-emerald-400"
              >
                「{walletFilter}」で絞り込み中 ✕
              </button>
            )}
          </div>
          <ul className="divide-y divide-neutral-100 border-y border-neutral-200 bg-white dark:divide-neutral-800 dark:border-neutral-800 dark:bg-neutral-900">
            {listed.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => setEditing(t)}
                  className="flex min-h-14 w-full items-center gap-3 px-4 py-2.5 text-left active:bg-neutral-50 dark:active:bg-neutral-800"
                >
                  <span className="w-14 shrink-0 text-xs text-neutral-500 dark:text-neutral-400">
                    {formatDate(t.date)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">{t.merchant_raw}</span>
                    <span className="text-[10px] text-neutral-500 dark:text-neutral-400">
                      {t.category} · {t.source}
                      {t.needs_review && " · 要確認"}
                    </span>
                  </span>
                  <span className="shrink-0 text-sm font-semibold tabular-nums">{yen(t.amount)}</span>
                </button>
                {/*
                  * お財布は行の中で直せるようにする。
                  * 一覧 → 明細を開く → 直す → 戻る、では数十件を片付けられない。
                  */}
                <div className="flex gap-1 px-4 pb-2">
                  {(["夫婦", "夫", "妻"] as const).map((w) => (
                    <button
                      key={w}
                      type="button"
                      onClick={async () => {
                        await setShare([t.id], w);
                        tx.refetch();
                      }}
                      className={`h-7 rounded-full px-2.5 text-[11px] font-bold ${
                        t.share === w
                          ? "bg-emerald-600 text-white"
                          : "bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400"
                      }`}
                    >
                      {w}
                    </button>
                  ))}
                  {t.share === "未分類" && (
                    <span className="flex h-7 items-center px-1 text-[11px] font-bold text-amber-600">
                      未分類
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <button
        type="button"
        aria-label="支出を追加"
        onClick={() => setAdding(true)}
        className="fixed bottom-[calc(env(safe-area-inset-bottom)+4.75rem)] right-5 z-40 flex size-16 items-center justify-center rounded-full bg-emerald-600 text-white shadow-lg active:bg-emerald-700"
      >
        <svg viewBox="0 0 24 24" className="size-8" fill="none" stroke="currentColor" strokeWidth={2.5}>
          <path d="M12 5v14M5 12h14" strokeLinecap="round" />
        </svg>
      </button>

      {shareOpen && <ShareSheet rows={unclassified} onClose={() => setShareOpen(false)} />}

      {dupOpen && (
        <DuplicateSheet
          pairs={dupPairs}
          onClose={() => setDupOpen(false)}
          onChanged={() => tx.refetch()}
        />
      )}

      {(adding || editing) && (
        <TransactionSheet
          existing={editing}
          defaultMonth={month}
          onClose={() => {
            setAdding(false);
            setEditing(null);
          }}
          onSaved={() => {
            setAdding(false);
            setEditing(null);
            tx.refetch();
          }}
        />
      )}

      {budgetOpen && (
        <BudgetSheet
          budgets={budgets.rows}
          month={month}
          onClose={() => setBudgetOpen(false)}
          onSaved={() => {
            setBudgetOpen(false);
            budgets.refetch();
          }}
        />
      )}
    </main>
  );
}
