"use client";

import Link from "next/link";
import { useState } from "react";
import { Sheet } from "@/components/Sheet";
import { formatDate, relativeDay } from "@/lib/dates";
import { labelStyle } from "@/lib/event-labels";
import { markCooked, toggleChoreDone } from "@/lib/mutations";
import type { CalendarEvent, Chore, MealPlan, Recipe } from "@/lib/types";

/**
 * その日の中身をまとめて見るシート。
 *
 * 月表示では1マスに全部は入らない。日をタップしたらここで
 * 献立・予定・家事を全部出し、その場で片付けられるようにする。
 */
export function DaySheet({
  date,
  meals,
  events,
  chores,
  doneKeys,
  recipeById,
  memberLabel,
  onClose,
  onAdd,
  onEditEvent,
  onChanged,
}: {
  date: string;
  meals: MealPlan[];
  events: CalendarEvent[];
  chores: Chore[];
  doneKeys: Set<string>;
  recipeById: Map<number, Recipe>;
  memberLabel: (id: string | null) => string;
  onClose: () => void;
  onAdd: () => void;
  onEditEvent: (event: CalendarEvent) => void;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [localDone, setLocalDone] = useState<Record<string, boolean>>({});

  const rel = relativeDay(date);
  const empty = meals.length === 0 && events.length === 0 && chores.length === 0;

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const toggleChore = async (chore: Chore) => {
    const key = `${chore.id}_${date}`;
    const next = !(localDone[key] ?? doneKeys.has(key));
    setLocalDone((p) => ({ ...p, [key]: next }));
    try {
      await toggleChoreDone(chore.id, date, next);
      onChanged();
    } catch (e) {
      setLocalDone((p) => {
        const c = { ...p };
        delete c[key];
        return c;
      });
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Sheet onClose={onClose}>
      <div className="flex items-baseline justify-between">
        <h2 className="text-base font-bold">
          {formatDate(date)}
          {rel && <span className="ml-2 text-sm text-emerald-600">{rel}</span>}
        </h2>
        <button
          type="button"
          onClick={onAdd}
          className="h-10 rounded-xl bg-emerald-600 px-3 text-sm font-bold text-white"
        >
          + 追加
        </button>
      </div>

      {error && <p className="mt-3 text-sm text-rose-600">{error}</p>}
      {empty && <p className="py-8 text-center text-sm text-neutral-500">予定はありません</p>}

      {meals.length > 0 && (
        <section className="mt-4">
          <h3 className="text-xs font-bold text-neutral-500">献立</h3>
          <ul className="mt-1 divide-y divide-neutral-100 dark:divide-neutral-800">
            {meals.map((m) => {
              const recipe = m.recipe_id ? recipeById.get(m.recipe_id) : undefined;
              return (
                <li key={m.id} className="flex items-center gap-2 py-2.5">
                  <span className="w-5 shrink-0 text-center">🍽</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">
                      {m.name ?? recipe?.name ?? "(未定)"}
                    </span>
                    {recipe && (
                      <Link
                        href={`/recipes/${recipe.id}`}
                        className="text-[11px] font-semibold text-emerald-700 underline dark:text-emerald-400"
                      >
                        レシピを見る
                      </Link>
                    )}
                  </span>
                  {m.status === "予定" ? (
                    <button
                      type="button"
                      disabled={busy === `m${m.id}`}
                      onClick={() =>
                        void run(`m${m.id}`, () =>
                          markCooked({
                            planId: m.id,
                            recipeId: m.recipe_id,
                            name: m.name ?? recipe?.name ?? "(記録)",
                            date,
                          }),
                        )
                      }
                      className="h-11 shrink-0 rounded-lg bg-emerald-50 px-3 text-xs font-bold text-emerald-700 disabled:opacity-40 dark:bg-emerald-950/50 dark:text-emerald-300"
                    >
                      作った
                    </button>
                  ) : (
                    <span className="shrink-0 text-[11px] font-bold text-emerald-600">
                      {m.status}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {events.length > 0 && (
        <section className="mt-4">
          <h3 className="text-xs font-bold text-neutral-500">予定</h3>
          <ul className="mt-1 divide-y divide-neutral-100 dark:divide-neutral-800">
            {events.map((e) => {
              const style = labelStyle(e.label);
              return (
                <li key={e.id}>
                  <button
                    type="button"
                    onClick={() => onEditEvent(e)}
                    className="flex w-full items-center gap-2 py-2.5 text-left"
                  >
                    <span className={`h-8 w-1 shrink-0 rounded-full ${style.bar}`} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{e.title}</span>
                      <span className="text-[11px] text-neutral-500 dark:text-neutral-400">
                        {e.start_time ? `${e.start_time.slice(0, 5)} · ` : ""}
                        {memberLabel(e.owner_id)}
                        {e.repeat && e.repeat !== "なし" ? ` · ${e.repeat}` : ""}
                        {e.memo ? ` · ${e.memo}` : ""}
                      </span>
                    </span>
                    <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold ${style.chip}`}>
                      {e.label ?? "予定"}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {chores.length > 0 && (
        <section className="mt-4">
          <h3 className="text-xs font-bold text-neutral-500">家事</h3>
          <ul className="mt-1 divide-y divide-neutral-100 dark:divide-neutral-800">
            {chores.map((c) => {
              const key = `${c.id}_${date}`;
              const done = localDone[key] ?? doneKeys.has(key);
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={done}
                    onClick={() => void toggleChore(c)}
                    className="flex w-full items-center gap-2 py-2.5 text-left"
                  >
                    <span className="w-5 shrink-0 text-center">🧹</span>
                    <span
                      className={`min-w-0 flex-1 truncate text-sm ${
                        done ? "text-neutral-400 line-through" : "font-semibold"
                      }`}
                    >
                      {c.name}
                    </span>
                    {c.assignee_id && (
                      <span className="shrink-0 text-[11px] text-neutral-500 dark:text-neutral-400">
                        {memberLabel(c.assignee_id)}
                      </span>
                    )}
                    <span
                      className={`flex size-6 shrink-0 items-center justify-center rounded-full border-2 ${
                        done
                          ? "border-emerald-600 bg-emerald-600 text-white"
                          : "border-neutral-300 dark:border-neutral-600"
                      }`}
                    >
                      {done && (
                        <svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth={4}>
                          <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </Sheet>
  );
}
