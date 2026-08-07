"use client";

import { useState } from "react";
import { todayISO } from "@/lib/dates";
import { deleteTransaction, saveTransaction } from "@/lib/mutations";
import { EXPENSE_CATEGORIES, type Transaction } from "@/lib/types";

/** 手入力の支出。現金払いなど、レシートを撮らなかったものを入れる用。 */
export function TransactionSheet({
  existing,
  defaultMonth,
  onClose,
  onSaved,
}: {
  existing: Transaction | null;
  defaultMonth: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [date, setDate] = useState(
    existing?.date ?? (defaultMonth === todayISO().slice(0, 7) ? todayISO() : `${defaultMonth}-01`),
  );
  const [amount, setAmount] = useState(existing ? String(existing.amount) : "");
  const [merchant, setMerchant] = useState(existing?.merchant_raw ?? "");
  const [category, setCategory] = useState(existing?.category ?? "食費");
  const [memo, setMemo] = useState(existing?.memo ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const n = Number(amount);
    if (!merchant.trim() || Number.isNaN(n) || n <= 0) return;
    setBusy(true);
    setError(null);
    try {
      await saveTransaction({
        id: existing?.id,
        date,
        amount: Math.round(n),
        merchant: merchant.trim(),
        category,
        source: existing?.source ?? "手入力",
        memo: memo.trim() || null,
      });
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
      await deleteTransaction(existing.id);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <button type="button" aria-label="閉じる" onClick={onClose} className="absolute inset-0 bg-black/40" />
      <div className="relative max-h-[88dvh] overflow-y-auto rounded-t-2xl bg-white px-4 pt-4 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] dark:bg-neutral-900">
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-neutral-300 dark:bg-neutral-600" />
        <h2 className="text-base font-bold">{existing ? "支出を修正" : "支出を追加"}</h2>

        <div className="mt-3 flex gap-3">
          <div className="flex-1">
            <label className="block text-xs font-medium text-neutral-500">日付</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="mt-1 h-12 w-full rounded-xl border border-neutral-300 bg-white px-3 text-base dark:border-neutral-700 dark:bg-neutral-800"
            />
          </div>
          <div className="flex-1">
            <label className="block text-xs font-medium text-neutral-500">金額(円)</label>
            <input
              type="number"
              inputMode="numeric"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="3070"
              className="mt-1 h-12 w-full rounded-xl border border-neutral-300 bg-white px-3 text-base tabular-nums dark:border-neutral-700 dark:bg-neutral-800"
            />
          </div>
        </div>

        <label className="mt-3 block text-xs font-medium text-neutral-500">店名・内容</label>
        <input
          value={merchant}
          onChange={(e) => setMerchant(e.target.value)}
          placeholder="例: ライフ 西宮店"
          className="mt-1 h-12 w-full rounded-xl border border-neutral-300 bg-white px-3 text-base dark:border-neutral-700 dark:bg-neutral-800"
        />

        <label className="mt-3 block text-xs font-medium text-neutral-500">費目</label>
        <div className="-mx-4 mt-1 flex gap-1.5 overflow-x-auto px-4 pb-1">
          {EXPENSE_CATEGORIES.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCategory(c)}
              className={`h-10 shrink-0 rounded-full px-3.5 text-xs font-bold ${
                category === c
                  ? "bg-emerald-600 text-white"
                  : "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"
              }`}
            >
              {c}
            </button>
          ))}
        </div>

        <label className="mt-3 block text-xs font-medium text-neutral-500">メモ(任意)</label>
        <input
          value={memo}
          onChange={(e) => setMemo(e.target.value)}
          className="mt-1 h-12 w-full rounded-xl border border-neutral-300 bg-white px-3 text-base dark:border-neutral-700 dark:bg-neutral-800"
        />

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
            disabled={busy || !merchant.trim() || !amount}
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
            この記録を削除
          </button>
        )}
      </div>
    </div>
  );
}
