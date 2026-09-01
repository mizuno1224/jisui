"use client";

import Link from "next/link";
import { useMemo } from "react";
import { LoadNotice, ScreenHeader } from "@/components/ScreenHeader";
import { useTable } from "@/lib/use-table";
import type { Equipment, Pantry, Preference } from "@/lib/types";

/**
 * 台所の決めごと。器具・常備品・好み。
 *
 * 【献立の答えが変わる前提が、アプリのどこにも出ていなかった】
 * チャットに献立を頼むと、この3つを読んでから答えが決まる。
 *   ・equipment に無い器具を使うレシピは出さない
 *   ・pantry にあるものは買い物リストに載せない(米は絶対に載せない)
 *   ・preferences の「苦手」は絶対に使わない
 * つまり「なぜトマトが一度も出てこないのか」の答えはここにある。
 * それが画面から見えないと、AIの気まぐれに見えてしまう。
 *
 * 【読むだけの画面にしてある】
 * 直すのはチャット(受け渡しの update / insert)から。
 * ここに編集を足すと、同じ決めごとを直す道が2本になる。
 * どちらが最後に効いたのかを人が追えなくなるので、当面は入口を1本に保つ。
 */

const STOCK_STYLE: Record<Pantry["stock"], string> = {
  ある: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  切れそう: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300",
  切れた: "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300",
};

const KIND_STYLE: Record<Preference["kind"], string> = {
  苦手: "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300",
  好き: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  方針: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300",
};

export function KitchenScreen() {
  const equipment = useTable<Equipment>("equipment");
  const pantry = useTable<Pantry>("pantry");
  const preferences = useTable<Preference>("preferences");

  /** 常備品は分類ごと。切れているものを分類の中で先に出す。 */
  const pantryGroups = useMemo(() => {
    const map = new Map<string, Pantry[]>();
    for (const p of pantry.rows) {
      const key = p.category ?? "その他";
      const list = map.get(key);
      if (list) list.push(p);
      else map.set(key, [p]);
    }
    const rank = { 切れた: 0, 切れそう: 1, ある: 2 } as const;
    for (const list of map.values()) {
      list.sort((a, b) => rank[a.stock] - rank[b.stock] || a.name.localeCompare(b.name, "ja"));
    }
    return [...map.entries()];
  }, [pantry.rows]);

  const prefGroups = useMemo(
    () =>
      (["苦手", "好き", "方針"] as const)
        .map((kind) => [kind, preferences.rows.filter((p) => p.kind === kind)] as const)
        .filter(([, list]) => list.length > 0),
    [preferences.rows],
  );

  const short = pantry.rows.filter((p) => p.stock !== "ある");

  return (
    <main className="min-h-dvh bg-neutral-50 pb-44 dark:bg-neutral-950">
      <ScreenHeader
        title="記録"
        subtitle="台所の決めごと"
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
          器具 {equipment.rows.length} ・ 常備品 {pantry.rows.length} ・ 好みと方針{" "}
          {preferences.rows.length}
        </p>
      </ScreenHeader>

      <LoadNotice
        loading={equipment.loading && pantry.loading && preferences.loading}
        error={equipment.error ?? pantry.error ?? preferences.error}
        empty={false}
        emptyText=""
      />

      <div className="space-y-3 px-4 pt-3">
        <p className="px-1 text-[11px] text-neutral-500 dark:text-neutral-400">
          献立を相談したときに、AI がこの3つを前提にします。直すのはチャットからです。
        </p>

        {/* -------------------------------------------------- 好み・方針 */}
        {prefGroups.map(([kind, list]) => (
          <section
            key={kind}
            className="overflow-hidden rounded-2xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900"
          >
            <h2 className="flex items-center gap-2 px-4 pt-3.5 text-sm font-bold">
              <span className={`rounded px-1.5 py-0.5 text-[10px] ${KIND_STYLE[kind]}`}>{kind}</span>
              {kind === "苦手" && (
                <span className="text-[11px] font-normal text-neutral-500 dark:text-neutral-400">
                  献立に絶対に出しません
                </span>
              )}
            </h2>
            <ul className="px-4 pb-3.5 pt-1.5">
              {list.map((p) => (
                <li key={p.id} className="py-1 text-sm">
                  {p.item}
                  {p.memo && (
                    <span className="ml-2 text-[11px] text-neutral-500 dark:text-neutral-400">{p.memo}</span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))}

        {/* -------------------------------------------------- 器具 */}
        <section className="overflow-hidden rounded-2xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
          <h2 className="px-4 pt-3.5 text-sm font-bold">器具</h2>
          <p className="px-4 pb-2 text-[11px] text-neutral-500 dark:text-neutral-400">
            ここに無い器具を使うレシピは出しません
          </p>
          <ul className="px-4 pb-3.5">
            {equipment.rows.map((e) => (
              <li key={e.id} className="py-1 text-sm">
                {e.name}
                {e.memo && (
                  <span className="ml-2 text-[11px] text-neutral-500 dark:text-neutral-400">{e.memo}</span>
                )}
              </li>
            ))}
            {equipment.rows.length === 0 && (
              <li className="py-1 text-sm text-neutral-400 dark:text-neutral-600">まだありません</li>
            )}
          </ul>
        </section>

        {/* -------------------------------------------------- 常備品 */}
        <section className="overflow-hidden rounded-2xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
          <h2 className="px-4 pt-3.5 text-sm font-bold">常備品</h2>
          <p className="px-4 pb-2 text-[11px] text-neutral-500 dark:text-neutral-400">
            買い物リストに載せないもの。
            {short.length > 0 && (
              <b className="ml-1 text-amber-700 dark:text-amber-400">
                切れそう・切れた {short.length} 件
              </b>
            )}
          </p>
          {pantryGroups.map(([category, list]) => (
            <div key={category} className="border-t border-neutral-100 px-4 py-2.5 dark:border-neutral-800">
              <h3 className="text-[11px] font-bold text-neutral-500 dark:text-neutral-400">{category}</h3>
              <ul className="mt-1 flex flex-wrap gap-1.5">
                {list.map((p) => (
                  <li
                    key={p.id}
                    className={`rounded-lg px-2 py-1 text-xs ${
                      p.stock === "ある"
                        ? "bg-neutral-100 dark:bg-neutral-800"
                        : STOCK_STYLE[p.stock]
                    }`}
                  >
                    {p.staple && <span className="mr-0.5">★</span>}
                    {p.name}
                    {p.stock !== "ある" && <span className="ml-1 font-bold">{p.stock}</span>}
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <p className="border-t border-neutral-100 px-4 py-2.5 text-[11px] text-neutral-500 dark:border-neutral-800 dark:text-neutral-400">
            ★ は毎回チェックするお決まり食材です
          </p>
        </section>
      </div>
    </main>
  );
}
