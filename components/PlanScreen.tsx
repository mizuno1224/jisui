"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { LoadNotice, ScreenHeader } from "@/components/ScreenHeader";
import { formatDate, relativeDay, todayISO } from "@/lib/dates";
import { addMealPlan, deleteMealPlan, setMealStatus } from "@/lib/mutations";
import { useTable } from "@/lib/use-table";
import type { CookLog, MealPlan, Recipe } from "@/lib/types";

export function PlanScreen() {
  const plans = useTable<MealPlan>("meal_plan", { orderBy: "date" });
  const recipes = useTable<Recipe>("recipes", { orderBy: "name" });
  const logs = useTable<CookLog>("cook_log", { orderBy: "date", ascending: false });

  const [addOpen, setAddOpen] = useState(false);
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0); // 書き込み後の再読込用

  const today = todayISO();
  const upcoming = useMemo(
    () => plans.rows.filter((p) => p.date >= today).sort((a, b) => a.date.localeCompare(b.date)),
    [plans.rows, today],
  );
  const past = useMemo(
    () => plans.rows.filter((p) => p.date < today).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 10),
    [plans.rows, today],
  );

  const recipeById = useMemo(
    () => new Map(recipes.rows.map((r) => [r.id, r])),
    [recipes.rows],
  );

  const run = async (id: number, fn: () => Promise<void>) => {
    setBusy(id);
    setError(null);
    try {
      await fn();
      setTick((t) => t + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <main key={tick} className="min-h-dvh bg-neutral-50 pb-44 dark:bg-neutral-950">
      <ScreenHeader
        title="献立"
        subtitle={
          <>
            これから {upcoming.length}
            <span className="text-base font-medium text-neutral-400"> 件</span>
          </>
        }
        right={
          <button
            type="button"
            onClick={() => setAddOpen(true)}
            className="h-10 rounded-xl bg-emerald-600 px-3 text-sm font-bold text-white"
          >
            + 追加
          </button>
        }
      />

      {error && (
        <p className="mx-4 mt-3 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:bg-rose-950/50 dark:text-rose-300">
          {error}
        </p>
      )}

      <LoadNotice
        loading={plans.loading && plans.rows.length === 0}
        error={plans.error}
        empty={upcoming.length === 0 && past.length === 0}
        emptyText="献立はまだありません。右上の + から追加できます。"
      />

      {upcoming.length > 0 && (
        <section className="mt-3">
          <h2 className="px-4 pb-1.5 text-xs font-bold text-neutral-500">これからの予定</h2>
          <ul className="divide-y divide-neutral-100 border-y border-neutral-200 bg-white dark:divide-neutral-800 dark:border-neutral-800 dark:bg-neutral-900">
            {upcoming.map((plan) => {
              const recipe = plan.recipe_id ? recipeById.get(plan.recipe_id) : undefined;
              const rel = relativeDay(plan.date);
              return (
                <li key={plan.id} className="px-4 py-3">
                  <div className="flex items-start gap-3">
                    <div className="w-16 shrink-0">
                      <div className={`text-sm font-bold ${rel === "今日" ? "text-emerald-600" : ""}`}>
                        {rel ?? formatDate(plan.date)}
                      </div>
                      {rel && <div className="text-[10px] text-neutral-400">{formatDate(plan.date)}</div>}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[16px] font-semibold leading-tight">
                          {plan.name ?? recipe?.name ?? "(未定)"}
                        </span>
                        {plan.status !== "予定" && (
                          <span
                            className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                              plan.status === "実施"
                                ? "bg-emerald-100 text-emerald-800"
                                : "bg-neutral-200 text-neutral-600"
                            }`}
                          >
                            {plan.status}
                          </span>
                        )}
                      </div>
                      {recipe && (
                        <Link
                          href={`/recipes/${recipe.id}`}
                          className="mt-0.5 inline-block text-xs font-semibold text-emerald-700 underline dark:text-emerald-400"
                        >
                          レシピを見る
                        </Link>
                      )}
                    </div>
                  </div>

                  {plan.status === "予定" && (
                    <div className="mt-2 flex gap-2">
                      <button
                        type="button"
                        disabled={busy === plan.id}
                        onClick={() => void run(plan.id, () => setMealStatus(plan.id, "実施"))}
                        className="h-11 flex-1 rounded-xl bg-emerald-50 text-sm font-bold text-emerald-700 disabled:opacity-40 dark:bg-emerald-950/50 dark:text-emerald-300"
                      >
                        作った
                      </button>
                      <button
                        type="button"
                        disabled={busy === plan.id}
                        onClick={() => void run(plan.id, () => setMealStatus(plan.id, "中止"))}
                        className="h-11 flex-1 rounded-xl bg-neutral-100 text-sm font-semibold text-neutral-600 disabled:opacity-40 dark:bg-neutral-800 dark:text-neutral-300"
                      >
                        やめた
                      </button>
                      <button
                        type="button"
                        aria-label="削除"
                        disabled={busy === plan.id}
                        onClick={() => void run(plan.id, () => deleteMealPlan(plan.id))}
                        className="h-11 w-11 rounded-xl bg-neutral-100 text-neutral-400 disabled:opacity-40 dark:bg-neutral-800"
                      >
                        ×
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {past.length > 0 && (
        <section className="mt-5">
          <h2 className="px-4 pb-1.5 text-xs font-bold text-neutral-500">これまで</h2>
          <ul className="divide-y divide-neutral-100 border-y border-neutral-200 bg-white dark:divide-neutral-800 dark:border-neutral-800 dark:bg-neutral-900">
            {past.map((plan) => (
              <li key={plan.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                <span className="w-16 shrink-0 text-xs text-neutral-400">{formatDate(plan.date)}</span>
                <span className="min-w-0 flex-1 truncate">{plan.name ?? "(未定)"}</span>
                <span className="shrink-0 text-[10px] text-neutral-400">{plan.status}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {logs.rows.length > 0 && (
        <section className="mt-5">
          <h2 className="px-4 pb-1.5 text-xs font-bold text-neutral-500">
            調理の記録({logs.rows.length}回)
          </h2>
          <ul className="divide-y divide-neutral-100 border-y border-neutral-200 bg-white dark:divide-neutral-800 dark:border-neutral-800 dark:bg-neutral-900">
            {logs.rows.slice(0, 15).map((log) => (
              <li key={log.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                <span className="w-16 shrink-0 text-xs text-neutral-400">{formatDate(log.date)}</span>
                <span className="min-w-0 flex-1 truncate">{log.name ?? "(記録)"}</span>
                {log.batch && (
                  <span className="shrink-0 rounded bg-cyan-100 px-1.5 py-0.5 text-[10px] font-bold text-cyan-900">
                    まとめ調理
                  </span>
                )}
              </li>
            ))}
          </ul>
          <p className="px-4 pt-2 text-xs text-neutral-400">
            この記録が、献立提案で「最近作ったもの」を避ける材料になります
          </p>
        </section>
      )}

      {addOpen && (
        <AddPlanSheet
          recipes={recipes.rows}
          onClose={() => setAddOpen(false)}
          onSaved={() => {
            setAddOpen(false);
            setTick((t) => t + 1);
          }}
        />
      )}
    </main>
  );
}

function AddPlanSheet({
  recipes,
  onClose,
  onSaved,
}: {
  recipes: Recipe[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [date, setDate] = useState(todayISO());
  const [recipeId, setRecipeId] = useState<string>("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const chosen = recipes.find((r) => String(r.id) === recipeId);
  const finalName = chosen?.name ?? name.trim();

  const submit = async () => {
    if (!finalName) return;
    setBusy(true);
    setError(null);
    try {
      await addMealPlan({
        date,
        recipeId: chosen?.id ?? null,
        name: finalName,
      });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <button type="button" aria-label="閉じる" onClick={onClose} className="absolute inset-0 bg-black/40" />
      <div className="relative rounded-t-2xl bg-white px-4 pt-4 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] dark:bg-neutral-900">
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-neutral-300 dark:bg-neutral-600" />
        <h2 className="mb-3 text-base font-bold">献立を追加</h2>

        <label className="block text-xs font-medium text-neutral-500">日付</label>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="mt-1 h-12 w-full rounded-xl border border-neutral-300 bg-white px-3 text-base dark:border-neutral-700 dark:bg-neutral-800"
        />

        <label className="mt-3 block text-xs font-medium text-neutral-500">登録済みのレシピから</label>
        <select
          value={recipeId}
          onChange={(e) => setRecipeId(e.target.value)}
          className="mt-1 h-12 w-full rounded-xl border border-neutral-300 bg-white px-3 text-base dark:border-neutral-700 dark:bg-neutral-800"
        >
          <option value="">選ばない(自由入力)</option>
          {recipes.map((r) => (
            <option key={r.id} value={String(r.id)}>
              {r.name}
            </option>
          ))}
        </select>

        {!chosen && (
          <>
            <label className="mt-3 block text-xs font-medium text-neutral-500">献立名</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例: 外食 / 冷凍弁当の残り"
              className="mt-1 h-12 w-full rounded-xl border border-neutral-300 bg-white px-3 text-base dark:border-neutral-700 dark:bg-neutral-800"
            />
          </>
        )}

        {error && <p className="mt-3 text-sm text-rose-600">{error}</p>}

        <div className="mt-5 flex gap-3">
          <button
            type="button"
            onClick={onClose}
            className="h-14 flex-1 rounded-xl bg-neutral-100 text-base font-semibold text-neutral-700 dark:bg-neutral-800 dark:text-neutral-200"
          >
            やめる
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={busy || !finalName}
            className="h-14 flex-[2] rounded-xl bg-emerald-600 text-base font-bold text-white disabled:opacity-40"
          >
            {busy ? "保存中…" : "追加する"}
          </button>
        </div>
      </div>
    </div>
  );
}
