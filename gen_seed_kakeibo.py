# -*- coding: utf-8 -*-
"""kakeibo.db + 分類辞書.csv から Supabase 用の seed_kakeibo.sql を生成する。
移すのは transactions と 分類辞書 のみ(資産・負債・給与・投資方針は移さない)。
使い方: python3 gen_seed_kakeibo.py <kakeibo.db> <分類辞書.csv> [出力先]
"""
import sqlite3, csv, sys

db = sys.argv[1]
dic = sys.argv[2]
out = sys.argv[3] if len(sys.argv) > 3 else "seed_kakeibo.sql"
H = "'00000000-0000-4000-8000-000000000001'"


def lit(v):
    if v is None or v == "":
        return "null"
    if isinstance(v, (int, float)):
        return str(v)
    return "'" + str(v).replace("'", "''") + "'"


L = ["-- 家計簿(支出)の移行用シード。schema_kakeibo.sql の後に実行する。",
     "-- 資産・負債・給与・投資方針は移さない(手元の kakeibo.db に残す)。", "", "begin;", ""]

L.append("-- 分類辞書")
with open(dic, encoding="utf-8") as f:
    for row in csv.DictReader(f):
        kw = (row.get("キーワード") or "").strip()
        cat = (row.get("費目") or "").strip()
        if not kw or not cat:
            continue
        L.append(f"insert into expense_rules (household_id, keyword, category, note) values "
                 f"({H}, {lit(kw)}, {lit(cat)}, {lit((row.get('備考') or '').strip())}) "
                 f"on conflict (household_id, keyword) do nothing;")
L.append("")

L.append("-- 取引(支出)")
con = sqlite3.connect(db)
con.row_factory = sqlite3.Row
n = 0
for r in con.execute("SELECT date, amount, merchant_raw, merchant_norm, category, source, memo, "
                     "dedup_hash FROM transactions ORDER BY date, id"):
    n += 1
    review = "true" if (r["memo"] or "").find("重複") >= 0 else "false"
    L.append(f"insert into transactions (household_id, date, amount, merchant_raw, merchant_norm, "
             f"category, source, memo, dedup_hash, needs_review) values "
             f"({H}, {lit(r['date'])}, {lit(r['amount'])}, {lit(r['merchant_raw'])}, "
             f"{lit(r['merchant_norm'])}, {lit(r['category'])}, {lit(r['source'])}, "
             f"{lit(r['memo'])}, {lit(r['dedup_hash'])}, {review}) "
             f"on conflict (household_id, dedup_hash) do nothing;")
con.close()
L += ["", "commit;"]

with open(out, "w", encoding="utf-8") as f:
    f.write("\n".join(L) + "\n")
print(f"{out} generated: 取引{n}件")
