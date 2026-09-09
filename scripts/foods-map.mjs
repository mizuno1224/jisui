/*
 * 食材マスタと、いま入っている名前の突き合わせ。
 *
 * 【当たらない名前を残さないための下見】。マスタに無い名前は
 * food_id が null のまま残り、アプリに「食材を選んでください」と出る。
 * それ自体は正しい動きだが、移行の時点で大量に残ると片付けが大仕事になる。
 * まずここで全部見る。
 */
import { FOODS } from "./foods-master.mjs";

/** 突き合わせ用に名前をならす。lib/matching.ts の normalizeText と同じ規則。 */
export function key(s) {
  return (s ?? "")
    .replace(/[(（][^)）]*[)）]/g, "")
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
    .replace(/[\s・,、の]/g, "")
    .toLowerCase()
    .trim();
}

/** 代表名と別名から引く表を作る。**長い名前を先に見る**(「鮭」より「塩銀鮭」) */
export function buildIndex() {
  const rows = [];
  for (const [name, , , , , aliases] of FOODS) {
    for (const n of [name, ...aliases]) rows.push([key(n), name]);
  }
  rows.sort((a, b) => b[0].length - a[0].length);
  return rows;
}

/**
 * 名前から食材を決める。
 *  1. ならした名前がぴったり一致
 *  2. 商品名の中に別名が含まれる(「明治ブルガリアヨーグルト」→ ヨーグルト)
 * 【2文字未満の別名では部分一致させない】。「塩」が「塩銀鮭」に当たってしまう。
 */
export function classify(raw, index) {
  const k = key(raw);
  if (!k) return null;
  for (const [alias, name] of index) if (alias === k) return name;
  for (const [alias, name] of index) if (alias.length >= 2 && k.includes(alias)) return name;
  return null;
}
