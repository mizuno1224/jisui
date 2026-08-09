"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { DaySheet } from "@/components/DaySheet";
import { EventSheet } from "@/components/EventSheet";
import { WeekRow, type DayContent, type EventWithTag } from "@/components/WeekRow";
import {
  BUFFER_ROWS,
  ROW_H,
  buildWeekStarts,
  monthOfWeek,
  weekIndexOf,
} from "@/lib/calendar-window";
import { WEEKDAY_LABELS, addDays, monthLabel, todayISO, weekdayOf } from "@/lib/dates";
import { occursOn } from "@/lib/event-labels";
import { getServerSnapshot, getSnapshot, subscribe } from "@/lib/store";
import { useTable } from "@/lib/use-table";
import type {
  CalendarEvent,
  CalendarTag,
  Chore,
  ChoreLog,
  MealPlan,
  Recipe,
} from "@/lib/types";

/**
 * カレンダー。献立・予定・家事を1つの面で見る。
 *
 * 【縦にずっと繋がっている】
 * 月をめくるのではなく、指で上下に送ると月が連続して切り替わる。
 * 「来週の土曜どうする?」は月をまたぐことが多く、めくる作りだと
 * 前後が同時に見えないため。
 *
 * 描いているのは画面に入る週の前後8週ぶんだけ。
 * 全部の週が同じ高さなので「何番目の週か × 高さ」が座標になり、
 * 描く範囲を入れ替えてもスクロール位置は1pxも動かない。
 * 詳しくは lib/calendar-window.ts を読むこと。
 */
