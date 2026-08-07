"use client";

import { useState } from "react";
import { formatDate } from "@/lib/dates";
import { addMealPlan, deleteEvent, saveEvent } from "@/lib/mutations";
import type { CalendarEvent, Recipe } from "@/lib/types";

type Mode = "予定" | "献立";

export function EventSheet({
  date,
  existing,
  recipes,
  members,
  userId,
  onClose,
  onSaved,
}: {
  date: string;
  existing: CalendarEvent | null;
  recipes: Recipe[];
  members: Record<string, string>;
  userId: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [mode, setMode] = useState<Mode>("予定");
  const [title, setTitle] = useState(existing?.title ?? "");
  const [startTime, setStartTime] = useState(existing?.start_time?.slice(0, 5) ?? "");
  const [endDate, setEndDate] = useState(existing?.end_date ?? "");
  const [memo, setMemo] = useState(existing?.memo ?? "");
  const [ownerId, setOwnerId] = useState<string | null>(existing?.owner_id ?? null);
  const [recipeId, setRecipeId] = useState("");
  const [mealName, setMealName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const chosenRecipe = recipes.find((r) => String(r.id) === recipeId);
  const partnerId = Object.keys(members).find((id) => id !== userId) ?? null;

  const owners: { id: string | null; label: string }[] = [
    { id: null, label: "2人" },
    ...(userId ? [{ id: userId, label: "自分" }] : []),
    ...(partnerId ? [{ id: partnerId, label: members[partnerId] ?? "パートナー" }] : []),
  ];

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      if (mode === "予定") {
        if (!title.trim()) return;
        await saveEvent({
          id: existing?.id,
          date,
          endDate: endDate || null,
          startTime: startTime || null,
          title: title.trim(),
          memo: memo.trim() || null,
          ownerId,
        });
      } else {
        const name = chosenRecipe?.name ?? mealName.trim();
        if (!name) return;
        await addMealPlan({ date, recipeId: chosenRecipe?.id ?? null, name });
      }
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!existing) return;
    setBusy(true);
    setError(null);
    try {
      await deleteEvent(existing.id);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const canSubmit = mode === "予定" ? Boolean(title.trim()) : Boolean(chosenRecipe || mealName.trim());

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <button type="button" aria-label="閉じる" onClick={onClose} className="absolute inset-0 bg-black/40" />
      <div className="relative max-h-[88dvh] overflow-y-auto rounded-t-2xl bg-white px-4 pt-4 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] dark:bg-neutral-900">
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-neutral-300 dark:bg-neutral-600" />
        <h2 className="text-base font-bold">
          {formatDate(date)} {existing ? "の予定を編集" : "に追加"}
        </h2>

        {!existing && (
          <div className="mt-3 flex gap-1 rounded-xl bg-neutral-100 p-1 dark:bg-neutral-800">
            {(["予定", "献立"] as Mode[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={`h-10 flex-1 rounded-lg text-sm font-semibold ${
                  mode === m ? "bg-white shadow-sm dark:bg-neutral-700" : "text-neutral-500"
                }`}
              >
                {m === "予定" ? "📅 予定" : "🍽 献立"}
              </button>
            ))}
          </div>
        )}

        {mode === "予定" ? (
          <>
            <label className="mt-3 block text-xs font-medium text-neutral-500">内容</label>
            <input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="例: 歯医者 / 飲み会 / 帰りが遅い"
              className="mt-1 h-12 w-full rounded-xl border border-neutral-300 bg-white px-3 text-base dark:border-neutral-700 dark:bg-neutral-800"
            />

            <label className="mt-3 block text-xs font-medium text-neutral-500">誰の予定か</label>
            <div className="mt-1 flex gap-1 rounded-xl bg-neutral-100 p-1 dark:bg-neutral-800">
              {owners.map((o) => (
                <button
                  key={o.label}
                  type="button"
                  onClick={() => setOwnerId(o.id)}
                  className={`h-11 flex-1 rounded-lg text-sm font-semibold ${
                    ownerId === o.id ? "bg-white shadow-sm dark:bg-neutral-700" : "text-neutral-500"
                  }`}
                >
                  {o.label}
                </button>
              ))}
            </div>
            <p className="mt-1 text-[11px] text-neutral-400">
              個人の予定も相手から見えます(予定を突き合わせるため)
            </p>

            <div className="mt-3 flex gap-3">
              <div className="flex-1">
                <label className="block text-xs font-medium text-neutral-500">時刻(任意)</label>
                <input
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  className="mt-1 h-12 w-full rounded-xl border border-neutral-300 bg-white px-3 text-base dark:border-neutral-700 dark:bg-neutral-800"
                />
              </div>
              <div className="flex-1">
                <label className="block text-xs font-medium text-neutral-500">終わりの日(任意)</label>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="mt-1 h-12 w-full rounded-xl border border-neutral-300 bg-white px-3 text-base dark:border-neutral-700 dark:bg-neutral-800"
                />
              </div>
            </div>

            <label className="mt-3 block text-xs font-medium text-neutral-500">メモ(任意)</label>
            <input
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              className="mt-1 h-12 w-full rounded-xl border border-neutral-300 bg-white px-3 text-base dark:border-neutral-700 dark:bg-neutral-800"
            />
          </>
        ) : (
          <>
            <label className="mt-3 block text-xs font-medium text-neutral-500">
              登録済みのレシピから
            </label>
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
            {!chosenRecipe && (
              <>
                <label className="mt-3 block text-xs font-medium text-neutral-500">献立名</label>
                <input
                  value={mealName}
                  onChange={(e) => setMealName(e.target.value)}
                  placeholder="例: 外食 / 冷凍弁当"
                  className="mt-1 h-12 w-full rounded-xl border border-neutral-300 bg-white px-3 text-base dark:border-neutral-700 dark:bg-neutral-800"
                />
              </>
            )}
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
            disabled={busy || !canSubmit}
            className="h-14 flex-[2] rounded-xl bg-emerald-600 text-base font-bold text-white disabled:opacity-40"
          >
            {busy ? "保存中…" : existing ? "保存する" : "追加する"}
          </button>
        </div>

        {existing && (
          <button
            type="button"
            onClick={() => void remove()}
            disabled={busy}
            className="mt-2 h-14 w-full rounded-xl bg-rose-50 text-base font-bold text-rose-600 disabled:opacity-40 dark:bg-rose-950/50"
          >
            この予定を削除
          </button>
        )}
      </div>
    </div>
  );
}
