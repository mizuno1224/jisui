"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { LoadNotice } from "@/components/ScreenHeader";
import { Sheet } from "@/components/Sheet";
import { formatDate, yen } from "@/lib/dates";
import { deleteWatchItem, saveWatchItem } from "@/lib/mutations";
import { useTable } from "@/lib/use-table";
import type { Holding, WatchHistory, WatchItem } from "@/lib/types";

type Tab = "保有" | "監視";

/**
 * 投資。手元の家計簿アプリから引き継いだ。
 *
 * 毎日見るものではないので、買い物リストのような即時性は要らない。
 * 月に1回、証券会社の画面を見ながら書き写す/眺める使い方を想定している。
 */
export function InvestmentsScreen() {
  const holdings = useTable<Holding>("holdings", { orderBy: "as_of", ascending: false });
  const watchlist = useTable<WatchItem>("watchlist", { orderBy: "code" });
  const history = useTable<WatchHistory>("watch_history", { orderBy: "as_of", ascending: false });

  const [tab, setTab] = useState<Tab>("保有");
  const [editing, setEditing] = useState<WatchItem | null>(null);
  const [adding, setAdding] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  /** 保有は日付ごとの記録。一番新しい日のものだけを出す。 */
  const latestDate = useMemo(
    () => holdings.rows.reduce((max, h) => (h.as_of > max ? h.as_of : max), ""),
    [holdings.rows],
  );
  const current = useMemo(
    () => holdings.rows.filter((h) => h.as_of === latestDate),
    [holdings.rows, latestDate],
  );

  const byAccount = useMemo(() => {
    const map = new Map<string, Holding[]>();
    for (const h of current) {
      const list = map.get(h.account);
      if (list) list.push(h);
      else map.set(h.account, [h]);
    }
    return [...map.entries()];
  }, [current]);

  const totalValue = current.reduce((s, h) => s + (h.value ?? 0), 0);
  const totalPnl = current.reduce((s, h) => s + (h.pnl ?? 0), 0);
  const totalAcq = current.reduce((s, h) => s + (h.acq_amount ?? 0), 0);
  const pnlRate = totalAcq > 0 ? (totalPnl / totalAcq) * 100 : 0;

  const latestOf = (code: string) => history.rows.find((h) => h.code === code) ?? null;

  return (
    <main className="min-h-dvh bg-neutral-50 pb-44 dark:bg-neutral-950">
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
          評価額{latestDate && ` (${formatDate(latestDate)}時点)`}
        </h1>
        <p className="text-2xl font-bold tabular-nums">{yen(totalValue)}</p>
        {/* 損益は色だけで示さない。符号と率を必ず文字で出す */}
        <p
          className={`text-sm font-semibold tabular-nums ${
            totalPnl >= 0 ? "text-emerald-700 dark:text-emerald-400" : "text-rose-700 dark:text-rose-400"
          }`}
        >
          {totalPnl >= 0 ? "+" : "−"}
          {yen(Math.abs(totalPnl))}({pnlRate >= 0 ? "+" : "−"}
          {Math.abs(pnlRate).toFixed(1)}%)
        </p>

        <div className="mt-2 flex gap-1 rounded-xl bg-neutral-100 p-1 dark:bg-neutral-800">
          {(["保有", "監視"] as Tab[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`h-10 flex-1 rounded-lg text-sm font-semibold ${
                tab === t
                  ? "bg-white text-neutral-900 shadow-sm dark:bg-neutral-700 dark:text-neutral-50"
                  : "text-neutral-500"
              }`}
            >
              {t}
              <span className="ml-1 text-xs font-normal text-neutral-500 dark:text-neutral-400">
                {t === "保有" ? current.length : watchlist.rows.length}
              </span>
            </button>
          ))}
        </div>
      </header>

      {error && (
        <p className="mx-4 mt-3 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:bg-rose-950/50 dark:text-rose-300">
          {error}
        </p>
      )}

      {tab === "保有" ? (
        <>
          <LoadNotice
            loading={holdings.loading && holdings.rows.length === 0}
            error={holdings.error}
            empty={current.length === 0}
            emptyText="保有銘柄がまだありません。Cowork(チャット)から登録できます。"
          />
          {byAccount.map(([account, rows]) => {
            const sum = rows.reduce((s, h) => s + (h.value ?? 0), 0);
            return (
              <section key={account} className="mt-4">
                <div className="flex items-baseline justify-between px-4 pb-1.5">
                  <h2 className="text-xs font-bold text-neutral-500">{account}</h2>
                  <span className="text-xs font-bold tabular-nums">{yen(sum)}</span>
                </div>
                <ul className="divide-y divide-neutral-100 border-y border-neutral-200 bg-white dark:divide-neutral-800 dark:border-neutral-800 dark:bg-neutral-900">
                  {rows.map((h) => {
                    const up = (h.pnl ?? 0) >= 0;
                    return (
                      <li key={h.id} className="px-4 py-3">
                        <div className="flex items-start justify-between gap-3">
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm font-semibold">{h.name}</span>
                            <span className="text-[11px] text-neutral-500 dark:text-neutral-400">
                              {h.code ? `${h.code} · ` : ""}
                              {h.kind}
                              {h.quantity != null && ` · ${h.quantity.toLocaleString("ja-JP")}`}
                              {h.accumulating && " · 積立中"}
                            </span>
                          </span>
                          <span className="shrink-0 text-right">
                            <span className="block text-sm font-bold tabular-nums">
                              {yen(h.value ?? 0)}
                            </span>
                            <span
                              className={`text-[11px] font-semibold tabular-nums ${
                                up
                                  ? "text-emerald-700 dark:text-emerald-400"
                                  : "text-rose-700 dark:text-rose-400"
                              }`}
                            >
                              {up ? "+" : "−"}
                              {yen(Math.abs(h.pnl ?? 0))}
                            </span>
                          </span>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </>
      ) : (
        <>
          <LoadNotice
            loading={watchlist.loading && watchlist.rows.length === 0}
            error={watchlist.error}
            empty={watchlist.rows.length === 0}
            emptyText="監視している銘柄はありません。"
          />
          <ul className="mt-3 divide-y divide-neutral-100 border-y border-neutral-200 bg-white dark:divide-neutral-800 dark:border-neutral-800 dark:bg-neutral-900">
            {watchlist.rows.map((w) => {
              const last = latestOf(w.code);
              const open = expanded === w.code;
              return (
                <li key={w.id}>
                  <button
                    type="button"
                    onClick={() => setExpanded(open ? null : w.code)}
                    className="w-full px-4 py-3 text-left"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold">{w.name}</span>
                        <span className="text-[11px] text-neutral-500 dark:text-neutral-400">
                          {w.code}
                          {w.market ? ` · ${w.market}` : ""}
                        </span>
                      </span>
                      {last && (
                        <span className="shrink-0 text-right">
                          <span className="block text-sm font-bold tabular-nums">
                            {last.price != null ? `¥${last.price.toLocaleString("ja-JP")}` : "—"}
                          </span>
                          <span className="text-[11px] tabular-nums text-neutral-500 dark:text-neutral-400">
                            {last.div_yield != null ? `利回り ${last.div_yield}%` : ""}
                          </span>
                        </span>
                      )}
                    </div>

                    {open && (
                      <div className="mt-2 rounded-lg bg-neutral-50 p-3 dark:bg-neutral-800">
                        {last && (
                          <dl className="grid grid-cols-3 gap-2 text-[11px]">
                            <Metric label="PER" value={last.per} />
                            <Metric label="PBR" value={last.pbr} />
                            <Metric label="配当" value={last.dividend} unit="円" />
                            <Metric label="年高" value={last.year_high} unit="円" />
                            <Metric label="年安" value={last.year_low} unit="円" />
                            <div>
                              <dt className="text-neutral-500 dark:text-neutral-400">記録日</dt>
                              <dd className="font-semibold">{formatDate(last.as_of)}</dd>
                            </div>
                          </dl>
                        )}
                        {w.memo && (
                          <p className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-neutral-700 dark:text-neutral-200">
                            {w.memo}
                          </p>
                        )}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditing(w);
                          }}
                          className="mt-2 h-10 w-full rounded-lg bg-neutral-100 text-xs font-bold text-neutral-700 dark:bg-neutral-700 dark:text-neutral-200"
                        >
                          メモを直す
                        </button>
                      </div>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>

          <div className="px-4 pt-4">
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="h-12 w-full rounded-xl bg-neutral-100 text-sm font-bold text-neutral-700 dark:bg-neutral-800 dark:text-neutral-200"
            >
              + 監視銘柄を追加
            </button>
          </div>
        </>
      )}

      <p className="mx-4 mt-6 rounded-xl bg-neutral-100 px-4 py-3 text-[11px] leading-relaxed text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
        保有銘柄と株価の記録は、月に1回 Cowork(チャット)から更新するのが楽です。
        証券会社の画面を見ながら「NISAの中身を更新して」と頼めば、まとめて書き込めます。
      </p>

      {(adding || editing) && (
        <WatchSheet
          existing={editing}
          onClose={() => {
            setAdding(false);
            setEditing(null);
          }}
          onSaved={() => {
            setAdding(false);
            setEditing(null);
            watchlist.refetch();
          }}
          onError={setError}
        />
      )}
    </main>
  );
}

function Metric({ label, value, unit }: { label: string; value: number | null; unit?: string }) {
  return (
    <div>
      <dt className="text-neutral-500 dark:text-neutral-400">{label}</dt>
      <dd className="font-semibold tabular-nums">
        {value != null ? `${value.toLocaleString("ja-JP")}${unit ?? ""}` : "—"}
      </dd>
    </div>
  );
}

function WatchSheet({
  existing,
  onClose,
  onSaved,
  onError,
}: {
  existing: WatchItem | null;
  onClose: () => void;
  onSaved: () => void;
  onError: (m: string) => void;
}) {
  const [code, setCode] = useState(existing?.code ?? "");
  const [name, setName] = useState(existing?.name ?? "");
  const [memo, setMemo] = useState(existing?.memo ?? "");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!code.trim() || !name.trim()) return;
    setBusy(true);
    try {
      await saveWatchItem({
        id: existing?.id,
        code: code.trim(),
        name: name.trim(),
        market: existing?.market ?? "東証P",
        memo: memo.trim() || null,
      });
      onSaved();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet onClose={onClose}>
      <h2 className="text-base font-bold">{existing ? "監視銘柄を編集" : "監視銘柄を追加"}</h2>

      <div className="mt-3 flex gap-3">
        <div className="w-28">
          <label className="block text-xs font-medium text-neutral-500">コード</label>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            inputMode="numeric"
            placeholder="7203"
            className="mt-1 h-12 w-full rounded-xl border border-neutral-300 bg-white px-3 text-base tabular-nums dark:border-neutral-700 dark:bg-neutral-800"
          />
        </div>
        <div className="flex-1">
          <label className="block text-xs font-medium text-neutral-500">銘柄名</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="トヨタ自動車"
            className="mt-1 h-12 w-full rounded-xl border border-neutral-300 bg-white px-3 text-base dark:border-neutral-700 dark:bg-neutral-800"
          />
        </div>
      </div>

      <label className="mt-3 block text-xs font-medium text-neutral-500">メモ(優待・配当など)</label>
      <textarea
        value={memo}
        onChange={(e) => setMemo(e.target.value)}
        rows={5}
        className="mt-1 w-full rounded-xl border border-neutral-300 bg-white p-3 text-sm leading-relaxed dark:border-neutral-700 dark:bg-neutral-800"
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
          disabled={busy || !code.trim() || !name.trim()}
          className="h-14 flex-[2] rounded-xl bg-emerald-600 text-base font-bold text-white disabled:opacity-40"
        >
          保存する
        </button>
      </div>

      {existing && (
        <div className="mt-6 border-t border-neutral-200 pt-4 dark:border-neutral-800">
          <button
            type="button"
            onClick={async () => {
              setBusy(true);
              try {
                await deleteWatchItem(existing.id);
                onSaved();
              } catch (e) {
                onError(e instanceof Error ? e.message : String(e));
              } finally {
                setBusy(false);
              }
            }}
            disabled={busy}
            className="h-14 w-full rounded-xl bg-rose-50 text-base font-bold text-rose-600 disabled:opacity-40 dark:bg-rose-950/50"
          >
            監視から外す
          </button>
        </div>
      )}
    </Sheet>
  );
}
