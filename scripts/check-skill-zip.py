"""配る前に、zip をそのまま動かして確かめる。

【なぜ要るか】
2026-08-12 に、1日で3回「スキルを差し替えてください」と頼み、3回とも
別の理由で動かなかった。抜けていたもの・間違っていたものは毎回違う:

  1回目  受け渡し場所を Linux のパスにしていた(存在しない道だった)
  2回目  cowork.json を zip から外していた(クラウドは他に鍵を持てない)
  3回目  ログインの時点で落ちたときに案内が一切出なかった

どれも「入れてもらってから」判明した。頼む側が確かめずに頼んでいた。
そこで、zip の中身だけを白紙のフォルダに展開し、.env も環境変数も無い
= Cowork とまったく同じ条件で、ひととおり動かしてから渡す。

【使い方】
  python scripts/check-skill-zip.py            デスクトップの zip を見る
  python scripts/check-skill-zip.py <zipの場所>

sync-skill.ps1 が最後にこれを呼ぶ。落ちたら zip を渡さないこと。
"""
import io
import json
import os
import re
import shutil
import subprocess
import sys
import zipfile

sys.stdout.reconfigure(encoding="utf-8")

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "..", "cowork", "jisui")
STAGE = os.path.join(os.environ.get("TEMP", "."), "jisui-skill-check")
ZIP = sys.argv[1] if len(sys.argv) > 1 else os.path.join(
    os.environ["USERPROFILE"], "OneDrive", "デスクトップ", "jisui-skill.zip")

# 受け渡し場所は正本から読む。ここに書き写すと、片方だけ直して食い違う。
_db = io.open(os.path.join(SRC, "db.py"), encoding="utf-8").read()
WANT_VERSION = re.search(r'SKILL_VERSION = "([^"]+)"', _db).group(1)
INBOX = re.search(r'INBOX_DIR = r"([^"]+)"', _db).group(1)

if not os.path.exists(ZIP):
    print(f"zip がありません: {ZIP}")
    sys.exit(1)

if os.path.isdir(STAGE):
    shutil.rmtree(STAGE)
os.makedirs(STAGE)
with zipfile.ZipFile(ZIP) as z:
    z.extractall(STAGE)

# 【Cowork と同じ条件を作る】JISUI_* の環境変数を全部消す。
# 残っていると、cowork.json が壊れていても通ってしまう。
env = {k: v for k, v in os.environ.items() if not k.startswith("JISUI_")}
env["PYTHONIOENCODING"] = "utf-8"   # 出力が cp932 で化けると読めない


def run(code: str):
    r = subprocess.run([sys.executable, "-c", code], cwd=STAGE, env=env, capture_output=True)
    return r.returncode, r.stdout.decode("utf-8", "replace"), r.stderr.decode("utf-8", "replace")


ok: list[bool] = []


def check(name: str, cond, note: str = "") -> None:
    ok.append(bool(cond))
    print(f"  {'OK  ' if cond else '×   '}{name}" + (f"   {note}" if note else ""))


def last_line(s: str) -> str:
    return (s.strip().splitlines() or [""])[-1][:80]


print(f"見るもの: {ZIP}")
print()
print("=== 1. zip の中身だけ / .env なし / 環境変数なし(Cowork と同じ条件) ===")
c, out, err = run(
    "import json, db\n"
    "j = db.Jisui()\n"
    "print(json.dumps({'w': j.whoami(),\n"
    "                  'zaiko': len(j.select('inventory','*',limit=2)),\n"
    "                  'ctx': len(j.context())}, ensure_ascii=False))\n"
)
check("ログインできる", c == 0, last_line(err) if c else "")
if c == 0:
    d = json.loads(out)
    w = d["w"]
    check(f"版が {WANT_VERSION}", w["版"] == WANT_VERSION, w["版"])
    check("cowork.json を読んでいる", w["読んだ設定"] == "cowork.json", w["読んだ設定"])
    check("Cowork として入っている", w["ログイン中"] == "Cowork", w["ログイン中"])
    check("データを読める", d["zaiko"] > 0 and d["ctx"] > 0,
          f"在庫{d['zaiko']}件 / 献立の項目{d['ctx']}個")

