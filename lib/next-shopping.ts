// 次の買い物の候補。
//
// 【何を出すか】
// これからの献立(meal_plan の「予定」)の材料のうち、家に無いもの。
// 在庫にも常備品にも無く、買い物リストにも載っていないものだけを候補にする。
//
// 【なぜ「仮」なのか】
// ここで出すのは買い物リストではない。押して初めてリストに入る。
// 献立は変わるし、在庫も動く。勝手にリストへ入れると、
// 変わったあとに「なぜこれが載っているのか」が分からない行が残る。
// 計算で出しているので、献立を直せば候補も自動で変わる。
//
// 【判定は書き写さない】
// 「家にあるか」は lib/recipe-facets.ts の availabilityOf をそのまま使う。
// 同じ判定を2か所に書くと、レシピ画面が「足りない」と言い、
// こちらは「ある」と言う状態が必ず起きる。
import { addDays } from "./dates";
import { looseMatch, guessSection } from "./matching";
import { availabilityOf, type PantryRow, type StockRow } from "./recipe-facets";
import type { MealPlan, RecipeIngredient, ShoppingItem } from "./types";

/**
 * 何日先の献立まで見るか。
 *
 * 買い物は週に1〜2回。2週間先まで見ると、まだ決まっていない献立の材料まで
 * 並んで候補が濁る。1週間ぶんだけを見る。
 */
export const HORIZON_DAYS = 7;

/**
 * 候補にしないもの。
 *
 * 米は実家から貰うので**絶対に買い物リストへ載せない**(設計書5・SKILL.md)。
 * 常備品として登録されていれば availabilityOf が弾くが、登録漏れでも
 * 載らないようにここでも止める。ゆるい一致だと「米酢」「米粉」まで
 * 巻き込むので、**名前がぴったり同じときだけ**外す。
 */
const NEVER = ["米", "お米", "白米", "無洗米"];

export type Candidate = {
  /** 材料名。買い物リストにはこの名前で入る */
  name: string;
  /** 売り場。並べ替えと、足すときの section に使う */
  section: string;
  /** いつの何に要るか。「9/8 肉じゃが」 */
  reason: string;
  /** 一番早く要る日。近い順に並べるため */
  date: string;
};

export function nextCandidates(input: {
  /** 献立。status が「予定」のものだけを見る */
  plans: MealPlan[];
  ingredients: RecipeIngredient[];
  inventory: StockRow[];
  pantry: PantryRow[];
  /** いま買い物リストにあるもの。買う予定のものを二重に出さない */
  shopping: Pick<ShoppingItem, "item">[];
  today: string;
  days?: number;
}): Candidate[] {
  const { plans, ingredients, inventory, pantry, shopping, today } = input;
  const until = addDays(today, input.days ?? HORIZON_DAYS);

  const upcoming = plans
    .filter((p) => p.status === "予定" && p.recipe_id != null)
    .filter((p) => p.date >= today && p.date <= until)
    .sort((a, b) => a.date.localeCompare(b.date));

  const byRecipe = new Map<number, RecipeIngredient[]>();
  for (const ing of ingredients) {
    const list = byRecipe.get(ing.recipe_id);
    if (list) list.push(ing);
    else byRecipe.set(ing.recipe_id, [ing]);
  }

  /** 同じ材料が何日ぶんも出てくるので、一番早い日にまとめる */
  const found = new Map<string, Candidate>();

  for (const plan of upcoming) {
    for (const ing of byRecipe.get(plan.recipe_id!) ?? []) {
      if (availabilityOf(ing, inventory, pantry) !== "足りない") continue;
      if (NEVER.some((n) => n === ing.name.trim())) continue;
      // すでに買い物リストにある(未購入でも購入済でも)なら出さない。
      // 購入済は「買ったがまだ在庫へ流し込んでいない」なので、家にはある。
      if (shopping.some((s) => looseMatch(s.item, ing.name))) continue;

      // 献立名が空の行もある(レシピだけ決めて題を付けていない)。
      // 「9/8 の献立用」と出しておけば、どの日のぶんかは分かる。
      const planName = plan.name?.trim() || "献立";
      const day = plan.date.slice(5).replace("-", "/");

      const already = found.get(ing.name);
      if (already) {
        // 2つ目までは献立名を並べる。3つ目からは「ほか」。
        // 理由が長いと、店で行が2段になって読みにくい。
        if (!already.reason.includes(planName) && !already.reason.endsWith("ほか")) {
          already.reason = already.reason.includes("・")
            ? `${already.reason} ほか`
            : `${already.reason}・${planName}`;
        }
        continue;
      }
      found.set(ing.name, {
        name: ing.name,
        section: guessSection(ing.name),
        reason: `${day} ${planName}`,
        date: plan.date,
      });
    }
  }

  return [...found.values()].sort(
    (a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name),
  );
}
