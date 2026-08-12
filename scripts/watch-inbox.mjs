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
/*
 * 見張る場所。
 *
 * 【新旧どちらも見る】
 * 受け渡し場所を 家計簿\inbox から jisui\inbox へ移した(2026-08-11)。
 * Cowork の接続先を変え忘れると、古いほうに置かれて誰も見ないことになる。
 * 記録がどこにも届かない事故は一度起こしているので、両方を見張る。
 * 古いほうに何も来なくなったら、そのとき初めて外す。
 */
const INBOXES = [
  join(homedir(), "jisui", "inbox"),
  join(homedir(), "家計簿", "inbox"),
].filter((p, i) => i === 0 || existsSync(p));
const INBOX = INBOXES[0];

/*
 * 取り込み済みの控えと、済んだファイルの置き場所。
 *
 * 【必ず本家のぶんを使う】
 * apply-inbox.mjs は、渡された inbox の隣に processed/ と applied-keys.json を作る。
 * 試すときに本番の控えを汚さないための作りで、それ自体は正しい。
 * だが古い inbox から取り込むとき、そのままだと控えが古い場所に別に作られる。
 * 控えが 2 つに分かれると、同じ記録が二重に入る。
 * どの場所から取り込んでも、控えは 1 つでなければならない。
 */
const HOME_DIR = dirname(INBOX);
const PROCESSED = join(HOME_DIR, "processed");
const LEDGER = join(HOME_DIR, "applied-keys.json");
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
  let n = 0;
  for (const dir of INBOXES) {
    if (!existsSync(dir)) continue;
    n += readdirSync(dir).filter((f) => f.endsWith(".json")).length;
  }
  return n;
}

function apply(why) {
  if (running) {
    again = true;
    return;
  }
  if (pending() === 0) return;

  running = true;
  log(`取り込みます(${why})`);

  /*
   * 【記録のある場所を、ひとつ残らず回す】
   *
   * 前は「最初に .json が見つかった場所」だけを取り込んでいた。
   * これだと、取り込めないファイルが1つ居座った場所があると、
   * そこが毎回選ばれ続け、もう片方の場所は永久に読まれない。
   * 取り込みに失敗したファイルは .json のまま inbox に残る作りなので、
   * 1件詰まるだけでそうなる。ログには「残り 1 件」としか出ず、
   * もう1つの場所が丸ごと無視されていることに気づけない。
   *
   * 控えと processed/ は、どこから取り込んでも本家のぶんを使う。
   * 分かれると同じ記録が二重に入る(上の注記のとおり)。
   * 場所によって渡したり渡さなかったりせず、いつも明示で渡す。
   */
  const dirs = INBOXES.filter(
    (d) => existsSync(d) && readdirSync(d).some((f) => f.endsWith(".json")),
  );

  const done = () => {
    running = false;
    if (again) {
      again = false;
      setTimeout(() => apply("待っていたぶん"), 500);
    }
  };

  const runNext = (i) => {
    if (i >= dirs.length) return done();
    const dir = dirs[i];
    const child = spawn(
      process.execPath,
      [
        join(REPO, "scripts", "apply-inbox.mjs"),
        "--apply",
        `--inbox=${dir}`,
        `--processed=${PROCESSED}`,
        `--ledger=${LEDGER}`,
      ],
      { cwd: REPO, windowsHide: true },
    );

    let out = "";
    child.stdout.on("data", (b) => (out += b.toString("utf8")));
    child.stderr.on("data", (b) => (out += b.toString("utf8")));

    child.on("close", (code) => {
      // まとめの行だけ残す。全文を毎回書くとログが読めなくなる。
      const summary = out
        .split("\n")
        .filter((l) => /適用 \d+ 件|❌|失敗|読めません|入りました/.test(l))
        .slice(0, 12)
        .join(" / ")
        .trim();
      // どの場所のぶんかを必ず書く。書かないと、詰まっている場所が分からない。
      log(`${dir}: ${summary || `終了(コード ${code})`}`);
      runNext(i + 1);
    });

    child.on("error", (e) => {
      log(`${dir}: 動かせませんでした: ${e.message}`);
      runNext(i + 1);
    });
  };

  runNext(0);
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

log(`見張りを始めます: ${INBOXES.join(" と ")}`);
log("チャットがここに記録を置くと、数秒でアプリに反映されます。");

// 起動時に1回。パソコンを閉じている間に置かれたぶんを拾う。
apply("起動時の確認");

/*
 * 【黙って死なせない】
 *
 * この常駐は窓を出さずに動いている(setup-auto-apply.ps1 が 0 で起動する)。
 * 落ちても画面には何も出ないし、終了時に錠も消えるので、
 * 「動いていない」ことにすら気づけない。人が気づくのは
 * 「置いたのに反映されない」と思ったときで、そのときには手がかりが無い。
 *
 * fs.watch はフォルダの名前が変わる・消える・弾かれると、あとから
 * 'error' を投げてくる。下の try/catch は watch() がその場で投げたぶんしか
 * 受け止められないので、返ってきた見張り役ごとに受け口を付ける。
 */
let fellBack = false;
function fallbackToPolling(why) {
  if (fellBack) return;
  fellBack = true;
  log(`${why} 30秒おきに見に行く形に切り替えます。`);
  setInterval(() => apply("定期の確認"), 30_000);
}

try {
  for (const dir of INBOXES) {
    if (!existsSync(dir)) continue;
    const w = watch(dir, { persistent: true }, (_event, filename) => {
      if (filename && !String(filename).endsWith(".json")) return;
      schedule(`${filename ?? "変化"} を見つけた`);
    });
    w.on("error", (e) => {
      log(`見張りが壊れました(${dir}): ${e.message}`);
      fallbackToPolling("");
    });
  }
} catch (e) {
  log(`見張れませんでした: ${e.message}`);
  fallbackToPolling("");
}

// 何を取りこぼしても、必ずログに書いてから終わる。
// 書かずに落ちるのがいちばん困る。
process.on("uncaughtException", (e) => {
  log(`落ちました: ${e && e.stack ? e.stack : e}`);
  process.exit(1);
});
process.on("unhandledRejection", (e) => {
  log(`受け止め損ねました: ${e && e.stack ? e.stack : e}`);
});

// 見張りが取りこぼしたときの保険。5分に1回だけ確かめる。
// あわせて錠に時刻を書き直す。人が「錠の時刻が5分以上前なら死んでいる」と
// 1行で判定できるようにするため。
setInterval(() => {
  apply("念のための確認");
  try {
    writeFileSync(LOCK, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }));
  } catch {
    /* 錠が書けなくても本体は止めない */
  }
}, 5 * 60_000);
