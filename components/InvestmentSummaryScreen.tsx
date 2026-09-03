"use client";

import Link from "next/link";
import { useMemo } from "react";
import { LoadNotice, ScreenHeader } from "@/components/ScreenHeader";
import { formatDate, todayISO, yen } from "@/lib/dates";
import {
  BUCKET_STYLE,
  IPS,
  bucketOf,
  daysOld,
  latestByCode,
  latestHoldings,
  rangePosition,
  share,
  type Bucket,
} from "@/lib/investment";
import { useTable } from "@/lib/use-table";
import type { Account, Balance, Holding, WatchHistory, WatchItem } from "@/lib/types";

/**
 * 投資のまとめ。
 *
 * 【一覧ではなく、方針と突き合わせる画面】
 * 銘柄の一覧は /spending/investments にある。ここでやるのは
 * **「方針.md に書いた線から、いまどれだけ離れているか」**を出すこと。
 * IPS には数値の決めごとが3つある(FANG+ 15%キャップ / 恒常積立 / 押し目ルール)のに、
 * それを確かめる場所がアプリのどこにも無く、毎回チャットで計算し直していた。
 *
 * 【この画面がしないこと】
 *   ・**売買をすすめない。** 買い時・売り時を書かない。線と現在地を並べるだけ
 *   ・株価を取りに行かない。数字は人が watch_history に記録した日のもの。
 *     **何日前の数字かを必ず画面に出す**(古い数字で判断されるほうが危ない)
 *   ・独自の点数をつけない
 */
