// 健康の判定を1か所にまとめた場所。
//
// ============================================================
// 【この一覧の数値は、すべて公的ガイドラインから取っている】
// 出典なしの数値をここに足さないこと。あとで誰も直せなくなる。
//
// | 項目       | 基準                                     | 出典 |
// |-----------|------------------------------------------|------|
// | BMI       | 21〜25(男女とも)                         | 国立がん研究センター「日本人のためのがん予防法」 |
// | 睡眠      | 成人は6時間以上を目安。加えて睡眠休養感を高める | 厚労省「健康づくりのための睡眠ガイド」 |
// | 身体活動  | 3メッツ以上を1日60分以上(週23メッツ・時以上) | 厚労省「身体活動・運動ガイド2023」 |
// | 運動      | 息が弾む程度の運動を週60分以上              | 同上 |
// | 筋トレ    | 週2〜3日                                  | 同上 |
// | 食塩      | 男7.5g / 女6.5g 未満(1日)                | がん予防法 |
// | 野菜・果物 | 野菜350g以上 / 果物200g(1日)             | がん予防法 |
// | 飲酒      | 純アルコール23g/日未満                     | がん予防法 |
// | 熱い飲食物 | 冷ましてから(65℃超を避ける)              | がん予防法 / IARC |
//
// 【やらないこと】
//   ・診断をしない。「◯◯の疑いがあります」は書かない。
//     基準を外れたときは「目安から外れています」程度に留める
//   ・独自の健康スコアを作らない
//   ・**減量前提のUIにしない。** この世帯は妻が少食で、体重を増やしたい方針。
//     BMI 21 を下回れば「増やす」が正解になる。
//     「目標体重まであと −◯kg」のような文言を出さないこと。
//     痩せすぎもがんのリスクである、というのがガイドラインの立場。
//
// 【数値は DB の health_targets が正】
// ここの既定値は supabase/19_health.sql の seed と同じ値である。
// 表があればそちらで上書きする(mergeTargets)。片方だけ直さないこと。
// ============================================================

import { addDays, todayISO } from "@/lib/dates";

export const MEMBERS = ["夫", "妻"] as const;
export type Member = (typeof MEMBERS)[number];

// ------------------------------------------------------------------ 表の形

export type HealthProfile = {
  id: number;
  household_id: string;
  member: Member;
  birth_date: string | null;
  sex: "男" | "女" | null;
  height_cm: number | null;
  smoking: "吸わない" | "過去に吸っていた" | "吸う" | null;
  piroli_status: "未検査" | "陰性" | "陽性" | "除菌済" | null;
  memo: string | null;
  updated_at: string;
};

export type Vitals = {
  id: number;
  household_id: string;
  date: string;
  member: Member;
  weight_kg: number | null;
  body_fat_pct: number | null;
  waist_cm: number | null;
  bp_systolic: number | null;
  bp_diastolic: number | null;
  memo: string | null;
};

export type SleepLog = {
  id: number;
  household_id: string;
  date: string;
  member: Member;
  bedtime: string | null;
  wake_time: string | null;
  /** 生成列。19_health.sql が計算する。手で書かない */
  hours: number | null;
  rest_feeling: number | null;
  memo: string | null;
};

export type ActivityLog = {
  id: number;
  household_id: string;
  date: string;
  member: Member;
  steps: number | null;
  active_minutes: number | null;
  exercise_minutes: number | null;
  strength_training: boolean;
  memo: string | null;
};

export type AlcoholLog = {
  id: number;
  household_id: string;
  date: string;
  member: Member;
  pure_alcohol_g: number;
  drinks_memo: string | null;
};

export type Screening = {
  id: number;
  household_id: string;
  member: Member;
  kind: string;
  last_done_on: string | null;
  next_due_on: string | null;
  result: string | null;
  memo: string | null;
};

export type Vaccination = {
  id: number;
  household_id: string;
  member: Member;
  kind: string;
  done_on: string | null;
  next_due_on: string | null;
  memo: string | null;
};

