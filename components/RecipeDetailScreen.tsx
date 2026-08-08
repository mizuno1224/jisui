"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Markdown } from "@/components/Markdown";
import { todayISO } from "@/lib/dates";
import {
  getServerSnapshot as invServer,
  getSnapshot as invSnapshot,
  init as initInventory,
  subscribe as subscribeInventory,
} from "@/lib/inventory-store";
import { guessSection, looseMatch } from "@/lib/matching";
import { markCooked } from "@/lib/mutations";
import { useWakeLock } from "@/lib/use-wake-lock";
import { addItem as addShoppingItem } from "@/lib/store";
import { useTable } from "@/lib/use-table";
import type { Recipe, RecipeIngredient } from "@/lib/types";

type PantryRow = { id: number; name: string; stock: string };

/** 任意の材料は、無くても料理は成立するので「足りない」とは言わない。 */
type Availability = "在庫あり" | "常備品" | "足りない" | "任意";

export function RecipeDetailScreen({ recipeId }: { recipeId: number }) {
  const recipes = useTable<Recipe>("recipes");
  const ingredients = useTable<RecipeIngredient>("recipe_ingredients");
  const pantry = useTable<PantryRow>("pantry");

  const inventory = useSyncExternalStore(subscribeInventory, invSnapshot, invServer);
  useEffect(() => {
    void initInventory();
  }, []);

  // 待ち時間の多い工程を見ている間、画面を消さない。
  // 濡れた手では解錠できず、読んでいた工程を毎回探し直すことになる。
  const wakeLock = useWakeLock();

  const [added, setAdded] = useState(false);
  const [cooked, setCooked] = useState<"idle" | "saving" | "done" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);

  const recipe = recipes.rows.find((r) => r.id === recipeId);
  const mine = useMemo(
    () => ingredients.rows.filter((i) => i.recipe_id === recipeId),
    [ingredients.rows, recipeId],
  );

  /**
   * 材料ごとに、家にあるかを見る。
   * 常備品(調味料など)は買い物リストに載せない決まりなので別扱いにする(設計書5)。
   */
  const checked = useMemo(() => {
    return mine.map((ing) => {
      // 0個の行は「在庫あり」と数えない。切らしているのに買い物リストへ載らなかった
      const inStock = inventory.items.some(
        (inv) => (inv.qty ?? 1) > 0 && looseMatch(inv.name, ing.name),
      );
      if (inStock) return { ing, state: "在庫あり" as Availability };
      const staple = pantry.rows.some(
        (p) => looseMatch(p.name, ing.name) && p.stock !== "切れた",
      );
      if (staple) return { ing, state: "常備品" as Availability };
      return { ing, state: (ing.optional ? "任意" : "足りない") as Availability };
    });
  }, [mine, inventory.items, pantry.rows]);

  const missing = checked.filter((c) => c.state === "足りない" && !c.ing.optional);

  if (recipes.loading && !recipe) {
    return <main className="flex min-h-dvh items-center justify-center text-sm text-neutral-500 dark:text-neutral-400">読み込み中…</main>;
  }
  if (!recipe) {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-8 text-center">
        <p className="text-sm text-neutral-500">レシピが見つかりませんでした。</p>
        <Link href="/recipes" className="text-sm font-semibold text-emerald-700 underline">
          レシピ一覧に戻る
        </Link>
      </main>
    );
  }

  const addMissing = async () => {
    for (const m of missing) {
      await addShoppingItem({
        item: m.ing.name,
        qty: m.ing.qty ? `${m.ing.qty}${m.ing.unit ?? ""}` : null,
        section: guessSection(m.ing.name),
        reason: `${recipe.name}用`,
      });
    }
    setAdded(true);
  };

  const recordCooking = async () => {
    setCooked("saving");
    try {
      // 献立側の「作った」と同じ処理を通す。
      // 別々だったせいで家計の「1食あたり」が永久に出なかった。
      await markCooked({ recipeId: recipe.id, name: recipe.name, date: todayISO() });
      setCooked("done");
    } catch (e) {
      setCooked("error");
      setMessage(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <main className="min-h-dvh bg-white pb-44 dark:bg-neutral-950">
      <header className="sticky top-0 z-30 border-b border-neutral-200 bg-white/95 px-4 pt-[calc(env(safe-area-inset-top)+0.5rem)] pb-3 backdrop-blur dark:border-neutral-800 dark:bg-neutral-900/95">
        <Link
          href="/recipes"
          className="-ml-2 inline-flex h-9 items-center gap-1 rounded-lg px-2 text-sm text-neutral-500 active:bg-neutral-100 dark:active:bg-neutral-800"
        >
          <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth={2.5}>
            <path d="M15 5l-7 7 7 7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          レシピ
        </Link>
        <div className="mt-0.5 flex items-start justify-between gap-2">
          <h1 className="text-xl font-bold leading-tight">{recipe.name}</h1>
          {wakeLock.supported && (
            <button
              type="button"
              onClick={wakeLock.toggle}
              className={`h-9 shrink-0 rounded-lg px-2.5 text-[11px] font-bold ${
                wakeLock.enabled
                  ? "bg-emerald-100 text-emerald-800"
                  : "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"
              }`}
            >
              {wakeLock.enabled ? "画面ON" : "画面を消さない"}
            </button>
          )}
        </div>
        <div className="mt-1.5 flex flex-wrap gap-1.5 text-[11px] text-neutral-600 dark:text-neutral-300">
          {recipe.category && <Chip>{recipe.category}</Chip>}
          {recipe.protein && recipe.protein !== "なし" && <Chip>{recipe.protein}</Chip>}
          {recipe.time_min != null && <Chip>約{recipe.time_min}分</Chip>}
          {recipe.freezable && <Chip className="bg-cyan-100 text-cyan-900">冷凍可</Chip>}
        </div>
      </header>

      {/* 作り始める前に見たいのは「家にあるか」なので、カード本文より上に置く */}
      <section className="border-b border-neutral-200 bg-neutral-50 px-4 py-4 dark:border-neutral-800 dark:bg-neutral-900">
        <h2 className="text-xs font-bold tracking-wide text-neutral-500">材料と在庫</h2>
        <ul className="mt-2 space-y-1.5">
          {checked.map(({ ing, state }) => (
            <li key={ing.id} className="flex min-h-11 items-center gap-2 text-sm">
              <StateMark state={state} />
              <span className={`flex-1 ${state === "足りない" ? "font-semibold" : ""}`}>
                {ing.name}
              </span>
              {/* 調理台に置いて離れた位置から拾い読みする数字。桁を縦に揃える */}
              <span className="shrink-0 text-base font-semibold tabular-nums text-neutral-800 dark:text-neutral-100">
                {ing.qty ?? ""}
                {ing.unit ?? ""}
              </span>
            </li>
          ))}
        </ul>

        {missing.length > 0 ? (
          <button
            type="button"
            onClick={() => void addMissing()}
            disabled={added}
            className="mt-3 h-12 w-full rounded-xl bg-emerald-600 text-sm font-bold text-white disabled:bg-neutral-200 disabled:text-neutral-500 dark:disabled:bg-neutral-800"
          >
            {added ? "買い物リストに追加しました" : `足りない ${missing.length} 点を買い物リストへ`}
          </button>
        ) : (
          <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-center text-sm font-semibold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">
            材料はすべて家にあります
          </p>
        )}
      </section>

      {recipe.card_md ? (
        <div className="px-4 py-2">
          <Markdown>{recipe.card_md}</Markdown>
        </div>
      ) : (
        <p className="px-6 py-16 text-center text-sm text-neutral-500 dark:text-neutral-400">
          このレシピにはまだ手順カードがありません。
        </p>
      )}

      {recipe.freeze_notes && (
        <section className="mx-4 mt-2 rounded-xl bg-cyan-50 px-4 py-3 text-sm dark:bg-cyan-950/40">
          <h2 className="text-xs font-bold text-cyan-900 dark:text-cyan-200">冷凍のしかた</h2>
          <p className="mt-1 text-cyan-900 dark:text-cyan-100">{recipe.freeze_notes}</p>
        </section>
      )}

      <div className="mt-6 px-4">
        <button
          type="button"
          onClick={() => void recordCooking()}
          disabled={cooked === "saving" || cooked === "done"}
          className="h-14 w-full rounded-xl bg-neutral-900 text-base font-bold text-white disabled:opacity-40 dark:bg-neutral-100 dark:text-neutral-900"
        >
          {cooked === "done"
            ? "調理記録に残しました"
            : cooked === "saving"
              ? "保存中…"
              : "これを作った(記録する)"}
        </button>
        {cooked === "error" && <p className="mt-2 text-sm text-rose-600">{message}</p>}
        <p className="mt-2 text-center text-xs text-neutral-500 dark:text-neutral-400">
          記録すると、献立の提案で「最近作ったもの」として避けられます
        </p>
      </div>
    </main>
  );
}

function StateMark({ state }: { state: Availability }) {
  if (state === "在庫あり")
    return <span className="w-14 shrink-0 rounded bg-emerald-100 px-1 py-0.5 text-center text-[10px] font-bold text-emerald-800">在庫あり</span>;
  if (state === "常備品")
    return <span className="w-14 shrink-0 rounded bg-neutral-200 px-1 py-0.5 text-center text-[10px] font-bold text-neutral-600 dark:bg-neutral-700 dark:text-neutral-300">常備品</span>;
  if (state === "任意")
    return <span className="w-14 shrink-0 rounded bg-neutral-100 px-1 py-0.5 text-center text-[10px] font-bold text-neutral-400 dark:bg-neutral-800">任意</span>;
  return <span className="w-14 shrink-0 rounded bg-rose-100 px-1 py-0.5 text-center text-[10px] font-bold text-rose-800">足りない</span>;
}

function Chip({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={`rounded px-1.5 py-0.5 ${className || "bg-neutral-100 dark:bg-neutral-800"}`}>
      {children}
    </span>
  );
}
