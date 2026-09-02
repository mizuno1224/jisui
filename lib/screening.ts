// 高配当株の候補に点を付ける。
//
// 【なぜアプリ側で計算するのか】
// 点数を DB に焼くと、重みを変えるたびに全銘柄を入れ直すことになる。
// チャットが入れるのは出典のある素の数字(利回り・PER・配当性向など)だけにして、
// 「その数字をどう重く見るか」はここに置く。基準を直したら並びがその場で変わる。
//
// 【点は判断ではない】
// 4つの軸はどれも「自分たちが決めた物差し」であって、正しさの保証ではない。
// だから画面では総合点だけを出さず、必ず素の数字と理由・リスクを並べて出す。
import type { InvestPolicy, ScreeningCandidate } from "./types";

/** 並べ替えに要るぶんだけ。保存済みの行(InvestPolicy)も既定値も同じ形で渡せる */
export type PolicyLike = Pick<
  InvestPolicy,
  "budget_per_stock" | "w_yield" | "w_growth" | "w_value" | "w_safety" | "min_yield"
>;

/** 基準がまだ1度も保存されていないときの既定値 */
export const DEFAULT_POLICY: PolicyLike = {
  // 1銘柄あたりの上限。単元価格がこれを超えると「予算超」と出す
  budget_per_stock: 300_000,
  w_yield: 25,
  w_growth: 25,
  w_value: 25,
  w_safety: 25,
  min_yield: null,
};

/** 特定口座での配当の手取り率(所得税15.315% + 住民税5%)。NISA なら満額 */
export const AFTER_TAX = 1 - 0.20315;

/**
 * value を「0点の位置」と「100点の位置」の間に置き換える。
 *
 * atZero > atHundred でもよい(PER や配当性向のように小さいほうが良い指標)。
 * 範囲の外はそれぞれ 0 / 100 で止める。**外挿しない。**
 * 利回り8%を「160点」と扱うと、減配予備軍が上に来てしまう。
 */
function band(value: number | null | undefined, atZero: number, atHundred: number): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  const t = (value - atZero) / (atHundred - atZero);
  return Math.max(0, Math.min(100, t * 100));
}

function mean(values: (number | null)[]): number | null {
  const ok = values.filter((v): v is number => v != null);
  if (ok.length === 0) return null;
  return ok.reduce((s, v) => s + v, 0) / ok.length;
}

export type Scores = {
  /** 配当利回りの高さ。2.0% で0点、5.0% で100点 */
  yield: number | null;
  /** 増配・累進配当の継続性 */
  growth: number | null;
  /** 割安さ。PER・PBR・年初来のどのあたりにいるかの平均 */
  value: number | null;
  /** 配当の余力。配当性向が低いほど高い */
  safety: number | null;
  /** 重みで合成した総合点。素材が1つも無ければ null */
  total: number | null;
  /**
   * その点が、重みのうちどれだけを実際に見て付いたか(0〜1)。
   *
   * 【これが無いと順番が壊れる】
   * 分からない軸を平均から外す作りなので、**利回りしか拾えていない銘柄は
   * 「利回りの点」がそのまま総合点になる。**実際、利回り4.0%だけしか無い会社が
   * 66点となり、4つとも埋まっている三菱商事(58点)を抜いた。
   * 点そのものは間違っていない。間違うのは「並べたときに上に来る」ほう。
   * だから薄さを別に持ち、並べ替えでは下の組に落とし、画面にも 3/4 と出す。
   */
  coverage: number;
  /** 見られた軸の数と、重みが付いている軸の数。画面に「根拠 3/4」と出す */
  covered: number;
  weighted: number;
};

export function scoreOf(c: ScreeningCandidate, policy: PolicyLike): Scores {
  const yieldScore = band(c.div_yield, 2.0, 5.0);

  // 増配は「方針として言っているか」を重く見る。
  // 累進配当(減配しない)を明言していれば、それだけで55点。
  // たまたま10年続いているだけの会社と、明言している会社を同じ点にはしない。
  const growth =
    c.progressive == null && c.streak_years == null
      ? null
      : Math.min(
          100,
          (c.progressive ? 55 : 0) + Math.min(c.streak_years ?? 0, 10) * 4.5,
        );

  // 年初来のどのあたりか。安値なら100点、高値なら0点。
  // 高値と安値が同じ(データ不備)のときは 0 除算になるので外す。
  const range = c.year_high != null && c.year_low != null ? c.year_high - c.year_low : null;
  const position =
    range != null && range > 0 && c.price != null
      ? band((c.price - c.year_low!) / range, 1, 0)
      : null;

  const value = mean([band(c.per, 20, 8), band(c.pbr, 2.0, 0.8), position]);

  // 配当性向。30%で100点、80%で0点。100%超(利益を超えて配っている)は0点。
  const safety = band(c.payout_ratio, 80, 30);

  const axes: [number | null, number][] = [
    [yieldScore, policy.w_yield],
    [growth, policy.w_growth],
    [value, policy.w_value],
    [safety, policy.w_safety],
  ];
  // 分からない軸は「0点」にしない。**その軸を無かったことにして残りで割る。**
  // 配当性向が拾えなかっただけの銘柄が、財務の悪い銘柄より下に来ないようにする。
  const weighted = axes.filter(([, w]) => w > 0);
  const usable = weighted.filter(([s]) => s != null);
  const weight = usable.reduce((sum, [, w]) => sum + w, 0);
  const total =
    weight > 0 ? usable.reduce((sum, [s, w]) => sum + s! * w, 0) / weight : null;
  const fullWeight = weighted.reduce((sum, [, w]) => sum + w, 0);

  return {
    yield: yieldScore,
    growth,
    value,
    safety,
    total,
    coverage: fullWeight > 0 ? weight / fullWeight : 0,
    covered: usable.length,
    weighted: weighted.length,
  };
}

