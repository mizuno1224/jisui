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
"""

from __future__ import annotations

import hashlib
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import date as _date
from datetime import timedelta
from pathlib import Path
from typing import Any


def _add_days(iso: str, days: int) -> str:
    return (_date.fromisoformat(iso) + timedelta(days=days)).isoformat()

CONFIG_NAME = ".env"
TOKEN_CACHE = Path(__file__).with_name(".token.json")
TIMEOUT = 30


class JisuiError(RuntimeError):
    pass


def _load_config() -> dict[str, str]:
    """.env(このファイルと同じ場所)か環境変数から接続情報を読む。"""
    config: dict[str, str] = {}
    env_path = Path(__file__).with_name(CONFIG_NAME)
    if env_path.exists():
        for line in env_path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            config[key.strip()] = value.strip()

    for key in ("JISUI_SUPABASE_URL", "JISUI_SUPABASE_KEY", "JISUI_EMAIL", "JISUI_PASSWORD"):
        config.setdefault(key, os.environ.get(key, ""))

    missing = [k for k, v in config.items() if not v and k.startswith("JISUI_")]
    if missing:
        raise JisuiError(
            f"接続情報が足りません: {', '.join(missing)}\n"
            f"{env_path} に .env.example と同じ形で書いてください。"
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
        raise JisuiError(f"通信できませんでした: {e.reason}") from e


class Jisui:
    """世帯のデータを読み書きする。RLS があるので、必ずログインしてから使う。"""

    def __init__(self) -> None:
        config = _load_config()
        self.url = config["JISUI_SUPABASE_URL"].rstrip("/")
        self.key = config["JISUI_SUPABASE_KEY"]
        self._email = config["JISUI_EMAIL"]
        self._password = config["JISUI_PASSWORD"]
        self._token = self._get_token()
        self.household_id = self._fetch_household_id()

    # ------------------------------------------------------------ 認証

    def _get_token(self) -> str:
        """アクセストークンは1時間ほど有効。使い回してログイン回数を減らす。"""
        if TOKEN_CACHE.exists():
            try:
                cached = json.loads(TOKEN_CACHE.read_text(encoding="utf-8"))
                if cached.get("expires_at", 0) > time.time() + 60:
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
            json.dumps({"access_token": token, "expires_at": time.time() + res.get("expires_in", 3600)}),
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
        """household_id は自動で補う。付け忘れると RLS に弾かれるため。"""
        payload = [{"household_id": self.household_id, **row} for row in rows]
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
        base = self.select("shopping_list", "sort_order")
        next_order = max((r["sort_order"] for r in base), default=0) + 10
        rows = []
        for i, item in enumerate(items):
            rows.append({"sort_order": next_order + i * 10, "status": "未購入", **item})
        return self.insert("shopping_list", rows)

    def add_inventory(self, items: list[dict]) -> list[dict]:
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
        """やること。家計まわりの宿題。"""
        filters = {} if include_done else {"status": "eq.open"}
        return self.select("todos", "*", order="id", **filters)

    def classify(self, merchant: str) -> str | None:
        """
        店名から費目を引く。分類辞書(expense_rules)に部分一致させる。

        AI の判断で辞書と違う費目を付けないこと。同じ店がその時々で
        違う費目になると、月次の比較が意味を失う。
        辞書に無い店は None を返すので、必ず本人に確認してから追記する。
        """
        for rule in self.select("expense_rules", "keyword,category"):
            if rule["keyword"] and rule["keyword"] in merchant:
                return rule["category"]
        return None

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
        """
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


if __name__ == "__main__":
    # 疎通確認: python db.py
    j = Jisui()
    print(f"接続OK 世帯: {j.household_id}")
    for name, rows in j.context().items():
        print(f"  {name}: {len(rows)}件")
