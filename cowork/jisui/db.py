"""
Cowork(チャット)から Supabase の jisui データを読み書きするための道具。

なぜこれが要るのか:
  アプリ(スマホ)とチャットで、同じデータを見るため。
  これまでチャットはパソコン上の jisui.db を触っていたので、パソコンを閉じていると
  書き込みが保留になっていた(設計書 1)。Supabase を直接叩けばその問題が消える。

なぜ pip install が要らない書き方にしてあるのか:
  Cowork の実行環境に何が入っているか当てにできないため、標準ライブラリだけで書いてある。

使い方:
    from db import Jisui
    j = Jisui()
    j.select("inventory", location="eq.冷蔵")
    j.insert("shopping_list", [{"item": "牛乳", "qty": "1本", "section": "乳製品・卵・豆腐"}])
    j.add_event("2026-08-12", "歯医者", start_time="18:30", items="保険証")
    j.add_todo("旅行の準備", subtasks=["宿を予約する", "切符を取る", "旅行保険に入る"])

【非公開の予定について — 先に読む】
  タグ(calendar_tags)に private を立てると、そのタグを付けた予定は
  【付けた本人にしか見えない】。相手の非公開予定は、この db.py からも
  1行も返ってこない。「予定が1件足りない」ように見えても壊れていない。
  そういう決まりとして作ってある。詳しくは「予定(カレンダー)」の節の頭に書いた。
"""

from __future__ import annotations

import base64
import contextlib
import csv
import hashlib
import io
import json
import os
import re
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from datetime import date as _date
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any


def _add_days(iso: str, days: int) -> str:
    return (_date.fromisoformat(iso) + timedelta(days=days)).isoformat()


def _days_between(iso_a: str, iso_b: str) -> int:
    """a - b を日数で返す。予定をずらすとき、期間の長さを保つために使う。"""
    return (_date.fromisoformat(iso_a) - _date.fromisoformat(iso_b)).days


def _now() -> str:
    """timestamptz に入れる「今」。done_at のように時刻まで要る列に使う。"""
    return datetime.now(timezone.utc).isoformat()


# ============================================================
# 店名のならし方
#
# 【なぜ要るか — 実物の CSV を開いて分かったこと】
# カード会社は同じ店を違う字で書いてくる。
#   三井住友 … 「ＥＴＣ  中部地区」「ＡＭＡＺＯＮ．ＣＯ．ＪＰ」(英数字が全角、間に空白)
#   楽天     … 「ＶＩＳＡ海外利用　UBER   *TRIP」(全角と半角が混ざる)
#   イオン   … 「マックスバリュ〈全角空白〉大府」(桁合わせの全角空白が入る)
# いっぽう分類辞書(expense_rules)のキーワードは
# 「ETC」「Amazon」のように人が読む形で入っている
# (supabase/05_seed_kakeibo.sql を見ると全部そう)。
#
# つまり素の部分一致では【1件も当たらない】。実際の CSV で確かめた。
# そこで NFKC(全角→半角にそろえる)・空白落とし・大文字化をしてから照合する。
# これは「AI が費目を推測する」のとは違う。辞書に書いてある文字列を
# 見つけやすくしているだけなので、再現性は保たれる。
#
# 【吸収できないゆれ】長音のゆれは直せない。
#   「コ－プアイチ」の「－」は全角ハイフンで、NFKC では "-" になる。
#   辞書の「コープ」の「ー」(長音記号)とは別の字なので当たらない。
#   当たらなければ「初見の店」として人に出る。黙って別の費目を付けるより安全なので、
#   ここは直さず、人が辞書に足す流儀のままにしてある。
# ============================================================

_SPACES = re.compile(r"[\s　]+")

# 8桁以上の数字の連なりは口座番号・カード番号とみなして伏せる。
# 店名に8桁の数字が続くことはまず無い。CSV に番号列が紛れ込んでも
# データベースに残さないための最後の網(禁止事項の「番号は保存しない」)。
_LONG_DIGITS = re.compile(r"\d{8,}")


def _clean_text(text: str | None) -> str:
    """
    明細に書かれた文字を、意味を変えずに読める形にする。
    連続する空白(全角含む)を1つにするだけ。**言葉は書き換えない。**

    なぜ空白だけ潰すか: あれは桁合わせの飾りであって中身ではない。
    しかも明細を落とし直すと飾りの数が変わることがあり、そのままだと
    dedup_hash が変わって同じ買い物が二重に入る。
    """
    return _SPACES.sub(" ", (text or "").strip())


def _mask_numbers(text: str) -> str:
    """口座番号・カード番号らしき数字の並びを伏せる。保存前に必ず通す。"""
    return _LONG_DIGITS.sub("********", text)


def _normalize_merchant(text: str | None) -> str:
    """
    照合用にならした店名。transactions.merchant_norm にもこれを入れる。
    全角→半角、空白を落とす、大文字にそろえる。
    """
    if not text:
        return ""
    return _SPACES.sub("", unicodedata.normalize("NFKC", text)).upper()


# 繰り返しの言い方。DB の check 制約と同じ並びにしてある(events_repeat_check)。
# 「毎日」は予定には無い(毎日の予定は事実上の家事なので chores 側で扱う)。
EVENT_REPEATS = ("なし", "毎週", "隔週", "毎月", "毎年")
TODO_REPEATS = ("なし", "毎日", "毎週", "隔週", "毎月", "毎年")

# update_event / update_todo で書き換えてよい列。
# household_id や created_by をうっかり上書きすると、RLS の外に出て
# 二度と見えない行になる。だから「知っている列だけ通す」ようにしてある。
EVENT_COLUMNS = frozenset({
    "date", "end_date", "start_time", "end_time", "title", "memo",
    "location", "url", "items", "notify_min", "tag_id", "owner_id",
    "repeat", "repeat_until",
})
TODO_COLUMNS = frozenset({
    "title", "detail", "due_date", "assignee_id", "parent_id",
    "repeat", "repeat_until", "sort_order",
})


CONFIG_NAME = ".env"
TOKEN_CACHE = Path(__file__).with_name(".token.json")
TIMEOUT = 30


# ============================================================
# このファイルの版。【中身を直したら必ず上げること】
#
# なぜ要るか: このスキルは複数の場所に置かれていて、
# どれが動いているのか外から見分けられなかった。
# 実際、古い複製が動き続けて記録が別のデータベースへ入り、
# 半日ぶんの記録がどこにも届かない事故が起きた。
# 版番号があれば「いま動いているのはどれか」を1秒で確かめられる。
# ============================================================
SKILL_VERSION = "2026-08-11.3"


# つながらないときの受け渡し場所。
#
# 【ここは Windows のパスで正しい】(2026-08-11 に実測で確定)
# Cowork はクラウドのコンテナで動いていて、パソコンのフォルダは
# ファイルシステムには見えない。/sessions も存在しない(実測: ls → No such
# file or directory、glob.glob("/sessions/*") → [])。
# 触れるのは remote-devices の道具(device_list_dir / device_commit_files)
# だけで、**その道具は Windows のパスをそのまま受け取る。**
#   実測: device_commit_files → {"written":["C:\\Users\\mmizu\\家計簿\\inbox\\…"]}
#         → パソコン側に実在。main.log に committed 1 files, 0 rejected
#
# だから db.py は、この Windows のパスを素直に伝えればよい。
# 一度これを「サンドボックス内の Linux のパスを探す」作りに変えたが、
# 見えないものを探すので何も見つからず、動いていた経路を壊した。取り消した。
#
# 【本当の落とし穴はパスではなかった】
# 事故の正体は、エージェントが【置いていないのに「置きました」と報告した】こと。
# 16時前後に「inbox に2件置いた」と言われたが、main.log の [remote-file] は
# 15:30:18 を最後に1行も出ていなかった(接続の生存確認は34件出ていて、
# 回線は生きていた)。書き込みを依頼した形跡そのものが無い。
# 防ぎ方は場所を変えることではなく、【置いたあと必ず一覧して確かめさせる】こと。
INBOX_DIR = r"C:\Users\mmizu\jisui\inbox"

# 別名。読む側が「Windows のパスである」と分かるように残す。
INBOX_DIR_WINDOWS = INBOX_DIR


def inbox_dir() -> str:
    """
    受け渡し場所を返す。**パソコン側の Windows のパス。**

    Cowork から呼んでも、パソコンで呼んでも、同じ答えでよい。
    Cowork はこのパスを remote-devices の道具にそのまま渡せば書ける。
    パソコンの上ならそのまま開ける。

    【ここで場所を探そうとしないこと】
    db.py はクラウドのコンテナにいるので、パソコンのフォルダを見に行けない。
    「在るかどうか」を確かめようとすると必ず「無い」と答えることになり、
    書けるのに「書けません」と言い出す。実際にその作りにして壊した。
    在ることを確かめるのは、道具を持っているエージェントの仕事。
    """
    return INBOX_DIR


def read_local_file(path: str) -> bytes:
    """
    パソコンの上のファイルを読む。**Cowork からは読めないので、その旨を返す。**

    人は「C:\\Users\\mmizu\\jisui\\inbox\\meisai202608.csv に置いた」と言う。
    パソコンで動いていればそのまま開ける。
    Cowork(クラウド)からは開けない。ファイルシステムが別物だから。
    そこで黙って FileNotFoundError にせず、**どうすれば読めるか**を返す。
    """
    if os.path.exists(path):
        return Path(path).read_bytes()
    raise JisuiError(
        f"このプロセスからは開けません: {path}\n"
        "\n"
        "【Cowork(クラウド)から呼んでいる場合】\n"
        "パソコンのファイルは、あなたの remote-devices の道具でしか読めません。\n"
        "  1. その道具でファイルの中身を読む\n"
        "  2. 読んだ中身を data= に渡してもう一度呼ぶ\n"
        "     例: j.import_card_csv(data=<読み取った中身>)\n"
        "path= は、パソコン上で動いているときだけ使えます。\n"
        "\n"
        "【パソコン上で呼んでいる場合】\n"
        "そのパスにファイルがありません。置き場所と名前を確かめてください。"
    )


def inbox_status() -> dict:
    """
    受け渡し場所と、確かめ方。困ったときに人とエージェントが読むためのもの。

    【状態を「調べて」返さないこと】
    db.py はクラウドのコンテナにいて、パソコンのフォルダを見に行けない。
    ここで os.path.isdir を呼んでも必ず False になり、「無い」と嘘をつく。
    確かめるのは道具を持っているエージェントの仕事なので、その手順を返す。
    """
    on_pc = os.path.isdir(INBOX_DIR)
    return {
        "受け渡し場所": INBOX_DIR,
        "いまどこで動いているか": (
            "パソコンの上(そのまま読み書きできる)" if on_pc
            else "パソコン以外(Cowork のクラウドなど)。道具ごしにだけ書ける"
        ),
        "確かめ方": [
            f"1. device_list_dir で {INBOX_DIR} を一覧する",
            "2. 置いたファイルが在ることを目で見る",
            "3. 見てから「置きました」と言う。見る前に言わないこと",
        ],
        "なぜ確かめるか": (
            "置いていないのに「置きました」と報告された事故が実際にあった。"
            "パソコン側のログには書き込みを依頼した形跡すら無かった。"
            "一覧して在ることを見るまでは、置けたと言わないこと。"
        ),
    }

# 受け渡し JSON の目印と版。
# 次の工程で「この JSON を読んで Supabase に適用するスクリプト」を別の人が書く。
# 形を変えたときは HANDOFF_VERSION を上げて、適用側が古い形を見分けられるようにする。
HANDOFF_KIND = "jisui-handoff"
HANDOFF_VERSION = 1


# 在庫の置き場所。
# 【supabase/12a_schema_v6_constraint.sql の check 制約と1文字も違わないこと】。
# ずれると保存が全部弾かれる。うちの冷蔵庫(日立 R-HWC54Y)固有の分け方で、
# 一般的な食品分類ではない。買い替えたら作り直しになる。
INVENTORY_LOCATIONS = ("冷蔵", "氷温", "野菜", "冷凍", "常温")


class JisuiError(RuntimeError):
    pass


