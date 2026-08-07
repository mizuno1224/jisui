"use client";

import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import { LoadNotice } from "@/components/ScreenHeader";
import { WEEKDAY_LABELS } from "@/lib/dates";
import { deleteChore, saveChore } from "@/lib/mutations";
import { getServerSnapshot, getSnapshot, subscribe } from "@/lib/store";
import { useTable } from "@/lib/use-table";
import type { Chore } from "@/lib/types";

export function ChoresScreen() {
  const session = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const chores = useTable<Chore>("chores", { orderBy: "sort_order" });
  const [editing, setEditing] = useState<Chore | null>(null);
  const [adding, setAdding] = useState(false);
  const [tick, setTick] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const memberLabel = (userId: string | null) => {
    if (!userId) return "どちらでも";
    if (userId === session.userId) return "自分";
    return session.members[userId] ?? "パートナー";
  };

  const describe = (c: Chore) => {
    if (c.weekdays?.length === 7) return "毎日";
    if (c.weekdays?.length) return `毎週 ${c.weekdays.map((d) => WEEKDAY_LABELS[d]).join("・")}`;
    if (c.monthday != null) return `毎月 ${c.monthday}日`;
    return "予定なし";
  };

  return (
    <main key={tick} className="min-h-dvh bg-neutral-50 pb-44 dark:bg-neutral-950">
      <header className="sticky top-0 z-30 border-b border-neutral-200 bg-white/95 px-4 pt-[calc(env(safe-area-inset-top)+0.5rem)] pb-3 backdrop-blur dark:border-neutral-800 dark:bg-neutral-900/95">
        <Link
          href="/plan"
          className="-ml-2 inline-flex h-9 items-center gap-1 rounded-lg px-2 text-sm text-neutral-500 active:bg-neutral-100 dark:active:bg-neutral-800"
        >
          <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth={2.5}>
            <path d="M15 5l-7 7 7 7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          予定
        </Link>
        <h1 className="mt-0.5 text-xl font-bold leading-tight">繰り返しの家事</h1>
        <p className="mt-1 text-xs text-neutral-500">
          ここで決めた曜日に、カレンダーへ自動で出ます
        </p>
      </header>

      {error && (
        <p className="mx-4 mt-3 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:bg-rose-950/50 dark:text-rose-300">
          {error}
        </p>
      )}

      <LoadNotice
        loading={chores.loading && chores.rows.length === 0}
        error={chores.error}
        empty={chores.rows.length === 0}
        emptyText="まだありません。下のボタンから追加してください。"
      />

      <ul className="mt-3 divide-y divide-neutral-100 border-y border-neutral-200 bg-white dark:divide-neutral-800 dark:border-neutral-800 dark:bg-neutral-900">
        {chores.rows.map((c) => (
          <li key={c.id}>
            <button
              type="button"
              onClick={() => setEditing(c)}
              className="flex min-h-16 w-full items-center gap-3 px-4 py-3 text-left active:bg-neutral-50 dark:active:bg-neutral-800"
            >
              <span className="min-w-0 flex-1">
                <span className={`block text-[16px] font-semibold ${!c.active ? "text-neutral-400 line-through" : ""}`}>
                  {c.name}
                </span>
                <span className="mt-0.5 block text-xs text-neutral-500">
                  {describe(c)} · {memberLabel(c.assignee_id)}
                </span>
              </span>
              <svg viewBox="0 0 24 24" className="size-5 shrink-0 text-neutral-300" fill="none" stroke="currentColor" strokeWidth={2}>
                <path d="M9 5l7 7-7 7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </li>
        ))}
      </ul>

      <div className="px-4 pt-4">
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="h-14 w-full rounded-xl bg-emerald-600 text-base font-bold text-white"
        >
          家事を追加
        </button>
      </div>

      {(adding || editing) && (
        <ChoreSheet
          existing={editing}
          members={session.members}
          userId={session.userId}
          onClose={() => {
            setAdding(false);
            setEditing(null);
          }}
          onSaved={() => {
            setAdding(false);
            setEditing(null);
            setTick((t) => t + 1);
          }}
          onError={setError}
        />
      )}
    </main>
  );
}

const PRESETS = [
  { name: "ゴミ出し(可燃)", weekdays: [1, 4] },
  { name: "ゴミ出し(資源)", weekdays: [3] },
  { name: "掃除機", weekdays: [0] },
  { name: "洗濯", weekdays: [0, 2, 5] },
  { name: "風呂掃除", weekdays: [0, 1, 2, 3, 4, 5, 6] },
];

