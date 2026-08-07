"use client";

import { useRef } from "react";
import type { ShoppingItem } from "@/lib/types";

const LONG_PRESS_MS = 550;

function checkedTime(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
}

type Props = {
  item: ShoppingItem;
  /** チェックした人の表示名。自分なら「自分」。 */
  checkedByLabel: string | null;
  onToggle: (item: ShoppingItem) => void;
  onLongPress: (item: ShoppingItem) => void;
};

export function ItemRow({ item, checkedByLabel, onToggle, onLongPress }: Props) {
  const checked = item.status === "購入済";
  const timer = useRef<number | null>(null);
  const longPressed = useRef(false);

  const clear = () => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  };

  const start = () => {
    longPressed.current = false;
    clear();
    timer.current = window.setTimeout(() => {
      longPressed.current = true;
      navigator.vibrate?.(20);
      onLongPress(item);
    }, LONG_PRESS_MS);
  };

  const handleClick = () => {
    clear();
    if (longPressed.current) {
      longPressed.current = false;
      return;
    }
    navigator.vibrate?.(8);
    onToggle(item);
  };

  return (
    <li>
      {/* 行全体がタップ領域。小さなチェックボックスを狙わせない(設計書 3-2) */}
      <button
        type="button"
        role="checkbox"
        aria-checked={checked}
        onClick={handleClick}
        onPointerDown={start}
        onPointerUp={clear}
        onPointerLeave={clear}
        onPointerCancel={clear}
        onContextMenu={(e) => e.preventDefault()}
        className="flex w-full min-h-16 items-center gap-3 px-4 py-3 text-left transition-colors active:bg-neutral-100 dark:active:bg-neutral-800"
      >
        <span
          aria-hidden
          className={`flex size-7 shrink-0 items-center justify-center rounded-full border-2 text-white transition-colors ${
            checked
              ? "border-emerald-600 bg-emerald-600"
              : "border-neutral-300 dark:border-neutral-600"
          }`}
        >
          {checked && (
            <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth={3.5}>
              <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </span>

        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-baseline gap-x-2">
            <span
              className={`text-[17px] font-semibold leading-tight ${
                checked
                  ? "text-neutral-400 line-through dark:text-neutral-500"
                  : "text-neutral-900 dark:text-neutral-50"
              }`}
            >
              {item.item}
            </span>
            {item.qty && (
              <span
                className={`text-sm ${
                  checked ? "text-neutral-400 line-through" : "text-neutral-600 dark:text-neutral-300"
                }`}
              >
                {item.qty}
              </span>
            )}
          </span>
          {/* 何のために買うか。代替品を選ぶ判断ができる(設計書 3-2) */}
          {item.reason && !checked && (
            <span className="mt-0.5 block truncate text-xs text-neutral-500 dark:text-neutral-400">
              {item.reason}
            </span>
          )}
        </span>

        {checked && checkedByLabel && (
          <span className="shrink-0 text-right text-[11px] leading-tight text-neutral-400">
            {checkedByLabel}
            <br />
            {checkedTime(item.checked_at)}
          </span>
        )}
      </button>
    </li>
  );
}
