"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { LoadNotice, ScreenHeader } from "@/components/ScreenHeader";
import {
  getServerSnapshot as invServer,
  getSnapshot as invSnapshot,
  init as initInventory,
  subscribe as subscribeInventory,
} from "@/lib/inventory-store";
import { useTable } from "@/lib/use-table";
import { normalizeText } from "@/lib/matching";
import { EQUIPMENT_LABELS, equipmentTagsOf, missingByRecipe } from "@/lib/recipe-facets";
import type { Recipe, RecipeIngredient } from "@/lib/types";

const CATEGORIES = ["主菜", "副菜", "汁物", "麺・丼", "弁当おかず", "その他"];

/** 「帰りが遅い日でも作れる」の線。カードの調理時間(time_min)で切る。 */
const QUICK_MIN = 10;

type PantryRow = { id: number; name: string; stock: string };

export function RecipeListScreen() {
  const { rows, loading, error } = useTable<Recipe>("recipes", { orderBy: "name" });
  // 冷蔵庫に残った食材から引けるようにする。台所で一番やりたい探し方。
  const ingredients = useTable<RecipeIngredient>("recipe_ingredients");
  // 「いま作れる」を出すために在庫と常備品を読む。判定は RecipeDetailScreen と同じ
  // ものを lib/recipe-facets.ts から使う(別々に書くと一覧と中の表示が食い違う)。
  const pantry = useTable<PantryRow>("pantry");
  const inventory = useSyncExternalStore(subscribeInventory, invSnapshot, invServer);
  useEffect(() => {
    void initInventory();
  }, []);

  const searchIndex = useMemo(() => {
    const map = new Map<number, string>();
    for (const ing of ingredients.rows) {
      map.set(ing.recipe_id, `${map.get(ing.recipe_id) ?? ""} ${ing.name}`);
    }
    return map;
  }, [ingredients.rows]);

  const [category, setCategory] = useState<string | null>(null);
  const [freezableOnly, setFreezableOnly] = useState(false);
  const [readyOnly, setReadyOnly] = useState(false);
  const [quickOnly, setQuickOnly] = useState(false);
  const [equipment, setEquipment] = useState<string | null>(null);
  const [byTime, setByTime] = useState(false);
  const [query, setQuery] = useState("");

  /*
   * 器具の札はレシピごとに一度だけ出す。
   * カード本文を正規表現で読むので、行を描くたびにやると 27 品ぶん毎回走る。
   */
  const equipmentOf = useMemo(() => {
    const map = new Map<number, string[]>();
    for (const r of rows) map.set(r.id, equipmentTagsOf(r));
    return map;
  }, [rows]);

  /** 材料と在庫の突き合わせ。在庫を1つ動かしたときだけ計算し直す。 */
  const shortage = useMemo(
    () => missingByRecipe(ingredients.rows, inventory.items, pantry.rows),
    [ingredients.rows, inventory.items, pantry.rows],
  );

  /** 材料が1行も登録されていないレシピは「作れる」とも「足りない」とも言わない。 */
  const readyToCook = (id: number) => {
    const s = shortage.get(id);
    return s !== undefined && s.total > 0 && s.missing === 0;
  };

  const filtered = useMemo(() => {
    const q = normalizeText(query.trim());
    const hit = rows.filter((r) => {
      if (category && r.category !== category) return false;
      if (freezableOnly && !r.freezable) return false;
      if (quickOnly && (r.time_min == null || r.time_min > QUICK_MIN)) return false;
      if (equipment && !(equipmentOf.get(r.id) ?? []).includes(equipment)) return false;
      if (readyOnly && !readyToCook(r.id)) return false;
      if (!q) return true;
      const haystack = normalizeText(
        `${r.name} ${r.tags ?? ""} ${r.protein ?? ""} ${searchIndex.get(r.id) ?? ""}`,
      );
      return haystack.includes(q);
    });
    if (!byTime) return hit;
    /*
     * 【時間の分からないものは最後】。null を 0 として扱うと、
     * 調理時間を入れ忘れたレシピが「一番早い」ものとして先頭に並ぶ。
     * 帰りが遅い日にそれを選ぶと、実際には30分かかることになる。
     */
    return [...hit].sort((a, b) => {
      const x = a.time_min ?? Number.POSITIVE_INFINITY;
      const y = b.time_min ?? Number.POSITIVE_INFINITY;
      return x === y ? a.name.localeCompare(b.name, "ja") : x - y;
    });
    // readyToCook は shortage から作る。依存は shortage で足りる。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    rows, category, freezableOnly, quickOnly, equipment, readyOnly,
    byTime, query, searchIndex, equipmentOf, shortage,
  ]);

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
  const readyCount = rows.filter((r) => readyToCook(r.id)).length;
  const quickCount = rows.filter((r) => r.time_min != null && r.time_min <= QUICK_MIN).length;

  /*
   * 器具ごとの品数を札に出す。
   * 「器具が5台あるのに、レシピが偏っているかどうかが今は見えない」への答え。
   * 0 品の器具も【消さずに 0 と出す】。消すと「そういう絞り込みは無い」に見えて、
   * 偏っていること自体が分からなくなる。
   */
  const equipmentCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const label of EQUIPMENT_LABELS) counts.set(label, 0);
    for (const tags of equipmentOf.values()) {
      for (const t of tags) counts.set(t, (counts.get(t) ?? 0) + 1);
    }
    return counts;
  }, [equipmentOf]);

  const clearAll = () => {
    setCategory(null);
    setFreezableOnly(false);
    setReadyOnly(false);
    setQuickOnly(false);
    setEquipment(null);
  };
  const noFilter = !category && !freezableOnly && !readyOnly && !quickOnly && !equipment;

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
            {filtered.length}
            <span className="text-base font-medium text-neutral-500 dark:text-neutral-400">
              {filtered.length === rows.length ? " 品" : ` / ${rows.length} 品`}
            </span>
          </>
        }
      >
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="料理名・材料で探す(なす、玉ねぎ…)"
          className="mt-2 h-11 w-full rounded-xl border border-neutral-300 bg-white px-3 text-base outline-none focus:border-emerald-500 dark:border-neutral-700 dark:bg-neutral-800"
        />

        {/* 1段目: 分類。献立を組むときの一番大きな分かれ目なので単独の段にする */}
        <div className="-mx-4 mt-2 flex gap-1.5 overflow-x-auto px-4 pb-1">
          <FilterChip active={noFilter} onClick={clearAll}>
            すべて
          </FilterChip>
          {available.map((c) => (
            <FilterChip
              key={c}
              active={category === c}
              onClick={() => setCategory(category === c ? null : c)}
            >
              {c}
            </FilterChip>
          ))}
        </div>

        {/*
         * 2段目: 条件と器具。
         * 「いま作れる」を先頭に置く。買い物に行かずに済むかどうかが、
         * 夕方いちばん知りたいことだから。
         */}
        <div className="-mx-4 mt-1.5 flex gap-1.5 overflow-x-auto px-4 pb-1">
          <FilterChip
            active={readyOnly}
            onClick={() => setReadyOnly((v) => !v)}
            tone="emerald"
          >
            🥗 いま作れる {readyCount}
          </FilterChip>
          <FilterChip active={quickOnly} onClick={() => setQuickOnly((v) => !v)}>
            ⏱ {QUICK_MIN}分以内 {quickCount}
          </FilterChip>
          <FilterChip active={freezableOnly} onClick={() => setFreezableOnly((v) => !v)}>
            🧊 冷凍可
          </FilterChip>
          <FilterChip active={byTime} onClick={() => setByTime((v) => !v)} tone="slate">
            {byTime ? "時間が短い順" : "名前順"}
          </FilterChip>
          <span className="my-1 w-px shrink-0 bg-neutral-300 dark:bg-neutral-700" />
          {EQUIPMENT_LABELS.map((label) => (
            <FilterChip
              key={label}
              active={equipment === label}
              onClick={() => setEquipment(equipment === label ? null : label)}
            >
              {label} {equipmentCounts.get(label) ?? 0}
            </FilterChip>
          ))}
        </div>
      </ScreenHeader>

      <LoadNotice
        loading={loading && rows.length === 0}
        error={error}
        empty={filtered.length === 0}
        emptyText={
          readyOnly
            ? "いまの在庫だけで作れるレシピはありません。条件を外すか、買い物リストを見てください。"
            : "条件に合うレシピがありません。"
        }
      />

      <ul className="mt-3 divide-y divide-neutral-100 border-y border-neutral-200 bg-white dark:divide-neutral-800 dark:border-neutral-800 dark:bg-neutral-900">
        {filtered.map((r) => {
          const short = shortage.get(r.id);
          const equip = equipmentOf.get(r.id) ?? [];
          return (
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
                    {/*
                     * 在庫との突き合わせは【一番左】。ここだけ見れば
                     * 買い物に行かずに作れるかが分かる。
                     * 材料が未登録のレシピには何も出さない(嘘をつかないため)。
                     */}
                    {short && short.total > 0 && (
                      short.missing === 0 ? (
                        <Tag className="bg-emerald-100 font-bold text-emerald-900">いま作れる</Tag>
                      ) : (
                        <Tag className="bg-amber-100 text-amber-900">あと{short.missing}点</Tag>
                      )
                    )}
                    {r.category && <Tag>{r.category}</Tag>}
                    {r.protein && r.protein !== "なし" && <Tag>{r.protein}</Tag>}
                    {r.time_min != null && (
                      <Tag className={r.time_min <= QUICK_MIN ? "bg-sky-100 text-sky-900" : ""}>
                        {r.time_min}分
                      </Tag>
                    )}
                    {r.freezable && <Tag className="bg-cyan-100 text-cyan-900">冷凍可</Tag>}
                    {equip.map((e) => (
                      <Tag key={e} className="bg-violet-100 text-violet-900">
                        {e}
                      </Tag>
                    ))}
                  </span>
                </span>
                <svg viewBox="0 0 24 24" className="size-5 shrink-0 text-neutral-300" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path d="M9 5l7 7-7 7" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </Link>
            </li>
          );
        })}
      </ul>
    </main>
  );
}

function FilterChip({
  active,
  onClick,
  tone = "emerald",
  children,
}: {
  active: boolean;
  onClick: () => void;
  tone?: "emerald" | "slate";
  children: React.ReactNode;
}) {
  const on = tone === "slate" ? "bg-neutral-700 text-white" : "bg-emerald-600 text-white";
  return (
    <button
      type="button"
      onClick={onClick}
      className={`h-9 shrink-0 whitespace-nowrap rounded-full px-3.5 text-xs font-bold transition-colors ${
        active ? on : "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"
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
