import type { CalendarTag } from "@/lib/types";

/**
 * 予定のタグの色。
 *
 * 【なぜ色名を DB に入れて、クラス名は入れないのか】
 * Tailwind はビルドのときにソースを読んでクラス名を集める。
 * `bg-${color}-500` のような組み立ては読み取れないので、CSS が出力されない。
 * DB に "bg-violet-500" という文字列を入れても画面には何も出ない。
 * そこで DB には 'violet' というキーだけを入れ、
 * キー → クラス名の対応はこの表に固定で書く。
 *
 * 【色だけで区別させない】
 * 月表示では帯の色に加えて必ずタグ名も出す。色覚に依存する作りにしない。
 */
export const TAG_COLORS = {
  violet: { bar: "bg-violet-500", chip: "bg-violet-100 text-violet-900 dark:bg-violet-950 dark:text-violet-200", dot: "#8b5cf6" },
  slate: { bar: "bg-slate-500", chip: "bg-slate-200 text-slate-900 dark:bg-slate-800 dark:text-slate-200", dot: "#64748b" },
  rose: { bar: "bg-rose-500", chip: "bg-rose-100 text-rose-900 dark:bg-rose-950 dark:text-rose-200", dot: "#f43f5e" },
  emerald: { bar: "bg-emerald-500", chip: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200", dot: "#10b981" },
  sky: { bar: "bg-sky-500", chip: "bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200", dot: "#0ea5e9" },
  amber: { bar: "bg-amber-500", chip: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200", dot: "#f59e0b" },
  teal: { bar: "bg-teal-500", chip: "bg-teal-100 text-teal-900 dark:bg-teal-950 dark:text-teal-200", dot: "#14b8a6" },
  fuchsia: { bar: "bg-fuchsia-500", chip: "bg-fuchsia-100 text-fuchsia-900 dark:bg-fuchsia-950 dark:text-fuchsia-200", dot: "#d946ef" },
} as const;

export type TagColor = keyof typeof TAG_COLORS;

export const TAG_COLOR_KEYS = Object.keys(TAG_COLORS) as TagColor[];

const FALLBACK = TAG_COLORS.violet;

/**
 * タグの見た目を返す。
 *
 * タグが取れないときは label(schema_v5 より前からある文字列)を手掛かりにする。
 * 移行前のデータや、タグを消したあとの予定でも色が消えないようにするため。
 */
export function tagStyle(tag: CalendarTag | undefined, label?: string | null) {
  if (tag) return TAG_COLORS[tag.color as TagColor] ?? FALLBACK;
  if (label) {
    const legacy: Record<string, TagColor> = {
      予定: "violet",
      仕事: "slate",
      病院: "rose",
      買い物: "emerald",
      おでかけ: "sky",
      記念日: "amber",
    };
    const key = legacy[label];
    if (key) return TAG_COLORS[key];
  }
  return FALLBACK;
}

/** 画面に出すタグ名。タグが消えていても label が残っていればそちらを使う。 */
export function tagName(tag: CalendarTag | undefined, label?: string | null): string {
  return tag?.name ?? label ?? "予定";
}
