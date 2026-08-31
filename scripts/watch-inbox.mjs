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

/*
 * 【取り込み → 常備品 → 書き出し を、この順で1本に並べる】
 *
 * 前は3つを別々に起こしていた。fs.watch は1つのファイルの作成と削除で
 * 何度も鳴るので、取り込みが走っている最中に書き出しが始まる。
 * すると【取り込む前の Supabase】を読んだ内容が いまの状況.md に書かれ、
 * ファイルの更新時刻だけが新しくなる。
 * 2026-08-26 に実際に起きた(適用ログ 08:41 に対し、いまの状況.md も 08:41
 * なのに中身が古い)。読む側からは新しいのか古いのか区別が付かない。
 *
 * 常備品の補充も書き出しより先に置く。買い物リストへ足したぶんが
 * 同じ回の いまの状況.md に載るようにするため。
 *
 * running が立っている間に呼ばれたら、終わってからもう一度だけ回す(again)。
 * 何度呼ばれても溜め込まないので、連続で置かれても空回りしない。
 */
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

/** 子プロセスを1つ起こして、終わるまで待つ。出力(標準・エラーの両方)を返す。 */
function run(args, label) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { cwd: REPO, windowsHide: true });
    let out = "";
    child.stdout.on("data", (b) => (out += b.toString("utf8")));
    child.stderr.on("data", (b) => (out += b.toString("utf8")));
    child.on("close", (code) => resolve({ out, code }));
    child.on("error", (e) => {
      log(`${label}: 動かせませんでした: ${e.message}`);
      resolve({ out: "", code: -1 });
    });
  });
}

/**
 * 取り込み → 常備品 → 書き出し。**必ずこの順で、重ならないように回す。**
 * 取り込むものが無くても、書き出しだけは通る(アプリ側で在庫を直したぶんが
 * チャットに伝わるのは、この道しかない)。
 */
async function cycle(why) {
  if (running) {
    again = true;
    return;
  }
  running = true;
  try {
    if (pending() > 0) await applyAll(why);
    await restockStaples(why);
    // 【いちばん最後】。ここより前に置くと、取り込む前の中身が書かれる。
    await refreshContext(why);
  } catch (e) {
    log(`回している途中で落ちました(${why}): ${e && e.stack ? e.stack : e}`);
  } finally {
    running = false;
    if (again) {
      again = false;
      setTimeout(() => void cycle("待っていたぶん"), 500);
    }
  }
}

async function applyAll(why) {
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

  // 【1つずつ順に】。同時に起こすと同じ控え(applied-keys.json)を
  // 2つのプロセスが読み書きして、あとから書いたほうが前のぶんを消す。
  for (const dir of dirs) {
    const { out, code } = await run(
      [
        join(REPO, "scripts", "apply-inbox.mjs"),
        "--apply",
        `--inbox=${dir}`,
        `--processed=${PROCESSED}`,
        `--ledger=${LEDGER}`,
      ],
      dir,
    );
    // まとめの行だけ残す。全文を毎回書くとログが読めなくなる。
    const summary = out
      .split("\n")
      .filter((l) => /適用 \d+ 件|❌|失敗|読めません|入りました/.test(l))
      .slice(0, 12)
      .join(" / ")
      .trim();
    // どの場所のぶんかを必ず書く。書かないと、詰まっている場所が分からない。
    log(`${dir}: ${summary || `終了(コード ${code})`}`);
  }
}

function schedule(why) {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void cycle(why);
  }, SETTLE_MS);
}

// ---------------------------------------------------------------- 起動

if (!existsSync(INBOX)) {
  mkdirSync(INBOX, { recursive: true });
  log(`inbox が無かったので作りました: ${INBOX}`);
}

log(`見張りを始めます: ${INBOXES.join(" と ")}`);
log("チャットがここに記録を置くと、数秒でアプリに反映されます。");

