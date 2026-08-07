"use client";

import { useState } from "react";
import { monthLabel } from "@/lib/dates";
import { saveBudget } from "@/lib/mutations";
import { EXPENSE_CATEGORIES, type Budget } from "@/lib/types";

/**
 * 費目ごとの上限。
 * 既定は「毎月同じ」で持ち、特定の月だけ変えたいとき(旅行月など)は
 * その月ぶんを上書きできるようにしてある。
 */
export function BudgetSheet({
  budgets,
  month,
  onClose,
  onSaved,
}: {
  budgets: Budget[];
  month: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [scope, setScope] = useState<"毎月" | "この月だけ">("毎月");
  const [values, setValues] = useState<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    for (const c of EXPENSE_CATEGORIES) {
      const row = budgets.find((b) => b.category === c && b.year_month === null);
      out[c] = row ? String(row.amount) : "";
    }
    return out;
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const switchScope = (next: "毎月" | "この月だけ") => {
    setScope(next);
    const target = next === "毎月" ? null : month;
    const out: Record<string, string> = {};
    for (const c of EXPENSE_CATEGORIES) {
      const row = budgets.find((b) => b.category === c && b.year_month === target);
      out[c] = row ? String(row.amount) : "";
    }
    setValues(out);
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const yearMonth = scope === "毎月" ? null : month;
      for (const c of EXPENSE_CATEGORIES) {
        const raw = values[c]?.trim();
        if (!raw) continue;
        const n = Number(raw);
        if (Number.isNaN(n) || n <= 0) continue;
        await saveBudget(c, Math.round(n), yearMonth);
      }
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
        <h2 className="text-base font-bold">予算を決める</h2>
        <p className="mt-1 text-xs text-neutral-500">
          空欄のままにした費目は、予算なし(表示されない)になります。
        </p>

        <div className="mt-3 flex gap-1 rounded-xl bg-neutral-100 p-1 dark:bg-neutral-800">
          {(["毎月", "この月だけ"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => switchScope(s)}
              className={`h-11 flex-1 rounded-lg text-sm font-semibold ${
                scope === s ? "bg-white shadow-sm dark:bg-neutral-700" : "text-neutral-500"
              }`}
            >
              {s === "毎月" ? "毎月の既定" : `${monthLabel(month)}だけ`}
            </button>
          ))}
        </div>

        <ul className="mt-3 divide-y divide-neutral-100 dark:divide-neutral-800">
          {EXPENSE_CATEGORIES.map((c) => (
            <li key={c} className="flex items-center gap-3 py-2">
              <span className="w-24 shrink-0 text-sm font-semibold">{c}</span>
              <input
                type="number"
                inputMode="numeric"
                value={values[c] ?? ""}
                onChange={(e) => setValues((prev) => ({ ...prev, [c]: e.target.value }))}
                placeholder="—"
                className="h-11 flex-1 rounded-xl border border-neutral-300 bg-white px-3 text-right text-base tabular-nums dark:border-neutral-700 dark:bg-neutral-800"
              />
              <span className="shrink-0 text-xs text-neutral-400">円</span>
            </li>
          ))}
        </ul>

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
            disabled={busy}
            className="h-14 flex-[2] rounded-xl bg-emerald-600 text-base font-bold text-white disabled:opacity-40"
          >
            {busy ? "保存中…" : "保存する"}
          </button>
        </div>
      </div>
    </div>
  );
}
