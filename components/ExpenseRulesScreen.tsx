"use client";

import Link from "next/link";
import { useMemo } from "react";
import { LoadNotice, ScreenHeader } from "@/components/ScreenHeader";
import { useTable } from "@/lib/use-table";
import type { ExpenseRule } from "@/lib/types";

/**
 * 費目の決まり(分類辞書)。
 *
 * 【カード明細の費目が、どこで決まっているのか】
 * 取り込みのときに店名へキーワードを部分一致させて費目を決めている。
 * その辞書が見えないので、「なぜこの店が日用品になったのか」に答えられなかった。
 * 費目がおかしいと思ったとき、直すべきなのは取引1件ではなく、たいていこの行である。
 *
 * 【長いキーワードから先に当てる】
 * 「セブン-イレブン」と「セブン」の両方があると、短いほうが先に当たった場合に
 * 意図しない費目が付く。取り込み側は長い順に見る決まりなので、
 * この画面も**同じ順で並べる**。並びが違うと、画面で確かめた順と
 * 実際に当たる順が食い違い、確かめる意味が無くなる。
 */
export function ExpenseRulesScreen() {
  const rules = useTable<ExpenseRule>("expense_rules");

  const groups = useMemo(() => {
    const map = new Map<string, ExpenseRule[]>();
    for (const r of rules.rows) {
      const list = map.get(r.category);
      if (list) list.push(r);
      else map.set(r.category, [r]);
    }
    for (const list of map.values()) {
      // 取り込み側と同じ「長いキーワードが先」。同じ長さなら名前順で安定させる
      list.sort((a, b) => b.keyword.length - a.keyword.length || a.keyword.localeCompare(b.keyword, "ja"));
    }
    return [...map.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [rules.rows]);

  return (
    <main className="min-h-dvh bg-neutral-50 pb-44 dark:bg-neutral-950">
      <ScreenHeader
        title="記録"
        subtitle="費目の決まり"
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
          {rules.rows.length} 件 ・ 店名に含まれていたら、その費目にする
        </p>
      </ScreenHeader>

      <LoadNotice
        loading={rules.loading}
        error={rules.error}
        empty={rules.rows.length === 0}
        emptyText="まだありません。チャットで「◯◯は日用品」と伝えると増えます。"
      />

      <div className="space-y-3 px-4 pt-3">
        <p className="px-1 text-[11px] text-neutral-500 dark:text-neutral-400">
          カード明細を取り込むときに引きます。長いキーワードから先に当たるので、上に出ているものが強い決まりです。
          足すのはチャットからです。
        </p>

        {groups.map(([category, list]) => (
          <section
            key={category}
            className="overflow-hidden rounded-2xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900"
          >
            <h2 className="flex items-baseline justify-between px-4 pt-3.5 pb-2 text-sm font-bold">
              {category}
              <span className="text-xs font-normal text-neutral-500 dark:text-neutral-400">
                {list.length} 件
              </span>
            </h2>
            <ul>
              {list.map((r) => (
                <li
                  key={r.id}
                  className="flex items-baseline gap-2 border-t border-neutral-100 px-4 py-2 dark:border-neutral-800"
                >
                  <span className="min-w-0 flex-1 truncate text-[13px]">{r.keyword}</span>
                  {r.note && (
                    <span className="shrink-0 text-[11px] text-neutral-500 dark:text-neutral-400">{r.note}</span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </main>
  );
}
