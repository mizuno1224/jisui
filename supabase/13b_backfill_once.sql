-- ============================================================
-- 【一度きり】すでに入っているぶんの献立の状態を揃える
--
-- 13_cook_log_marks_plan.sql のトリガは、これから入るぶんにしか効かない。
-- すでに「作った記録はあるのに予定のまま」になっている行を、ここで揃える。
--
-- 【なぜ別のファイルにしたか】
-- トリガの定義は何度貼り直してもよいが、この update はそうではない。
-- 人がアプリで「実施 → 戻す」を押して予定に戻したあとにもう一度流すと、
-- 作った記録がまだ残っているので【黙って実施に戻る】。
-- 人が直した意思が消え、しかも何が起きたかの記録も残らない。
-- 同じファイルに置くと「何度実行してもよい」に釣られて流してしまう。
--
-- 【流す前に確かめること】
-- 作った記録そのものが間違っていることがある。実際、チャットが
-- 「記録漏れの補完」として、本人が作っていないものを cook_log に
-- 入れていた例がある。先に cook_log を正しくしてから流すこと。
-- 下の「① 何が変わるか」で、変わる行を先に目で見ること。
--
-- 実行: Supabase の SQL Editor で、①を実行して中身を見てから、②を実行する。
-- ============================================================

-- ---------------------------------------------------------------- ① 何が変わるか(見るだけ)
select mp.id, mp.date, mp.name, mp.status as いまの状態,
       cl.name as 作った記録, cl.memo
  from meal_plan mp
  join cook_log cl
    on cl.household_id = mp.household_id
   and cl.date         = mp.date
   and public.cook_matches_plan(cl.recipe_id, cl.name, mp.recipe_id, mp.name)
 where mp.status = '予定'
 order by mp.date, mp.name;


-- ---------------------------------------------------------------- ② 実際に変える
-- ①の中身に納得してから実行すること。
with 直す as (
  select distinct mp.id
    from meal_plan mp
    join cook_log cl
      on cl.household_id = mp.household_id
     and cl.date         = mp.date
     and public.cook_matches_plan(cl.recipe_id, cl.name, mp.recipe_id, mp.name)
   where mp.status = '予定'
)
update meal_plan mp
   set status = '実施'
  from 直す
 where mp.id = 直す.id
returning mp.id, mp.date, mp.name, mp.status;

-- 【流したあと】
-- 開いたままのアプリには伝わらない(サーバ側の変更を取りに行く仕組みが無い)。
-- アプリをいったん閉じて開き直すこと。開き直せば必ず取り直す。
