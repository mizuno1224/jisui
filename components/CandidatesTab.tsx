"use client";

// 高配当株の「候補を並べて選ぶ」画面。投資タブの3枚目。
//
// 【この画面がやること・やらないこと】
// やること: チャットが出典つきで入れた数字を、自分たちで決めた重みで並べ直し、
//           買う・見送る・保留を1タップで残す。
// やらないこと: 株価を取りに行くこと。数字はチャットが月1回入れる(README の方針)。
//
// 【総合点だけを大きく出さない】
// 点は「自分たちの物差し」でしかない。理由とリスクを必ず同じ高さに並べて、
// 点が高いから買う、にならないようにしてある。
import { useMemo, useState } from "react";
import { LoadNotice } from "@/components/ScreenHeader";
import { Sheet } from "@/components/Sheet";
import { formatDate, yen } from "@/lib/dates";
import { addHolding, saveDecision, saveInvestPolicy } from "@/lib/mutations";
import {
  AFTER_TAX,
  DEFAULT_POLICY,
  SORT_KEYS,
  type PolicyLike,
  type SortKey,
  belowMinYield,
  reachedTarget,
  scoreOf,
  sortCandidates,
  thinlyKnown,
  unitCost,
  unitDividend,
  withinBudget,
} from "@/lib/screening";
import { type TableState, useTable } from "@/lib/use-table";
import type {
  Decision,
  Holding,
  InvestPolicy,
  Screening,
  ScreeningCandidate,
  StockDecision,
} from "@/lib/types";
import { DECISIONS } from "@/lib/types";