/**
 * この点を「並べるのに使ってよい」とみなす下限。
 *
 * 重みの半分より少ない材料しか無ければ、点はそのまま出すが順番では下の組に置く。
 * 消さないのは、拾い直せば上がってくる候補だから(次に更新したときに戻る)。
 */
export const MIN_COVERAGE = 0.5;

export function thinlyKnown(c: ScreeningCandidate, policy: PolicyLike): boolean {
  return scoreOf(c, policy).coverage < MIN_COVERAGE;
}

/** 1単元を買うのにいくら要るか。単元株数が入っていなければ100株とみなす */
export function unitCost(c: ScreeningCandidate): number | null {
  if (c.price == null) return null;
  return Math.round(c.price * (c.unit_shares ?? 100));
}

/** 1単元を1年持つと受け取れる配当(税引前) */
export function unitDividend(c: ScreeningCandidate): number | null {
  if (c.dividend == null) return null;
  return Math.round(c.dividend * (c.unit_shares ?? 100));
}

/** 予算に収まるか。予算が未設定なら「収まる」扱いにして、色分けをしない */
export function withinBudget(c: ScreeningCandidate, policy: PolicyLike): boolean {
  const cost = unitCost(c);
  if (cost == null || policy.budget_per_stock == null) return true;
  return cost <= policy.budget_per_stock;
}

/** 足切り(min_yield)より下か。消しはせず、薄く出すための判定 */
export function belowMinYield(c: ScreeningCandidate, policy: PolicyLike): boolean {
  if (policy.min_yield == null || c.div_yield == null) return false;
  return c.div_yield < policy.min_yield;
}

export const SORT_KEYS = ["総合点", "利回り", "割安", "単元価格"] as const;
export type SortKey = (typeof SORT_KEYS)[number];

/**
 * 並べ替え。
 *
 * 数字が無い銘柄(null)は必ず最後に置く。null を0として混ぜると、
 * 「拾えなかっただけ」の銘柄が最下位に沈んで、拾い直す機会が無くなる。
 */
export function sortCandidates(
  rows: ScreeningCandidate[],
  key: SortKey,
  policy: PolicyLike,
): ScreeningCandidate[] {
  const value = (c: ScreeningCandidate): number | null => {
    switch (key) {
      case "総合点":
        return scoreOf(c, policy).total;
      case "利回り":
        return c.div_yield;
      case "割安":
        return scoreOf(c, policy).value;
      case "単元価格":
        return unitCost(c);
    }
  };
  // 単元価格だけは「安い順」。ほかは「高い順」
  const ascending = key === "単元価格";
  // 点で並べるときだけ、材料の薄い候補を下の組に落とす(単元価格や利回りは
  // 1つの数字がそのまま答えなので、薄いかどうかは関係ない)。
  const tiered = key === "総合点" || key === "割安";
  return [...rows].sort((a, b) => {
    if (tiered) {
      const ta = thinlyKnown(a, policy) ? 1 : 0;
      const tb = thinlyKnown(b, policy) ? 1 : 0;
      if (ta !== tb) return ta - tb;
    }
    const va = value(a);
    const vb = value(b);
    if (va == null && vb == null) return a.code.localeCompare(b.code);
    if (va == null) return 1;
    if (vb == null) return -1;
    return ascending ? va - vb : vb - va;
  });
}

/**
 * 目標の買値に届いたか。
 *
 * 「2,800円まで下がったら買う」を持っている銘柄で、いまの株価がそれ以下なら true。
 * 到達を知らせるのは、値動きを毎日見ない使い方(月1回更新)を前提にしているため。
 */
export function reachedTarget(price: number | null, target: number | null): boolean {
  if (price == null || target == null) return false;
  return price <= target;
}
