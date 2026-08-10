/**
 * inbox に置かれた「受け渡し JSON」を Supabase に適用する。
 *
 *   node scripts/apply-inbox.mjs           … 下見。何を入れるつもりかを1件ずつ並べるだけ。【何も書かない】
 *   node scripts/apply-inbox.mjs --apply   … 実際に入れて、済んだファイルを processed/ へ移す
 *
 * ------------------------------------------------------------
 * 何のためにあるか
 * ------------------------------------------------------------
 * チャット(Cowork)はクラウドで動いていて、外に出られる宛先が決まっている。
 * Supabase はその中に入っていない。【実測で確定済み。Vercel に中継を置いても
 * 同じ壁に当たるので成立しない。】だから会話の内容をその場では書き込めない。
 *
 * そこで cowork/jisui/db.py は、届かなかったときに例外を投げて終わりにせず、
 * 「何を書けば復旧できるか」を JSON にして返す(db.py:174-210 の JisuiOffline)。
 * チャットはそれを C:\Users\mmizu\家計簿\inbox\ に置く。そこだけは
 * チャットからファイルとして読み書きできるため。
 *
 * このスクリプトは、その JSON を【つながる場所=このパソコン】で流し込む係。
 * つまり「チャットが話を聞いた」と「Supabase に入った」の間の橋渡しで、
 * 橋を渡すまで記録は inbox に見える形で残る。
 *
 * ------------------------------------------------------------
 * 書き込むのは db.py 自身にやらせる(ここでは PostgREST を直接叩かない)
 * ------------------------------------------------------------
 * JSON の args は db.py のメソッドの引数そのままで、SKILL.md には
 * 「適用する側は j.add_receipt(**args) と呼ぶだけ」と書いてある。
 * だから Node からは python を起こして db.py を呼ぶ。scripts/migrate-kakeibo.mjs と
 * scripts/import-0809.mjs が sqlite を python 経由で読んでいるのと同じ流儀。
 *
 * こうする理由は2つ。
 *   1. 接続情報を二重に持たない。db.py の _load_config() が
 *      環境変数 → cowork/jisui/.env → cowork/jisui/cowork.json の順で読む(db.py:323-404)。
 *      ここで読み直すと、片方だけ直したときに黙って別の場所へ書く事故が起きる
 *   2. 入れ方の作法を二重に持たない。add_receipt の重複よけ、add_todo の子タスク、
 *      add_event のタグ解決は db.py にしかない。Node で書き直せば必ずずれる
 *
 * ------------------------------------------------------------
 * 同じ JSON を2回適用しても増えない仕掛け(4つ、上から順に効く)
 * ------------------------------------------------------------
 *   1. 済んだファイルは processed/ へ移す。inbox から消えるのでもう読まれない
 *   2. 適用できた record の key を applied-keys.json に控える。
 *      key は sha256(op|args) で【時刻が入っていない】(db.py:223-232)。
 *      同じ内容なら必ず同じ key になるので、同じものが再度置かれても飛ばせる
 *   3. レシートとカード明細は DB 側にも unique(household_id, dedup_hash) がある
 *      (supabase/04_schema_kakeibo.sql:34)。控えを失っても二重計上にはならない
 *   4. 1件でも失敗したファイルは processed/ へ移さない。次回は 2 のおかげで
 *      成功したぶんを飛ばし、失敗したぶんだけをやり直す
 *
 * 【買い物・予定・やること・insert は DB 側に守りが無い】。守っているのは 1 と 2 だけ。
 * だから applied-keys.json は消さないこと。消すと、processed/ から戻した
 * ファイルや同じ内容の JSON がもう一度入る。
 *
 * key に時刻が入っていない副作用として、**まったく同じ操作を2回したいときは
 * 2回目が飛ばされる**(同じ日に同じ店・同じ金額のレシート2枚など)。
 * これは「二重に入れない」を優先した結果で、db.py 側の決めごと。
 * 本当に2件あるなら memo や reason を変えて別物にする。
 *
 * ------------------------------------------------------------
 * 対象にしないもの
 * ------------------------------------------------------------
 * inbox の CSV(カード明細)はこのスクリプトの担当ではない。
 * db.py の import_card_csv が読む(SKILL.md「カード明細の CSV を取り込む」)。
 * ここで扱うのは *.json だけ。
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

// db.py のあるところ。ここが正本(README「cowork/jisui/ が正本です」)。
// ~/.claude/skills/jisui は scripts/sync-skill.ps1 で配った写しなので見ない。
const SKILL_DIR = resolve(HERE, "..", "cowork", "jisui");

// 受け渡し場所の既定値。db.py:161 の INBOX_DIR と同じ値を書いてある。
// 【食い違ったら黙って別の場所を見ないよう、起動時に db.py の値と突き合わせる】。
const DEFAULT_INBOX = String.raw`C:\Users\mmizu\家計簿\inbox`;

const LEDGER_KIND = "jisui-inbox-ledger";
const LEDGER_VERSION = 1;

// ============================================================
// 引数
// ============================================================

const KNOWN_FLAGS = ["--apply", "--review-unknown", "--help", "-h"];
const KNOWN_OPTIONS = ["inbox", "processed", "ledger"];

const argv = process.argv.slice(2);

function die(msg) {
  process.stderr.write(`中断: ${msg}\n`);
  process.exit(1);
}

for (const a of argv) {
  if (!a.startsWith("--") && a !== "-h") die(`知らない引数です: ${a}`);
  const name = a.slice(2).split("=")[0];
  if (KNOWN_FLAGS.includes(a) || KNOWN_OPTIONS.includes(name)) continue;
  // 打ち間違いを黙って無視すると、--aply のつもりで下見だけして
  // 「入ったはず」と思い込む。止めたほうがよい。
  die(`知らない引数です: ${a}\n  使えるのは ${KNOWN_FLAGS.join(" ")} と ${KNOWN_OPTIONS.map((o) => `--${o}=…`).join(" ")}`);
}

if (argv.includes("--help") || argv.includes("-h")) {
  process.stdout.write(
    [
      "inbox の受け渡し JSON を Supabase に適用する。",
      "",
      "  node scripts/apply-inbox.mjs            下見。何も書かない",
      "  node scripts/apply-inbox.mjs --apply    実際に入れて processed/ へ移す",
      "",
      "  --review-unknown  カード明細で分類辞書に無い店を「要確認」として入れる",
      "                    (既定はその行だけ失敗にして止める。費目を推測しないため)",
      "  --inbox=…         受け渡し JSON を読む場所(既定 " + DEFAULT_INBOX + ")",
      "  --processed=…     済んだファイルを移す場所(既定 inbox の隣の processed)",
      "  --ledger=…        適用済みの鍵を控える場所(既定 inbox の親の applied-keys.json)",
      "",
    ].join("\n"),
  );
  process.exit(0);
}

const APPLY = argv.includes("--apply");
const REVIEW_UNKNOWN = argv.includes("--review-unknown");

const option = (name, fallback) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

const INBOX = resolve(option("inbox", DEFAULT_INBOX));
// 既定の移動先・控えの置き場所は inbox から決める。--inbox で試すときに
// 本番の processed/ や控えを触らないようにするため(db.py:1779-1784 と同じ考え方)。
const PROCESSED = resolve(option("processed", join(dirname(INBOX), "processed")));
const LEDGER = resolve(option("ledger", join(dirname(INBOX), "applied-keys.json")));

// ============================================================
// python 側。db.py を読み込んで、鍵の計算と実際の書き込みを行う。
//
// 【この文字列は JS のテンプレートリテラルの中にある】。
// python の文字列に改行を書きたいときは \\n と二重にすること。
// 素の \n は JS がここで本物の改行に変えてしまい、python が構文エラーになる。
// ============================================================

const PY = `
import json, sys

sys.path.insert(0, ${JSON.stringify(SKILL_DIR)})


def out(obj):
    # ensure_ascii=True は必須。Windows の標準出力は既定が cp932 で、
    # 日本語をそのまま出すと化けて JSON として読めなくなる
    # (scripts/migrate-kakeibo.mjs:19-24 と同じ理由)。
    sys.stdout.write(json.dumps(obj, ensure_ascii=True) + "\\n")
    sys.stdout.flush()   # 途中で落ちても、そこまでの結果は Node 側に届く


def apply_one(j, db, op, args, state, review_unknown):
    """1件を Supabase に入れる。返り値は (人が読む結果, すでに入っていたか)。"""
    if op == "add_receipt":
        r = j.add_receipt(**args)
        if r.get("skipped"):
            return ("すでに同じ 日付・金額・店名 の支出がある(transactions id=%s)"
                    % r["transaction"]["id"], True)
        n = len(r.get("inventory") or [])
        return ("transactions id=%s%s" % (r["transaction"]["id"],
                                          ("・在庫 %d 件" % n) if n else ""), False)

    if op == "add_shopping":
        rows = j.add_shopping(args["items"])
        return ("買い物リストに %d 件" % len(rows), False)

    if op == "add_event":
        r = j.add_event(**args)
        return ("events id=%s" % r.get("id"), False)

    if op == "add_todo":
        r = j.add_todo(**args)
        return ("todos id=%s(子タスク %d 件)"
                % (r["todo"]["id"], len(r.get("subtasks") or [])), False)

    if op == "add_rule":
        j.add_rule(**args)
        return ("分類辞書に「%s」→ %s" % (args.get("keyword"), args.get("category")), False)

    if op == "insert":
        rows = j.insert(args["table"], args["rows"])
        return ("%s に %d 行" % (args["table"], len(rows)), False)

    if op == "import_card_row":
        return import_card_row(j, db, args, state, review_unknown)

    raise ValueError("知らない操作です: %r。使えるのは SKILL.md の表にあるものだけ。" % (op,))


def import_card_row(j, db, args, state, review_unknown):
    """
    カード明細の1行。**費目はここで初めて決まる。**

    書き出した時点(チャット側)では分類辞書 expense_rules を読めなかった。
    辞書を引くには接続が要るから。SKILL.md にも「辞書を引くのは、つながる場所に
    着いてから」と書いてある。ここが【つながる場所】。
    AI が費目を推測して入れると辞書と食い違い、月ごとの比較が意味を失う。
    """
    for k in ("date", "amount", "merchant_raw"):
        if args.get(k) is None:
            raise ValueError("カード明細の行に %s がありません" % k)

    if state.get("rules") is None:
        state["rules"] = j.rules()      # 辞書は1回だけ取る(行数ぶん往復しない)
    merchant = args["merchant_raw"]
    category = j.match_rule(state["rules"], merchant)
    if category is None:
        if not review_unknown:
            raise ValueError(
                "分類辞書に無い店です: %s\\n"
                "  費目を決めて add_rule(キーワード, 費目) で辞書に足してから、\\n"
                "  もう一度 --apply で実行してください(入ったぶんは飛ばします)。\\n"
                "  今すぐ決められないときは --review-unknown を付けると「要確認」で入ります。"
                % merchant)
        category = "要確認"

    digest = j.dedup_hash(args["date"], args["amount"], merchant)
    if j.select("transactions", "id", dedup_hash="eq." + digest):
        return ("すでに入っている(dedup_hash が同じ)", True)

    row = {
        "date": args["date"],
        "amount": args["amount"],
        "merchant_raw": merchant,
        "merchant_norm": args.get("merchant_norm"),
        "category": category,
        # source は not null(supabase/04_schema_kakeibo.sql:28)。
        # 明細から読めていれば「楽天カード」などが入っている。
        "source": args.get("source") or "カード明細",
        "memo": args.get("memo"),
        "dedup_hash": digest,
        # 「要確認」はレシートと重なっている見込みの行。人が見るまで印を残す
        # (db.py:1735-1736 と同じ扱い)。
        "needs_review": category == "要確認",
    }
    got = j.insert("transactions", [row])
    return ("transactions id=%s(費目 %s)" % (got[0]["id"], category), False)


def main():
    payload = json.loads(sys.stdin.buffer.read().decode("utf-8"))
    mode = payload.get("mode")
    records = payload.get("records") or []

    import db      # 読み込むだけでは通信しない。接続は Jisui() を作ったとき

    if mode == "keys":
        # 下見でも本番でも、まずここを通る。
        # 【鍵の計算を db.py にやらせる】。JS で書き直すと、同じ内容から
        # 違う鍵が出た瞬間に二重適用よけが効かなくなる。
        cfg = db._load_config()          # 足りなければ JisuiError。通信はしない
        keys = []
        for i, r in enumerate(records):
            rec = db._handoff_record(r.get("op"), r.get("args") or {})
            keys.append(rec["key"])
        out({
            "type": "設定",
            "inbox": db.INBOX_DIR,
            "skill_version": db.SKILL_VERSION,
            "handoff_kind": db.HANDOFF_KIND,
            "handoff_version": db.HANDOFF_VERSION,
            # 鍵そのものは秘密ではないが、接続の鍵(JISUI_SUPABASE_KEY)は出さない。
            "url": cfg["JISUI_SUPABASE_URL"],
            "email": cfg["JISUI_EMAIL"],
            "keys": keys,
        })
        return 0

    if mode != "apply":
        out({"type": "失敗", "error": "mode が keys でも apply でもありません: %r" % (mode,)})
        return 2

    try:
        j = db.Jisui()
    except Exception as e:
        # ここで落ちるのは「つながらない」「接続情報が違う」のどちらか。
        # 1件も書いていないので、Node 側は inbox に手を触れずに終わる。
        out({"type": "接続失敗", "error": str(e)})
        return 2
    out({"type": "接続", "household_id": j.household_id, "skill_version": db.SKILL_VERSION})

    state = {"rules": None}
    review_unknown = bool(payload.get("review_unknown"))
    for r in records:
        key = r.get("key")
        try:
            summary, skipped = apply_one(
                j, db, r.get("op"), r.get("args") or {}, state, review_unknown)
            out({"type": "結果", "key": key, "ok": True, "skipped": skipped, "summary": summary})
        except db.JisuiOffline as e:
            # 途中で通信が切れた。残りを1件ずつ試しても同じ失敗が並ぶだけなので止める。
            # 【まだ試していない】ことを Node に伝え、失敗として数えさせない。
            out({"type": "中断", "key": key, "error": str(e)})
            return 3
        except Exception as e:
            # 1件の失敗で全部を止めない。次の record へ進む。
            out({"type": "結果", "key": key, "ok": False, "error": str(e)})
    return 0


try:
    sys.exit(main())
except SystemExit:
    raise
except Exception as e:
    # 例外の本文に日本語が入る。traceback をそのまま出すと cp932 で化けるので、
    # JSON(ASCII エスケープ済み)にして出す。
    out({"type": "失敗", "error": "%s: %s" % (type(e).__name__, e)})
    sys.exit(2)
`;

/** python を起こして NDJSON を受け取る。落ちても、そこまでの行は読む。 */
function runPython(payload) {
  const res = spawnSync("python", ["-c", PY], {
    input: Buffer.from(JSON.stringify(payload), "utf8"),
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    env: {
      ...process.env,
      // 例外の本文に日本語が入る。stderr が cp932 だと、その途中で
      // UnicodeEncodeError になって本当の原因が読めなくなる。
      PYTHONIOENCODING: "utf-8",
    },
  });
  if (res.error) die(`python を起動できませんでした: ${res.error.message}\n  python が PATH にあるか確かめてください`);

  const lines = [];
  for (const line of (res.stdout || "").split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      lines.push(JSON.parse(line));
    } catch {
      // 途中で殺されると最後の行が欠けることがある。そこだけ捨てて、他は使う。
      process.stderr.write(`※ python の出力を1行読めませんでした(無視します): ${line.slice(0, 120)}\n`);
    }
  }
  return { lines, status: res.status, stderr: res.stderr || "" };
}

