"use client";

import { useMemo, useState, useSyncExternalStore, useEffect } from "react";
import { LoadNotice, ScreenHeader } from "@/components/ScreenHeader";
import { daysUntil, todayISO } from "@/lib/dates";
import {
  addItem,
  adjustQty,
  getServerSnapshot,
  getSnapshot,
  init,
  removeItem,
  setExpiry,
  setLocation,
  setQty,
  subscribe,
  syncNow,
} from "@/lib/inventory-store";
import { looseMatch } from "@/lib/matching";
import { useTable } from "@/lib/use-table";
import {
  LOCATIONS,
  type InventoryItem,
  type Location,
  type MealPlan,
  type RecipeIngredient,
} from "@/lib/types";

function useInventory() {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  useEffect(() => {
    void init();
  }, []);
  return snapshot;
}

/** 期限の見た目。近いものほど強く出す(設計書 3-3)。 */
function expiryBadge(expiry: string | null) {
  if (!expiry) return null;
  const left = daysUntil(expiry);
  if (left < 0)
    return { text: `期限切れ ${-left}日`, className: "bg-rose-600 text-white" };
  if (left === 0) return { text: "今日まで", className: "bg-rose-600 text-white" };
  if (left <= 3) return { text: `あと${left}日`, className: "bg-rose-100 text-rose-800" };
  if (left <= 7) return { text: `あと${left}日`, className: "bg-amber-100 text-amber-900" };
  return { text: `${expiry.slice(5).replace("-", "/")}`, className: "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300" };
}

