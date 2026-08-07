-- ============================================================
-- jisui アプリ スキーマ (Supabase / PostgreSQL)
-- 現行 jisui.db(SQLite)から移植。Supabase の SQL Editor に貼って実行する。
-- ============================================================

-- 世帯(夫婦で1レコード)。全テーブルをこれで束ね、RLSの単位にする。
create table households (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'わが家',
  created_at timestamptz not null default now()
);

-- 世帯メンバー(Supabase Auth の user と世帯の紐付け)
create table household_members (
  household_id uuid not null references households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text,
  joined_at timestamptz not null default now(),
  primary key (household_id, user_id)
);

-- 調理器具マスター
create table equipment (
  id bigserial primary key,
  household_id uuid not null references households(id) on delete cascade,
  name text not null,
  memo text
);

-- 常備品マスター(調味料・乾物・米・油など)
create table pantry (
  id bigserial primary key,
  household_id uuid not null references households(id) on delete cascade,
  name text not null,
  category text,                                   -- 基本調味料/スパイス/乾物/主食/その他
  stock text not null default 'ある'
    check (stock in ('ある','切れそう','切れた')),
  staple boolean not null default false,           -- お決まり食材(毎回チェックする定番)
  memo text
);

-- 好み・NG食材・方針
create table preferences (
  id bigserial primary key,
  household_id uuid not null references households(id) on delete cascade,
  kind text not null check (kind in ('苦手','好き','方針')),
  item text not null,
  memo text,
  added_at timestamptz not null default now()
);

-- 在庫(生鮮・日配)
create table inventory (
  id bigserial primary key,
  household_id uuid not null references households(id) on delete cascade,
  name text not null,
  qty numeric,
  unit text,
  location text not null default '冷蔵'
    check (location in ('冷蔵','冷凍','常温')),
  expiry date,
  bought_on date,
  price integer,
  updated_at timestamptz not null default now()
);

-- レシピ
create table recipes (
  id bigserial primary key,
  household_id uuid not null references households(id) on delete cascade,
  name text not null,
  category text,                                   -- 主菜/副菜/汁物/麺・丼/弁当おかず/その他
  protein text,                                    -- 豚/鶏/牛/魚/卵/豆/なし
  time_min integer,
  freezable boolean not null default false,
  freeze_notes text,
  card_md text,                                    -- レシピカード本文(Markdown)。旧card_pathの中身をここへ
  source text,
  tags text,
  created_at timestamptz not null default now()
);

-- レシピ材料(2人分に正規化)
create table recipe_ingredients (
  id bigserial primary key,
  recipe_id bigint not null references recipes(id) on delete cascade,
  name text not null,
  qty numeric,
  unit text,
  optional boolean not null default false
);

-- 調理記録
create table cook_log (
  id bigserial primary key,
  household_id uuid not null references households(id) on delete cascade,
  date date not null,
  recipe_id bigint references recipes(id) on delete set null,
  name text,
  batch boolean not null default false,            -- 弁当バッチ調理
  rating smallint check (rating between 1 and 5),
  memo text,
  created_at timestamptz not null default now()
);

-- 献立
create table meal_plan (
  id bigserial primary key,
  household_id uuid not null references households(id) on delete cascade,
  date date not null,
  slot text not null default '夕食',
  recipe_id bigint references recipes(id) on delete set null,
  name text,
  status text not null default '予定'
    check (status in ('予定','実施','中止'))
);

-- 買い物リスト
create table shopping_list (
  id bigserial primary key,
  household_id uuid not null references households(id) on delete cascade,
  item text not null,
  qty text,
  reason text,
  section text,                                    -- 売り場: 野菜/肉・魚/乳製品・卵・豆腐/加工品・その他/調味料/冷凍/要確認/セール枠
  sort_order integer not null default 0,
  status text not null default '未購入'
    check (status in ('未購入','購入済')),
  checked_by uuid references auth.users(id),       -- 誰がチェックしたか(2人で買い物する時に効く)
  checked_at timestamptz,
  added_at timestamptz not null default now()
);

create index on inventory (household_id, location);
create index on shopping_list (household_id, status);
create index on meal_plan (household_id, date);
create index on cook_log (household_id, date);
create index on recipe_ingredients (recipe_id);

-- ============================================================
-- Row Level Security: 自分が属する世帯のデータだけ読み書きできる
-- ============================================================
create or replace function my_household_ids()
returns setof uuid language sql stable security definer as $$
  select household_id from household_members where user_id = auth.uid()
$$;

do $$
declare t text;
begin
  foreach t in array array['equipment','pantry','preferences','inventory','recipes',
                           'cook_log','meal_plan','shopping_list']
  loop
    execute format('alter table %I enable row level security', t);
    execute format($f$create policy household_rw on %I
      for all using (household_id in (select my_household_ids()))
      with check (household_id in (select my_household_ids()))$f$, t);
  end loop;
end $$;

-- recipe_ingredients は recipes 経由で世帯を判定する
alter table recipe_ingredients enable row level security;
create policy household_rw on recipe_ingredients for all
  using (recipe_id in (select id from recipes where household_id in (select my_household_ids())))
  with check (recipe_id in (select id from recipes where household_id in (select my_household_ids())));

alter table households enable row level security;
create policy own_household on households for select
  using (id in (select my_household_ids()));

alter table household_members enable row level security;
create policy own_membership on household_members for select
  using (user_id = auth.uid());

-- ============================================================
-- リアルタイム配信(2人で買い物中にチェックが即反映される)
-- ============================================================
alter publication supabase_realtime add table shopping_list;
alter publication supabase_realtime add table inventory;
