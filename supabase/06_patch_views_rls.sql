-- ============================================================
-- 【重要】ビューが RLS を迂回する問題の修正
--
-- 04_schema_kakeibo.sql が作る2つのビューは、PostgreSQL の既定では
-- 「ビューの作成者(postgres)の権限」で動く。そのため元テーブル
-- transactions / cook_log の行レベルセキュリティが適用されず、
-- ログインしていない相手にも家計データが返ってしまう。
--
-- 実際に、公開鍵だけで以下が読めてしまう状態だった:
--   v_monthly_by_category → 月ごとの費目別支出
--   v_cost_per_meal       → 月ごとの食費と1食あたりコスト
--
-- 公開鍵(anon / publishable)はアプリに埋め込まれて誰でも読めるため、
-- これは実害のある穴。security_invoker を有効にして、
-- 「ビューを呼んだ人の権限」で動くようにする(PostgreSQL 15 以降)。
-- ============================================================

alter view v_monthly_by_category set (security_invoker = on);
alter view v_cost_per_meal set (security_invoker = on);

-- 確認: 両方 true になっていれば直っている。
select c.relname as view_name,
       'security_invoker=on' = any(c.reloptions) as fixed
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'v'
order by 1;