// ============================================================
// 適用済みの控え(applied-keys.json)
// ============================================================

function readLedger() {
  if (!existsSync(LEDGER)) return { kind: LEDGER_KIND, version: LEDGER_VERSION, applied: {} };
  let data;
  try {
    data = JSON.parse(readFileSync(LEDGER, "utf8"));
  } catch (e) {
    // 【空の控えで始めない】。壊れたまま進めると、済んだものを全部もう一度入れる。
    die(`適用済みの控えを読めませんでした: ${LEDGER}\n  ${e.message}\n  直すか、中身を確かめてから退けてください。空のまま進めると二重に入ります。`);
  }
  if (data?.kind !== LEDGER_KIND) die(`${LEDGER} は適用済みの控えではないようです(kind が違う)。`);
  if (!data.applied || typeof data.applied !== "object") die(`${LEDGER} に applied がありません。`);
  return data;
}

function writeLedger(ledger) {
  // 書いている途中で落ちると控えが壊れ、次回に全部やり直すことになる。
  // 別名で書いてから置き換える(Windows の rename は上書きになる)。
  const tmp = `${LEDGER}.tmp`;
  writeFileSync(tmp, JSON.stringify(ledger, null, 2) + "\n", "utf8");
  renameSync(tmp, LEDGER);
}

