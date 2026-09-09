/*
 * 食材マスタを作り、いま入っている行に food_id を貼る。
 *
 * 【何度流しても同じ結果になること】
 * 途中で失敗して流し直すことがあるので、
 *   ・同じ名前の食材は作り直さない
 *   ・すでに food_id が付いている行は触らない
 * を守る。そうしないと、二度流しただけで食材が2つに割れる。
 *
 * 【使い方】
 *   node --experimental-strip-types scripts/seed-foods.mjs           下見。何も書かない
 *   node --experimental-strip-types scripts/seed-foods.mjs --apply   実際に書く
 *
 * 先に supabase/22_foods.sql を Supabase で実行しておくこと。
 */
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { FOODS } from "./foods-master.mjs";
import { buildIndex, classify } from "./foods-map.mjs";

const SKILL = join(dirname(fileURLToPath(import.meta.url)), "..", "cowork", "jisui");
const APPLY = process.argv.includes("--apply");

function py(code) {
  const r = spawnSync("python", ["-c", code], {
    encoding: "utf8",
    env: { ...process.env, PYTHONIOENCODING: "utf-8" },
  });
  if (r.status !== 0) throw new Error((r.stderr || "").trim().split("\n").slice(-4).join(" / "));
  return r.stdout.trim() ? JSON.parse(r.stdout) : null;
}
const HEAD = `
import json, sys
sys.path.insert(0, ${JSON.stringify(SKILL)})
import db
j = db.Jisui()
`;

// ---------------------------------------------------------------- 読む
let data;
try {
  data = py(HEAD + `sys.stdout.write(json.dumps({
    "foods": j.select("foods", "*"),
    "inventory": j.select("inventory", "id,name,food_id"),
    "ingredients": j.select("recipe_ingredients", "id,name,food_id"),
    "pantry": j.select("pantry", "id,name,food_id"),
    "household": j.household_id,
}, ensure_ascii=True))`);
} catch (e) {
  console.error("読めませんでした: " + e.message);
  console.error("→ supabase/22_foods.sql を Supabase で実行しましたか?");
  process.exit(1);
}

const existing = new Map(data.foods.map((f) => [f.name, f]));

// ---------------------------------------------------- 1. 足りない食材を作る
const toCreate = FOODS.filter(([name]) => !existing.has(name)).map(
  // household_id は db.py の insert が自動で補う(付けると二重になる)
  ([name, kana, kind, section, location, aliases]) => ({
    name, kana, kind, section, location, aliases,
  }),
);
console.log(`食材マスタ: すでに ${existing.size} 件 / 新しく作る ${toCreate.length} 件`);

if (APPLY && toCreate.length) {
  const made = py(HEAD + `rows = json.loads(${JSON.stringify(JSON.stringify(toCreate))})
got = j.insert("foods", rows)
sys.stdout.write(json.dumps(got, ensure_ascii=True))`);
  for (const f of made) existing.set(f.name, f);
  console.log(`  作りました: ${made.length} 件`);
}

// ------------------------------------------------- 2. 行に food_id を貼る
const index = buildIndex();
const idOf = (name) => existing.get(name)?.id ?? null;

const plan = { inventory: [], recipe_ingredients: [], pantry: [] };
const unresolved = [];
for (const [table, rows] of [
  ["inventory", data.inventory],
  ["recipe_ingredients", data.ingredients],
  ["pantry", data.pantry],
]) {
  for (const r of rows) {
    if (r.food_id != null) continue;          // すでに決まっている行は触らない
    const food = classify(r.name, index);
    if (!food) { unresolved.push(`${table}: ${r.name}`); continue; }
    const id = idOf(food);
    if (id == null) continue;                  // --apply 前は id が無いので数えるだけ
    plan[table].push({ id: r.id, food_id: id });
  }
}

for (const [table, rows] of Object.entries(plan)) {
  console.log(`${table}: ${rows.length} 行に貼る`);
}
if (unresolved.length) {
  console.log(`\n【食材が決まらない ${unresolved.length} 件】food_id は空のままにする。`);
  console.log("アプリの在庫画面から選べば、そのとき別名として覚える。");
  for (const u of unresolved) console.log("  " + u);
}

if (!APPLY) {
  console.log("\n--apply が無いので何も書いていません。");
  process.exit(0);
}

for (const [table, rows] of Object.entries(plan)) {
  if (!rows.length) continue;
  py(HEAD + `rows = json.loads(${JSON.stringify(JSON.stringify(rows))})
for r in rows:
    j.update(${JSON.stringify(table)}, {"food_id": r["food_id"]}, id="eq.%d" % r["id"])
sys.stdout.write("null")`);
  console.log(`${table}: ${rows.length} 行に貼りました`);
}
console.log("\n終わりました。");
