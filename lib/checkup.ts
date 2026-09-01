// 健康診断(健診・人間ドック・血液検査)の記録を扱う場所。
//
// ============================================================
// 【19_health.sql の健康機能とは、基準の出どころが違う】
//
//   lib/health.ts の基準 … 公的ガイドラインの目標値(BMI 21〜25 など)。
//                          出典を必ず持つ。こちらで数値を作らない。
//   この画面の基準       … **検査票に印刷されている基準**。行が自分で持つ。
//
// 同じ LDL でも検査機関によって基準が違う。アプリが1つの基準を決めて色を付けると、
// 手元の紙と画面で判定が食い違い、どちらが正しいのか分からなくなる。
// **判定は、その行に写した基準だけから出す。** 基準が空なら「判定なし」と言う。
// 空欄を「基準内」と読み替えない。
//
// 【やらないこと】(lib/health.ts と同じ)
//   ・診断をしない。「◯◯の疑いがあります」は書かない
//   ・検査票の判定(A / B / C1 …)を良し悪しに読み替えない。
//     機関ごとに意味が違うので、**書いてある文字をそのまま出す**
//   ・前回からの増減に色を付けない。上がって良い項目(HDL)と
//     悪い項目(LDL)が混ざっており、向きの意味は項目ごとに違う
// ============================================================

// ------------------------------------------------------------------ 表の形

/** supabase/20_checkup.sql の checkup。受診1回ぶん。 */
export type Checkup = {
  id: number;
  household_id: string;
  member: "夫" | "妻";
  date: string;
  /** 定期健診 / 人間ドック / 血液検査 / ABC検診 … 検査票の呼び名をそのまま */
  kind: string;
  place: string | null;
  /** 総合判定。A / B / C1 のように検査票の文字をそのまま持つ */
  overall: string | null;
  finding: string | null;
  memo: string | null;
  created_at: string;
};

/** supabase/20_checkup.sql の checkup_result。項目1つぶん。 */
export type CheckupResult = {
  id: number;
  checkup_id: number;
  item: string;
  /** 折れ線・前回比に使う値。「(−)」のような結果は null になる */
  value_num: number | null;
  /** 数値にならない結果。(−) / 異常なし など */
  value_text: string | null;
  unit: string | null;
  ref_low: number | null;
  ref_high: number | null;
  /** 数値2つで書けない基準。「(−)」「70.1以上」など */
  ref_text: string | null;
  /** 検査票の判定(A / B / C / D1 …) */
  judge: string | null;
  memo: string | null;
  sort_order: number;
};

// ---------------------------------------------------------------- 項目の並び

/**
 * 推移の表に並べる順。
 *
 * 【意味づけではなく並び順だけを持つ】。どれが大事かはここで決めない。
 * 検査票がだいたいこの順(体格 → 血圧 → 脂質 → 糖 → 肝 → 腎 → 血液 → 尿)で
 * 印刷されているので、紙と見比べながら読めるようにそろえてある。
 *
 * ここに無い項目も必ず出す。**知らない項目を落とさないこと。**
 * 落とすと「アプリに出ていない = 記録されていない」と読めてしまう。
 * 並びの最後に、検査票に書かれていた順(sort_order)で続ける。
 */
export const ITEM_ORDER: string[] = [
  // 体格
  "身長", "体重", "BMI", "腹囲", "体脂肪率",
  // 血圧
  "血圧", "収縮期血圧", "拡張期血圧",
  // 脂質
  "HDL-C", "LDL-C", "中性脂肪", "総コレステロール",
  // 糖代謝
  "空腹時血糖", "HbA1c",
  // 肝機能
  "AST", "ALT", "γ-GTP", "総ビリルビン", "ALP",
  // 腎機能・尿酸
  "クレアチニン", "eGFR", "尿酸",
  // 血液
  "ヘモグロビン", "赤血球", "白血球", "血小板", "ヘマトクリット", "CRP",
  // 尿
  "尿蛋白", "尿潜血", "尿糖",
  // 画像・生理
  "胸部X線", "心電図", "腹部超音波", "上部内視鏡", "肺機能", "眼底", "眼圧", "聴力",
  // 感染
  "ピロリ菌抗体", "ペプシノゲンⅠ", "PGⅠ/Ⅱ比", "HBs抗原", "HCV抗体",
  // 便
  "便潜血",
];

const RANK = new Map(ITEM_ORDER.map((name, i) => [name, i]));

/** 推移の表の行順。知らない項目は検査票の順のまま後ろに続ける。 */
export function itemRank(item: string, sortOrder = 0): number {
  const known = RANK.get(item);
  return known != null ? known : ITEM_ORDER.length + sortOrder;
}