// ============================================================
// 表示のための道具
// ============================================================

/**
 * 消せなくても止まらない。
 * 消すのは .error(前回の言い分)だけで、記録そのものではない。
 * エディタで開いていて消せないことがあるが、それで取り込み全体を落とすと
 * 「どこまで入ったのか」を出す前に終わってしまう。
 *
 * 【rmSync を使わないこと】。この環境(Node 24 / Windows 11)では、
 * 名前に日本語が入ったファイルに rmSync を使うと、例外も出さずに
 * プロセスごと落ちる(終了コード 127)。実測で確かめた。
 * unlinkSync なら同じ名前でも消せる。ファイル1つを消すだけなので、
 * そもそも unlinkSync のほうが用途に合っている。
 */
function removeQuietly(path) {
  try {
    unlinkSync(path);
    return true;
  } catch (e) {
    process.stderr.write(`※ ${path} を消せませんでした(そのままにします): ${e.message}\n`);
    return false;
  }
}

const yen = (v) => (typeof v === "number" ? `${v.toLocaleString("ja-JP")}円` : `${v}`);
const plain = (v) => v !== null && v !== undefined && typeof v === "object" && !Array.isArray(v);
const cut = (s, n) => (s.length > n ? `${s.slice(0, n)}…` : s);

/**
 * 1件が何をするつもりなのかを日本語で書く。**下見の主役**。
 * ここに出ていないことは起きない、と読めるだけの情報を出す。
 */
