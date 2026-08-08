"use client";

import { WEEKDAY_LABELS, monthGrid, monthOf, todayISO } from "@/lib/dates";
import { labelStyle } from "@/lib/event-labels";
import type { CalendarEvent, MealPlan } from "@/lib/types";

export type DayContent = {
  events: CalendarEvent[];
  meals: MealPlan[];
  choreCount: number;
  choreDone: number;
};

/**
 * 月表示。
 *
 * 1マス55px しかないので、TimeTree と同じく「色帯 + 短い文字」を積む。
 * 色だけにすると何の予定か分からず、文字だけにすると誰の予定か分からない。
 * 入りきらないぶんは「+n」で示し、その日をタップすれば全部見られる。
 */
export function MonthGrid({
  month,
  contentOf,
  onSelect,
  selected,
}: {
  month: string;
  contentOf: (iso: string) => DayContent;
  onSelect: (iso: string) => void;
  selected: string | null;
}) {
  const days = monthGrid(month);
  const today = todayISO();

  return (
    <div className="px-1">
      <div className="grid grid-cols-7">
        {WEEKDAY_LABELS.map((w, i) => (
          <div
            key={w}
            className={`pb-1 text-center text-[11px] font-bold ${
              i === 0 ? "text-rose-600" : i === 6 ? "text-sky-600" : "text-neutral-500"
            }`}
          >
            {w}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-px overflow-hidden rounded-xl bg-neutral-200 dark:bg-neutral-800">
        {days.map((iso) => {
          const inMonth = monthOf(iso) === month;
          const isToday = iso === today;
          const isSelected = iso === selected;
          const { events, meals, choreCount, choreDone } = contentOf(iso);
          const wd = new Date(`${iso}T00:00:00`).getDay();
          const shown = events.slice(0, meals.length > 0 ? 1 : 2);
          const hidden = events.length - shown.length;

          return (
            <button
              key={iso}
              type="button"
              onClick={() => onSelect(iso)}
              className={`flex h-[76px] flex-col gap-0.5 p-1 text-left ${
                inMonth ? "bg-white dark:bg-neutral-900" : "bg-neutral-50 dark:bg-neutral-950"
              } ${isSelected ? "ring-2 ring-inset ring-emerald-500" : ""}`}
            >
              <span
                className={`text-[11px] font-bold leading-none ${
                  isToday
                    ? "inline-flex size-[18px] items-center justify-center rounded-full bg-emerald-600 text-white"
                    : !inMonth
                      ? "text-neutral-400 dark:text-neutral-600"
                      : wd === 0
                        ? "text-rose-600"
                        : wd === 6
                          ? "text-sky-600"
                          : "text-neutral-700 dark:text-neutral-200"
                }`}
              >
                {Number(iso.slice(8, 10))}
              </span>

              {meals.map((m) => (
                <span
                  key={`m${m.id}`}
                  className="flex items-center gap-0.5 truncate rounded bg-neutral-100 px-0.5 text-[9px] leading-[13px] text-neutral-700 dark:bg-neutral-800 dark:text-neutral-200"
                >
                  🍽<span className="truncate">{m.name ?? ""}</span>
                </span>
              ))}

              {shown.map((e) => (
                <span
                  key={`e${e.id}`}
                  className={`truncate rounded px-0.5 text-[9px] leading-[13px] font-semibold text-white ${labelStyle(e.label).bar}`}
                >
                  {e.title}
                </span>
              ))}

              {hidden > 0 && (
                <span className="text-[9px] leading-[13px] text-neutral-500 dark:text-neutral-400">
                  +{hidden}
                </span>
              )}

              {choreCount > 0 && (
                <span className="mt-auto text-[9px] leading-none text-neutral-500 dark:text-neutral-400">
                  🧹{choreDone}/{choreCount}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