/*
 * いまの在庫・献立をフォルダに書き出す。
 *
 * 【なぜ見張りがこれをやるか】
 * Cowork(クラウド)は Supabase に届かないので在庫を読めず、
 * 「在庫が読めないので推測で提案します」と前置きして献立を組んでいた。
 * だがフォルダのファイルは読める。だからパソコン側が書いておけばよい。
 * 取り込みと同じ息づかいで動かすのが自然なので、ここに置く。
 * 中身が変わっていなければ書かないので、空回りしても害は無い。
 */
// 【重ねて動かさないのは cycle() の running が受け持つ】。
// ここでは待てる形にしておくだけ。旗を2つに分けると、片方だけ下り損ねて
// 「黙って古い中身を出し続ける」状態になる(前はそうなっていた)。
async function refreshContext(why) {
  const { out } = await run([join(REPO, "scripts", "write-context.mjs")], "いまの状況");
  const line = out.trim().split("\n").filter(Boolean).pop();
  // 「変わっていない」は毎回出るのでログに残さない。ログが読めなくなる。
  if (line && !line.includes("変わっていない")) log(`いまの状況(${why}): ${line}`);
}

/*
 * 常備品を切らしていないか見て、切らしたぶんを買い物リストに足す。
 *
 * 常備品は「いつも家にあるもの」として買い物リストから除かれる決まりなので、
 * 切らしたときに気づく道が無かった。牛乳を切らしてもレシピ画面は
 * 灰色の「常備品」の札を出すだけで、買い物リストには出ない。
 * 詳しくは scripts/restock-staples.mjs の頭を読むこと。
 */
async function restockStaples(why) {
  const { out } = await run(
    ["--experimental-strip-types", join(REPO, "scripts", "restock-staples.mjs"), "--apply"],
    "常備品",
  );
  // 足したときだけ書く。「0 件」を毎回書くとログが読めなくなる。
  const line = out.split("\n").find((l) => l.startsWith("足しました:"));
  if (line) log(`常備品(${why}): ${line}`);
  const err = out.split("\n").find((l) => l.startsWith("足せませんでした"));
  if (err) log(`常備品(${why}): ${err}`);
}

// 起動時に1回。パソコンを閉じている間に置かれたぶんを拾う。
void cycle("起動時");

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
  setInterval(() => void cycle("定期の確認"), 30_000);
}

try {
  for (const dir of INBOXES) {
    if (!existsSync(dir)) continue;
    const w = watch(dir, { persistent: true }, (_event, filename) => {
      const name = filename ? String(filename) : "";

      /*
       * 【チャットからの「いま更新して」】
       *
       * いまの状況.md は5分ごとに書き直している。だがアプリで在庫を直した
       * 直後にチャットへ聞くと、最大5分前の中身を読むことになる。
       * チャットは Supabase に届かないので、自分で取りに行けない。
       *
       * ただしチャットは【このフォルダに書ける】。そこで、
       * 「更新して」という名前のファイルを置くことを合図にする。
       * 新しい権限も、新しい通信の道も要らない。置いたら数秒で書き直す。
       * 合図のファイルはこちらで消す(残すと毎回反応してしまう)。
       */
      if (name.includes("更新して")) {
        try {
          unlinkSync(join(dir, name));
        } catch {
          /* もう消えていることがある */
        }
        // 取り込みと同じ列に並べる。別に起こすと、取り込みの途中の
        // Supabase を読んだ内容が いまの状況.md に書かれる。
        schedule("チャットからの求め");
        return;
      }

      if (name && !name.endsWith(".json")) return;
      schedule(`${name || "変化"} を見つけた`);
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
  // 取り込み → 常備品 → 書き出し を1本で回す。
  // アプリで在庫をいじったぶんが、遅くとも5分でチャットに伝わる。
  void cycle("5分ごと");
  try {
    writeFileSync(LOCK, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }));
  } catch {
    /* 錠が書けなくても本体は止めない */
  }
}, 5 * 60_000);
