"use client";

// 買い物タブの下に出す「次の候補」。
//
// 【何のためにあるか】
// 買い終わってリストが空になると、次に何が要るかを考える手がかりが何も無い。
// これからの献立で足りないものを、買い物リストとは別の枠に出しておく。
//
// 【リストには勝手に入れない】
// 押して初めて入る。献立も在庫も動くので、勝手に入れた行は、あとから見ると
// 「なぜ載っているのか」が分からない。ここは計算で出しているだけなので、
// 献立を直せば候補もその場で変わる。
import { useMemo, useState } from "react";
import { addItem } from "@/lib/store";
import { todayISO } from "@/lib/dates";
import { HORIZON_DAYS, nextCandidates, type Candidate } from "@/lib/next-shopping";
import { useTable } from "@/lib/use-table";
import { useInventoryStore } from "@/lib/use-store";
import type { MealPlan, Pantry, RecipeIngredient, ShoppingItem } from "@/lib/types";

export function NextCandidates({
  shopping,
  /** 買い終わった直後(未購入0件)は開いた状態で出す */
  defaultOpen,
}: {
  shopping: ShoppingItem[];
  defaultOpen: boolean;
}) {
  const plans = useTable<MealPlan>("meal_plan");
  const ingredients = useTable<RecipeIngredient>("recipe_ingredients");
  const pantry = useTable<Pantry>("pantry");
  const inventory = useInventoryStore();

  const [open, setOpen] = useState(defaultOpen);
  const [busy, setBusy] = useState(false);

  const candidates = useMemo(
    () =>
      nextCandidates({
        plans: plans.rows,
        ingredients: ingredients.rows,
        inventory: inventory.items,
        pantry: pantry.rows,
        shopping,
        today: todayISO(),
      }),
    [plans.rows, ingredients.rows, inventory.items, pantry.rows, shopping],
  );

  // 候補が無いときは枠ごと出さない。「0件」だけの箱は場所を取るだけで何も言わない
  if (candidates.length === 0) return null;

  const add = async (c: Candidate) => {
    await addItem({ item: c.name, qty: null, section: c.section, reason: c.reason });
  };

  const addAll = async () => {
    setBusy(true);
    try {
      // 1件ずつ足す。まとめて足す口は用意していないうえ、
      // 途中で圏外になっても、そこまでは行列に積まれて残る。
      for (const c of candidates) await add(c);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mx-4 mt-6 rounded-2xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-4 py-3 text-left"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-bold">
            次の候補
            <span className="ml-1 text-xs font-normal text-neutral-500 dark:text-neutral-400">
              {candidates.length}件
            </span>
          </span>
          <span className="block text-[11px] text-neutral-500 dark:text-neutral-400">
            {defaultOpen
              ? "買い終わりました。これからの献立で足りないものです"
              : `これから${HORIZON_DAYS}日の献立で足りないもの`}
          </span>
        </span>
        <span className="shrink-0 text-xs font-bold text-neutral-500">
          {open ? "閉じる" : "開く"}
        </span>
      </button>

      {open && (
        <>
          <ul className="divide-y divide-neutral-100 border-t border-neutral-100 dark:divide-neutral-800 dark:border-neutral-800">
            {candidates.map((c) => (
              <li key={c.name} className="flex items-center gap-2 py-2 pl-4 pr-2">
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-semibold">{c.name}</span>
                  <span className="block truncate text-[11px] text-neutral-500 dark:text-neutral-400">
                    {c.reason} · {c.section}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => void add(c)}
                  className="h-11 shrink-0 rounded-xl bg-neutral-100 px-4 text-sm font-bold text-neutral-700 active:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-200"
                >
                  足す
                </button>
              </li>
            ))}
          </ul>

          <div className="px-4 py-3">
            <button
              type="button"
              onClick={() => void addAll()}
              disabled={busy}
              className="h-12 w-full rounded-xl bg-emerald-600 text-sm font-bold text-white disabled:opacity-40"
            >
              {busy ? "足しています…" : `${candidates.length}件を全部リストに足す`}
            </button>
            <p className="mt-2 text-[11px] leading-relaxed text-neutral-500 dark:text-neutral-400">
              足したものはここから消えて、上のリストに入ります。
              在庫にあるもの・常備品・すでにリストにあるものは出しません
              (米は載せません)。
            </p>
          </div>
        </>
      )}
    </section>
  );
}
