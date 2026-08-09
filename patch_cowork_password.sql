-- ============================================================
-- patch_cowork_password.sql — Cowork 専用ユーザーのパスワードを設定する
--
-- 【なぜ SQL で変えるのか】
--   ダッシュボードの「Reset password」は、確認メールを送ってリンクを踏む方式。
--   受け取って開いて設定して…と手間がかかるうえ、途中で失敗しても
--   何が悪かったのか分かりにくい。
--   SQL なら1回で決まるし、下の確認クエリで「本当に変わったか」まで見える。
--
-- 【安全性】
--   変えるのは Cowork 専用ユーザー1人だけ。メールアドレスで指定しているので、
--   夫・妻のログインには一切触れない。
--   パスワードはそのまま保存されず、暗号化(bcrypt)されて入る。
--
-- 【これは何のためのユーザーか】
--   チャット(Cowork)は Anthropic のクラウドで動くため、このパソコンの
--   .env が読めない。接続情報をスキルに同梱する必要があり、
--   そこに人間のパスワードを入れたくないので専用ユーザーを立てている。
-- ============================================================

-- ------------------------------------------------------------
-- パスワードを設定する
--
-- crypt / gen_salt は pgcrypto の関数。Supabase では extensions スキーマに
-- 入っているので、スキーマ名を付けて呼ぶ(付けないと「関数が無い」と言われる)。
-- gen_salt('bf') は bcrypt。Supabase の Auth が使うのと同じ方式。
-- ------------------------------------------------------------

update auth.users
   set encrypted_password = extensions.crypt(
         'bwHH2iPKlW0fG1qO6fzLa0OqsqHW02kl',
         extensions.gen_salt('bf')
       ),
       updated_at = now()
 where email = 'm.mizuno1224+cowork@gmail.com';


-- ============================================================
-- 確認
--
-- 【期待】1行出て、3つとも次のとおり:
--     パスワード一致        = true
--     確認済み              = true
--     世帯に入っている      = true
--
-- パスワード一致が false なら、上の update が当たっていない
-- (メールアドレスの綴りを確認すること)。
-- ============================================================

select u.email,
       u.encrypted_password = extensions.crypt(
         'bwHH2iPKlW0fG1qO6fzLa0OqsqHW02kl', u.encrypted_password
       )                                                as パスワード一致,
       u.email_confirmed_at is not null                 as 確認済み,
       exists (select 1 from household_members hm
                where hm.user_id = u.id)                as 世帯に入っている
  from auth.users u
 where u.email = 'm.mizuno1224+cowork@gmail.com';


-- ============================================================
-- 【あとで変えたくなったら】
--   上の3か所の 'bwHH2iPKlW0fG1qO6fzLa0OqsqHW02kl' を新しい文字列に
--   置き換えて流し直す。あわせて、スキルの cowork.json の
--   JISUI_PASSWORD も同じ値に直すこと(直さないとチャットが繋がらなくなる)。
--
-- 【接続をやめたくなったら】
--   patch_cowork_user.sql の末尾に、世帯から外す SQL を書いてある。
-- ============================================================
