// 在庫の名前とレシピ材料の名前を突き合わせるための、ゆるい一致判定。
//
// 在庫は「キャベツ(カット)」、材料は「キャベツ」のように書き方が揃っていない。
// 厳密に一致させようとすると何も当たらないので、括弧や空白を落として
// どちらかがどちらかを含んでいれば同じものとみなす。
// 台所での判断材料として出すだけなので、外れても害は小さい。

/**
 * 表記ゆれを吸収する。「たまねぎ」と「玉ねぎ」、「ポンズ」と「ポン酢」が
 * 別物になると、在庫からレシピを引くという一番やりたい操作が動かない。
 * 同じ文字列に何度も正規表現を掛けないよう覚えておく(在庫の +/- で
 * 毎回全材料を舐めるため、ここが効く)。
 */
const cache = new Map<string, string>();

export function normalizeText(input: string): string {
  const hit = cache.get(input);
  if (hit !== undefined) return hit;
  const out = input
    .replace(/[(（][^)）]*[)）]/g, "") // 括弧書きを落とす: キャベツ(カット) → キャベツ
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60)) // カタカナ→ひらがな
    .replace(/[\s・,、]/g, "")
    .toLowerCase()
    .trim();
  cache.set(input, out);
  return out;
}

/**
 * 漢字とかなの対応。
 *
 * 正規化だけでは「玉ねぎ」と「たまねぎ」が別物のままになる。
 * 読みを機械的に出すには辞書が要るので、よく使うものだけ手で並べる。
 * 網羅する必要はない。当たらなければ別の行として足されるだけで、害は小さい。
 */
const SYNONYMS: string[][] = [
  ["玉ねぎ", "たまねぎ", "玉葱", "オニオン"],
  ["人参", "にんじん"],
  ["大根", "だいこん"],
  ["茄子", "なす", "ナスビ"],
  ["胡瓜", "きゅうり"],
  ["白菜", "はくさい"],
  ["法蓮草", "ほうれん草", "ほうれんそう"],
  ["じゃがいも", "ジャガイモ", "馬鈴薯", "じゃが芋"],
  ["さつまいも", "薩摩芋", "さつま芋"],
  ["長ねぎ", "長葱", "ながねぎ", "白ねぎ"],
  ["にんにく", "大蒜", "ガーリック"],
  ["生姜", "しょうが", "ショウガ"],
  ["卵", "たまご", "玉子"],
  ["豚肉", "ぶたにく"],
  ["鶏肉", "とりにく", "鳥肉"],
  ["牛肉", "ぎゅうにく"],
  ["醤油", "しょうゆ", "しょう油"],
  ["味噌", "みそ"],
  ["砂糖", "さとう"],
  ["酢", "お酢"],
  ["油", "あぶら"],
  ["椎茸", "しいたけ"],
  ["舞茸", "まいたけ"],
  ["豆腐", "とうふ"],
  ["牛乳", "ミルク"],
];

/** 別表記 → 代表表記。突き合わせの前に片側へ寄せる。 */
const canonicalMap = (() => {
  const map = new Map<string, string>();
  for (const group of SYNONYMS) {
    const head = normalizeText(group[0]);
    for (const variant of group) map.set(normalizeText(variant), head);
  }
  return map;
})();

/*
 * 寄せた結果も覚えておく。
 *
 * 下の for は当たらなかったとき【毎回 25 組を舐める】。1件ずつなら誤差だが、
 * レシピ一覧の「いま作れる」は 27 品 x 材料 x 在庫 の総当たりで呼ぶので、
 * 同じ「玉ねぎ」を何百回も引き直すことになる。答えは入力だけで決まるので、
 * normalizeText と同じように覚えておけば済む。
 */
const canonicalCache = new Map<string, string>();

function canonical(input: string): string {
  const hit = canonicalCache.get(input);
  if (hit !== undefined) return hit;
  const base = normalizeText(input);
  const exact = canonicalMap.get(base);
  let out = base;
  if (exact) {
    out = exact;
  } else {
    // 「玉ねぎ 1個」のように余分が付いていても寄せる
    for (const [variant, head] of canonicalMap) {
      if (variant.length >= 2 && base.includes(variant)) {
        out = base.replace(variant, head);
        break;
      }
    }
  }
  canonicalCache.set(input, out);
  return out;
}

const normalize = canonical;

/**
 * 材料名から売り場を推測する。当たらなければ「要確認」に落とす。
 * 買い物リストに足すときの初期値でしかないので、外れても手で直せばよい。
 */
const SECTION_HINTS: [RegExp, string][] = [
  // 【乳製品を肉・魚より先に見る】上から順に当てるので、逆にすると
  // 「牛乳」が 肉・魚 の /牛/ に、「鶏卵」が /鶏/ に当たってしまう。
  // 売り場を1つ間違えるだけなら店内を余分に歩くだけで済むが、
  // components/MoveToInventorySheet.tsx はこの売り場から冷蔵庫の区画を決めていて、
  // 肉・魚 は氷温ルーム(約-2〜0℃)に落ちる。牛乳と豆腐は氷温に入れてはいけない
  // (凍ってスが入る。取説 p.24)。ここの順番は置き場所の正しさに直結する。
  [/豆腐|納豆|牛乳|チーズ|ヨーグルト|卵|たまご|バター/, "乳製品・卵・豆腐"],
  // 練り物も氷温ルームの対象。ここに無いと「要確認」に落ちて冷蔵になり、
  // 使い方の説明(肉・魚・練り物は氷温)と実装が食い違う。
  [/豚|鶏|牛|ひき肉|ベーコン|ハム|ソーセージ|鮭|さけ|さば|鯖|まぐろ|えび|いか|魚|ちくわ|かまぼこ|はんぺん|さつま揚げ|練り物/, "肉・魚"],
  [/醤油|しょうゆ|味噌|みそ|酒|みりん|砂糖|塩|酢|油|ソース|ポン酢|ケチャップ|マヨ|だし|こしょう|片栗粉|小麦粉/, "調味料"],
  [/冷凍/, "冷凍"],
  [
    /なす|きゅうり|トマト|キャベツ|玉ねぎ|たまねぎ|人参|にんじん|じゃがいも|大根|ねぎ|ピーマン|オクラ|もやし|ほうれん草|レタス|白菜|かぼちゃ|しょうが|生姜|にんにく|きのこ|しめじ|えのき|舞茸|野菜/,
    "野菜",
  ],
];

export function guessSection(name: string): string {
  for (const [re, section] of SECTION_HINTS) {
    if (re.test(name)) return section;
  }
  return "要確認";
}

export function looseMatch(a: string, b: string): boolean {
  const x = normalize(a);
  const y = normalize(b);
  if (!x || !y) return false;
  // 1文字だけの一致は誤爆が多い(「油」が「醤油」に当たる等)
  if (x.length < 2 || y.length < 2) return x === y;
  return x.includes(y) || y.includes(x);
}