export type HealthTarget = {
  id: number;
  household_id: string;
  key: string;
  label: string;
  member: Member | "共通";
  min_value: number | null;
  max_value: number | null;
  unit: string | null;
  period: string | null;
  source: string;
};

// ------------------------------------------------------------ 目標値の既定

/** supabase/19_health.sql の seed と同じ値。片方だけ直さないこと。 */
export const DEFAULT_TARGETS: Record<
  string,
  { label: string; min: number | null; max: number | null; unit: string; source: string }
> = {
  bmi: { label: "BMI", min: 21, max: 25, unit: "", source: "国立がん研究センター「日本人のためのがん予防法」" },
  sleep: { label: "睡眠時間", min: 6, max: null, unit: "時間", source: "厚生労働省「健康づくりのための睡眠ガイド2023」" },
  rest: { label: "睡眠休養感", min: 4, max: null, unit: "段階", source: "厚生労働省「健康づくりのための睡眠ガイド2023」" },
  active: { label: "身体活動", min: 60, max: null, unit: "分", source: "厚生労働省「健康づくりのための身体活動・運動ガイド2023」" },
  mets: { label: "週の身体活動", min: 23, max: null, unit: "メッツ・時", source: "厚生労働省「健康づくりのための身体活動・運動ガイド2023」" },
  exercise: { label: "運動", min: 60, max: null, unit: "分", source: "厚生労働省「健康づくりのための身体活動・運動ガイド2023」" },
  strength: { label: "筋トレ", min: 2, max: 3, unit: "日", source: "厚生労働省「健康づくりのための身体活動・運動ガイド2023」" },
  steps: { label: "歩数", min: 8000, max: null, unit: "歩", source: "厚生労働省「健康日本21(第三次)」20〜64歳の目標" },
  veg: { label: "野菜", min: 350, max: null, unit: "g", source: "国立がん研究センター「日本人のためのがん予防法」" },
  fruit: { label: "果物", min: 200, max: null, unit: "g", source: "国立がん研究センター「日本人のためのがん予防法」" },
  alcohol: { label: "純アルコール", min: null, max: 23, unit: "g", source: "国立がん研究センター「日本人のためのがん予防法」" },
  // 食塩だけ男女で違う。男 7.5g / 女 6.5g 未満(1日)
  salt: { label: "食塩", min: null, max: 7.5, unit: "g", source: "国立がん研究センター「日本人のためのがん予防法」" },
};

/** 女性の食塩だけ既定が違う。sex が空のときは厳しいほう(6.5)に倒さず、男の値を使う。 */
export function saltMax(rows: HealthTarget[], member: Member, sex: "男" | "女" | null): number {
  const hit = rows.find((r) => r.key === "salt" && r.member === member);
  if (hit?.max_value != null) return Number(hit.max_value);
  return sex === "女" ? 6.5 : 7.5;
}

/** DB の health_targets を既定値に重ねる。表が無くても動く。 */
export function targetOf(
  rows: HealthTarget[],
  key: keyof typeof DEFAULT_TARGETS,
  member?: Member,
): { label: string; min: number | null; max: number | null; unit: string; source: string } {
  const base = DEFAULT_TARGETS[key];
  const hit =
    rows.find((r) => r.key === key && r.member === member) ??
    rows.find((r) => r.key === key && r.member === "共通");
  if (!hit) return base;
  return {
    label: hit.label || base.label,
    min: hit.min_value == null ? base.min : Number(hit.min_value),
    max: hit.max_value == null ? base.max : Number(hit.max_value),
    unit: hit.unit ?? base.unit,
    source: hit.source || base.source,
  };
}

// ---------------------------------------------------------------- 信号

/**
 * 1つの項目の状態。
 *
 * 【4つしかない】。緑・黄・赤に「まだ入れていない」を足しただけ。
 * 段階を増やすと独自スコアに近づく。それはやらないと決めている。
 */
