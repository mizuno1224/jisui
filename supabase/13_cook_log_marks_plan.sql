-- ============================================================
-- 作った記録が入ったら、その日の献立を「実施」にする
--
-- 【なぜ要るか】
-- cook_log に「8/11 に作った」と入っているのに、meal_plan の同じ行は
-- 「予定」のままだった。献立を組み直すときに、済んだものがもう一度並ぶ。
--
-- 記録を入れる経路は3つある(アプリ / Cowork の受け渡し / Claude Code)。
-- どの経路にも同じ処理を書くと必ずどれかが抜ける。実際、受け渡し経由で
-- 入れたぶんだけ状態が更新されていなかった。だから DB 側に1つ置く。
--
-- 【これだけでは足りない。アプリ側も直すこと】
-- lib/ai-context.ts と components/InventoryScreen.tsx は
-- 「中止でないもの」を『これから作るもの』として扱っていた。
-- それだと実施にしても済んだ献立が並び続け、この SQL は無意味になる。
-- どちらも status === '予定' だけを見るように直してある(同じ回の変更)。
--
-- 【触らないもの】
--   ・「中止」  … 作らなかったという人の申告。予定より強い記録なので、
--                 あとから作った記録が来ても書き換えない。
--   ・「実施」  … すでに済んでいる。
--   ・別の日    … 繰り越しは人が判断すること。同じ日だけを見る。
--
-- 【当て方】
-- recipe_id が両方にあればそれで当てる(名前の揺れに強い)。
-- 無ければ名前で当てる。当たらなければ何もしない。
-- 当たらないほうが、間違ったものを「実施」にするより安全である。
--
-- 【名前が空の行は当てない】
-- name は not null ではない。btrim('') = btrim('') は真になるので、
-- 空文字どうしが当たってしまう。1件の記録で、その日の名無しの予定が
-- まとめて実施になる。空は「当たらない」に倒す。
--
-- 実行: Supabase の SQL Editor に貼って実行する。
--       何度実行してもよい(作り直すだけ。データは動かさない)。
--       すでに入っているぶんを揃えるのは 13b_backfill_once.sql。
-- ============================================================

-- 当てる条件を1か所に置く。トリガが2つあるので、書き写すと必ずずれる。
create or replace function public.cook_matches_plan(
  p_cook_recipe bigint, p_cook_name text,
  p_plan_recipe bigint, p_plan_name text
) returns boolean
language sql immutable
as $$
  select
    (p_cook_recipe is not null and p_plan_recipe = p_cook_recipe)
    or (
         p_cook_name is not null and p_plan_name is not null
         and btrim(p_cook_name) <> '' and btrim(p_plan_name) <> ''
         and btrim(p_plan_name) = btrim(p_cook_name)
       );
$$;


-- ---------------------------------------------------------------- 記録が先
create or replace function public.cook_log_marks_plan()
returns trigger
language plpgsql
as $$
begin
  update meal_plan mp
     set status = '実施'
   where mp.household_id = new.household_id
     and mp.date         = new.date
     and mp.status       = '予定'
     and public.cook_matches_plan(new.recipe_id, new.name, mp.recipe_id, mp.name);
  return new;
end;
$$;

drop trigger if exists cook_log_marks_plan on cook_log;
create trigger cook_log_marks_plan
  after insert or update of date, name, recipe_id on cook_log
  for each row execute function public.cook_log_marks_plan();


-- ---------------------------------------------------------------- 献立が後
--
-- 【両方向に要る】
-- 受け渡し JSON は書いてある順に1件ずつ流す。cook_log が先に並んでいると、
-- トリガが走った時点で献立がまだ無く、0件で終わる。そのあと献立が入っても
-- 当てにいく機会は二度と来ない。「作ってから、あとで献立表に足す」も普通に起きる。
-- 直したつもりで直っていない、という形になるので、献立側にも付ける。
create or replace function public.meal_plan_marks_done()
returns trigger
language plpgsql
as $$
begin
  if new.status = '予定' and exists (
       select 1 from cook_log cl
        where cl.household_id = new.household_id
          and cl.date         = new.date
          and public.cook_matches_plan(cl.recipe_id, cl.name, new.recipe_id, new.name)
     ) then
    new.status := '実施';
  end if;
  return new;
end;
$$;

drop trigger if exists meal_plan_marks_done on meal_plan;
create trigger meal_plan_marks_done
  before insert or update of date, name, recipe_id on meal_plan
  for each row execute function public.meal_plan_marks_done();


-- ============================================================
-- 【残っている穴】直していないので、知っておくこと
--
-- cook_log の日付や名前を【あとから直した】とき、直す前に「実施」にした
-- 献立は実施のまま取り残される(8/11 と書いて 8/12 に直すと、8/11 が
-- 実施のまま残る)。自動で戻すと、人が手で実施にした行まで戻してしまう。
-- どちらが正しいかは行を見ても分からない。
--
-- そこで戻す処理は入れず、【気づけるようにする】ことで手当てした。
-- scripts/write-context.mjs が「実施なのに作った記録が無い」行を
-- 『確認が要ること』に出す。チャットが献立の相談のたびに読む。
-- ============================================================