print()
print("=== 2. Supabase に届かないとき(Cowork が毎回通る道) ===")
cj = os.path.join(STAGE, "cowork.json")
orig = io.open(cj, encoding="utf-8").read()
broken = json.loads(orig)
broken["JISUI_SUPABASE_URL"] = "https://127.0.0.1:9"   # どこにも届かない
io.open(cj, "w", encoding="utf-8").write(json.dumps(broken, ensure_ascii=False))
try:
    c, out, err = run(
        "import db\n"
        "try:\n"
        "    db.Jisui()\n"
        "except db.JisuiOffline as e:\n"
        "    print(str(e))\n"
        "except Exception as e:\n"
        "    print('BAD ' + type(e).__name__ + ': ' + str(e)[:200])\n"
    )
    check("記録を捨てるなと案内する", "捨てないでください" in out or "失われていません" in out)
    check("device_list_dir で確かめろと言う", "device_list_dir" in out)
    # クラウドから ls C:\… は必ず「無い」と出る。ここに ls と書くと、
    # 置けたのに「置けませんでした」と報告することになる。
    check("ls とは書いていない", "ls -l" not in out and "ls C:" not in out)
    check("置き場所を示す", INBOX in out)
    check("確かめる前に言うなと書く", "確かめる前に" in out)
    check("SQLite に書くなと書く", "SQLite" in out)
    # 読めないときに推測で献立を組ませないための案内。ここが抜けると
    # 「在庫が読めないので推測で提案します」に戻る。
    check("いまの状況.md を読めと案内する", "いまの状況.md" in out)
    check("推測するなと書く", "推測で提案します" in out or "読めます" in out)
    check("実行場所の切り替え方が今の表記", "お使いのコンピュータに移動" in out)
    check("古いボタン名が残っていない", "Run this task" not in out)
finally:
    io.open(cj, "w", encoding="utf-8").write(orig)

print()
print("=== 3. トークンの控えが読めない・書けないとき ===")
tok = os.path.join(STAGE, ".token.json")
if os.path.exists(tok):
    os.remove(tok)
os.makedirs(tok)   # 同名のフォルダを作り、読み書きを必ず失敗させる
try:
    c, out, err = run("import db; print(db.Jisui().whoami()['ログイン中'])\n")
    check("それでもログインできる", c == 0 and "Cowork" in out, last_line(err) if c else "")
finally:
    shutil.rmtree(tok, ignore_errors=True)

print()
print("=== 4. 受け渡しの中身 ===")
c, out, err = run(
    "import json, db\n"
    "h = db.handoff(('add_shopping', {'items':[{'item':'牛乳'}]}), note='試験')\n"
    "print(json.dumps({k: v for k, v in h.items() if k != '中身'}, ensure_ascii=False))\n"
)
if c == 0:
    h = json.loads(out)
    check("保存先が Windows のパス", h["保存先"] == INBOX, h["保存先"])
    check("確かめる手順がある", len(h.get("手順", [])) >= 4)
    check("一覧して確かめろと書いてある", any("一覧" in s for s in h.get("手順", [])))
else:
    check("handoff が動く", False, err[-80:])

print()
print("=== 5. zip に入っているもの ===")
with zipfile.ZipFile(ZIP) as z:
    names = sorted(z.namelist())
check("cowork.json が入っている", "cowork.json" in names)
check(".env は入っていない", ".env" not in names)   # 役割が違う。混ぜると別人として動く
check("入れ子になっていない", all("/" not in n for n in names), " ".join(names))

shutil.rmtree(STAGE, ignore_errors=True)

print()
if all(ok):
    print(f"→ {len(ok)}/{len(ok)} 合格。この zip は差し替えてよい。")
    sys.exit(0)
print(f"→ {sum(ok)}/{len(ok)} 合格。【差し替えを頼まないこと。】")
sys.exit(1)
