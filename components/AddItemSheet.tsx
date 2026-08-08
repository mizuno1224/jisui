"use client";

import { useEffect, useRef, useState } from "react";
import { ALL_SECTIONS, FALLBACK_SECTION } from "@/lib/sections";
import { guessSection } from "@/lib/matching";
import {
  findDuplicate,
  loadRecentItems,
  mergeIntoItem,
  type NewItem,
  type RecentItem,
} from "@/lib/store";
import type { ShoppingItem } from "@/lib/types";

/**
 * 店で見つけたセール品をその場で足すための入力(設計書 フェーズ2-9)。
 * 開くたびに新しく mount される前提なので、初期値は useState のまま。
 */
export function AddItemSheet({
  onClose,
  onSubmit,
}: {
  onClose: () => void;
  onSubmit: (item: NewItem) => void;
}) {
  const [name, setName] = useState("");
  const [qty, setQty] = useState("");
  const [section, setSection] = useState<string>(FALLBACK_SECTION);
  // 手で売り場を選んだら、以後は打ち直しても勝手に変えない
  const [sectionTouched, setSectionTouched] = useState(false);
  const [recent, setRecent] = useState<RecentItem[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // シートが開ききってからフォーカスする
    const t = window.setTimeout(() => inputRef.current?.focus(), 80);
    return () => window.clearTimeout(t);
  }, []);

  useEffect(() => {
    void loadRecentItems().then(setRecent);
  }, []);

  const duplicate: ShoppingItem | null = name.trim() ? findDuplicate(name.trim()) : null;

  const add = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onSubmit({ item: trimmed, qty: qty.trim() || null, section, reason: null });
    onClose();
  };

  const submit = () => {
    // すでにあるのに気づかず足すと、店で同じ物を2つカゴに入れることになる
    if (duplicate) return;
    add();
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <button
        type="button"
        aria-label="閉じる"
        onClick={onClose}
        className="absolute inset-0 bg-black/40"
      />
      <div className="relative rounded-t-2xl bg-white pb-[env(safe-area-inset-bottom)] shadow-2xl dark:bg-neutral-900">
        <div className="px-4 pt-4 pb-5">
          <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-neutral-300 dark:bg-neutral-600" />
          <h2 className="mb-3 text-base font-bold">品目を追加</h2>

          {/* 打ち直さずに済むよう、前に足したものを出す。店内では入力が一番遅い */}
          {recent.length > 0 && !name.trim() && (
            <div className="-mx-4 mb-3 flex gap-1.5 overflow-x-auto px-4 pb-1">
              {recent.slice(0, 12).map((r) => (
                <button
                  key={r.item}
                  type="button"
                  onClick={() => {
                    setName(r.item);
                    if (r.qty) setQty(r.qty);
                    setSection(r.section);
                  }}
                  className="h-9 shrink-0 rounded-full bg-neutral-100 px-3 text-xs font-bold text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"
                >
                  {r.item}
                </button>
              ))}
            </div>
          )}

          <label className="block text-xs font-medium text-neutral-500">品名</label>
          <input
            ref={inputRef}
            value={name}
            onChange={(e) => {
              const next = e.target.value;
              setName(next);
              // 既定をセール枠にしていたため、家で足した「醤油」も店で足した
              // 「牛乳」も残り件数から外れ、買わずに帰る事故が起きていた。
              // 名前から売り場を推測し、当たらなければ要確認に落とす。
              if (!sectionTouched) setSection(guessSection(next));
            }}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            enterKeyHint="done"
            placeholder="例: 鶏もも肉"
            className="mt-1 h-12 w-full rounded-xl border border-neutral-300 bg-white px-3 text-base outline-none focus:border-emerald-500 dark:border-neutral-700 dark:bg-neutral-800"
          />

          <div className="mt-3 flex gap-3">
            <div className="flex-1">
              <label className="block text-xs font-medium text-neutral-500">数量</label>
              <input
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                placeholder="1パック"
                className="mt-1 h-12 w-full rounded-xl border border-neutral-300 bg-white px-3 text-base outline-none focus:border-emerald-500 dark:border-neutral-700 dark:bg-neutral-800"
              />
            </div>
          </div>

          {duplicate && (
            <div className="mt-3 rounded-xl bg-amber-50 px-3 py-2.5 dark:bg-amber-950/40">
              <p className="text-xs font-bold text-amber-900 dark:text-amber-200">
                すでにリストにあります
              </p>
              <p className="mt-0.5 text-xs text-amber-900 dark:text-amber-200">
                {duplicate.item}
                {duplicate.qty ? ` (${duplicate.qty})` : ""} · {duplicate.section ?? "要確認"}
              </p>
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    void mergeIntoItem(duplicate.id, qty.trim() || null);
                    onClose();
                  }}
                  className="h-11 flex-1 rounded-lg bg-amber-500 text-xs font-bold text-white"
                >
                  まとめる
                </button>
                <button
                  type="button"
                  onClick={add}
                  className="h-11 flex-1 rounded-lg bg-neutral-100 text-xs font-bold text-neutral-700 dark:bg-neutral-800 dark:text-neutral-200"
                >
                  別で足す
                </button>
              </div>
            </div>
          )}

          <label className="mt-3 block text-xs font-medium text-neutral-500">売り場</label>
          {/* select は iOS でホイールが出て2〜3操作かかる。チップなら1タップ */}
          <div className="mt-1 grid grid-cols-4 gap-1.5">
            {ALL_SECTIONS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => {
                  setSection(s);
                  setSectionTouched(true);
                }}
                className={`h-11 rounded-lg px-1 text-[11px] font-bold ${
                  section === s
                    ? s === "セール枠"
                      ? "bg-amber-400 text-amber-950"
                      : "bg-emerald-600 text-white"
                    : s === "セール枠"
                      ? "bg-amber-100 text-amber-900"
                      : "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"
                }`}
              >
                {s}
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
    </div>
  );
}
