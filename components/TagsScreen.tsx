"use client";

import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import { ScreenHeader, LoadNotice } from "@/components/ScreenHeader";
import { Sheet } from "@/components/Sheet";
import { deleteTag, saveTag } from "@/lib/mutations";
import { getServerSnapshot, getSnapshot, subscribe } from "@/lib/store";
import { TAG_COLORS, TAG_COLOR_KEYS, type TagColor } from "@/lib/tags";
import { useTable } from "@/lib/use-table";
import type { CalendarTag } from "@/lib/types";

/**
 * 予定のタグ。色分けと、非公開の設定。
 *
 * 【非公開タグとは】
 * そのタグを付けた予定は、作った本人しか見られない。
 * 相手の画面にはその予定が存在しない。「見えるけど灰色」ではなく、
 * その日は空いているように見える。だから予定を合わせたいものには使わない。
 *
 * 隠しているのはデータベース側(RLS)。アプリが表示を絞っているのではないので、
 * 相手の端末には中身が届かない。
 */
export function TagsScreen() {
  const session = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const tags = useTable<CalendarTag>("calendar_tags", { orderBy: "sort_order" });
  const [editing, setEditing] = useState<CalendarTag | null>(null);
  const [adding, setAdding] = useState(false);

  const shared = tags.rows.filter((t) => !t.private);
  const mine = tags.rows.filter((t) => t.private);

  return (
    <main className="min-h-dvh bg-neutral-50 pb-44 dark:bg-neutral-950">
      <ScreenHeader
        title="予定"
        subtitle="タグ"
        right={
          <Link
            href="/plan"
            className="flex h-10 items-center rounded-xl bg-neutral-100 px-3 text-xs font-bold text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"
          >
            カレンダー
          </Link>
        }
      />

      <LoadNotice
        loading={tags.loading && tags.rows.length === 0}
        error={tags.error}
        empty={false}
        emptyText=""
      />

      <section className="mt-4">
        <h2 className="px-4 pb-2 text-xs font-bold text-neutral-500">
          共有のタグ({shared.length})
        </h2>
        <p className="px-4 pb-2 text-[11px] text-neutral-500 dark:text-neutral-400">
          このタグの予定は2人とも見られます
        </p>
        <TagList tags={shared} onEdit={setEditing} />
      </section>

      <section className="mt-6">
        <h2 className="px-4 pb-2 text-xs font-bold text-neutral-500">
          🔒 自分だけのタグ({mine.length})
        </h2>
        <p className="px-4 pb-2 text-[11px] leading-relaxed text-neutral-500 dark:text-neutral-400">
          このタグを付けた予定は<strong>相手からは見えません</strong>。
          相手の画面にはその予定が存在しないので、その時間が空いているように見えます。
          予定を合わせたいものには使わないでください。
        </p>
        {mine.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-neutral-400 dark:text-neutral-600">
            まだありません
          </p>
        ) : (
          <TagList tags={mine} onEdit={setEditing} />
        )}
      </section>

      <div className="px-4 pt-6">
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="h-14 w-full rounded-xl bg-emerald-600 text-base font-bold text-white"
        >
          タグを追加
        </button>
      </div>

      {(adding || editing) && (
        <TagSheet
          existing={editing}
          canMakePrivate={Boolean(session.userId)}
          onClose={() => {
            setAdding(false);
            setEditing(null);
          }}
          onSaved={() => {
            setAdding(false);
            setEditing(null);
            tags.refetch();
          }}
        />
      )}
    </main>
  );
}

