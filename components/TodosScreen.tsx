"use client";

import Link from "next/link";
import { useMemo, useState, useSyncExternalStore } from "react";
import { LoadNotice, ScreenHeader } from "@/components/ScreenHeader";
import { Sheet } from "@/components/Sheet";
import { formatDate, relativeDay, todayISO } from "@/lib/dates";
import { deleteTodo, saveTodo, setTodoDone } from "@/lib/mutations";
import { getServerSnapshot, getSnapshot, subscribe } from "@/lib/store";
import { useTable } from "@/lib/use-table";
import type { Todo } from "@/lib/types";

/** 繰り返しの選択肢。予定の繰り返しとは別(やることは隔週・毎年を使わない)。 */
const REPEATS = ["なし", "毎日", "毎週", "毎月"] as const;

/**
 * やること。
 *
 * 【サブタスクは1段まで】
 * 「旅行の準備」の下に「宿を予約」「切符を買う」を置ける。
 * 孫は作れない。2段目まで許すと、スマホの幅では字下げで文字が入らなくなるうえ、
 * 「どこに足すのか」が押す前に分からなくなる。データベース側でも止めてある。
 *
 * 【繰り返しは完了時に次を作る】
 * 毎週のものを完了にすると、次の週の行がその場で1件作られる。
 * 「いつ済ませたか」が1件ずつ残るので、後から辿れる。
 */
