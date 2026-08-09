/**
 * 8/9 の Cowork セッションで jisui.db(引退した SQLite)にだけ入った記録を
 * Supabase へ移すための SQL を作る。
 *
 *   node scripts/import-0809.mjs                        … 何をするつもりかを並べるだけ。何も書かない
 *   node scripts/import-0809.mjs --apply > import_0809.sql … 実際に流す SQL を書き出す
 *
 * 方式は scripts/migrate-kakeibo.mjs に合わせてある。
 * このスクリプトは Supabase に接続しない。SQL を作るだけで、書き込むのは
 * 人が SQL Editor に貼って実行したときだけ。--apply はその SQL を出す合図。
 * 付けない限り標準出力に SQL は一切出ないので、うっかり流し込む事故が起きない。
 *
 * 何度実行しても増えない。insert には全部「既にあれば飛ばす」を付け、
 * 献立は update を先に試して当たらなかったときだけ insert する形にしてある。
 *
 * delete は1件も使わない。理由は §献立。消す必要が出たら、末尾の確認用
 * SELECT が「想定外の行」を並べるので、それを見てから人が判断する。
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const DB = String.raw`C:\Users\mmizu\jisui\jisui.db`;
const JISUI = String.raw`C:\Users\mmizu\jisui`; // card_path はここからの相対パス
const HOUSEHOLD = "00000000-0000-4000-8000-000000000001";

/**
 * 献立を SQLite に合わせるのは 8/8 以降だけ。
 *
 * 8/6 は両者同じ。8/7 は SQLite が「予定」、Supabase が「実施」で、
 * 外食したという事実は Supabase 側にしか無い(SQLite は 8/9 に見直していない)。
 * 8/7 を上書きすると新しい記録のほうを消すことになるので、範囲から外す。
 */
const FROM = "2026-08-08";
const TO = "2026-08-12";

const APPLY = process.argv.includes("--apply");

/**
 * sqlite3 を使わず Python 経由で読む(Windows に sqlite3.exe が無いため)。
 *
 * Windows の標準出力は既定が cp932 なので、日本語がそのままだと化けて
 * JSON として読めなくなる。ensure_ascii=True でエスケープさせ、
 * 経路の文字コードに依存しない形で受け取る。
 *
 * node:sqlite は Node 24 なら読める(確認済み)が、experimental の警告が
 * stderr に出るうえ migrate-kakeibo.mjs と流儀が割れるので使わない。
 */
function query(sql) {
  const script = `
import sqlite3, json, sys
c = sqlite3.connect(r"${DB}")
c.row_factory = sqlite3.Row
rows = [dict(r) for r in c.execute(${JSON.stringify(sql)})]
sys.stdout.write(json.dumps(rows, ensure_ascii=True))
`;
  const out = execFileSync("python", ["-c", script], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return JSON.parse(out);
}

const q = (v) => (v === null || v === undefined ? "null" : `'${String(v).replace(/'/g, "''")}'`);
const n = (v) => (v === null || v === undefined || v === "" ? "null" : Number(v));
const b = (v) => (v ? "true" : "false");

/**
 * SQLite の日時は '2026-08-09 07:28' の形で、中身は UTC。
 * (jisui.db の更新時刻 16:48 JST と inventory の 07:45 が一致することで確認済み)
 * timestamptz に入れるので +00 を明示する。
 */
const ts = (v) => {
  if (v === null || v === undefined || v === "") return "null";
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(v)) {
    die(`日時の形が想定と違う: ${JSON.stringify(v)}。'YYYY-MM-DD HH:MM' のはずだった`);
  }
  return `'${v.replace(" ", "T")}:00+00'`;
};

function die(msg) {
  process.stderr.write(`中断: ${msg}\n`);
  process.exit(1);
}

// ============================================================
// 元データを読む。想定と違ったらここで止める。
// 8/9 のセッションを再現した SQL を出すスクリプトなので、
// 元が動いていたら黙って別の SQL を出すより止まったほうがよい。
// ============================================================

if (!existsSync(DB)) die(`${DB} が無い`);

