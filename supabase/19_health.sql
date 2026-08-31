-- ============================================================
-- 19_health.sql — 「くらし」を健康まで広げる(第1段階・第2段階)
--
-- 本人の要望は「食事に限らず、運動・感染・体重・睡眠まで含めて、
-- 長期的に健康でいられるようにアプリで支えたい」。
--
-- 【この SQL の芯は2つ】
--   1. 入力させないこと。体重は前回値からのスピナー、睡眠は就寝・起床の2つだけ、
--      野菜量と塩分は【レシピに数値を持たせて献立から自動集計】する。
--      だから recipes に veg_g / salt_g / kcal / protein_g を足す。ここが一番効く。
--   2. 数値目標は公的ガイドラインからだけ取り、**出典を列に持つ**。
--      根拠のない独自基準を作らない。あとで誰も直せなくなる。
--
-- 【やらないと決めたこと】(コードにも書いていない)
--   ・診断をしない。「◯◯の疑いがあります」は出さない
--   ・独自の健康スコアを作らない。出典のある基準だけを並べる
--   ・**減量前提にしない。** この世帯は妻が少食で、体重を増やしたい方針。
--     BMI 21 を下回れば「増やす」が正解になる。痩せすぎもリスクである、
--     というのがガイドラインの立場(国立がん研究センター)。
--
-- 実行: Supabase の SQL Editor に貼って実行する。
--       何度実行してもよい(if not exists と on conflict で書いてある)。
--       生年月日と身長は preferences に書いてあったものを写すので、
--       流した時点で BMI も検診の期限も出る。値はアプリで直せる。
-- ============================================================


-- ------------------------------------------------------------------
-- 世帯員の呼び名
--
-- 既存の transactions.share / transactions.payer が '夫' '妻' の文字列で
-- 動いているので、それに合わせる。auth の user_id で持つほうが筋は良いが、
-- 表が増えるたびに household_members を引く手間が増えるうえ、
-- 「夫の体重」を人が SQL で見るときに読めなくなる。
-- ------------------------------------------------------------------
do $$ begin
  if not exists (select 1 from pg_type where typname = 'health_member') then
    create domain health_member as text check (value in ('夫', '妻'));
  end if;
end $$;


-- ---------------------------------------------------------------- 世帯員ごとの前提
--
-- 【birth_date が要る】。がん検診の対象年齢と次回期限の計算に必須。
-- height_cm が無いと BMI が出ない。この2つが空だと機能の半分が動かない。
create table if not exists health_profile (
  id            bigserial primary key,
  household_id  uuid not null references households(id) on delete cascade,
  member        health_member not null,
  birth_date    date,
  sex           text check (sex in ('男', '女')),
  height_cm     numeric(4,1),
  -- 喫煙はがん予防法の1番目。過去喫煙でも肺がん検診の意味が変わる
  smoking       text check (smoking in ('吸わない', '過去に吸っていた', '吸う')),
  -- がん予防法の6番目「感染」。ピロリ菌は【1回で終わる管理】なので状態だけ持つ
  piroli_status text check (piroli_status in ('未検査', '陰性', '陽性', '除菌済')),
  memo          text,
  updated_at    timestamptz not null default now(),
  unique (household_id, member)
);


-- ---------------------------------------------------------------- 日々の記録
--
-- どれも unique(household_id, date, member)。
-- 【1日1行に固定する理由】アプリからは upsert で書く。行が増える形にすると
-- 「今日の体重」がどれなのか決まらず、グラフが飛ぶ。直すのは上書きでよい。

create table if not exists vitals (
  id            bigserial primary key,
  household_id  uuid not null references households(id) on delete cascade,
  date          date not null,
  member        health_member not null,
  weight_kg     numeric(4,1),
  body_fat_pct  numeric(3,1),
  waist_cm      numeric(4,1),
  bp_systolic   integer,
  bp_diastolic  integer,
  memo          text,
  unique (household_id, date, member)
);
create index if not exists vitals_by_member on vitals (household_id, member, date);

create table if not exists sleep_log (
  id            bigserial primary key,
  household_id  uuid not null references households(id) on delete cascade,
  date          date not null,          -- 【起きた日】で記録する。翌朝まとめて入れられるように
  member        health_member not null,
  bedtime       time,
  wake_time     time,
  -- 【睡眠休養感】。厚労省「健康づくりのための睡眠ガイド」は時間だけでなく
  -- この主観指標を重視している。1〜5でよいので必ず持たせること。
  rest_feeling  smallint check (rest_feeling between 1 and 5),
  memo          text,
  unique (household_id, date, member)
);