class JisuiOffline(JisuiError):
    """
    Supabase に届かなかった。**書き込みは1行も起きていない。**

    【なぜ専用の例外にして、しかも中身を持たせるのか】
    Cowork(チャット)がクラウドで動いていると、外に出られる宛先が決まっていて
    Supabase は入っていない。そこで例外を投げて終わりにすると、
    せっかく人が話した内容(レシート・買い物・予定)がその場で消える。
    実際、消えたように見えて手元の SQLite に書いてしまう事故が起きた。

    だからこの例外は【何を書けば復旧できるか】を丸ごと抱えて出る。
    受け取った側(エージェント)は e.handoff() を呼び、返ってきた
    「ファイル名」と「中身」をそのまま INBOX_DIR に保存すればよい。
    db.py はサンドボックスの中なので自分では保存できない。書くのは
    ファイルを扱えるエージェントの仕事、という分担にしてある。

        try:
            j = Jisui()
            j.add_receipt(date="2026-08-10", amount=1200, merchant_raw="ライフ")
        except JisuiOffline as e:
            print(e.handoff())   # → {"ファイル名": ..., "中身": ..., "件数": 1}
            # ここで返ってきた「中身」を INBOX_DIR に「ファイル名」で保存する

    records が空のこともある(Jisui() を作る途中で落ちた場合など)。
    そのときは handoff() モジュール関数で、書きたい操作を自分で組み立てる。
    """

    def __init__(self, message: str, records: list[dict] | None = None) -> None:
        super().__init__(message)
        self.records = records or []

    def handoff(self, note: str | None = None) -> dict:
        """保存すべきファイル名と中身。records が空なら「中身」は None。"""
        if not self.records:
            return {"ファイル名": None, "中身": None, "件数": 0,
                    "覚書": "残すべき操作が分かりません。handoff() で組み立ててください。"}
        return handoff(*[(r["op"], r["args"]) for r in self.records], note=note)


def _canonical(value: Any) -> str:
    """
    引数を「並びの違いで変わらない文字列」にする。
    同じ操作から必ず同じ鍵が出るようにするため(dict の順序に左右されない)。
    default=str は date や Decimal が混ざっても落ちないようにする保険。
    """
    return json.dumps(value, sort_keys=True, ensure_ascii=False,
                      separators=(",", ":"), default=str)


def _handoff_record(op: str, args: dict) -> dict:
    """
    受け渡し JSON の1件分。

    key は op と args だけから作る。**作った時刻は入れない。**
    入れてしまうと、同じ内容を2回書き出しただけで別物になり、
    適用側が二重に入れてしまう。「同じ操作は同じ鍵」が守れなくなる。
    """
    key = hashlib.sha256(f"{op}|{_canonical(args)}".encode("utf-8")).hexdigest()
    return {"op": op, "args": args, "key": key}


def handoff(*ops: Any, note: str | None = None) -> dict:
    """
    つながらないときに inbox へ残す JSON を組み立てる。**通信しない。**

        from db import handoff
        h = handoff(("add_receipt", {"date": "2026-08-10", "amount": 1200,
                                     "merchant_raw": "ライフ 西宮店", "category": "食費"}))
        h["ファイル名"]  # → "handoff-20260810T083012Z-1-3f9a1c04.json"
        h["中身"]        # → JSON の文字列。これをそのまま INBOX_DIR に保存する

    ops は ("操作名", {引数}) の組か、{"op":…, "args":…} の辞書。
    使える操作名は SKILL.md の表に書いてある(add_receipt / add_shopping /
    insert / import_card_row / add_rule / add_event / add_todo)。

    【ファイル名が内容だけで決まるようにしてある】
    同じ内容をもう一度書き出すと同じ名前になるので、上書きになって増えない。
    時刻は名前の先頭に入るが、鍵(末尾8桁)は内容だけから作る。
    """
    records: list[dict] = []
    for item in ops:
        if isinstance(item, dict) and "op" in item:
            records.append(_handoff_record(item["op"], item.get("args") or {}))
        elif isinstance(item, (tuple, list)) and len(item) == 2:
            records.append(_handoff_record(item[0], item[1]))
        else:
            raise JisuiError(
                "handoff() には (\"操作名\", {引数}) の組か "
                "{\"op\":…, \"args\":…} を渡してください。受け取った値: " + repr(item)
            )
    if not records:
        raise JisuiError("残す操作が1件もありません。")

    payload = {
        "kind": HANDOFF_KIND,
        "version": HANDOFF_VERSION,
        "created_at": _now(),
        "skill_version": SKILL_VERSION,
        "note": note,
        "records": records,
    }
    # ファイル名の末尾は【全レコードの鍵から作る】。中身が同じなら名前も同じ。
    digest = hashlib.sha256("".join(r["key"] for r in records).encode("utf-8")).hexdigest()[:8]
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    name = f"handoff-{stamp}-{len(records)}-{digest}.json"
    full = os.path.join(INBOX_DIR, name)
    return {
        "ファイル名": name,
        "中身": json.dumps(payload, ensure_ascii=False, indent=2),
        "件数": len(records),
        # 【Windows のパスでよい】。remote-devices の道具はこれをそのまま受け取る。
        "保存先": INBOX_DIR,
        "保存先のフルパス": full,
        # 【置いたあと必ず確かめさせる】
        # 事故の正体は場所ではなく報告だった。置いていないのに「置きました」と
        # 言われ、パソコン側のログには書き込みを依頼した形跡すら無かった。
        # 一覧して在ることを見るまでは、置けたと言わせない。
        "手順": [
            f"1. 「中身」を {full} に、そのまま保存する",
            f"2. 保存したら {INBOX_DIR} を一覧して、そのファイルが在ることを確かめる",
            "3. 見てから「置きました」と言う。確かめる前に言わないこと",
            "4. 一覧に出てこなければ置けていない。置けたと言わず、その旨を伝える",
        ],
        "やってはいけないこと": (
            "自分の作業領域(/tmp など)に保存して「置きました」と言わないこと。"
            "パソコンには届きません。"
        ),
    }


# いま試みている操作を積んでおく場所。
# _request が通信の壁にぶつかったとき、「何をしようとしていたのか」を
# ここから取り出して JisuiOffline に持たせる。
# 入れ子になったときは【一番外側】を使う。add_receipt の中の insert より、
# add_receipt そのもののほうが人にとって意味のある単位だから。
# (会話から順に呼ぶ使い方しか想定していないので、スレッド安全ではない)
_HANDOFF_STACK: list[list[dict]] = []


@contextlib.contextmanager
def _capturing(*ops: Any):
    """この中で通信が壁に当たったら、ops を抱えた JisuiOffline にする。"""
    _HANDOFF_STACK.append([
        _handoff_record(o[0], o[1]) if isinstance(o, (tuple, list)) else o for o in ops
    ])
    try:
        yield
    finally:
        _HANDOFF_STACK.pop()


def _v5_error(err: JisuiError) -> JisuiError:
    """
    11_schema_v5.sql をまだ流していないときのエラーは
    「column events.location does not exist」のようにそっけない。
    何をすれば直るのかが分かる文言に言い換えて返す。
    """
    text = str(err)
    if "does not exist" in text or "42P01" in text or "PGRST204" in text or "PGRST205" in text:
        return JisuiError(
            "予定のタグ・場所・持ち物・通知、TODO の子タスクと繰り返しは、\n"
            "11_schema_v5.sql を Supabase で実行してから使えます。まだのようです。\n"
            f"(元のエラー: {text})"
        )
    return err


def _load_config() -> dict[str, str]:
    """
    接続情報を読む。探す順番が大事なので、その理由ごと書いておく。

    【なぜ3か所も探すのか】
    このスキルは2つの違う場所で動く。

      1. Cowork(チャット)   … Anthropic のクラウドで動く。
                               スキルとして保存したファイルだけが配られ、
                               このパソコンの中は【一切見えない】。
      2. このパソコン        … Claude Code や手元のスクリプトから動かす。

    以前ここでつまずいた。接続情報を .env に置き、その .env を
    git 管理外(= スキルに含まれない)にしていたため、
    コードだけがクラウドへ渡り、鍵は手元に残った。
    Cowork は「接続情報が足りません」で止まり続けたが、
    その手前までは正常に動くので、【壊れているように見えなかった】。
    さらに悪いことに、古い版のスキルは引退した SQLite に書き込んで
    “成功” していたので、記録が消えたようにも見えなかった。

    【探す順番】
      1. 環境変数            … 一番安全。秘密をファイルに置かなくて済む。
                               Cowork 側にそういう仕組みがあるならこれを使う
      2. .env                … このパソコン用。git 管理外。
                               手元では夫としてログインしたいので、こちらを先に見る
      3. cowork.json         … スキルと一緒に配られる設定。
                               【ドットで始まらない名前にしてあるのが要点】。
                               .env のようなドットファイルは、zip にまとめるとき
                               取りこぼされることがある

    先に見つかったほうが勝ち。だから Cowork では cowork.json が、
    手元では(環境変数を入れていなければ)cowork.json か .env が使われる。
    """
    keys = ("JISUI_SUPABASE_URL", "JISUI_SUPABASE_KEY", "JISUI_EMAIL", "JISUI_PASSWORD")
    config: dict[str, str] = {}

    # 1. 環境変数
    for key in keys:
        v = os.environ.get(key, "")
        if v:
            config[key] = v

    # 2. .env(このパソコン用)
    env_path = Path(__file__).with_name(CONFIG_NAME)
    if env_path.exists():
        for line in env_path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            config.setdefault(key.strip(), value.strip())

    # 3. cowork.json(スキルと一緒に旅をする)
    json_path = Path(__file__).with_name("cowork.json")
    if json_path.exists():
        try:
            data = json.loads(json_path.read_text(encoding="utf-8"))
        except Exception as e:
            raise JisuiError(f"cowork.json を読めませんでした: {e}") from e
        for key in keys:
            config.setdefault(key, str(data.get(key, "")).strip())

    for key in keys:
        config.setdefault(key, "")

    missing = [k for k in keys if not config[k]]
    if missing:
        raise JisuiError(
            "接続情報が足りません: " + ", ".join(missing) + "\n"
            "\n"
            "【Cowork(クラウド)で動いている場合】\n"
            "  スキルの中に cowork.json が入っていません。\n"
            "  スキルを保存し直すとき、cowork.json を必ず同梱してください。\n"
            "  中身の形は cowork.example.json を見てください。\n"
            "\n"
            "【このパソコンで動かしている場合】\n"
            f"  {env_path} に .env.example と同じ形で書いてください。\n"
            "\n"
            "どちらの場合も、引退した jisui.db / kakeibo.db には絶対に書かないこと。\n"
            "書いても “成功” してしまい、記録がどこにも届かないまま消えます。"
        )
    return config


def _request(method: str, url: str, headers: dict[str, str], body: Any = None) -> Any:
    data = None if body is None else json.dumps(body, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as res:
            raw = res.read().decode("utf-8")
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "replace")
        raise JisuiError(f"{method} {url} が失敗しました ({e.code}): {detail}") from e
    except urllib.error.URLError as e:
        # 【ここが「通信の壁」の検知点】
        # 例外を投げて終わりにせず、いま試みていた操作を抱えて出る。
        # そうしないと、話してもらった内容がその場で消える(JisuiOffline の説明を読む)。
        records = _HANDOFF_STACK[0] if _HANDOFF_STACK else []
        hint = ""
        if records:
            where = inbox_dir()
            # 【場所は決め打ちにせず、そのとき在るものを案内する】
            # Windows のパスを書くと、サンドボックスに存在しない道を案内することになる。
            # エージェントは近そうな場所に書いて「置きました」と言い、
            # パソコンには何も届かない。実際にそうなった。
            if where:
                place = (
                    f"  {where}\n"
                    "に保存してください(保存するのはあなたの仕事です。db.py はそのフォルダに書けません)。\n"
                    f"保存したら ls -l {where} で在ることを確かめてから報告すること。\n"
                    "確かめる前に「置きました」と言わないこと。"
                )
            else:
                place = (
                    "ただし、いま保存できる場所がありません。\n"
                    "つないでいるフォルダが1つも見つかりません(/sessions/*/mnt/* が空)。\n"
                    "【自分の作業領域に保存して「置きました」と言わないこと。】\n"
                    "パソコンには届きません。『フォルダがつながっていないので保存できない』と\n"
                    "正直に伝え、C:\\Users\\mmizu\\jisui をこのチャットにつないでもらってください。"
                )
            hint = (
                "\n\n【この内容は失われていません】\n"
                f"残すべき操作が {len(records)} 件あります。\n"
                "  h = e.handoff()\n"
                "として返ってきた h[\"中身\"] を、h[\"ファイル名\"] という名前で\n"
                f"{place}\n"
                "【手元の SQLite には絶対に書かないこと。】書けば “成功” してしまい、\n"
                "アプリには何も出てこないまま記録が消えます。"
            )
        raise JisuiOffline(
            f"通信できませんでした: {Jisui._explain_network_error(e.reason)}{hint}",
            records,
        ) from e