// ---------------------------------------------------------------- 判定

/**
 * 1項目の状態。
 *
 * 【3つしかない】。「あと少し」を作らない。
 * lib/health.ts の信号は「毎日の習慣が目標に届いているか」を見るものなので
 * 途中の段階に意味があるが、検査値の 9割 に医学的な意味は無い。
 * 基準の中か外か、それとも基準が無いか。それだけを言う。
 */
export type ResultState = "基準内" | "基準から外れている" | "判定なし";

export const RESULT_STYLE: Record<ResultState, { chip: string; text: string }> = {
  基準内: {
    chip: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
    text: "text-neutral-900 dark:text-neutral-100",
  },
  基準から外れている: {
    chip: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300",
    text: "text-amber-700 dark:text-amber-400",
  },
  判定なし: {
    chip: "bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400",
    text: "text-neutral-900 dark:text-neutral-100",
  },
};

/**
 * その行が持っている基準だけで判定する。
 *
 * 【基準が空なら「判定なし」】。ここで一般的な基準を持ち出さない。
 * 「(−)」のような文字の結果も判定しない(陰性が正常とは限らない項目がある)。
 */
export function resultState(r: CheckupResult): ResultState {
  if (r.value_num == null) return "判定なし";
  if (r.ref_low == null && r.ref_high == null) return "判定なし";
  const v = Number(r.value_num);
  if (r.ref_low != null && v < Number(r.ref_low)) return "基準から外れている";
  if (r.ref_high != null && v > Number(r.ref_high)) return "基準から外れている";
  return "基準内";
}

/** 画面に出す値。数値が無ければ文字の結果、どちらも無ければ「—」。 */
export function formatValue(r: CheckupResult): string {
  if (r.value_num != null) return String(Number(r.value_num));
  return r.value_text ?? "—";
}

/**
 * 基準が書かれている行かどうか。
 *
 * 【単位しか無い行と区別する】。体重や血圧のように、検査票に基準が
 * 印刷されていない項目がある。そういう行に「基準 kg」と出すと、
 * 基準があるように読めてしまう。
 */
export function hasRef(r: CheckupResult): boolean {
  return r.ref_text != null || r.ref_low != null || r.ref_high != null;
}

/**
 * 「60〜119 mg/dl」「50以下 IU/l」の形。検査票に書いてあった基準をそのまま読める形に。
 * 基準が無く単位だけの行では、単位だけを返す(推移の表の右端はそれも受け持つ)。
 */
export function formatRef(r: CheckupResult): string | null {
  if (r.ref_text) return r.unit ? `${r.ref_text} ${r.unit}` : r.ref_text;
  const unit = r.unit ? ` ${r.unit}` : "";
  const lo = r.ref_low == null ? null : Number(r.ref_low);
  const hi = r.ref_high == null ? null : Number(r.ref_high);
  if (lo != null && hi != null) return `${lo}〜${hi}${unit}`;
  if (lo != null) return `${lo}以上${unit}`;
  if (hi != null) return `${hi}以下${unit}`;
  return r.unit ? r.unit : null;
}

/**
 * 前回との差。
 *
 * 【向きに色を付けない】。HDL は上がるほど良く、LDL は逆。
 * 一律に「増えたら赤」にすると、良い変化を警告として出すことになる。
 * 差だけを出して、読み方は人(と医師)に任せる。
 */
export function formatDelta(current: number | null, previous: number | null): string | null {
  if (current == null || previous == null) return null;
  const d = Math.round((Number(current) - Number(previous)) * 100) / 100;
  if (d === 0) return "前回と同じ";
  return `前回から ${d > 0 ? "+" : ""}${d}`;
}

// ---------------------------------------------------------------- 受診の並び

/** 新しい順。同じ日なら kind の名前順(並びが日によって入れ替わらないように)。 */
export function byNewest(a: Checkup, b: Checkup): number {
  return b.date.localeCompare(a.date) || a.kind.localeCompare(b.kind);
}

/** 「2026年6月・定期健診」の形。受診の見出しに使う。 */
export function checkupLabel(c: Checkup): string {
  const [y, m] = c.date.split("-");
  return `${y}年${Number(m)}月・${c.kind}`;
}

/** 推移の列見出し。「26/6」のように短くする(横に5列並べるため)。 */
export function shortLabel(c: Checkup): string {
  const [y, m] = c.date.split("-");
  return `${y.slice(2)}/${Number(m)}`;
}

/** 診断をしないアプリであることを、この機能のどの画面にも必ず1回書く。 */
export const CHECKUP_NOTE =
  "検査票に書かれていた値と基準をそのまま出しています。このアプリは診断をしません。判断は医師によります。";
