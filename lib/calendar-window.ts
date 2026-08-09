import { addDays, addMonths, monthOf, startOfWeek } from "@/lib/dates";

/**
 * 縦スクロールカレンダーの座標計算。
 *
 * 【なぜ「月」ではなく「週」を並べるのか】
 * 月の枠(6週42マス)を縦に積むと、8月の枠の末尾に 8/30・8/31・9/1 が出て、
 * 続く9月の枠の先頭にも 8/30・8/31・9/1 がもう一度出る。
 * 指で送ると同じ週を2回通ることになり、「月が滑らかに切り替わる」感じが壊れる。
 * 描く単位を1週にすれば、週は一度きりしか出てこない。
 *
 * 【なぜ本当の無限スクロールにしないのか】
 * 上に足すと、その瞬間スクロール位置がずれる。ずれを scrollTop で補正できるが、
 * iPhone では指を離して滑っている最中に scrollTop を書き換えると
 * 慣性が途切れて画面がガクッと止まる。上端に着くのはたいてい勢いよく
 * 送ったときなので、一番起きてほしくない場面で必ず起きる。
 *
 * そこで前後5年ぶんを最初から全部数え上げてしまう。
 * 全部の週の高さが同じなので「何番目の週か × 1週の高さ」がそのまま座標になり、
 * 途中で足すことが一度も無くなる。10年より先へは年月を選んで飛ぶ。
 */

/** 1週の高さ(px)。中身の行数から決めている。WeekRow のコメントを読むこと。 */
export const ROW_H = 88;

/** 今日から前後に何ヶ月ぶん並べるか。60 = 前後5年。 */
const RANGE_MONTHS = 60;

/** 画面の外に、上下それぞれ何週ぶん先回りして描くか。 */
export const BUFFER_ROWS = 8;

/** 日曜始まりの週の開始日を、前後5年ぶん並べた配列。 */
export function buildWeekStarts(today: string): string[] {
  const from = startOfWeek(`${addMonths(monthOf(today), -RANGE_MONTHS)}-01`);
  const last = startOfWeek(`${addMonths(monthOf(today), RANGE_MONTHS)}-01`);
  const to = addDays(last, 41);
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 7)) out.push(d);
  return out;
}

/** 日付の差(日数)。 */
function daysBetween(a: string, b: string): number {
  const x = new Date(`${a}T00:00:00`).getTime();
  const y = new Date(`${b}T00:00:00`).getTime();
  return Math.round((y - x) / 86_400_000);
}

/**
 * ある日付が、配列の何番目の週に入るか。
 * 週は必ず7日間隔なので、探し回らずに割り算1回で出る。
 */
export function weekIndexOf(originWeekStart: string, iso: string): number {
  return Math.round(daysBetween(originWeekStart, startOfWeek(iso)) / 7);
}

/** その週に含まれる7日ぶんの日付。 */
export function daysOfWeek(weekStart: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
}

/**
 * その週を「何月の週」と見なすか。
 *
 * 週は月をまたぐので、見出しに出す月を1つに決める必要がある。
 * 週の真ん中(水曜)が属する月を採る。こうすると、画面の上端に来た週の
 * 過半数が属する月が見出しになり、体感とずれない。
 */
export function monthOfWeek(weekStart: string): string {
  return monthOf(addDays(weekStart, 3));
}