/**
 * 下見の文面づくりで落ちても、取り込み全体を巻き添えにしない。
 *
 * 【例外を素通しさせない理由】
 * --apply では、控えを書いたあと・processed へ移す前にこれを通る。
 * 素通しすると「DB には入り控えもあるのに、ファイルが1つも片付かない」状態で固まり、
 * 次回以降も同じ場所で落ちて inbox が永久に詰まる。
 * そこで人は控えを消したくなる —— それが最悪の二重適用につながる。
 */
function describeSafe(op, args) {
  try {
    return describe(op, args);
  } catch (e) {
    return {
      title: `【中身を読めません】${op}`,
      why: [
        `下見の組み立てで失敗: ${e.message}`,
        `args: ${JSON.stringify(args ?? null).slice(0, 200)}`,
      ],
    };
  }
}

function describe(op, args) {
  const a = plain(args) ? args : {};
  const why = [];
  const push = (s) => s && why.push(s);

  if (op === "add_receipt") {
    const items = Array.isArray(a.items) ? a.items : [];
    const inv = Array.isArray(a.inventory) ? a.inventory : [];
    push(`出どころ: ${a.source ?? "レシート"}`);
    if (items.length) {
      const head = items.slice(0, 5).map((i) => `${i.item}${i.price != null ? ` ${yen(i.price)}` : ""}`);
      push(`品目 ${items.length} 件: ${head.join(" / ")}${items.length > 5 ? " ほか" : ""}`);
    }
    if (inv.length) {
      const head = inv.slice(0, 5).map((i) => `${i.name}${i.qty != null ? ` ${i.qty}${i.unit ?? ""}` : ""}`);
      push(`在庫にも入れる ${inv.length} 件: ${head.join(" / ")}${inv.length > 5 ? " ほか" : ""}`);
    }
    push(a.memo ? `memo: ${a.memo}` : null);
    push(a.needs_review ? "「重複確認が必要」の印を立てる" : null);
    push("同じ 日付・金額・店名 が既にあれば入れない(dedup_hash で照合)");
    return {
      title: `レシートを1件入れる: ${a.date} ${a.merchant_raw} ${yen(a.amount)}(${a.category ?? "食費"})`,
      why,
    };
  }

  if (op === "add_shopping") {
    const items = Array.isArray(a.items) ? a.items : [];
    for (const i of items.slice(0, 10)) {
      const bits = [i.item];
      if (i.qty) bits.push(String(i.qty));
      const tail = [i.section ? `売り場: ${i.section}` : null, i.reason ? `理由: ${i.reason}` : null]
        .filter(Boolean)
        .join(" / ");
      push(`・${bits.join(" ")}${tail ? `(${tail})` : ""}`);
    }
    if (items.length > 10) push(`・ほか ${items.length - 10} 件`);
    push("状態は「未購入」。並び順は今ある一番下の次に付ける");
    return { title: `買い物リストに ${items.length} 件足す`, why };
  }

  if (op === "add_event") {
    const time = a.all_day ? "終日" : [a.start_time, a.end_time].filter(Boolean).join("〜");
    push(a.end_date ? `${a.date} から ${a.end_date} まで` : null);
    push(a.location ? `場所: ${a.location}` : null);
    push(a.items ? `持ち物: ${cut(String(a.items).replace(/\n/g, " / "), 80)}` : null);
    push(a.url ? `URL: ${a.url}` : null);
    push(a.notify_min != null ? `${a.notify_min} 分前に通知(記録するだけ。まだ鳴らない)` : null);
    push(a.tag != null ? `タグ: ${a.tag}(非公開タグなら自分にしか見えなくなる)` : null);
    push(a.mine ? "「自分の用事」の札を付ける(見える範囲はタグで決まる)" : null);
    push(a.repeat && a.repeat !== "なし" ? `繰り返し: ${a.repeat}${a.repeat_until ? `(${a.repeat_until} まで)` : ""}` : null);
    push(a.memo ? `memo: ${cut(String(a.memo), 80)}` : null);
    return { title: `予定を1件足す: ${a.date}${time ? ` ${time}` : ""} ${a.title}`, why };
  }

  if (op === "add_todo") {
    const subs = Array.isArray(a.subtasks) ? a.subtasks : [];
    push(a.due_date ? `期限: ${a.due_date}` : "期限なし");
    push(a.assignee ? `担当: ${a.assignee}` : null);
    push(a.parent_id != null ? `やること id=${a.parent_id} の子として作る` : null);
    push(a.repeat ? `繰り返し: ${a.repeat}` : null);
    push(a.detail ? `詳細: ${cut(String(a.detail), 80)}` : null);
    if (subs.length) push(`子タスク ${subs.length} 件: ${subs.slice(0, 6).join(" / ")}${subs.length > 6 ? " ほか" : ""}`);
    return { title: `やることを1件足す: ${a.title}`, why };
  }

  if (op === "add_rule") {
    push("これ以降のカード明細は、この規則で費目が決まる");
    push("同じキーワードが既にあっても止めない(辞書は長いキーワードが先に当たる)");
    push(a.note ? `覚書: ${a.note}` : null);
    return { title: `分類辞書に足す: 「${a.keyword}」→ ${a.category}`, why };
  }

  if (op === "insert") {
    const rows = Array.isArray(a.rows) ? a.rows : [];
    for (const r of rows.slice(0, 3)) push(`・${cut(JSON.stringify(r), 160)}`);
    if (rows.length > 3) push(`・ほか ${rows.length - 3} 行`);
    push("household_id はここで足す(受け渡し JSON には入っていない)");
    return { title: `${a.table} に ${rows.length} 行そのまま入れる`, why };
  }

  if (op === "import_card_row") {
    push(`出どころ: ${a.source ?? "(不明)"}`);
    push("費目はここで分類辞書を引いて決める。書き出した時点では辞書を読めなかった");
    push(
      REVIEW_UNKNOWN
        ? "辞書に無い店は費目「要確認」で入れる(--review-unknown を付けたため)"
        : "辞書に無い店なら、この行は入れずに失敗にする(費目を推測しないため)",
    );
    push(a.memo ? `memo: ${a.memo}` : null);
    push("同じ 日付・金額・店名 が既にあれば入れない(dedup_hash で照合)");
    return { title: `カード明細を1行入れる: ${a.date} ${a.merchant_raw} ${yen(a.amount)}`, why };
  }

  return {
    title: `【知らない操作】${op}`,
    why: [
      "SKILL.md の「使える op」の表にない操作です。適用すると失敗します。",
      `args: ${cut(JSON.stringify(args ?? null), 200)}`,
    ],
  };
}

