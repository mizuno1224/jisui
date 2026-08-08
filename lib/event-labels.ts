/**
 * 予定のラベル。
 *
 * 一覧はアプリ側に固定で持つ。2人で使ううちは分類が増えないので、
 * テーブルを足して管理画面を作るより、決め打ちのほうが早くて壊れない。
 *
 * 色だけで区別させない。月表示では帯の色に加えて必ず文字を出し、
 * 詳細ではラベル名そのものを表示する。
 */
export const EVENT_LABELS = [
  { key: "予定", bar: "bg-violet-500", chip: "bg-violet-100 text-violet-900", dot: "#8b5cf6" },
  { key: "仕事", bar: "bg-slate-500", chip: "bg-slate-200 text-slate-900", dot: "#64748b" },
  { key: "病院", bar: "bg-rose-500", chip: "bg-rose-100 text-rose-900", dot: "#f43f5e" },
  { key: "買い物", bar: "bg-emerald-500", chip: "bg-emerald-100 text-emerald-900", dot: "#10b981" },
  { key: "おでかけ", bar: "bg-sky-500", chip: "bg-sky-100 text-sky-900", dot: "#0ea5e9" },
  { key: "記念日", bar: "bg-amber-500", chip: "bg-amber-100 text-amber-900", dot: "#f59e0b" },
] as const;

export type EventLabel = (typeof EVENT_LABELS)[number]["key"];

export const DEFAULT_LABEL: EventLabel = "予定";

export function labelStyle(label: string | null) {
  return EVENT_LABELS.find((l) => l.key === label) ?? EVENT_LABELS[0];
}

// ------------------------------------------------------------ 繰り返し

export const REPEATS = ["なし", "毎週", "隔週", "毎月", "毎年"] as const;
export type Repeat = (typeof REPEATS)[number];

/**
 * 繰り返す予定が、ある日に当たるかどうか。
 *
 * 行はサーバに1本だけ持ち、表示のたびにここで広げる。
 * 実体を何十行も作らないので、消すときに1回で消えるし、
 * 直したときに過去ぶんだけ古いまま残ることもない。
 */
export function occursOn(
  event: { date: string; end_date: string | null; repeat?: string | null; repeat_until?: string | null },
  iso: string,
): boolean {
  const repeat = event.repeat ?? "なし";
  const start = event.date;
  const end = event.end_date ?? event.date;

  // 繰り返さない予定は、開始〜終了の範囲に入っているか見るだけ
  if (repeat === "なし") return start <= iso && iso <= end;

  if (iso < start) return false;
  if (event.repeat_until && iso > event.repeat_until) return false;

  const spanDays = daysBetween(start, end);
  // 複数日にまたがる繰り返しは、始まりの日から spanDays ぶんを当てる
  for (let offset = 0; offset <= spanDays; offset++) {
    const candidate = shift(iso, -offset);
    if (candidate < start) break;
    if (matchesCycle(repeat, start, candidate)) return true;
  }
  return false;
}

function matchesCycle(repeat: string, start: string, iso: string): boolean {
  const s = new Date(`${start}T00:00:00`);
  const d = new Date(`${iso}T00:00:00`);
  if (repeat === "毎週") return s.getDay() === d.getDay();
  if (repeat === "隔週") {
    if (s.getDay() !== d.getDay()) return false;
    const weeks = Math.round(daysBetween(start, iso) / 7);
    return weeks % 2 === 0;
  }
  /*
   * 31日や2/29のように、その月に無い日がある。
   * 素直に日付を比べると2月や30日までの月で丸ごと落ちるので、
   * その月の最終日に寄せる(月末の支払いは月末に出したい)。
   */
  if (repeat === "毎月") {
    const last = lastDayOfMonth(d.getFullYear(), d.getMonth());
    return d.getDate() === Math.min(s.getDate(), last);
  }
  if (repeat === "毎年") {
    if (s.getMonth() !== d.getMonth()) return false;
    const last = lastDayOfMonth(d.getFullYear(), d.getMonth());
    return d.getDate() === Math.min(s.getDate(), last);
  }
  return false;
}

function lastDayOfMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

function daysBetween(a: string, b: string): number {
  const x = new Date(`${a}T00:00:00`).getTime();
  const y = new Date(`${b}T00:00:00`).getTime();
  return Math.round((y - x) / 86_400_000);
}

function shift(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
