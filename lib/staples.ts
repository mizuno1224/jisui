// 常備品を切らしていないかを見る。
//
// 【なぜアプリ側にも要るのか】
// この判定は scripts/restock-staples.mjs に前からある。ただしあれは
// パソコンで watch-inbox.mjs が5分ごとに python 越しに回す作りで、
// **パソコンが寝ていると一切動かない。**
// 醤油を切らしたのが土曜の夜で、パソコンが月曜まで起きないなら、
// 日曜の買い物には間に合わない。気づく道が無いのと同じになる。
//
// 買い物リストはスマホで開くものなので、判定はスマホ側にも要る。
// 規則をあちらと揃えるため、判定の中身は下に1つだけ書いて、
// 画面はここから引く。片方だけ直すと、パソコンとスマホで
// 「切れている」の答えが食い違う。
//
// 【勝手に足さない】
// 出すのは「切らしています」という札までで、買い物リストに載せるのは
// 人が押したときだけにする。毎回自動で戻す作りにすると、
// 「今週は要らない」と消したものが次の同期で戻ってきて、
// リストが自分のものでなくなる(restock-staples.mjs の頭にある戒め)。

import * as local from "@/lib/local-db";
import { guessSection, looseMatch } from "@/lib/matching";
import type { InventoryItem, Pantry, ShoppingItem } from "@/lib/types";

/** 切らしている常備品1件。why は人に見せる理由なので、そのまま文になる言葉にする。 */
export type ShortStaple = {
  /** pantry.id。画面の key と、覚えておく印に使う */
  id: number;
  name: string;
  /** 「切れた」「切れそう」「在庫に無い」「在庫が0」 */
  why: string;
  /** 足すときの売り場。名前から推測する(lib/matching.ts) */
  section: string;
};

/**
 * その常備品を切らしているか。切らしていなければ null。
 *
 * 【2つの合図を見る】
 *   1. pantry.stock が「切れた」「切れそう」
 *      … 醤油や片栗粉のような、在庫として数えていないもの向け。
 *        チャットで「醤油が切れた」と言えばここが立つ。
 *   2. staple = true のものが、在庫で 0 になった(または在庫に見当たらない)
 *      … 牛乳・たまご・納豆のような「冷蔵庫に常に入れておきたいもの」向け。
 *
 * 【人の申告を在庫の数より優先する】。人が「切れた」と言ったなら、
 * 在庫表に古い行が残っていてもそちらは信じない。
 *
 * 【★の付いていないものは在庫で判断しない】。醤油は在庫表に無いのが普通で、
 * 「在庫に無い＝切らした」にすると常備品のほとんどが毎回並ぶ。
 */
export function outOfStockReason(
  p: Pick<Pantry, "name" | "stock" | "staple">,
  inventory: Pick<InventoryItem, "name" | "qty">[],
): string | null {
  if (p.stock === "切れた" || p.stock === "切れそう") return p.stock;
  if (!p.staple) return null;
  const hits = inventory.filter((i) => looseMatch(p.name, i.name ?? ""));
  if (hits.length === 0) return "在庫に無い";
  if (hits.every((i) => Number(i.qty ?? 0) <= 0)) return "在庫が0";
  return null;
}

/**
 * 切らしていて、**まだ買い物リストに載っていない**常備品。
 *
 * 【載っているかは「未購入の行」だけで見る】
 * チェックの付いた行(購入済)は買い終えたものなので、
 * 「まだリストにある」と数えてはいけない。ここを取り違えると、
 * 一度買った常備品は以降どれだけ切らしても二度と出てこなくなる。
 * scripts/restock-staples.mjs で実際にそうなっていた
 * (存在しない値「購入済み」と比べていたので、条件が常に真だった)。
 */
export function shortStaples(
  pantry: Pantry[],
  inventory: Pick<InventoryItem, "name" | "qty">[],
  shopping: Pick<ShoppingItem, "item" | "status">[],
): ShortStaple[] {
  const onList = shopping.filter((s) => s.status === "未購入");
  const out: ShortStaple[] = [];
  for (const p of pantry) {
    const why = outOfStockReason(p, inventory);
    if (!why) continue;
    if (onList.some((s) => looseMatch(s.item ?? "", p.name))) continue;
    out.push({ id: p.id, name: p.name, why, section: guessSection(p.name) });
  }
  return out;
}

/** 買い物リストに足すときの理由欄。あとから見て、なぜ載ったのか分かるように。 */
export function restockReason(s: ShortStaple): string {
  return `常備品を切らしています(${s.why})`;
}

// ------------------------------------------------------ 「あとで」の控え

const DISMISS_KEY = "staples_dismissed";

/**
 * 「今週は要らない」と閉じた常備品を覚えておく。
 *
 * 【この端末の中だけに置く】
 * データベースに列を足せば2人で共有できるが、これは記録ではなく
 * 「札を出すかどうか」の好みでしかない。買い物に行くほうの端末で
 * 閉じたら、そちらで黙るだけでよい。表を増やすほどの話ではない。
 *
 * 【切らしている間だけ覚える】
 * 買って「ある」に戻り、また切らしたときには**もう一度出したい。**
 * そこで、いま切らしているものだけを覚え直す(pruneDismissed)。
 * 一度閉じたら二度と出ない作りにすると、
 * 「気づく道が無い」という元の問題に戻る。
 */
export async function loadDismissed(): Promise<number[]> {
  return (await local.getMeta<number[]>(DISMISS_KEY)) ?? [];
}

/** いま切らしているものを、まとめて「あとで」にする。 */
export async function dismissAll(short: ShortStaple[]): Promise<number[]> {
  const next = [...new Set([...(await loadDismissed()), ...short.map((s) => s.id)])];
  await local.setMeta(DISMISS_KEY, next);
  return next;
}

/**
 * 覚えている中から、もう切らしていないものを落とす。
 * これをしないと「一度閉じたら二度と出ない」になる。
 */
export async function pruneDismissed(short: ShortStaple[]): Promise<number[]> {
  const cur = await loadDismissed();
  const stillShort = new Set(short.map((s) => s.id));
  const next = cur.filter((id) => stillShort.has(id));
  if (next.length !== cur.length) await local.setMeta(DISMISS_KEY, next);
  return next;
}
