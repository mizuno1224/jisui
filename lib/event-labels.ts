/*
 * 【ラベルの一覧はここから消えた】
 *
 * 予定の色分けは calendar_tags テーブル(schema_v5.sql)に移した。
 * 「非公開かどうか」を人ごとに持たせる必要が出たため、
 * アプリに固定で書いておく方式では足りなくなった。
 *
 * 色の対応表は lib/tags.ts。表示は tagStyle() / tagName() を使う。
 * このファイルに残っているのは、繰り返しの展開だけ。
 */

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
