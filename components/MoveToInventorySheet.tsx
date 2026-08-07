"use client";

import { useState } from "react";
import { addMany } from "@/lib/inventory-store";
import { todayISO } from "@/lib/dates";
import { removeItem as removeShoppingItem } from "@/lib/store";
import { LOCATIONS, type Location, type ShoppingItem } from "@/lib/types";

/** 売り場から置き場所を推測する。外れていてもチップを押せば変えられる。 */
function guessLocation(section: string | null): Location {
  if (section === "冷凍") return "冷凍";
  if (section === "調味料" || section === "加工品・その他") return "常温";
  return "冷蔵";
}

/** 「1丁」「2枚」→ 数量と単位に分ける。「安ければ」のような文言は1個として扱う。 */
function parseQty(qty: string | null): { qty: number; unit: string | null } {
  if (!qty) return { qty: 1, unit: null };
  const m = qty.trim().match(/^([0-9]+(?:\.[0-9]+)?)\s*(.*)$/);
  if (!m) return { qty: 1, unit: null };
  return { qty: Number(m[1]), unit: m[2].trim() || null };
}

type Row = {
  source: ShoppingItem;
  location: Location;
  qty: number;
  unit: string | null;
};

export function MoveToInventorySheet({
  checked,
  onClose,
}: {
  checked: ShoppingItem[];
  onClose: () => void;
}) {
  const [rows, setRows] = useState<Row[]>(() =>
    checked.map((item) => ({
      source: item,
      location: guessLocation(item.section),
      ...parseQty(item.qty),
    })),
  );
  const [busy, setBusy] = useState(false);

  const cycleLocation = (id: string) =>
    setRows((prev) =>
      prev.map((r) =>
        String(r.source.id) === id
          ? { ...r, location: LOCATIONS[(LOCATIONS.indexOf(r.location) + 1) % LOCATIONS.length] }
          : r,
      ),
    );

  const submit = async () => {
    setBusy(true);
    const today = todayISO();
    await addMany(
      rows.map((r) => ({
        name: r.source.item,
        qty: r.qty,
        unit: r.unit,
        location: r.location,
        bought_on: today,
      })),
    );
    // 買い終わった品目はリストから消す。次の買い物で使い回せるようにするため。
    for (const r of rows) await removeShoppingItem(r.source.id);
    setBusy(false);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <button type="button" aria-label="閉じる" onClick={onClose} className="absolute inset-0 bg-black/40" />
      <div className="relative max-h-[85dvh] overflow-y-auto rounded-t-2xl bg-white px-4 pt-4 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] dark:bg-neutral-900">
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-neutral-300 dark:bg-neutral-600" />
        <h2 className="text-base font-bold">買った分を在庫に入れる</h2>
        <p className="mt-1 text-xs text-neutral-500">
          置き場所は売り場から推測しています。違うものはタップして切り替えてください。
        </p>

        <ul className="mt-3 divide-y divide-neutral-100 dark:divide-neutral-800">
          {rows.map((r) => (
            <li key={String(r.source.id)} className="flex items-center gap-2 py-2.5">
              <span className="min-w-0 flex-1 truncate text-[15px] font-semibold">
                {r.source.item}
              </span>
              <span className="shrink-0 text-xs text-neutral-500">
                {r.qty}
                {r.unit ?? ""}
              </span>
              <button
                type="button"
                onClick={() => cycleLocation(String(r.source.id))}
                className="h-9 w-16 shrink-0 rounded-lg bg-neutral-100 text-xs font-bold text-neutral-700 dark:bg-neutral-800 dark:text-neutral-200"
              >
                {r.location}
              </button>
            </li>
          ))}
        </ul>

        <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          登録すると、この {rows.length} 件は買い物リストから消えます。
        </p>

        <div className="mt-4 flex gap-3">
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
            disabled={busy || rows.length === 0}
            className="h-14 flex-[2] rounded-xl bg-emerald-600 text-base font-bold text-white disabled:opacity-40"
          >
            {busy ? "登録中…" : `${rows.length}件を在庫へ`}
          </button>
        </div>
      </div>
    </div>
  );
}
