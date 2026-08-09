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
import { saveTodo, setTodoDone } from "@/lib/mutations";
import type {
  Account,
  AssetDetail,
  Balance,
  Income,
  LoanSchedule,
  SalaryRow,
  Todo,
} from "@/lib/types";

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
  // 手元の家計簿から引き継いだもの
  const details = useTable<AssetDetail>("asset_details");
  const loans = useTable<LoanSchedule>("loan_schedule", { orderBy: "year_month" });
  const salary = useTable<SalaryRow>("salary_table", { orderBy: "age" });
  const todos = useTable<Todo>("todos", { orderBy: "id" });
  const [openAccount, setOpenAccount] = useState<string | null>(null);
  const [showSalary, setShowSalary] = useState(false);
  const [newTodo, setNewTodo] = useState("");

  const [month, setMonth] = useState(currentMonth());
  const [editingAccount, setEditingAccount] = useState<Account | null>(null);
  const [addingAccount, setAddingAccount] = useState(false);
  const [addingIncome, setAddingIncome] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const balanceOf = (accountId: number): number | null => {
    const row = balances.rows.find((b) => b.account_id === accountId && b.year_month === month);
    return row?.amount ?? null;
  };

  const assets = accounts.rows.filter((a) => a.kind === "資産" && a.active);
  const debts = accounts.rows.filter((a) => a.kind === "負債" && a.active);

  /*
   * 【ローンは純資産から差し引かない】
   *
   * 差し引くと数字が実態より悪く見える。住んでいる家をこのアプリでは
   * 資産として記録していないため、家の価値を足さずにローンだけ引くことになり、
   * 「家を買った瞬間に数千万円損した」という表示になってしまう。
   * 片方だけ数えるくらいなら、両方数えないほうが読み違えない。
   *
   * ローンの残高は消さずに、下に別枠で出す。返済の進み具合は
   * 「ローンの返済予定」で見る。
   *
   * どれをローンとみなすかは【分類】の文字で決める。口座の編集画面から
   * 変えられるので、アプリ側で決め打ちにしない。
   */
  const isLoan = (a: { category: string | null }) => (a.category ?? "").includes("ローン");
  const loanAccounts = debts.filter(isLoan);
  const otherDebts = debts.filter((a) => !isLoan(a));

  const totalAssets = assets.reduce((s, a) => s + (balanceOf(a.id) ?? 0), 0);
  const totalLoans = loanAccounts.reduce((s, a) => s + (balanceOf(a.id) ?? 0), 0);
  const totalOtherDebts = otherDebts.reduce((s, a) => s + (balanceOf(a.id) ?? 0), 0);
  const net = totalAssets - totalOtherDebts;

  const monthIncome = useMemo(
    () => income.rows.filter((i) => i.date.startsWith(month)),
    [income.rows, month],
  );
  const incomeTotal = monthIncome.reduce((s, i) => s + i.amount, 0);

  const run = async (fn: () => Promise<void>, after?: () => void) => {
    setError(null);
    try {
      await fn();
      after?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const addTodo = async () => {
    const title = newTodo.trim();
    if (!title) return;
    await run(async () => void (await saveTodo({ title })), () => {
      setNewTodo("");
      todos.refetch();
    });
  };

  return (
    <main className="min-h-dvh bg-neutral-50 pb-44 dark:bg-neutral-950">
      <header className="relative sticky top-0 z-30 border-b border-neutral-200 bg-white/95 px-4 pt-[calc(env(safe-area-inset-top)+0.5rem)] pb-3 backdrop-blur dark:border-neutral-800 dark:bg-neutral-900/95">
        <Link
          href="/spending"
          className="-ml-2 inline-flex h-9 items-center gap-1 rounded-lg px-2 text-sm text-neutral-500 active:bg-neutral-100 dark:active:bg-neutral-800"
        >
          <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth={2.5}>
            <path d="M15 5l-7 7 7 7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          家計
        </Link>
        <Link
          href="/spending/investments"
          className="absolute right-4 top-[calc(env(safe-area-inset-top)+0.5rem)] flex h-9 items-center rounded-lg bg-neutral-100 px-3 text-xs font-bold text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"
        >
          投資 →
        </Link>
        <h1 className="mt-0.5 text-xs font-medium tracking-wide text-neutral-500">
          {monthLabel(month)}の純資産
          {totalLoans > 0 && <span className="ml-1">(ローンを除く)</span>}
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
          <p className="text-xs font-medium text-neutral-500">
            {totalLoans > 0 ? "負債(ローン以外)" : "負債"}
          </p>
          <p className="mt-1 text-xl font-bold tabular-nums">{yen(totalOtherDebts)}</p>
        </div>
      </section>

      {totalLoans > 0 && (
        <section className="px-4 pt-3">
          <div className="rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
            <div className="flex items-baseline justify-between gap-2">
              <p className="text-xs font-medium text-neutral-500">ローン残高</p>
              <p className="text-lg font-bold tabular-nums text-neutral-500 dark:text-neutral-400">
                {yen(totalLoans)}
              </p>
            </div>
            <p className="mt-1.5 text-[11px] leading-relaxed text-neutral-500 dark:text-neutral-400">
              上の純資産には<strong>含めていません</strong>。
              住んでいる家をこのアプリでは資産として数えていないので、
              ローンだけ引くと実態より悪く見えるためです。
              返済の進み具合は下の「ローンの返済予定」で見られます。
            </p>
          </div>
        </section>
      )}

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
                <li key={a.id} className="px-4 py-3">
                  <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      const mine = details.rows.filter((d) => d.item === a.name);
                      // 内訳があるものはまず開く。無ければ編集へ
                      if (mine.length > 0 && openAccount !== a.name) setOpenAccount(a.name);
                      else if (mine.length > 0) setOpenAccount(null);
                      else setEditingAccount(a);
                    }}
                    className="min-w-0 flex-1 text-left"
                  >
                    <span className="block text-[15px] font-semibold">{a.name}</span>
                    <span className="text-[11px] text-neutral-500 dark:text-neutral-400">
                      {a.category ?? ""}
                      {details.rows.some((d) => d.item === a.name) &&
                        `${a.category ? " · " : ""}内訳 ${details.rows.filter((d) => d.item === a.name).length}件`}
                    </span>
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
                      void run(() => saveBalance(a.id, month, Math.round(n)), balances.refetch);
                    }}
                    className="h-11 w-36 rounded-xl border border-neutral-300 bg-white px-3 text-right text-base tabular-nums dark:border-neutral-700 dark:bg-neutral-800"
                  />
                  </div>

                  {/* 内訳。iDeCo が何で構成されているか等 */}
                  {openAccount === a.name && (
                    <ul className="mt-2 space-y-1.5 rounded-lg bg-neutral-50 p-3 dark:bg-neutral-800">
                      {details.rows
                        .filter((d) => d.item === a.name)
                        .map((d) => (
                          <li key={d.id}>
                            <div className="flex items-baseline justify-between gap-2">
                              <span className="text-xs font-semibold">{d.sub_item}</span>
                              <span className="shrink-0 text-xs font-bold tabular-nums">
                                {yen(d.amount)}
                              </span>
                            </div>
                            {d.note && (
                              <p className="mt-0.5 text-[11px] leading-relaxed text-neutral-500 dark:text-neutral-400">
                                {d.note}
                              </p>
                            )}
                          </li>
                        ))}
                      <li className="pt-1">
                        <button
                          type="button"
                          onClick={() => setEditingAccount(a)}
                          className="text-[11px] font-semibold text-emerald-700 underline dark:text-emerald-400"
                        >
                          この口座を編集
                        </button>
                      </li>
                    </ul>
                  )}
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
          <p className="px-4 text-xs text-neutral-500 dark:text-neutral-400">この月の収入は未登録です。</p>
        ) : (
          <ul className="divide-y divide-neutral-100 border-y border-neutral-200 bg-white dark:divide-neutral-800 dark:border-neutral-800 dark:bg-neutral-900">
            {monthIncome.map((i) => (
              <li key={i.id} className="flex items-center gap-3 px-4 py-3">
                <span className="w-14 shrink-0 text-xs text-neutral-500 dark:text-neutral-400">{formatDate(i.date)}</span>
                <span className="min-w-0 flex-1 truncate text-sm">{i.source}</span>
                <span className="shrink-0 text-sm font-semibold tabular-nums">{yen(i.amount)}</span>
                <button
                  type="button"
                  aria-label="削除"
                  onClick={() => void run(() => deleteIncome(i.id), income.refetch)}
                  className="size-9 shrink-0 rounded-lg bg-neutral-100 text-neutral-400 dark:bg-neutral-800"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {loans.rows.length > 0 && (
        <section className="mt-6">
          <h2 className="px-4 pb-2 text-xs font-bold text-neutral-500">ローン残高の見通し</h2>
          <ul className="divide-y divide-neutral-100 border-y border-neutral-200 bg-white dark:divide-neutral-800 dark:border-neutral-800 dark:bg-neutral-900">
            {loans.rows.map((l) => (
              <li key={l.id} className="flex items-center gap-3 px-4 py-2.5">
                <span className="w-20 shrink-0 text-xs text-neutral-500 dark:text-neutral-400">
                  {monthLabel(l.year_month)}
                </span>
                <span
                  className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold ${
                    l.kind === "実績"
                      ? "bg-neutral-200 text-neutral-700 dark:bg-neutral-700 dark:text-neutral-200"
                      : "bg-sky-100 text-sky-900"
                  }`}
                >
                  {l.kind}
                </span>
                <span className="min-w-0 flex-1 truncate text-[11px] text-neutral-500 dark:text-neutral-400">
                  {l.note ?? ""}
                </span>
                <span className="shrink-0 text-sm font-bold tabular-nums">{yen(l.balance)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {salary.rows.length > 0 && (
        <section className="mt-6">
          <button
            type="button"
            onClick={() => setShowSalary((v) => !v)}
            className="flex w-full items-baseline justify-between px-4 pb-2"
          >
            <span className="text-xs font-bold text-neutral-500">
              将来の給与見込み(俸給表 {salary.rows.length}件)
            </span>
            <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">
              {showSalary ? "閉じる" : "開く"}
            </span>
          </button>
          {showSalary && (
            <div className="overflow-x-auto border-y border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-neutral-100 dark:border-neutral-800">
                    <th className="px-3 py-2 text-left font-semibold">年齢</th>
                    <th className="px-3 py-2 text-right font-semibold">月給</th>
                    <th className="px-3 py-2 text-right font-semibold">夏</th>
                    <th className="px-3 py-2 text-right font-semibold">冬</th>
                    <th className="px-3 py-2 text-right font-semibold">年収</th>
                  </tr>
                </thead>
                <tbody>
                  {salary.rows.map((r) => (
                    <tr key={r.id} className="border-b border-neutral-50 dark:border-neutral-800">
                      <td className="px-3 py-1.5 tabular-nums">{r.age}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">
                        {r.monthly_salary.toLocaleString("ja-JP")}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-neutral-500 dark:text-neutral-400">
                        {r.bonus_summer.toLocaleString("ja-JP")}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-neutral-500 dark:text-neutral-400">
                        {r.bonus_winter.toLocaleString("ja-JP")}
                      </td>
                      <td className="px-3 py-1.5 text-right font-semibold tabular-nums">
                        {(r.monthly_salary * 12 + r.bonus_summer + r.bonus_winter).toLocaleString("ja-JP")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      <section className="mt-6">
        <h2 className="px-4 pb-2 text-xs font-bold text-neutral-500">
          やること({todos.rows.filter((t) => t.status === "open").length}件)
        </h2>
        <ul className="divide-y divide-neutral-100 border-y border-neutral-200 bg-white dark:divide-neutral-800 dark:border-neutral-800 dark:bg-neutral-900">
          {todos.rows
            .filter((t) => t.status === "open")
            .map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={false}
                  onClick={() => void run(async () => void (await setTodoDone(t, true)), todos.refetch)}
                  className="flex min-h-16 w-full items-start gap-3 px-4 py-3 text-left"
                >
                  <span className="mt-0.5 flex size-6 shrink-0 rounded-full border-2 border-neutral-300 dark:border-neutral-600" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold">{t.title}</span>
                    {t.detail && (
                      <span className="mt-0.5 block text-[11px] leading-relaxed text-neutral-500 dark:text-neutral-400">
                        {t.detail}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            ))}
        </ul>
        <div className="flex gap-2 px-4 pt-3">
          <input
            value={newTodo}
            onChange={(e) => setNewTodo(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && newTodo.trim()) void addTodo();
            }}
            enterKeyHint="done"
            placeholder="やることを足す"
            className="h-12 flex-1 rounded-xl border border-neutral-300 bg-white px-3 text-base dark:border-neutral-700 dark:bg-neutral-800"
          />
          <button
            type="button"
            disabled={!newTodo.trim()}
            onClick={() => void addTodo()}
            className="h-12 shrink-0 rounded-xl bg-emerald-600 px-4 text-sm font-bold text-white disabled:opacity-40"
          >
            追加
          </button>
        </div>
        {todos.rows.some((t) => t.status === "done") && (
          <p className="px-4 pt-2 text-[11px] text-neutral-500 dark:text-neutral-400">
            済み {todos.rows.filter((t) => t.status === "done").length} 件
          </p>
        )}
      </section>

      <p className="mx-4 mt-6 rounded-xl bg-neutral-100 px-4 py-3 text-[11px] leading-relaxed text-neutral-500 dark:bg-neutral-800 dark:text-neutral-500 dark:text-neutral-400">
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
            accounts.refetch();
            balances.refetch();
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
            income.refetch();
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
        <p className="mt-1 text-[11px] text-neutral-500 dark:text-neutral-400">
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
