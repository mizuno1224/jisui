-- ============================================================
-- 手元の家計簿アプリ(C:\Users\mmizu\家計簿\kakeibo.db)を吸収するための追加
-- schema_v3.sql の後に実行する。
--
-- 手元に残っていて jisui に無かったもの:
--   ・保有銘柄(NISA・iDeCo の中身)
--   ・監視銘柄と、その株価の記録
--   ・資産の内訳(iDeCo が何で構成されているか)
--   ・ローン残高の予定(将来の残高)
--   ・俸給表(年齢ごとの給与見込み)
--   ・やること(家計まわりの宿題)
--
-- 【機密度について】
-- ここに入るのは、資産・給与・投資という最も機密度の高い情報。
-- 設計書 5-2 はこれらをクラウドに置かない方針だったが、
-- 「1つのアプリにまとめる」という判断に合わせて移す。
-- 守りは他と同じく RLS。実行後、未ログインで読めないことを必ず実測する。
-- 口座番号・証券口座番号は列を用意しない(手元のアプリにも無い)。
-- ============================================================

-- ------------------------------------------------------- 資産の内訳

-- accounts の1件が何で構成されているか(iDeCo の中の投信など)
create table if not exists asset_details (
  id bigserial primary key,
  household_id uuid not null references households(id) on delete cascade,
  item text not null,                              -- 親の資産名(accounts.name に対応)
  sub_item text not null,                          -- 内訳の名前
  amount bigint not null,
  as_of date,
  note text,
  unique (household_id, item, sub_item)
);

-- ------------------------------------------------------------ 投資

-- 保有している銘柄。月に1回、証券会社の画面から書き写す想定。
create table if not exists holdings (
  id bigserial primary key,
  household_id uuid not null references households(id) on delete cascade,
  as_of date not null,
  kind text not null,                              -- 投信 / 現物
  account text not null,                           -- NISA成長 / NISAつみたて / iDeCo など
  code text,
  name text not null,
  quantity numeric,
  acq_price numeric,                               -- 取得単価
  cur_price numeric,                               -- 現在値
  acq_amount bigint,                               -- 取得金額
  value bigint,                                    -- 評価額
  pnl bigint,                                      -- 損益
  accumulating boolean not null default false,     -- 積立中か
  unique (household_id, as_of, account, name)
);

-- 買うか検討している銘柄
create table if not exists watchlist (
  id bigserial primary key,
  household_id uuid not null references households(id) on delete cascade,
  code text not null,
  name text not null,
  market text,
  memo text,
  added_at timestamptz not null default now(),
  unique (household_id, code)
);

-- 監視銘柄の指標の記録。推移を見るために日付ごとに残す。
create table if not exists watch_history (
  id bigserial primary key,
  household_id uuid not null references households(id) on delete cascade,
  code text not null,
  as_of date not null,
  price numeric,
  per numeric,
  pbr numeric,
  div_yield numeric,
  dividend numeric,
  year_high numeric,
  year_low numeric,
  note text,
  unique (household_id, code, as_of)
);

-- --------------------------------------------------- 将来の見通し

-- ローン残高の予定。実績と見込みを同じ表に持ち、kind で分ける。
create table if not exists loan_schedule (
  id bigserial primary key,
  household_id uuid not null references households(id) on delete cascade,
  year_month text not null,
  balance bigint not null,
  kind text not null,                              -- 実績 / 見込
  note text,
  unique (household_id, year_month)
);

-- 俸給表。年齢ごとの給与見込み。世帯ごとに持つ(転職すれば入れ替える)。
create table if not exists salary_table (
  id bigserial primary key,
  household_id uuid not null references households(id) on delete cascade,
  age integer not null,
  grade_no integer,
  monthly_salary integer not null,
  bonus_summer integer not null default 0,
  bonus_winter integer not null default 0,
  retire_rate_self numeric,
  retire_rate_teinen numeric,
  retire_rate_komu numeric,
  note text,
  unique (household_id, age)
);

-- ------------------------------------------------------- やること

create table if not exists todos (
  id bigserial primary key,
  household_id uuid not null references households(id) on delete cascade,
  title text not null,
  detail text,
  status text not null default 'open' check (status in ('open','done')),
  assignee_id uuid references auth.users(id) on delete set null,
  due_date date,
  created_at timestamptz not null default now(),
  done_at timestamptz,
  done_by uuid references auth.users(id) on delete set null
);

create index if not exists holdings_asof_idx on holdings (household_id, as_of desc);
create index if not exists watch_history_code_idx on watch_history (household_id, code, as_of desc);
create index if not exists todos_status_idx on todos (household_id, status);

-- ============================================================
-- RLS: 自分が属する世帯のデータだけ読み書きできる
-- ============================================================

do $$
declare t text;
begin
  foreach t in array array['asset_details','holdings','watchlist','watch_history',
                           'loan_schedule','salary_table','todos']
  loop
    execute format('alter table %I enable row level security', t);
    if not exists (
      select 1 from pg_policies where schemaname = 'public' and tablename = t
        and policyname = 'household_rw'
    ) then
      execute format($f$create policy household_rw on %I
        for all using (household_id in (select my_household_ids()))
        with check (household_id in (select my_household_ids()))$f$, t);
    end if;
  end loop;
end $$;

-- やることは2人で潰していくので、相手の操作がすぐ出るようにする
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'todos'
  ) then
    alter publication supabase_realtime add table todos;
  end if;
end $$;

-- ============================================================
-- 確認: 7行すべて rls_enabled = true なら準備完了
-- ============================================================
select c.relname as table_name, c.relrowsecurity as rls_enabled
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('asset_details','holdings','watchlist','watch_history',
                    'loan_schedule','salary_table','todos')
order by 1;
