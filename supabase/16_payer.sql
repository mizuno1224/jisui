-- ============================================================
-- 「誰が払ったか」を持たせて、月末の精算額を出せるようにする
--
-- 【なぜ share だけでは足りないか】
-- share(夫婦/夫/妻)は「誰のための支出か」。精算にはもう1つ、
-- 「誰の口座から出たか」が要る。
--   夫の楽天カードで夫婦の食材を買った → share=夫婦 / payer=夫
--   → 共用プール(住信SBI)から夫の楽天銀行へ移す必要がある
-- この2つを取り違えると、移す向きが逆になる。
--
-- 【source では分からない】
-- source は「楽天カード」までしか持たない。夫の楽天カードと
-- 妻の楽天カードが同じ値になるので、名義が判別できない。
-- 三井住友の明細だけは「利用者:」を memo に残しているが、
-- 楽天とイオンには手がかりが無い。
--
-- 【既定を夫にする理由】
-- 方針.md で共用カード(楽天・三井住友・イオン)はすべて夫名義と決めている。
-- 妻名義は妻の楽天カードだけ。数が少ないほうを人が直すのが早い。
-- ただし【推測で埋めたことを忘れないこと】。違っていれば精算がずれる。
--
-- 実行: Supabase の SQL Editor に貼って実行する。何度実行してもよい。
-- ============================================================

alter table transactions
  add column if not exists payer text not null default '夫';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'transactions_payer_check') then
    alter table transactions
      add constraint transactions_payer_check check (payer in ('夫', '妻'));
  end if;
end $$;

comment on column transactions.payer is
  'どちらの口座から出たか。share(誰のための支出か)とは別物。精算の向きを決める';

-- 三井住友の明細は memo に「利用者:名前」が入っている。分かるものは直す。
-- 【名前は方針.md の表記に合わせること】。ここがずれると一件も当たらない。
update transactions
   set payer = '妻'
 where payer = '夫'
   and memo like '%利用者:%明日香%';


-- ---------------------------------------------------------------- 月末の精算
-- どちらがどれだけ立て替えたかを月ごとに出す。
--
-- 【共用ぶんは折半しない】
-- 生活費は折半だが、共用の支出は共用プール(住信SBI)から出す決まりなので、
-- 立て替えた人へは【全額】戻す。折半は給与を共用プールへ入れる段階で
-- 済んでいる。ここで半分にすると二重に折半することになる。
create or replace view monthly_settlement as
select
  household_id,
  to_char(date, 'YYYY-MM') as month,
  payer,
  sum(amount) filter (where share = '夫婦') as 立替えた共用ぶん,
  sum(amount) filter (where share = '夫')   as 夫個人ぶん,
  sum(amount) filter (where share = '妻')   as 妻個人ぶん,
  sum(amount) filter (where share = '未分類') as まだ決めていない
from transactions
group by household_id, to_char(date, 'YYYY-MM'), payer;


-- ---------------------------------------------------------------- 確かめる
select payer, share, count(*) as 件数, sum(amount) as 合計
  from transactions
 group by payer, share
 order by payer, 合計 desc;