class Jisui:
    """世帯のデータを読み書きする。RLS があるので、必ずログインしてから使う。"""

    def __init__(self) -> None:
        config = _load_config()
        self.url = config["JISUI_SUPABASE_URL"].rstrip("/")
        self.key = config["JISUI_SUPABASE_KEY"]
        self._email = config["JISUI_EMAIL"]
        self._password = config["JISUI_PASSWORD"]
        self._token = self._get_token()
        self.user_id = self._fetch_user_id()
        self.household_id = self._fetch_household_id()

    # ------------------------------------------------------------ 認証

    @staticmethod
    def _explain_network_error(e: Exception) -> str:
        """
        通信できなかったとき、何をすれば直るかまで書いて返す。

        【なぜここまで書くか】
        「Tunnel connection failed: 403 Forbidden」とだけ出ても、
        鍵が悪いのか、URL が悪いのか、そもそも出られないのかが分からない。
        実際にこれで半日つまずいた。原因が分かっている失敗は、
        原因と直し方を本文に書いておく。
        """
        msg = str(e)
        blocked = ("Tunnel connection failed" in msg) or ("403 Forbidden" in msg and "proxy" in msg.lower())
        if not blocked:
            return msg
        return (
            msg + "\n"
            "\n"
            "【これは鍵の問題ではありません】\n"
            "いまこのスキルは Anthropic のクラウド(サンドボックス)で動いています。\n"
            "そこから外に出られる宛先は決められていて、Supabase は入っていません。\n"
            "pypi や GitHub には出られるのに Supabase だけ弾かれるのはそのためです。\n"
            "cowork.json や .env をいじっても直りません。宛先の追加は\n"
            "Team / Enterprise プランの組織設定にしかなく、個人プランでは足せません。\n"
            "\n"
            "【直し方】このタスクを【あなたのパソコン上で】動かしてください。\n"
            "  デスクトップアプリで新しいタスクを始めるとき、\n"
            "  右上の「Run this task」で実行場所を選べます。パソコン側を選ぶと、\n"
            "  この制限自体が無くなり、そのまま Supabase に届きます。\n"
            "\n"
            "【やってはいけないこと】\n"
            "  代わりに手元の SQLite(jisui.db / kakeibo.db)へ書かないこと。\n"
            "  どちらも引退済みで、_引退_2026-08-10 フォルダに移してあります。\n"
            "  書き込みは成功してしまうのにアプリには何も出てこないため、\n"
            "  記録が消えたように見えます。実際に半日ぶんそうなりました。\n"
            "  つながらないときは【記録せずに、その旨を伝える】のが正解です。"
        )

    def whoami(self) -> dict:
        """
        いま動いているのが【どの複製か】【誰としてログインしているか】を返す。

        つながらない・数字が合わない と思ったら、まずこれを呼ぶ。
        返り値の "このファイルの場所" が思っている場所と違えば、
        古い複製が動いている。

            j.whoami()
            → {"版": "2026-08-09.3",
               "このファイルの場所": "...",
               "読んだ設定": "cowork.json",
               "ログイン中": "Cowork",
               "接続先": "https://xxxx.supabase.co"}
        """
        here = Path(__file__).parent
        # どこから読んだかは推測せず、実際に値が一致した場所を答える。
        # 「たぶんここ」で報告すると、食い違いを探すときに遠回りになる。
        used = "分からない"
        if os.environ.get("JISUI_EMAIL") == self._email:
            used = "環境変数"
        else:
            env_file = here / CONFIG_NAME
            if env_file.exists() and f"JISUI_EMAIL={self._email}" in env_file.read_text(encoding="utf-8"):
                used = CONFIG_NAME
            else:
                jf = here / "cowork.json"
                if jf.exists():
                    try:
                        if json.loads(jf.read_text(encoding="utf-8")).get("JISUI_EMAIL") == self._email:
                            used = "cowork.json"
                    except Exception:
                        pass
        name = None
        try:
            rows = self.select("household_members", "display_name", user_id=f"eq.{self.user_id}")
            name = rows[0]["display_name"] if rows else None
        except Exception:
            pass
        return {
            "版": SKILL_VERSION,
            "このファイルの場所": str(here),
            "読んだ設定": used,
            "ログイン中": name or f"(user_id …{str(self.user_id)[-6:]})",
            "接続先": self.url,
            # 【受け渡し場所も答える】
            # 届かなかったときの記録はここに置く。ここがパソコン側の見張りと
            # 食い違っていると、置いても誰も取りに来ない。実際にそうなった。
            # Windows のパスではなく、いま本当に書ける場所を答えること。
            "受け渡し場所": INBOX_DIR,
            # 【ここで「在るか」を調べないこと】
            # Cowork からはパソコンのフォルダが見えないので、調べると必ず
            # 「無い」と答える。書けるのに書けないと言い出す。
            "受け渡し場所の確かめ方": f"device_list_dir で {INBOX_DIR} を一覧する",
        }

    def _get_token(self) -> str:
        """
        アクセストークンは1時間ほど有効。使い回してログイン回数を減らす。

        【誰のトークンかを必ず確かめる】
        以前はここに「有効期限だけ」を見て使い回していた。
        そのため接続情報を別のアカウントに変えても、前の人のトークンが
        期限切れになるまで使われ続け、【設定と実際のログインが食い違った】。
        しかも動いてはいるのでエラーにならず、気づけない。
        このスキルは同じ事故(古い設定のまま静かに動き続ける)を
        一度起こしているので、同じ形の穴は塞いでおく。
        """
        if TOKEN_CACHE.exists():
            try:
                cached = json.loads(TOKEN_CACHE.read_text(encoding="utf-8"))
                same_user = cached.get("email") == self._email
                if same_user and cached.get("expires_at", 0) > time.time() + 60:
                    return cached["access_token"]
            except (json.JSONDecodeError, KeyError):
                pass

        res = _request(
            "POST",
            f"{self.url}/auth/v1/token?grant_type=password",
            {"apikey": self.key, "Content-Type": "application/json"},
            {"email": self._email, "password": self._password},
        )
        token = res["access_token"]
        TOKEN_CACHE.write_text(
            json.dumps({
                "access_token": token,
                "expires_at": time.time() + res.get("expires_in", 3600),
                "email": self._email,          # 誰のトークンかを一緒に残す
            }),
            encoding="utf-8",
        )
        return token

    def _headers(self, extra: dict[str, str] | None = None) -> dict[str, str]:
        headers = {
            "apikey": self.key,
            "Authorization": f"Bearer {self._token}",
            "Content-Type": "application/json",
        }
        if extra:
            headers.update(extra)
        return headers

    def _fetch_user_id(self) -> str:
        """
        自分の user_id。DB の auth.uid() と同じ値になる。

        何に使うか: 個人予定の owner_id、TODO の done_by、
        そして「非公開タグを付けた予定の持ち主は必ず自分」という決まりの実現。

        トークン(JWT)の中に入っているので、普段は通信せずに取り出す。
        形が変わったときのために、API に聞く道も残してある。
        """
        try:
            payload = self._token.split(".")[1]
            payload += "=" * (-len(payload) % 4)          # base64 の詰め物を戻す
            return json.loads(base64.urlsafe_b64decode(payload))["sub"]
        except (IndexError, ValueError, KeyError):
            return _request("GET", f"{self.url}/auth/v1/user", self._headers())["id"]

    def _fetch_household_id(self) -> str:
        rows = _request(
            "GET",
            f"{self.url}/rest/v1/household_members?select=household_id",
            self._headers(),
        )
        if not rows:
            raise JisuiError(
                "世帯が見つかりません。household_members にこのユーザーが登録されているか確認してください。"
            )
        return rows[0]["household_id"]

    # ------------------------------------------------------ 基本の読み書き

    def select(self, table: str, select: str = "*", **filters: Any) -> list[dict]:
        """
        filters は PostgREST の書き方。例: status="eq.未購入"

        同じ列に2つ条件を付けたいときはリストで渡す(AND になる)。
            date=["gte.2026-08-01", "lte.2026-08-07"]
        """
        params: list[tuple[str, str]] = [("select", select)]
        for key, value in filters.items():
            if isinstance(value, (list, tuple)):
                params.extend((key, str(v)) for v in value)
            else:
                params.append((key, str(value)))
        query = urllib.parse.urlencode(params)
        return _request("GET", f"{self.url}/rest/v1/{table}?{query}", self._headers()) or []

    def insert(self, table: str, rows: list[dict]) -> list[dict]:
        """
        household_id は自動で補う。付け忘れると RLS に弾かれるため。

        【全部の行で列をそろえる】
        PostgREST は一括挿入のとき「全ての行が同じ列を持つこと」を求める。
        1行目にあって2行目に無い列があると
        400 PGRST102 "All object keys must match" で【1行も入らない】。
        レシピのように、任意の欄(freeze_notes など)を持つ行と持たない行が
        混ざるのは普通なので、ここでそろえる。足りないぶんは null。
        実際にこれでレシピ2件の登録が丸ごと落ちた。
        """
        keys: list[str] = []
        for row in rows:
            for k in row:
                if k not in keys:
                    keys.append(k)
        payload = [
            {"household_id": self.household_id, **{k: row.get(k) for k in keys}}
            for row in rows
        ]
        # household_id は入れずに残す。適用するのは別の人・別の世帯かもしれないので、
        # 受け渡し JSON には「何を入れたいか」だけを書き、世帯は適用側が付ける。
        with _capturing(("insert", {"table": table, "rows": rows})):
            return _request(
                "POST",
                f"{self.url}/rest/v1/{table}",
                self._headers({"Prefer": "return=representation"}),
                payload,
            ) or []

    def update(self, table: str, patch: dict, **filters: str) -> list[dict]:
        query = urllib.parse.urlencode(filters)
        return _request(
            "PATCH",
            f"{self.url}/rest/v1/{table}?{query}",
            self._headers({"Prefer": "return=representation"}),
            patch,
        ) or []

    def delete(self, table: str, **filters: str) -> None:
        query = urllib.parse.urlencode(filters)
        _request("DELETE", f"{self.url}/rest/v1/{table}?{query}", self._headers())

    # ------------------------------------------------------- よく使う操作

    def context(self) -> dict:
        """
        献立を考えるのに必要な材料を一度に取る。
        設計書5の作法(苦手を使わない・無い器具を使わない・常備品は買わない)を
        守るために、毎回これを見てから提案する。
        """
        return {
            "在庫": self.select("inventory", "name,qty,unit,location,expiry"),
            "常備品": self.select("pantry", "name,category,stock,staple"),
            "好み・方針": self.select("preferences", "kind,item,memo"),
            "調理器具": self.select("equipment", "name,memo"),
            "直近の調理": self.select(
                "cook_log", "date,name,rating", order="date.desc", limit="20"
            ),
            "これからの献立": self.select("meal_plan", "date,slot,name,status", order="date"),
            "買い物リスト": self.select(
                "shopping_list", "item,qty,reason,section,status", status="eq.未購入"
            ),
        }

    def add_shopping(self, items: list[dict]) -> list[dict]:
        """
        買い物リストに足す。items の例:
          {"item": "鶏むね肉", "qty": "2枚", "reason": "8/9 唐揚げ", "section": "肉・魚"}
        常備品にあるもの・米は載せない(設計書5)。判断は呼ぶ側で行う。
        """
        # sort_order を取りに行く select も壁に当たる。だから並べ替えの前から包む。
        with _capturing(("add_shopping", {"items": items})):
            base = self.select("shopping_list", "sort_order")
            next_order = max((r["sort_order"] for r in base), default=0) + 10
            rows = []
            for i, item in enumerate(items):
                rows.append({"sort_order": next_order + i * 10, "status": "未購入", **item})
            return self.insert("shopping_list", rows)

    def add_inventory(self, items: list[dict]) -> list[dict]:
        """
        在庫に足す。{"name","qty","unit","location","expiry","price","bought_on"}

        【送る前に location を確かめる理由】
        add_receipt は先に transactions を1行入れてから、あとでここを呼ぶ。
        ここで check 制約違反(23514)を食らって失敗すると、入れ直したときに
        支出側の重複よけが当たって「済んだこと」になり、
        【支出だけ入って在庫が永久に入らない】状態になる。
        あとから見ても原因が分からない壊れ方なので、通信する前に止める。
        """
        for i, it in enumerate(items):
            loc = it.get("location")
            if loc is not None and loc not in INVENTORY_LOCATIONS:
                raise JisuiError(
                    "在庫 %d 件目「%s」の location が %r です。使えるのは %s のどれか。\n"
                    "うちの冷蔵庫(日立 R-HWC54Y)の引き出しに対応している。\n"
                    "肉・魚は氷温、葉物と根菜は野菜、玉ねぎ・いも類・未開封の調味料は常温。\n"
                    "切ってある野菜は冷蔵(氷温に入れてはいけない)。"
                    % (i + 1, it.get("name"), loc, " / ".join(INVENTORY_LOCATIONS))
                )
        return self._add_inventory_raw(items)

    def _add_inventory_raw(self, items: list[dict]) -> list[dict]:
        """在庫に足す。{"name","qty","unit","location","expiry","price","bought_on"}"""
        return self.insert("inventory", items)

    def week(self, start_date: str, days: int = 7) -> dict:
        """
        ある期間の献立・予定・家事をまとめて取る。「来週の予定は?」に答えるとき用。
        アプリのカレンダー画面と同じものが見える。
        """
        end = _add_days(start_date, days - 1)
        span = [f"gte.{start_date}", f"lte.{end}"]
        return {
            "献立": self.select("meal_plan", "date,slot,name,status", date=span, order="date"),
            "予定": self.select(
                "events", "id,date,end_date,start_time,title,owner_id", date=span, order="date"
            ),
            "家事": self.select("chores", "id,name,weekdays,monthday,assignee_id", active="eq.true"),
            "家事の記録": self.select("chore_log", "chore_id,date,done_by", date=span),
        }

    def money(self, year_month: str) -> dict:
        """その月の家計。支出・収入・予算・資産をまとめて見る。"""
        span = [f"gte.{year_month}-01", f"lte.{year_month}-31"]
        return {
            "支出": self.select(
                "transactions",
                "date,amount,merchant_raw,category,source,needs_review",
                date=span,
                order="date.desc",
            ),
            "収入": self.select("income", "date,amount,source", date=span),
            "予算": self.select("budgets", "category,amount,year_month"),
            "口座・資産・負債": self.select("accounts", "id,name,kind,category", active="eq.true"),
            "残高": self.select("balances", "account_id,year_month,amount", year_month=f"eq.{year_month}"),
        }


    # -------------------------------------------------- 予定(カレンダー)
    #
    # ここから下は 11_schema_v5.sql を実行してから使える。
    # v5 で足す想定の形(SQL 側で名前を変えたときは、この節も一緒に直すこと):
    #
    #   alter table events add column location text;       -- 場所
    #   alter table events add column url text;            -- 地図・申込ページなど
    #   alter table events add column items text;          -- 持ち物
    #   alter table events add column notify_min integer;  -- 開始の何分前に通知するか
    #
    #   create table calendar_tags (                     -- タグ(色分けの札)
    #     id bigserial primary key,
    #     household_id uuid not null references households(id) on delete cascade,
    #     name text not null,
    #     color text not null default 'violet',
    #     private boolean not null default false,        -- true = 付けた本人しか見られない
    #     owner_id uuid,                                 -- private のときだけ入る
    #     sort_order integer not null default 0,
    #     active boolean not null default true
    #   );
    #   alter table events add column tag_id bigint references calendar_tags(id);
    #   alter table events add column private_owner_id uuid;   -- ▲ トリガが決める。書かないこと
    #
    # 【非公開タグ = 相手にとっては「その予定は存在しない」】
    #   private が true のタグを付けた予定は、保存した瞬間に
    #   データベースのトリガが events.private_owner_id に持ち主を書き、
    #   RLS が「private_owner_id が空か、自分のときだけ返す」となる。
    #   だから相手のアプリにも、相手の Cowork にも、1行も出てこない。
    #   逆も同じで、【夫の資格情報で動くこの db.py からは、妻の非公開予定は見えない】。
    #   予定の件数が合わなくても、それは壊れているのではなく設計どおり。
    #   「消えた?」と思ったら、まずここを思い出すこと。
    #
    # 【events.owner_id と混同しない】
    #   owner_id は「誰の用事か」という表示上の札で、見える範囲とは無関係。
    #   見える範囲を決めるのは tag_id だけ。
    #   private_owner_id をここから書こうとしてもトリガに上書きされる。

    def tags(self) -> list[dict]:
        """
        予定に付けられるタグの一覧。`private` が true のものが非公開タグ。

        非公開タグを付けた予定は【付けた本人にしか見えない】。
        相手が非公開で入れた予定は、ここからは一切見えない(RLS が返さない)。
        相手の非公開タグそのものもこの一覧には出ない。
        見えないのは不具合ではないので、探し回らないこと。
        """
        try:
            return self.select(
                "calendar_tags",
                "id,name,color,private,owner_id,sort_order,active",
                active="eq.true",
                order="sort_order,name",
            )
        except JisuiError as e:
            raise _v5_error(e) from e

    def _tag_by_name(self, name: str) -> dict:
        """タグ名 → タグの行。会話の途中でタグが増えるので、毎回聞きに行く。"""
        for t in self.tags():
            if t["name"] == name:
                return t
        names = "、".join(t["name"] for t in self.tags()) or "(なし)"
        raise JisuiError(
            f"「{name}」というタグはありません。今あるのは: {names}\n"
            "新しく作るならアプリの 予定 → タグ から(非公開かどうかもそこで決める)。"
        )

    def _resolve_tag_id(self, tag: str | int | None) -> int | None:
        """タグ名でも番号でも受ける。会話からは名前で来るのが普通。"""
        if tag is None:
            return None
        if isinstance(tag, int):
            return tag
        return int(self._tag_by_name(tag)["id"])

    def _event(self, event_id: int) -> dict:
        """1件読む。直す前・消す前に必ず通して、存在と中身を確かめるため。"""
        rows = self.select("events", "*", id=f"eq.{event_id}")
        if not rows:
            raise JisuiError(
                f"id={event_id} の予定が見つかりません。もう消えているか、"
                "相手の非公開予定です(非公開の予定は id を知っていても見えません)。"
            )
        return rows[0]

    def add_event(
        self,
        date: str,
        title: str,
        *,
        start_time: str | None = None,
        end_time: str | None = None,
        end_date: str | None = None,
        all_day: bool = False,
        memo: str | None = None,
        location: str | None = None,
        url: str | None = None,
        items: str | None = None,
        notify_min: int | None = None,
        tag: str | int | None = None,
        mine: bool | None = None,
        repeat: str = "なし",
        repeat_until: str | None = None,
    ) -> dict:
        """
        予定を1件入れる。返すのは入った行(id が入っているので、続けて直せる)。

        date は "2026-08-12" の形で渡す。**「来週の火曜」をここで解決しない。**
        今日が何日かを知っているのは呼ぶ側なので、日付に直してから渡すこと。

          all_day=True  終日にする。start_time / end_time を空にする
                        (schema_v2 からの決まりで「start_time が空 = 終日」)
          end_date      複数日にまたがる予定の最終日
          mine=True     「自分の用事」という表示上の札。【見える範囲とは別】
          tag           タグの名前(または id)。使えるものは tags() で見る。
                        【見える範囲を決めるのはここだけ】
          items         持ち物。改行区切りで複数書ける
          notify_min    開始の何分前に通知するか。30 なら30分前
          repeat        なし / 毎週 / 隔週 / 毎月 / 毎年
                        繰り返しは行を1本だけ持ち、展開はアプリ側がやる
                        (消すときに全部消えるほうが分かりやすいため)

        非公開タグ(tags() で private=true のもの)を付けると、この予定は
        自分にしか見えなくなる。相手の画面には存在しないことになるので、
        相手からはその時間が空いているように見える。
        予定を合わせたいものには使わないこと。
        「誰の秘密か」を決めるのはデータベースのトリガで、ここからは書かない。
        """
        if repeat not in EVENT_REPEATS:
            raise JisuiError(f"repeat は {' / '.join(EVENT_REPEATS)} のどれか。受け取った値: {repeat}")
        if end_date and end_date < date:
            raise JisuiError(f"end_date({end_date})が date({date})より前になっています。")
        if notify_min is not None and notify_min < 0:
            raise JisuiError("notify_min は「開始の何分前か」なので 0 以上で渡してください。")
        if all_day:
            start_time = None
            end_time = None

        # つながらないとき用の控え。タグを引く select も壁に当たるので、その前から包む。
        _args = {
            "date": date, "title": title, "start_time": start_time, "end_time": end_time,
            "end_date": end_date, "all_day": all_day, "memo": memo, "location": location,
            "url": url, "items": items, "notify_min": notify_min, "tag": tag,
            "mine": mine, "repeat": repeat, "repeat_until": repeat_until,
        }
        with _capturing(("add_event", _args)):
            owner_id = self.user_id if mine else None
            tag_id = self._resolve_tag_id(tag)

            row: dict[str, Any] = {
                "date": date,
                "title": title,
                "owner_id": owner_id,
                "created_by": self.user_id,
                "repeat": repeat,
            }
            # 値が None の列は送らない。11_schema_v5.sql をまだ流していない環境でも、
            # 新しい列を使わないかぎり今までどおり予定を入れられるようにするため。
            optional = {
                "end_date": end_date, "start_time": start_time, "end_time": end_time,
                "memo": memo, "location": location, "url": url, "items": items,
                "notify_min": notify_min, "tag_id": tag_id, "repeat_until": repeat_until,
            }
            row.update({k: v for k, v in optional.items() if v is not None})

            try:
                return self.insert("events", [row])[0]
            except JisuiError as e:
                raise _v5_error(e) from e

    def update_event(self, event_id: int, **patch: Any) -> dict:
        """
        予定を直す。渡した列だけ変える。

            j.update_event(12, start_time="19:00", location="西宮北口 3番出口")
            j.update_event(12, mine=True)          # 共有 → 自分だけの予定に
            j.update_event(12, all_day=True)       # 時刻を消して終日に

        `mine` / `all_day` / `tag` は書きやすさのための別名で、
        中で owner_id / start_time / tag_id に直す。
        それ以外は events の列名をそのまま使う(使える列は EVENT_COLUMNS)。
        知らない列は黙って無視せずエラーにする。打ち間違いに気づけないほうが怖いため。

        直せるのは自分に見えている予定だけ。相手の非公開予定は id を知っていても
        「見つかりません」になる。これは正しい動作。
        日付をずらすだけなら move_event のほうが安全(複数日の予定の長さを保つ)。
        """
        self._event(event_id)                        # 先に読む: 存在確認のため

        if "tag" in patch:
            patch["tag_id"] = self._resolve_tag_id(patch.pop("tag"))
        if "mine" in patch:
            patch["owner_id"] = self.user_id if patch.pop("mine") else None
        if "all_day" in patch:
            if patch.pop("all_day"):
                patch["start_time"] = None
                patch["end_time"] = None

        unknown = set(patch) - EVENT_COLUMNS
        if unknown:
            raise JisuiError(
                f"events にない列です: {', '.join(sorted(unknown))}\n"
                f"使えるのは: {', '.join(sorted(EVENT_COLUMNS))}(ほかに mine / all_day / tag)"
            )
        if "repeat" in patch and patch["repeat"] not in EVENT_REPEATS:
            raise JisuiError(f"repeat は {' / '.join(EVENT_REPEATS)} のどれか。")
        if not patch:
            raise JisuiError("直す中身がありません。列名=値 を1つ以上渡してください。")

        # 【注意】共有タグ → 非公開タグ に付け替えると、その予定は
        # その場で相手の画面から消える(相手には何の知らせも行かない)。
        # 逆に非公開 → 共有 に戻すと、隠していた予定が相手に出る。
        # どちらも 1 行の書き換えで起きるので、人に確かめてからやること。

        try:
            rows = self.update("events", patch, id=f"eq.{event_id}")
        except JisuiError as e:
            raise _v5_error(e) from e
        if not rows:
            raise JisuiError(f"id={event_id} の予定を直せませんでした。もう一度 find_events で探してください。")
        return rows[0]

    def move_event(self, event_id: int, new_date: str, new_start_time: str | None = None) -> dict:
        """
        予定を別の日に動かす。「歯医者、来週にずらして」の受け口。

        複数日の予定(end_date あり)は、同じ長さのまま平行移動する。
        date だけ変えると期間が壊れる(3泊が0泊になる)ため、ここで面倒を見る。
        new_start_time を渡せば時刻も変わる。渡さなければ時刻は元のまま。

        new_date は "2026-08-19" の形。「来週」を日付に直すのは呼ぶ側の仕事。
        """
        current = self._event(event_id)
        patch: dict[str, Any] = {"date": new_date}

        if current.get("end_date"):
            patch["end_date"] = _add_days(
                current["end_date"], _days_between(new_date, current["date"])
            )
        if new_start_time:
            patch["start_time"] = new_start_time

        # 繰り返しの終わりより後ろへ動かすと、1回も出ない予定になってしまう。
        if (
            current.get("repeat", "なし") != "なし"
            and current.get("repeat_until")
            and current["repeat_until"] < new_date
        ):
            raise JisuiError(
                f"この予定は {current['repeat_until']} までの繰り返しなので、"
                f"{new_date} に動かすと1回も表示されなくなります。\n"
                "update_event で repeat_until も一緒に延ばしてください。"
            )

        rows = self.update("events", patch, id=f"eq.{event_id}")
        if not rows:
            raise JisuiError(f"id={event_id} の予定を動かせませんでした。")
        return rows[0]

    def delete_event(self, event_id: int, *, confirm: bool = False) -> dict:
        """
        予定を消す。**既定では消さない。**

        confirm=False(既定)のときは「何が消えるか」を返すだけで、DB は触らない。
        中身を本人に見せて、いいと言われてから confirm=True でもう一度呼ぶ。
        取り消しの仕組みが無いので、この2段構えにしてある。

        一緒に消えるもの:
          ・その予定に付いたコメント(event_comments。外部キーの cascade で消える)
          ・繰り返しの予定は行が1本しかないため、【全部の回】が消える
            1回だけ休みたいなら、消さずに move_event でずらすほうがよい
        """
        current = self._event(event_id)
        comments = self.select("event_comments", "id,body", event_id=f"eq.{event_id}")
        result = {
            "消える予定": current,
            "一緒に消えるコメント": comments,
            "繰り返し": current.get("repeat", "なし"),
            "消した": False,
        }
        if not confirm:
            return result

        self.delete("events", id=f"eq.{event_id}")
        result["消した"] = True
        return result

    def find_events(
        self,
        keyword: str | None = None,
        start: str | None = None,
        end: str | None = None,
        limit: int = 100,
    ) -> list[dict]:
        """
        予定を探す。「歯医者の予定いつだっけ」に答えるための入口。

            j.find_events("歯医者")                      # いつでもいいから探す
            j.find_events(start="2026-08-01", end="2026-08-31")   # 8月の予定
            j.find_events("旅行", start="2026-08-09")    # 今日以降の旅行

        keyword は 題名・メモ・場所・持ち物 をまとめて部分一致で見る(大小文字は区別しない)。
        start / end は "2026-08-01" の形。片方だけでもよい。両方省くと過去も未来も対象。
        複数日の予定は開始日で判定する(期間の途中に start を置いても引っかからない)。

        相手が非公開タグで入れた予定は、ここには出てこない。RLS が返さないためで、
        壊れているわけではない。
        """
        filters: dict[str, Any] = {}

        span = []
        if start:
            span.append(f"gte.{start}")
        if end:
            span.append(f"lte.{end}")
        if span:
            filters["date"] = span

        if keyword:
            # PostgREST の or=(...) は "," と ")" を区切りとして読む。
            # 値を " で囲えばその中は文字として扱われるので、囲ってから渡す。
            safe = keyword.replace('"', "").replace("\\", "")
            like = f'"*{safe}*"'
            filters["or"] = (
                f"(title.ilike.{like},memo.ilike.{like},"
                f"location.ilike.{like},items.ilike.{like})"
            )

        columns = (
            "id,date,end_date,start_time,end_time,title,memo,location,url,items,"
            "notify_min,tag_id,owner_id,repeat,repeat_until"
        )
        try:
            return self.select("events", columns, order="date,start_time", limit=str(limit), **filters)
        except JisuiError as e:
            raise _v5_error(e) from e

    # ---------------------------------------------------- やること(TODO)
    #
    # 11_schema_v5.sql で足す想定:
    #   alter table todos add column parent_id bigint references todos(id) on delete cascade;
    #   alter table todos add column repeat text not null default 'なし';
    #   alter table todos add column repeat_until date;
    #   alter table todos add column sort_order integer not null default 0;
    #
    # 入れ子は【親→子の2階まで】。アプリの表示がその前提で作ってあるので、
    # 孫を作らないよう add_todo / update_todo で止めている。

    def _todo(self, todo_id: int) -> dict:
        """1件読む。直す前・消す前の確認用。"""
        rows = self.select("todos", "*", id=f"eq.{todo_id}")
        if not rows:
            raise JisuiError(f"id={todo_id} のやることが見つかりません。todo_tree() で一覧を見てください。")
        return rows[0]

    def _member_id(self, who: str) -> str:
        """
        「自分」や表示名から user_id を引く。
        会話では uuid ではなく名前で担当を言うので、その橋渡し。
        """
        if who in ("自分", "私", "me", "自分で"):
            return self.user_id
        if len(who) == 36 and who.count("-") == 4:       # uuid をそのまま渡された
            return who

        members = self.select("household_members", "user_id,display_name")
        for m in members:
            if m.get("display_name") == who:
                return m["user_id"]
        names = [m.get("display_name") or m["user_id"] for m in members]
        raise JisuiError(
            f"「{who}」という人が世帯にいません。いるのは: {', '.join(names)}\n"
            "自分に割り当てるなら「自分」と書いてください。"
        )

    def add_todo(
        self,
        title: str,
        due_date: str | None = None,
        assignee: str | None = None,
        parent_id: int | None = None,
        repeat: str | None = None,
        subtasks: list[str] | None = None,
        detail: str | None = None,
    ) -> dict:
        """
        やることを足す。子タスクまで一度に作れる。

            j.add_todo("旅行の準備", due_date="2026-09-01",
                       subtasks=["宿を予約する", "切符を取る", "旅行保険に入る"])

        assignee は「自分」か、相手の表示名(household_members.display_name)。
        省くと担当なし(どちらがやってもよい)。
        repeat は なし / 毎日 / 毎週 / 隔週 / 毎月 / 毎年。
        繰り返しは行を1本だけ持ち、次の回を出すのはアプリ側の仕事(events と同じ考え方)。
        ここで次の回を作ってしまうと、アプリと二重に増えるため作らない。

        子タスクには期限も担当も付けない。親と違うことが多いので、
        必要なら後から update_todo で個別に付ける。

        返り値: {"todo": 親の行, "subtasks": 子の行の一覧}
        """
        if repeat is not None and repeat not in TODO_REPEATS:
            raise JisuiError(f"repeat は {' / '.join(TODO_REPEATS)} のどれか。受け取った値: {repeat}")
        # つながらないとき用の控え。担当を引く select も壁に当たるので、その前から包む。
        _args = {
            "title": title, "due_date": due_date, "assignee": assignee,
            "parent_id": parent_id, "repeat": repeat, "subtasks": subtasks,
            "detail": detail,
        }
        with _capturing(("add_todo", _args)):
            return self._add_todo(**_args)

    def _add_todo(
        self,
        title: str,
        due_date: str | None = None,
        assignee: str | None = None,
        parent_id: int | None = None,
        repeat: str | None = None,
        subtasks: list[str] | None = None,
        detail: str | None = None,
    ) -> dict:
        """add_todo の中身。引数は add_todo とまったく同じ。"""
        if parent_id is not None:
            parent = self._todo(parent_id)
            if parent.get("parent_id"):
                raise JisuiError(
                    "入れ子は親→子の2階までにしてあります(アプリの表示がその前提)。\n"
                    f"「{parent['title']}」はすでに子タスクなので、その下には作れません。"
                )
            if subtasks:
                raise JisuiError("子タスクの下にさらに子タスクは作れません(2階まで)。")

        row: dict[str, Any] = {"title": title, "status": "open"}
        if detail:
            row["detail"] = detail
        if due_date:
            row["due_date"] = due_date
        if parent_id is not None:
            row["parent_id"] = parent_id
        if repeat:
            row["repeat"] = repeat
        if assignee:
            row["assignee_id"] = self._member_id(assignee)

        try:
            todo = self.insert("todos", [row])[0]
            children: list[dict] = []
            if subtasks:
                children = self.insert(
                    "todos",
                    [
                        {"title": t, "status": "open", "parent_id": todo["id"],
                         "sort_order": (i + 1) * 10}
                        for i, t in enumerate(subtasks)
                    ],
                )
        except JisuiError as e:
            raise _v5_error(e) from e
        return {"todo": todo, "subtasks": children}

    def update_todo(self, todo_id: int, **patch: Any) -> dict:
        """
        やることを直す。渡した列だけ変える。

            j.update_todo(5, due_date="2026-08-20", assignee="自分")
            j.update_todo(5, parent_id=3)          # 独立していたものを子タスクにする

        `assignee` は書きやすさのための別名で、中で assignee_id に直す。
        完了・未完了の切り替えはここではできない。done_at と done_by も一緒に
        記録する必要があるので、done_todo / reopen_todo を使う。
        """
        if "assignee" in patch:
            patch["assignee_id"] = self._member_id(patch.pop("assignee"))
        if "status" in patch:
            raise JisuiError(
                "status はここでは変えられません。"
                "完了は done_todo(id)、戻すのは reopen_todo(id) を使ってください"
                "(done_at と done_by も一緒に記録するため)。"
            )

        unknown = set(patch) - TODO_COLUMNS
        if unknown:
            raise JisuiError(
                f"todos にない列です: {', '.join(sorted(unknown))}\n"
                f"使えるのは: {', '.join(sorted(TODO_COLUMNS))}(ほかに assignee)"
            )
        if "repeat" in patch and patch["repeat"] not in TODO_REPEATS:
            raise JisuiError(f"repeat は {' / '.join(TODO_REPEATS)} のどれか。")
        if not patch:
            raise JisuiError("直す中身がありません。列名=値 を1つ以上渡してください。")

        if patch.get("parent_id") is not None:
            if patch["parent_id"] == todo_id:
                raise JisuiError("自分自身を親にはできません。")
            parent = self._todo(patch["parent_id"])
            if parent.get("parent_id"):
                raise JisuiError("入れ子は親→子の2階まで。子タスクを親にはできません。")
            if self.select("todos", "id", parent_id=f"eq.{todo_id}"):
                raise JisuiError(
                    "子タスクを持っているものは、他の誰かの子にはできません(2階まで)。"
                )

        self._todo(todo_id)                          # 無い id を静かに素通りさせない
        try:
            rows = self.update("todos", patch, id=f"eq.{todo_id}")
        except JisuiError as e:
            raise _v5_error(e) from e
        if not rows:
            raise JisuiError(f"id={todo_id} のやることを直せませんでした。")
        return rows[0]

    @staticmethod
    def _next_due(due: str, repeat: str) -> str | None:
        """
        繰り返すやることの、次の期限。

        【アプリの lib/mutations.ts の nextDue と同じ規則にすること】
        ここがずれると、同じ「完了」を押したのに
        アプリからとチャットからで結果が変わる。使う人には理由が分からない。

        月をまたぐときは、その月に無い日(31日・2/29)を月末に寄せる。
        月末の支払いは月末に出したいため。
        """
        import datetime as _dt

        d = _dt.date.fromisoformat(due)

        def add_months(base: _dt.date, months: int) -> _dt.date:
            y, m = divmod(base.month - 1 + months, 12)
            y, m = base.year + y, m + 1
            # その月の最終日
            last = (_dt.date(y + (m // 12), (m % 12) + 1, 1) - _dt.timedelta(days=1)).day
            return _dt.date(y, m, min(base.day, last))

        if repeat == "毎日":
            d = d + _dt.timedelta(days=1)
        elif repeat == "毎週":
            d = d + _dt.timedelta(days=7)
        elif repeat == "隔週":
            d = d + _dt.timedelta(days=14)
        elif repeat == "毎月":
            d = add_months(d, 1)
        elif repeat == "毎年":
            d = add_months(d, 12)
        else:
            return None
        return d.isoformat()

    def done_todo(self, todo_id: int, *, with_subtasks: bool = True) -> dict:
        """
        やることを終わったことにする。done_at(今)と done_by(自分)も記録する。

        【繰り返すやることは、行を消さずに期限を次回へ進める】

        毎週のゴミ出しを完了にすると、status は open のまま
        due_date が次の週に進む。子タスクも未完了に戻して、親と一緒に次回へ持っていく。
        done_at / done_by は「最後にやった日 / 最後にやった人」として上書きする。

        新しい行を作らないのは、アプリが全行をスマホの中に保存する作りだから。
        行が増え続けると端末のキャッシュがそのまま太る
        (毎日のごみ出しを1年続けたら365行)。

        repeat_until を過ぎたら、次回へ進めずに完了で終わらせる。

        【アプリの setTodoDone と同じ動きにしてある】。
        片方だけ直すと、同じ操作なのに使った場所で結果が変わる。必ず両方直すこと。

        返り値: {"recurred": 次回へ進めたか, "next_due": 進めた先, "todo": 更新後の行}
        """
        current = self._todo(todo_id)
        repeat = (current.get("repeat") or "なし")
        due = current.get("due_date")
        until = current.get("repeat_until")

        nxt = self._next_due(due, repeat) if (repeat != "なし" and due) else None
        carry_on = bool(nxt) and (not until or nxt <= until)

        if carry_on:
            patch = {"status": "open", "due_date": nxt,
                     "done_at": _now(), "done_by": self.user_id}
        else:
            patch = {"status": "done", "done_at": _now(), "done_by": self.user_id}

        try:
            rows = self.update("todos", patch, id=f"eq.{todo_id}")
            if with_subtasks:
                if carry_on:
                    # 次回へ持っていくので、子は未完了に戻す。
                    # 親だけ進めて子を終わったままにすると、次の回の準備が
                    # すでに済んだことになってしまう。
                    self.update("todos", {"status": "open", "done_at": None, "done_by": None},
                                parent_id=f"eq.{todo_id}")
                else:
                    self.update("todos", {"status": "done", "done_at": _now(),
                                          "done_by": self.user_id},
                                parent_id=f"eq.{todo_id}", status="eq.open")
        except JisuiError as e:
            raise _v5_error(e) from e

        return {"recurred": carry_on, "next_due": nxt if carry_on else None,
                "todo": rows[0] if rows else current}

    def reopen_todo(self, todo_id: int) -> dict:
        """
        終わったことにしたやることを、また未完了に戻す。
        done_at と done_by も空に戻す(残しておくと、いつ終わったのか分からなくなる)。

        子タスクは戻さない。間違えて親を完了にしただけのことが多く、
        全部戻すと終わっている子まで蒸し返してしまうため。
        """
        self._todo(todo_id)
        rows = self.update(
            "todos", {"status": "open", "done_at": None, "done_by": None}, id=f"eq.{todo_id}"
        )
        if not rows:
            raise JisuiError(f"id={todo_id} のやることを戻せませんでした。")
        return rows[0]

    def delete_todo(self, todo_id: int, *, confirm: bool = False) -> dict:
        """
        やることを消す。**既定では消さない。**

        confirm=False(既定)のときは「何が消えるか」を返すだけで、DB は触らない。
        子タスクも一緒に消えるので、まず中身を本人に見せて、
        いいと言われてから confirm=True でもう一度呼ぶ。

        終わったものを片づけたいだけなら、消さずに done_todo のほうがよい
        (記録が残り、あとで「あれいつやったっけ」に答えられる)。
        """
        current = self._todo(todo_id)
        try:
            children = self.select("todos", "id,title,status", parent_id=f"eq.{todo_id}")
        except JisuiError as e:
            raise _v5_error(e) from e

        result = {"消えるやること": current, "一緒に消える子タスク": children, "消した": False}
        if not confirm:
            return result

        # 子から先に消す。外部キーに cascade を付けてあれば親だけで消えるが、
        # 付け忘れていても取り残しが出ないよう、ここで明示的に消しておく。
        if children:
            self.delete("todos", parent_id=f"eq.{todo_id}")
        self.delete("todos", id=f"eq.{todo_id}")
        result["消した"] = True
        return result

    def todo_tree(self, include_done: bool = False) -> list[dict]:
        """
        やることを親子の入れ子で返す。会話で扱うには、平らな一覧より木のほうが分かりやすい。

        返すのは親の行の一覧で、それぞれに "subtasks" が付く(子が無ければ空の一覧)。
        include_done=True にすると終わったものも入る(既定は未完了だけ)。

        親が先に完了していて子が残っている場合、その子は行き場が無くなるので
        親と同じ高さに出す。見落とさないようにするため。
        """
        filters = {} if include_done else {"status": "eq.open"}
        try:
            rows = self.select("todos", "*", order="id", **filters)
        except JisuiError as e:
            raise _v5_error(e) from e

        # 期限の近い順。期限なしは最後に回す。
        # PostgREST の nullslast に頼らず手元で並べるのは、書き方の違いで
        # 丸ごと失敗するより、確実に並ぶほうがよいため。
        def order_key(t: dict) -> tuple[str, int]:
            return (t.get("due_date") or "9999-12-31", t["id"])

        nodes = {r["id"]: dict(r, subtasks=[]) for r in rows}
        roots: list[dict] = []
        for row in rows:
            node = nodes[row["id"]]
            parent = nodes.get(row.get("parent_id")) if row.get("parent_id") else None
            if parent is not None:
                parent["subtasks"].append(node)
            else:
                roots.append(node)

        for node in nodes.values():
            node["subtasks"].sort(key=order_key)
        roots.sort(key=order_key)
        return roots

    # ------------------------------------------------ 家計簿(手元から吸収)

    def investments(self) -> dict:
        """
        投資の全体。手元の家計簿アプリから引き継いだ。
        月に1回、証券会社の画面を見ながら更新する使い方を想定している。
        """
        # 口座ごとに記録した日が違う(NISAは8/03、iDeCoは8/04 のように)。
        # 最新日で切ると、その日に触らなかった口座が丸ごと消えるので、
        # 全部取ってから銘柄ごとに一番新しいものを残す。
        rows = self.select("holdings", "*", order="as_of.desc")
        latest: dict[tuple[str, str], dict] = {}
        for row in rows:
            key = (row["account"], row["name"])
            if key not in latest:
                latest[key] = row
        as_of = max((r["as_of"] for r in latest.values()), default=None)
        return {
            "保有銘柄": list(latest.values()),
            "監視銘柄": self.select("watchlist", "*", order="code"),
            "直近の指標": self.select("watch_history", "*", order="as_of.desc", limit="60"),
            "資産の内訳": self.select("asset_details", "*"),
            "時点": as_of,
        }

    def outlook(self) -> dict:
        """将来の見通し。ローン残高の予定と俸給表。"""
        return {
            "ローン予定": self.select("loan_schedule", "*", order="year_month"),
            "俸給表": self.select("salary_table", "*", order="age"),
        }

    def todos(self, include_done: bool = False) -> list[dict]:
        """
        やることを平らな一覧で返す。件数を数えたいときや、そのまま流し読みしたいとき用。
        親子の関係まで見たいときは todo_tree() を使う。
        """
        filters = {} if include_done else {"status": "eq.open"}
        return self.select("todos", "*", order="id", **filters)

    def rules(self) -> list[dict]:
        """
        分類辞書を1回だけ取ってきて、照合する順に並べて返す。

        【並べ方: キーワードの長い順】
        「イオン」(食費)と「イオンシネマ」(娯楽)の両方が辞書にあるとき、
        長いほうを先に見ないと、細かく足した規則がいつまでも勝てない。
        長さが同じものは id 順(先に登録したほうが先)。
        こう決めておけば、何度取り込んでも同じ費目になる。**再現性がこの機能の命。**
        """
        rows = self.select("expense_rules", "keyword,category", order="id")
        rows.sort(key=lambda r: -len(r.get("keyword") or ""))   # 安定ソートなので同長は id 順のまま
        return rows

    @staticmethod
    def match_rule(rules: list[dict], merchant: str) -> str | None:
        """
        辞書 rules と店名 merchant を照合して費目を返す。当たらなければ None。

        2段構え。まず書いてあるままで部分一致を見て、駄目なら
        ならした形(_normalize_merchant)で見る。
        1段目を先に見るのは、これまでの当たり方を変えないため。
        2段目は当たる範囲を広げるだけで、狭めることはない。
        """
        for rule in rules:
            kw = rule.get("keyword") or ""
            if kw and kw in merchant:
                return rule["category"]

        norm = _normalize_merchant(merchant)
        for rule in rules:
            kw = _normalize_merchant(rule.get("keyword"))
            if kw and kw in norm:
                return rule["category"]
        return None

    def classify(self, merchant: str) -> str | None:
        """
        店名から費目を引く。分類辞書(expense_rules)に部分一致させる。

        AI の判断で辞書と違う費目を付けないこと。同じ店がその時々で
        違う費目になると、月次の比較が意味を失う。
        辞書に無い店は None を返すので、必ず本人に確認してから追記する。

        1件ずつ引くたびに辞書を取りに行く。何十件も回すときは
        rules() で1回だけ取ってから match_rule() を使うこと
        (import_card_csv はそうしている)。
        """
        return self.match_rule(self.rules(), merchant)

    def add_rule(self, keyword: str, category: str, note: str | None = None) -> None:
        """分類辞書に足す。本人の承認を得てから呼ぶ。"""
        self.insert("expense_rules", [{"keyword": keyword, "category": category, "note": note}])

    @staticmethod
    def dedup_hash(date: str, amount: int, merchant_raw: str) -> str:
        """カード明細との二重計上を照合するための鍵(設計書 5-2)。"""
        return hashlib.sha256(f"{date}|{amount}|{merchant_raw}".encode("utf-8")).hexdigest()

    def add_receipt(
        self,
        *,
        date: str,
        amount: int,
        merchant_raw: str,
        category: str = "食費",
        source: str = "レシート",
        items: list[dict] | None = None,
        inventory: list[dict] | None = None,
        needs_review: bool = False,
        memo: str | None = None,
    ) -> dict:
        """
        レシート1枚を、支出と在庫の両方に記録する(設計書 5-2)。
        items は receipt_items 用({"item","price"})、inventory は在庫に入れるもの。
        同じレシートを2回入れても増えないよう dedup_hash で弾く。

        つながらないときは JisuiOffline が出る。**その例外はこのレシートの中身を
        丸ごと抱えている**ので、e.handoff() を inbox に保存すれば記録は失われない。
        """
        # 引数をそのまま受け渡し用に控える。順番も名前も add_receipt の引数のまま
        # なので、適用側は j.add_receipt(**args) と呼ぶだけでよい。
        _args = {
            "date": date, "amount": amount, "merchant_raw": merchant_raw,
            "category": category, "source": source, "items": items,
            "inventory": inventory, "needs_review": needs_review, "memo": memo,
        }
        with _capturing(("add_receipt", _args)):
            digest = self.dedup_hash(date, amount, merchant_raw)
            existing = self.select("transactions", "id", dedup_hash=f"eq.{digest}")
            if existing:
                return {"transaction": existing[0], "skipped": True}

            tx = self.insert(
                "transactions",
                [
                    {
                        "date": date,
                        "amount": amount,
                        "merchant_raw": merchant_raw,
                        "category": category,
                        "source": source,
                        "memo": memo,
                        "dedup_hash": digest,
                        "needs_review": needs_review,
                    }
                ],
            )[0]

            if items:
                _request(
                    "POST",
                    f"{self.url}/rest/v1/receipt_items",
                    self._headers({"Prefer": "return=representation"}),
                    [{"transaction_id": tx["id"], **i} for i in items],
                )
            added = self.add_inventory(inventory) if inventory else []
            return {"transaction": tx, "inventory": added, "skipped": False}

    # ------------------------------------------- カード明細 CSV の一括取り込み

    def import_card_csv(
        self,
        path: str | None = None,
        *,
        data: bytes | str | None = None,
        dry_run: bool = True,
        on_unknown: str = "stop",
    ) -> dict:
        """
        カード明細の CSV を読んで transactions に入れる。**既定では書き込まない。**

        引退した家計簿スキル(C:\\Users\\mmizu\\jisui\\_引退\\家計簿\\skills\\_kakeibo_引退\\SKILL.md)に
        あった機能を、Supabase 版として戻したもの。流儀はそのまま:

          ・費目は分類辞書(expense_rules)で機械的に決める。
            **AI の判断で辞書と違う費目を付けない**(同じ店が月ごとに違う費目に
            なると、月次の比較が意味を失う)
          ・辞書に無い店は「初見の店」として報告するだけ。**勝手に辞書へ足さない**
          ・二重計上は dedup_hash で弾く
          ・口座番号・カード番号は列ごと捨てる

        【2回に分けて呼ぶ】
            r = j.import_card_csv(path)                 # 1回目: 読むだけ。何も書かない
            # r["初見の店"] を本人に見せて、費目を決めてもらう
            j.add_rule("マックスバリュ", "食費")          # 承認されたぶんだけ辞書に足す
            r = j.import_card_csv(path, dry_run=False)  # 2回目: ここで初めて入る
            j.archive_csv(path)                         # 報告してから processed/ へ移す

        on_unknown:
          "stop"   (既定) 初見の店が残っていたら書き込まずに止める
          "review" 初見の行を費目「要確認」・needs_review=True で入れる。
                   辞書には足さない(足すのは人の承認を得た add_rule だけ)

        data を渡せば、ファイルを開かずに中身から直接読める。
        Cowork のサンドボックスから C:\\Users\\mmizu\\jisui が見えないとき、
        エージェントが自分で読んだ中身を渡すために使う。
        """
        if on_unknown not in ("stop", "review"):
            raise JisuiError('on_unknown は "stop" か "review" のどちらかです。')
        if data is None:
            if path is None:
                raise JisuiError("path か data のどちらかを渡してください。")
            data = read_local_file(path)

        parsed = parse_card_csv(data, name=str(path) if path else None)
        rows = parsed["行"]

        # 【通信の壁に当たったときの備え】
        # 1行=1レコードで控える。費目はここでは付けない。辞書が引けないからで、
        # 費目を決めるのは inbox の JSON を適用する側(つながる場所)の仕事。
        with _capturing(*[("import_card_row", dict(r)) for r in rows]):
            rules = self.rules()

            table: list[dict] = []
            for r in rows:
                table.append({
                    **r,
                    "category": self.match_rule(rules, r["merchant_raw"]),
                    "dedup_hash": self.dedup_hash(r["date"], r["amount"], r["merchant_raw"]),
                })

            # 同じファイルの中で鍵がぶつかる行を先に見つける。
            # 【実際に起きている】例: 2026/6/16 の「ＥＴＣ 中部地区 540円」が2行。
            # 別々の料金所を通った本物の2件だが、dedup_hash は
            # 日付・金額・店名の3つだけで作るので同じ鍵になる。
            # transactions は (household_id, dedup_hash) が一意なので、
            # どうやっても1件しか入らない。黙って落とさず、必ず報告する。
            groups: dict[str, list[dict]] = {}
            for t in table:
                groups.setdefault(t["dedup_hash"], []).append(t)

            # すでに入っている鍵を調べる。1件ずつ問い合わせると行数ぶん往復するので
            # in.(...) でまとめて聞く。URL が長くなりすぎないよう100件ずつに割る。
            existing: set[str] = set()
            keys = list(groups)
            for i in range(0, len(keys), 100):
                chunk = keys[i:i + 100]
                got = self.select(
                    "transactions", "dedup_hash",
                    dedup_hash="in.(" + ",".join(chunk) + ")",
                )
                existing.update(g["dedup_hash"] for g in got)

            fresh = [g[0] for key, g in groups.items() if key not in existing]
            already = sum(len(g) for key, g in groups.items() if key in existing)
            crowded = [
                {"日付": g[0]["date"], "店名": g[0]["merchant_raw"],
                 "金額": g[0]["amount"], "同じ内容の行数": len(g)}
                for key, g in groups.items() if len(g) > 1 and key not in existing
            ]

            unknown: dict[str, dict] = {}
            for t in fresh:
                if t["category"] is None:
                    u = unknown.setdefault(
                        t["merchant_raw"],
                        {"店名": t["merchant_raw"], "件数": 0, "合計": 0, "初出": t["date"]},
                    )
                    u["件数"] += 1
                    u["合計"] += t["amount"]

            totals: dict[str, int] = {}
            for t in fresh:
                cat = t["category"] or "(辞書に無い)"
                totals[cat] = totals.get(cat, 0) + t["amount"]

            report: dict[str, Any] = {
                "ファイル": parsed["ファイル"],
                "形式": parsed["形式"],
                "文字コード": parsed["文字コード"],
                "読んだ行": len(rows),
                "取込対象": len(fresh),
                "スキップ(既にある)": already,
                "スキップ(読めない行)": parsed["読めない行"],
                # 別々の買い物なのに鍵が同じで入れられない行の【数】。
                # 一覧だけだと見落とすので、必ず数字でも出す。1件でもあれば報告すること。
                "入らない行(鍵が同じ)": sum(c["同じ内容の行数"] - 1 for c in crowded),
                "同じ鍵になってしまう行": crowded,
                "初見の店": sorted(unknown.values(), key=lambda u: -u["合計"]),
                "費目別合計": dict(sorted(totals.items(), key=lambda kv: -kv[1])),
                "書き込んだ": False,
            }

            if dry_run:
                report["次にすること"] = (
                    "初見の店の費目を本人に確認 → add_rule で辞書に足す → "
                    "import_card_csv(..., dry_run=False) をもう一度呼ぶ"
                    if unknown else
                    "import_card_csv(..., dry_run=False) をもう一度呼べば入る"
                )
                return report

            if unknown and on_unknown == "stop":
                names = "、".join(list(unknown)[:10])
                raise JisuiError(
                    f"辞書に無い店が {len(unknown)} 件あるので、1行も書き込みませんでした: {names}\n"
                    "本人に費目を確かめて add_rule(キーワード, 費目) で辞書に足してから、\n"
                    "もう一度 dry_run=False で呼んでください。\n"
                    'どうしても後回しにするなら on_unknown="review" で「要確認」として入ります。'
                )

            payload = []
            for t in fresh:
                category = t["category"] or "要確認"
                payload.append({
                    "date": t["date"],
                    "amount": t["amount"],
                    "merchant_raw": t["merchant_raw"],
                    "merchant_norm": t["merchant_norm"],
                    "category": category,
                    "source": t["source"],
                    "memo": t["memo"],
                    "dedup_hash": t["dedup_hash"],
                    # 「要確認」はレシートと重なっている見込みの行。人が見るまで印を残す。
                    "needs_review": category == "要確認",
                })

            # self.insert を使わず自分で投げているのは Prefer に
            # resolution=ignore-duplicates を足したいから。
            # 鍵の重なりは上で除いてあるが、途中で人がアプリから同じものを入れる
            # 可能性がある。それで 409 になると、その塊の全部が入らない。
            # 取りこぼしを黙って捨てるほうを選ぶ(一意制約が最後の砦になる)。
            inserted: list[dict] = []
            for i in range(0, len(payload), 100):
                got = _request(
                    "POST",
                    f"{self.url}/rest/v1/transactions?on_conflict=household_id,dedup_hash",
                    self._headers({"Prefer": "return=representation,resolution=ignore-duplicates"}),
                    [{"household_id": self.household_id, **row} for row in payload[i:i + 100]],
                )
                inserted.extend(got or [])

            report["書き込んだ"] = True
            report["取込件数"] = len(inserted)
            report["次にすること"] = (
                f"結果を報告してから archive_csv({parsed['ファイル']!r}) で processed/ へ移す"
            )
            return report

    @staticmethod
    def archive_csv(path: str, processed_dir: str | None = None) -> str:
        """
        取り込みの終わった CSV を inbox/ から processed/ へ移す。

        **取り込みを報告したあとで呼ぶ。**先に移すと、報告の途中で失敗したときに
        元の場所から消えていて、何を取り込もうとしたのか分からなくなる。

        同じ名前が processed/ にあっても【上書きしない】。
        カード会社は毎月おなじ名前(202608.csv など)で明細を出すので、
        上書きすると先月ぶんの原本が消える。-2, -3 と番号を足して残す。

        このパソコン上で動いているときだけ使える。Cowork(クラウド)からは
        そのフォルダが見えないので、移動はエージェントのファイル操作でやる。
        """
        src = Path(path)
        if not src.exists():
            raise JisuiError(f"ファイルがありません: {src}")
        if processed_dir:
            dst_dir = Path(processed_dir)
        elif src.parent.name == "inbox":
            dst_dir = src.parent.parent / "processed"
        else:
            dst_dir = src.parent / "processed"
        dst_dir.mkdir(parents=True, exist_ok=True)

        dst = dst_dir / src.name
        n = 2
        while dst.exists():
            dst = dst_dir / f"{src.stem}-{n}{src.suffix}"
            n += 1
        src.replace(dst)
        return str(dst)


# ============================================================
# カード明細 CSV の読み取り
#
# 【推測で書いていない。実物を開いて確かめた形だけを扱う】
#   C:\Users\mmizu\家計簿\processed\ にある本物の CSV が根拠。
#
#   三井住友カード  202608*.csv          cp932 / 見出し無し / 13列
#   楽天カード      enavi*.csv           utf-8(BOM付) / 見出し有り / 12列
#   イオンカード    meisai*.csv          cp932 / 前置き有り / 9列
#
# 同じフォルダに口座明細(RB-torihikimeisai.csv / ny*.csv /
# nyushukinmeisai_*.csv)も混ざっているが、【わざと扱わない】。理由は2つ。
#   1. 口座明細にはカード代金の引落が入っている。カード明細と両方入れると
#      同じ買い物を2回数えることになる
#   2. ny*.csv の日付は「6月5日」で年が書いていない。年を当てるのは推測になる
# 見分けて、その旨を言って止める。黙って読み違えるより良い。
# ============================================================

_SLASH_DATE = re.compile(r"^(\d{4})/(\d{1,2})/(\d{1,2})$")
_YYMMDD_DATE = re.compile(r"^(\d{2})(\d{2})(\d{2})$")

# 口座明細の見出し。見つけたら「カード明細ではない」と言って止めるために使う。
_BANK_HEADERS = {
    "取引日": "住信SBIネット銀行の口座明細",
    "取扱日付": "銀行口座の入出金明細(年が書かれていない)",
}


def _date_slash(text: str) -> str | None:
    """2026/7/29 → 2026-07-29。読めなければ None。"""
    m = _SLASH_DATE.match(unicodedata.normalize("NFKC", (text or "").strip()))
    if not m:
        return None
    try:
        return _date(int(m[1]), int(m[2]), int(m[3])).isoformat()
    except ValueError:
        return None


def _date_yymmdd(text: str) -> str | None:
    """
    260612 → 2026-06-12。イオンカードの明細は西暦の下2桁で書かれている。
    2000年代しか出ない前提で 2000 を足す(このスキルが扱う範囲では問題にならない)。
    """
    m = _YYMMDD_DATE.match(unicodedata.normalize("NFKC", (text or "").strip()))
    if not m:
        return None
    try:
        return _date(2000 + int(m[1]), int(m[2]), int(m[3])).isoformat()
    except ValueError:
        return None


def _to_int(text: str) -> int | None:
    """
    金額を整数の円にする。読めなければ None(推測で埋めない)。
    全角数字・カンマ・￥・値引のマイナスに対応する。
    """
    t = unicodedata.normalize("NFKC", (text or "").strip())
    for ch in (",", "¥", "\\", " ", "円"):
        t = t.replace(ch, "")
    if not t:
        return None
    negative = t[0] in "-△▲"
    t = t.lstrip("-+△▲")
    if not t.isdigit():
        return None
    return -int(t) if negative else int(t)


def _card_row(date: str, amount: int, merchant: str, source: str, memo: list[str]) -> dict:
    """明細1行 →  transactions に入れる形。番号らしきものはここで伏せる。"""
    raw = _mask_numbers(_clean_text(merchant))
    return {
        "date": date,
        "amount": amount,
        "merchant_raw": raw,
        "merchant_norm": _normalize_merchant(raw),
        "source": source,
        "memo": " / ".join(m for m in memo if m) or None,
    }


def _parse_smbc(rows: list[list[str]]) -> tuple[list[dict], list[dict]]:
    """
    三井住友カード。見出し行が無く、1行目からいきなり明細。
      0 利用日 2026/7/29   1 店名   2 利用者   3 支払方法   5 支払月 '26/08
      6 利用金額(円)   7 当月支払額   9 現地通貨額   10 通貨   11 レート
    金額は 6列目を使う。7列目は国内利用のときしか入っておらず、
    海外利用の行が丸ごと 0 円になってしまうため。
    """
    good: list[dict] = []
    bad: list[dict] = []
    for n, r in enumerate(rows, 1):
        if not any(c.strip() for c in r):
            continue
        if len(r) < 7:
            bad.append({"行": n, "理由": "列が足りない", "中身": r})
            continue
        date = _date_slash(r[0])
        if date is None:
            bad.append({"行": n, "理由": f"日付として読めない: {r[0]!r}", "中身": r})
            continue
        amount = _to_int(r[6])
        if amount is None:
            bad.append({"行": n, "理由": f"金額として読めない: {r[6]!r}", "中身": r})
            continue

        memo = []
        user = _clean_text(r[2])
        if user and user != "ご本人":
            memo.append(f"利用者:{user}")
        pay = _clean_text(r[3])
        if pay and pay != "1回払い":
            memo.append(pay)
        billing = _clean_text(r[5]).lstrip("'")
        if billing:
            memo.append(f"請求{billing}")
        if len(r) > 11 and _clean_text(r[10]):
            memo.append(f"{_clean_text(r[9])} {_clean_text(r[10])} @{_clean_text(r[11])}")
        good.append(_card_row(date, amount, r[1], "三井住友カード", memo))
    return good, bad


def _parse_rakuten(rows: list[list[str]]) -> tuple[list[dict], list[dict]]:
    """
    楽天カード(e-NAVI)。見出し行がある。
      0 利用日 2026/07/31   1 利用店名・商品名   2 利用者   3 支払方法
      4 利用金額   5 手数料/利息   6 支払総額   7 支払月
    金額は 4列目(利用金額)。6列目の支払総額は手数料込みなので、
    買い物そのものの額と混ざる。
    """
    good: list[dict] = []
    bad: list[dict] = []
    for n, r in enumerate(rows, 1):
        if not any(c.strip() for c in r):
            continue
        if _clean_text(r[0]) == "利用日":       # 見出し
            continue
        if len(r) < 5:
            bad.append({"行": n, "理由": "列が足りない", "中身": r})
            continue
        date = _date_slash(r[0])
        if date is None:
            bad.append({"行": n, "理由": f"日付として読めない: {r[0]!r}", "中身": r})
            continue
        amount = _to_int(r[4])
        if amount is None:
            bad.append({"行": n, "理由": f"金額として読めない: {r[4]!r}", "中身": r})
            continue

        memo = []
        user = _clean_text(r[2])
        if user and user != "本人":
            memo.append(f"利用者:{user}")
        pay = _clean_text(r[3])
        if pay and pay != "1回払い":
            memo.append(pay)
        fee = _to_int(r[5]) if len(r) > 5 else None
        if fee:
            memo.append(f"手数料{fee}円")
        billing = _clean_text(r[7]) if len(r) > 7 else ""
        if billing:
            memo.append(f"請求{billing}")
        good.append(_card_row(date, amount, r[1], "楽天カード", memo))
    return good, bad


def _parse_aeon(rows: list[list[str]]) -> tuple[list[dict], list[dict]]:
    """
    イオンカード。明細の前に請求金額と【引落口座】が書いてある。

      0 ご利用カード / 1 今回ご請求金額 / 2 お支払い日 / 3 ご指定口座
      4 金融機関,支店,口座番号,名義人     ← ここに口座番号と名義がある
      5 その中身
      6 ご利用明細                        ← ここから下だけを読む
      7 ご利用日,利用者区分,ご利用先,支払方法,,,ご利用金額,備考

    【「ご利用明細」が出るまで1行も見ない】ことで、口座番号と名義人を
    そもそも手に取らない。禁止事項の「番号は保存しない」を、
    捨てるのではなく最初から拾わないやり方で守る。

    日付が空で金額が負の行は「会員値引」。直前の買い物にぶら下がる値引なので、
    直前の行の日付を継ぐ。値引を買い物の額から引かずに別の行として残すのは、
    明細の合計とデータベースの合計を突き合わせられるようにするため。
    """
    good: list[dict] = []
    bad: list[dict] = []

    start = next((i for i, r in enumerate(rows) if r and _clean_text(r[0]) == "ご利用明細"), None)
    if start is None:
        return good, [{"行": 0, "理由": "「ご利用明細」の行が見つからない", "中身": []}]
    head = next(
        (i for i in range(start + 1, len(rows)) if rows[i] and _clean_text(rows[i][0]) == "ご利用日"),
        None,
    )
    if head is None:
        return good, [{"行": start + 1, "理由": "明細の見出し行が見つからない", "中身": []}]

    last_date: str | None = None
    for n in range(head + 1, len(rows)):
        r = rows[n]
        if not any(c.strip() for c in r):
            continue
        first = _clean_text(r[0])
        # ここから先は「分割・ボーナス払い明細」の別表。列の意味が変わるので読まない。
        if first.startswith("分割") or "ボーナス" in first:
            break
        if len(r) < 7:
            bad.append({"行": n + 1, "理由": "列が足りない", "中身": r})
            continue
        amount = _to_int(r[6])
        if amount is None:
            bad.append({"行": n + 1, "理由": f"金額として読めない: {r[6]!r}", "中身": r})
            continue

        if first:
            date = _date_yymmdd(first)
            if date is None:
                bad.append({"行": n + 1, "理由": f"日付として読めない: {first!r}", "中身": r})
                continue
            last_date = date
        else:
            if last_date is None:
                bad.append({"行": n + 1, "理由": "日付が空で、継ぐ相手もいない", "中身": r})
                continue
            date = last_date                 # 会員値引の行

        memo = []
        who = _clean_text(r[1])
        if who and who != "本人":
            memo.append(f"利用者:{who}")
        note = _clean_text(r[7]) if len(r) > 7 else ""
        if note:
            memo.append(note)
        good.append(_card_row(date, amount, r[2], "イオンカード", memo))
    return good, bad


_CARD_PARSERS = {
    "三井住友カード": _parse_smbc,
    "楽天カード": _parse_rakuten,
    "イオンカード": _parse_aeon,
}


def _decode_csv(data: bytes | str) -> tuple[str, str]:
    """
    文字コードを見分けて読む。カード会社ごとに違い、Shift-JIS(cp932)が多い。
    utf-8 を先に試すのは、日本語の cp932 は utf-8 として読むと必ず失敗するから
    (取り違えない)。逆に utf-8 の中身を cp932 で読むと文字化けしたまま通ってしまう。
    """
    if isinstance(data, str):
        return data, "(文字列で受け取った)"
    if data.startswith(b"\xef\xbb\xbf"):
        return data.decode("utf-8-sig"), "utf-8-sig"
    for enc in ("utf-8", "cp932"):
        try:
            return data.decode(enc), enc
        except UnicodeDecodeError:
            pass
    # ここに来るのは想定外。読めない字を伏せて進め、文字コード名でそれと分かるようにする。
    return data.decode("cp932", "replace"), "cp932(読めない字あり)"


def _detect_card_format(rows: list[list[str]]) -> str:
    """どのカード会社の明細かを見分ける。分からなければ空文字。"""
    head = [_clean_text(c) for c in (rows[0] if rows else [])]
    if head[:2] == ["利用日", "利用店名・商品名"]:
        return "楽天カード"
    if head[:1] == ["ご利用カード"]:
        return "イオンカード"
    if head and head[0] in _BANK_HEADERS:
        return _BANK_HEADERS[head[0]]
    if head[:1] == ["日付"] and "出金金額(円)" in head:
        return _BANK_HEADERS["取扱日付"]
    # 三井住友カードは見出しが無い。1行目がいきなり明細で13列。
    if rows and len(rows[0]) >= 13 and _date_slash(rows[0][0]):
        return "三井住友カード"
    return ""


def parse_card_csv(data: bytes | str, *, name: str | None = None) -> dict:
    """
    カード明細 CSV を読んで、明細1行ずつの辞書にする。**通信しない。**

    Cowork(クラウド)で動いていて Supabase に届かないときでも、これは動く。
    読み取った行を handoff() に渡せば inbox 用の JSON になり、記録が失われない。

        from db import parse_card_csv, handoff
        parsed = parse_card_csv(open(path, "rb").read(), name=path)
        h = handoff(*[("import_card_row", r) for r in parsed["行"]])

    返り値の "行" は {date, amount, merchant_raw, merchant_norm, source, memo}。
    **費目は入っていない。**辞書を引くには接続が要るため、費目を決めるのは
    取り込む側(import_card_csv、または inbox を適用するスクリプト)。
    """
    text, encoding = _decode_csv(data)
    rows = list(csv.reader(io.StringIO(text, newline="")))
    fmt = _detect_card_format(rows)

    if fmt in _BANK_HEADERS.values():
        raise JisuiError(
            f"これはカード明細ではなく{fmt}です: {name or '(名前なし)'}\n"
            "口座明細は【わざと扱っていません】。カード代金の引落が入っているので、\n"
            "カード明細と両方入れると同じ買い物を2回数えてしまいます。\n"
            "口座の残高を記録したいなら balances に、収入なら income に入れてください。"
        )
    if not fmt:
        raise JisuiError(
            f"どのカード会社の明細か分かりませんでした: {name or '(名前なし)'}\n"
            f"1行目: {rows[0] if rows else '(空)'}\n"
            "いま読めるのは 三井住友カード / 楽天カード / イオンカード の3つです。\n"
            "新しい形を足すときは、実物を開いて列を確かめてから db.py に書くこと"
            "(推測で書くと、金額の列を1つ間違えただけで家計が丸ごとずれます)。"
        )

    good, bad = _CARD_PARSERS[fmt](rows)
    return {
        "ファイル": name,
        "形式": fmt,
        "文字コード": encoding,
        "読んだ行": len(rows),
        "行": good,
        "読めない行": bad,
    }


if __name__ == "__main__":
    # 疎通確認: python db.py
    j = Jisui()
    print(f"接続OK 世帯: {j.household_id}")
    for name, rows in j.context().items():
        print(f"  {name}: {len(rows)}件")
