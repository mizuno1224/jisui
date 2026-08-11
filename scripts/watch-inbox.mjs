/*
 * inbox を見張って、チャットが記録を置いた【その場で】アプリに反映する。
 *
 * 【何のためか】
 * チャット(Cowork)はクラウドで動くので Supabase に直接は届かない。
 * 接続済みフォルダの inbox に JSON を置くところまではできるので、
 * それを拾って入れる係を、パソコン側に常駐させる。
 *
 * これが動いていれば、パソコンで Cowork を使っているあいだは
 * 【貼り付けの操作が一切要らない】。置かれて数秒でアプリに出る。
 *
 * 【15分おきに見に行く形にしなかった理由】
 * 「相談して、アプリを見て、確かめる」を1つの流れでやりたい。
 * 最大15分待つのでは、その場で確かめられない。
 * フォルダの変化を待つほうが、待ち時間が無く、動いていない間の負荷も無い。
 *
 * 【使い方】
 *   手で動かす:   node scripts/watch-inbox.mjs
 *   自動で動かす: powershell -ExecutionPolicy Bypass -File scripts/setup-auto-apply.ps1
 *   様子を見る:   ログは下の LOG に追記される
 */

import { spawn } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { watch } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..");
const INBOX = join(homedir(), "家計簿", "inbox");
const LOG = join(homedir(), "jisui-auto-apply.log");
const LOCK = join(homedir(), ".jisui-watch.lock");

/** 書き終わるのを待つ間。ファイルは少しずつ書かれるので、静まってから動く。 */
const SETTLE_MS = 3000;

function log(line) {
  const stamp = new Date().toLocaleString("ja-JP");
  const text = `[${stamp}] ${line}\n`;
  process.stdout.write(text);
  try {
    appendFileSync(LOG, text, "utf8");
  } catch {
    /* ログが書けなくても本体は止めない */
  }
}

// ---------------------------------------------------------------- 二重起動よけ
//
// ログオンのたびに増えていくと、同じファイルを同時に取り込もうとして
// 二重に入りかねない。古い錠は 1 時間で無効とみなす
// (パソコンが強制終了したときに錠が残るため)。
if (existsSync(LOCK)) {
  try {
    const { pid } = JSON.parse(readFileSync(LOCK, "utf8"));
    // 【時間で判断しない】。前の見張りが強制終了されると錠だけが残り、
    // 「まだ動いている」と誤解して新しい見張りが起動しなくなる。実際にそうなった。
    // そのプロセスが本当に生きているかを確かめる。
    // process.kill(pid, 0) は合図を送らずに存在だけ見る書き方。
    if (pid && pid !== process.pid) {
      process.kill(pid, 0);
      log(`すでに動いています(pid ${pid})。このぶんは終わります。`);
      process.exit(0);
    }
  } catch {
    /* いない、または壊れた錠。上書きして続ける */
  }
}
writeFileSync(LOCK, JSON.stringify({ pid: process.pid, mtimeMs: Date.now() }), "utf8");
const releaseLock = () => {
  try {
    unlinkSync(LOCK);
  } catch {
    /* 消せなくても構わない */
  }
};
process.on("exit", releaseLock);
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(sig, () => {
    releaseLock();
    process.exit(0);
  });
}

// ---------------------------------------------------------------- 取り込み

let running = false;
let again = false;
let timer = null;

/** いま取り込むべきファイルがあるか。.error や説明用の .txt は数えない。 */
function pending() {
  if (!existsSync(INBOX)) return 0;
  return readdirSync(INBOX).filter((f) => f.endsWith(".json")).length;
}

function apply(why) {
  if (running) {
    again = true;
    return;
  }
  if (pending() === 0) return;

  running = true;
  log(`取り込みます(${why})`);

  const child = spawn(process.execPath, [join(REPO, "scripts", "apply-inbox.mjs"), "--apply"], {
    cwd: REPO,
    windowsHide: true,
  });

  let out = "";
  child.stdout.on("data", (b) => (out += b.toString("utf8")));
  child.stderr.on("data", (b) => (out += b.toString("utf8")));

  child.on("close", (code) => {
    running = false;
    // まとめの行だけ残す。全文を毎回書くとログが読めなくなる。
    const summary = out
      .split("\n")
      .filter((l) => /適用 \d+ 件|❌|失敗|読めません|入りました/.test(l))
      .slice(0, 12)
      .join(" / ")
      .trim();
    log(summary || `終了(コード ${code})`);
    if (again) {
      again = false;
      setTimeout(() => apply("待っていたぶん"), 500);
    }
  });

  child.on("error", (e) => {
    running = false;
    log(`動かせませんでした: ${e.message}`);
  });
}

function schedule(why) {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    apply(why);
  }, SETTLE_MS);
}

// ---------------------------------------------------------------- 起動

if (!existsSync(INBOX)) {
  mkdirSync(INBOX, { recursive: true });
  log(`inbox が無かったので作りました: ${INBOX}`);
}

log(`見張りを始めます: ${INBOX}`);
log("チャットがここに記録を置くと、数秒でアプリに反映されます。");

// 起動時に1回。パソコンを閉じている間に置かれたぶんを拾う。
apply("起動時の確認");

try {
  watch(INBOX, { persistent: true }, (_event, filename) => {
    if (filename && !String(filename).endsWith(".json")) return;
    schedule(`${filename ?? "変化"} を見つけた`);
  });
} catch (e) {
  log(`見張れませんでした: ${e.message}`);
  log("30秒おきに見に行く形に切り替えます。");
  setInterval(() => apply("定期の確認"), 30_000);
}

// 見張りが取りこぼしたときの保険。5分に1回だけ確かめる。
setInterval(() => apply("念のための確認"), 5 * 60_000);
