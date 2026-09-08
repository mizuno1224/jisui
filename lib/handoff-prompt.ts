import { todayISO } from "@/lib/dates";
import { HANDOFF_KIND, HANDOFF_VERSION, type HandoffOp } from "@/lib/handoff";
import { SALE_SECTION, SECTION_ORDER } from "@/lib/sections";
import { EXPENSE_CATEGORIES, type ExpenseRule } from "@/lib/types";

/**
 * スマホのチャットに「受け渡し JSON の書き方」を渡すための依頼文を作る。
 *
 * 【なぜこれが要るのか】
 * 受け渡し JSON を貼り込む画面(/handoff)は前からあるが、
 * その【書式を知っているのはスキルを積んだチャットだけ】だった。
 * スキルは Cowork とパソコンの Claude Code にしか載っていないので、
 * スマホの Claude アプリに「受け渡し JSON を出して」と頼んでも、
 * 相手は形を知らず、文章で返してくる。貼っても取り込めない。
 *
 * つまりスマホから記録するには、結局パソコンが要った。
 * レシートを撮るのはスマホなのに、パソコンの前に戻らないと入らない。
 *
 * ならば【書式のほうをアプリから配る】。この文章を貼れば、
 * スキルを持たないどのチャットでも、貼り込める JSON を返せる。
 *
 * レシピは /recipes/ask(lib/ai-context.ts)が同じ考え方で先に閉じている。
 * こちらはその「記録側」。2つ揃って、スマホだけで一周する。
 *
 * 【op の説明を1か所にまとめる理由】
 * 受け取る側(lib/handoff.ts の applyOne)と、頼む側(この文章)が
 * 食い違うと、チャットは正しいつもりで、入らない JSON を返し続ける。
 * 人には理由が見えない(貼るまで分からない)。
 * 下の OP_DOCS は HandoffOp で型が付けてあるので、
 * op を足したときに【ここを書かないと型検査で落ちる】。
 */

/** 受け取る側が実際に扱える op の説明。抜けると tsc が落ちる(上のコメント)。 */
const OP_DOCS: Record<HandoffOp, string> = {
  add_receipt: `### add_receipt — レシート1枚ぶんの買い物

\`\`\`json
{ "op": "add_receipt", "args": {
  "date": "2026-09-06",
  "amount": 3218,
  "merchant_raw": "ライフ 西宮北口店",
  "category": "食費",
  "memo": null,
  "items": [ { "item": "豚こま切れ", "price": 498 }, { "item": "キャベツ", "price": 198 } ],
  "inventory": [ { "name": "豚こま切れ", "qty": 1, "unit": "パック", "location": "冷蔵", "bought_on": "2026-09-06" } ]
} }
\`\`\`

- \`amount\` は**レシートの支払合計(税込)**。品目の合計と合わなくてよい
  (値引き・ポイント・税の丸めがあるので、普通は合わない)
- \`items\` は読めたものだけでよい。読めない行は飛ばす
- \`inventory\` は**しまうものだけ**。惣菜・日用品は入れない。
  \`location\` は 冷蔵 / 氷温 / 野菜 / 冷凍 / 常温 のどれか。ほかの語はエラーになる
- \`expiry\` はレシートには書いていない。**書かない**(推測しない)
- 同じ 日付・金額・店 のレシートは二重に入らない(アプリが弾く)`,

  import_card_row: `### import_card_row — カード明細の1行

args は add_receipt と同じ。\`items\` と \`inventory\` は普通いらない。
明細をまとめて渡されたときは、1行につき1レコードで並べる。`,

  add_shopping: `### add_shopping — 買い物リストに足す

\`\`\`json
{ "op": "add_shopping", "args": { "items": [
  { "item": "牛乳", "qty": "1本", "reason": "切らした", "section": "乳製品・卵・豆腐" }
] } }
\`\`\`

- \`qty\` は「1本」「2パック」のような**文字**でよい
- \`section\` は売り場。${[...SECTION_ORDER.filter((s) => s !== "要確認"), SALE_SECTION].join(" / ")}
  分からなければ**書かない**(「要確認」で入る)`,

  add_event: `### add_event — 予定

\`\`\`json
{ "op": "add_event", "args": {
  "date": "2026-09-20", "start_time": "10:30", "end_time": null,
  "title": "歯医者", "location": "阪急西宮北口", "memo": null,
  "items": "保険証", "repeat": "なし"
} }
\`\`\`

- 時刻が分からない予定は \`start_time\` を書かない(終日として入る)
- \`items\` は持ち物。文字で1つにまとめる`,

  add_todo: `### add_todo — やること

\`\`\`json
{ "op": "add_todo", "args": {
  "title": "確定申告", "detail": null, "due_date": "2026-03-15",
  "subtasks": ["源泉徴収票を出す", "医療費を集計する"]
} }
\`\`\`

\`subtasks\` を書くと、その下にぶら下がる子として入る。`,

  add_rule: `### add_rule — 店名から費目を決める辞書に足す

\`\`\`json
{ "op": "add_rule", "args": { "keyword": "ライフ", "category": "食費", "note": null } }
\`\`\`

**本人に確かめてから出すこと。** 勝手に足さない。
辞書が変わると、これから取り込む明細の費目がまとめて変わる。`,

  add_checkup: `### add_checkup — 健康診断・人間ドック・血液検査 1回ぶん

\`\`\`json
{ "op": "add_checkup", "args": {
  "member": "夫", "date": "2026-06-12", "kind": "健康診断",
  "place": null, "overall": "B", "finding": null, "memo": null,
  "results": [
    { "item": "HDLコレステロール", "value_num": 62, "unit": "mg/dL",
      "ref_low": 40, "ref_high": null, "judge": "A" },
    { "item": "尿蛋白", "value_text": "(-)", "ref_text": "(-)", "judge": "A" }
  ]
} }
\`\`\`

- 数で出る項目は \`value_num\`、「(-)」のような書き方は \`value_text\`
- **基準値は検査票に書いてある数字をそのまま写す**(\`ref_low\` / \`ref_high\`、
  範囲が文字なら \`ref_text\`)。一般的な基準を当てないこと。
  紙と画面で判定が食い違うと、どちらが本当か分からなくなる
- 項目は**検査票に並んでいる順**で書く。読めない項目は飛ばす。埋めない`,

  insert: `### insert — 上のどれでもない表に、そのまま行を入れる

\`\`\`json
{ "op": "insert", "args": { "table": "inventory", "rows": [
  { "name": "たまご", "qty": 10, "unit": "個", "location": "冷蔵" }
] } }
\`\`\`

使える表は **meal_plan / recipes / recipe_ingredients / inventory / cook_log /
pantry / preferences / equipment** だけ。家計の表はここからは触れない。

レシピを作るなら、アプリの**レシピタブ →「AIに相談する」**のほうが早い
(在庫を渡すところから登録まで、その画面だけで閉じる)。`,
};