-- 眠っていた時間。就寝が前日の夜になるので、日をまたぐぶんを足す。
--
-- 【生成列にしてある】。アプリと SQL の両方で計算すると必ずずれる。
-- もしこの alter が
--   ERROR: generation expression is not immutable
-- で落ちる環境なら、ここだけ次に差し替えること(アプリ側の計算を正とする):
--   alter table sleep_log add column if not exists hours numeric(4,2);
alter table sleep_log add column if not exists hours numeric(4,2)
  generated always as (
    case
      when bedtime is null or wake_time is null then null
      else round(
        ((extract(epoch from (wake_time - bedtime))
          + case when wake_time < bedtime then 86400 else 0 end)::numeric) / 3600.0, 2)
    end
  ) stored;

create table if not exists activity_log (
  id                bigserial primary key,
  household_id      uuid not null references households(id) on delete cascade,
  date              date not null,
  member            health_member not null,
  steps             integer,
  -- 3メッツ以上の身体活動(厚労省「身体活動・運動ガイド2023」の数え方)
  active_minutes    integer,
  -- そのうち「息が弾む程度の運動」。活動の内数
  exercise_minutes  integer,
  strength_training boolean not null default false,
  memo              text,
  unique (household_id, date, member)
);

create table if not exists alcohol_log (
  id              bigserial primary key,
  household_id    uuid not null references households(id) on delete cascade,
  date            date not null,
  member          health_member not null,
  -- 純アルコール量 = 量(ml) x 度数(%) x 0.8 / 100
  -- 0 は【休肝日を明示した】という記録。null(未入力)とは違う
  pure_alcohol_g  numeric(5,1) not null default 0,
  drinks_memo     text,
  unique (household_id, date, member)
);


-- ---------------------------------------------------------------- 検診・予防接種
--
-- 【ここが長期的には一番効く】。食事の最適化より、大腸がん検診を毎年受けるほうが
-- 寿命への効果は大きい。対象年齢に達する年に自動で「やること」が立つのが値打ち。
-- 次回期限は birth_date と間隔から出す(計算は lib/health.ts)。

create table if not exists screening (
  id            bigserial primary key,
  household_id  uuid not null references households(id) on delete cascade,
  member        health_member not null,
  kind          text not null,          -- 胃 / 大腸 / 肺 / 乳 / 子宮頸 …
  last_done_on  date,
  next_due_on   date,
  result        text,
  memo          text,
  unique (household_id, member, kind)
);

create table if not exists vaccination (
  id            bigserial primary key,
  household_id  uuid not null references households(id) on delete cascade,
  member        health_member not null,
  kind          text not null,          -- インフルエンザ / 帯状疱疹 / B型肝炎 / HPV …
  done_on       date,
  next_due_on   date,
  memo          text,
  unique (household_id, member, kind)
);


-- ---------------------------------------------------------------- 目標値と出典
--
-- 【目標値をコードに埋めない】ための表。**出典の列は必須。**
-- 数値だけが残ると、半年後に「なぜ 350g なのか」が誰にも分からなくなり、
-- 誰かが何となく 300g に直してしまう。出典があれば直すか残すかを判断できる。
--
-- アプリは lib/health.ts の既定値にこの表を【上書きとして重ねて】使う。
-- 表が無くても動くが、出典はこの表からしか出ない。
create table if not exists health_targets (
  id            bigserial primary key,
  household_id  uuid not null references households(id) on delete cascade,
  key           text not null,          -- lib/health.ts のキーと1文字も違わないこと
  label         text not null,
  -- 【'共通' を使い、null にしない】
  -- unique(...) は null 同士を別物として扱うので、member を null にすると
  -- on conflict が当たらず、この SQL を流すたびに目標値が二重に増える。
  -- health_member ドメイン(夫/妻)ではなく、ここだけ '共通' を足した text にする。
  member        text not null default '共通' check (member in ('夫', '妻', '共通')),
  min_value     numeric,
  max_value     numeric,
  unit          text,
  period        text,                   -- 日 / 週 / なし
  source        text not null,          -- 【空にしない】
  unique (household_id, key, member)
);


-- ---------------------------------------------------------------- レシピに栄養を持たせる
--
-- 【ここが「入力させない」の要】。1人前の値。
-- 献立を組んだ時点でその日の野菜量と塩分が出るので、食事側の入力がゼロになる。
-- 埋まっていない日は「まだ献立を確定していない日」だと分かる。
alter table recipes add column if not exists veg_g      numeric(5,1);
alter table recipes add column if not exists salt_g     numeric(4,2);
alter table recipes add column if not exists kcal       integer;
alter table recipes add column if not exists protein_g  numeric(5,1);

