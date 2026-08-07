-- ============================================================
-- 追加スキーマ: 予定・家事・予算・資産・収入
-- schema.sql / schema_kakeibo.sql の後に実行する。
--
-- 【注意】資産・負債・給与について
--   設計書 5-2 は「機密度が違う」として、これらをクラウドに置かず
--   手元の kakeibo.db に残す方針だった。今回はアプリで扱う判断をしたため
--   ここに含めている。そのぶん守りを厚くしてある:
--     ・全テーブル RLS を有効化し、自分の世帯のデータしか触れない
--     ・ビューは作らない(ビューは既定で RLS を迂回する。patch_views_rls.sql 参照)
--     ・口座番号・カード番号は保存しない(列自体を用意しない)
--   実行後、未ログインで読めないことを必ず実測で確認すること。
-- ============================================================

-- ------------------------------------------------------------ 予定

create table events (
  id bigserial primary key,
  household_id uuid not null references households(id) on delete cascade,
  date date not null,
  end_date date,                                   -- 複数日にまたがる予定
  start_time time,                                 -- null なら終日
  end_time time,
  title text not null,
  memo text,
  -- null = 2人の共有予定 / user_id = その人の個人予定
  -- 個人予定も相手からは見える(夫婦で予定を突き合わせるため)。
  -- 表示上だけ「夫の予定 / 妻の予定 / 2人の予定」に分ける。
  owner_id uuid references auth.users(id) on delete cascade,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------- 繰り返しの家事

create table chores (
  id bigserial primary key,
  household_id uuid not null references households(id) on delete cascade,
  name text not null,
  -- 曜日指定。0=日 〜 6=土。毎日なら {0,1,2,3,4,5,6}
  weekdays smallint[] not null default '{}',
  -- 毎月n日にやるもの(家賃の支払いなど)。weekdays が空のときだけ見る
  monthday smallint check (monthday between 1 and 31),
  assignee_id uuid references auth.users(id) on delete set null,
  memo text,
  active boolean not null default true,
  sort_order integer not null default 0
);

create table chore_log (
  id bigserial primary key,
  household_id uuid not null references households(id) on delete cascade,
  chore_id bigint not null references chores(id) on delete cascade,
  date date not null,
  done_by uuid references auth.users(id),
  done_at timestamptz not null default now(),
  unique (chore_id, date)                          -- 同じ日に二重で記録しない
);

-- ------------------------------------------------------------ 予算

create table budgets (
  id bigserial primary key,
  household_id uuid not null references households(id) on delete cascade,
  category text not null,
  amount integer not null,
  -- null = 毎月の既定。'2026-08' を入れるとその月だけ上書きする
  year_month text,
  constraint budgets_unique unique nulls not distinct (household_id, category, year_month)
);

-- ---------------------------------------------------- 資産・負債・収入

-- 口座や資産の「名前」だけを持つ。口座番号・カード番号は列自体を作らない。
create table accounts (
  id bigserial primary key,
  household_id uuid not null references households(id) on delete cascade,
  name text not null,                              -- 例: 三井住友銀行、住宅ローン、NISA
  kind text not null check (kind in ('資産','負債')),
  category text,                                   -- 預金/投資/年金/不動産/ローン など
  memo text,
  sort_order integer not null default 0,
  active boolean not null default true
);

-- 残高は月ごとに1行。推移が見えるようにするため。
create table balances (
  id bigserial primary key,
  household_id uuid not null references households(id) on delete cascade,
  account_id bigint not null references accounts(id) on delete cascade,
  year_month text not null,                        -- 'YYYY-MM'
  amount bigint not null,                          -- 円。負債も正の数で入れ、kind で符号を決める
  unique (account_id, year_month)
);

create table income (
  id bigserial primary key,
  household_id uuid not null references households(id) on delete cascade,
  date date not null,
  amount integer not null,
  source text not null,                            -- 例: 給与(夫)、賞与、その他
  category text,
  memo text
);

create index on events (household_id, date);
create index on chore_log (household_id, date);
create index on balances (household_id, year_month);
create index on income (household_id, date desc);

-- ============================================================
-- RLS: 自分が属する世帯のデータだけ読み書きできる
-- ============================================================

do $$
declare t text;
begin
  foreach t in array array['events','chores','chore_log','budgets',
                           'accounts','balances','income']
  loop
    execute format('alter table %I enable row level security', t);
    execute format($f$create policy household_rw on %I
      for all using (household_id in (select my_household_ids()))
      with check (household_id in (select my_household_ids()))$f$, t);
  end loop;
end $$;

-- ============================================================
-- リアルタイム配信(2人の画面が互いに追随する)
-- ============================================================

alter publication supabase_realtime add table events;
alter publication supabase_realtime add table chore_log;

-- ============================================================
-- 確認: 実行後にこれを流すと、RLS が付いているか一覧で見える
-- ============================================================

select c.relname as table_name, c.relrowsecurity as rls_enabled
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('events','chores','chore_log','budgets','accounts','balances','income')
order by 1;
