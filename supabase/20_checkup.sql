-- ============================================================
-- 20_checkup.sql — 健康診断・人間ドック・血液検査の記録
--
-- 【なぜ 19_health.sql とは別の表なのか】
--   19 が持っているのは【自分で毎日つける記録】(体重・睡眠・活動・飲酒)と、
--   【いつ受けるか】(がん検診・予防接種の期限)である。
--   ここで足すのは【受けた結果そのもの】。年に1回、検査票という紙で来る。
--   ・1回の受診に項目が15〜40ある(19 の表はどれも1日1行で列が固定)
--   ・項目は受診ごとに変わる(健診には心電図が無く、人間ドックにはある)
--   ・基準値は検査機関ごとに違い、検査票に印刷されている
--   列を足して 19 の vitals に押し込むと、項目が増えるたびに alter table が要る。
--   受診(checkup)と項目(checkup_result)の2枚に分ける。
--
-- 【基準値は行が持つ。アプリで作らない】
--   19_health.sql の health_targets は「公的ガイドラインの目標値」だった。
--   こちらは違う。**検査票に印刷されている基準を、そのまま写す。**
--   同じ LDL でも検査機関で基準が違うことがあり、
--   アプリ側が1つの基準を決めて色を付けると、紙と画面で判定が食い違う。
--   判定は「その行の基準」だけで出す(lib/checkup.ts)。
--
-- 【値そのものはこの SQL に書かない】
--   **このリポジトリは公開である**(.gitignore の cowork/jisui/cowork.json の
--   説明に書いてあるとおり)。血液検査の値・受診した病院名は、
--   生年月日や体重よりも取り返しがつかない。
--   表だけをここで作り、中身は受け渡し JSON(op: add_checkup)から入れる。
--   → アプリの「チャットから取り込む」画面に貼る。パソコンは要らない。
--
-- 【診断はしない】
--   19 と同じ。「◯◯の疑い」は書かない。基準を外れていれば
--   「基準から外れています」まで。判断は医師による。
--
-- 実行: Supabase の SQL Editor に貼る。**19_health.sql のあとに流すこと**
--       (health_member ドメインを 19 が作る)。何度流してもよい。
-- ============================================================


-- ---------------------------------------------------------------- 受診1回ぶん
--
-- 【unique を (member, date, kind) にする理由】
-- 同じ日に「定期健診」と「血液検査」の両方を受けることがある(実例あり:
-- 2025年は5月にクリニックの血液検査、6月に定期健診)。日付だけで一意にすると
-- 片方が入らない。逆に kind まで含めれば、同じ受診を2回送っても増えない。
create table if not exists checkup (
  id            bigserial primary key,
  household_id  uuid not null references households(id) on delete cascade,
  member        health_member not null,
  date          date not null,
  -- 定期健診 / 人間ドック / 血液検査 / ABC検診 / 受診 など。
  -- **決め打ちの check を付けない。** 検査票に書いてある呼び名はまちまちで、
  -- 制約に無い名前が来た日に記録そのものが落ちるほうが困る。
  kind          text not null,
  place         text,                   -- 受けたところ(クリニック名)
  -- 総合判定。A / B / C1 / D2 のように**検査票の文字をそのまま**入れる。
  -- こちらで良し悪しに読み替えない(機関ごとに意味が違う)。
  overall       text,
  finding       text,                   -- 診察所見・医師のコメント
  memo          text,
  created_at    timestamptz not null default now(),
  unique (household_id, member, date, kind)
);
create index if not exists checkup_by_member on checkup (household_id, member, date desc);


-- ---------------------------------------------------------------- 項目ごとの結果
--
-- 【数値と文字を分けて持つ】
-- 尿蛋白の「(−)」や心電図の「異常なし」は数値にならない。
-- 1つの列に混ぜると推移が出せなくなるので、
--   value_num … 折れ線・前回比に使う値
--   value_text … (−) や 異常なし のように、そのまま出す結果
-- の2つに分ける。どちらか片方だけ埋まっているのが普通。
create table if not exists checkup_result (
  id           bigserial primary key,
  checkup_id   bigint not null references checkup(id) on delete cascade,
  -- 項目名。**表記をそろえること。** 推移は名前で突き合わせるので、
  -- 「γ-GTP」と「γ-GT」が混ざると別の項目として2行に割れる。
  -- 使う名前は lib/checkup.ts の ITEM_ORDER にまとめてある。
  item         text not null,
  value_num    numeric,
  value_text   text,
  unit         text,
  -- 【検査票に印刷されている基準】。無ければ空のままにする。
  -- 空欄を「基準内」と読み替えない(lib/checkup.ts は「判定なし」と出す)。
  ref_low      numeric,
  ref_high     numeric,
  ref_text     text,                    -- 「(−)」「70.1以上」など数値2つで書けない基準
  judge        text,                    -- 検査票の判定(A / B / C / D1 …)
  memo         text,
  sort_order   integer not null default 0,
  unique (checkup_id, item)
);
create index if not exists checkup_result_by_checkup on checkup_result (checkup_id);


-- ---------------------------------------------------------------- RLS
--
-- checkup は household_id を持つので 19 と同じ形。
-- checkup_result は持たないので、**親をたどって世帯を判定する**
-- (04_schema_kakeibo.sql の receipt_items と同じ書き方)。
-- ここを household_id 無しのまま素通しにすると、行 id を総当たりされたときに
-- 他人の検査値が読める。実際に過去、ビュー経由で家計データが漏れている。
alter table checkup enable row level security;
drop policy if exists household_rw on checkup;
create policy household_rw on checkup
  for all using (household_id in (select my_household_ids()))
  with check (household_id in (select my_household_ids()));

alter table checkup_result enable row level security;
drop policy if exists household_rw on checkup_result;
create policy household_rw on checkup_result
  for all using (checkup_id in (select id from checkup
                                 where household_id in (select my_household_ids())))
  with check (checkup_id in (select id from checkup
                              where household_id in (select my_household_ids())));


-- ============================================================
-- 確かめる(結果と期待を並べる)
-- ============================================================
select '表' as 見るもの, count(*) as 結果, 2 as 期待
  from information_schema.tables
 where table_schema = 'public' and table_name in ('checkup', 'checkup_result')
union all
select 'RLS が有効', count(*), 2
  from pg_tables
 where schemaname = 'public' and tablename in ('checkup', 'checkup_result') and rowsecurity
union all
select '入っている受診', count(*), null from checkup
union all
select '入っている検査値', count(*), null from checkup_result;

-- 【次にやること】
--   1. アプリを本番に出す(健康タブに「健康診断」が増える。sw.js は v25)
--   2. 検査票の中身を受け渡し JSON にして、アプリの
--      「チャットから取り込む」画面に貼る(op: add_checkup)
--      値をこの SQL に書き足さないこと。**公開リポジトリである。**