// ============================================================
// inbox を読む
// ============================================================

if (!existsSync(INBOX)) die(`受け渡し場所がありません: ${INBOX}`);

const entries = readdirSync(INBOX, { withFileTypes: true }).filter((e) => e.isFile());
const jsonNames = entries
  .map((e) => e.name)
  .filter((n) => n.toLowerCase().endsWith(".json"))
  .sort();                       // ファイル名の先頭が UTC の時刻なので、名前順=書かれた順
const csvCount = entries.filter((e) => e.name.toLowerCase().endsWith(".csv")).length;

/** ファイル1つ = { name, path, note, records[], problem } */
const files = [];
for (const name of jsonNames) {
  const path = join(INBOX, name);
  const file = { name, path, note: null, records: [], problem: null };
  files.push(file);
  let data;
  try {
    /*
     * 【なぜバイト列から読むか】
     * db.py の handoff() は日本語をそのまま出す。置く側が cp932 で保存すると、
     * Node の "utf8" は例外を出さずに U+FFFD へ置き換える。
     * JSON の構造は ASCII なので JSON.parse は通ってしまい、
     * 化けた店名が重複よけの鍵ごと Supabase に入る。
     * しかも化けた店名は正しい店名と別の鍵になるので、入れ直せば二重にもなる。
     * 「読めなかったことに気づけない読み方をしない」が要点。
     */
    const raw = readFileSync(path);
    const hasBom = raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf;
    const text = (hasBom ? raw.subarray(3) : raw).toString("utf8");
    if (text.includes("\uFFFD")) {
      file.problem =
        "文字が化けています(UTF-8 として読めないバイトがありました)。\n" +
        "    cp932(Shift-JIS)で保存された可能性があります。UTF-8 で保存し直してください。\n" +
        "    PowerShell から書くなら Set-Content ... -Encoding utf8 を付けること。";
      continue;
    }
    data = JSON.parse(text);
  } catch (e) {
    file.problem = `JSON として読めません: ${e.message}`;
    continue;
  }
  if (!plain(data)) {
    file.problem = "中身が JSON のオブジェクトではありません。";
    continue;
  }
  if (!Array.isArray(data.records)) {
    file.problem = "records がありません(配列のはず)。受け渡し JSON ではないかもしれません。";
    continue;
  }
  file.kind = data.kind;
  file.version = data.version;
  file.note = data.note;
  file.created_at = data.created_at;
  file.skill_version = data.skill_version;
  file.records = data.records.map((r, i) => ({
    file,
    index: i,
    op: plain(r) ? r.op : undefined,
    args: plain(r) ? r.args : undefined,
    storedKey: plain(r) ? r.key : undefined,
  }));
}

// 書かれた順に流す。同じ内容が2度あったとき「先に話したほう」を残したいので、
// created_at があればそちらを優先し、無ければ名前順(名前の先頭も時刻)。
files.sort((a, b) => String(a.created_at ?? a.name).localeCompare(String(b.created_at ?? b.name)));

