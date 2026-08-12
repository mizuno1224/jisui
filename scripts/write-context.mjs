/*
 * いまの在庫・献立・買い物リストを、フォルダの中のファイルに書き出す。
 *
 * 【なぜ要るか】
 * Cowork(クラウド)は Supabase に届かない。403 で、個人プランでは外せない。
 * だから在庫を読めず、「在庫が読めないので推測で提案します」と前置きして
 * 献立を組むことになっていた。推測で組んだ献立は、買い物にも在庫にも合わない。
 *
 * だが Cowork は【つないだフォルダのファイルは読める】。書けることも
 * 一覧できることも実測済み(2026-08-11: device_commit_files / device_list_dir)。
 * ならパソコン側が読める形で書き出しておけばよい。
 *
 *   パソコン ──書く──→ jisui\いまの状況.md ──読む──→ Cowork
 *   Cowork ──置く──→ jisui\inbox\*.json ──取り込む──→ Supabase
 *
 * 往復どちらも、すでに動いている道だけで済む。
 *
 * 【Markdown にする理由】
 * JSON だと Cowork が読んだあと構造を解いて説明することになり、
 * 人が横から見て確かめられない。この家の運用では「置いたものが目に見える」
 * ことを何度も助けにしてきたので、人も読める形にする。
 *
 * 【使い方】
 *   node scripts/write-context.mjs          書き出す
 *   node scripts/write-context.mjs --print  中身を出すだけ(書かない)
 *
 * watch-inbox.mjs が起動時と5分ごとに呼ぶ。
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILL = join(HERE, "..", "cowork", "jisui");
const HOME_DIR = join(homedir(), "jisui");
const OUT = join(HOME_DIR, "いまの状況.md");

// ---------------------------------------------------------------- 取ってくる
//
// 読み方は db.py に任せる。context() の中身を JS 側にも書くと、
// 片方だけ直して食い違う。実際にそれで半日ぶんの記録が別の場所に入った。
const PY = `
import json, sys
sys.path.insert(0, ${JSON.stringify(SKILL)})
import db
sys.stdout.write(json.dumps(db.Jisui().context(), ensure_ascii=True))
`;

function fetchContext() {
  const r = spawnSync("python", ["-c", PY], {
    encoding: "utf8",
    // ensure_ascii=True で出しているので、標準出力の文字コードに左右されない。
    // Windows の既定は cp932 で、日本語をそのまま出すと化けて JSON が壊れる。
    env: { ...process.env, PYTHONIOENCODING: "utf-8" },
  });
  if (r.status !== 0) {
    const why = (r.stderr || "").trim().split("\n").slice(-3).join(" / ");
    throw new Error(`読めませんでした: ${why || `終了コード ${r.status}`}`);
  }
  return JSON.parse(r.stdout);
}

// ---------------------------------------------------------------- 書く形
const nz = (v) => (v === null || v === undefined || v === "" ? "" : String(v));

function table(rows, cols) {
  if (!rows?.length) return "(なし)\n";
  const head = `| ${cols.map((c) => c[0]).join(" | ")} |`;
  const rule = `|${cols.map(() => "---").join("|")}|`;
  const body = rows.map((r) => `| ${cols.map((c) => nz(c[1](r)) || "-").join(" | ")} |`);
  return [head, rule, ...body].join("\n") + "\n";
}

function render(ctx, stamp) {
  const inv = ctx["在庫"] ?? [];
  // 置き場所ごとにまとめる。冷蔵庫の区画そのままなので、扉を開けた順に読める。
  const byLoc = {};
  for (const it of inv) (byLoc[it.location ?? "その他"] ??= []).push(it);
  const order = ["冷蔵", "氷温", "野菜", "冷凍", "常温"];
  const locs = [...order.filter((l) => byLoc[l]), ...Object.keys(byLoc).filter((l) => !order.includes(l))];

  const out = [];
  out.push("# いまの状況");
  out.push("");
  out.push(`**${stamp} 時点**`);
  out.push("");
  out.push("このファイルはパソコンが自動で書き出しています。**手で直しても次の書き出しで消えます。**");
  out.push("");
  out.push("Cowork(クラウド)は Supabase に届かないので、在庫や献立をこのファイルから読んでください。");
  out.push("記録を追加するときは、いつもどおり `inbox` に受け渡し JSON を置くこと。");
  out.push("");
  out.push("---");
  out.push("");

  out.push("## 冷蔵庫と在庫");
  out.push("");
  for (const loc of locs) {
    out.push(`### ${loc}`);
    out.push("");
    out.push(table(byLoc[loc], [
      ["もの", (r) => r.name],
      ["量", (r) => [nz(r.qty), nz(r.unit)].filter(Boolean).join("")],
      ["期限", (r) => r.expiry],
    ]));
  }

  out.push("## これからの献立");
  out.push("");
  out.push(table(ctx["これからの献立"], [
    ["日", (r) => r.date],
    ["いつ", (r) => r.slot],
    ["献立", (r) => r.name],
    ["状態", (r) => r.status],
  ]));

  out.push("## 買い物リスト");
  out.push("");
  out.push(table(ctx["買い物リスト"], [
    ["もの", (r) => r.item],
    ["量", (r) => r.qty],
    ["売場", (r) => r.section],
    ["状態", (r) => r.status],
    ["なぜ", (r) => r.reason],
  ]));

  out.push("## 好み・方針");
  out.push("");
  out.push("**献立を出す前に必ず読むこと。** 苦手なものを出すと、その提案は丸ごと無駄になります。");
  out.push("");
  out.push(table(ctx["好み・方針"], [
    ["種類", (r) => r.kind],
    ["もの", (r) => r.item],
    ["memo", (r) => r.memo],
  ]));

  out.push("## 直近に作ったもの");
  out.push("");
  out.push("**同じものが続かないように見ること。**");
  out.push("");
  out.push(table(ctx["直近の調理"], [
    ["日", (r) => r.date],
    ["作ったもの", (r) => r.name],
    ["評価", (r) => r.rating],
  ]));

  out.push("## 調理器具");
  out.push("");
  out.push("**ここに無い器具を使う手順を書かないこと。**");
  out.push("");
  out.push(table(ctx["調理器具"], [
    ["器具", (r) => r.name],
    ["memo", (r) => r.memo],
  ]));

  const stap = ctx["常備品"] ?? [];
  const nai = stap.filter((s) => s.stock !== "ある");
  out.push("## 常備品");
  out.push("");
  out.push(`ある: ${stap.length - nai.length} 件 / 切れている: ${nai.length} 件`);
  out.push("");
  if (nai.length) {
    out.push("**切れているもの**(これを前提にした手順を書かないこと)");
    out.push("");
    out.push(table(nai, [["もの", (r) => r.name], ["分類", (r) => r.category]]));
  }
  out.push("<details><summary>全部を見る</summary>");
  out.push("");
  out.push(table(stap, [
    ["もの", (r) => r.name],
    ["分類", (r) => r.category],
    ["在庫", (r) => r.stock],
  ]));
  out.push("</details>");
  out.push("");

  return out.join("\n");
}

// ---------------------------------------------------------------- 実行
const stamp = new Date().toLocaleString("ja-JP");
let text;
try {
  text = render(fetchContext(), stamp);
} catch (e) {
  // 【古い内容を消さないこと】
  // 一時的に読めなかっただけで空にすると、Cowork は「在庫は空です」と
  // 受け取って献立を組む。古くても中身がある方が、空よりはるかにましである。
  const keep = existsSync(OUT);
  console.error(`書き出せませんでした: ${e.message}`);
  console.error(keep ? "  前の内容をそのまま残します(空にはしません)。" : "  まだ一度も書けていません。");
  process.exit(keep ? 0 : 1);
}

if (process.argv.includes("--print")) {
  process.stdout.write(text);
  process.exit(0);
}

if (!existsSync(HOME_DIR)) mkdirSync(HOME_DIR, { recursive: true });

// 中身が変わっていなければ書かない。Cowork がフォルダを同期するので、
// 更新時刻だけ動かすと「変わった」と誤解させる。
if (existsSync(OUT)) {
  try {
    if (readFileSync(OUT, "utf8").replace(/^\*\*.*$/m, "") === text.replace(/^\*\*.*$/m, "")) {
      console.log("変わっていないので、そのままにしました。");
      process.exit(0);
    }
  } catch {
    /* 読めなければ書き直す */
  }
}

// 書きかけを読まれないように、別名で書いてから置き換える。
const tmp = OUT + ".tmp";
writeFileSync(tmp, text, "utf8");
renameSync(tmp, OUT);
console.log(`書き出しました: ${OUT}  (${text.length.toLocaleString()} 文字)`);