const srcEquipment = query(
  "select id, name, memo from equipment where name like '%R-HWC54Y%' order by id",
);
const srcRecipes = query(
  "select id, name, category, protein, time_min, freezable, freeze_notes, card_path, source, tags, created_at" +
    " from recipes where id in (7, 8) order by id",
);
const srcIngredients = query(
  "select recipe_id, name, qty, unit, optional from recipe_ingredients where recipe_id in (7, 8) order by rowid",
);
const srcMeals = query(
  `select date, slot, recipe_id, name, status from meal_plan where date >= '${FROM}' order by date, rowid`,
);
const srcRecipeNames = Object.fromEntries(
  query("select id, name from recipes").map((r) => [r.id, r.name]),
);
const srcOnion = query("select id, name, qty, unit, location, updated_at from inventory where name = '玉ねぎ'");

if (srcEquipment.length !== 1) die(`equipment の冷蔵庫が ${srcEquipment.length} 件。1件のはず`);
if (srcRecipes.length !== 2) die(`recipes id 7,8 が ${srcRecipes.length} 件。2件のはず`);
if (srcOnion.length !== 1) die(`inventory の玉ねぎが ${srcOnion.length} 件。1件のはず`);
if (srcMeals.some((m) => m.date > TO)) die(`meal_plan に ${TO} より後の行がある。TO を見直すこと`);
if (srcMeals.some((m) => m.recipe_id === null)) {
  // 献立の行合わせはレシピ名を鍵にしている。レシピの付いていない行は鍵が無い。
  die("8/8 以降の献立にレシピ未設定の行がある。名前で突き合わせる処理を足す必要がある");
}
if (srcMeals.some((m) => m.slot !== "夕食")) die("8/8 以降の献立に夕食以外がある。想定外");

// 材料の重複チェック。(レシピ, 材料名) を「既にあれば飛ばす」の鍵にするので、
// 同じレシピに同じ材料名が2行あると1行しか入らない。
for (const r of srcRecipes) {
  const names = srcIngredients.filter((i) => i.recipe_id === r.id).map((i) => i.name);
  const dup = names.filter((x, i) => names.indexOf(x) !== i);
  if (dup.length) die(`${r.name} に同じ材料名が2行ある: ${dup.join(", ")}`);
}

