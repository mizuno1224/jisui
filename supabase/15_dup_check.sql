-- ============================================================
-- 二重計上の疑いを、消さずに印で残せるようにする
--
-- 【いまの dedup_hash では足りない】
-- dedup_hash は sha256(日付|金額|店名)で、【同じ明細を二度読んだ】ことしか
-- 防げない。ところが実際の二重計上はこう起きる:
--   ・レシートで記録した買い物が、あとからカード明細にも出てくる
--     (店名の書き方が違い、日付も1〜2日ずれるので鍵が別になる)
--   ・iD と QUICPay のように、決済の経路が違うカードに同じ買い物が出る
-- 実データにも、同じ日・同じ金額・同じ自販機の行が4件あった。
--
-- 【消さない。印を付けて人に見せる】
-- 本当に2本買ったのか、二重に入ったのかは行を見ても分からない。
-- 自動で消すと、本物の支出が黙って消える。家計が実態より軽く見え、
-- しかも誰も気づけない。判断は人がする。
--
-- 【「別々でよい」を覚える】
-- 一度「これは別々の買い物」と決めたものが、次の検査でまた出てくると、
-- 同じ判断を毎回させられる。うんざりして全部無視するようになる。
-- 決めたことは覚えておく。
--
-- 実行: Supabase の SQL Editor に貼って実行する。何度実行してもよい。
-- ============================================================

alter table transactions
  add column if not exists dup_ok boolean not null default false;

comment on column transactions.dup_ok is
  '人が「これは二重計上ではない(別々の買い物)」と確かめた印。検査から外す';

-- 検査は「同じ金額・近い日付」で引く。金額から引けるようにしておく。
create index if not exists transactions_amount_date_idx
  on transactions (household_id, amount, date);


-- ---------------------------------------------------------------- 疑わしい組
-- 同じ金額で、日付が3日以内、出どころが違うもの。
--
-- 【出どころが同じものは除く】
-- ETC の「同じ日・同じ金額」は、別々の料金所を通った本物の2件である。
-- 同じ明細の中の同額を疑い始めると、正しい記録まで印が付いて読めなくなる。
create or replace view suspected_duplicates as
select
  a.household_id,
  a.id                as id_a,
  b.id                as id_b,
  a.date              as date_a,
  b.date              as date_b,
  a.amount,
  a.merchant_raw      as merchant_a,
  b.merchant_raw      as merchant_b,
  a.source            as source_a,
  b.source            as source_b,
  abs(a.date - b.date) as 日数差
from transactions a
join transactions b
  on  b.household_id = a.household_id
  and b.id > a.id                          -- 同じ組を2回出さない
  and b.amount = a.amount
  and b.source <> a.source
  and (
        -- 【定額のものは、同じ日でなければ疑わない】
        -- ETC の 540円 は19回出る。金額が一致しても情報にならないのに、
        -- 3日以内という条件だけで組が量産される。実データで9組中8組が
        -- ETC の誤検知だった。毎回片付けさせると、やがて全部無視される。
        case
          when (select count(*) from transactions c
                 where c.household_id = a.household_id and c.amount = a.amount) >= 5
          then b.date = a.date
          else abs(b.date - a.date) <= 3
        end
      )
where a.dup_ok = false
  and b.dup_ok = false;


-- ---------------------------------------------------------------- 確かめる
select 日数差, count(*) as 組数, sum(amount) as 片方の合計
  from suspected_duplicates
 group by 日数差
 order by 日数差;