function TagList({
  tags,
  onEdit,
}: {
  tags: CalendarTag[];
  onEdit: (t: CalendarTag) => void;
}) {
  return (
    <ul className="divide-y divide-neutral-100 border-y border-neutral-200 bg-white dark:divide-neutral-800 dark:border-neutral-800 dark:bg-neutral-900">
      {tags.map((t) => {
        const style = TAG_COLORS[t.color as TagColor] ?? TAG_COLORS.violet;
        return (
          <li key={t.id}>
            <button
              type="button"
              onClick={() => onEdit(t)}
              className="flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left"
            >
              <span className={`size-4 shrink-0 rounded-full ${style.bar}`} />
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{t.name}</span>
              {!t.active && (
                <span className="shrink-0 text-[11px] text-neutral-400">使っていない</span>
              )}
              <span className="shrink-0 text-neutral-300 dark:text-neutral-600">›</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function TagSheet({
  existing,
  canMakePrivate,
  onClose,
  onSaved,
}: {
  existing: CalendarTag | null;
  canMakePrivate: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(existing?.name ?? "");
  const [color, setColor] = useState<TagColor>(
    (existing?.color as TagColor) in TAG_COLORS ? (existing!.color as TagColor) : "violet",
  );
  const [isPrivate, setIsPrivate] = useState(existing?.private ?? false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await saveTag({
        id: existing?.id,
        name: name.trim(),
        color,
        isPrivate,
      });
      onSaved();
    } catch (e) {
      setError(readable(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!existing) return;
    setBusy(true);
    setError(null);
    try {
      await deleteTag(existing.id);
      onSaved();
    } catch (e) {
      setError(readable(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet onClose={onClose}>
      <h2 className="text-base font-bold">{existing ? "タグを直す" : "タグを追加"}</h2>

      <label className="mt-3 block text-xs font-medium text-neutral-500">名前</label>
      <input
        autoFocus={!existing}
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="例: 仕事 / 通院 / 子どものこと"
        className="mt-1 h-12 w-full rounded-xl border border-neutral-300 bg-white px-3 text-base dark:border-neutral-700 dark:bg-neutral-800"
      />

      <label className="mt-3 block text-xs font-medium text-neutral-500">色</label>
      <div className="mt-1 grid grid-cols-8 gap-2">
        {TAG_COLOR_KEYS.map((c) => (
          <button
            key={c}
            type="button"
            aria-label={c}
            onClick={() => setColor(c)}
            className={`flex h-11 items-center justify-center rounded-lg ${
              color === c ? "ring-2 ring-neutral-900 dark:ring-white" : ""
            }`}
          >
            <span className={`size-6 rounded-full ${TAG_COLORS[c].bar}`} />
          </button>
        ))}
      </div>

      {existing ? (
        <p className="mt-4 rounded-xl bg-neutral-100 px-3 py-2.5 text-[11px] leading-relaxed text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
          {existing.private ? "🔒 自分だけのタグです。" : "共有のタグです。"}
          <br />
          <strong>見える範囲は後から変えられません。</strong>
          共有 → 非公開にすると相手が使っていた予定が予告なく相手の画面から消え、
          非公開 → 共有にすると隠していた過去の予定が一気に相手に出るためです。
          変えたいときは新しいタグを作って、予定を付け替えてください。
        </p>
      ) : (
        <>
          <label className="mt-4 block text-xs font-medium text-neutral-500">見える範囲</label>
          <div className="mt-1 flex gap-1 rounded-xl bg-neutral-100 p-1 dark:bg-neutral-800">
            <button
              type="button"
              onClick={() => setIsPrivate(false)}
              className={`h-12 flex-1 rounded-lg text-sm font-semibold ${
                !isPrivate ? "bg-white shadow-sm dark:bg-neutral-700" : "text-neutral-500"
              }`}
            >
              2人で共有
            </button>
            <button
              type="button"
              disabled={!canMakePrivate}
              onClick={() => setIsPrivate(true)}
              className={`h-12 flex-1 rounded-lg text-sm font-semibold disabled:opacity-40 ${
                isPrivate ? "bg-white shadow-sm dark:bg-neutral-700" : "text-neutral-500"
              }`}
            >
              🔒 自分だけ
            </button>
          </div>
          <p className="mt-1.5 rounded-xl bg-neutral-100 px-3 py-2.5 text-[11px] leading-relaxed text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
            {isPrivate ? (
              <>
                このタグを付けた予定は<strong>相手からは見えません</strong>。
                件名も場所もメモも届かず、その予定が存在しないように見えます。
                相手からは空いている時間に見えるので、予定を合わせたいものには使わないでください。
                <br />
                Cowork から「今週の予定をまとめて」と頼んでも、ここに入れた予定は出てきません。
              </>
            ) : (
              <>今までどおり2人とも見られます。</>
            )}
            <br />
            <strong>この設定は後から変えられません。</strong>作るときに決めてください。
          </p>
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
          disabled={busy || !name.trim()}
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
            このタグを削除
          </button>
          <p className="mt-2 text-[11px] leading-relaxed text-neutral-500 dark:text-neutral-400">
            使っている予定がある非公開タグは消せません(消しても予定は隠れたまま残り、
            どこから直せばよいか分からなくなるため)。先に予定を別のタグに付け替えてください。
          </p>
        </div>
      )}
    </Sheet>
  );
}

/** データベースから返る英語のエラーを、そのまま出しても分からないので置き換える。 */
function readable(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (msg.includes("duplicate key")) return "同じ名前のタグがすでにあります。";
  if (msg.includes("使っている予定がある")) return msg;
  if (msg.includes("非公開タグ")) return msg;
  if (msg.includes("変えられません")) return msg;
  return msg;
}
