-- 在庫に「1袋・1箱に何個入っているか」を持たせる。
--
-- 【なぜ要るか】
-- 6Pチーズを1箱、なすを1袋、という買い方をする。ところが在庫は
-- 数量が1つしかなかったので、「1箱」と記録すると1つ食べても1のままか、
-- －を押した瞬間に0になって「切らした」ことになる。
-- 実際にあるのは「6個のうち4個」なのに、その状態を書く場所が無かった。
--
-- 【qty は残っている個数、pack_size は満タンのときの個数】
--   6Pチーズを買った      → qty=6, unit='個', pack_size=6
--   2個食べた             → qty=4, unit='個', pack_size=6  (画面には「4 / 6個」)
--   なす1袋(3本入り)     → qty=3, unit='本', pack_size=3
--   2箱まとめて買った     → qty=12, pack_size=12
--
-- pack_size は【その行が満タンのときの数】であって、
-- 「1パックの入り数」ではない。2箱買ったら12にする。
-- そう決めておかないと、パック数と入り数の2つを持つことになり、
-- 冷蔵庫の前で入力する項目が増える。
--
-- 【空のままでよい】。数えないもの(調味料・肉のグラム)は null。
-- そのときは今までどおり、上限なしの数量として動く。

alter table inventory add column if not exists pack_size integer;

-- 0や負の数は意味を持たない。1未満は入れさせない。
-- (上限としての意味しか無いので、qty <= pack_size の制約は付けない。
--  買い足して一時的に超えることがあり、そこで保存が弾かれると
--  冷蔵庫の前で書けなくなるほうが困る)
alter table inventory drop constraint if exists inventory_pack_size_positive;
alter table inventory add constraint inventory_pack_size_positive
  check (pack_size is null or pack_size >= 1);

comment on column inventory.pack_size is
  '満タンのときの個数。6Pチーズなら6。数えないものは null。qty はいま残っている個数。';