/** 依頼文に出す順番。使う回数が多いものを上に置く(下は読まれない)。 */
const ORDER: HandoffOp[] = [
  "add_receipt",
  "add_shopping",
  "add_event",
  "add_todo",
  "import_card_row",
  "add_rule",
  "add_checkup",
  "insert",
];

export function buildHandoffPrompt(args: { rules: ExpenseRule[] }): string {
  const L: string[] = [];
  const push = (s = "") => L.push(s);

  push("# 記録のお願い");
  push();
  push(`今日は ${todayISO()} です。`);
  push();
  push("これから、レシートの写真や、買ったもの・予定・やることの話をします。");
  push("読み取った結果を、**下の形の JSON**で返してください。");
  push("そのままアプリに貼り付けて記録します。");
  push();

  // ---- 守ってほしいこと。最初に置く。後ろに置くと読み飛ばされる。
  push("## 必ず守ってほしいこと");
  push();
  push("1. **JSON はコードブロックに入れて、1つだけ**出す。説明はその外に書く");
  push("2. **分からないところは埋めない。先に聞いてください。**");
  push("   推測で入れた金額や費目は、あとから誰も間違いに気づけません");
  push("3. 日付は `YYYY-MM-DD`。金額は円の整数(カンマ・小数・「円」を付けない)");
  push("4. **消す操作はありません。** 間違えたぶんはアプリの画面から直します");
  push();

  push("## 形");
  push();
  push("```json");
  push("{");
  push(`  "kind": "${HANDOFF_KIND}",`);
  push(`  "version": ${HANDOFF_VERSION},`);
  push('  "note": "何をしたかを一言(任意)",');
  push('  "records": [');
  push('    { "op": "add_receipt", "args": { … } }');
  push("  ]");
  push("}");
  push("```");
  push();
  push("`records` は何件でも並べられます。レシート3枚なら3件。");
  push();

  push("## 使える op");
  push();
  for (const op of ORDER) {
    push(OP_DOCS[op]);
    push();
  }

  // ---- 費目。ここが揃わないと、家計画面の月次比較が意味を失う。
  push("## 費目");
  push();
  push(`支出の費目は、この10個のどれかです: ${EXPENSE_CATEGORIES.join(" / ")}`);
  push();
  push("**この一覧に無い言葉を作らないでください。**");
  push("どれにも決められないときは `category` を書かないこと。");
  push("「要確認」として入り、アプリの家計画面に「確認が要る行」として出ます。");
  push();

  // ---- 分類辞書。AI の判断より辞書を優先させる(cowork/jisui/KAKEIBO.md と同じ決まり)。
  const rules = args.rules.filter((r) => r.keyword && r.category);
  push("## 店名 → 費目 の辞書");
  push();
  if (rules.length === 0) {
    push("(まだ登録がありません)");
  } else {
    push("店名にこの言葉が含まれていたら、**その費目を機械的に使ってください。**");
    push("「これは日用品では」と思っても変えないこと。");
    push("同じ店がその時々で違う費目になると、前月比が比べられなくなります。");
    push();
    push("| 店名に含まれる言葉 | 費目 |");
    push("|---|---|");
    for (const r of rules) push(`| ${r.keyword} | ${r.category} |`);
    push();
    push("**辞書に無い店は、費目を決めつけないでください。**");
    push("こう思う、と言ってから聞いてください。よければ `add_rule` で辞書に足します。");
  }
  push();

  push("---");
  push();
  push("では、これから渡すものを読んでください。");

  return L.join("\n");
}
