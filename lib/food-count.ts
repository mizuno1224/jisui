import type { RecipeIngredient } from "@/lib/types";

/**
 * その食材を「個数で管理する意味があるか」を、レシピの書き方から決める。
 *
 * 【なぜ食材ごとに変えるのか】
 * 全部に個数を聞くと、聞く意味の無いものまで毎回入力させることになる。
 * 実データを見ると、はっきり3つに分かれていた。
 *
 *   なす「3本」・ピーマン「4個」・たまご「10個」
 *      → **数える意味がある。** 残り2本なら、あと1本足りないと分かる
 *   小松菜「1袋」・しめじ「1袋」
 *      → **1袋まるごと使う。** 「小松菜が3枚」と数えても献立に効かない
 *   豚こま「200g」・冷凍ほうれん草「200g」
 *      → 重さ。個数の出番がない
 *
 * 【レシピの単位から決める。表を手で持たない】
 * 「この食材は数える」という一覧を別に作ると、レシピが増えたときに
 * 必ず古くなる。レシピが「本」で指定しているなら数える意味があり、
 * 「袋」で指定しているなら無い。**答えはレシピ自身が持っている。**
 */

/**
 * 中身を数える単位。レシピがこれで指定していれば、個数で管理する。
 * 「パック」は納豆(3個入り)のように中身が複数あるので、ここに入れる。
 */
const COUNTED = ["本", "個", "枚", "玉", "丁", "切れ", "尾", "房", "缶", "パック", "株", "片"];

/**
 * 「まるごと1つ」を指す単位。数えても献立に効かない。
 * 小松菜1袋は、葉が何枚あるかではなく「1袋あるか」で足りる。
 */
const WHOLE = ["袋", "束", "杯分", "つかみ"];

/**
 * 食材ごとの「数えるなら、この単位で」を返す。
 * 入っていない食材は、数えない(袋・重さで管理する)。
 *
 * 同じ食材が複数の単位で書かれていることがある(人参は「1本」と「450g」の両方)。
 * **1つでも数える単位があれば、数える側に倒す。**
 * 冷蔵庫を開けて「人参が2本ある」と分かるほうが、献立を組むときに役に立つ。
 */
export function countUnits(ingredients: RecipeIngredient[]): Map<number, string> {
  const out = new Map<number, string>();
  const tally = new Map<number, Map<string, number>>();
  for (const i of ingredients) {
    if (i.food_id == null || !i.unit) continue;
    if (!COUNTED.includes(i.unit)) continue;
    const m = tally.get(i.food_id) ?? new Map<string, number>();
    m.set(i.unit, (m.get(i.unit) ?? 0) + 1);
    tally.set(i.food_id, m);
  }
  // いちばん多く使われている単位を採る(「本」と「個」が混ざったら多いほう)
  for (const [foodId, m] of tally) {
    const best = [...m.entries()].sort((a, b) => b[1] - a[1])[0];
    if (best) out.set(foodId, best[0]);
  }
  return out;
}

/** 「袋まるごと」で書かれているか。個数を聞かない側に倒す手がかり。 */
export function isWholeUnit(unit: string | null): boolean {
  return unit != null && WHOLE.includes(unit);
}
