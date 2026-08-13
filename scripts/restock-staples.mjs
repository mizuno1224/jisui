/*
 * 常備品を切らしたら、買い物リストに自動で足す。
 *
 * 【なぜ要るか】
 * 常備品(pantry)は「いつも家にあるもの」として、買い物リストに載せない
 * 決まりにしてある。レシピの「足りない n 点」からも除かれる。
 * ところが【切らしたときに気づく道が無い】。牛乳を切らしても、
 * レシピ画面は灰色の「常備品」の札を出すだけで、買い物リストには出ない。
 * 買ったつもりで買えていない、という起き方をする。
 *
 * 【2つの合図を見る】
 *   1. staple = true の常備品が、在庫で 0 になった(または在庫に見当たらない)
 *      … 牛乳・たまご・納豆のような「冷蔵庫に常に入れておきたいもの」向け
 *   2. pantry.stock が「切れた」「切れそう」になった
 *      … 醤油や片栗粉のような、在庫として数えていないもの向け
 *      (チャットで「醤油が切れた」と言えばここが立つ)
 *
 * 【「切らした瞬間」だけ足すこと】
 * 毎回「切らしていれば足す」にすると、利用者が「今週は要らない」と
 * リストから消しても5分後に戻ってくる。リストが自分のものでなくなる。
 * 前回の状態を覚えておき、【ある → 切らした に変わったときだけ】足す。
 *
 * 【使い方】
 *   node scripts/restock-staples.mjs           下見。何も書かない
 *   node scripts/restock-staples.mjs --apply   実際に足す
 *
 * watch-inbox.mjs が5分ごとに --apply で呼ぶ。
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

// 名前の照合と売り場の判定は lib/matching.ts をそのまま使う。
// 書き写すと必ずずれる。実際、置き場所の判定が食い違って
// 牛乳が氷温ルームに落ちかけたことがある。
import { looseMatch, guessSection } from "../lib/matching.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILL = join(HERE, "..", "cowork", "jisui");
const STATE = join(homedir(), "jisui", "staples-state.json");
const APPLY = process.argv.includes("--apply");

// ---------------------------------------------------------------- 読む
const PY_READ = `
import json, sys
sys.path.insert(0, ${JSON.stringify(SKILL)})
import db
j = db.Jisui()
sys.stdout.write(json.dumps({
    "pantry": j.select("pantry", "*"),
    "inventory": j.select("inventory", "*"),
    "shopping": j.select("shopping_list", "*"),
}, ensure_ascii=True))
`;

function read() {
  const r = spawnSync("python", ["-c", PY_READ], {
    encoding: "utf8",
    env: { ...process.env, PYTHONIOENCODING: "utf-8" },
  });
  if (r.status !== 0) {
    throw new Error((r.stderr || "").trim().split("\n").slice(-3).join(" / "));
  }
  return JSON.parse(r.stdout);
}

// ---------------------------------------------------------------- 判定
function isOut(p, inventory) {
  // 明示の申告がいちばん強い。人が「切れた」と言ったなら、在庫の数より優先する。
  if (p.stock === "切れた" || p.stock === "切れそう") return p.stock;
  if (!p.staple) return null;          // 印の無いものは在庫で判断しない
  const hits = inventory.filter((i) => looseMatch(p.name, i.name ?? ""));
  if (hits.length === 0) return "在庫に無い";
  if (hits.every((i) => Number(i.qty ?? 0) <= 0)) return "在庫が0";
  return null;
}

const data = read();
const now = {};
const out = [];
for (const p of data.pantry) {
  const why = isOut(p, data.inventory);
  now[p.name] = why ?? "ある";
  if (why) out.push({ ...p, why });
}

const prev = existsSync(STATE)
  ? (() => {
      try {
        return JSON.parse(readFileSync(STATE, "utf8"));
      } catch {
        return {};
      }
    })()
  : {};

// 【初回は何も足さない】
// 覚えていない状態から始めると、いま切らしている全部がいきなり載る。
// まず今の状態を覚えるだけにして、次に切らしたときから効かせる。
const first = Object.keys(prev).length === 0;

const already = (name) =>
  data.shopping.some((s) => s.status !== "購入済み" && looseMatch(s.item ?? "", name));

const toAdd = first
  ? []
  : out.filter((p) => prev[p.name] === "ある" && !already(p.name));

console.log(`常備品 ${data.pantry.length} 件 / 切らしている ${out.length} 件`);
for (const p of out) {
  const mark = already(p.name) ? "リストにある" : prev[p.name] === "ある" ? "★今回切らした" : "前から";
  console.log(`  ${p.name}  (${p.why})  ${mark}`);
}

if (first) {
  console.log("初回なので、いまの状態を覚えるだけにします(何も足しません)。");
}
console.log(`買い物リストに足す: ${toAdd.length} 件`);
for (const p of toAdd) console.log(`  + ${p.name}`);

if (!APPLY) {
  console.log("--apply が無いので何も書いていません。");
  process.exit(0);
}

if (toAdd.length) {
  const rows = toAdd.map((p) => ({
    item: p.name,
    qty: "1",
    section: guessSection(p.name),
    reason: `常備品を切らしています(${p.why})`,
    status: "未購入",
  }));
  const PY_ADD = `
import json, sys
sys.path.insert(0, ${JSON.stringify(SKILL)})
import db
rows = json.loads(${JSON.stringify(JSON.stringify(rows))})
got = db.Jisui().insert("shopping_list", rows)
sys.stdout.write(json.dumps([r["item"] for r in got], ensure_ascii=True))
`;
  const r = spawnSync("python", ["-c", PY_ADD], {
    encoding: "utf8",
    env: { ...process.env, PYTHONIOENCODING: "utf-8" },
  });
  if (r.status !== 0) {
    console.error("足せませんでした: " + (r.stderr || "").trim().split("\n").slice(-2).join(" / "));
    process.exit(1);   // 覚え直さない。次にもう一度試す
  }
  console.log("足しました: " + JSON.parse(r.stdout).join("、"));
}

writeFileSync(STATE, JSON.stringify(now, null, 1), "utf8");