const allRecords = files.flatMap((f) => f.records);

// ============================================================
// 鍵の計算と設定の確認(通信しない)
// ============================================================

const probe = runPython({
  mode: "keys",
  records: allRecords.map((r) => ({ op: r.op, args: r.args })),
});
const failed = probe.lines.find((l) => l.type === "失敗");
if (failed) die(`${failed.error}\n${probe.stderr}`);
const conf = probe.lines.find((l) => l.type === "設定");
if (!conf) die(`db.py を読み込めませんでした。\n${probe.stderr || "(python は何も言っていない)"}`);

// 鍵は「渡した順」で返ってくる。数が合わないと別の record の鍵を貼ってしまい、
// 適用済みの判定が総崩れになる。合わないなら進まない。
if (!Array.isArray(conf.keys) || conf.keys.length !== allRecords.length) {
  die(`鍵の数が合いません(record ${allRecords.length} 件に対して ${conf.keys?.length} 個)。`);
}

allRecords.forEach((r, i) => {
  r.key = conf.keys[i];
  // 中身から計算し直した鍵と、書いてある鍵が違う = 置いたあとで誰かが中身を直した。
  // 【中身のほうを正とする】。書いてある鍵を信じると、直した内容が
  // 「適用済み」と誤判定されて入らないままになる。
  r.keyEdited = r.storedKey !== undefined && r.storedKey !== r.key;
});

// 受け渡し場所が db.py の言う場所と違うと、チャットが置いた先を見ていない。
const usingDefaultInbox = !argv.some((a) => a.startsWith("--inbox="));
if (usingDefaultInbox && resolve(conf.inbox) !== INBOX) {
  die(
    `受け渡し場所が db.py と食い違っています。\n` +
      `  このスクリプト: ${INBOX}\n` +
      `  db.py (INBOX_DIR): ${conf.inbox}\n` +
      `  チャットは db.py の場所に置きます。どちらかに揃えてください。`,
  );
}

// 形式の確認は db.py の値と突き合わせる(SKILL.md「形を変えたら version を上げる」)。
for (const f of files) {
  if (f.problem) continue;
  if (f.kind !== conf.handoff_kind) {
    f.problem = `kind が「${f.kind}」です。受け渡し JSON なら「${conf.handoff_kind}」のはず。`;
  } else if (typeof f.version !== "number" || f.version > conf.handoff_version) {
    f.problem = `version ${f.version} は、この db.py(対応 ${conf.handoff_version} まで)より新しい形です。スキルを配り直してください。`;
  }
}

// ============================================================
// やることを決める
// ============================================================

const ledger = readLedger();
const seen = new Set();                     // この実行の中で既に出た鍵

for (const f of files) {
  for (const r of f.records) {
    if (f.problem) {
      r.state = "ファイルが読めない";
    } else if (ledger.applied[r.key]) {
      r.state = "適用済み";
      r.stateNote = `${ledger.applied[r.key].at ?? "?"} に適用(${ledger.applied[r.key].結果 ?? ""})`;
    } else if (seen.has(r.key)) {
      // db.py の dedup_hash と同じ話で、まったく同じ操作は同じ鍵になる。
      // 本物の2件でも1件しか入らないので、【黙って落とさず必ず見せる】。
      r.state = "同じ鍵が先にある";
      r.stateNote = "内容がまったく同じ record が先にあります。入るのは先の1件だけです。";
    } else {
      r.state = "未適用";
      seen.add(r.key);
    }
  }
}

const pending = files.flatMap((f) => f.records).filter((r) => r.state === "未適用");

// ============================================================
// 下見(既定)。ここでは【1バイトも書かない】
// ============================================================

const line = "------------------------------------------------------------";

if (!APPLY) {
  const say = [];
  say.push(line);
  say.push("inbox の受け渡し JSON(下見。まだ何も書いていません)");
  say.push(line);
  say.push(`受け渡し場所: ${INBOX}`);
  say.push(`つなぐ先    : ${conf.url}(${conf.email} でログイン)`);
  say.push(`接続情報    : cowork/jisui/cowork.json か .env(db.py が読む。ここには書いていない)`);
  say.push(`db.py の版  : ${conf.skill_version}`);
  say.push(`適用済みの控え: ${LEDGER}${existsSync(LEDGER) ? ` (${Object.keys(ledger.applied).length} 件)` : " (まだ無い)"}`);
  say.push("");

  if (!files.length) {
    say.push("受け渡し JSON はありません。取り込むものはありません。");
    say.push("");
  }
  if (csvCount) {
    say.push(`※ CSV が ${csvCount} 個ありますが、このスクリプトの担当ではありません。`);
    say.push("   カード明細はチャットから import_card_csv で取り込みます。");
    say.push("");
  }

  for (const f of files) {
    say.push(line);
    say.push(`${f.name}`);
    if (f.created_at || f.note || f.skill_version) {
      const head = [
        f.created_at ? `書かれた: ${f.created_at}` : null,
        f.skill_version ? `db.py ${f.skill_version}` : null,
      ].filter(Boolean);
      if (head.length) say.push(`  ${head.join(" / ")}`);
      if (f.note) say.push(`  覚書: ${f.note}`);
    }
    say.push(line);
    if (f.problem) {
      say.push(`  【読めません】${f.problem}`);
      say.push("  --apply を付けても、このファイルは触りません(理由を .error に書きます)。");
      say.push("");
      continue;
    }
    if (!f.records.length) say.push("  record が0件です。");
    for (const r of f.records) {
      const d = describeSafe(r.op, r.args);
      const mark = r.state === "未適用" ? "" : `【${r.state}】`;
      say.push(`  [${r.index + 1}] ${mark}${d.title}`);
      for (const w of d.why) say.push(`       ${w}`);
      if (r.stateNote) say.push(`       ${r.stateNote}`);
      if (r.keyEdited) say.push("       ※ 書いてある鍵と中身が合いません(手で直した?)。中身から計算した鍵を使います。");
      say.push(`       鍵: ${r.key.slice(0, 12)}…`);
      say.push("");
    }
  }

  say.push(line);
  say.push("まとめ");
  say.push(line);
  const already = allRecords.filter((r) => r.state === "適用済み").length;
  const dup = allRecords.filter((r) => r.state === "同じ鍵が先にある").length;
  const unreadable = allRecords.filter((r) => r.state === "ファイルが読めない").length;
  say.push(`適用 0 件 / 失敗 0 件 / 残り ${pending.length + unreadable} 件`);
  say.push("  (下見なので何もしていません。「残り」は inbox にあって、まだ入っていない件数です)");
  if (already) say.push(`  適用済みなので飛ばすもの: ${already} 件`);
  if (dup) say.push(`  同じ鍵が先にあって入らないもの: ${dup} 件(内容がまったく同じ record)`);
  if (unreadable) say.push(`  読めないファイルの中の record: ${unreadable} 件`);
  const broken = files.filter((f) => f.problem).length;
  if (broken) say.push(`  読めないファイル: ${broken} 個(--apply でも触りません)`);
  say.push("");
  say.push("実際に入れるには");
  say.push("  node scripts/apply-inbox.mjs --apply");
  say.push("  → 入ったファイルは processed/ へ移し、鍵を applied-keys.json に控えます。");
  say.push("     何度実行しても二重には入りません。");
  process.stdout.write(say.join("\n") + "\n");
  process.exit(0);
}

