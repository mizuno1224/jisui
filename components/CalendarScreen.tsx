"use client";

import Link from "next/link";
import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import { DaySheet } from "@/components/DaySheet";
import { EventSheet } from "@/components/EventSheet";
import { MonthGrid, type DayContent } from "@/components/MonthGrid";
import { ScreenHeader } from "@/components/ScreenHeader";
import {
  WEEKDAY_LABELS,
  addDays,
  addMonths,
  currentMonth,
  monthGrid,
  monthLabel,
  startOfWeek,
  todayISO,
  weekDates,
  weekRangeLabel,
  weekdayOf,
} from "@/lib/dates";
import { labelStyle, occursOn } from "@/lib/event-labels";
import { getServerSnapshot, getSnapshot, subscribe } from "@/lib/store";
import { useTable } from "@/lib/use-table";
import type { CalendarEvent, Chore, ChoreLog, MealPlan, Recipe } from "@/lib/types";

type View = "月" | "週";

/**
 * カレンダー。献立・予定・家事を1つの面で見る。
 *
 * 既定は月表示。「来週の土曜どうする?」という相談は前後の週を跨いで
 * 見えないと成り立たないため。週表示は、今週やることを潰していくとき用に残す。
 */
export function CalendarScreen() {
  const session = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const [view, setView] = useState<View>("月");
  const [month, setMonth] = useState(currentMonth());
  const [weekStart, setWeekStart] = useState(() => startOfWeek(todayISO()));
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [sheetDate, setSheetDate] = useState<string | null>(null);
  const [editing, setEditing] = useState<CalendarEvent | null>(null);

  const plans = useTable<MealPlan>("meal_plan");
  const recipes = useTable<Recipe>("recipes", { orderBy: "name" });
  const events = useTable<CalendarEvent>("events");
  const chores = useTable<Chore>("chores");
  const choreLogs = useTable<ChoreLog>("chore_log");

  const today = todayISO();
  const recipeById = useMemo(() => new Map(recipes.rows.map((r) => [r.id, r])), [recipes.rows]);
  const doneKeys = useMemo(
    () => new Set(choreLogs.rows.map((l) => `${l.chore_id}_${l.date}`)),
    [choreLogs.rows],
  );

  const memberLabel = useCallback(
    (userId: string | null) => {
      if (!userId) return "2人";
      if (userId === session.userId) return "自分";
      return session.members[userId] ?? "パートナー";
    },
    [session.userId, session.members],
  );

  /** その日にやる家事。曜日指定と毎月n日指定の両方を見る。 */
  const choresFor = useCallback(
    (iso: string) => {
      const wd = weekdayOf(iso);
      const dayOfMonth = Number(iso.slice(8, 10));
      return chores.rows.filter((c) => {
        if (!c.active) return false;
        if (c.weekdays?.length) return c.weekdays.includes(wd);
        if (c.monthday != null) return c.monthday === dayOfMonth;
        return false;
      });
    },
    [chores.rows],
  );

  const contentOf = useCallback(
    (iso: string): DayContent => {
      const dayChores = choresFor(iso);
      return {
        // 繰り返す予定はサーバに1本だけ持ち、ここで日付に当てて広げる
        events: events.rows
          .filter((e) => occursOn(e, iso))
          .sort((a, b) => (a.start_time ?? "99").localeCompare(b.start_time ?? "99")),
        meals: plans.rows.filter((p) => p.date === iso && p.status !== "中止"),
        choreCount: dayChores.length,
        choreDone: dayChores.filter((c) => doneKeys.has(`${c.id}_${iso}`)).length,
      };
    },
    [events.rows, plans.rows, choresFor, doneKeys],
  );

  const refresh = () => {
    events.refetch();
    plans.refetch();
    choreLogs.refetch();
  };

  const weekDays = useMemo(() => weekDates(weekStart), [weekStart]);
  const monthDays = useMemo(() => monthGrid(month), [month]);
  const upcomingCount = useMemo(() => {
    const range = view === "月" ? monthDays : weekDays;
    return range.filter((d) => d >= today).reduce((n, d) => n + contentOf(d).events.length, 0);
  }, [view, monthDays, weekDays, today, contentOf]);

  const goToday = () => {
    setMonth(currentMonth());
    setWeekStart(startOfWeek(today));
    setSelectedDay(today);
  };

  return (
    <main className="min-h-dvh bg-neutral-50 pb-44 dark:bg-neutral-950">
      <ScreenHeader
        title="予定"
        subtitle={
          <span className="text-xl">
            {view === "月" ? monthLabel(month) : weekRangeLabel(weekStart)}
          </span>
        }
        right={
          <Link
            href="/plan/chores"
            className="flex h-10 items-center rounded-xl bg-neutral-100 px-3 text-xs font-bold text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"
          >
            家事の設定
          </Link>
        }
      >
        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            aria-label="前へ"
            onClick={() =>
              view === "月" ? setMonth(addMonths(month, -1)) : setWeekStart(addDays(weekStart, -7))
            }
            className="h-11 w-11 shrink-0 rounded-xl bg-neutral-100 text-lg font-bold text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"
          >
            ‹
          </button>
          <button
            type="button"
            onClick={goToday}
            className="h-11 flex-1 rounded-xl bg-neutral-100 text-sm font-bold text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"
          >
            今日
          </button>
          <button
            type="button"
            aria-label="次へ"
            onClick={() =>
              view === "月" ? setMonth(addMonths(month, 1)) : setWeekStart(addDays(weekStart, 7))
            }
            className="h-11 w-11 shrink-0 rounded-xl bg-neutral-100 text-lg font-bold text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"
          >
            ›
          </button>
          <div className="ml-1 flex shrink-0 gap-1 rounded-xl bg-neutral-100 p-1 dark:bg-neutral-800">
            {(["月", "週"] as View[]).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setView(v)}
                className={`h-9 w-9 rounded-lg text-sm font-bold ${
                  view === v
                    ? "bg-white text-neutral-900 shadow-sm dark:bg-neutral-700 dark:text-neutral-50"
                    : "text-neutral-500"
                }`}
              >
                {v}
              </button>
            ))}
          </div>
        </div>
        <p className="mt-1.5 text-[11px] text-neutral-500 dark:text-neutral-400">
          これからの予定 {upcomingCount} 件 · 日付をタップすると中身が出ます
        </p>
      </ScreenHeader>

      {view === "月" ? (
        <div className="mt-3">
          <MonthGrid
            month={month}
            contentOf={contentOf}
            onSelect={setSelectedDay}
            selected={selectedDay}
          />
        </div>
      ) : (
        <div className="mt-3 space-y-2 px-3">
          {weekDays.map((iso) => {
            const { events: dayEvents, meals, choreCount, choreDone } = contentOf(iso);
            const wd = weekdayOf(iso);
            const isToday = iso === today;
            return (
              <button
                key={iso}
                type="button"
                onClick={() => setSelectedDay(iso)}
                className={`w-full overflow-hidden rounded-2xl border bg-white p-3 text-left dark:bg-neutral-900 ${
                  isToday
                    ? "border-emerald-500 ring-1 ring-emerald-500"
                    : "border-neutral-200 dark:border-neutral-800"
                }`}
              >
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
                  {choreCount > 0 && (
                    <span className="ml-auto text-[11px] text-neutral-500 dark:text-neutral-400">
                      🧹 {choreDone}/{choreCount}
                    </span>
                  )}
                </div>

                {meals.length === 0 && dayEvents.length === 0 ? (
                  <p className="mt-1 text-xs text-neutral-400 dark:text-neutral-600">予定なし</p>
                ) : (
                  <div className="mt-1.5 space-y-1">
                    {meals.map((m) => (
                      <p key={`m${m.id}`} className="truncate text-sm">
                        🍽 {m.name ?? "(未定)"}
                        {m.status === "実施" && (
                          <span className="ml-1 text-[10px] font-bold text-emerald-600">実施</span>
                        )}
                      </p>
                    ))}
                    {dayEvents.map((e) => (
                      <p key={`e${e.id}`} className="flex items-center gap-1.5 truncate text-sm">
                        <span className={`size-2 shrink-0 rounded-full ${labelStyle(e.label).bar}`} />
                        {e.start_time && (
                          <span className="shrink-0 text-xs tabular-nums text-neutral-500 dark:text-neutral-400">
                            {e.start_time.slice(0, 5)}
                          </span>
                        )}
                        <span className="truncate">{e.title}</span>
                        <span className="shrink-0 text-[11px] text-neutral-500 dark:text-neutral-400">
                          {memberLabel(e.owner_id)}
                        </span>
                      </p>
                    ))}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      )}

      <button
        type="button"
        aria-label="予定を追加"
        onClick={() => {
          setEditing(null);
          setSheetDate(selectedDay ?? today);
        }}
        className="fixed bottom-[calc(env(safe-area-inset-bottom)+4.75rem)] right-5 z-40 flex size-16 items-center justify-center rounded-full bg-emerald-600 text-white shadow-lg active:bg-emerald-700"
      >
        <svg viewBox="0 0 24 24" className="size-8" fill="none" stroke="currentColor" strokeWidth={2.5}>
          <path d="M12 5v14M5 12h14" strokeLinecap="round" />
        </svg>
      </button>

      {selectedDay && !sheetDate && (
        <DaySheet
          date={selectedDay}
          meals={contentOf(selectedDay).meals}
          events={contentOf(selectedDay).events}
          chores={choresFor(selectedDay)}
          doneKeys={doneKeys}
          recipeById={recipeById}
          memberLabel={memberLabel}
          onClose={() => setSelectedDay(null)}
          onAdd={() => {
            setEditing(null);
            setSheetDate(selectedDay);
          }}
          onEditEvent={(e) => {
            setEditing(e);
            setSheetDate(e.date);
          }}
          onChanged={refresh}
        />
      )}

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
            refresh();
          }}
        />
      )}
    </main>
  );
}
