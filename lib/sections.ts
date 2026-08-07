// 売り場順。スーパーを歩く順番に並べる(設計書 3-2)。
export const SECTION_ORDER = [
  "野菜",
  "肉・魚",
  "乳製品・卵・豆腐",
  "加工品・その他",
  "調味料",
  "冷凍",
  "要確認",
] as const;

/** セール枠は別扱い。残り件数に含めず、リストの最後に黄色で出す。 */
export const SALE_SECTION = "セール枠";

export const ALL_SECTIONS = [...SECTION_ORDER, SALE_SECTION] as const;

export type SectionName = (typeof ALL_SECTIONS)[number];

/** section が null / 未知の値だった場合の受け皿。 */
export const FALLBACK_SECTION = "要確認";

export function normalizeSection(section: string | null): SectionName {
  if (!section) return FALLBACK_SECTION;
  return (ALL_SECTIONS as readonly string[]).includes(section)
    ? (section as SectionName)
    : FALLBACK_SECTION;
}

export function sectionRank(section: string | null): number {
  const name = normalizeSection(section);
  if (name === SALE_SECTION) return 999;
  const i = (SECTION_ORDER as readonly string[]).indexOf(name);
  return i < 0 ? 998 : i;
}

/** 見出しの色分け。売り場を色で見分けられると、片手でスクロールしていても迷わない。 */
export const SECTION_STYLE: Record<
  SectionName,
  { icon: string; chip: string; bar: string }
> = {
  野菜: { icon: "🥬", chip: "bg-emerald-100 text-emerald-900", bar: "bg-emerald-500" },
  "肉・魚": { icon: "🥩", chip: "bg-rose-100 text-rose-900", bar: "bg-rose-500" },
  "乳製品・卵・豆腐": { icon: "🥛", chip: "bg-sky-100 text-sky-900", bar: "bg-sky-500" },
  "加工品・その他": { icon: "🥫", chip: "bg-slate-200 text-slate-900", bar: "bg-slate-500" },
  調味料: { icon: "🧂", chip: "bg-violet-100 text-violet-900", bar: "bg-violet-500" },
  冷凍: { icon: "🧊", chip: "bg-cyan-100 text-cyan-900", bar: "bg-cyan-500" },
  要確認: { icon: "❓", chip: "bg-neutral-200 text-neutral-800", bar: "bg-neutral-400" },
  セール枠: { icon: "🏷️", chip: "bg-amber-200 text-amber-950", bar: "bg-amber-500" },
};
