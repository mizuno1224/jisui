// 投資の「まとめ」を出すための計算。
//
// ============================================================
// 【方針の数値は、すべて 方針.md の IPS から取っている】
// 出典なしの数値をここに足さないこと。lib/health.ts と同じ決まりにする。
//
// | 決めごと | 値 | 出どころ |
// |---|---|---|
// | FANG+ のキャップ | 資産全体の15% | 方針.md 2. IPS(2026-08-05改定) |
// | 恒常積立 | S&P500 月10万 / iDeCo 月2万 / 日本高配当 月2〜3万 | 同上 |
// | FANG+ の積立 | 2026-08-13に終了(取得額100万円到達)。買い増さない | 同上 |
// | 押し目ルール | 年初来レンジ位置30%以下 かつ 減配なし | 同上 |
// | 防衛資金 | 現金190万・生活防衛13か月ぶん | 方針.md 1. 固定事実 |
//
// 【この画面がしないこと】
//   ・**売買をすすめない。** 参考情報の整理までにとどめる(スキルの禁止事項)
//   ・株価を自分で取りに行かない。数字は watch_history に人が記録した日のもの
//   ・独自の評価点をつけない。方針に書いてある線と、いまの数字を並べるだけ
// ============================================================

import type { Holding, WatchHistory } from "@/lib/types";

// ------------------------------------------------------------ 方針の数値

export const IPS = {
  /** FANG+ は資産全体の15%を超えたら縮小を検討する(方針.md) */
  fangCapPct: 15,
  /** 押し目ルールの線。年初来レンジ位置がこれ以下 */
  dipRangePct: 30,
  source: "方針.md 2. 投資方針書(IPS) 2026-08-05改定",
  /** 恒常積立。金額は方針値なので、記録ではなくここに書いてよい */
  monthly: [
    { name: "S&P500(つみたて枠)", amount: 100000 },
    { name: "iDeCo", amount: 20000 },
    { name: "日本高配当投信(成長枠)", amount: 25000, note: "月2〜3万" },
  ],
  /** 2026-08-13に積立終了。以後は保有継続で買い増さない */
  fangStoppedOn: "2026-08-13",
} as const;

// ------------------------------------------------------------ 分類

export type Bucket = "米国・先進国コア" | "FANG+" | "日本株" | "その他";

/**
 * 銘柄をどの柱に数えるか。
 *
 * 【名前で判定する】。holdings に分類の列が無いため。
 * 銘柄を増やしたらここに足す。**当てはまらないものは「その他」に落とす。**
 * 勝手にコアへ入れると、配分の比率が静かにずれる。
 */
export function bucketOf(h: Holding): Bucket {
  const name = h.name ?? "";
  if (/FANG\+/i.test(name)) return "FANG+";
  if (h.kind === "株式") return "日本株";
  if (/S&P500|先進国|外国株式|全世界|オール・カントリー|米国株式/.test(name)) {
    return "米国・先進国コア";
  }
  return "その他";
}

export const BUCKET_STYLE: Record<Bucket, { bar: string; chip: string }> = {
  "米国・先進国コア": { bar: "bg-emerald-500", chip: "bg-emerald-100 text-emerald-900" },
  "FANG+": { bar: "bg-violet-500", chip: "bg-violet-100 text-violet-900" },
  日本株: { bar: "bg-sky-500", chip: "bg-sky-100 text-sky-900" },
  その他: { bar: "bg-neutral-400", chip: "bg-neutral-200 text-neutral-800" },
};

/**
 * 銘柄ごとに、いちばん新しい記録だけを採る。
 *
 * 【最新日で一括に切らない】。口座ごとに記録した日が違う(NISAは8/3、iDeCoは8/4)。
 * 最新日で切ると、その日に触らなかった口座が丸ごと消える。
 * InvestmentsScreen と同じ考え方。片方だけ直さないこと。
 */
export function latestHoldings(rows: Holding[]): Holding[] {
  const latest = new Map<string, Holding>();
  for (const h of rows) {
    const key = `${h.account}|${h.name}`;
    const prev = latest.get(key);
    if (!prev || h.as_of > prev.as_of) latest.set(key, h);
  }
  return [...latest.values()];
}

// ------------------------------------------------------------ 年初来レンジ

/**
 * 年初来レンジのどこにいるか(0%=安値、100%=高値)。
 *
 * 押し目ルールはこの数字で決まる。**高値と安値のどちらかが空なら出さない。**
 * 片方だけで計算すると、根拠のない数字が出る。
 */
export function rangePosition(h: WatchHistory): number | null {
  const high = h.year_high == null ? null : Number(h.year_high);
  const low = h.year_low == null ? null : Number(h.year_low);
  const price = h.price == null ? null : Number(h.price);
  if (high == null || low == null || price == null) return null;
  if (high <= low) return null;
  return Math.round(((price - low) / (high - low)) * 1000) / 10;
}

/** 銘柄ごとの、いちばん新しい記録。 */
export function latestByCode(rows: WatchHistory[]): Map<string, WatchHistory> {
  const map = new Map<string, WatchHistory>();
  for (const h of rows) {
    const prev = map.get(h.code);
    if (!prev || h.as_of > prev.as_of) map.set(h.code, h);
  }
  return map;
}

/** 記録がどれだけ古いか。株価は自動で入らないので、これを必ず画面に出す。 */
export function daysOld(iso: string, today: string): number {
  return Math.round(
    (new Date(`${today}T00:00:00`).getTime() - new Date(`${iso}T00:00:00`).getTime()) / 86_400_000,
  );
}

/** 割合(%)。分母が0のときは null。0で割った0%を出さない。 */
export function share(part: number, whole: number): number | null {
  if (!whole) return null;
  return Math.round((part / whole) * 1000) / 10;
}