export function InventoryScreen() {
  const snapshot = useInventory();
  const [tab, setTab] = useState<Location>("冷蔵");
  const [query, setQuery] = useState("");
  const [target, setTarget] = useState<InventoryItem | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  // 「使う予定の献立」を出すために、予定とレシピ材料を読む
  const plans = useTable<MealPlan>("meal_plan");
  const ingredients = useTable<RecipeIngredient>("recipe_ingredients");

  const plannedUses = useMemo(() => {
    const today = todayISO();
    const upcoming = plans.rows.filter((p) => p.date >= today && p.status !== "中止");
    return (name: string): string | null => {
      for (const plan of upcoming) {
        if (!plan.recipe_id) continue;
        const used = ingredients.rows.some(
          (ing) => ing.recipe_id === plan.recipe_id && looseMatch(ing.name, name),
        );
        if (used) return `${plan.date.slice(5).replace("-", "/")} ${plan.name ?? ""}`.trim();
      }
      return null;
    };
  }, [plans.rows, ingredients.rows]);

  // 検索中は場所のタブを跨いで探す(「あれどこだっけ」に答えるのが目的なので)
  const byLocation = useMemo(() => {
    const q = query.trim();
    if (q) return snapshot.items.filter((i) => i.name.includes(q));
    return snapshot.items.filter((i) => i.location === tab);
  }, [snapshot.items, tab, query]);

  const soon = snapshot.items.filter(
    (i) => i.expiry && daysUntil(i.expiry) <= 3,
  ).length;

  return (
    <main className="min-h-dvh bg-neutral-50 pb-44 dark:bg-neutral-950">
      <ScreenHeader
        title="在庫"
        subtitle={
          <>
            {snapshot.items.length}
            <span className="text-base font-medium text-neutral-500 dark:text-neutral-400"> 点</span>
          </>
        }
        right={
          snapshot.pending > 0 ? (
            <button
              type="button"
              onClick={() => void syncNow()}
              className="rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-medium text-amber-900"
            >
              未送信 {snapshot.pending}
            </button>
          ) : null
        }
      >
        {soon > 0 && (
          <p className="mt-2 rounded-lg bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-700 dark:bg-rose-950/50 dark:text-rose-300">
            期限が近いものが {soon} 点あります
          </p>
        )}
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="食材を探す(場所を問わず)"
          className="mt-2 h-11 w-full rounded-xl border border-neutral-300 bg-white px-3 text-base outline-none focus:border-emerald-500 dark:border-neutral-700 dark:bg-neutral-800"
        />
        <div
          className={`mt-3 flex gap-1 rounded-xl bg-neutral-100 p-1 dark:bg-neutral-800 ${
            query.trim() ? "opacity-40" : ""
          }`}
        >
          {LOCATIONS.map((loc) => {
            const count = snapshot.items.filter((i) => i.location === loc).length;
            return (
              <button
                key={loc}
                type="button"
                onClick={() => setTab(loc)}
                className={`h-10 flex-1 rounded-lg text-sm font-semibold transition-colors ${
                  tab === loc
                    ? "bg-white text-neutral-900 shadow-sm dark:bg-neutral-700 dark:text-neutral-50"
                    : "text-neutral-500"
                }`}
              >
                {loc}
                <span className="ml-1 text-xs font-normal text-neutral-500 dark:text-neutral-400">{count}</span>
              </button>
            );
          })}
        </div>
      </ScreenHeader>

      <LoadNotice
        loading={snapshot.status === "loading"}
        error={snapshot.error}
        empty={byLocation.length === 0}
        emptyText={
          query.trim()
            ? `「${query.trim()}」は見つかりませんでした。`
            : `${tab}は空です。右下の + で追加できます。`
        }
      />

      <ul className="mt-3 divide-y divide-neutral-100 border-y border-neutral-200 bg-white dark:divide-neutral-800 dark:border-neutral-800 dark:bg-neutral-900">
        {byLocation.map((item) => {
          const badge = expiryBadge(item.expiry);
          const use = plannedUses(item.name);
          return (
            <li key={String(item.id)} className="flex min-h-16 items-center gap-2 py-2 pl-4 pr-2">
              <button
                type="button"
                onClick={() => setTarget(item)}
                className="min-w-0 flex-1 text-left"
              >
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span
                    className={`text-[17px] font-semibold leading-tight ${
                      (item.qty ?? 0) === 0 ? "text-neutral-500 dark:text-neutral-400" : ""
                    }`}
                  >
                    {item.name}
                  </span>
                  {(item.qty ?? 0) === 0 && (
                    <span className="rounded bg-neutral-200 px-1.5 py-0.5 text-[10px] font-bold text-neutral-600 dark:bg-neutral-700 dark:text-neutral-200">
                      切らしている
                    </span>
                  )}
                  {/* 検索中は場所を跨ぐので、どこにあるかを出さないと役に立たない */}
                  {query.trim() && (
                    <span className="rounded bg-neutral-200 px-1.5 py-0.5 text-[10px] font-bold text-neutral-700 dark:bg-neutral-700 dark:text-neutral-200">
                      {item.location}
                    </span>
                  )}
                  {badge && (
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${badge.className}`}>
                      {badge.text}
                    </span>
                  )}
                </span>
                {use && (
                  <span className="mt-0.5 block truncate text-xs text-emerald-700 dark:text-emerald-400">
                    使う予定: {use}
                  </span>
                )}
              </button>

              {/* キーボードを出さずに増減できるようにする(設計書 3-3) */}
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  aria-label={`${item.name}を減らす`}
                  onClick={() => {
                    navigator.vibrate?.(8);
                    void adjustQty(item.id, -1);
                  }}
                  className="flex size-11 items-center justify-center rounded-full bg-neutral-100 text-xl font-bold text-neutral-700 active:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-200"
                >
                  −
                </button>
                <span className="w-14 text-center text-sm font-bold tabular-nums">
                  {item.qty ?? "-"}
                  <span className="ml-0.5 text-[11px] font-normal text-neutral-500 dark:text-neutral-400">
                    {item.unit ?? ""}
                  </span>
                </span>
                <button
                  type="button"
                  aria-label={`${item.name}を増やす`}
                  onClick={() => {
                    navigator.vibrate?.(8);
                    void adjustQty(item.id, 1);
                  }}
                  className="flex size-11 items-center justify-center rounded-full bg-neutral-100 text-xl font-bold text-neutral-700 active:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-200"
                >
                  ＋
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      <button
        type="button"
        aria-label="在庫を追加"
        onClick={() => setAddOpen(true)}
        className="fixed bottom-[calc(env(safe-area-inset-bottom)+4.75rem)] right-5 z-40 flex size-16 items-center justify-center rounded-full bg-emerald-600 text-white shadow-lg active:bg-emerald-700"
      >
        <svg viewBox="0 0 24 24" className="size-8" fill="none" stroke="currentColor" strokeWidth={2.5}>
          <path d="M12 5v14M5 12h14" strokeLinecap="round" />
        </svg>
      </button>

      {addOpen && (
        <AddInventorySheet
          defaultLocation={tab}
          onClose={() => setAddOpen(false)}
          onSubmit={(input) => void addItem(input)}
        />
      )}

      {target && (
        <ItemActionSheet
          item={target}
          onClose={() => setTarget(null)}
          onDone={() => setTarget(null)}
        />
      )}
    </main>
  );
}

// ------------------------------------------------------- 長押し相当の詳細操作

function ItemActionSheet({
  item,
  onClose,
  onDone,
}: {
  item: InventoryItem;
  onClose: () => void;
  onDone: () => void;
}) {
  const [qty, setQtyInput] = useState(String(item.qty ?? ""));
  const [expiry, setExpiryInput] = useState(item.expiry ?? "");
  // 以前は押した瞬間に保存していたので、そのまま閉じても場所だけ変わっていた。
  // 数量・期限と同じく「保存」で確定する。
  const [location, setLocationInput] = useState<Location>(item.location);

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <button type="button" aria-label="閉じる" onClick={onClose} className="absolute inset-0 bg-black/40" />
      <div className="relative rounded-t-2xl bg-white px-4 pt-4 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] dark:bg-neutral-900">
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-neutral-300 dark:bg-neutral-600" />
        <p className="mb-4 text-center text-base font-bold">{item.name}</p>

        <div className="flex gap-3">
          <div className="flex-1">
            <label className="block text-xs font-medium text-neutral-500">数量</label>
            <input
              type="number"
              inputMode="decimal"
              value={qty}
              onChange={(e) => setQtyInput(e.target.value)}
              className="mt-1 h-12 w-full rounded-xl border border-neutral-300 bg-white px-3 text-base dark:border-neutral-700 dark:bg-neutral-800"
            />
          </div>
          <div className="flex-1">
            <label className="block text-xs font-medium text-neutral-500">期限</label>
            <input
              type="date"
              value={expiry}
              onChange={(e) => setExpiryInput(e.target.value)}
              className="mt-1 h-12 w-full rounded-xl border border-neutral-300 bg-white px-3 text-base dark:border-neutral-700 dark:bg-neutral-800"
            />
          </div>
        </div>

        <div className="mt-3">
          <label className="block text-xs font-medium text-neutral-500">場所</label>
          <div className="mt-1 flex gap-1 rounded-xl bg-neutral-100 p-1 dark:bg-neutral-800">
            {LOCATIONS.map((loc) => (
              <button
                key={loc}
                type="button"
                onClick={() => setLocationInput(loc)}
                className={`h-11 flex-1 rounded-lg text-sm font-semibold ${
                  location === loc
                    ? "bg-white shadow-sm dark:bg-neutral-700"
                    : "text-neutral-500"
                }`}
              >
                {loc}
              </button>
            ))}
          </div>
        </div>

        <button
          type="button"
          onClick={() => {
            const n = Number(qty);
            if (!Number.isNaN(n)) void setQty(item.id, n);
            void setExpiry(item.id, expiry || null);
            if (location !== item.location) void setLocation(item.id, location);
            onDone();
          }}
          className="mt-5 h-14 w-full rounded-xl bg-emerald-600 text-base font-bold text-white"
        >
          保存
        </button>
        <button
          type="button"
          onClick={onClose}
          className="mt-2 h-14 w-full rounded-xl bg-neutral-100 text-base font-semibold text-neutral-700 dark:bg-neutral-800 dark:text-neutral-200"
        >
          やめる
        </button>

        {/* 削除は不可逆なので、保存から離して置く。濡れた指で滑って消さないため */}
        <div className="mt-6 border-t border-neutral-200 pt-4 dark:border-neutral-800">
          <button
            type="button"
            onClick={() => {
              void removeItem(item.id);
              onDone();
            }}
            className="h-14 w-full rounded-xl bg-rose-50 text-base font-bold text-rose-600 dark:bg-rose-950/50"
          >
            使い切った(削除)
          </button>
        </div>
      </div>
    </div>
  );
}

// --------------------------------------------------------------- 追加シート

function AddInventorySheet({
  defaultLocation,
  onClose,
  onSubmit,
}: {
  defaultLocation: Location;
  onClose: () => void;
  onSubmit: (input: {
    name: string;
    qty: number | null;
    unit: string | null;
    location: Location;
    expiry: string | null;
  }) => void;
}) {
  const [name, setName] = useState("");
  const [qty, setQty] = useState("1");
  const [unit, setUnit] = useState("");
  const [location, setLoc] = useState<Location>(defaultLocation);
  const [expiry, setExpiry] = useState("");

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const n = Number(qty);
    onSubmit({
      name: trimmed,
      qty: Number.isNaN(n) ? null : n,
      unit: unit.trim() || null,
      location,
      expiry: expiry || null,
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <button type="button" aria-label="閉じる" onClick={onClose} className="absolute inset-0 bg-black/40" />
      <div className="relative rounded-t-2xl bg-white px-4 pt-4 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] dark:bg-neutral-900">
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-neutral-300 dark:bg-neutral-600" />
        <h2 className="mb-3 text-base font-bold">在庫を追加</h2>

        <label className="block text-xs font-medium text-neutral-500">品名</label>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="例: 玉ねぎ"
          className="mt-1 h-12 w-full rounded-xl border border-neutral-300 bg-white px-3 text-base dark:border-neutral-700 dark:bg-neutral-800"
        />

        <div className="mt-3 flex gap-3">
          <div className="w-24">
            <label className="block text-xs font-medium text-neutral-500">数量</label>
            <input
              type="number"
              inputMode="decimal"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              className="mt-1 h-12 w-full rounded-xl border border-neutral-300 bg-white px-3 text-base dark:border-neutral-700 dark:bg-neutral-800"
            />
          </div>
          <div className="w-24">
            <label className="block text-xs font-medium text-neutral-500">単位</label>
            <input
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
              placeholder="個"
              className="mt-1 h-12 w-full rounded-xl border border-neutral-300 bg-white px-3 text-base dark:border-neutral-700 dark:bg-neutral-800"
            />
          </div>
          <div className="flex-1">
            <label className="block text-xs font-medium text-neutral-500">期限</label>
            <input
              type="date"
              value={expiry}
              onChange={(e) => setExpiry(e.target.value)}
              className="mt-1 h-12 w-full rounded-xl border border-neutral-300 bg-white px-3 text-base dark:border-neutral-700 dark:bg-neutral-800"
            />
          </div>
        </div>

        <div className="mt-3 flex gap-1 rounded-xl bg-neutral-100 p-1 dark:bg-neutral-800">
          {LOCATIONS.map((loc) => (
            <button
              key={loc}
              type="button"
              onClick={() => setLoc(loc)}
              className={`h-11 flex-1 rounded-lg text-sm font-semibold ${
                location === loc ? "bg-white shadow-sm dark:bg-neutral-700" : "text-neutral-500"
              }`}
            >
              {loc}
            </button>
          ))}
        </div>

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
            onClick={submit}
            disabled={!name.trim()}
            className="h-14 flex-[2] rounded-xl bg-emerald-600 text-base font-bold text-white disabled:opacity-40"
          >
            追加する
          </button>
        </div>
      </div>
    </div>
  );
}