function ChoreSheet({
  existing,
  members,
  userId,
  onClose,
  onSaved,
  onError,
}: {
  existing: Chore | null;
  members: Record<string, string>;
  userId: string | null;
  onClose: () => void;
  onSaved: () => void;
  onError: (message: string) => void;
}) {
  const [name, setName] = useState(existing?.name ?? "");
  const [weekdays, setWeekdays] = useState<number[]>(existing?.weekdays ?? []);
  const [monthday, setMonthday] = useState(existing?.monthday ? String(existing.monthday) : "");
  const [assigneeId, setAssigneeId] = useState<string | null>(existing?.assignee_id ?? null);
  const [active, setActive] = useState(existing?.active ?? true);
  const [busy, setBusy] = useState(false);

  const partnerId = Object.keys(members).find((id) => id !== userId) ?? null;
  const assignees: { id: string | null; label: string }[] = [
    { id: null, label: "どちらでも" },
    ...(userId ? [{ id: userId, label: "自分" }] : []),
    ...(partnerId ? [{ id: partnerId, label: members[partnerId] ?? "パートナー" }] : []),
  ];

  const toggleDay = (d: number) =>
    setWeekdays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort()));

  const submit = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      await saveChore({
        id: existing?.id,
        name: name.trim(),
        weekdays,
        monthday: weekdays.length ? null : monthday ? Number(monthday) : null,
        assigneeId,
        active,
      });
      onSaved();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!existing) return;
    setBusy(true);
    try {
      await deleteChore(existing.id);
      onSaved();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <button type="button" aria-label="閉じる" onClick={onClose} className="absolute inset-0 bg-black/40" />
      <div className="relative max-h-[88dvh] overflow-y-auto rounded-t-2xl bg-white px-4 pt-4 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] dark:bg-neutral-900">
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-neutral-300 dark:bg-neutral-600" />
        <h2 className="text-base font-bold">{existing ? "家事を編集" : "家事を追加"}</h2>

        {!existing && (
          <div className="-mx-4 mt-3 flex gap-1.5 overflow-x-auto px-4 pb-1">
            {PRESETS.map((p) => (
              <button
                key={p.name}
                type="button"
                onClick={() => {
                  setName(p.name);
                  setWeekdays(p.weekdays);
                }}
                className="h-9 shrink-0 rounded-full bg-neutral-100 px-3 text-xs font-bold text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"
              >
                {p.name}
              </button>
            ))}
          </div>
        )}

        <label className="mt-3 block text-xs font-medium text-neutral-500">名前</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="例: ゴミ出し(可燃)"
          className="mt-1 h-12 w-full rounded-xl border border-neutral-300 bg-white px-3 text-base dark:border-neutral-700 dark:bg-neutral-800"
        />

        <label className="mt-3 block text-xs font-medium text-neutral-500">曜日</label>
        <div className="mt-1 flex gap-1">
          {WEEKDAY_LABELS.map((label, d) => (
            <button
              key={label}
              type="button"
              onClick={() => toggleDay(d)}
              className={`h-11 flex-1 rounded-lg text-sm font-bold ${
                weekdays.includes(d)
                  ? "bg-emerald-600 text-white"
                  : "bg-neutral-100 text-neutral-500 dark:bg-neutral-800"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {weekdays.length === 0 && (
          <>
            <label className="mt-3 block text-xs font-medium text-neutral-500">
              または毎月n日(曜日を選ばない場合)
            </label>
            <input
              type="number"
              min={1}
              max={31}
              value={monthday}
              onChange={(e) => setMonthday(e.target.value)}
              placeholder="例: 25"
              className="mt-1 h-12 w-24 rounded-xl border border-neutral-300 bg-white px-3 text-base dark:border-neutral-700 dark:bg-neutral-800"
            />
          </>
        )}

        <label className="mt-3 block text-xs font-medium text-neutral-500">担当</label>
        <div className="mt-1 flex gap-1 rounded-xl bg-neutral-100 p-1 dark:bg-neutral-800">
          {assignees.map((a) => (
            <button
              key={a.label}
              type="button"
              onClick={() => setAssigneeId(a.id)}
              className={`h-11 flex-1 rounded-lg text-sm font-semibold ${
                assigneeId === a.id ? "bg-white shadow-sm dark:bg-neutral-700" : "text-neutral-500"
              }`}
            >
              {a.label}
            </button>
          ))}
        </div>

        {existing && (
          <label className="mt-3 flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
              className="size-5"
            />
            カレンダーに出す
          </label>
        )}

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
            disabled={busy || !name.trim()}
            className="h-14 flex-[2] rounded-xl bg-emerald-600 text-base font-bold text-white disabled:opacity-40"
          >
            {busy ? "保存中…" : "保存する"}
          </button>
        </div>

        {existing && (
          <button
            type="button"
            onClick={() => void remove()}
            disabled={busy}
            className="mt-2 h-14 w-full rounded-xl bg-rose-50 text-base font-bold text-rose-600 disabled:opacity-40 dark:bg-rose-950/50"
          >
            削除
          </button>
        )}
      </div>
    </div>
  );
}
