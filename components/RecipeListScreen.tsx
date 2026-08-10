"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { LoadNotice, ScreenHeader } from "@/components/ScreenHeader";
import { useTable } from "@/lib/use-table";
import { normalizeText } from "@/lib/matching";
import type { Recipe, RecipeIngredient } from "@/lib/types";

const CATEGORIES = ["主菜", "副菜", "汁物", "麺・丼", "弁当おかず", "その他"];

export function RecipeListScreen() {
  const { rows, loading, error } = useTable<Recipe>("recipes", { orderBy: "name" });
  // 冷蔵庫に残った食材から引けるようにする。台所で一番やりたい探し方。
  const ingredients = useTable<RecipeIngredient>("recipe_ingredients");

  const searchIndex = useMemo(() => {
    const map = new Map<number, string>();
    for (const ing of ingredients.rows) {
      map.set(ing.recipe_id, `${map.get(ing.recipe_id) ?? ""} ${ing.name}`);
    }
    return map;
  }, [ingredients.rows]);
  const [category, setCategory] = useState<string | null>(null);
  const [freezableOnly, setFreezableOnly] = useState(false);
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = normalizeText(query.trim());
    return rows.filter((r) => {
      if (category && r.category !== category) return false;
      if (freezableOnly && !r.freezable) return false;
      if (!q) return true;
      const haystack = normalizeText(
        `${r.name} ${r.tags ?? ""} ${r.protein ?? ""} ${searchIndex.get(r.id) ?? ""}`,
      );
      return haystack.includes(q);
    });
  }, [rows, category, freezableOnly, query, searchIndex]);

  /** なぜその料理が出たのか分かるよう、当たった材料を行の下に出す */
  const matchedIngredient = (recipeId: number): string | null => {
    const q = normalizeText(query.trim());
    if (!q) return null;
    const hit = ingredients.rows.find(
      (i) => i.recipe_id === recipeId && normalizeText(i.name).includes(q),
    );
    return hit?.name ?? null;
  };

  const available = CATEGORIES.filter((c) => rows.some((r) => r.category === c));

  return (
    <main className="min-h-dvh bg-neutral-50 pb-44 dark:bg-neutral-950">
      <ScreenHeader
        title="レシピ"
        right={
          <Link
            href="/recipes/ask"
            className="flex h-10 items-center rounded-xl bg-emerald-600 px-3 text-xs font-bold text-white"
          >
            AIに相談
          </Link>
        }
        subtitle={
          <>
            {rows.length}
            <span className="text-base font-medium text-neutral-500 dark:text-neutral-400"> 品</span>
          </>
        }
      >
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="料理名・材料で探す(なす、玉ねぎ…)"
          className="mt-2 h-11 w-full rounded-xl border border-neutral-300 bg-white px-3 text-base outline-none focus:border-emerald-500 dark:border-neutral-700 dark:bg-neutral-800"
        />
        <div className="-mx-4 mt-2 flex gap-1.5 overflow-x-auto px-4 pb-1">
          <FilterChip active={!category && !freezableOnly} onClick={() => { setCategory(null); setFreezableOnly(false); }}>
            すべて
          </FilterChip>
          {available.map((c) => (
            <FilterChip key={c} active={category === c} onClick={() => setCategory(category === c ? null : c)}>
              {c}
            </FilterChip>
          ))}
          <FilterChip active={freezableOnly} onClick={() => setFreezableOnly((v) => !v)}>
            🧊 冷凍可
          </FilterChip>
        </div>
      </ScreenHeader>

      <LoadNotice
        loading={loading && rows.length === 0}
        error={error}
        empty={filtered.length === 0}
        emptyText="条件に合うレシピがありません。"
      />

      <ul className="mt-3 divide-y divide-neutral-100 border-y border-neutral-200 bg-white dark:divide-neutral-800 dark:border-neutral-800 dark:bg-neutral-900">
        {filtered.map((r) => (
          <li key={r.id}>
            <Link
              href={`/recipes/${r.id}`}
              className="flex min-h-16 items-center gap-3 px-4 py-3 active:bg-neutral-100 dark:active:bg-neutral-800"
            >
              <span className="min-w-0 flex-1">
                <span className="block text-[17px] font-semibold leading-tight">{r.name}</span>
                {matchedIngredient(r.id) && (
                  <span className="mt-0.5 block text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">
                    材料: {matchedIngredient(r.id)}
                  </span>
                )}
                <span className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-neutral-500">
                  {r.category && <Tag>{r.category}</Tag>}
                  {r.protein && r.protein !== "なし" && <Tag>{r.protein}</Tag>}
                  {r.time_min != null && <Tag>{r.time_min}分</Tag>}
                  {r.freezable && <Tag className="bg-cyan-100 text-cyan-900">冷凍可</Tag>}
                </span>
              </span>
              <svg viewBox="0 0 24 24" className="size-5 shrink-0 text-neutral-300" fill="none" stroke="currentColor" strokeWidth={2}>
                <path d="M9 5l7 7-7 7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`h-9 shrink-0 rounded-full px-3.5 text-xs font-bold transition-colors ${
        active
          ? "bg-emerald-600 text-white"
          : "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"
      }`}
    >
      {children}
    </button>
  );
}

function Tag({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={`rounded px-1.5 py-0.5 ${className || "bg-neutral-100 dark:bg-neutral-800"}`}>
      {children}
    </span>
  );
}
