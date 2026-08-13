-- ============================================================
-- 支出を「夫婦 / 夫 / 妻」に振り分けられるようにする
--
-- 【なぜ要るか】
-- 方針.md では「共用は夫のカード、個人は各自のカード」と決めているが、
-- 実際には1枚のカードで共用も個人も払ってしまう。カードを分けるより、
-- 【あとから振り分ける】ほうが現実に合う。
-- 振り分けができると、夫が立て替えた妻のぶんを住信SBIへ入金する額が
-- 自動で出せる。いまは手で数えている。
--
-- 【未分類を既定にする】
-- 取り込んだ時点では誰のぶんか分からない。ここで勝手に「夫婦」にすると、
-- 個人の買い物が家計に混ざったまま気づけない。
-- 分からないものは分からないと持たせ、人が決める。
--
-- 実行: Supabase の SQL Editor に貼って実行する。何度実行してもよい。
-- ============================================================

-- ---------------------------------------------------------------- 取引に「誰のぶんか」
alter table transactions
  add column if not exists share text not null default '未分類';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'transactions_share_check'
  ) then
    alter table transactions
      add constraint transactions_share_check
      check (share in ('夫婦', '夫', '妻', '未分類'));
  end if;
end $$;

-- 未分類だけを引くのが主な使い方。件数が増えても遅くならないようにする。
create index if not exists transactions_share_idx
  on transactions (household_id, share, date desc);


-- ---------------------------------------------------------------- 店ごとの決めごと
-- 分類辞書に「その店はいつも誰のぶんか」を持たせる。
-- 一度決めれば、次の取り込みから自動で入る。
--
-- 【null を許すこと】
-- 費目は決まっているが、誰のぶんかは店では決まらないことがある
-- (同じスーパーで共用の食材と自分のおやつを買う)。
-- そこに無理やり既定値を入れると、間違ったまま自動で振り分けられる。
-- 決まっていないものは null にして、人に聞く。
alter table expense_rules
  add column if not exists share text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'expense_rules_share_check'
  ) then
    alter table expense_rules
      add constraint expense_rules_share_check
      check (share is null or share in ('夫婦', '夫', '妻'));
  end if;
end $$;


-- ---------------------------------------------------------------- 精算の集計
-- 夫が立て替えた妻のぶん、妻が立て替えた夫のぶんを月ごとに出す。
--
-- 【カードの名義で「誰が払ったか」を決める】
-- source(楽天カード / 三井住友カード / イオンカード / レシート)だけでは
-- 名義が分からないので、memo の「利用者:」を見る。三井住友の明細は
-- 1つのファイルに夫と妻のカードが並ぶので、ここを取り違えると精算がずれる。
create or replace view monthly_share as
select
  household_id,
  to_char(date, 'YYYY-MM')            as month,
  share,
  count(*)                            as 件数,
  sum(amount)                         as 合計
from transactions
group by household_id, to_char(date, 'YYYY-MM'), share;


-- ---------------------------------------------------------------- 確かめる
select share, count(*) as 件数, sum(amount) as 合計
  from transactions
 group by share
 order by 合計 desc nulls last;
