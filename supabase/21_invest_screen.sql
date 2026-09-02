-- ============================================================
-- 21_invest_screen.sql — 高配当株の「候補を並べて選ぶ」ための表
--
-- 【なぜ watchlist に足さないのか】
--   watchlist は「ずっと見ている銘柄」で、1銘柄1行・上書きの表である。
--   ここで作りたいのはそれではなく、**その日に20銘柄を並べた記録**。
--   ・同じ銘柄が、9月は「割安」で10月は「高値圏」になる
--   ・落ちた17銘柄も残っていないと「なぜこの3つだったか」が後から辿れない
--   watchlist に上書きすると、この2つが毎回消える。日付ごとに残す表を分ける。
--
-- 【screenings と screening_candidates を id で繋がない】
--   繋ぐ鍵は (household_id, as_of) にしてある。id で繋ぐと、チャットが
--   Supabase に届かないとき(README「inbox に置く」)に困る。受け渡し JSON は
--   「その場で採番された id」を持てないので、親を入れて id を貰ってからでないと
--   子を組み立てられない。日付を鍵にしておけば、親子を別々に書き出せて、
--   片方だけ適用された状態でも候補は画面に出る。
--
-- 【点数はアプリが計算する。表には素の数字だけ入れる】
--   利回り・PER・PBR・配当性向・連続増配年数を、出典つきでそのまま入れる。
--   総合点は lib/screening.ts が invest_policy の重みを使って毎回計算する。
--   点数を列に焼くと、重みを変えたときに全部入れ直しになる。
--   逆に「推薦(recommended)」と理由は人の判断に近いのでチャットが書く。
--
-- 【推薦は助言ではない】
--   invest_policy に入っている**自分たちで決めた基準**での並びであって、
--   一般的な投資助言ではない。買うかどうかを決めるのは stock_decisions に
--   人が押したボタンだけ。数値は出典つきで、推測で補完しない(KAKEIBO.md)。
--
-- 【値そのものはこの SQL に書かない】
--   20_checkup.sql と同じ理由。**このリポジトリは公開である。**
--   いくら持っているか・いくら出せるかは残さない。表だけをここで作る。
--
-- 実行: Supabase の SQL Editor に貼る。09_schema_v4.sql のあと。何度流してもよい。
-- ============================================================


-- ------------------------------------------------------- 絞り込み1回ぶん
--
-- 「2026-09-02 に、この基準で、この母集団から20銘柄を並べた」という見出し。
-- 同じ日に2回流したときは入れ直しになる(unique が (household_id, as_of))。
create table if not exists screenings (
  id            bigserial primary key,
  household_id  uuid not null references households(id) on delete cascade,
  as_of         date not null,
  -- そのとき使った条件を、人が読む文章のまま残す。
  -- 例:「東証プライム・時価総額3000億以上・予想利回り3.5%以上・減配していない」
  criteria      text,
  -- 母集団と出どころ。「株探の高配当利回りランキング上位80銘柄から」など。
  universe      text,
  -- 相場全体の所感。個別銘柄ではなく、その日の前提(金利・為替・決算期)。
  note          text,
  created_at    timestamptz not null default now(),
  unique (household_id, as_of)
);