comment on column recipes.veg_g     is '1人前の野菜量(g)。献立から1日の野菜量を出すのに使う';
comment on column recipes.salt_g    is '1人前の食塩相当量(g)';
comment on column recipes.kcal      is '1人前のエネルギー(kcal)';
comment on column recipes.protein_g is '1人前のたんぱく質(g)';


-- ---------------------------------------------------------------- RLS
--
-- 01_schema.sql と同じ形。自分が属する世帯のぶんだけ読み書きできる。
-- 【ビューは作らない】。既定のビューは作成者権限で動き RLS を素通りする
-- (06_patch_views_rls.sql で一度その穴を塞いでいる)。集計は画面側でやる。
do $$
declare t text;
begin
  foreach t in array array['health_profile','vitals','sleep_log','activity_log',
                           'alcohol_log','screening','vaccination','health_targets']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists household_rw on %I', t);
    execute format($f$create policy household_rw on %I
      for all using (household_id in (select my_household_ids()))
      with check (household_id in (select my_household_ids()))$f$, t);
  end loop;
end $$;


-- ---------------------------------------------------------------- 目標値を入れる
--
-- 【この表はそのまま依頼書の表である。出典なしの行を足さないこと。】
--
-- | 項目       | 基準                              | 出典 |
-- |-----------|-----------------------------------|------|
-- | BMI       | 21〜25(男女とも)                  | 国立がん研究センター「日本人のためのがん予防法」 |
-- | 睡眠      | 成人は6時間以上 + 睡眠休養感        | 厚労省「健康づくりのための睡眠ガイド」 |
-- | 身体活動  | 3メッツ以上を1日60分以上(週23メッツ・時) | 厚労省「身体活動・運動ガイド2023」 |
-- | 運動      | 息が弾む程度を週60分以上            | 同上 |
-- | 筋トレ    | 週2〜3日                           | 同上 |
-- | 食塩      | 男7.5g / 女6.5g 未満(1日)         | がん予防法 |
-- | 野菜・果物 | 野菜350g以上 / 果物200g(1日)      | がん予防法 |
-- | 飲酒      | 純アルコール23g/日未満              | がん予防法 |
insert into health_targets (household_id, key, label, member, min_value, max_value, unit, period, source)
select h.id, v.key, v.label, v.member, v.min_value, v.max_value, v.unit, v.period, v.source
  from households h
 cross join (values
   ('bmi',      'BMI',         '共通', 21::numeric,   25::numeric,   null::text,   'なし', '国立がん研究センター「日本人のためのがん予防法」'),
   ('sleep',    '睡眠時間',     '共通', 6,             null,          '時間',        '日',   '厚生労働省「健康づくりのための睡眠ガイド2023」'),
   ('rest',     '睡眠休養感',   '共通', 4,             null,          '段階',        '日',   '厚生労働省「健康づくりのための睡眠ガイド2023」'),
   ('active',   '身体活動',     '共通', 60,            null,          '分',          '日',   '厚生労働省「健康づくりのための身体活動・運動ガイド2023」'),
   ('mets',     '週の身体活動', '共通', 23,            null,          'メッツ・時',  '週',   '厚生労働省「健康づくりのための身体活動・運動ガイド2023」'),
   ('exercise', '運動',        '共通', 60,            null,          '分',          '週',   '厚生労働省「健康づくりのための身体活動・運動ガイド2023」'),
   ('strength', '筋トレ',      '共通', 2,             3,             '日',          '週',   '厚生労働省「健康づくりのための身体活動・運動ガイド2023」'),
   ('steps',    '歩数',        '共通', 8000,          null,          '歩',          '日',   '厚生労働省「健康日本21(第三次)」20〜64歳の目標'),
   ('salt',     '食塩',        '夫',   null,          7.5,           'g',           '日',   '国立がん研究センター「日本人のためのがん予防法」'),
   ('salt',     '食塩',        '妻',   null,          6.5,           'g',           '日',   '国立がん研究センター「日本人のためのがん予防法」'),
   ('veg',      '野菜',        '共通', 350,           null,          'g',           '日',   '国立がん研究センター「日本人のためのがん予防法」'),
   ('fruit',    '果物',        '共通', 200,           null,          'g',           '日',   '国立がん研究センター「日本人のためのがん予防法」'),
   ('alcohol',  '純アルコール', '共通', null,          23,            'g',           '日',   '国立がん研究センター「日本人のためのがん予防法」')
 ) as v(key, label, member, min_value, max_value, unit, period, source)
 on conflict (household_id, key, member) do update
    set label = excluded.label, min_value = excluded.min_value,
        max_value = excluded.max_value, unit = excluded.unit,
        period = excluded.period, source = excluded.source;