export type Signal = "満たしている" | "あと少し" | "目安から外れている" | "記録がない";

export const SIGNAL_STYLE: Record<Signal, { dot: string; text: string }> = {
  満たしている: { dot: "bg-emerald-500", text: "text-emerald-700 dark:text-emerald-400" },
  あと少し: { dot: "bg-amber-500", text: "text-amber-700 dark:text-amber-400" },
  目安から外れている: { dot: "bg-rose-500", text: "text-rose-700 dark:text-rose-400" },
  記録がない: { dot: "bg-neutral-300 dark:bg-neutral-600", text: "text-neutral-400 dark:text-neutral-500" },
};

/** 「◯◯以上あればよい」もの。9割に届いていれば「あと少し」。 */
export function atLeast(value: number | null | undefined, min: number): Signal {
  if (value == null) return "記録がない";
  if (value >= min) return "満たしている";
  if (value >= min * 0.9) return "あと少し";
  return "目安から外れている";
}

/** 「◯◯未満に収めたい」もの。超えたら外れ、9割を超えたら「あと少し」。 */
export function atMost(value: number | null | undefined, max: number): Signal {
  if (value == null) return "記録がない";
  if (value > max) return "目安から外れている";
  if (value > max * 0.9) return "あと少し";
  return "満たしている";
}

// ---------------------------------------------------------------- 体格

export function bmi(weightKg: number | null, heightCm: number | null): number | null {
  if (!weightKg || !heightCm) return null;
  const m = heightCm / 100;
  return Math.round((weightKg / (m * m)) * 10) / 10;
}

/**
 * BMI が目標帯(21〜25)のどこにいるか。
 *
 * 【減量前提にしないための関数】。下回っているときは「増やす」と言う。
 * ここで「あと −◯kg」を返すと、この世帯にとっては逆向きの指示になる。
 * 痩せすぎもリスクである、というのがガイドラインの立場。
 */
export function bmiState(
  value: number | null,
  min: number,
  max: number,
): { signal: Signal; note: string } {
  if (value == null) return { signal: "記録がない", note: "体重か身長が入っていません" };
  if (value < min) return { signal: "目安から外れている", note: `目標帯(${min}〜${max})より低い。増やしたい` };
  if (value > max) return { signal: "目安から外れている", note: `目標帯(${min}〜${max})より高い` };
  return { signal: "満たしている", note: `目標帯(${min}〜${max})の中` };
}

/** BMI から体重に直す。グラフに目標帯を描くのに使う。 */
export function weightForBmi(bmiValue: number, heightCm: number): number {
  const m = heightCm / 100;
  return Math.round(bmiValue * m * m * 10) / 10;
}

// ---------------------------------------------------------------- 睡眠

/**
 * 眠っていた時間。就寝が前日の夜になるので、日をまたぐぶんを足す。
 * DB では生成列が同じ計算をしている(19_health.sql)。
 * ここは【保存する前の画面表示】のためにある。
 */
export function sleepHours(bedtime: string | null, wakeTime: string | null): number | null {
  if (!bedtime || !wakeTime) return null;
  const toMin = (t: string) => {
    const [h, m] = t.split(":").map(Number);
    return h * 60 + (m || 0);
  };
  let diff = toMin(wakeTime) - toMin(bedtime);
  if (diff < 0) diff += 24 * 60;
  return Math.round((diff / 60) * 100) / 100;
}

/** 6時間20分 の形。小数の「6.33時間」は寝床の話として読みにくい。 */
export function formatHours(hours: number | null): string {
  if (hours == null) return "—";
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return m === 0 ? `${h}時間` : `${h}時間${m}分`;
}

// ---------------------------------------------------------------- 飲酒

/** 純アルコール量(g) = 量(ml) × 度数(%) × 0.8 / 100 */
export function pureAlcoholG(ml: number, percent: number): number {
  return Math.round(((ml * percent * 0.8) / 100) * 10) / 10;
}

