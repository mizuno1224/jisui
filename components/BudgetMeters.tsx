"use client";

import { yen } from "@/lib/dates";

/**
 * 予算の消化率。
 *
 * グラフではなくメーターにしたのは、知りたいことが「傾向」ではなく
 * 「あといくら使えるか」という1つの数字だから。
 *
 * 色は3段階(収まっている / 近い / 超過)だが、**色だけで意味を運ばせない**。
 * 緑と橙は色覚特性で見分けにくいため、必ず「残り ¥3,000」「¥2,000 超過」の
 * 文字を添える。
 */
export function BudgetMeters({
  rows,
  onEdit,
}: {
  rows: { category: string; spent: number; budget: number }[];
  onEdit: () => void;
}) {
  return (
    <section className="mt-5">
      <div className="flex items-baseline justify-between px-4 pb-2">
        <h2 className="text-xs font-bold text-neutral-500">今月の予算</h2>
        <button
          type="button"
          onClick={onEdit}
          className="text-xs font-semibold text-emerald-700 underline dark:text-emerald-400"
        >
          予算を決める
        </button>
      </div>

      {rows.length === 0 ? (
        <p className="px-4 text-xs text-neutral-500 dark:text-neutral-400">
          まだ設定がありません。「予算を決める」から費目ごとの上限を入れると、
          残りとペースが出ます。
        </p>
      ) : (
        <ul className="divide-y divide-neutral-100 border-y border-neutral-200 bg-white dark:divide-neutral-800 dark:border-neutral-800 dark:bg-neutral-900">
          {rows.map(({ category, spent, budget }) => {
            const ratio = budget > 0 ? spent / budget : 0;
            const over = spent > budget;
            const near = !over && ratio >= 0.8;
            const barColor = over ? "bg-rose-600" : near ? "bg-amber-600" : "bg-emerald-600";
            const remain = budget - spent;

            return (
              <li key={category} className="px-4 py-3">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-sm font-semibold">{category}</span>
                  <span className="text-xs tabular-nums text-neutral-500">
                    {yen(spent)} / {yen(budget)}
                  </span>
                </div>
                <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800">
                  <div
                    className={`h-full rounded-full ${barColor}`}
                    style={{ width: `${Math.min(100, ratio * 100)}%` }}
                  />
                </div>
                {/* 状態は色だけでなく必ず文字でも示す */}
                <p
                  className={`mt-1 text-xs font-semibold ${
                    over
                      ? "text-rose-700 dark:text-rose-400"
                      : near
                        ? "text-amber-700 dark:text-amber-400"
                        : "text-neutral-500"
                  }`}
                >
                  {over
                    ? `${yen(-remain)} 超過`
                    : near
                      ? `残り ${yen(remain)}(残りわずか)`
                      : `残り ${yen(remain)}`}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
