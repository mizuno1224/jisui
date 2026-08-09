-- ============================================================
-- 家計簿(支出のみ)スキーマ — 01_schema.sql の後に実行する
-- 移すのは transactions と 分類辞書 だけ。
-- 資産・負債・給与・投資方針は手元の kakeibo.db に残す(機密度が高く、
-- スマホでの即時性も不要なため)。
-- ============================================================

-- 支出の分類辞書(店名キーワード → 費目)
create table expense_rules (
  id bigserial primary key,
  household_id uuid not null references households(id) on delete cascade,
  keyword text not null,                           -- 店名に部分一致させるキーワード
  category text not null,
  note text,
  created_at timestamptz not null default now(),
  unique (household_id, keyword)
);

-- 取引(支出)
create table transactions (
  id bigserial primary key,
  household_id uuid not null references households(id) on delete cascade,
  date date not null,
  amount integer not null,                         -- 円。支出は正の数
  merchant_raw text not null,                      -- 明細やレシート記載の店名(そのまま)
  merchant_norm text,                              -- 正規化した店名
  category text not null,
  source text not null,                            -- 楽天カード / 三井住友カード / イオンカード / レシート など
  memo text,
  receipt_path text,                               -- Supabase Storage 上のレシート画像(非公開バケット)
  dedup_hash text not null,                        -- sha256(date|amount|merchant_raw)
  needs_review boolean not null default false,     -- カード明細との重複照合が必要な行に立てる
  imported_at timestamptz not null default now(),
  unique (household_id, dedup_hash)
);

-- レシート明細(品目単位)。在庫登録と家計簿を1枚の写真でつなぐための橋渡し。
create table receipt_items (
  id bigserial primary key,
  transaction_id bigint not null references transactions(id) on delete cascade,
  item text not null,
  price integer,
  inventory_id bigint references inventory(id) on delete set null,  -- 在庫に登録したらここで紐づく
  registered boolean not null default false
);

create index on transactions (household_id, date desc);
create index on transactions (household_id, category);
create index on receipt_items (transaction_id);

-- 月次×費目のサマリー(現行 v_monthly_by_category と同じ考え方)
create view v_monthly_by_category as
select household_id, to_char(date,'YYYY-MM') as year_month, category, sum(amount) as total
from transactions group by household_id, year_month, category;

-- 自炊1食あたりコスト: 食費 ÷ その月の調理回数
-- (アプリとチャットのDBが1つになって初めて出せる数字)
create view v_cost_per_meal as
select f.household_id, f.year_month, f.food_total, c.cook_count,
       case when c.cook_count > 0 then round(f.food_total::numeric / c.cook_count) end as yen_per_meal
from (select household_id, to_char(date,'YYYY-MM') year_month, sum(amount) food_total
      from transactions where category='食費' group by 1,2) f
left join (select household_id, to_char(date,'YYYY-MM') year_month, count(*) cook_count
           from cook_log group by 1,2) c
  on c.household_id=f.household_id and c.year_month=f.year_month;

-- RLS
alter table expense_rules enable row level security;
create policy household_rw on expense_rules for all
  using (household_id in (select my_household_ids()))
  with check (household_id in (select my_household_ids()));

alter table transactions enable row level security;
create policy household_rw on transactions for all
  using (household_id in (select my_household_ids()))
  with check (household_id in (select my_household_ids()));

alter table receipt_items enable row level security;
create policy household_rw on receipt_items for all
  using (transaction_id in (select id from transactions
                            where household_id in (select my_household_ids())))
  with check (transaction_id in (select id from transactions
                                 where household_id in (select my_household_ids())));