export function TodosScreen() {
  const session = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const todos = useTable<Todo>("todos", { orderBy: "sort_order" });
  const [sheet, setSheet] = useState<
    { mode: "add"; parent: Todo | null } | { mode: "edit"; todo: Todo } | null
  >(null);
  const [showDone, setShowDone] = useState(false);
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const today = todayISO();

  const { roots, childrenOf, doneCount } = useMemo(() => {
    const open = todos.rows.filter((t) => t.status === "open");
    const done = todos.rows.filter((t) => t.status === "done");
    const list = showDone ? todos.rows : open;

    const children = new Map<number, Todo[]>();
    for (const t of list) {
      if (t.parent_id == null) continue;
      const arr = children.get(t.parent_id) ?? [];
      arr.push(t);
      children.set(t.parent_id, arr);
    }
    // 期限のあるものを先に、期限の早い順。期限なしは後ろ。
    const byDue = (a: Todo, b: Todo) =>
      (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999") || a.id - b.id;
    for (const arr of children.values()) arr.sort(byDue);

    return {
      roots: list.filter((t) => t.parent_id == null).sort(byDue),
      childrenOf: children,
      doneCount: done.length,
    };
  }, [todos.rows, showDone]);

  const toggle = async (t: Todo) => {
    setBusy(t.id);
    setError(null);
    try {
      await setTodoDone(t, t.status === "open");
      todos.refetch();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const who = (id: string | null) => {
    if (!id) return null;
    if (id === session.userId) return "自分";
    return session.members[id] ?? "パートナー";
  };

  return (
    <main className="min-h-dvh bg-neutral-50 pb-44 dark:bg-neutral-950">
      <ScreenHeader
        title="予定"
        subtitle="やること"
        right={
          <Link
            href="/plan"
            className="flex h-10 items-center rounded-xl bg-neutral-100 px-3 text-xs font-bold text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"
          >
            カレンダー
          </Link>
        }
      >
        <button
          type="button"
          onClick={() => setShowDone((v) => !v)}
          className="mt-2 h-9 rounded-lg bg-neutral-100 px-3 text-xs font-bold text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"
        >
          {showDone ? "済んだものを隠す" : `済んだものも見る(${doneCount})`}
        </button>
      </ScreenHeader>

      {error && (
        <p className="mx-4 mt-3 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:bg-rose-950/50 dark:text-rose-300">
          {error}
        </p>
      )}

      <LoadNotice
        loading={todos.loading && todos.rows.length === 0}
        error={todos.error}
        empty={roots.length === 0 && !todos.loading}
        emptyText="やることはありません"
      />

      <ul className="mt-3 divide-y divide-neutral-100 border-y border-neutral-200 bg-white dark:divide-neutral-800 dark:border-neutral-800 dark:bg-neutral-900">
        {roots.map((t) => {
          const kids = childrenOf.get(t.id) ?? [];
          const openKids = kids.filter((k) => k.status === "open").length;
          return (
            <li key={t.id}>
              <TodoRow
                todo={t}
                today={today}
                busy={busy === t.id}
                assignee={who(t.assignee_id)}
                extra={kids.length > 0 ? `子 ${kids.length - openKids}/${kids.length}` : null}
                onToggle={() => void toggle(t)}
                onOpen={() => setSheet({ mode: "edit", todo: t })}
              />

              {kids.map((k) => (
                <div key={k.id} className="pl-8">
                  <TodoRow
                    todo={k}
                    today={today}
                    busy={busy === k.id}
                    assignee={who(k.assignee_id)}
                    extra={null}
                    small
                    onToggle={() => void toggle(k)}
                    onOpen={() => setSheet({ mode: "edit", todo: k })}
                  />
                </div>
              ))}

              {t.status === "open" && (
                <button
                  type="button"
                  onClick={() => setSheet({ mode: "add", parent: t })}
                  className="block h-10 w-full pl-8 text-left text-xs text-neutral-500 active:bg-neutral-100 dark:text-neutral-400 dark:active:bg-neutral-800"
                >
                  ＋ 子のやることを足す
                </button>
              )}
            </li>
          );
        })}
      </ul>

      <button
        type="button"
        aria-label="やることを追加"
        onClick={() => setSheet({ mode: "add", parent: null })}
        className="fixed bottom-[calc(env(safe-area-inset-bottom)+4.75rem)] right-5 z-40 flex size-16 items-center justify-center rounded-full bg-emerald-600 text-white shadow-lg active:bg-emerald-700"
      >
        <svg viewBox="0 0 24 24" className="size-8" fill="none" stroke="currentColor" strokeWidth={2.5}>
          <path d="M12 5v14M5 12h14" strokeLinecap="round" />
        </svg>
      </button>

      {sheet && (
        <TodoSheet
          existing={sheet.mode === "edit" ? sheet.todo : null}
          parent={sheet.mode === "add" ? sheet.parent : null}
          members={session.members}
          userId={session.userId}
          onClose={() => setSheet(null)}
          onSaved={() => {
            setSheet(null);
            todos.refetch();
          }}
        />
      )}
    </main>
  );
}

function TodoRow({
  todo,
  today,
  busy,
  assignee,
  extra,
  small,
  onToggle,
  onOpen,
}: {
  todo: Todo;
  today: string;
  busy: boolean;
  assignee: string | null;
  extra: string | null;
  small?: boolean;
  onToggle: () => void;
  onOpen: () => void;
}) {
  const done = todo.status === "done";
  const overdue = !done && todo.due_date != null && todo.due_date < today;
  const rel = todo.due_date ? relativeDay(todo.due_date) : null;

  return (
    <div className="flex items-start">
      {/* チェックは片手で押せるよう広く取る。行全体タップは編集に使う */}
      <button
        type="button"
        role="checkbox"
        aria-checked={done}
        aria-label={done ? "未完了に戻す" : "完了にする"}
        disabled={busy}
        onClick={onToggle}
        className="flex min-h-14 shrink-0 items-start py-3 pl-4 pr-3"
      >
        <span
          className={`flex size-6 items-center justify-center rounded-full border-2 ${
            done
              ? "border-emerald-600 bg-emerald-600 text-white"
              : "border-neutral-300 dark:border-neutral-600"
          }`}
        >
          {done && (
            <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth={3}>
              <path d="M5 12l5 5L19 7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </span>
      </button>

      <button
        type="button"
        onClick={onOpen}
        className="min-w-0 flex-1 py-3 pr-4 text-left"
      >
        <span
          className={`block ${small ? "text-[13px]" : "text-sm font-semibold"} ${
            done ? "text-neutral-400 line-through dark:text-neutral-600" : ""
          }`}
        >
          {todo.title}
        </span>
        <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-neutral-500 dark:text-neutral-400">
          {todo.due_date && (
            <span className={overdue ? "font-bold text-rose-600 dark:text-rose-400" : ""}>
              {overdue ? "期限切れ " : ""}
              {rel ?? formatDate(todo.due_date)}
            </span>
          )}
          {todo.repeat && todo.repeat !== "なし" && <span>🔁 {todo.repeat}</span>}
          {assignee && <span>{assignee}</span>}
          {extra && <span>{extra}</span>}
        </span>
        {todo.detail && (
          <span className="mt-0.5 block text-[11px] leading-relaxed text-neutral-500 dark:text-neutral-400">
            {todo.detail}
          </span>
        )}
      </button>
    </div>
  );
}

function TodoSheet({
  existing,
  parent,
  members,
  userId,
  onClose,
  onSaved,
}: {
  existing: Todo | null;
  parent: Todo | null;
  members: Record<string, string>;
  userId: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(existing?.title ?? "");
  const [detail, setDetail] = useState(existing?.detail ?? "");
  const [dueDate, setDueDate] = useState(existing?.due_date ?? "");
  const [assigneeId, setAssigneeId] = useState<string | null>(existing?.assignee_id ?? null);
  const [repeat, setRepeat] = useState<string>(existing?.repeat ?? "なし");
  // 新規で親を作るときだけ、子をまとめて入力できる。1つずつ足すのは手数が多い。
  const [subtasks, setSubtasks] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isChild = parent != null || existing?.parent_id != null;
  const partnerId = Object.keys(members).find((id) => id !== userId) ?? null;
  const owners: { id: string | null; label: string }[] = [
    { id: null, label: "決めない" },
    ...(userId ? [{ id: userId, label: "自分" }] : []),
    ...(partnerId ? [{ id: partnerId, label: members[partnerId] ?? "パートナー" }] : []),
  ];

  const submit = async () => {
    if (!title.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await saveTodo({
        id: existing?.id,
        title: title.trim(),
        detail: detail.trim() || null,
        dueDate: dueDate || null,
        assigneeId,
        parentId: existing ? existing.parent_id : (parent?.id ?? null),
        repeat: isChild ? "なし" : repeat,
      });

      // 子をまとめて足す。親を先に保存してから、その id にぶら下げる…のではなく、
      // 親の id はここでは分からないので、親の作成直後は子を入れない作りにしている。
      // (子を足すのは一覧の「＋ 子のやることを足す」から)
      const lines = subtasks
        .split("\n")
        .map((v) => v.trim())
        .filter(Boolean);
      if (lines.length > 0 && parent) {
        for (const line of lines) {
          await saveTodo({ title: line, parentId: parent.id });
        }
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
      await deleteTodo(existing.id);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet onClose={onClose}>
      <h2 className="text-base font-bold">
        {existing ? "やることを直す" : parent ? `「${parent.title}」の中に追加` : "やることを追加"}
      </h2>

      <label className="mt-3 block text-xs font-medium text-neutral-500">内容</label>
      <input
        autoFocus={!existing}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && title.trim() && void submit()}
        enterKeyHint="done"
        placeholder="例: 旅行の準備 / 保険の見直し"
        className="mt-1 h-12 w-full rounded-xl border border-neutral-300 bg-white px-3 text-base dark:border-neutral-700 dark:bg-neutral-800"
      />

      <label className="mt-3 block text-xs font-medium text-neutral-500">期限(任意)</label>
      <input
        type="date"
        value={dueDate}
        onChange={(e) => setDueDate(e.target.value)}
        className="mt-1 h-12 w-full rounded-xl border border-neutral-300 bg-white px-3 text-base dark:border-neutral-700 dark:bg-neutral-800"
      />

      {!isChild && (
        <>
          <label className="mt-3 block text-xs font-medium text-neutral-500">繰り返し</label>
          <div className="mt-1 grid grid-cols-4 gap-1">
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
            <p className="mt-1 text-[11px] text-neutral-500 dark:text-neutral-400">
              完了にすると、次の期限のものが自動で1件作られます
              {!dueDate && "(期限を入れてください)"}
            </p>
          )}
        </>
      )}

      <label className="mt-3 block text-xs font-medium text-neutral-500">担当</label>
      <div className="mt-1 flex gap-1 rounded-xl bg-neutral-100 p-1 dark:bg-neutral-800">
        {owners.map((o) => (
          <button
            key={o.label}
            type="button"
            onClick={() => setAssigneeId(o.id)}
            className={`h-11 flex-1 rounded-lg text-sm font-semibold ${
              assigneeId === o.id ? "bg-white shadow-sm dark:bg-neutral-700" : "text-neutral-500"
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>

      <label className="mt-3 block text-xs font-medium text-neutral-500">メモ(任意)</label>
      <textarea
        value={detail}
        onChange={(e) => setDetail(e.target.value)}
        rows={2}
        className="mt-1 w-full rounded-xl border border-neutral-300 bg-white p-3 text-base dark:border-neutral-700 dark:bg-neutral-800"
      />

      {!isChild && !existing && (
        <>
          <label className="mt-3 block text-xs font-medium text-neutral-500">
            中のやること(1行に1つ・任意)
          </label>
          <textarea
            value={subtasks}
            onChange={(e) => setSubtasks(e.target.value)}
            rows={3}
            placeholder={"宿を予約\n切符を買う\n保険に入る"}
            className="mt-1 w-full rounded-xl border border-neutral-300 bg-white p-3 text-base dark:border-neutral-700 dark:bg-neutral-800"
          />
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
          disabled={busy || !title.trim()}
          className="h-14 flex-[2] rounded-xl bg-emerald-600 text-base font-bold text-white disabled:opacity-40"
        >
          {busy ? "保存中…" : existing ? "保存する" : "追加する"}
        </button>
      </div>

      {existing && (
        <div className="mt-6 border-t border-neutral-200 pt-4 dark:border-neutral-800">
          <button
            type="button"
            onClick={() => void remove()}
            disabled={busy}
            className="h-14 w-full rounded-xl bg-rose-50 text-base font-bold text-rose-600 disabled:opacity-40 dark:bg-rose-950/50"
          >
            {existing.parent_id == null ? "これと、中のやること全部を削除" : "これを削除"}
          </button>
        </div>
      )}
    </Sheet>
  );
}