-- ------------------------------------------------------------ 候補1銘柄
--
-- 1回の絞り込みで20行前後。落ちた銘柄も入れる(recommended = false)。
create table if not exists screening_candidates (
  id            bigserial primary key,
  household_id  uuid not null references households(id) on delete cascade,
  -- screenings と同じ日付で並ぶ。**id ではなくこれが親子の鍵**(冒頭参照)。
  as_of         date not null,
  code          text not null,
  name          text not null,
  market        text,
  -- 業種。一覧で見えないと、気づいたら銀行と商社だけになる。
  sector        text,

  -- ------- 素の数字。すべて出典つきで、分からない項目は null のままにする -------
  price         numeric,               -- 株価
  unit_shares   integer default 100,   -- 単元株数(1単元=何株か)
  div_yield     numeric,               -- 予想配当利回り(%)
  dividend      numeric,               -- 1株あたり年間配当(予想・円)
  per           numeric,
  pbr           numeric,
  payout_ratio  numeric,               -- 配当性向(%)
  streak_years  integer,               -- 連続増配年数
  -- 累進配当(減配しない)を会社が明言しているか。
  -- 「たまたま続いている」のと「方針として言っている」のは別物なので分けて持つ。
  progressive   boolean,
  year_high     numeric,               -- 年初来高値
  year_low      numeric,               -- 年初来安値

  -- ------- ここから先は人の判断に近い部分。チャットが書く -------
  recommended   boolean not null default false,  -- 推薦の3銘柄か
  rank          integer,                          -- 推薦の中での順位(1..3)
  reason        text,                             -- なぜ推すか / なぜ落ちるか
  risk          text,                             -- 弱点。ここが空の候補は信用しない
  source        text,                             -- 出典と時点。必須のつもりで書く

  unique (household_id, as_of, code)
);

-- --------------------------------------------------------- 人が押した判断
--
-- 「買う / 見送る / 保留」と、目標の買値。**銘柄ごとに最新の1件だけ**持つ。
-- 履歴を積まないのは、次に一覧を見たとき知りたいのが「いま自分はこれをどう思って
-- いるか」だけだから。過去の理由は memo に書き足していけばよい。
create table if not exists stock_decisions (
  id            bigserial primary key,
  household_id  uuid not null references households(id) on delete cascade,
  code          text not null,
  name          text not null,
  decision      text not null check (decision in ('買う', '見送る', '保留')),
  -- 目標の買値。「2,800円まで下がったら買う」。
  -- 到達したかどうかは、次に指標を更新したときに画面が知らせる。
  target_price  numeric,
  memo          text,
  decided_at    date not null default current_date,
  -- どの日の一覧を見て決めたか。あとで「そのときの数字」に戻れるようにする。
  from_as_of    date,
  unique (household_id, code)
);

-- ------------------------------------------------------------- 判断の基準
--
-- 1世帯1行。**アプリから直せる**(候補タブの「基準」)。
-- 重みを変えると並び順がその場で変わる。数字を取り直す必要はない。
create table if not exists invest_policy (
  -- 1世帯1行なので household_id を主キーにしてもよいが、アプリの読み取り
  -- (lib/use-table.ts)が「id を鍵にキャッシュへ入れる」作りなので id を持たせる。
  id               bigserial primary key,
  household_id     uuid not null unique references households(id) on delete cascade,
  -- 1銘柄あたり出せる上限(円)。単元価格がこれを超える候補は「予算超」と出す。
  budget_per_stock bigint,
  -- 4つの軸の重み。合計が100でなくてもよい(比で使う)。
  w_yield          integer not null default 25,   -- 配当利回りの高さ
  w_growth         integer not null default 25,   -- 増配・累進配当の継続性
  w_value          integer not null default 25,   -- 割安さ(PER/PBR・年初来位置)
  w_safety         integer not null default 25,   -- 配当の余力(配当性向)
  -- 足切り。これ未満の利回りは一覧で薄く出す(消しはしない)。
  min_yield        numeric,
  note             text,
  updated_at       timestamptz not null default now()
);

create index if not exists screening_candidates_asof_idx
  on screening_candidates (household_id, as_of desc, code);
create index if not exists stock_decisions_code_idx
  on stock_decisions (household_id, code);

-- ============================================================
-- RLS: 自分が属する世帯のぶんだけ読み書きできる(09_schema_v4.sql と同じ形)
-- ============================================================

do $$
declare t text;
begin
  foreach t in array array['screenings','screening_candidates',
                           'stock_decisions','invest_policy']
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

-- ============================================================
-- 確認: 4行すべて rls_enabled = true なら準備完了
-- ============================================================
select c.relname as table_name, c.relrowsecurity as rls_enabled
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('screenings','screening_candidates',
                    'stock_decisions','invest_policy')
order by 1;