// ============================================================
// --apply: 実際に入れる
// ============================================================

// 長い取り込みでも進み具合が見えるよう、ためずにその場で出す。
const echo = (s = "") => process.stdout.write(s + "\n");

echo(line);
echo("inbox の受け渡し JSON を適用します");
echo(line);
echo(`受け渡し場所: ${INBOX}`);
echo(`つなぐ先    : ${conf.url}(${conf.email} でログイン)`);
echo(`対象        : ${pending.length} 件(ファイル ${files.filter((f) => !f.problem).length} 個)`);
echo("");

const results = new Map();       // key -> {ok, skipped, summary, error}
let aborted = null;

if (pending.length) {
  const run = runPython({
    mode: "apply",
    review_unknown: REVIEW_UNKNOWN,
    records: pending.map((r) => ({ key: r.key, op: r.op, args: r.args })),
  });

  // 【ここで die してよいのは「接続失敗」だけ】。
  // 接続失敗はログインの前後で起きるので、1行も書いていないと言い切れる。
  // それ以外の落ち方で die すると、下の「控えを書く」に届かない。
  // 入ったのに控えが無い状態になり、次回もう一度入れてしまう。
  const denied = run.lines.find((l) => l.type === "接続失敗");
  if (denied) {
    // inbox には手を触れずに終わる。
    // ここで .error を撒くと、ファイルのせいで失敗したように見えてしまう。
    die(
      `Supabase につなげませんでした。inbox は触っていません。\n\n${denied.error}\n` +
        `\nつながる場所で、もう一度 --apply を実行してください。記録は inbox に残っています。`,
    );
  }

  for (const l of run.lines) {
    if (l.type === "結果") results.set(l.key, l);
    if (l.type === "中断") aborted = { why: "途中で通信が切れた", error: l.error };
  }

  // python がここまで来られずに落ちた(想定外の例外・強制終了)。
  // 途中まで入っている【かもしれない】ので、控えを書く道に合流させる。
  const crashed = run.lines.find((l) => l.type === "失敗");
  if (crashed) aborted = { why: "python が途中で落ちた", error: crashed.error };
  else if (run.status !== 0 && !aborted) {
    aborted = {
      why: `python が終了コード ${run.status} で終わった`,
      error: run.stderr.trim() || "(python は何も言っていない)",
    };
  }

  // 【控えは、ファイルを動かす前に書く】。順番が逆だと、控えを書く前に落ちたとき
  // 「入っているのに控えが無い」状態になり、次回もう一度入れてしまう。
  const at = new Date().toISOString();
  for (const r of pending) {
    const got = results.get(r.key);
    if (!got || !got.ok) continue;
    ledger.applied[r.key] = {
      op: r.op,
      file: r.file.name,
      at,
      結果: got.skipped ? `すでに入っていた(${got.summary})` : got.summary,
    };
  }
  writeLedger(ledger);
}

// ---------------------------------------------------------- 1件ずつの結果
for (const f of files) {
  echo(line);
  echo(f.name);
  echo(line);
  if (f.problem) {
    echo(`  【読めません】${f.problem}`);
    echo("");
    continue;
  }
  for (const r of f.records) {
    const d = describeSafe(r.op, r.args);
    const got = results.get(r.key);
    if (r.state === "適用済み") {
      echo(`  [${r.index + 1}] 済 ${d.title}`);
      echo(`       ${r.stateNote}`);
    } else if (r.state === "同じ鍵が先にある") {
      echo(`  [${r.index + 1}] 飛 ${d.title}`);
      echo(`       ${r.stateNote}`);
    } else if (!got) {
      echo(`  [${r.index + 1}] 未 ${d.title}`);
      echo("       まだ試していません(手前で止まりました)");
    } else if (got.ok) {
      echo(`  [${r.index + 1}] ${got.skipped ? "済" : "入"} ${d.title}`);
      echo(`       → ${got.summary}`);
    } else {
      echo(`  [${r.index + 1}] × ${d.title}`);
      for (const s of String(got.error).split("\n")) echo(`       ${s}`);
    }
  }
  echo("");
}