/** 1タップで入れるための献立。数値は上の式から出している。 */
export const DRINK_PRESETS = [
  { label: "ビール 500ml", ml: 500, percent: 5 },
  { label: "ビール 350ml", ml: 350, percent: 5 },
  { label: "日本酒 1合", ml: 180, percent: 15 },
  { label: "ワイン グラス", ml: 150, percent: 12 },
  { label: "焼酎 水割り", ml: 100, percent: 25 },
  { label: "缶チューハイ 350ml", ml: 350, percent: 7 },
].map((d) => ({ ...d, g: pureAlcoholG(d.ml, d.percent) }));

// ---------------------------------------------------------------- 年齢

export function ageOn(birthDate: string | null, onISO: string): number | null {
  if (!birthDate) return null;
  const [by, bm, bd] = birthDate.split("-").map(Number);
  const [y, m, d] = onISO.split("-").map(Number);
  let age = y - by;
  if (m < bm || (m === bm && d < bd)) age -= 1;
  return age;
}

/** 誕生日から n 年後の同じ日。2/29 は 3/1 に寄せる(Date の既定のまま)。 */
function addYears(iso: string, years: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y + years, m - 1, d);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`;
}

// ---------------------------------------------------------------- がん検診
//
// 出典: 国立がん研究センター がん情報サービス(依頼書の表そのまま)。
// **対象年齢に達する年に自動で「やること」が立つのが、この機能の一番の値打ち。**
// 食事の最適化より、大腸がん検診を毎年受けるほうが寿命への効果は大きい。

export type ScreeningPlan = {
  kind: string;
  /** この年齢から対象 */
  startAge: number;
  /** 何年に1回か */
  intervalYears: number;
  /** 女性だけの検診なら "女" */
  onlySex?: "女";
  note: string;
};

export const SCREENING_PLANS: ScreeningPlan[] = [
  { kind: "胃がん", startAge: 50, intervalYears: 2, note: "50歳以上・2年に1回" },
  { kind: "大腸がん", startAge: 40, intervalYears: 1, note: "40歳以上・1年に1回" },
  { kind: "肺がん", startAge: 40, intervalYears: 1, note: "40歳以上・1年に1回" },
  { kind: "乳がん", startAge: 40, intervalYears: 2, onlySex: "女", note: "40歳以上の女性・2年に1回" },
  {
    kind: "子宮頸がん",
    startAge: 20,
    intervalYears: 2,
    onlySex: "女",
    note: "20歳以上の女性・2年に1回(HPV検査単独法は5年に1回)",
  },
];

/**
 * 感染の枠(がん予防法の6番目)。
 *
 * 【期限を自動で出さない】。依頼書に間隔の出典が無いので、こちらで作らない。
 * 受けた日を残すだけにして、期限は人が決める。
 */
export const INFECTION_CHECKS = [
  { kind: "ピロリ菌検査", note: "陽性なら除菌。health_profile で1回で終わる管理" },
  { kind: "肝炎ウイルス検査", note: "B型・C型。受けた日を残す" },
];

/** 予防接種。年齢の目安があるものだけ書く(依頼書の記載どおり)。 */
export const VACCINE_PLANS: { kind: string; startAge: number | null; everyYear: boolean; note: string }[] = [
  { kind: "インフルエンザ", startAge: null, everyYear: true, note: "毎年" },
  { kind: "帯状疱疹", startAge: 50, everyYear: false, note: "50歳以降" },
  { kind: "肺炎球菌", startAge: 65, everyYear: false, note: "65歳以降" },
  { kind: "B型肝炎", startAge: null, everyYear: false, note: "感染の枠。受けた日を残す" },
  { kind: "HPV", startAge: null, everyYear: false, note: "キャッチアップ対象かは年齢による。受けた日を残す" },
];

export type DueState = "対象外" | "受ける時期" | "期限が過ぎている" | "もうすぐ" | "済んでいる";

export type ScreeningStatus = {
  plan: ScreeningPlan;
  /** 対象年齢に達しているか */
  eligible: boolean;
  /** 次に受ける日。対象年齢前なら「対象になる日」 */
  dueOn: string | null;
  state: DueState;
  daysLeft: number | null;
};

/** 期限が近いとみなす日数。予定を取るのに要る時間として1か月。 */
export const DUE_SOON_DAYS = 30;

export function screeningStatus(
  plan: ScreeningPlan,
  profile: HealthProfile | undefined,
  row: Screening | undefined,
  today = todayISO(),
): ScreeningStatus {
  const birth = profile?.birth_date ?? null;
  // 性別が空のときに女性向けの検診を「対象外」と言い切らない。
  // 分からないものは分からないままにして、人が決める(既存の share と同じ考え方)。
  if (plan.onlySex && profile?.sex && profile.sex !== plan.onlySex) {
    return { plan, eligible: false, dueOn: null, state: "対象外", daysLeft: null };
  }
  if (!birth) {
    return { plan, eligible: false, dueOn: null, state: "対象外", daysLeft: null };
  }

  const age = ageOn(birth, today) ?? 0;
  const eligible = age >= plan.startAge;

  // 受けたことがあれば「前回 + 間隔」。無ければ「対象年齢になる日」。
  const dueOn = row?.last_done_on
    ? addYears(row.last_done_on, plan.intervalYears)
    : addYears(birth, plan.startAge);

  const daysLeft = Math.round(
    (new Date(`${dueOn}T00:00:00`).getTime() - new Date(`${today}T00:00:00`).getTime()) / 86_400_000,
  );

  let state: DueState;
  if (!eligible && !row?.last_done_on) state = "対象外";
  else if (daysLeft < 0) state = row?.last_done_on ? "期限が過ぎている" : "受ける時期";
  else if (daysLeft <= DUE_SOON_DAYS) state = "もうすぐ";
  else state = "済んでいる";

  return { plan, eligible, dueOn, state, daysLeft };
}

export const DUE_STYLE: Record<DueState, string> = {
  期限が過ぎている: "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300",
  受ける時期: "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300",
  もうすぐ: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300",
  済んでいる: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  対象外: "bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400",
};

/** 受けた日を入れたら、次回はいつになるか。保存のときに next_due_on へ入れる。 */
export function nextDueAfter(plan: ScreeningPlan, doneOn: string): string {
  return addYears(doneOn, plan.intervalYears);
}

// ------------------------------------------------------------ 週のまとめ
//
// **日単位で一喜一憂させない。** ガイドラインの基準自体が週単位である。

export function weekStart(today = todayISO()): string {
  return addDays(today, -6); // 今日を含む直近7日。カレンダー週ではなく「この7日」
}

export function inLastWeek(date: string, today = todayISO()): boolean {
  return date <= today && date >= weekStart(today);
}

/**
 * 週のメッツ・時。
 *
 * 【3メッツで数える】。ガイドは「3メッツ以上の身体活動を週23メッツ・時」。
 * active_minutes は3メッツ以上の分数なので、時間に直して3を掛ける。
 * 運動(息が弾む程度)を別立てで重ねると二重に数える。内数として扱う。
 *
 * 【これは一番低い見積もりである】
 * 3 は「3メッツ以上」の下限。毎日60分やっても 7時間 x 3 = 21 にしかならず、
 * 週23に届かない。速歩き(約4)や掃除(約3.5)を実際の値で数えれば届くが、
 * 1件ずつメッツを入力させることになり、それは「入力させない」に反する。
 * **低く見積もったまま出して、何で数えたかを画面に書く**ほうを選んだ。
 * 数字を良く見せるために係数を上げないこと。
 */
export function metsHours(activeMinutes: number): number {
  return Math.round(((activeMinutes / 60) * 3) * 10) / 10;
}
