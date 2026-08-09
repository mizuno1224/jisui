-- ============================================================
-- cowork_user.sql — チャット(Cowork)専用ユーザーを世帯に入れる
--
-- 【先にやること】
--   Supabase のダッシュボードで Authentication → Users → Add user から
--   専用ユーザーを1人作成しておく。
--     メール: m.mizuno1224+cowork@gmail.com
--     パスワード: Claude Code が出したもの(cowork.json と同じ値)
--     Auto Confirm User に必ずチェックを入れる(確認メールを踏まずに使えるようにする)
--
--   ※ メールの "+cowork" は Gmail の機能で、本体の受信箱に届く。
--     自分のものだと一目で分かり、いらなくなったら消せる。
--
-- 【なぜ専用ユーザーを作るのか】
--   チャットは Anthropic のクラウドで動く。このパソコンの中は見えないので、
--   接続情報を【スキルの中に同梱】しないと動かない。
--   つまりパスワードがスキルファイルに入る。
--
--   そこに自分のパスワードを入れると、スキルが漏れたとき
--   自分と妻のログインを両方作り直すことになる。
--   専用ユーザーなら、そのユーザーのパスワードを変えるだけで無効化でき、
--   人間2人のログインには一切影響しない。
--
-- 【この専用ユーザーに何が見えるか — 正直に書く】
--   世帯の一員になるので、買い物・在庫・レシピ・献立・家事・支出・
--   予算・口座残高・投資・俸給表まで【全部読める】。
--   チャットに家計の相談をさせる以上、ここは絞れない。
--
--   ただし【非公開タグを付けた予定は見えない】。
--   11_schema_v5.sql の判定は「その予定の持ち主だけ」なので、
--   人間ではないこのユーザーには最初から見えない。夫の分も妻の分も。
--
-- 【いらなくなったら】
--   このファイルの一番下に、外す SQL を書いてある。
-- ============================================================


-- ------------------------------------------------------------
-- 1. 専用ユーザーを世帯に入れる
--
-- user_id を手で貼らずメールで引くのは、UUID の写し間違いを防ぐため。
-- 過去にこの手の貼り付けで何度か事故っている。
-- ------------------------------------------------------------

insert into household_members (household_id, user_id, display_name)
select h.id, u.id, 'Cowork'
  from households h
 cross join auth.users u
 where u.email = 'm.mizuno1224+cowork@gmail.com'
on conflict (household_id, user_id) do update
  set display_name = excluded.display_name;


-- ------------------------------------------------------------
-- 2. 同じ世帯の人の名前が互いに見えるようにする
--
-- 既定のポリシーは「自分の行だけ」を返すので、
-- アプリに相手の名前が出ず「パートナー」の固定表示になる。
-- 03_patch_members.sql と同じ内容。まだ当てていなければここで当たる。
-- (実測: いま夫のログインからは自分1人しか見えていない)
-- ------------------------------------------------------------

drop policy if exists own_membership on household_members;
drop policy if exists household_members_visible on household_members;

create policy household_members_visible on household_members for select
  using (household_id in (select my_household_ids()));


-- ============================================================
-- 確認
--
-- 【期待】3行出る。夫 / 妻 / Cowork。
--   1行しか出ない、または Cowork が無い場合は、
--   ダッシュボードでのユーザー作成が済んでいない。
-- ============================================================

select hm.display_name,
       u.email,
       hm.joined_at::date as 参加日
  from household_members hm
  join auth.users u on u.id = hm.user_id
 order by hm.joined_at;


-- ============================================================
-- 【外すとき】チャットからの接続をやめる場合
--
--   delete from household_members
--    where user_id = (select id from auth.users
--                      where email = 'm.mizuno1224+cowork@gmail.com');
--
--   これだけで、スキルが漏れていても世帯のデータには一切触れなくなる。
--   ユーザーそのものを消したいときは、あわせてダッシュボードの
--   Authentication → Users から削除する。
--
--   【パスワードを変えるだけでもよい】。その場合はダッシュボードで変更し、
--   スキルの cowork.json も同じ値に直すこと(直さないと動かなくなる)。
-- ============================================================