// ---------------------------------------------------------- 後始末
const settled = (r) =>
  r.state === "適用済み" || r.state === "同じ鍵が先にある" || results.get(r.key)?.ok === true;

let moved = 0;
let stayed = 0;
const nowText = new Date().toISOString();

for (const f of files) {
  const errPath = `${f.path}.error`;
  const bad = f.problem
    ? [{ index: -1, reason: f.problem }]
    : f.records
        .filter((r) => results.get(r.key)?.ok === false)
        .map((r) => ({ index: r.index, reason: String(results.get(r.key).error), title: describeSafe(r.op, r.args).title }));
  const untouched = f.records.filter((r) => r.state === "未適用" && !results.has(r.key));

  if (!f.problem && !bad.length && !untouched.length && f.records.every(settled)) {
    // 全部片付いた。processed/ へ移す。
    // 同じ名前があっても【上書きしない】(db.py:1769-1792 の archive_csv と同じ流儀)。
    mkdirSync(PROCESSED, { recursive: true });
    const dot = f.name.lastIndexOf(".");
    const stem = dot > 0 ? f.name.slice(0, dot) : f.name;
    const ext = dot > 0 ? f.name.slice(dot) : "";
    let dst = join(PROCESSED, f.name);
    for (let n = 2; existsSync(dst); n += 1) dst = join(PROCESSED, `${stem}-${n}${ext}`);
    renameSync(f.path, dst);
    if (existsSync(errPath)) removeQuietly(errPath);   // 前回の言い分は、片付いたので消す
    moved += 1;
    echo(`${f.name} → ${dst}`);
    continue;
  }

  stayed += 1;
  if (!bad.length) {
    // 通信が切れて手つかずのまま。ファイルのせいではないので .error は書かない。
    echo(`${f.name} は inbox に残します(まだ試していない record があります)`);
    continue;
  }

  const body = [
    `${f.name} を適用しきれませんでした`,
    `書いた日時: ${nowText}`,
    "",
    "このファイルは inbox に残してあります(processed/ へは移していません)。",
    "",
  ];
  for (const b of bad) {
    body.push(b.index >= 0 ? `[${b.index + 1}] ${b.title}` : "ファイル全体");
    for (const s of b.reason.split("\n")) body.push(`    ${s}`);
    body.push("");
  }
  body.push("同じファイルの中で入ったぶんは applied-keys.json に控えてあります。");
  body.push("直したあと、もう一度");
  body.push("    node scripts/apply-inbox.mjs --apply");
  body.push("を実行してください。入ったぶんは飛ばすので、二重にはなりません。");
  writeFileSync(errPath, body.join("\n") + "\n", "utf8");
  echo(`${f.name} は inbox に残します。理由は ${f.name}.error に書きました`);
}

// ---------------------------------------------------------- まとめ
const applied = pending.filter((r) => results.get(r.key)?.ok === true && !results.get(r.key).skipped).length;
const skipped = pending.filter((r) => results.get(r.key)?.ok === true && results.get(r.key).skipped).length;
const failedCount = pending.filter((r) => results.get(r.key)?.ok === false).length;
const untouchedCount = pending.filter((r) => !results.has(r.key)).length;
const unreadableCount = allRecords.filter((r) => r.state === "ファイルが読めない").length;
const remain = failedCount + untouchedCount + unreadableCount;

echo("");
echo(line);
echo("まとめ");
echo(line);
echo(`適用 ${applied} 件 / 失敗 ${failedCount} 件 / 残り ${remain} 件`);
if (skipped) echo(`  すでに入っていて飛ばしたもの: ${skipped} 件`);
const alreadyCount = allRecords.filter((r) => r.state === "適用済み").length;
if (alreadyCount) echo(`  前回までに適用済みで飛ばしたもの: ${alreadyCount} 件`);
const dupCount = allRecords.filter((r) => r.state === "同じ鍵が先にある").length;
if (dupCount) echo(`  内容がまったく同じで入らなかったもの: ${dupCount} 件(鍵が同じ record)`);
if (unreadableCount) echo(`  読めないファイルの中の record: ${unreadableCount} 件`);
const brokenCount = files.filter((f) => f.problem).length;
if (brokenCount) echo(`  読めないファイル: ${brokenCount} 個(中身を確かめるまで触りません)`);
echo(`  processed/ へ移したファイル: ${moved} 個 / inbox に残したファイル: ${stayed} 個`);
if (aborted) {
  echo("");
  echo(`※ ${aborted.why}ため、残りは試していません。`);
  for (const s of String(aborted.error).split("\n").slice(0, 6)) echo(`   ${s}`);
  echo("   直してから、もう一度 --apply を実行してください。");
  echo("   入ったぶんは控えてあるので、続きからやり直します。");
}
if (remain === 0 && moved > 0) echo("  受け渡し JSON は inbox に残っていません。");

// 元の .json が無いのに残っている .error を片付ける。
// 「失敗したまま」に見えるゴミが残ると、次に見た人が何を直せばよいのか分からない。
for (const name of readdirSync(INBOX).filter((n) => n.endsWith(".json.error"))) {
  if (existsSync(join(INBOX, name.slice(0, -".error".length)))) continue;
  if (removeQuietly(join(INBOX, name))) echo(`  ${name} を片付けました(元の JSON がもうありません)`);
}

// 失敗があったことを終了コードでも伝える。ここを見て止まる仕組みを後から足せる。
process.exit(remain > 0 ? 1 : 0);
