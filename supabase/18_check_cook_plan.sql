-- ============================================================
-- 18_check_cook_plan.sql — 「作った記録が献立を実施にする」が本当に効いているか見る
--
-- 【なぜ要るか】
-- 2026-08-27、cook_log に2行入れて名前も日付も献立と完全一致しているのに、
-- meal_plan は「予定」のままだった。書き出しの遅れではなく DB 側が予定だった。
--
-- 2026-08-30 に本番を外から確かめたところ、**関数 cook_matches_plan は入っていた**
-- (PostgREST の rpc で呼べた。同じ名前は True、別の料理は False で判定も正しい)。
-- つまり原因は「13 を流していない」ではなかった。残る疑いは2つ:
--
--   ・トリガが表に付いていない(関数だけ作り直した、drop したまま等)
--   ・名前の表記が揺れていて当たっていない
--     実測で当たらなかった例: '豚しゃぶ ポン酢' と '豚しゃぶ　ポン酢'(全角空白)
--                             '6Pチーズ和え'   と '6pチーズ和え'(大文字小文字)
--
-- **どちらも、外(PostgREST)からは見えない。** そして起きても何も表示されない。
-- 黙って「予定」のままになるだけなので、見に行かないかぎり気づけない。
--
-- そこで【1分で確かめられる場所】を作る。上から順に実行する。
--
-- ★ このファイルは【何も書き換えない】。全部 select。安心して流してよい。
--
-- 実行: Supabase の SQL Editor に貼って、①から順に実行する。
-- ============================================================


-- ---------------------------------------------------------------- ① 入っているか
--
-- 出るはずのもの(4行)
--   jisui_plain_name       関数    ← 13 を【新しい版で】流してあれば出る
--   cook_matches_plan      関数
--   cook_log_marks_plan    関数とトリガ
--   meal_plan_marks_done   関数とトリガ
--
-- 【1行でも足りなければ、それが原因】。13_cook_log_marks_plan.sql を
-- SQL Editor に貼って実行し、もう一度ここへ戻ってくること。
select '関数' as 種類, p.proname as 名前, '—' as 付いている表
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('jisui_plain_name', 'cook_matches_plan',
                     'cook_log_marks_plan', 'meal_plan_marks_done')
union all
select 'トリガ', t.tgname, c.relname
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
 where not t.tgisinternal
   and t.tgname in ('cook_log_marks_plan', 'meal_plan_marks_done')
 order by 1, 2;


-- ---------------------------------------------------------------- ② 版が古くないか
--
-- 「新しい」と出れば、名前の突き合わせが表記の揺れに強い版になっている。
-- 「古い(btrim だけ)」と出たら、全角空白・全角括弧・大文字小文字で当たらない。
-- 13_cook_log_marks_plan.sql を貼り直すこと。
select case
         when not exists (
           select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname = 'cook_matches_plan')
           then '入っていない ← 13 を流していない'
         when exists (
           select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname = 'cook_matches_plan'
              and p.prosrc like '%jisui_plain_name%')
           then '新しい(表記の揺れに強い)'
         else '古い(btrim だけ)← 13 を貼り直すこと'
       end as 当て方の版;


-- ---------------------------------------------------------------- ③ 取り残しがあるか
--
-- 作った記録があるのに「予定」のままの献立。
-- ①②が全部そろっているのにここに行が出るなら、**トリガが後から入った**ということ。
-- トリガはこれから入るぶんにしか効かない。13b_backfill_once.sql で揃える。
select mp.id, mp.date, mp.slot, mp.name as 献立, mp.status as いまの状態,
       cl.id as 記録id, cl.name as 作った記録
  from meal_plan mp
  join cook_log cl
    on cl.household_id = mp.household_id
   and cl.date         = mp.date
   and public.cook_matches_plan(cl.recipe_id, cl.name, mp.recipe_id, mp.name)
 where mp.status = '予定'
 order by mp.date, mp.slot;


-- ---------------------------------------------------------------- ④ 惜しいのに当たらないもの
--
-- 同じ日に記録も献立もあるのに、名前が当たっていない組み合わせ。
-- 表記の揺れが残っているならここに出る。出たものは
--   ・本当に別の料理  … そのままでよい
--   ・同じ料理の書き違い … どちらかの name を直す(受け渡しの op「update」で送れる)
-- のどちらか。**勝手に片方へ寄せないこと。** 名前は人が付けたものである。
select cl.date,
       cl.name  as 作った記録,
       mp.name  as 献立,
       mp.status as 献立の状態,
       public.jisui_plain_name(cl.name) as ならした記録,
       public.jisui_plain_name(mp.name) as ならした献立
  from cook_log cl
  join meal_plan mp
    on mp.household_id = cl.household_id
   and mp.date         = cl.date
 where not public.cook_matches_plan(cl.recipe_id, cl.name, mp.recipe_id, mp.name)
 order by cl.date desc, cl.name
 limit 50;


-- ---------------------------------------------------------------- ⑤ 逆の取り残し
--
-- 「実施」なのに、その日の作った記録が無い献立。
-- 記録の日付や名前をあとから直したときに残る。自動では戻さない
-- (人が手で実施にした行まで戻してしまうため)。目で見て判断すること。
select mp.id, mp.date, mp.slot, mp.name as 献立
  from meal_plan mp
 where mp.status = '実施'
   and mp.date >= (select min(date) from cook_log)
   and not exists (
     select 1 from cook_log cl
      where cl.household_id = mp.household_id
        and cl.date         = mp.date
        and public.cook_matches_plan(cl.recipe_id, cl.name, mp.recipe_id, mp.name)
   )
 order by mp.date desc;


-- ============================================================
-- 【直し方の早見表】
--
--   ① に足りないものがある      → 13_cook_log_marks_plan.sql を貼る
--   ② が「古い」                → 13_cook_log_marks_plan.sql を貼り直す
--   ③ に行が出る                → 13b_backfill_once.sql の①を見てから②を流す
--   ④ に「同じ料理の書き違い」   → name を直す(受け渡しの op「update」)
--   ⑤ に行が出る                → 本人に「本当に作ったか」を聞く
--
-- 【流したあと】
-- 開いたままのアプリには伝わらない。いったん閉じて開き直すこと。
-- Cowork が読む いまの状況.md は、常駐(watch-inbox.mjs)が5分以内に書き直す。
-- ============================================================
