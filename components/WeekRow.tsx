"use client";

import { Fragment, memo } from "react";
import { daysOfWeek } from "@/lib/calendar-window";
import { monthOf } from "@/lib/dates";
import { tagStyle } from "@/lib/tags";
import type { CalendarEvent, CalendarTag, MealPlan } from "@/lib/types";

/**
 * 予定に、色を決めるタグをくっつけたもの。
 * マスを描くたびにタグ表を引き直さなくて済むよう、上でまとめて付けておく。
 */
export type EventWithTag = CalendarEvent & { tag?: CalendarTag };

export type DayContent = {
  events: EventWithTag[];
  meals: MealPlan[];
  choreCount: number;
  choreDone: number;
};

/**
 * カレンダーの1週ぶん。
 *
 * 【1マスに出すのは3行まで】
 * 「+n」自体が1行を使うので、3件出して「+1」にはできない。
 * 3件以下ならそのまま、4件以上なら2件だけ出して3行目を「+n」にする。
 * ここを間違えると4件目のある日で必ずはみ出して高さが崩れる。
 *
 * 【家事は行を使わない】
 * 日付の右に印を1つ出すだけ。行を食うと予定の枠が減るうえ、
 * 日によって行数が変わって高さがガタつく。数はその日をタップして見る。
 */
export const WeekRow = memo(function WeekRow({
  weekStart,
  contentOf,
  today,
  selected,
  onSelect,
  style,
}: {
  weekStart: string;
  contentOf: (iso: string) => DayContent;
  today: string;
  selected: string | null;
  onSelect: (iso: string) => void;
  style: React.CSSProperties;
}) {
  const days = daysOfWeek(weekStart);
  // 月の変わり目の週は、上に線を引いて区切りを見せる
  const startsNewMonth = days.some((d) => d.slice(8, 10) === "01");

  return (
    <div
      style={style}
      className={`grid grid-cols-7 gap-px bg-neutral-200 dark:bg-neutral-800 ${
        startsNewMonth ? "border-t-2 border-neutral-300 dark:border-neutral-700" : ""
      }`}
    >
      {days.map((iso) => {
        const { events, meals, choreCount, choreDone } = contentOf(iso);
        const isToday = iso === today;
        const isSelected = iso === selected;
        const wd = new Date(`${iso}T00:00:00`).getDay();
        const dayOfMonth = Number(iso.slice(8, 10));
        const isFirst = dayOfMonth === 1;

        // 献立は先頭に最大1件。あとは時刻順の予定。
        const rows: Array<{ key: string; node: React.ReactNode }> = [];
        for (const m of meals.slice(0, 1)) {
          rows.push({
            key: `m${m.id}`,
            node: (
              <span className="flex items-center gap-0.5 truncate rounded bg-neutral-100 px-0.5 text-[9px] leading-[13px] text-neutral-700 dark:bg-neutral-800 dark:text-neutral-200">
                🍽<span className="truncate">{m.name ?? ""}</span>
              </span>
            ),
          });
        }
        for (const e of events) {
          rows.push({
            key: `e${e.id}`,
            node: (
              <span
                className={`truncate rounded px-0.5 text-[9px] leading-[13px] font-semibold text-white ${
                  tagStyle(e.tag, e.label).bar
                }`}
              >
                {e.title}
              </span>
            ),
          });
        }
        const shown = rows.length <= 3 ? rows : rows.slice(0, 2);
        const hidden = rows.length - shown.length;

        return (
          <button
            key={iso}
            type="button"
            onClick={() => onSelect(iso)}
            className={`flex flex-col gap-0.5 overflow-hidden p-1 text-left ${
              // 連続スクロールだと週の切れ目が読みにくいので、
              // 土日は文字色だけでなく背景も薄く変える
              wd === 0
                ? "bg-rose-50/70 dark:bg-rose-950/20"
                : wd === 6
                  ? "bg-sky-50/70 dark:bg-sky-950/20"
                  : "bg-white dark:bg-neutral-900"
            } ${isSelected ? "ring-2 ring-inset ring-emerald-500" : ""}`}
          >
            <span className="flex items-baseline gap-0.5">
              <span
                className={`text-[11px] font-bold leading-none ${
                  isToday
                    ? "inline-flex size-[18px] items-center justify-center rounded-full bg-emerald-600 text-white"
                    : wd === 0
                      ? "text-rose-600 dark:text-rose-400"
                      : wd === 6
                        ? "text-sky-600 dark:text-sky-400"
                        : "text-neutral-700 dark:text-neutral-200"
                }`}
              >
                {/* 1日だけ「9/1」と月を付ける。これだけで月の境目が読める */}
                {isFirst && !isToday ? `${Number(monthOf(iso).slice(5, 7))}/1` : dayOfMonth}
              </span>
              {choreCount > choreDone && (
                <span className="text-[9px] leading-none" aria-label="やり残した家事あり">
                  🧹
                </span>
              )}
            </span>

            {shown.map((r) => (
              <Fragment key={r.key}>{r.node}</Fragment>
            ))}

            {hidden > 0 && (
              <span className="text-[9px] leading-[13px] text-neutral-500 dark:text-neutral-400">
                +{hidden}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
});
