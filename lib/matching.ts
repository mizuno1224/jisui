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

const normalize = normalizeText;

/**
 * 材料名から売り場を推測する。当たらなければ「要確認」に落とす。
 * 買い物リストに足すときの初期値でしかないので、外れても手で直せばよい。
 */
const SECTION_HINTS: [RegExp, string][] = [
  [/豚|鶏|牛|ひき肉|ベーコン|ハム|ソーセージ|鮭|さけ|さば|鯖|まぐろ|えび|いか|魚/, "肉・魚"],
  [/豆腐|納豆|牛乳|チーズ|ヨーグルト|卵|たまご|バター/, "乳製品・卵・豆腐"],
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
