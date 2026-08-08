"use client";

import { useState } from "react";
import { Sheet } from "@/components/Sheet";
import { formatDate } from "@/lib/dates";
import { DEFAULT_LABEL, EVENT_LABELS, REPEATS } from "@/lib/event-labels";
import {
  addEventComment,
  addMealPlan,
  deleteEvent,
  deleteEventComment,
  saveEvent,
} from "@/lib/mutations";
import { useTable } from "@/lib/use-table";
import type { CalendarEvent, EventComment, Recipe } from "@/lib/types";

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
  const [label, setLabel] = useState<string>(existing?.label ?? DEFAULT_LABEL);
  const [repeat, setRepeat] = useState<string>(existing?.repeat ?? "なし");
  const [repeatUntil, setRepeatUntil] = useState(existing?.repeat_until ?? "");
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
          label,
          repeat,
          repeatUntil: repeat === "なし" ? null : repeatUntil || null,
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

  const canSubmit =
    mode === "予定" ? Boolean(title.trim()) : Boolean(chosenRecipe || mealName.trim());

  return (
    <Sheet onClose={onClose}>
      <h2 className="text-base font-bold">
        {formatDate(date)} {existing ? "の予定" : "に追加"}
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
            autoFocus={!existing}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && canSubmit && void submit()}
            enterKeyHint="done"
            placeholder="例: 歯医者 / 飲み会 / 帰りが遅い"
            className="mt-1 h-12 w-full rounded-xl border border-neutral-300 bg-white px-3 text-base dark:border-neutral-700 dark:bg-neutral-800"
          />

          <label className="mt-3 block text-xs font-medium text-neutral-500">種類</label>
          <div className="mt-1 grid grid-cols-3 gap-1.5">
            {EVENT_LABELS.map((l) => (
              <button
                key={l.key}
                type="button"
                onClick={() => setLabel(l.key)}
                className={`flex h-11 items-center justify-center gap-1.5 rounded-lg text-xs font-bold ${
                  label === l.key
                    ? `${l.chip} ring-2 ring-inset ring-current`
                    : "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"
                }`}
              >
                <span className={`size-2.5 rounded-full ${l.bar}`} />
                {l.key}
              </button>
            ))}
          </div>

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
          <p className="mt-1 text-[11px] text-neutral-500 dark:text-neutral-400">
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

          <label className="mt-3 block text-xs font-medium text-neutral-500">繰り返し</label>
          <div className="mt-1 grid grid-cols-5 gap-1">
            {REPEATS.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRepeat(r)}
                className={`h-11 rounded-lg text-xs font-bold ${
                  repeat === r
                    ? "bg-emerald-600 text-white"
                    : "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"
                }`}
              >
                {r}
              </button>
            ))}
          </div>
          {repeat !== "なし" && (
            <div className="mt-2">
              <label className="block text-xs font-medium text-neutral-500">
                いつまで(空なら期限なし)
              </label>
              <input
                type="date"
                value={repeatUntil}
                onChange={(e) => setRepeatUntil(e.target.value)}
                className="mt-1 h-12 w-full rounded-xl border border-neutral-300 bg-white px-3 text-base dark:border-neutral-700 dark:bg-neutral-800"
              />
            </div>
          )}

          <label className="mt-3 block text-xs font-medium text-neutral-500">メモ(任意)</label>
          <input
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && canSubmit && void submit()}
            enterKeyHint="done"
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
                onKeyDown={(e) => e.key === "Enter" && canSubmit && void submit()}
                enterKeyHint="done"
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
        <>
          <EventComments eventId={existing.id} members={members} userId={userId} />
          <div className="mt-6 border-t border-neutral-200 pt-4 dark:border-neutral-800">
            <button
              type="button"
              onClick={() => void remove()}
              disabled={busy}
              className="h-14 w-full rounded-xl bg-rose-50 text-base font-bold text-rose-600 disabled:opacity-40 dark:bg-rose-950/50"
            >
              {existing.repeat && existing.repeat !== "なし"
                ? "この繰り返し予定を削除"
                : "この予定を削除"}
            </button>
          </div>
        </>
      )}
    </Sheet>
  );
}

/**
 * 予定ごとのやりとり。
 *
 * 「何時に出る?」「駅で待ち合わせ」を別のアプリでやると、
 * どの予定の話か分からなくなる。予定に紐づけて残しておけば後から辿れる。
 */
function EventComments({
  eventId,
  members,
  userId,
}: {
  eventId: number;
  members: Record<string, string>;
  userId: string | null;
}) {
  const comments = useTable<EventComment>("event_comments", { orderBy: "created_at" });
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mine = comments.rows.filter((c) => c.event_id === eventId);

  const send = async () => {
    const text = body.trim();
    if (!text) return;
    setBusy(true);
    setError(null);
    try {
      await addEventComment(eventId, text);
      setBody("");
      comments.refetch();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const who = (id: string | null) => {
    if (!id) return "";
    if (id === userId) return "自分";
    return members[id] ?? "パートナー";
  };

  return (
    <section className="mt-6 border-t border-neutral-200 pt-4 dark:border-neutral-800">
      <h3 className="text-xs font-bold text-neutral-500">やりとり</h3>

      {mine.length > 0 && (
        <ul className="mt-2 space-y-2">
          {mine.map((c) => (
            <li
              key={c.id}
              className={`flex ${c.user_id === userId ? "justify-end" : "justify-start"}`}
            >
              <div className="max-w-[80%]">
                <span className="block text-[10px] text-neutral-500 dark:text-neutral-400">
                  {who(c.user_id)} {c.created_at.slice(11, 16)}
                </span>
                <div
                  className={`mt-0.5 rounded-2xl px-3 py-2 text-sm ${
                    c.user_id === userId
                      ? "bg-emerald-600 text-white"
                      : "bg-neutral-100 text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100"
                  }`}
                >
                  {c.body}
                </div>
                {c.user_id === userId && (
                  <button
                    type="button"
                    onClick={() => void deleteEventComment(c.id).then(() => comments.refetch())}
                    className="mt-0.5 block w-full text-right text-[10px] text-neutral-500 dark:text-neutral-400"
                  >
                    削除
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-2 flex gap-2">
        <input
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void send()}
          enterKeyHint="send"
          placeholder="ひとこと(例: 何時に出る?)"
          className="h-12 flex-1 rounded-xl border border-neutral-300 bg-white px-3 text-base dark:border-neutral-700 dark:bg-neutral-800"
        />
        <button
          type="button"
          onClick={() => void send()}
          disabled={busy || !body.trim()}
          className="h-12 shrink-0 rounded-xl bg-emerald-600 px-4 text-sm font-bold text-white disabled:opacity-40"
        >
          送る
        </button>
      </div>
      {error && <p className="mt-2 text-sm text-rose-600">{error}</p>}
    </section>
  );
}
