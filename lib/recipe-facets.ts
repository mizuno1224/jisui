// レシピを「どう絞り込むか」をまとめた場所。
//
// レシピが 27 品になり、名前の一覧を上から読む探し方が成立しなくなった。
// 台所で本当にやりたいのは次の3つで、どれも一覧を眺めても分からない。
//
//   1. いま家にある材料だけで作れるものを出す(買い物に行かずに済む)
//   2. 時間で選ぶ(帰りが遅い日は10分以内しか作れない)
//   3. 器具で選ぶ(電気圧力鍋に入れて放っておきたい / 火を使いたくない)
//
// 3 は「器具が5台あるのにレシピが偏っていないか」を見るためでもある。
// 判定は RecipeListScreen と RecipeDetailScreen の両方から使うので、
// 画面ではなくここに置く。片方だけ直すと、一覧の印と中の表示が食い違う。

import { looseMatch } from "@/lib/matching";
import type { Recipe, RecipeIngredient } from "@/lib/types";

// ------------------------------------------------------------------ 器具

/**
 * レシピカードの「使う器具」の行。
 *
 * カード本文(card_md)は必ず次の形で始まる(supabase/17_fix_recipe_cards.sql)。
 *
 *     ## 基本情報
 *     - 2人分 / 調理時間 約15分
 *     - 使う器具: 電子レンジ、片手鍋、ガスコンロ
 *
 * 器具の列を DB に持たせるほうが本筋だが、それには 27 品ぶんの入力が要る。
 * 本文にはもう書いてあるので、まずはそこから読む。
 * あとで recipes に列を足すときは、ここを列優先に切り替えるだけでよい。
 */
const EQUIPMENT_LINE = /^\s*[-*]?\s*使う器具\s*[:：]\s*(.+)$/m;

/** 器具の判定に使う文字列。カードの「使う器具」の行 + tags 列。 */
function equipmentText(recipe: Recipe): string {
  const hit = recipe.card_md?.match(EQUIPMENT_LINE);
  return `${hit?.[1] ?? ""} ${recipe.tags ?? ""}`.trim();
}

/**
 * 器具の呼び名は1つに定まらない。
 * カードには商品名(「タイガー クックポット COK-B400」)で書いてあることも、
 * 一般名(「電気圧力鍋」)で書いてあることもある。両方を拾う。
 */
export const EQUIPMENT_FILTERS: { label: string; match: RegExp }[] = [
  { label: "電気圧力鍋", match: /電気圧力鍋|クックポット|COK-?B400/i },
  { label: "エアオーブン", match: /エアー?オーブン|RAO-?1|ノンフライ/i },
  { label: "トースター", match: /トースター|アラジン|CAT-?GS13C/i },
  { label: "電子レンジ", match: /電子レンジ|レンジ/ },
  { label: "炊飯器", match: /炊飯器/ },
];

/**
 * 火を使うかどうか。
 *
 * 「火を使わない」とはっきり書いてあればそれを採る。書いていないときは
 * コンロ・フライパン・鍋が出てこないことをもって「使わない」とみなす。
 * 【器具の行そのものが無いレシピは判定しない】。空文字に対しては
 * 「何も出てこない」が真になってしまい、全部が火を使わないことになる。
 */
const FIRE = /コンロ|フライパン|鍋|グリル(?!パン)|魚焼き/;
const NO_FIRE_DECLARED = /火を使わない|火は使わない/;

export function equipmentTagsOf(recipe: Recipe): string[] {
  const text = equipmentText(recipe);
  if (!text) return [];
  const tags = EQUIPMENT_FILTERS.filter((f) => f.match.test(text)).map((f) => f.label);
  if (NO_FIRE_DECLARED.test(text) || !FIRE.test(text)) tags.push("火を使わない");
  return tags;
}

/** 器具の絞り込みに出す札。並び順は EQUIPMENT_FILTERS のまま、最後が「火を使わない」。 */
export const EQUIPMENT_LABELS = [...EQUIPMENT_FILTERS.map((f) => f.label), "火を使わない"];

// -------------------------------------------------------------- 材料と在庫

/** 任意の材料は、無くても料理は成立するので「足りない」とは言わない。 */
export type Availability = "在庫あり" | "常備品" | "足りない" | "任意";

export type StockRow = { name: string; qty: number | null };
export type PantryRow = { name: string; stock: string };

/**
 * 材料1つが家にあるか。
 *
 * 【qty が null は「ある」に倒す】。数を数えていないもの(調味料の小袋など)で、
 * 0 とは違う。ここを 0 扱いにすると、あるものが買い物リストに並ぶ。
 * 逆に 0 の行は「使い切った」なので、必ず足りない側に落とす。
 *
 * 常備品(調味料など)は買い物リストに載せない決まりなので別扱いにする(設計書5)。
 */
export function availabilityOf(
  ing: Pick<RecipeIngredient, "name" | "optional">,
  inventory: StockRow[],
  pantry: PantryRow[],
): Availability {
  if (inventory.some((inv) => (inv.qty ?? 1) > 0 && looseMatch(inv.name, ing.name))) {
    return "在庫あり";
  }
  if (pantry.some((p) => p.stock !== "切れた" && looseMatch(p.name, ing.name))) {
    return "常備品";
  }
  return ing.optional ? "任意" : "足りない";
}

/**
 * レシピごとの「材料が何点あって、そのうち何点足りないか」。
 * `missing === 0` かつ `total > 0` なら【いま作れる】。
 *
 * 【材料が1行も登録されていないレシピを「作れる」と言わない】ために total も返す。
 * 足りない数だけを返すと、材料表が空のレシピが 0 件不足になり、
 * 一番あてにならないものが一番上に「いま作れる」と出る。
 *
 * 【一覧の全レシピぶんを一度に出す】。1行ずつ呼ぶ形にすると、
 * 在庫を1つ増やすたびに 27 品 x 材料 x 在庫 を描画のたびに舐めることになる。
 * InventoryScreen で同じ作りをして、冷蔵庫の前で連打が効かなくなった前例がある。
 */
export function missingByRecipe(
  ingredients: RecipeIngredient[],
  inventory: StockRow[],
  pantry: PantryRow[],
): Map<number, { missing: number; total: number }> {
  const out = new Map<number, { missing: number; total: number }>();
  for (const ing of ingredients) {
    const acc = out.get(ing.recipe_id) ?? { missing: 0, total: 0 };
    acc.total += 1;
    if (availabilityOf(ing, inventory, pantry) === "足りない") acc.missing += 1;
    out.set(ing.recipe_id, acc);
  }
  return out;
}
