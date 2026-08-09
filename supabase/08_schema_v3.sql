-- ============================================================
-- 予定機能の拡張(07_schema_v2.sql の後に実行する)
--
--   ・ラベル(色分け)
--   ・繰り返し(毎週・隔週・毎月・毎年)
--   ・予定ごとのやりとり(コメント)
--
-- 「今週どうする?」の相談が、アプリの中で完結するようにするための追加。
-- 予定を見ながら別のアプリで連絡する、という往復が一番の手間だった。
-- ============================================================

-- ラベル。色は決め打ちの一覧からアプリ側で対応させる。
-- テーブルを増やさないのは、2人で使ううちは分類が増えないため。
alter table events add column if not exists label text;

-- 繰り返し。毎週の習い事や、毎月の支払いなど。
-- 展開はアプリ側で行い、行は1本だけ持つ(消すときに全部消えるほうが分かりやすい)。
alter table events add column if not exists repeat text not null default 'なし';
alter table events add column if not exists repeat_until date;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'events_repeat_check'
  ) then
    alter table events add constraint events_repeat_check
      check (repeat in ('なし','毎週','隔週','毎月','毎年'));
  end if;
end $$;

-- 予定ごとのやりとり。
-- 「何時に出る?」「駅で待ち合わせ」のような短い相談を予定に紐づけて残す。
create table if not exists event_comments (
  id bigserial primary key,
  household_id uuid not null references households(id) on delete cascade,
  event_id bigint not null references events(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  body text not null,
  created_at timestamptz not null default now()
);

create index if not exists event_comments_event_idx on event_comments (event_id, created_at);

alter table event_comments enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'event_comments' and policyname = 'household_rw'
  ) then
    create policy household_rw on event_comments for all
      using (household_id in (select my_household_ids()))
      with check (household_id in (select my_household_ids()));
  end if;
end $$;

-- 相手の書き込みがすぐ出るように配信対象へ入れる
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'event_comments'
  ) then
    alter publication supabase_realtime add table event_comments;
  end if;
end $$;

-- ============================================================
-- 確認: 3行とも true なら準備完了
-- ============================================================
select
  (select count(*) from information_schema.columns
     where table_name = 'events' and column_name in ('label','repeat','repeat_until')) = 3
     as events_列を追加できた,
  (select count(*) from information_schema.tables
     where table_name = 'event_comments') = 1 as コメント表を作れた,
  (select relrowsecurity from pg_class where relname = 'event_comments') as RLSが有効;
