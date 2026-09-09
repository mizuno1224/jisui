-- 食材マスタ。「商品名」と「食材の正体」を分ける。
--
-- 【なぜ要るか】
-- 在庫の名前はレシートから来るので毎回ちがう。実データではこうなっていた。
--   豚ひき肉 / 国産豚ミンチ          ← 括弧を落としても一致しない
--   焼のり(遠赤焙焼) / 遠赤焙焼 焼のり  ← 語順がちがう
--   牛乳 / 牛乳(らくのう) / 牛乳(酪農3.6)
--   桃屋 きざみしょうが / 桃屋のきざみしょうが  ← 「の」の有無だけで別物だった
-- 文字列のゆるい一致(lib/matching.ts)で吸収してきたが、
-- 商品名が相手では原理的に足りない。**家にあるのに「足りない」と出る**、
-- 逆に別物を「ある」と数える、が起き続ける。
--
-- そこで食材の正体を id で持ち、突き合わせを文字列比較から id 比較に変える。
--
-- 【在庫の name は消さない】
-- 「牛乳(酪農3.6)」はどれを買ったかの記録として価値がある。
-- 表示と履歴は name、判定は food_id、と役割を分ける。

create table if not exists foods (
  id bigserial primary key,
  household_id uuid not null references households(id) on delete cascade,
  /** 代表名。画面に出る名前で、献立や買い物リストもこれを使う */
  name text not null,
  /** 検索用のよみ。「たまねぎ」で「玉ねぎ」を引けるようにする */
  kana text,
  /*
   * 【3つに分ける】
   *   食材   … レシピの材料と突き合わせる。足りなければ買い物リストへ
   *   調味料 … 常備品。切らしたときだけ買い物リストに出る(米は絶対に載せない)
   *   非食材 … 菓子・飲料・日用品。**レシピの判定から外す。**
   *            在庫にはプリングルス・ハリボー・アクエリアスも入っており、
   *            これらを食材として数えると「足りない」の判定が濁る
   */
  kind text not null default '食材' check (kind in ('食材', '調味料', '非食材')),
  /** 買い物リストの売り場。lib/sections.ts の並びと揃える */
  section text not null default '要確認',
  /** 在庫に入れるときの既定の置き場所。12a_schema_v6_constraint.sql と揃える */
  location text check (location is null or location in ('冷蔵','氷温','野菜','冷凍','常温')),
  /*
   * 商品名の別名。レシートの「明治ブルガリアヨーグルト」からここを引いて
   * 「ヨーグルト」に当てる。**人が一度選んだ商品名はここに足していく。**
   * 使うほど機械的に当たるようになり、手がかからなくなる。
   */
  aliases text[] not null default '{}',
  created_at timestamptz not null default now(),
  constraint foods_unique_name unique (household_id, name)
);

create index if not exists foods_household_kind_idx on foods (household_id, kind);

-- 正体をたどる先。**null を許す。**
-- 分からないものを推測で埋めるより、「まだ決まっていない」と分かるほうがよい。
-- アプリはそれを見て「食材を選んでください」と出す。
alter table inventory           add column if not exists food_id bigint references foods(id) on delete set null;
alter table recipe_ingredients  add column if not exists food_id bigint references foods(id) on delete set null;
alter table pantry              add column if not exists food_id bigint references foods(id) on delete set null;

create index if not exists inventory_food_idx          on inventory (food_id);
create index if not exists recipe_ingredients_food_idx on recipe_ingredients (food_id);
create index if not exists pantry_food_idx             on pantry (food_id);

-- ------------------------------------------------------------ RLS
-- 01_schema.sql と同じ形。自分の世帯のものだけ読み書きできる。
alter table foods enable row level security;

drop policy if exists foods_select on foods;
create policy foods_select on foods for select
  using (household_id in (select my_household_ids()));

drop policy if exists foods_insert on foods;
create policy foods_insert on foods for insert
  with check (household_id in (select my_household_ids()));

drop policy if exists foods_update on foods;
create policy foods_update on foods for update
  using (household_id in (select my_household_ids()))
  with check (household_id in (select my_household_ids()));

drop policy if exists foods_delete on foods;
create policy foods_delete on foods for delete
  using (household_id in (select my_household_ids()));

comment on table foods is
  '食材の正体。在庫やレシピ材料は名前ではなく food_id で突き合わせる。aliases に商品名を貯める。';
