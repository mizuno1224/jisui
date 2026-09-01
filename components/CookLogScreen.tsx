"use client";

import Link from "next/link";
import { useMemo } from "react";
import { LoadNotice, ScreenHeader } from "@/components/ScreenHeader";
import { currentMonth, formatDate, monthLabel } from "@/lib/dates";
import { useTable } from "@/lib/use-table";
import type { CookLog, Recipe } from "@/lib/types";

/**
 * 作った記録。
 *
 * 【これまで、どこからも見えなかった】
 * cook_log は献立を「実施」に変えたときとチャットからの記録で増えていくが、
 * 見る画面が無かった。献立のマス目は日が過ぎれば流れていくので、
 * 「先月は何回作ったのか」「この1品は何回作ったのか」が誰にも言えなかった。
 *
 * 【回数を月ごとに出す】。家計の「1食あたりコスト」は
 * 食費 ÷ その月の調理回数で出している(04_schema_kakeibo.sql の v_cost_per_meal)。
 * その分母がここに見えていないと、コストの数字を疑えない。
 */
export function CookLogScreen() {
  const logs = useTable<CookLog>("cook_log", { orderBy: "date", ascending: false });
  const recipes = useTable<Recipe>("recipes", { select: "id,name" });

  const recipeById = useMemo(() => new Map(recipes.rows.map((r) => [r.id, r])), [recipes.rows]);

  /** 月ごとにまとめる。新しい月が上。 */
  const months = useMemo(() => {
    const map = new Map<string, CookLog[]>();
    for (const log of [...logs.rows].sort((a, b) => b.date.localeCompare(a.date))) {
      const key = log.date.slice(0, 7);
      const list = map.get(key);
      if (list) list.push(log);
      else map.set(key, [log]);
    }
    return [...map.entries()];
  }, [logs.rows]);

  /** よく作るもの。上位8品まで。 */
  const often = useMemo(() => {
    const count = new Map<string, number>();
    for (const log of logs.rows) {
      const name = log.name ?? recipeById.get(log.recipe_id ?? -1)?.name;
      if (!name) continue;
      count.set(name, (count.get(name) ?? 0) + 1);
    }
    return [...count.entries()]
      .filter(([, n]) => n >= 2)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8);
  }, [logs.rows, recipeById]);

  const thisMonth = months.find(([m]) => m === currentMonth())?.[1].length ?? 0;

  return (
    <main className="min-h-dvh bg-neutral-50 pb-44 dark:bg-neutral-950">
      <ScreenHeader
        title="記録"
        subtitle="作った記録"
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
          今月 {thisMonth} 回 ・ ぜんぶで {logs.rows.length} 回
        </p>
      </ScreenHeader>

      <LoadNotice
        loading={logs.loading}
        error={logs.error}
        empty={logs.rows.length === 0}
        emptyText="作った記録はまだありません。献立を「作った」にすると、ここに増えていきます。"
      />

      <div className="space-y-3 px-4 pt-3">
        {often.length > 0 && (
          <section className="overflow-hidden rounded-2xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
            <h2 className="px-4 pt-3.5 text-sm font-bold">よく作るもの</h2>
            <p className="px-4 pb-2 text-[11px] text-neutral-500 dark:text-neutral-400">2回以上作ったもの</p>
            <ul className="flex flex-wrap gap-1.5 px-4 pb-3.5">
              {often.map(([name, n]) => (
                <li
                  key={name}
                  className="rounded-lg bg-neutral-100 px-2 py-1 text-xs dark:bg-neutral-800"
                >
                  {name}
                  <span className="ml-1 font-bold tabular-nums text-neutral-500">{n}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {months.map(([month, list]) => (
          <section
            key={month}
            className="overflow-hidden rounded-2xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900"
          >
            <h2 className="flex items-baseline justify-between px-4 pt-3.5 pb-2 text-sm font-bold">
              {monthLabel(month)}
              <span className="text-xs font-normal text-neutral-500 dark:text-neutral-400">
                {list.length} 回
              </span>
            </h2>
            <ul>
              {list.map((log) => {
                const recipe = log.recipe_id != null ? recipeById.get(log.recipe_id) : undefined;
                const name = log.name ?? recipe?.name ?? "(名前なし)";
                return (
                  <li
                    key={log.id}
                    className="flex items-baseline gap-2 border-t border-neutral-100 px-4 py-2.5 dark:border-neutral-800"
                  >
                    <span className="w-14 shrink-0 text-[11px] tabular-nums text-neutral-500 dark:text-neutral-400">
                      {formatDate(log.date)}
                    </span>
                    <span className="min-w-0 flex-1">
                      {/* レシピが残っていれば作り方へ飛べる。消えていれば名前だけ出す */}
                      {recipe ? (
                        <Link href={`/recipes/${recipe.id}`} className="text-sm underline-offset-2 hover:underline">
                          {name}
                        </Link>
                      ) : (
                        <span className="text-sm">{name}</span>
                      )}
                      {log.memo && (
                        <span className="block truncate text-[11px] text-neutral-500 dark:text-neutral-400">
                          {log.memo}
                        </span>
                      )}
                    </span>
                    {log.batch && (
                      <span className="shrink-0 rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-bold text-sky-800 dark:bg-sky-950 dark:text-sky-300">
                        まとめ作り
                      </span>
                    )}
                    {log.rating != null && (
                      <span className="shrink-0 text-[11px] tabular-nums text-amber-600 dark:text-amber-400">
                        ★{log.rating}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </main>
  );
}
