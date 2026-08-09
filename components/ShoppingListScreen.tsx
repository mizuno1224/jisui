"use client";

import Link from "next/link";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AddItemSheet } from "@/components/AddItemSheet";
import { MoveToInventorySheet } from "@/components/MoveToInventorySheet";
import { StatusChips } from "@/components/StatusChips";
import { ItemRow } from "@/components/ItemRow";
import { Snackbar } from "@/components/Snackbar";
import {
  ALL_SECTIONS,
  SALE_SECTION,
  SECTION_STYLE,
  normalizeSection,
  type SectionName,
} from "@/lib/sections";
import {
  addItem,
  dismissDiscarded,
  removeItem,
  signOut,
  startPolling,
  syncNow,
  toggle,
  type NewItem,
} from "@/lib/store";
import type { ShoppingItem } from "@/lib/types";
import { useShoppingStore } from "@/lib/use-store";

export function ShoppingListScreen() {
  const snapshot = useShoppingStore();
  const [addOpen, setAddOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [actionTarget, setActionTarget] = useState<ShoppingItem | null>(null);
  const [moveOpen, setMoveOpen] = useState(false);
  const [undo, setUndo] = useState<{ message: string; run: () => void } | null>(null);
  const headerRef = useRef<HTMLElement>(null);

  // 店内を歩いている間、相手のチェックを取りに行く。
  // 何もタップしないと同期のきっかけが無く、同じ物を2人が買ってしまう。
  useEffect(() => startPolling(), []);

  const { items, userId, members } = snapshot;

  // ヘッダーは同期状況のバッジで高さが変わる。売り場見出しの追従位置をそれに合わせる。
  useLayoutEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const apply = () =>
      document.documentElement.style.setProperty("--header-h", `${el.offsetHeight}px`);
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(el);
    return () => observer.disconnect();
    // 読み込み中/未ログインの画面からリストに切り替わった時点で貼り直す
  }, [snapshot.status, snapshot.signedIn]);

  const sections = useMemo(() => {
    const map = new Map<SectionName, ShoppingItem[]>();
    for (const item of items) {
      const name = normalizeSection(item.section);
      const list = map.get(name);
      if (list) list.push(item);
      else map.set(name, [item]);
    }
    return ALL_SECTIONS.filter((s) => map.has(s)).map((s) => ({
      name: s,
      items: map.get(s)!,
    }));
  }, [items]);

  // セール枠は「安ければ買う」候補なので残り件数に含めない(設計書 3-2)
  const counted = items.filter((i) => normalizeSection(i.section) !== SALE_SECTION);
  const remaining = counted.filter((i) => i.status === "未購入").length;
  // 在庫へ流し込む対象。セール枠で買ったものも含める(買ったことに変わりはない)
  const checkedItems = items.filter((i) => i.status === "購入済");
  const done = counted.length - remaining;
  const progress = counted.length === 0 ? 0 : (done / counted.length) * 100;

  const labelFor = (item: ShoppingItem): string | null => {
    if (!item.checked_by) return null;
    if (item.checked_by === userId) return "自分";
    return members[item.checked_by] ?? "パートナー";
  };

  const handleAdd = (input: NewItem) => {
    void addItem(input);
  };

  if (snapshot.status === "loading") {
    return (
      <main className="flex min-h-dvh items-center justify-center text-sm text-neutral-500 dark:text-neutral-400">
        読み込み中…
      </main>
    );
  }

  // 一度もログインしていないときだけ、ログインを促す画面にする。
  // 切れただけの場合は手元のリストを見せたまま、入り直す帯を上に出す。
  if (snapshot.mode === "cloud" && !snapshot.signedIn && !snapshot.authExpired) {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-6 px-8 text-center">
        <div>
          <p className="text-2xl font-bold">買い物リスト</p>
          <p className="mt-2 text-sm text-neutral-500">
            2人で共有するには、最初に1回だけログインしてください。
          </p>
        </div>
        <Link
          href="/login"
          className="flex h-14 w-full max-w-xs items-center justify-center rounded-xl bg-emerald-600 text-base font-bold text-white"
        >
          ログインする
        </Link>
      </main>
    );
  }

  return (
    <main className="min-h-dvh bg-neutral-50 pb-44 dark:bg-neutral-950">
      <header
        ref={headerRef}
        className="sticky top-0 z-30 border-b border-neutral-200 bg-white/95 px-4 pt-[calc(env(safe-area-inset-top)+0.75rem)] pb-3 backdrop-blur dark:border-neutral-800 dark:bg-neutral-900/95"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xs font-medium tracking-wide text-neutral-500">買い物リスト</h1>
            <p className="mt-0.5 text-2xl font-bold leading-tight">
              残り {remaining}
              <span className="text-base font-medium text-neutral-500 dark:text-neutral-400"> / {counted.length}</span>
            </p>
          </div>

          <div className="relative shrink-0">
            <button
              type="button"
              aria-label="メニュー"
              onClick={() => setMenuOpen((v) => !v)}
              className="flex size-11 items-center justify-center rounded-full text-neutral-500 active:bg-neutral-100 dark:active:bg-neutral-800"
            >
              <svg viewBox="0 0 24 24" className="size-6" fill="currentColor">
                <circle cx="12" cy="5" r="2" />
                <circle cx="12" cy="12" r="2" />
                <circle cx="12" cy="19" r="2" />
              </svg>
            </button>
            {menuOpen && (
              <>
                <div className="absolute right-0 z-20 mt-1 w-52 overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-lg dark:border-neutral-700 dark:bg-neutral-800">
                  {checkedItems.length > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        setMenuOpen(false);
                        setMoveOpen(true);
                      }}
                      className="block h-12 w-full border-b border-neutral-100 px-4 text-left text-sm font-semibold text-emerald-700 active:bg-neutral-100 dark:border-neutral-700 dark:text-emerald-400 dark:active:bg-neutral-700"
                    >
                      買った分を在庫に入れる({checkedItems.length})
                    </button>
                  )}
                  <Link
                    href="/help"
                    onClick={() => setMenuOpen(false)}
                    className="block h-12 w-full px-4 text-left text-sm leading-[3rem] active:bg-neutral-100 dark:active:bg-neutral-700"
                  >
                    使い方
                  </Link>
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      void syncNow();
                    }}
                    className="block h-12 w-full border-t border-neutral-100 px-4 text-left text-sm active:bg-neutral-100 dark:border-neutral-700 dark:active:bg-neutral-700"
                  >
                    いま同期する
                  </button>
                  {snapshot.mode === "cloud" && (
                    <button
                      type="button"
                      onClick={() => {
                        setMenuOpen(false);
                        void signOut();
                      }}
                      className="block h-12 w-full border-t border-neutral-100 px-4 text-left text-sm text-rose-600 active:bg-neutral-100 dark:border-neutral-700 dark:active:bg-neutral-700"
                    >
                      サインアウト
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        </div>

        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800">
          <div
            className="h-full rounded-full bg-emerald-500 transition-[width] duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>

        <StatusChips snapshot={snapshot} onSync={() => void syncNow()} />

        {snapshot.authExpired && (
          <div className="mt-2 flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 dark:bg-amber-950/40">
            <span className="flex-1 text-xs font-semibold text-amber-900 dark:text-amber-200">
              ログインが切れました。チェックは手元に残っています。
            </span>
            <Link
              href="/login"
              className="shrink-0 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-bold text-white"
            >
              入り直す
            </Link>
          </div>
        )}
      </header>

      {items.length === 0 ? (
        <p className="px-6 py-20 text-center text-sm text-neutral-500 dark:text-neutral-400">
          リストは空です。右下の + で追加できます。
        </p>
      ) : (
        <div className="pt-2">
          {remaining === 0 && counted.length > 0 && (
            <p className="mx-4 mt-2 rounded-xl bg-emerald-50 px-4 py-3 text-center text-sm font-semibold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">
              買うものは全部そろいました 🎉
            </p>
          )}

          {sections.map(({ name, items: sectionItems }) => {
            const style = SECTION_STYLE[name];
            const isSale = name === SALE_SECTION;
            return (
              <section key={name} className="mt-3">
                <h2
                  style={{ top: "var(--header-h, 7.5rem)" }}
                  className="sticky z-10 flex items-center gap-2 bg-neutral-50/95 px-4 py-1.5 backdrop-blur dark:bg-neutral-950/95"
                >
                  <span
                    className={`rounded-full px-2.5 py-1 text-xs font-bold ${style.chip}`}
                  >
                    {style.icon} {name}
                  </span>
                  {/* 売り場ごとの残りが分かると、その場を離れてよいか判断できる */}
                  {!isSale && (
                    <span className="text-[11px] font-semibold text-neutral-600 dark:text-neutral-300">
                      残り {sectionItems.filter((i) => i.status === "未購入").length}/
                      {sectionItems.length}
                    </span>
                  )}
                  {isSale && (
                    <span className="text-[11px] text-neutral-500">安ければ買う候補</span>
                  )}
                </h2>
                <ul
                  className={`divide-y divide-neutral-100 border-y dark:divide-neutral-800 ${
                    isSale
                      ? "border-amber-200 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-950/30"
                      : "border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900"
                  }`}
                >
                  {sectionItems.map((item) => (
                    <ItemRow
                      key={String(item.id)}
                      item={item}
                      checkedByLabel={labelFor(item)}
                      onToggle={(i) => {
                        void toggle(i.id);
                        setUndo({
                          message:
                            i.status === "未購入"
                              ? `${i.item} をチェックしました`
                              : `${i.item} のチェックを外しました`,
                          run: () => void toggle(i.id),
                        });
                      }}
                      onLongPress={setActionTarget}
                    />
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}

      <button
        type="button"
        aria-label="品目を追加"
        onClick={() => setAddOpen(true)}
        className="fixed bottom-[calc(env(safe-area-inset-bottom)+4.75rem)] right-5 z-40 flex size-16 items-center justify-center rounded-full bg-emerald-600 text-white shadow-lg active:bg-emerald-700"
      >
        <svg viewBox="0 0 24 24" className="size-8" fill="none" stroke="currentColor" strokeWidth={2.5}>
          <path d="M12 5v14M5 12h14" strokeLinecap="round" />
        </svg>
      </button>

      {addOpen && <AddItemSheet onClose={() => setAddOpen(false)} onSubmit={handleAdd} />}

      {moveOpen && (
        <MoveToInventorySheet checked={checkedItems} onClose={() => setMoveOpen(false)} />
      )}

      {/* メニューを閉じる面。ヘッダの中に置くと backdrop-blur が
          fixed の基準になり、ヘッダの高さぶんしか広がらず、
          画面下をタップしたときに背後の商品行が反応していた */}
      {menuOpen && (
        <button
          type="button"
          aria-label="メニューを閉じる"
          className="fixed inset-0 z-20 cursor-default"
          onClick={() => setMenuOpen(false)}
        />
      )}

      {undo && (
        <Snackbar
          message={undo.message}
          onAction={() => {
            undo.run();
            setUndo(null);
          }}
          onDismiss={() => setUndo(null)}
        />
      )}

      {/* 取り消しの帯と同じ位置に出ると「取り消す」を押せなくなる。
          取り消しが出ている間は待つ。 */}
      {snapshot.discarded.length > 0 && !undo && (
        <Snackbar
          message={`送れなかった操作が ${snapshot.discarded.length} 件あります`}
          actionLabel="閉じる"
          timeoutMs={12000}
          onAction={dismissDiscarded}
          onDismiss={dismissDiscarded}
        />
      )}

      {actionTarget && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end">
          <button
            type="button"
            aria-label="閉じる"
            onClick={() => setActionTarget(null)}
            className="absolute inset-0 bg-black/40"
          />
          <div className="relative rounded-t-2xl bg-white px-4 pt-4 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] dark:bg-neutral-900">
            <p className="mb-3 truncate text-center text-sm text-neutral-500">
              {actionTarget.item}
            </p>
            <button
              type="button"
              onClick={() => {
                const removed = actionTarget;
                void removeItem(removed.id);
                setActionTarget(null);
                setUndo({
                  message: `${removed.item} を削除しました`,
                  run: () =>
                    void addItem({
                      item: removed.item,
                      qty: removed.qty,
                      section: removed.section ?? "要確認",
                      reason: removed.reason,
                    }),
                });
              }}
              className="h-14 w-full rounded-xl bg-rose-50 text-base font-bold text-rose-600 dark:bg-rose-950/50"
            >
              リストから削除
            </button>
            <button
              type="button"
              onClick={() => setActionTarget(null)}
              className="mt-2 h-14 w-full rounded-xl bg-neutral-100 text-base font-semibold text-neutral-700 dark:bg-neutral-800 dark:text-neutral-200"
            >
              やめる
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
