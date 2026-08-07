"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { LoadNotice } from "@/components/ScreenHeader";
import { addMonths, currentMonth, formatDate, monthLabel, yen } from "@/lib/dates";
import {
  deleteAccount,
  deleteIncome,
  saveAccount,
  saveBalance,
  saveIncome,
} from "@/lib/mutations";
import { useTable } from "@/lib/use-table";
import type { Account, Balance, Income } from "@/lib/types";

/**
 * 資産・負債・収入。
 *
 * 設計書 5-2 は機密度を理由にこれらをクラウドへ置かない方針だったが、
 * アプリで扱う判断をしたため用意している。守りは RLS のみに頼らず、
 *   ・口座番号やカード番号は入力欄自体を作らない
 *   ・ビューを作らない(ビューは既定で RLS を迂回する)
 * という形でも効かせている。
 */
export function AssetsScreen() {
  const accounts = useTable<Account>("accounts", { orderBy: "sort_order" });
  const balances = useTable<Balance>("balances");
  const income = useTable<Income>("income", { orderBy: "date", ascending: false });

  const [month, setMonth] = useState(currentMonth());
  const [editingAccount, setEditingAccount] = useState<Account | null>(null);
  const [addingAccount, setAddingAccount] = useState(false);
  const [addingIncome, setAddingIncome] = useState(false);
  const [tick, setTick] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const balanceOf = (accountId: number): number | null => {
    const row = balances.rows.find((b) => b.account_id === accountId && b.year_month === month);
    return row?.amount ?? null;
  };

  const assets = accounts.rows.filter((a) => a.kind === "資産" && a.active);
  const debts = accounts.rows.filter((a) => a.kind === "負債" && a.active);

  const totalAssets = assets.reduce((s, a) => s + (balanceOf(a.id) ?? 0), 0);
  const totalDebts = debts.reduce((s, a) => s + (balanceOf(a.id) ?? 0), 0);
  const net = totalAssets - totalDebts;

  const monthIncome = useMemo(
    () => income.rows.filter((i) => i.date.startsWith(month)),
    [income.rows, month],
  );
  const incomeTotal = monthIncome.reduce((s, i) => s + i.amount, 0);

  const run = async (fn: () => Promise<void>) => {
    setError(null);
    try {
      await fn();
      setTick((t) => t + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <main key={tick} className="min-h-dvh bg-neutral-50 pb-44 dark:bg-neutral-950">
      <header className="sticky top-0 z-30 border-b border-neutral-200 bg-white/95 px-4 pt-[calc(env(safe-area-inset-top)+0.5rem)] pb-3 backdrop-blur dark:border-neutral-800 dark:bg-neutral-900/95">
        <Link
          href="/spending"
          className="-ml-2 inline-flex h-9 items-center gap-1 rounded-lg px-2 text-sm text-neutral-500 active:bg-neutral-100 dark:active:bg-neutral-800"
        >
          <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth={2.5}>
            <path d="M15 5l-7 7 7 7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          家計
        </Link>
        <h1 className="mt-0.5 text-xs font-medium tracking-wide text-neutral-500">
          {monthLabel(month)}の純資産
        </h1>
        <p className="text-2xl font-bold tabular-nums">{yen(net)}</p>
        <div className="mt-2 flex gap-2">
          <button
            type="button"
            onClick={() => setMonth(addMonths(month, -1))}
            className="h-9 flex-1 rounded-xl bg-neutral-100 text-xs font-bold text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"
          >
            ← 前の月
          </button>
          <button
            type="button"
            onClick={() => setMonth(currentMonth())}
            className="h-9 flex-1 rounded-xl bg-neutral-100 text-xs font-bold text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"
          >
            今月
          </button>
          <button
            type="button"
            onClick={() => setMonth(addMonths(month, 1))}
            className="h-9 flex-1 rounded-xl bg-neutral-100 text-xs font-bold text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"
          >
            次の月 →
          </button>
        </div>
      </header>

      {error && (
        <p className="mx-4 mt-3 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:bg-rose-950/50 dark:text-rose-300">
          {error}
        </p>
      )}

      <section className="grid grid-cols-2 gap-3 px-4 pt-4">
        <div className="rounded-2xl bg-white p-4 dark:bg-neutral-900">
          <p className="text-xs font-medium text-neutral-500">資産</p>
          <p className="mt-1 text-xl font-bold tabular-nums">{yen(totalAssets)}</p>
        </div>
        <div className="rounded-2xl bg-white p-4 dark:bg-neutral-900">
          <p className="text-xs font-medium text-neutral-500">負債</p>
          <p className="mt-1 text-xl font-bold tabular-nums">{yen(totalDebts)}</p>
        </div>
      </section>

      <LoadNotice
        loading={accounts.loading && accounts.rows.length === 0}
        error={accounts.error}
        empty={accounts.rows.length === 0}
        emptyText="口座や資産をまだ登録していません。下のボタンから追加してください。"
      />

      {(["資産", "負債"] as const).map((kind) => {
        const rows = kind === "資産" ? assets : debts;
        if (rows.length === 0) return null;
        return (
          <section key={kind} className="mt-5">
            <h2 className="px-4 pb-2 text-xs font-bold text-neutral-500">{kind}</h2>
            <ul className="divide-y divide-neutral-100 border-y border-neutral-200 bg-white dark:divide-neutral-800 dark:border-neutral-800 dark:bg-neutral-900">
              {rows.map((a) => (
                <li key={a.id} className="flex items-center gap-3 px-4 py-3">
                  <button
                    type="button"
                    onClick={() => setEditingAccount(a)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <span className="block text-[15px] font-semibold">{a.name}</span>
                    {a.category && (
                      <span className="text-[11px] text-neutral-400">{a.category}</span>
                    )}
                  </button>
                  <input
                    type="number"
                    inputMode="numeric"
                    defaultValue={balanceOf(a.id) ?? ""}
                    placeholder="—"
                    onBlur={(e) => {
                      const v = e.target.value.trim();
                      if (!v) return;
                      const n = Number(v);
                      if (Number.isNaN(n)) return;
                      if (n === balanceOf(a.id)) return;
                      void run(() => saveBalance(a.id, month, Math.round(n)));
                    }}
                    className="h-11 w-36 rounded-xl border border-neutral-300 bg-white px-3 text-right text-base tabular-nums dark:border-neutral-700 dark:bg-neutral-800"
                  />
                </li>
              ))}
            </ul>
          </section>
        );
      })}

      <div className="px-4 pt-4">
        <button
          type="button"
          onClick={() => setAddingAccount(true)}
          className="h-12 w-full rounded-xl bg-neutral-100 text-sm font-bold text-neutral-700 dark:bg-neutral-800 dark:text-neutral-200"
        >
          + 口座・資産・負債を追加
        </button>
      </div>

      <section className="mt-6">
        <div className="flex items-baseline justify-between px-4 pb-2">
          <h2 className="text-xs font-bold text-neutral-500">
            {monthLabel(month)}の収入 {yen(incomeTotal)}
          </h2>
          <button
            type="button"
            onClick={() => setAddingIncome(true)}
            className="text-xs font-semibold text-emerald-700 underline dark:text-emerald-400"
          >
            追加
          </button>
        </div>
        {monthIncome.length === 0 ? (
          <p className="px-4 text-xs text-neutral-400">この月の収入は未登録です。</p>
        ) : (
          <ul className="divide-y divide-neutral-100 border-y border-neutral-200 bg-white dark:divide-neutral-800 dark:border-neutral-800 dark:bg-neutral-900">
            {monthIncome.map((i) => (
              <li key={i.id} className="flex items-center gap-3 px-4 py-3">
                <span className="w-14 shrink-0 text-xs text-neutral-400">{formatDate(i.date)}</span>
                <span className="min-w-0 flex-1 truncate text-sm">{i.source}</span>
                <span className="shrink-0 text-sm font-semibold tabular-nums">{yen(i.amount)}</span>
                <button
                  type="button"
                  aria-label="削除"
                  onClick={() => void run(() => deleteIncome(i.id))}
                  className="size-9 shrink-0 rounded-lg bg-neutral-100 text-neutral-400 dark:bg-neutral-800"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="mx-4 mt-6 rounded-xl bg-neutral-100 px-4 py-3 text-[11px] leading-relaxed text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
        この画面の情報は世帯の2人だけが見られます(RLS)。口座番号・カード番号は
        保存できない作りにしてあります。設計書は機密度を理由にこれらを手元に残す方針でしたが、
        アプリで扱う判断に合わせて用意しています。
      </p>

      {(addingAccount || editingAccount) && (
        <AccountSheet
          existing={editingAccount}
          onClose={() => {
            setAddingAccount(false);
            setEditingAccount(null);
          }}
          onSaved={() => {
            setAddingAccount(false);
            setEditingAccount(null);
            setTick((t) => t + 1);
          }}
          onError={setError}
        />
      )}

      {addingIncome && (
        <IncomeSheet
          month={month}
          onClose={() => setAddingIncome(false)}
          onSaved={() => {
            setAddingIncome(false);
            setTick((t) => t + 1);
          }}
          onError={setError}
        />
      )}
    </main>
  );
}

function AccountSheet({
  existing,
  onClose,
  onSaved,
  onError,
}: {
  existing: Account | null;
  onClose: () => void;
  onSaved: () => void;
  onError: (m: string) => void;
}) {
  const [name, setName] = useState(existing?.name ?? "");
  const [kind, setKind] = useState<"資産" | "負債">(existing?.kind ?? "資産");
  const [category, setCategory] = useState(existing?.category ?? "");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      await saveAccount({ id: existing?.id, name: name.trim(), kind, category: category.trim() || null });
      onSaved();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <button type="button" aria-label="閉じる" onClick={onClose} className="absolute inset-0 bg-black/40" />
      <div className="relative rounded-t-2xl bg-white px-4 pt-4 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] dark:bg-neutral-900">
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-neutral-300 dark:bg-neutral-600" />
        <h2 className="text-base font-bold">{existing ? "編集" : "口座・資産・負債を追加"}</h2>

        <label className="mt-3 block text-xs font-medium text-neutral-500">名前</label>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="例: 三井住友銀行 / 住宅ローン / NISA"
          className="mt-1 h-12 w-full rounded-xl border border-neutral-300 bg-white px-3 text-base dark:border-neutral-700 dark:bg-neutral-800"
        />
        <p className="mt-1 text-[11px] text-neutral-400">
          口座番号・カード番号は入れないでください(保存する欄を用意していません)
        </p>

        <div className="mt-3 flex gap-1 rounded-xl bg-neutral-100 p-1 dark:bg-neutral-800">
          {(["資産", "負債"] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setKind(k)}
              className={`h-11 flex-1 rounded-lg text-sm font-semibold ${
                kind === k ? "bg-white shadow-sm dark:bg-neutral-700" : "text-neutral-500"
              }`}
            >
              {k}
            </button>
          ))}
        </div>

        <label className="mt-3 block text-xs font-medium text-neutral-500">分類(任意)</label>
        <input
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          placeholder="預金 / 投資 / 年金 / ローン"
          className="mt-1 h-12 w-full rounded-xl border border-neutral-300 bg-white px-3 text-base dark:border-neutral-700 dark:bg-neutral-800"
        />

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
            保存する
          </button>
        </div>

        {existing && (
          <button
            type="button"
            onClick={async () => {
              setBusy(true);
              try {
                await deleteAccount(existing.id);
                onSaved();
              } catch (e) {
                onError(e instanceof Error ? e.message : String(e));
              } finally {
                setBusy(false);
              }
            }}
            disabled={busy}
            className="mt-2 h-14 w-full rounded-xl bg-rose-50 text-base font-bold text-rose-600 disabled:opacity-40 dark:bg-rose-950/50"
          >
            削除(残高の記録も消えます)
          </button>
        )}
      </div>
    </div>
  );
}

function IncomeSheet({
  month,
  onClose,
  onSaved,
  onError,
}: {
  month: string;
  onClose: () => void;
  onSaved: () => void;
  onError: (m: string) => void;
}) {
  const [date, setDate] = useState(`${month}-25`);
  const [amount, setAmount] = useState("");
  const [source, setSource] = useState("給与");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const n = Number(amount);
    if (!source.trim() || Number.isNaN(n) || n <= 0) return;
    setBusy(true);
    try {
      await saveIncome({ date, amount: Math.round(n), source: source.trim() });
      onSaved();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <button type="button" aria-label="閉じる" onClick={onClose} className="absolute inset-0 bg-black/40" />
      <div className="relative rounded-t-2xl bg-white px-4 pt-4 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] dark:bg-neutral-900">
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-neutral-300 dark:bg-neutral-600" />
        <h2 className="text-base font-bold">収入を追加</h2>

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
              className="mt-1 h-12 w-full rounded-xl border border-neutral-300 bg-white px-3 text-base tabular-nums dark:border-neutral-700 dark:bg-neutral-800"
            />
          </div>
        </div>

        <label className="mt-3 block text-xs font-medium text-neutral-500">内容</label>
        <input
          value={source}
          onChange={(e) => setSource(e.target.value)}
          placeholder="例: 給与(夫) / 賞与"
          className="mt-1 h-12 w-full rounded-xl border border-neutral-300 bg-white px-3 text-base dark:border-neutral-700 dark:bg-neutral-800"
        />

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
            disabled={busy || !amount || !source.trim()}
            className="h-14 flex-[2] rounded-xl bg-emerald-600 text-base font-bold text-white disabled:opacity-40"
          >
            保存する
          </button>
        </div>
      </div>
    </div>
  );
}