export function InvestmentSummaryScreen() {
  const today = todayISO();
  const holdings = useTable<Holding>("holdings", { orderBy: "as_of", ascending: false });
  const watchlist = useTable<WatchItem>("watchlist", { orderBy: "code" });
  const history = useTable<WatchHistory>("watch_history", { orderBy: "as_of", ascending: false });
  const accounts = useTable<Account>("accounts");
  const balances = useTable<Balance>("balances");

  const current = useMemo(() => latestHoldings(holdings.rows), [holdings.rows]);

  const totals = useMemo(() => {
    let value = 0;
    let acq = 0;
    let asOf = "";
    const byBucket = new Map<Bucket, number>();
    for (const h of current) {
      const v = Number(h.value ?? 0);
      value += v;
      acq += Number(h.acq_amount ?? 0);
      if (h.as_of > asOf) asOf = h.as_of;
      const b = bucketOf(h);
      byBucket.set(b, (byBucket.get(b) ?? 0) + v);
    }
    const order: Bucket[] = ["米国・先進国コア", "FANG+", "日本株", "その他"];
    return {
      value,
      acq,
      pnl: value - acq,
      asOf,
      buckets: order
        .map((b) => ({ bucket: b, amount: byBucket.get(b) ?? 0 }))
        .filter((x) => x.amount > 0),
    };
  }, [current]);

  /**
   * 現金。FANG+ の比率を「資産全体」で見るのに要る。
   * 【ローンは引かない】。ホームと資産画面と同じ規則にそろえる(片方だけ直さない)。
   */
  const cash = useMemo(() => {
    const cashIds = new Set(
      accounts.rows.filter((a) => a.active && a.category === "預金").map((a) => a.id),
    );
    const months = [...new Set(balances.rows.map((b) => b.year_month))].sort();
    const latest = months[months.length - 1] ?? null;
    if (!latest) return { amount: 0, month: null as string | null };
    let sum = 0;
    for (const b of balances.rows) if (b.year_month === latest && cashIds.has(b.account_id)) sum += b.amount;
    return { amount: sum, month: latest };
  }, [accounts.rows, balances.rows]);

  const fang = totals.buckets.find((b) => b.bucket === "FANG+")?.amount ?? 0;
  const fangOfInvest = share(fang, totals.value);
  const fangOfAll = share(fang, totals.value + cash.amount);

  /** 記録の上で「積立中」になっている銘柄。方針と食い違っていないかを見る。 */
  const accumulating = current.filter((h) => h.accumulating);

  /** 押し目ルールに当たっている銘柄。**買えとは書かない。** */
  const dips = useMemo(() => {
    const latest = latestByCode(history.rows);
    return watchlist.rows
      .map((w) => {
        const h = latest.get(w.code);
        const pos = h ? rangePosition(h) : null;
        return { watch: w, hist: h, pos };
      })
      .filter((x) => x.pos != null)
      .sort((a, b) => (a.pos ?? 0) - (b.pos ?? 0));
  }, [watchlist.rows, history.rows]);

  const oldest = dips.length > 0 ? dips[0].hist?.as_of ?? null : null;

  return (
    <main className="min-h-dvh bg-neutral-50 pb-44 dark:bg-neutral-950">
      <ScreenHeader
        title="投資"
        subtitle="まとめ"
        right={
          <Link
            href="/spending/investments"
            className="flex h-10 items-center rounded-xl bg-neutral-100 px-3 text-xs font-bold text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"
          >
            銘柄一覧
          </Link>
        }
      >
        <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
          {totals.asOf ? `${formatDate(totals.asOf)} に記録した数字` : "記録がありません"}
        </p>
      </ScreenHeader>

      <LoadNotice
        loading={holdings.loading && holdings.rows.length === 0}
        error={holdings.error}
        empty={current.length === 0}
        emptyText="保有銘柄がまだありません。チャットから登録できます。"
      />

      <div className="space-y-3 px-4 pt-3">
        {/* ------------------------------------------------ いまの姿 */}
        <section className="rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
          <h2 className="text-sm font-bold">いまの姿</h2>
          <p className="mt-1 text-3xl font-bold tabular-nums">{yen(totals.value)}</p>
          <p className="mt-1 text-sm tabular-nums text-neutral-600 dark:text-neutral-300">
            取得 {yen(totals.acq)} ・{" "}
            <span className={totals.pnl >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600"}>
              {totals.pnl >= 0 ? "+" : ""}
              {yen(totals.pnl)}
              {totals.acq > 0 && `(${totals.pnl >= 0 ? "+" : ""}${share(totals.pnl, totals.acq)}%)`}
            </span>
          </p>
          {cash.month && (
            <p className="mt-2 text-[11px] text-neutral-500 dark:text-neutral-400">
              現金 {yen(cash.amount)}({Number(cash.month.slice(5))}月末)を合わせて{" "}
              {yen(totals.value + cash.amount)}。<b>住宅ローンは引いていません</b>
            </p>
          )}
        </section>

        {/* ------------------------------------------------ 配分 */}
        <section className="overflow-hidden rounded-2xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
          <h2 className="px-4 pt-3.5 text-sm font-bold">どこに置いてあるか</h2>
          <p className="px-4 pb-2 text-[11px] text-neutral-500 dark:text-neutral-400">
            方針は「米国株コア + 日本高配当を第二の柱」
          </p>
          <div className="flex h-3 overflow-hidden px-4">
            <div className="flex h-3 w-full overflow-hidden rounded-full">
              {totals.buckets.map((b) => (
                <div
                  key={b.bucket}
                  className={BUCKET_STYLE[b.bucket].bar}
                  style={{ width: `${share(b.amount, totals.value) ?? 0}%` }}
                />
              ))}
            </div>
          </div>
          <ul className="px-4 py-3">
            {totals.buckets.map((b) => (
              <li key={b.bucket} className="flex items-baseline gap-2 py-1">
                <span className={`size-2.5 shrink-0 rounded-full ${BUCKET_STYLE[b.bucket].bar}`} />
                <span className="min-w-0 flex-1 truncate text-sm">{b.bucket}</span>
                <span className="shrink-0 text-sm font-bold tabular-nums">
                  {share(b.amount, totals.value)}%
                </span>
                <span className="w-24 shrink-0 text-right text-xs tabular-nums text-neutral-500 dark:text-neutral-400">
                  {yen(b.amount)}
                </span>
              </li>
            ))}
          </ul>
        </section>

        {/* ------------------------------------------------ 方針との照らし合わせ */}
        <section className="overflow-hidden rounded-2xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
          <h2 className="px-4 pt-3.5 text-sm font-bold">方針との照らし合わせ</h2>
          <p className="px-4 pb-2 text-[11px] text-neutral-500 dark:text-neutral-400">{IPS.source}</p>

          {/* FANG+ キャップ */}
          <div className="border-t border-neutral-100 px-4 py-3 dark:border-neutral-800">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[15px] font-semibold">FANG+ は資産全体の {IPS.fangCapPct}% まで</span>
              <span
                className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold ${
                  (fangOfAll ?? 0) > IPS.fangCapPct
                    ? "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300"
                    : "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                }`}
              >
                {(fangOfAll ?? 0) > IPS.fangCapPct ? "超えている" : "収まっている"}
              </span>
            </div>
            <p className="mt-1 text-xs tabular-nums text-neutral-600 dark:text-neutral-300">
              {yen(fang)} ・ 投資のうち {fangOfInvest ?? "—"}%
              {fangOfAll != null && ` / 現金も入れると ${fangOfAll}%`}
            </p>
            <p className="mt-1 text-[11px] text-neutral-500 dark:text-neutral-400">
              方針の「資産全体」がどこまでを指すか書かれていないので、<b>両方出しています</b>。
              超えたときは縮小を検討する、というのが方針の書き方です(売却の指示ではありません)。
            </p>
          </div>

          {/* 恒常積立 */}
          <div className="border-t border-neutral-100 px-4 py-3 dark:border-neutral-800">
            <span className="text-[15px] font-semibold">毎月の積立</span>
            <ul className="mt-1">
              {IPS.monthly.map((m) => (
                <li key={m.name} className="flex items-baseline gap-2 py-0.5 text-xs">
                  <span className="min-w-0 flex-1 truncate">{m.name}</span>
                  <span className="shrink-0 tabular-nums text-neutral-600 dark:text-neutral-300">
                    {yen(m.amount)}
                    {"note" in m && m.note ? ` (${m.note})` : ""}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[11px] text-neutral-500 dark:text-neutral-400">
              FANG+ は {formatDate(IPS.fangStoppedOn)} に積立終了(取得額100万円に到達)。
              <b>空いた枠の行き先は方針でも未定</b>のままです。
            </p>
            {accumulating.length > 0 && (
              <p className="mt-1 text-[11px] text-neutral-500 dark:text-neutral-400">
                記録の上で「積立中」になっているもの:{" "}
                {accumulating.map((h) => h.name).join(" / ")}
                {accumulating.some((h) => /FANG\+/i.test(h.name ?? "")) && (
                  <span className="block text-amber-700 dark:text-amber-400">
                    FANG+ が積立中のままです。終了しているなら記録を直してください
                  </span>
                )}
              </p>
            )}
          </div>

          {/* 押し目ルール */}
          <div className="border-t border-neutral-100 px-4 py-3 dark:border-neutral-800">
            <span className="text-[15px] font-semibold">
              押し目ルール(年初来レンジ位置 {IPS.dipRangePct}% 以下)
            </span>
            <p className="mt-0.5 text-[11px] text-neutral-500 dark:text-neutral-400">
              0% が年初来安値、100% が高値。<b>減配していないことは自分で確かめてください</b>
              (この記録には配当の推移が入っていません)。
            </p>
            <ul className="mt-2">
              {dips.slice(0, 8).map(({ watch, hist, pos }) => {
                const hit = (pos ?? 100) <= IPS.dipRangePct;
                return (
                  <li key={watch.id} className="flex items-baseline gap-2 py-1">
                    <span className="w-10 shrink-0 text-[11px] tabular-nums text-neutral-500">
                      {watch.code}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm">{watch.name}</span>
                    {hist?.div_yield != null && (
                      <span className="shrink-0 text-[11px] tabular-nums text-neutral-500 dark:text-neutral-400">
                        利回り {Number(hist.div_yield)}%
                      </span>
                    )}
                    <span
                      className={`w-12 shrink-0 text-right text-sm font-bold tabular-nums ${
                        hit ? "text-emerald-700 dark:text-emerald-400" : ""
                      }`}
                    >
                      {pos}%
                    </span>
                  </li>
                );
              })}
            </ul>
            {oldest && (
              <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-400">
                いちばん新しい株価の記録が {formatDate(oldest)}({daysOld(oldest, today)}日前)です。
                <b>株価は自動で入りません。</b>古い数字で判断しないこと
              </p>
            )}
          </div>
        </section>

        <p className="px-1 pb-2 text-[11px] text-neutral-500 dark:text-neutral-400">
          この画面は方針に書いた線と、記録した数字を並べているだけです。
          <b>売買のすすめではありません。</b>数字の正本は方針.md と、チャットから入れた記録です。
        </p>
      </div>
    </main>
  );
}
