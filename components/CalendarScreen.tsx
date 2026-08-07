"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ScreenHeader } from "@/components/ScreenHeader";
import { EventSheet } from "@/components/EventSheet";
import {
  WEEKDAY_LABELS,
  addDays,
  startOfWeek,
  todayISO,
  weekDates,
  weekRangeLabel,
  weekdayOf,
} from "@/lib/dates";
import { setMealStatus, toggleChoreDone } from "@/lib/mutations";
import { getServerSnapshot, getSnapshot, subscribe } from "@/lib/store";
import { useTable } from "@/lib/use-table";
import type { CalendarEvent, Chore, ChoreLog, MealPlan, Recipe } from "@/lib/types";

/**
 * 週間カレンダー。献立・予定・家事を1つの流れで見る。
 *
 * 7列のグリッドにせず、日ごとに縦に積んでいる。
 * スマホの幅では1列あたり50pxしか取れず、料理名も予定名も読めなくなるため。
 */
export function CalendarScreen() {
  const session = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const [weekStart, setWeekStart] = useState(() => startOfWeek(todayISO()));
  const [sheetDate, setSheetDate] = useState<string | null>(null);
  const [editing, setEditing] = useState<CalendarEvent | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 往復を待たずに丸を付ける。押しても何も起きないと二度押ししてしまい、
  // chore_log を insert→delete して記録が消えるため。
  const [choreOverride, setChoreOverride] = useState<Record<string, boolean>>({});
  const [busyChore, setBusyChore] = useState<string | null>(null);

  const plans = useTable<MealPlan>("meal_plan");
  const recipes = useTable<Recipe>("recipes");
  const events = useTable<CalendarEvent>("events");
  const chores = useTable<Chore>("chores");
  const choreLogs = useTable<ChoreLog>("chore_log");

  const days = useMemo(() => weekDates(weekStart), [weekStart]);
  const today = todayISO();
  const todayRef = useRef<HTMLElement>(null);

  // 週の頭は日曜なので、そのままだと今日が画面の下に隠れる。
  // 今週を開いたときだけ、今日の位置まで送る(前後の週を見るときは邪魔しない)。
  useEffect(() => {
    if (weekStart !== startOfWeek(today)) return;
    const id = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        todayRef.current?.scrollIntoView({ block: "center" });
      });
    });
    return () => cancelAnimationFrame(id);
  }, [weekStart, today, plans.rows.length, events.rows.length, chores.rows.length]);

  const recipeById = useMemo(() => new Map(recipes.rows.map((r) => [r.id, r])), [recipes.rows]);
  const doneBy = useMemo(() => {
    const map = new Map<string, string | null>();
    for (const l of choreLogs.rows) map.set(`${l.chore_id}_${l.date}`, l.done_by);
    return map;
  }, [choreLogs.rows]);

  const memberLabel = (userId: string | null) => {
    if (!userId) return "2人";
    if (userId === session.userId) return "自分";
    return session.members[userId] ?? "パートナー";
  };

  /** その日にやる家事。曜日指定と毎月n日指定の両方を見る。 */
  const choresFor = (iso: string) => {
    const wd = weekdayOf(iso);
    const dayOfMonth = Number(iso.slice(8, 10));
    return chores.rows.filter((c) => {
      if (!c.active) return false;
      if (c.weekdays?.length) return c.weekdays.includes(wd);
      if (c.monthday != null) return c.monthday === dayOfMonth;
      return false;
    });
  };

  const run = async (fn: () => Promise<void>, after?: () => void) => {
    setError(null);
    try {
      await fn();
      after?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const toggleChore = async (choreId: number, iso: string, next: boolean) => {
    const key = `${choreId}_${iso}`;
    if (busyChore === key) return;
    setBusyChore(key);
    setChoreOverride((prev) => ({ ...prev, [key]: next }));
    try {
      await toggleChoreDone(choreId, iso, next);
      choreLogs.refetch();
    } catch (e) {
      // 失敗したら見た目を戻す。押したのに残っていない、を防ぐ
      setChoreOverride((prev) => {
        const copy = { ...prev };
        delete copy[key];
        return copy;
      });
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyChore(null);
    }
  };

  return (
    <main className="min-h-dvh bg-neutral-50 pb-44 dark:bg-neutral-950">
      <ScreenHeader
        title="予定"
        subtitle={<span className="text-xl">{weekRangeLabel(weekStart)}</span>}
        right={
          <Link
            href="/plan/chores"
            className="flex h-10 items-center rounded-xl bg-neutral-100 px-3 text-xs font-bold text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"
          >
            家事の設定
          </Link>
        }
      >
        <div className="mt-2 flex gap-2">
          <button
            type="button"
            onClick={() => setWeekStart(addDays(weekStart, -7))}
            className="h-10 flex-1 rounded-xl bg-neutral-100 text-sm font-bold text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"
          >
            ← 前の週
          </button>
          <button
            type="button"
            onClick={() => setWeekStart(startOfWeek(today))}
            className="h-10 flex-1 rounded-xl bg-neutral-100 text-sm font-bold text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"
          >
            今週
          </button>
          <button
            type="button"
            onClick={() => setWeekStart(addDays(weekStart, 7))}
            className="h-10 flex-1 rounded-xl bg-neutral-100 text-sm font-bold text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"
          >
            次の週 →
          </button>
        </div>
      </ScreenHeader>

      {error && (
        <p className="mx-4 mt-3 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:bg-rose-950/50 dark:text-rose-300">
          {error}
        </p>
      )}

      <div className="mt-3 space-y-2 px-3">
        {days.map((iso) => {
          const wd = weekdayOf(iso);
          const isToday = iso === today;
          const dayPlans = plans.rows.filter((p) => p.date === iso && p.status !== "中止");
          const dayEvents = events.rows.filter(
            (e) => e.date <= iso && (e.end_date ?? e.date) >= iso,
          );
          const dayChores = choresFor(iso);

          return (
            <section
              key={iso}
              ref={isToday ? todayRef : undefined}
              className={`overflow-hidden rounded-2xl border bg-white dark:bg-neutral-900 ${
                isToday
                  ? "border-emerald-500 ring-1 ring-emerald-500"
                  : "border-neutral-200 dark:border-neutral-800"
              }`}
            >
              <div className="flex items-center justify-between px-3 py-2">
                <div className="flex items-baseline gap-2">
                  <span
                    className={`text-base font-bold ${
                      wd === 0 ? "text-rose-600" : wd === 6 ? "text-sky-600" : ""
                    }`}
                  >
                    {Number(iso.slice(5, 7))}/{Number(iso.slice(8, 10))}
                    <span className="ml-1 text-xs">({WEEKDAY_LABELS[wd]})</span>
                  </span>
                  {isToday && (
                    <span className="rounded bg-emerald-600 px-1.5 py-0.5 text-[10px] font-bold text-white">
                      今日
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  aria-label={`${iso} に追加`}
                  onClick={() => {
                    setEditing(null);
                    setSheetDate(iso);
                  }}
                  className="flex size-9 items-center justify-center rounded-full bg-neutral-100 text-lg font-bold text-neutral-500 dark:bg-neutral-800"
                >
                  ＋
                </button>
              </div>

              {dayPlans.length === 0 && dayEvents.length === 0 && dayChores.length === 0 ? (
                <p className="px-3 pb-3 text-xs text-neutral-300 dark:text-neutral-600">予定なし</p>
              ) : (
                <ul className="divide-y divide-neutral-100 border-t border-neutral-100 dark:divide-neutral-800 dark:border-neutral-800">
                  {dayPlans.map((plan) => {
                    const recipe = plan.recipe_id ? recipeById.get(plan.recipe_id) : undefined;
                    return (
                      <li key={`m${plan.id}`} className="flex items-center gap-2 px-3 py-2.5">
                        <span className="w-5 shrink-0 text-center">🍽</span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold">
                            {plan.name ?? recipe?.name ?? "(未定)"}
                          </span>
                          {recipe && (
                            <Link
                              href={`/recipes/${recipe.id}`}
                              className="text-[11px] font-semibold text-emerald-700 underline dark:text-emerald-400"
                            >
                              レシピ
                            </Link>
                          )}
                        </span>
                        {plan.status === "予定" ? (
                          <button
                            type="button"
                            onClick={() => void run(() => setMealStatus(plan.id, "実施"), plans.refetch)}
                            className="h-9 shrink-0 rounded-lg bg-emerald-50 px-3 text-xs font-bold text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"
                          >
                            作った
                          </button>
                        ) : (
                          <span className="shrink-0 text-[10px] font-bold text-emerald-600">実施</span>
                        )}
                      </li>
                    );
                  })}

                  {dayEvents.map((ev) => (
                    <li key={`e${ev.id}`}>
                      <button
                        type="button"
                        onClick={() => {
                          setEditing(ev);
                          setSheetDate(ev.date);
                        }}
                        className="flex w-full items-center gap-2 px-3 py-2.5 text-left active:bg-neutral-50 dark:active:bg-neutral-800"
                      >
                        <span className="w-5 shrink-0 text-center">📅</span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold">{ev.title}</span>
                          {ev.memo && (
                            <span className="block truncate text-[11px] text-neutral-500">{ev.memo}</span>
                          )}
                        </span>
                        {ev.start_time && (
                          <span className="shrink-0 text-xs tabular-nums text-neutral-500">
                            {ev.start_time.slice(0, 5)}
                          </span>
                        )}
                        <span
                          className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold ${
                            ev.owner_id === null
                              ? "bg-violet-100 text-violet-800"
                              : ev.owner_id === session.userId
                                ? "bg-sky-100 text-sky-800"
                                : "bg-amber-100 text-amber-900"
                          }`}
                        >
                          {memberLabel(ev.owner_id)}
                        </span>
                      </button>
                    </li>
                  ))}

                  {dayChores.map((chore) => {
                    const key = `${chore.id}_${iso}`;
                    const done = choreOverride[key] ?? doneBy.has(key);
                    // 誰がやったかは記録した本人の名前を出す。担当より実績が知りたい
                    const actor = doneBy.get(key);
                    return (
                      <li key={`c${chore.id}`}>
                        <button
                          type="button"
                          role="checkbox"
                          aria-checked={done}
                          disabled={busyChore === key}
                          onClick={() => {
                            navigator.vibrate?.(8);
                            void toggleChore(chore.id, iso, !done);
                          }}
                          className="flex w-full items-center gap-2 px-3 py-2.5 text-left active:bg-neutral-50 dark:active:bg-neutral-800"
                        >
                          <span className="w-5 shrink-0 text-center">🧹</span>
                          <span
                            className={`min-w-0 flex-1 truncate text-sm ${
                              done ? "text-neutral-500 dark:text-neutral-400 line-through" : "font-semibold"
                            }`}
                          >
                            {chore.name}
                          </span>
                          <span className="shrink-0 text-[11px] text-neutral-500 dark:text-neutral-500 dark:text-neutral-400">
                            {done && actor !== undefined
                              ? `${memberLabel(actor)}がやった`
                              : chore.assignee_id
                                ? memberLabel(chore.assignee_id)
                                : ""}
                          </span>
                          <span
                            className={`flex size-6 shrink-0 items-center justify-center rounded-full border-2 ${
                              done ? "border-emerald-600 bg-emerald-600 text-white" : "border-neutral-300 dark:border-neutral-600"
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
              )}
            </section>
          );
        })}
      </div>

      {sheetDate && (
        <EventSheet
          date={sheetDate}
          existing={editing}
          recipes={recipes.rows}
          members={session.members}
          userId={session.userId}
          onClose={() => {
            setSheetDate(null);
            setEditing(null);
          }}
          onSaved={() => {
            setSheetDate(null);
            setEditing(null);
            events.refetch();
            plans.refetch();
          }}
        />
      )}
    </main>
  );
}
