# -*- coding: utf-8 -*-
"""現行 jisui.db から Supabase 用の seed.sql を生成する。
使い方: python3 gen_seed.py <jisui.dbのパス> <recipesフォルダのパス> [出力先]
生成された seed.sql は schema.sql 実行後に Supabase の SQL Editor に貼って実行する。
"""
import sqlite3, sys, os

db = sys.argv[1]
recipes_dir = sys.argv[2]
out = sys.argv[3] if len(sys.argv) > 3 else "seed.sql"

con = sqlite3.connect(db)
con.row_factory = sqlite3.Row


def lit(v):
    if v is None:
        return "null"
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (int, float)):
        return str(v)
    return "'" + str(v).replace("'", "''") + "'"


def boolit(v):
    return "true" if v else "false"


L = []
L.append("-- jisui 既存データの移行用シード。schema.sql の後に実行する。")
L.append("-- 実行前に: Supabase Auth で2人分のユーザーを作り、下の household_members を埋めること。")
L.append("")
L.append("begin;")
L.append("")
L.append("-- 世帯を1つ作る(このIDを以降すべてで使う)")
L.append("insert into households (id, name) values "
         "('00000000-0000-4000-8000-000000000001', 'わが家');")
L.append("")
L.append("-- ▼▼ 要編集: Supabase Auth のユーザーIDに置き換える ▼▼")
L.append("-- insert into household_members (household_id, user_id, display_name) values")
L.append("--   ('00000000-0000-4000-8000-000000000001', '<夫のuser_id>', '夫'),")
L.append("--   ('00000000-0000-4000-8000-000000000001', '<妻のuser_id>', '妻');")
L.append("-- ▲▲ ここまで ▲▲")
L.append("")
H = "'00000000-0000-4000-8000-000000000001'"

L.append("-- equipment")
for r in con.execute("SELECT name, memo FROM equipment ORDER BY id"):
    L.append(f"insert into equipment (household_id, name, memo) values "
             f"({H}, {lit(r['name'])}, {lit(r['memo'])});")
L.append("")

L.append("-- pantry")
for r in con.execute("SELECT name, category, stock, staple, memo FROM pantry ORDER BY id"):
    L.append(f"insert into pantry (household_id, name, category, stock, staple, memo) values "
             f"({H}, {lit(r['name'])}, {lit(r['category'])}, {lit(r['stock'])}, "
             f"{boolit(r['staple'])}, {lit(r['memo'])});")
L.append("")

L.append("-- preferences")
for r in con.execute("SELECT kind, item, memo FROM preferences ORDER BY id"):
    L.append(f"insert into preferences (household_id, kind, item, memo) values "
             f"({H}, {lit(r['kind'])}, {lit(r['item'])}, {lit(r['memo'])});")
L.append("")

L.append("-- inventory")
for r in con.execute("SELECT name, qty, unit, location, expiry, bought_on, price FROM inventory ORDER BY id"):
    L.append(f"insert into inventory (household_id, name, qty, unit, location, expiry, bought_on, price) values "
             f"({H}, {lit(r['name'])}, {lit(r['qty'])}, {lit(r['unit'])}, {lit(r['location'])}, "
             f"{lit(r['expiry'])}, {lit(r['bought_on'])}, {lit(r['price'])});")
L.append("")

L.append("-- recipes(レシピカードはMarkdown本文をDBへ埋め込む)")
for r in con.execute("SELECT * FROM recipes ORDER BY id"):
    card = ""
    if r["card_path"]:
        p = os.path.join(os.path.dirname(db), r["card_path"])
        if os.path.exists(p):
            card = open(p, encoding="utf-8").read()
    L.append(f"insert into recipes (id, household_id, name, category, protein, time_min, "
             f"freezable, freeze_notes, card_md, source, tags) values "
             f"({r['id']}, {H}, {lit(r['name'])}, {lit(r['category'])}, {lit(r['protein'])}, "
             f"{lit(r['time_min'])}, {boolit(r['freezable'])}, {lit(r['freeze_notes'])}, "
             f"{lit(card or None)}, {lit(r['source'])}, {lit(r['tags'])});")
L.append("select setval('recipes_id_seq', (select max(id) from recipes));")
L.append("")

L.append("-- recipe_ingredients")
for r in con.execute("SELECT recipe_id, name, qty, unit, optional FROM recipe_ingredients"):
    L.append(f"insert into recipe_ingredients (recipe_id, name, qty, unit, optional) values "
             f"({r['recipe_id']}, {lit(r['name'])}, {lit(r['qty'])}, {lit(r['unit'])}, "
             f"{boolit(r['optional'])});")
L.append("")

L.append("-- cook_log")
for r in con.execute("SELECT date, recipe_id, name, batch, rating, memo FROM cook_log ORDER BY id"):
    L.append(f"insert into cook_log (household_id, date, recipe_id, name, batch, rating, memo) values "
             f"({H}, {lit(r['date'])}, {lit(r['recipe_id'])}, {lit(r['name'])}, "
             f"{boolit(r['batch'])}, {lit(r['rating'])}, {lit(r['memo'])});")
L.append("")

L.append("-- meal_plan")
for r in con.execute("SELECT date, slot, recipe_id, name, status FROM meal_plan ORDER BY date"):
    L.append(f"insert into meal_plan (household_id, date, slot, recipe_id, name, status) values "
             f"({H}, {lit(r['date'])}, {lit(r['slot'])}, {lit(r['recipe_id'])}, "
             f"{lit(r['name'])}, {lit(r['status'])});")
L.append("")

L.append("-- shopping_list(未購入のみ移行)")
order = 0
for r in con.execute("SELECT item, qty, reason, section, status FROM shopping_list "
                     "WHERE status='未購入' ORDER BY id"):
    order += 10
    L.append(f"insert into shopping_list (household_id, item, qty, reason, section, sort_order, status) values "
             f"({H}, {lit(r['item'])}, {lit(r['qty'])}, {lit(r['reason'])}, {lit(r['section'])}, "
             f"{order}, {lit(r['status'])});")
L.append("")
L.append("commit;")

con.close()
with open(out, "w", encoding="utf-8") as f:
    f.write("\n".join(L) + "\n")
print(f"{out} generated: {len(L)} lines")
