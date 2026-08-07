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

/** 負の数は ¥-100 ではなく -¥100 と書く(記号の前に符号が来るのが自然)。 */
export const yen = (n: number) =>
  n < 0 ? `-¥${Math.abs(n).toLocaleString("ja-JP")}` : `¥${n.toLocaleString("ja-JP")}`;

// ------------------------------------------------------------ 週の計算

const pad = (n: number) => String(n).padStart(2, "0");
const toISO = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  return toISO(d);
}

export function addMonths(yearMonth: string, months: number): string {
  const [y, m] = yearMonth.split("-").map(Number);
  const d = new Date(y, m - 1 + months, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

/** その日を含む週の日曜日。日本のカレンダーに合わせて日曜始まりにする。 */
export function startOfWeek(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  return addDays(iso, -d.getDay());
}

export function weekDates(startIso: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(startIso, i));
}

export function weekdayOf(iso: string): number {
  return new Date(`${iso}T00:00:00`).getDay();
}

export const WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"];

/** 8/3〜8/9 の形。週の見出しに使う。 */
export function weekRangeLabel(startIso: string): string {
  const end = addDays(startIso, 6);
  const [, sm, sd] = startIso.split("-");
  const [, em, ed] = end.split("-");
  return `${Number(sm)}/${Number(sd)} 〜 ${Number(em)}/${Number(ed)}`;
}

export function monthLabel(yearMonth: string): string {
  const [y, m] = yearMonth.split("-");
  return `${y}年${Number(m)}月`;
}