export function CandidatesTab({
  candidates,
  onError,
}: {
  /** 取得は投資画面側でしている(タブの数字にも要るため)。ここでは読むだけ */
  candidates: TableState<ScreeningCandidate>;
  onError: (message: string | null) => void;
}) {
  const screenings = useTable<Screening>("screenings", { orderBy: "as_of", ascending: false });
  const decisions = useTable<StockDecision>("stock_decisions", { orderBy: "code" });
  const policyRows = useTable<InvestPolicy>("invest_policy");
  const holdings = useTable<Holding>("holdings", { orderBy: "as_of", ascending: false });

  const [sort, setSort] = useState<SortKey>("総合点");
  const [onlyUndecided, setOnlyUndecided] = useState(false);
  const [selected, setSelected] = useState<ScreeningCandidate | null>(null);
  const [editingPolicy, setEditingPolicy] = useState(false);

  /** 保存されていなければ既定値。予算も重みも、無いなら無いなりに並ぶ */
  const policy: PolicyLike = policyRows.rows[0] ?? DEFAULT_POLICY;

  /**
   * 一番新しい絞り込みの日。
   *
   * screenings ではなく候補の側から採る。見出しだけ入って候補がまだ入っていない
   * (受け渡し JSON が片方だけ適用された)ときに、空の日を選んでしまわないため。
   */
  const latestAsOf = useMemo(
    () => candidates.rows.reduce((max, c) => (c.as_of > max ? c.as_of : max), ""),
    [candidates.rows],
  );
  const run = screenings.rows.find((s) => s.as_of === latestAsOf) ?? null;

  const decisionOf = useMemo(() => {
    const map = new Map<string, StockDecision>();
    for (const d of decisions.rows) map.set(d.code, d);
    return map;
  }, [decisions.rows]);

  const todays = useMemo(
    () => candidates.rows.filter((c) => c.as_of === latestAsOf),
    [candidates.rows, latestAsOf],
  );
  const recommended = useMemo(
    () =>
      todays
        .filter((c) => c.recommended)
        .sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99)),
    [todays],
  );
  const listed = useMemo(() => {
    const rows = onlyUndecided ? todays.filter((c) => !decisionOf.has(c.code)) : todays;
    return sortCandidates(rows, sort, policy);
  }, [todays, onlyUndecided, decisionOf, sort, policy]);

  /** 目標の買値まで下がった銘柄。月1回しか見ないので、こちらから知らせる */
  const reached = useMemo(
    () =>
      todays.filter((c) => {
        const d = decisionOf.get(c.code);
        return d != null && reachedTarget(c.price, d.target_price);
      }),
    [todays, decisionOf],
  );

  const accounts = useMemo(
    () => [...new Set(holdings.rows.map((h) => h.account))],
    [holdings.rows],
  );

  return (
    <>
      <LoadNotice
        loading={candidates.loading && candidates.rows.length === 0}
        error={candidates.error}
        empty={false}
        emptyText=""
      />

      {!candidates.loading && todays.length === 0 && (
        <section className="mx-4 mt-4 rounded-2xl border border-neutral-200 bg-white p-4 text-sm dark:border-neutral-800 dark:bg-neutral-900">
          <p className="font-bold">候補はまだ1件も入っていません。</p>
          <p className="mt-2 text-[13px] leading-relaxed text-neutral-500 dark:text-neutral-400">
            チャットに「高配当の候補を出して」と頼んでください。20銘柄ぶんの
            利回り・PER・PBR・配当性向・連続増配年数を出典つきで入れ、そのうち3つに
            推薦の印を付けます。並べ直すのはこの画面の役目なので、
            気に入らなければ「基準」から重みを変えてください。
          </p>
          <p className="mt-2 text-[11px] text-neutral-400 dark:text-neutral-500">
            表がまだ無いときは <code>supabase/21_invest_screen.sql</code> を実行してください。
          </p>
        </section>
      )}

      {todays.length > 0 && (
        <>
          {/* ------------------------------------------------ その日の見出し */}
          <section className="mx-4 mt-4 rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="text-sm font-bold">
                {formatDate(latestAsOf)}の候補
                <span className="ml-1 text-xs font-normal text-neutral-500">{todays.length}銘柄</span>
              </h2>
              <button
                type="button"
                onClick={() => setEditingPolicy(true)}
                className="h-8 shrink-0 rounded-lg bg-neutral-100 px-3 text-xs font-bold text-neutral-700 dark:bg-neutral-800 dark:text-neutral-200"
              >
                基準
              </button>
            </div>
            <p className="mt-1 text-[11px] text-neutral-500 dark:text-neutral-400">
              1銘柄の上限{" "}
              {policy.budget_per_stock != null ? yen(policy.budget_per_stock) : "未設定"} ·
              重み 利回り{policy.w_yield}/増配{policy.w_growth}/割安{policy.w_value}/余力
              {policy.w_safety}
            </p>
            {run?.criteria && (
              <p className="mt-2 whitespace-pre-wrap text-[12px] leading-relaxed text-neutral-700 dark:text-neutral-200">
                {run.criteria}
              </p>
            )}
            {run?.universe && (
              <p className="mt-1 text-[11px] text-neutral-500 dark:text-neutral-400">
                母集団: {run.universe}
              </p>
            )}
          </section>

          {/* ---------------------------------------- 目標の買値に届いたもの */}
          {reached.length > 0 && (
            <section className="mx-4 mt-3 rounded-2xl bg-amber-50 p-4 dark:bg-amber-950/40">
              <h2 className="text-sm font-bold text-amber-900 dark:text-amber-200">
                目標の買値に届いています
              </h2>
              <ul className="mt-1.5 space-y-1">
                {reached.map((c) => {
                  const d = decisionOf.get(c.code)!;
                  return (
                    <li key={c.id} className="text-[13px] text-amber-900 dark:text-amber-200">
                      {c.name} · いま {c.price?.toLocaleString("ja-JP")}円(目標{" "}
                      {d.target_price?.toLocaleString("ja-JP")}円)
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {/* -------------------------------------------------------- 推薦 */}
          {recommended.length > 0 && (
            <section className="mt-4">
              <h2 className="px-4 pb-1.5 text-xs font-bold text-neutral-500">
                推した{recommended.length}銘柄
                <span className="ml-1 font-normal">— 上の基準で並べた結果です</span>
              </h2>
              <div className="space-y-2 px-4">
                {recommended.map((c) => (
                  <RecommendCard
                    key={c.id}
                    candidate={c}
                    policy={policy}
                    decision={decisionOf.get(c.code) ?? null}
                    onOpen={() => setSelected(c)}
                  />
                ))}
              </div>
            </section>
          )}

          {/* -------------------------------------------------------- 一覧 */}
          <section className="mt-5">
            <div className="flex items-center gap-2 overflow-x-auto px-4 pb-2">
              {SORT_KEYS.map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setSort(k)}
                  className={`h-9 shrink-0 rounded-full px-3.5 text-xs font-bold ${
                    sort === k
                      ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900"
                      : "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"
                  }`}
                >
                  {k}順
                </button>
              ))}
              <button
                type="button"
                onClick={() => setOnlyUndecided((v) => !v)}
                className={`h-9 shrink-0 rounded-full px-3.5 text-xs font-bold ${
                  onlyUndecided
                    ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900"
                    : "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"
                }`}
              >
                未判断のみ
              </button>
            </div>

            {listed.length === 0 ? (
              <p className="px-6 py-10 text-center text-sm text-neutral-500 dark:text-neutral-400">
                全部に判断が付いています。
              </p>
            ) : (
              <ul className="divide-y divide-neutral-100 border-y border-neutral-200 bg-white dark:divide-neutral-800 dark:border-neutral-800 dark:bg-neutral-900">
                {listed.map((c) => (
                  <CandidateRow
                    key={c.id}
                    candidate={c}
                    policy={policy}
                    decision={decisionOf.get(c.code) ?? null}
                    onOpen={() => setSelected(c)}
                  />
                ))}
              </ul>
            )}
          </section>

          <p className="mx-4 mt-6 rounded-xl bg-neutral-100 px-4 py-3 text-[11px] leading-relaxed text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
            点数はここで計算しています。チャットが入れているのは出典のある素の数字だけで、
            重みを変えれば並びはその場で変わります。買うかどうかを決めるのは、
            この画面で押したボタンだけです。
          </p>
        </>
      )}

      {selected && (
        <CandidateSheet
          candidate={selected}
          policy={policy}
          decision={decisionOf.get(selected.code) ?? null}
          accounts={accounts}
          onClose={() => setSelected(null)}
          onSaved={() => {
            setSelected(null);
            decisions.refetch();
            holdings.refetch();
          }}
          onError={onError}
        />
      )}

      {editingPolicy && (
        <PolicySheet
          policy={policy}
          onClose={() => setEditingPolicy(false)}
          onSaved={() => {
            setEditingPolicy(false);
            policyRows.refetch();
          }}
          onError={onError}
        />
      )}
    </>
  );
}

// ------------------------------------------------------------------ 部品

const DECISION_STYLE: Record<Decision, string> = {
  買う: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-200",
  見送る: "bg-neutral-200 text-neutral-600 dark:bg-neutral-700 dark:text-neutral-300",
  保留: "bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-200",
};

function DecisionBadge({ decision }: { decision: Decision }) {
  return (
    <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${DECISION_STYLE[decision]}`}>
      {decision}
    </span>
  );
}

function num(value: number | null | undefined, unit = "", digits = 1): string {
  if (value == null) return "—";
  return `${value.toLocaleString("ja-JP", { maximumFractionDigits: digits })}${unit}`;
}

function RecommendCard({
  candidate: c,
  policy,
  decision,
  onOpen,
}: {
  candidate: ScreeningCandidate;
  policy: PolicyLike;
  decision: StockDecision | null;
  onOpen: () => void;
}) {
  const cost = unitCost(c);
  const over = !withinBudget(c, policy);
  return (
    <button
      type="button"
      onClick={onOpen}
      className="w-full rounded-2xl border border-neutral-200 bg-white p-4 text-left dark:border-neutral-800 dark:bg-neutral-900"
    >
      <div className="flex items-start justify-between gap-3">
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="rounded bg-neutral-900 px-1.5 py-0.5 text-[10px] font-bold text-white dark:bg-neutral-100 dark:text-neutral-900">
              {c.rank ?? "推"}
            </span>
            <span className="truncate text-sm font-bold">{c.name}</span>
            {decision && <DecisionBadge decision={decision.decision} />}
          </span>
          <span className="mt-0.5 block text-[11px] text-neutral-500 dark:text-neutral-400">
            {c.code}
            {c.sector ? ` · ${c.sector}` : ""}
          </span>
        </span>
        <span className="shrink-0 text-right">
          <span className="block text-sm font-bold tabular-nums">{num(c.div_yield, "%", 2)}</span>
          <span className="block text-[11px] tabular-nums text-neutral-500 dark:text-neutral-400">
            {cost != null ? yen(cost) : "—"}
          </span>
        </span>
      </div>
      {over && (
        <p className="mt-1 text-[11px] font-bold text-rose-700 dark:text-rose-300">
          1単元が予算を超えています
        </p>
      )}
      {c.reason && (
        <p className="mt-2 whitespace-pre-wrap text-[12px] leading-relaxed text-neutral-700 dark:text-neutral-200">
          {c.reason}
        </p>
      )}
      {c.risk && (
        <p className="mt-1.5 whitespace-pre-wrap text-[12px] leading-relaxed text-rose-700 dark:text-rose-300">
          弱点: {c.risk}
        </p>
      )}
    </button>
  );
}

function CandidateRow({
  candidate: c,
  policy,
  decision,
  onOpen,
}: {
  candidate: ScreeningCandidate;
  policy: PolicyLike;
  decision: StockDecision | null;
  onOpen: () => void;
}) {
  const cost = unitCost(c);
  const over = !withinBudget(c, policy);
  const low = belowMinYield(c, policy);
  const s = scoreOf(c, policy);
  return (
    <li>
      <button type="button" onClick={onOpen} className="w-full px-4 py-3 text-left">
        <div className="flex items-start justify-between gap-3">
          <span className={`min-w-0 flex-1 ${low ? "opacity-60" : ""}`}>
            <span className="flex items-center gap-1.5">
              <span className="truncate text-sm font-semibold">{c.name}</span>
              {decision && <DecisionBadge decision={decision.decision} />}
            </span>
            <span className="mt-0.5 block text-[11px] text-neutral-500 dark:text-neutral-400">
              {c.code}
              {c.sector ? ` · ${c.sector}` : ""}
              {s.total != null && ` · 総合 ${Math.round(s.total)}点`}
              {/* 【薄さを隠さない】4つのうち何個を見た点なのかを必ず添える。
                  利回りしか拾えていない銘柄が、よく調べた銘柄より上に見えないように */}
              {s.total != null && s.covered < s.weighted && ` (根拠 ${s.covered}/${s.weighted})`}
            </span>
          </span>
          <span className="shrink-0 text-right">
            <span className="block text-sm font-bold tabular-nums">{num(c.div_yield, "%", 2)}</span>
            <span
              className={`block text-[11px] tabular-nums ${
                over
                  ? "font-bold text-rose-700 dark:text-rose-300"
                  : "text-neutral-500 dark:text-neutral-400"
              }`}
            >
              {cost != null ? yen(cost) : "—"}
              {over && " 予算超"}
            </span>
          </span>
        </div>
      </button>
    </li>
  );
}

function ScoreBar({ label, value }: { label: string; value: number | null }) {
  return (
    <div>
      <div className="flex items-baseline justify-between text-[11px]">
        <span className="text-neutral-500 dark:text-neutral-400">{label}</span>
        {/* 棒だけにしない。数字が読めないと、無い(—)と0点の区別が付かない */}
        <span className="font-bold tabular-nums">{value == null ? "—" : `${Math.round(value)}`}</span>
      </div>
      <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-700">
        <div
          className="h-full rounded-full bg-neutral-800 dark:bg-neutral-200"
          style={{ width: `${value ?? 0}%` }}
        />
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] text-neutral-500 dark:text-neutral-400">{label}</dt>
      <dd className="text-[13px] font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

/** 数字の入力欄。空欄は null(「入れていない」)にする。0 とは違う */
function parseNum(text: string): number | null {
  const t = text.trim().replace(/,/g, "");
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

const INPUT =
  "h-12 w-full rounded-xl border border-neutral-300 bg-white px-3 text-base tabular-nums dark:border-neutral-700 dark:bg-neutral-800";

function CandidateSheet({
  candidate: c,
  policy,
  decision,
  accounts,
  onClose,
  onSaved,
  onError,
}: {
  candidate: ScreeningCandidate;
  policy: PolicyLike;
  decision: StockDecision | null;
  accounts: string[];
  onClose: () => void;
  onSaved: () => void;
  onError: (message: string | null) => void;
}) {
  const [choice, setChoice] = useState<Decision | null>(decision?.decision ?? null);
  const [target, setTarget] = useState(decision?.target_price?.toString() ?? "");
  const [memo, setMemo] = useState(decision?.memo ?? "");
  const [busy, setBusy] = useState(false);

  const [buying, setBuying] = useState(false);
  const [account, setAccount] = useState(accounts[0] ?? "NISA成長");
  const [quantity, setQuantity] = useState(String(c.unit_shares ?? 100));
  const [acqPrice, setAcqPrice] = useState(c.price?.toString() ?? "");

  const s = scoreOf(c, policy);
  const cost = unitCost(c);
  const perUnit = unitDividend(c);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    onError(null);
    try {
      await fn();
      onSaved();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const save = () =>
    run(async () => {
      if (!choice) return;
      await saveDecision({
        code: c.code,
        name: c.name,
        decision: choice,
        targetPrice: parseNum(target),
        memo: memo.trim() || null,
        fromAsOf: c.as_of,
      });
    });

  /**
   * 買ったぶんを保有に入れる。
   * 判断も「買う」に揃える。買ったのに一覧が「保留」のままだと、次に見たときに迷う。
   */
  const registerBought = () =>
    run(async () => {
      const qty = parseNum(quantity);
      const price = parseNum(acqPrice);
      if (qty == null || price == null || !account.trim()) return;
      await addHolding({
        account: account.trim(),
        code: c.code,
        name: c.name,
        quantity: qty,
        acqPrice: price,
      });
      await saveDecision({
        code: c.code,
        name: c.name,
        decision: "買う",
        targetPrice: parseNum(target),
        memo: memo.trim() || null,
        fromAsOf: c.as_of,
      });
    });

  return (
    <Sheet onClose={onClose}>
      <h2 className="text-base font-bold">{c.name}</h2>
      <p className="text-[11px] text-neutral-500 dark:text-neutral-400">
        {c.code}
        {c.market ? ` · ${c.market}` : ""}
        {c.sector ? ` · ${c.sector}` : ""} · {formatDate(c.as_of)}時点
      </p>

      {/* -------------------------------------------------- 4つの軸 */}
      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2.5">
        <ScoreBar label="利回り" value={s.yield} />
        <ScoreBar label="増配の継続" value={s.growth} />
        <ScoreBar label="割安さ" value={s.value} />
        <ScoreBar label="配当の余力" value={s.safety} />
      </div>
      <p className="mt-1.5 text-[11px] text-neutral-500 dark:text-neutral-400">
        総合 {s.total == null ? "—" : `${Math.round(s.total)}点`} · 根拠 {s.covered}/
        {s.weighted}(いまの重みで計算。数字が無い軸は点にせず、残りの軸だけで
        出しています)
      </p>
      {thinlyKnown(c, policy) && (
        <p className="mt-1 text-[11px] font-bold text-amber-700 dark:text-amber-300">
          材料が半分に届いていません。この点は当てにせず、一覧でも下のほうに置いています。
        </p>
      )}

      {/* -------------------------------------------------- 素の数字 */}
      <dl className="mt-3 grid grid-cols-3 gap-2 rounded-xl bg-neutral-50 p-3 dark:bg-neutral-800">
        <Field label="株価" value={num(c.price, "円", 1)} />
        <Field label="予想利回り" value={num(c.div_yield, "%", 2)} />
        <Field label="1株配当" value={num(c.dividend, "円", 2)} />
        <Field label="PER" value={num(c.per, "倍", 2)} />
        <Field label="PBR" value={num(c.pbr, "倍", 2)} />
        <Field label="配当性向" value={num(c.payout_ratio, "%", 1)} />
        <Field
          label="連続増配"
          value={c.streak_years == null ? "—" : `${c.streak_years}年`}
        />
        <Field
          label="累進配当"
          value={c.progressive == null ? "—" : c.progressive ? "明言あり" : "明言なし"}
        />
        <Field
          label="年初来"
          value={
            c.year_low == null || c.year_high == null
              ? "—"
              : `${c.year_low.toLocaleString("ja-JP")}〜${c.year_high.toLocaleString("ja-JP")}`
          }
        />
      </dl>

      {/* -------------------------------------- いくら出していくら入るか */}
      <div className="mt-3 rounded-xl bg-neutral-50 p-3 dark:bg-neutral-800">
        <p className="text-[13px] font-semibold">
          1単元({c.unit_shares ?? 100}株)= {cost == null ? "—" : yen(cost)}
          {!withinBudget(c, policy) && (
            <span className="ml-1 text-rose-700 dark:text-rose-300">予算超</span>
          )}
        </p>
        <p className="mt-1 text-[12px] text-neutral-600 dark:text-neutral-300">
          1年の配当 {perUnit == null ? "—" : yen(perUnit)}(税引前)
          {perUnit != null && (
            <>
              {" "}
              / 特定口座の手取り目安 {yen(Math.round(perUnit * AFTER_TAX))}
            </>
          )}
        </p>
        <p className="mt-0.5 text-[11px] text-neutral-500 dark:text-neutral-400">
          NISA なら配当に税がかからないので、税引前の額がそのまま入ります。
        </p>
      </div>

      {/* -------------------------------------------------- 理由と出典 */}
      {c.reason && (
        <p className="mt-3 whitespace-pre-wrap text-[13px] leading-relaxed">{c.reason}</p>
      )}
      {c.risk && (
        <p className="mt-2 whitespace-pre-wrap text-[13px] leading-relaxed text-rose-700 dark:text-rose-300">
          弱点: {c.risk}
        </p>
      )}
      {c.source && (
        <p className="mt-2 text-[11px] text-neutral-500 dark:text-neutral-400">出典: {c.source}</p>
      )}

      {/* -------------------------------------------------- 判断 */}
      <h3 className="mt-5 text-sm font-bold">どうする</h3>
      <div className="mt-2 flex gap-2">
        {DECISIONS.map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => setChoice(d)}
            className={`h-12 flex-1 rounded-xl text-sm font-bold ${
              choice === d
                ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900"
                : "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"
            }`}
          >
            {d}
          </button>
        ))}
      </div>

      <label className="mt-3 block text-xs font-medium text-neutral-500">
        目標の買値(円・空でよい)
      </label>
      <input
        value={target}
        onChange={(e) => setTarget(e.target.value)}
        inputMode="decimal"
        placeholder={c.price != null ? String(Math.round(c.price * 0.9)) : "2800"}
        className={`mt-1 ${INPUT}`}
      />
      <p className="mt-1 text-[11px] text-neutral-500 dark:text-neutral-400">
        次に数字を更新したとき、ここまで下がっていれば一覧の上で知らせます。
      </p>

      <label className="mt-3 block text-xs font-medium text-neutral-500">メモ</label>
      <textarea
        value={memo}
        onChange={(e) => setMemo(e.target.value)}
        rows={3}
        placeholder="見送るなら、その理由を1行だけでも残しておくと次に効きます"
        className="mt-1 w-full rounded-xl border border-neutral-300 bg-white p-3 text-sm leading-relaxed dark:border-neutral-700 dark:bg-neutral-800"
      />

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
          onClick={() => void save()}
          disabled={busy || !choice}
          className="h-14 flex-[2] rounded-xl bg-emerald-600 text-base font-bold text-white disabled:opacity-40"
        >
          記録する
        </button>
      </div>

      {/* ------------------------------------------ 買ったら保有に入れる */}
      <div className="mt-6 border-t border-neutral-200 pt-4 dark:border-neutral-800">
        {!buying ? (
          <button
            type="button"
            onClick={() => setBuying(true)}
            className="h-12 w-full rounded-xl bg-neutral-100 text-sm font-bold text-neutral-700 dark:bg-neutral-800 dark:text-neutral-200"
          >
            買ったので保有に入れる
          </button>
        ) : (
          <>
            <h3 className="text-sm font-bold">買った記録</h3>
            <p className="mt-1 text-[11px] leading-relaxed text-neutral-500 dark:text-neutral-400">
              約定した株数と単価を入れてください。評価額と損益はここでは作りません
              (買った直後は取得額と同じで、翌日には嘘になるため)。月1回の更新で入ります。
            </p>
            {accounts.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {accounts.map((a) => (
                  <button
                    key={a}
                    type="button"
                    onClick={() => setAccount(a)}
                    className={`h-8 rounded-full px-3 text-xs font-bold ${
                      account === a
                        ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900"
                        : "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"
                    }`}
                  >
                    {a}
                  </button>
                ))}
              </div>
            )}
            <label className="mt-2 block text-xs font-medium text-neutral-500">口座</label>
            <input
              value={account}
              onChange={(e) => setAccount(e.target.value)}
              className={`mt-1 ${INPUT}`}
            />
            <div className="mt-2 flex gap-3">
              <div className="flex-1">
                <label className="block text-xs font-medium text-neutral-500">株数</label>
                <input
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  inputMode="numeric"
                  className={`mt-1 ${INPUT}`}
                />
              </div>
              <div className="flex-1">
                <label className="block text-xs font-medium text-neutral-500">取得単価(円)</label>
                <input
                  value={acqPrice}
                  onChange={(e) => setAcqPrice(e.target.value)}
                  inputMode="decimal"
                  className={`mt-1 ${INPUT}`}
                />
              </div>
            </div>
            <button
              type="button"
              onClick={() => void registerBought()}
              disabled={busy || parseNum(quantity) == null || parseNum(acqPrice) == null}
              className="mt-3 h-14 w-full rounded-xl bg-neutral-900 text-base font-bold text-white disabled:opacity-40 dark:bg-neutral-100 dark:text-neutral-900"
            >
              保有に入れる
            </button>
          </>
        )}
      </div>
    </Sheet>
  );
}

/**
 * 並べ替えの基準。
 *
 * 重みは「合計100」に矯正しない。3つを0にして1つだけ見たいこともあるので、
 * 入った数字の比でそのまま使う(lib/screening.ts)。
 */
function PolicySheet({
  policy,
  onClose,
  onSaved,
  onError,
}: {
  policy: PolicyLike;
  onClose: () => void;
  onSaved: () => void;
  onError: (message: string | null) => void;
}) {
  const [budget, setBudget] = useState(policy.budget_per_stock?.toString() ?? "");
  const [wYield, setWYield] = useState(String(policy.w_yield));
  const [wGrowth, setWGrowth] = useState(String(policy.w_growth));
  const [wValue, setWValue] = useState(String(policy.w_value));
  const [wSafety, setWSafety] = useState(String(policy.w_safety));
  const [minYield, setMinYield] = useState(policy.min_yield?.toString() ?? "");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    onError(null);
    try {
      await saveInvestPolicy({
        budget_per_stock: parseNum(budget),
        w_yield: parseNum(wYield) ?? 0,
        w_growth: parseNum(wGrowth) ?? 0,
        w_value: parseNum(wValue) ?? 0,
        w_safety: parseNum(wSafety) ?? 0,
        min_yield: parseNum(minYield),
      });
      onSaved();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const weights: [string, string, (v: string) => void][] = [
    ["配当利回りの高さ", wYield, setWYield],
    ["増配・累進配当の継続", wGrowth, setWGrowth],
    ["割安さ(PER/PBR・年初来)", wValue, setWValue],
    ["配当の余力(配当性向)", wSafety, setWSafety],
  ];

  return (
    <Sheet onClose={onClose}>
      <h2 className="text-base font-bold">並べ替えの基準</h2>
      <p className="mt-1 text-[11px] leading-relaxed text-neutral-500 dark:text-neutral-400">
        変えると並びがその場で変わります。数字を取り直す必要はありません。
      </p>

      <label className="mt-3 block text-xs font-medium text-neutral-500">
        1銘柄あたりの上限(円)
      </label>
      <input
        value={budget}
        onChange={(e) => setBudget(e.target.value)}
        inputMode="numeric"
        placeholder="300000"
        className={`mt-1 ${INPUT}`}
      />

      <h3 className="mt-4 text-sm font-bold">重み</h3>
      <p className="mt-0.5 text-[11px] text-neutral-500 dark:text-neutral-400">
        合計が100でなくてもかまいません。比で使います。0 にすればその軸を見ません。
      </p>
      {weights.map(([label, value, set]) => (
        <div key={label} className="mt-2 flex items-center gap-3">
          <span className="flex-1 text-[13px]">{label}</span>
          <input
            value={value}
            onChange={(e) => set(e.target.value)}
            inputMode="numeric"
            className="h-12 w-20 rounded-xl border border-neutral-300 bg-white px-3 text-center text-base tabular-nums dark:border-neutral-700 dark:bg-neutral-800"
          />
        </div>
      ))}

      <label className="mt-4 block text-xs font-medium text-neutral-500">
        足切りの利回り(%・空でよい)
      </label>
      <input
        value={minYield}
        onChange={(e) => setMinYield(e.target.value)}
        inputMode="decimal"
        placeholder="3.5"
        className={`mt-1 ${INPUT}`}
      />
      <p className="mt-1 text-[11px] text-neutral-500 dark:text-neutral-400">
        これを下回る候補は一覧で薄く出ます。消しはしません
        (増配が続いていて利回りが低いだけの銘柄を、見えなくしないため)。
      </p>

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
          保存する
        </button>
      </div>
    </Sheet>
  );
}
