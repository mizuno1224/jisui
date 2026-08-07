"use client";

import { useEffect, useRef, useState } from "react";
import { ALL_SECTIONS, SALE_SECTION } from "@/lib/sections";
import type { NewItem } from "@/lib/store";

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
  const [section, setSection] = useState<string>(SALE_SECTION);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // シートが開ききってからフォーカスする
    const t = window.setTimeout(() => inputRef.current?.focus(), 80);
    return () => window.clearTimeout(t);
  }, []);

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onSubmit({
      item: trimmed,
      qty: qty.trim() || null,
      section,
      reason: null,
    });
    onClose();
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

          <label className="block text-xs font-medium text-neutral-500">品名</label>
          <input
            ref={inputRef}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            enterKeyHint="done"
            placeholder="例: 鶏もも肉"
            className="mt-1 h-12 w-full rounded-xl border border-neutral-300 bg-white px-3 text-base outline-none focus:border-emerald-500 dark:border-neutral-700 dark:bg-neutral-800"
          />

          <div className="mt-3 flex gap-3">
            <div className="w-1/3">
              <label className="block text-xs font-medium text-neutral-500">数量</label>
              <input
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                placeholder="1パック"
                className="mt-1 h-12 w-full rounded-xl border border-neutral-300 bg-white px-3 text-base outline-none focus:border-emerald-500 dark:border-neutral-700 dark:bg-neutral-800"
              />
            </div>
            <div className="flex-1">
              <label className="block text-xs font-medium text-neutral-500">売り場</label>
              <select
                value={section}
                onChange={(e) => setSection(e.target.value)}
                className="mt-1 h-12 w-full rounded-xl border border-neutral-300 bg-white px-3 text-base outline-none focus:border-emerald-500 dark:border-neutral-700 dark:bg-neutral-800"
              >
                {ALL_SECTIONS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
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