export function CalendarScreen() {
  const session = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const today = todayISO();

  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [sheetDate, setSheetDate] = useState<string | null>(null);
  const [editing, setEditing] = useState<CalendarEvent | null>(null);

  const plans = useTable<MealPlan>("meal_plan");
  const recipes = useTable<Recipe>("recipes", { orderBy: "name" });
  const events = useTable<CalendarEvent>("events");
  const tags = useTable<CalendarTag>("calendar_tags", { orderBy: "sort_order" });
  const chores = useTable<Chore>("chores");
  const choreLogs = useTable<ChoreLog>("chore_log");

  // 週の並びは今日を基準に1回だけ作る。日付が変わるまで作り直さない。
  const weekStarts = useMemo(() => buildWeekStarts(today), [today]);
  const origin = weekStarts[0];
  const todayIndex = useMemo(() => weekIndexOf(origin, today), [origin, today]);

  const scroller = useRef<HTMLDivElement | null>(null);
  const ticking = useRef(false);
  const [range, setRange] = useState(() => ({
    from: Math.max(0, todayIndex - BUFFER_ROWS),
    to: todayIndex + BUFFER_ROWS + 8,
  }));
  const [visibleMonth, setVisibleMonth] = useState(() => monthOfWeek(weekStarts[todayIndex]));

  const recipeById = useMemo(() => new Map(recipes.rows.map((r) => [r.id, r])), [recipes.rows]);
  const tagById = useMemo(() => new Map(tags.rows.map((t) => [t.id, t])), [tags.rows]);
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

  /**
   * 日付ごとの中身を、日付をキーにした表にまとめておく。
   *
   * マスは1画面に50個以上あり、スクロールで次々に描き直される。
   * マスごとに events を全件走査していると、予定が増えたときに
   * 指の動きに付いてこなくなる。1回だけ配って、あとは引くだけにする。
   */
  const byDate = useMemo(() => {
    const map = new Map<string, DayContent>();
    const touch = (iso: string): DayContent => {
      let v = map.get(iso);
      if (!v) {
        v = { events: [], meals: [], choreCount: 0, choreDone: 0 };
        map.set(iso, v);
      }
      return v;
    };

    for (const p of plans.rows) {
      if (p.status === "中止") continue;
      touch(p.date).meals.push(p);
    }

    /*
     * 繰り返す予定はサーバに1本だけ持ち、ここで日付に当てて広げる。
     *
     * 繰り返さない予定は、その日(と終了日まで)に置くだけでよい。
     * 繰り返す予定だけは「どの日に当たるか」を1日ずつ確かめる必要があるので、
     * 【いま描いている範囲の週だけ】に絞る。10年ぶん全部を舐めると、
     * 毎週の家事が1本あるだけで数千回の判定になる。
     */
    const first = Math.max(0, range.from - 1);
    const last = Math.min(weekStarts.length - 1, range.to);

    for (const e of events.rows) {
      const withTag: EventWithTag = { ...e, tag: tagById.get(e.tag_id ?? -1) };
      const repeats = e.repeat != null && e.repeat !== "なし";

      if (!repeats) {
        const end = e.end_date ?? e.date;
        for (let d = e.date; d <= end; d = addDays(d, 1)) touch(d).events.push(withTag);
        continue;
      }

      for (let i = first; i <= last; i++) {
        for (let k = 0; k < 7; k++) {
          const iso = addDays(weekStarts[i], k);
          if (occursOn(e, iso)) touch(iso).events.push(withTag);
        }
      }
    }

    for (const list of map.values()) {
      list.events.sort((a, b) => (a.start_time ?? "99").localeCompare(b.start_time ?? "99"));
    }
    return map;
  }, [plans.rows, events.rows, tagById, weekStarts, range.from, range.to]);

  const EMPTY: DayContent = useMemo(
    () => ({ events: [], meals: [], choreCount: 0, choreDone: 0 }),
    [],
  );

  const contentOf = useCallback(
    (iso: string): DayContent => {
      const base = byDate.get(iso) ?? EMPTY;
      const dayChores = choresFor(iso);
      if (dayChores.length === 0) return base;
      return {
        ...base,
        choreCount: dayChores.length,
        choreDone: dayChores.filter((c) => doneKeys.has(`${c.id}_${iso}`)).length,
      };
    },
    [byDate, choresFor, doneKeys, EMPTY],
  );

  const refresh = () => {
    events.refetch();
    plans.refetch();
    choreLogs.refetch();
    tags.refetch();
  };

  // 開いたとき、今日の週が画面の上から2週目あたりに来るようにする
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    el.scrollTop = Math.max(0, (todayIndex - 1) * ROW_H);
  }, [todayIndex]);

  const onScroll = useCallback(() => {
    // スクロールは1秒に何十回も飛んでくる。毎回 setState すると指に付いてこない。
    // 1フレームに1回だけ計算する。
    if (ticking.current) return;
    ticking.current = true;
    requestAnimationFrame(() => {
      ticking.current = false;
      const el = scroller.current;
      if (!el) return;
      const first = Math.floor(el.scrollTop / ROW_H);
      const visible = Math.ceil(el.clientHeight / ROW_H);
      const from = Math.max(0, first - BUFFER_ROWS);
      const to = Math.min(weekStarts.length, first + visible + BUFFER_ROWS);
      setRange((r) => (r.from === from && r.to === to ? r : { from, to }));
      const m = monthOfWeek(weekStarts[Math.min(first, weekStarts.length - 1)]);
      setVisibleMonth((prev) => (prev === m ? prev : m));
    });
  }, [weekStarts]);

  const goToday = () => {
    const el = scroller.current;
    if (!el) return;
    el.scrollTo({ top: Math.max(0, (todayIndex - 1) * ROW_H), behavior: "smooth" });
  };

  // 画面の高さいっぱいまで使う。ヘッダーと下タブのぶんだけ引く。
  useEffect(() => {
    const el = scroller.current;
    if (el) onScroll();
  }, [onScroll]);

  const upcomingCount = useMemo(() => {
    let n = 0;
    for (const [iso, c] of byDate) if (iso >= today) n += c.events.length;
    return n;
  }, [byDate, today]);

  return (
    <main className="flex h-dvh flex-col bg-neutral-50 dark:bg-neutral-950">
      <header className="shrink-0 border-b border-neutral-200 bg-white px-3 pt-[calc(env(safe-area-inset-top)+0.5rem)] pb-1.5 dark:border-neutral-800 dark:bg-neutral-900">
        <div className="flex items-center gap-2">
          <h1 className="min-w-0 flex-1 truncate text-xl font-bold">
            {monthLabel(visibleMonth)}
            {upcomingCount > 0 && (
              <span className="ml-2 text-[11px] font-medium text-neutral-500 dark:text-neutral-400">
                これから {upcomingCount} 件
              </span>
            )}
          </h1>
          <button
            type="button"
            onClick={goToday}
            className="h-9 rounded-lg bg-neutral-100 px-3 text-xs font-bold text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"
          >
            今日
          </button>
          <Link
            href="/plan/todos"
            className="flex h-9 items-center rounded-lg bg-neutral-100 px-3 text-xs font-bold text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"
          >
            やること
          </Link>
          <Link
            href="/plan/chores"
            aria-label="家事の設定"
            className="flex h-9 items-center rounded-lg bg-neutral-100 px-2.5 text-xs font-bold text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"
          >
            🧹
          </Link>
        </div>

        {/* 曜日の見出しはスクロールの外に1つだけ置く(全部の週で同じなので) */}
        <div className="mt-1 grid grid-cols-7">
          {WEEKDAY_LABELS.map((w, i) => (
            <div
              key={w}
              className={`pb-0.5 text-center text-[11px] font-bold ${
                i === 0 ? "text-rose-600" : i === 6 ? "text-sky-600" : "text-neutral-500"
              }`}
            >
              {w}
            </div>
          ))}
        </div>
      </header>

      <div
        ref={scroller}
        onScroll={onScroll}
        /*
         * overflow-anchor:none が要る。
         * Android Chrome は「消えた要素のぶんスクロールを補正する」機能が
         * 既定で入っている。ここでは座標を自分で全部持っているので、
         * ブラウザの補正は数pxのズレを生むだけの邪魔になる。
         * (iOS Safari にはこの機能自体が無い。だから自前で持つのが唯一の共通解)
         */
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain [overflow-anchor:none]"
      >
        {/* 全期間ぶんの高さを持つ箱。中身は絶対配置なので入れ替えても動かない */}
        <div className="relative" style={{ height: weekStarts.length * ROW_H }}>
          {weekStarts.slice(range.from, range.to).map((ws, i) => (
            <WeekRow
              key={ws}
              weekStart={ws}
              contentOf={contentOf}
              today={today}
              selected={selectedDay}
              onSelect={setSelectedDay}
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                top: (range.from + i) * ROW_H,
                height: ROW_H,
              }}
            />
          ))}
        </div>
        {/* 下タブと被らないための余白 */}
        <div className="h-24" />
      </div>

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
          tagById={tagById}
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
          tags={tags.rows}
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
