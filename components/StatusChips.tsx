"use client";

import type { Snapshot } from "@/lib/store";

/** 同期の状態を小さく出す。うるさくならないよう、伝えることがある時だけ表示する。 */
export function StatusChips({
  snapshot,
  onSync,
}: {
  snapshot: Snapshot;
  onSync: () => void;
}) {
  const chips: { key: string; label: string; className: string; onClick?: () => void }[] = [];

  if (!snapshot.online) {
    chips.push({
      key: "offline",
      label: "オフライン",
      className: "bg-neutral-200 text-neutral-700 dark:bg-neutral-700 dark:text-neutral-200",
    });
  }
  if (snapshot.pending > 0) {
    chips.push({
      key: "pending",
      label: `未送信 ${snapshot.pending}(押すと送信)`,
      className: "bg-amber-100 text-amber-900",
      onClick: onSync,
    });
  }
  if (snapshot.syncing) {
    chips.push({ key: "syncing", label: "同期中…", className: "bg-sky-100 text-sky-900" });
  }
  if (snapshot.mode === "local") {
    chips.push({
      key: "local",
      label: "ローカルモード",
      className: "bg-violet-100 text-violet-900",
    });
  }
  if (snapshot.discarded.length > 0) {
    chips.push({
      key: "discarded",
      label: `送れなかった ${snapshot.discarded.length}`,
      className: "bg-rose-100 text-rose-900",
    });
  }
  if (snapshot.error) {
    chips.push({
      key: "error",
      label: "同期エラー",
      className: "bg-rose-100 text-rose-900",
      onClick: onSync,
    });
  }

  if (chips.length === 0) return null;

  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {chips.map((c) =>
        c.onClick ? (
          <button
            key={c.key}
            type="button"
            onClick={c.onClick}
            className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${c.className}`}
          >
            {c.label}
          </button>
        ) : (
          <span
            key={c.key}
            className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${c.className}`}
          >
            {c.label}
          </span>
        ),
      )}
    </div>
  );
}