// レシピカードは .md ファイルを正とする(DB の card_path は場所を指すだけ)。
const cards = new Map();
for (const r of srcRecipes) {
  const file = join(JISUI, r.card_path.replace(/\//g, "\\"));
  if (!existsSync(file)) die(`レシピカードが無い: ${file}`);
  // 改行は現在のディスク上のまま(LF)で入れる。既存6件が CRLF なのは前回移行の
  // 副産物で、揃えるなら既存側を直すほうが筋。表示は react-markdown なので差は出ない。
  cards.set(r.id, readFileSync(file, "utf8"));
}

// ============================================================
// やることを組み立てる。
// 1件 = { title(日本語の説明), why(補足), sql(実際の文) }
// dry-run は title と why だけ、--apply は sql だけを出す。
// ============================================================

const plan = [];
const add = (title, why, sql) => plan.push({ title, why, sql: sql ?? [] });

// ------------------------------------------------------------ 調理器具
const eq = srcEquipment[0];
add(
  `調理器具を1件足す: ${eq.name}`,
  [
    "Supabase の equipment には冷蔵庫が入っていない(8/9 に SQLite へ書いたきり)。",
    "memo の末尾「野菜は冷蔵室でなく野菜室が原則」が、区画を増やす話の一次資料になる。",
    "同じ名前が既にあれば何もしない。",
  ],
  [
    `insert into equipment (household_id, name, memo)\n` +
      `select '${HOUSEHOLD}', ${q(eq.name)}, ${q(eq.memo)}\n` +
      `where not exists (select 1 from equipment where household_id = '${HOUSEHOLD}' and name = ${q(eq.name)});`,
  ],
);

// -------------------------------------------------------------- レシピ
for (const r of srcRecipes) {
  const md = cards.get(r.id);
  add(
    `レシピを1件足す: ${r.name}(${r.category} / ${r.time_min}分)`,
    [
      `カード本文は ${r.card_path} をそのまま card_md に入れる(${md.length}文字)。`,
      `作成日時は SQLite の ${r.created_at}(UTC)をそのまま残す。8/9 の記録だという事実が消えるため、now() では入れない。`,
      `SQLite の id ${r.id} は使わない。Supabase 側の採番に任せ、材料と献立は名前から id を引く。`,
      "同じ名前が既にあれば何もしない(カード本文の入れ直しもしない)。",
    ],
    [
      `insert into recipes (household_id, name, category, protein, time_min, freezable, freeze_notes, card_md, source, tags, created_at)\n` +
        `select '${HOUSEHOLD}', ${q(r.name)}, ${q(r.category)}, ${q(r.protein)}, ${n(r.time_min)}, ${b(r.freezable)}, ${q(r.freeze_notes)},\n` +
        `       ${q(md)},\n` +
        `       ${q(r.source)}, ${q(r.tags)}, ${ts(r.created_at)}\n` +
        `where not exists (select 1 from recipes where household_id = '${HOUSEHOLD}' and name = ${q(r.name)});`,
    ],
  );
}

// ------------------------------------------------------------ レシピ材料
//
// recipe_ingredients に household_id は無い(01_schema.sql:84-91)。
// 世帯は recipes 経由で判定される(RLS は 01_schema.sql:162-165)。
// household_id を送ると「そんな列は無い」で落ちるので、絶対に足さない。
// recipe_id は上で入れたレシピを名前で引き直して使う。
for (const r of srcRecipes) {
  const items = srcIngredients.filter((i) => i.recipe_id === r.id);
  add(
    `${r.name} の材料を ${items.length} 行足す`,
    [
      items.map((i) => `${i.name} ${i.qty}${i.unit}`).join(" / "),
      "household_id は付けない(この表には無い列。世帯は recipes 経由で判定される)。",
      "recipe_id はレシピ名から引く。SQLite の id をそのまま書くと別のレシピにぶら下がる。",
      "同じレシピに同じ材料名が既にあれば飛ばす。",
      ...(r.id === 7
        ? [
            "参考: カードは「キャベツ(カット)」、材料は「キャベツ」。在庫側は「キャベツ(カット)」だが、",
            "  lib/matching.ts:23 が括弧書きを落として突き合わせるので実害は無い。SQLite の表記のまま入れる。",
          ]
        : []),
      ...(r.id === 8
        ? [
            "参考: カードの「水 500ml」と水溶き用の水は材料に入れない。",
            "  recipe_ingredients は買い物と在庫引き当ての表で、既存レシピ(麻婆豆腐など)も水を持っていない。",
          ]
        : []),
    ],
    items.map(
      (i) =>
        `insert into recipe_ingredients (recipe_id, name, qty, unit, optional)\n` +
        `select r.id, ${q(i.name)}, ${n(i.qty)}, ${q(i.unit)}, ${b(i.optional)}\n` +
        `from recipes r\n` +
        `where r.household_id = '${HOUSEHOLD}' and r.name = ${q(r.name)}\n` +
        `  and not exists (select 1 from recipe_ingredients x where x.recipe_id = r.id and x.name = ${q(i.name)});`,
    ),
  );
}

// ---------------------------------------------------------------- 在庫
const onion = srcOnion[0];
add(
  `在庫「玉ねぎ」の置き場所を 常温 → ${onion.location} に直す`,
  [
    `SQLite の ${onion.updated_at}(UTC)の書き込みが最新。Supabase 側は移行時のまま常温になっている。`,
    "本当の置き場所は野菜室だが、01_schema.sql:59-60 の check が 冷蔵/冷凍/常温 しか通さないので今は入れられない。",
    "  区画を増やすのはこのスクリプトの仕事ではない(schema と lib/types.ts:40 の両方を直す別作業)。",
    "  常温よりは冷蔵のほうが実物に近いので、SQLite の値をそのまま入れる。",
    `updated_at が ${onion.updated_at} より新しければ触らない。8/9 より後にアプリで直していたら、そちらを尊重する。`,
    "たまご(Supabase 9個 / SQLite 10個)には触らない。減ったという新しい記録は Supabase 側にしか無い。",
  ],
  [
    `update inventory set location = ${q(onion.location)}, updated_at = ${ts(onion.updated_at)}\n` +
      `where household_id = '${HOUSEHOLD}' and name = ${q(onion.name)}\n` +
      `  and location is distinct from ${q(onion.location)}\n` +
      `  and updated_at < ${ts(onion.updated_at)};`,
  ],
);

// ---------------------------------------------------------------- 献立
//
// 8/9 の組み直しは「8/8 を中止」「8/9 に新レシピ2品」「8/10〜8/12 を1日ずつ後ろへ」の3点。
// 回答_献立の食い違い.md:73-77 の判定ルールに従い、8/8 以降は SQLite を優先する。
// 8/7(外食=実施)は Supabase 側が新しいので触らない。
//
// 行の突き合わせはレシピ名で行う。日付を鍵にすると、1日ずらす操作が
// 「元の日付の行を消して新しい日付に作る」になってしまい、行が入れ替わる。
// レシピ名で捕まえて日付を書き換えれば、消さずに動かせる。
//
// update を先に試し、当たらなかったときだけ insert する。
// 2回目に流すと update が当たる(同じ値を書くだけ)ので insert は飛ぶ。増えない。

add(
  "献立: 8/6 と 8/7 には触らない",
  [
    "8/6(サラダ+冷奴+惣菜の残り / 実施)は両者同じ。",
    "8/7 は SQLite が「外食 / 予定」、Supabase が「外食 / 実施」。実際に外食したという記録は",
    "  Supabase 側にしかない(SQLite は 8/9 に 8/7 を見直していない)。上書きすると新しいほうを潰す。",
    "  → この行は Supabase のまま残す。SQL は1文も出さない。",
  ],
);

const neededRecipeNames = [...new Set(srcMeals.map((m) => srcRecipeNames[m.recipe_id]))];

const guard = [
  `-- 想定外の形をしていたら、何も書かずに全部やめる。`,
  `-- 献立の突き合わせは「レシピ名で1行に絞れる」ことを前提にしているため。`,
  `do $$`,
  `declare cnt int; missing text;`,
  `begin`,
  `  -- 献立が参照するレシピが全部そろっているか。`,
  `  -- 1つでも欠けると、その行の update も insert も静かに0件で終わってしまう。`,
  `  select string_agg(x.name, ', ') into missing`,
  `    from (values`,
  `      ${neededRecipeNames.map((x) => `(${q(x)})`).join(",\n      ")}`,
  `    ) as x(name)`,
  `   where not exists (select 1 from recipes r where r.household_id = '${HOUSEHOLD}' and r.name = x.name);`,
  `  if missing is not null then`,
  `    raise exception '献立が参照するレシピが Supabase にありません: %。中断しました。', missing;`,
  `  end if;`,
  ``,
  `  select count(*) into cnt from meal_plan`,
  `   where household_id = '${HOUSEHOLD}' and slot = '夕食' and date between '${FROM}' and '${TO}';`,
  `  if cnt > ${srcMeals.length} then`,
  `    raise exception '${FROM}〜${TO} の夕食が % 行あります(移行後の想定は ${srcMeals.length} 行)。想定外の行があるので中断しました。末尾の確認用SELECTで中身を見てください。', cnt;`,
  `  end if;`,
  ``,
  `  if exists (`,
  `    select 1 from meal_plan`,
  `     where household_id = '${HOUSEHOLD}' and slot = '夕食' and date between '${FROM}' and '${TO}'`,
  `       and recipe_id is not null`,
  `     group by recipe_id having count(*) > 1`,
  `  ) then`,
  `    raise exception '${FROM}〜${TO} に同じレシピの夕食が2行以上あります。どちらを動かすか機械では決められないので中断しました。';`,
  `  end if;`,
  `end $$;`,
].join("\n");

add(
  `献立: 書き換える前に ${FROM}〜${TO} の中身を検査する`,
  [
    "献立が参照するレシピが1つでも欠けていたら、その場で全部やめる。",
    `夕食が ${srcMeals.length} 行を超えていても全部やめる(begin 〜 commit の中なので何も残らない)。`,
    "同じレシピの行が2つ以上あっても、どちらを動かすか決められないのでやめる。",
    "勝手に消して辻褄を合わせるより、止まって人に見せるほうがよい。",
  ],
  [guard],
);

for (const m of srcMeals) {
  const rname = srcRecipeNames[m.recipe_id];
  if (!rname) die(`献立 ${m.date} が参照する recipes.id=${m.recipe_id} が SQLite に無い`);
  const isNew = srcRecipes.some((r) => r.id === m.recipe_id);
  const rid = `(select r.id from recipes r where r.household_id = '${HOUSEHOLD}' and r.name = ${q(rname)})`;

  add(
    `献立 ${m.date} を「${m.name}」(${m.status})にする`,
    [
      isNew
        ? `8/9 に作った新レシピ。上で入れたレシピの id を名前で引いて紐づける。既存の行は無いので新しく作られる。`
        : `既にある「${rname}」の行を ${FROM}〜${TO} の中から探して、日付と名前と状態を書き換える。消して作り直さない。`,
      ...(m.status === "中止"
        ? ["自炊しなかったという申告。予定より強い記録なので SQLite を優先する。"]
        : []),
      "見つからなければ新しく作る。2回目以降は書き換えのほうが当たるので、行は増えない。",
      `${FROM} 以降のどこかに「${rname}」の行が既にあれば、書き換えが当たらなくても作らない。`,
      `  ${TO} より後へ動かした献立を、2回目に流したときに復活させないため。`,
    ],
    [
      `with moved as (\n` +
        `  update meal_plan set date = ${q(m.date)}, name = ${q(m.name)}, status = ${q(m.status)}\n` +
        `   where household_id = '${HOUSEHOLD}' and slot = ${q(m.slot)}\n` +
        `     and date between '${FROM}' and '${TO}'\n` +
        `     and recipe_id = ${rid}\n` +
        `  returning id\n` +
        `)\n` +
        `insert into meal_plan (household_id, date, slot, recipe_id, name, status)\n` +
        `select '${HOUSEHOLD}', ${q(m.date)}, ${q(m.slot)}, r.id, ${q(m.name)}, ${q(m.status)}\n` +
        `from recipes r\n` +
        `where r.household_id = '${HOUSEHOLD}' and r.name = ${q(rname)}\n` +
        `  and not exists (select 1 from moved)\n` +
        `  and not exists (\n` +
        `    select 1 from meal_plan m2\n` +
        `     where m2.household_id = '${HOUSEHOLD}' and m2.slot = ${q(m.slot)}\n` +
        `       and m2.recipe_id = r.id and m2.date >= '${FROM}'\n` +
        `  );`,
    ],
  );
}

// ============================================================
// dry-run: 何をするつもりかを並べるだけ
// ============================================================

if (!APPLY) {
  const lines = [];
  lines.push("============================================================");
  lines.push("これから Supabase に対して行うこと(いまは何も書いていない)");
  lines.push(`元データ: ${DB}`);
  lines.push(`レシピカード: ${join(JISUI, "recipes")}`);
  lines.push(`世帯: ${HOUSEHOLD}`);
  lines.push("============================================================");
  lines.push("");
  plan.forEach((s, i) => {
    lines.push(`[${i + 1}] ${s.title}`);
    for (const w of s.why) lines.push(`     ${w}`);
    lines.push(s.sql.length ? `     → SQL ${s.sql.length} 文` : "     → SQL は出さない");
    lines.push("");
  });
  lines.push("------------------------------------------------------------");
  lines.push("消す操作について");
  lines.push("------------------------------------------------------------");
  lines.push("delete は1件も使わない。献立の日付をずらすのも update で行う。");
  lines.push("そのため、このスクリプトで何かが消えることはない。");
  lines.push("ただし 8/8〜8/12 に想定外の行があると、日付をずらした結果おかしな並びに");
  lines.push("なりうる。その場合は上の検査で中断するか、末尾の確認用 SELECT に出る。");
  lines.push("消すかどうかは、その中身を見てから人が決めること。");
  lines.push("");
  lines.push("------------------------------------------------------------");
  lines.push("触らないもの");
  lines.push("------------------------------------------------------------");
  lines.push("・8/7 の献立(外食=実施)。Supabase 側のほうが新しい");
  lines.push("・在庫のたまご(Supabase 9個 / SQLite 10個)。減った記録は Supabase にしかない");
  lines.push("・cook_log。8/9 時点で SQLite・Supabase とも 8/6 の1件だけで同じ");
  lines.push("・01_schema.sql と lib/types.ts。玉ねぎを野菜室にするには別途この2つを直す必要がある");
  lines.push("");
  lines.push("------------------------------------------------------------");
  lines.push("実際に流すには");
  lines.push("------------------------------------------------------------");
  lines.push("  node scripts/import-0809.mjs --apply > import_0809.sql");
  lines.push("  → 出てきた import_0809.sql を Supabase の SQL Editor に貼って実行する");
  lines.push("  (begin 〜 commit で囲ってあるので、途中で失敗すれば全部取り消される)");
  process.stdout.write(lines.join("\n") + "\n");
  process.exit(0);
}

// ============================================================
// --apply: 実際に流す SQL を書き出す
// ============================================================

const out = [];
const say = (s) => out.push(s);

say(`-- ============================================================`);
say(`-- 8/9 の Cowork セッションの記録を jisui.db から Supabase へ移す`);
say(`-- scripts/import-0809.mjs が生成。手で編集しない。`);
say(`-- 何度実行しても増えない。delete は1件も無い。`);
say(`-- ============================================================`);
say(``);
say(`begin;`);
say(``);

for (const [i, s] of plan.entries()) {
  if (!s.sql.length) {
    say(`-- [${i + 1}] ${s.title}(SQL 不要)`);
    for (const w of s.why) say(`--      ${w}`);
    say(``);
    continue;
  }
  say(`-- [${i + 1}] ${s.title}`);
  for (const w of s.why) say(`--      ${w}`);
  for (const stmt of s.sql) say(stmt);
  say(``);
}

say(`commit;`);
say(``);
say(`-- ============================================================`);
say(`-- 検算1: 移した分がそろっているか。「元の件数」は jisui.db の実測値。`);
say(`-- ============================================================`);
say(`select`);
say(
  `  (select count(*) from equipment where household_id = '${HOUSEHOLD}' and name = ${q(eq.name)}) as 冷蔵庫, 1 as 元の冷蔵庫,`,
);
say(
  `  (select count(*) from recipes where household_id = '${HOUSEHOLD}'\n` +
    `    and name in (${srcRecipes.map((r) => q(r.name)).join(", ")})) as 新レシピ, ${srcRecipes.length} as 元の新レシピ,`,
);
say(
  `  (select count(*) from recipe_ingredients ri join recipes r on r.id = ri.recipe_id\n` +
    `    where r.household_id = '${HOUSEHOLD}'\n` +
    `      and r.name in (${srcRecipes.map((r) => q(r.name)).join(", ")})) as 新レシピの材料, ${srcIngredients.length} as 元の材料,`,
);
say(
  `  (select count(*) from meal_plan where household_id = '${HOUSEHOLD}'\n` +
    `    and date between '${FROM}' and '${TO}') as 献立, ${srcMeals.length} as 元の献立,`,
);
say(
  `  (select location from inventory where household_id = '${HOUSEHOLD}' and name = ${q(onion.name)}) as 玉ねぎの場所, ${q(onion.location)} as 元の場所;`,
);
say(``);
say(`-- 検算2: 移行後の献立。右のコメントと1行ずつ見比べる。`);
say(`select date, slot, name, status, recipe_id from meal_plan`);
say(` where household_id = '${HOUSEHOLD}' and date between '2026-08-06' and '${TO}'`);
say(` order by date, id;`);
say(`--   2026-08-06 サラダ+冷奴+惣菜の残り(軽め)  実施  ← 触っていない`);
say(`--   2026-08-07 外食  実施  ← 触っていない(Supabase のまま)`);
for (const m of srcMeals) say(`--   ${m.date} ${m.name}  ${m.status}`);
say(``);
say(`-- 検算3: 想定外の行が残っていないか。`);
say(`-- 空なら成功。ここに何か出たら、それはこの移行が作った行ではない。`);
say(`-- 消してよいかどうかは中身を読んでから人が決めること。自動では消さない。`);
say(`select m.id, m.date, m.slot, m.name, m.status, m.recipe_id from meal_plan m`);
say(` where m.household_id = '${HOUSEHOLD}' and m.date between '${FROM}' and '${TO}'`);
say(`   and not exists (`);
say(`     select 1 from (values`);
say(
  `       ${srcMeals.map((m) => `(${q(m.date)}::date, ${q(m.slot)}, ${q(m.name)})`).join(",\n       ")}`,
);
say(`     ) as v(date, slot, name)`);
say(`      where v.date = m.date`);
say(`        and v.slot is not distinct from m.slot`);
say(`        and v.name is not distinct from m.name`);
say(`   )`);
say(` order by m.date, m.id;`);

process.stdout.write(out.join("\n") + "\n");