-- ---------------------------------------------------------------- ふたりの前提
--
-- 【生年月日と身長は、すでに preferences に書いてある】
-- 依頼書は「生年月日と身長が無いと機能の半分は動かない」としていたが、
-- 本番を見たら preferences の「方針」に人の手で残されていた(2026-08-30 時点):
--
--   id=17  体格: 夫 1994-12-24生 170cm 64kg (BMI22.1)
--   id=18  体格: 妻 1997-07-30生 164cm 48kg (BMI17.8・低体重)
--
-- そこから写す。**入れ直しではないので、聞き直さずに機能が動きはじめる。**
--
-- 【写した値は、空の欄にしか入れない】
-- coalesce で既存の値を優先する。アプリの「ふたりのこと」で直したあとに
-- この SQL をもう一度流しても、人が入れた値は踏まない。
-- **数字が違っていたらアプリで直すこと。** 正本はここではなく health_profile。
insert into health_profile (household_id, member, birth_date, sex, height_cm, piroli_status, smoking)
select h.id, v.member::health_member, v.birth_date::date, v.sex, v.height_cm, '未検査', '吸わない'
  from households h
 cross join (values
   ('夫', '1994-12-24', '男', 170.0),
   ('妻', '1997-07-30', '女', 164.0)
 ) as v(member, birth_date, sex, height_cm)
 on conflict (household_id, member) do update
    set birth_date = coalesce(health_profile.birth_date, excluded.birth_date),
        sex        = coalesce(health_profile.sex,        excluded.sex),
        height_cm  = coalesce(health_profile.height_cm,  excluded.height_cm);


-- ---------------------------------------------------------------- 最初の体重
--
-- 同じ preferences の行に、その日の体重も書いてある(夫 64kg / 妻 48kg)。
-- 1点だけでもグラフに乗せておくと、体重画面のスピナーが【前回値から始まる】ので、
-- 初回の入力が「開いて保存」の1タップで済む。0 から打たせないためだけの1行。
--
-- 【do nothing にする】。本当に量った値が入っていたら、こちらが正しい。
-- memo にどこから来た数字かを残すので、あとから見て区別できる。
insert into vitals (household_id, date, member, weight_kg, memo)
select h.id, '2026-08-30'::date, v.member::health_member, v.weight_kg,
       'preferences の「体格」の行から写した値(実測ではない)'
  from households h
 cross join (values ('夫', 64.0), ('妻', 48.0)) as v(member, weight_kg)
 on conflict (household_id, date, member) do nothing;


-- ============================================================
-- 確かめる(結果と期待を並べる)
-- ============================================================
select '表' as 見るもの, count(*) as 結果, 8 as 期待
  from information_schema.tables
 where table_schema = 'public'
   and table_name in ('health_profile','vitals','sleep_log','activity_log',
                      'alcohol_log','screening','vaccination','health_targets')
union all
select 'レシピの栄養の列', count(*), 4
  from information_schema.columns
 where table_schema = 'public' and table_name = 'recipes'
   and column_name in ('veg_g','salt_g','kcal','protein_g')
union all
select '睡眠時間の生成列', count(*), 1
  from information_schema.columns
 where table_schema = 'public' and table_name = 'sleep_log' and column_name = 'hours'
union all
select '目標値(出典つき)', count(*), 13
  from health_targets where source <> ''
union all
select 'ふたりの行', count(*), 2 from health_profile
union all
select '生年月日が入った人', count(*), 2 from health_profile where birth_date is not null
union all
select '身長が入った人', count(*), 2 from health_profile where height_cm is not null;

-- 【次にやること】
--   1. アプリを本番に出す(健康タブが増える。sw.js は v24)
--   2. 健康タブ →「ふたりのこと」で、写した生年月日・身長が合っているか見る
--      (preferences から写してあるので、合っていれば触らなくてよい)
--   3. Cowork に既存27品の veg_g / salt_g を埋めてもらう
--      受け渡しの op「update」で1品ずつ送れる(SKILL.md 参照)
