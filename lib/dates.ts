/** 端末のカレンダー上の「今日」。日付だけの比較に使う(YYYY-MM-DD)。 */
export function todayISO(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function currentMonth(): string {
  return todayISO().slice(0, 7);
}

/** 期限までの残り日数。過ぎていれば負の数。 */
export function daysUntil(iso: string): number {
  const target = new Date(`${iso}T00:00:00`);
  const today = new Date(`${todayISO()}T00:00:00`);
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

/** 8/9(土) の形。年は普段いらないので出さない。 */
export function formatDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getMonth() + 1}/${d.getDate()}(${WEEKDAYS[d.getDay()]})`;
}

export function relativeDay(iso: string): string | null {
  const diff = daysUntil(iso);
  if (diff === 0) return "今日";
  if (diff === 1) return "明日";
  if (diff === -1) return "昨日";
  return null;
}

export const yen = (n: number) => `¥${n.toLocaleString("ja-JP")}`;
