-- ============================================================
-- 8/9 の Cowork セッションの記録を jisui.db から Supabase へ移す
-- scripts/import-0809.mjs が生成。手で編集しない。
-- 何度実行しても増えない。delete は1件も無い。
-- ============================================================

begin;

-- [1] 調理器具を1件足す: 日立 冷蔵庫 R-HWC54Y(2026年製)
--      Supabase の equipment には冷蔵庫が入っていない(8/9 に SQLite へ書いたきり)。
--      memo の末尾「野菜は冷蔵室でなく野菜室が原則」が、区画を増やす話の一次資料になる。
--      同じ名前が既にあれば何もしない。
insert into equipment (household_id, name, memo)
select '00000000-0000-4000-8000-000000000001', '日立 冷蔵庫 R-HWC54Y(2026年製)', '540L・6ドア観音開き・まんなか冷凍。冷蔵室278L=【まるごとチルド】全段が約2℃・高湿度でラップなしでも乾燥しにくい。氷温ルーム(約-2〜0℃)=肉・魚の生鮮向け。うるおい野菜室103L(約4〜8℃)。冷凍室137L(3段)+急速冷凍。※冷蔵室が約2℃と低いため、野菜は冷蔵室でなく野菜室が原則'
where not exists (select 1 from equipment where household_id = '00000000-0000-4000-8000-000000000001' and name = '日立 冷蔵庫 R-HWC54Y(2026年製)');

-- [2] レシピを1件足す: 豚しゃぶ肉とキャベツの回鍋肉風(主菜 / 20分)
--      カード本文は recipes/004_hoikoro-fu.md をそのまま card_md に入れる(2002文字)。
--      作成日時は SQLite の 2026-08-09 07:28(UTC)をそのまま残す。8/9 の記録だという事実が消えるため、now() では入れない。
--      SQLite の id 7 は使わない。Supabase 側の採番に任せ、材料と献立は名前から id を引く。
--      同じ名前が既にあれば何もしない(カード本文の入れ直しもしない)。
insert into recipes (household_id, name, category, protein, time_min, freezable, freeze_notes, card_md, source, tags, created_at)
select '00000000-0000-4000-8000-000000000001', '豚しゃぶ肉とキャベツの回鍋肉風', '主菜', '豚', 20, false, null,
       '# 豚しゃぶ肉とキャベツの回鍋肉風

## 基本情報
- 2人分 / 調理時間 約20分(解凍10分を含む)
- 使う器具: フライパン、ガスコンロ、ボウル

## 材料(2人分)
- 豚ロースしゃぶしゃぶ用 300g(冷凍のまま使う)
- キャベツ(カット) 1袋
- 玉ねぎ 1個
- 甜麺醤 大さじ1.5
- 醤油 大さじ1
- 酒 大さじ1
- 砂糖 小さじ1
- 桃屋のきざみにんにく 小さじ1
- 片栗粉 小さじ2(肉にまぶす用)
- ごま油 大さじ1(妻の分の仕上げに小さじ1追加)

## 手順

### 1. 豚肉を流水解凍する(10分・最初に始める)
冷凍した豚肉を袋のままボウルに入れ、**細く出した水道水を流しかけながら**10分置く。この間に野菜を切る。

- **完了サイン**: 指で押すと少しへこみ、肉が1枚ずつ剥がせる状態。中心が少し凍っていてもよい。
- **なぜ流水?** 冷蔵庫解凍(半日)は今日は間に合わない。流水は空気より熱を伝える速度が20倍以上速いので、短時間で解けて雑菌が増える温度帯(10〜60℃)に留まる時間も短い。**ぬるま湯は使わない**——表面だけ先に温まって傷みやすく、旨味のドリップも増える。
- 常温放置での解凍は避ける。時間がかかるうえ表面温度が上がって傷みやすい。

### 2. 野菜を切る(5分)
玉ねぎは縦半分に切り、繊維に沿って1cm幅のくし切りにする。キャベツはカット済みなのでさっと洗って水気を切る。

- **なぜ今日は繊維に沿って?** 冷奴に添えた生の玉ねぎとは逆で、炒め物では**繊維に沿う**のが正解。加熱しても形が残り、シャキッとした食感と甘みが立つ。繊維を断つと崩れやすくなる。

### 3. 合わせダレを作る(1分)
小さな器に、甜麺醤・醤油・酒・砂糖・きざみにんにくを入れてよく混ぜておく。

- **なぜ先に混ぜる?** 炒め始めると火の前で調味料を1つずつ量る余裕はない。特に甜麺醤は粘度が高く、フライパンに直接入れるとダマになって味が偏る。**先に混ぜて液体にしておく**のが失敗しないコツ。

### 4. 豚肉に片栗粉をまぶす(2分)
解凍した豚肉の水気をキッチンペーパーで軽く押さえ、ボウルに入れて片栗粉小さじ2をまぶす。

- **なぜ片栗粉?** 3つ効く。①肉の表面に膜ができて**肉汁を閉じ込める**ので、薄切り肉でもパサつかない。②タレが肉に**絡みやすくなる**。③炒めているうちにとろみがついて、全体がまとまる。

### 5. 炒める(5分)
フライパンにごま油大さじ1を入れて**強めの中火**で熱し、豚肉を広げて入れる。色が8割変わったら玉ねぎを加えて2分炒め、キャベツを加えてさらに2分。合わせダレを回し入れ、全体に絡めたら火を止める。

- **完了サイン**: キャベツの緑が鮮やかになり、フチが少し透き通ったところ。**炒めすぎない**のが最重要。
- **なぜ野菜を後入れ?** 火の通りにくい順(肉→玉ねぎ→キャベツ)に入れることで、全部が同じタイミングで仕上がる。最初に全部入れると、キャベツがくたくたになる頃に玉ねぎがまだ生、という状態になる。
- **なぜタレは最後?** 砂糖と甜麺醤は焦げやすい。早く入れると野菜から水が出る前に焦げつく。最後に絡めるだけで十分味は乗る。

### 6. 盛り付け
皿に盛る。妻の分は器を小さめにして、仕上げにごま油小さじ1を回しかける。

- **増量のコツ**: 量を増やさずカロリーだけ足す。脂質は1gあたり9kcalで、たんぱく質・糖質の4kcalの倍以上。小さじ1(約4g)で約37kcal上乗せできる。

## 栄養メモ
- **キャベツ**: ビタミンCと、胃の粘膜を守るビタミンU(キャベジン)が豊富。どちらも**水溶性で熱に弱い**ため、茹でるより「短時間で炒める」ほうが残る。今日の調理法は理にかなっている。
- **豚肉 × 玉ねぎ**: 豚肉のビタミンB1(糖質をエネルギーに変える)は、玉ねぎの硫化アリルと結合すると吸収率が上がる。8/6の豚しゃぶと同じ黄金の組み合わせ。
- **甜麺醤**: 大豆と小麦を発酵させた甘味噌。発酵過程でアミノ酸が生まれるため、少量で「コク」を出せる。塩分は高めなので、これを使う日は他の調味料を控えめに。

## 失敗しやすいポイント
1. **キャベツを炒めすぎる** — 水が出てべちゃっとする。「まだ少し硬いかな」で火を止めてOK。余熱で丁度よくなる。
2. **フライパンに全部を一度に入れる** — 詰め込むと温度が下がって「炒める」ではなく「蒸す」状態になり、水っぽく仕上がる。入り切らないと感じたら肉だけ先に取り出し、野菜を炒めてから戻す。
',
       null, '在庫消化,増量対応', '2026-08-09T07:28:00+00'
where not exists (select 1 from recipes where household_id = '00000000-0000-4000-8000-000000000001' and name = '豚しゃぶ肉とキャベツの回鍋肉風');

-- [3] レシピを1件足す: 小松菜と卵の中華スープ(汁物 / 8分)
--      カード本文は recipes/005_komatsuna-tamago-soup.md をそのまま card_md に入れる(1275文字)。
--      作成日時は SQLite の 2026-08-09 07:28(UTC)をそのまま残す。8/9 の記録だという事実が消えるため、now() では入れない。
--      SQLite の id 8 は使わない。Supabase 側の採番に任せ、材料と献立は名前から id を引く。
--      同じ名前が既にあれば何もしない(カード本文の入れ直しもしない)。
insert into recipes (household_id, name, category, protein, time_min, freezable, freeze_notes, card_md, source, tags, created_at)
select '00000000-0000-4000-8000-000000000001', '小松菜と卵の中華スープ', '汁物', '卵', 8, false, null,
       '# 小松菜と卵の中華スープ

## 基本情報
- 2人分 / 調理時間 約8分
- 使う器具: 片手鍋、ガスコンロ

## 材料(2人分)
- 小松菜 1袋
- たまご 2個
- 水 500ml
- 鶏がらスープの素 小さじ2
- 醤油 小さじ1
- ごま油 小さじ1
- 片栗粉 小さじ1 + 水 小さじ2(水溶き片栗粉)

## 手順

### 1. 小松菜を切る(2分)
根元を切り落とし、4cm幅に切る。**茎と葉を分けておく**(火の通る時間が違うため)。

### 2. 水溶き片栗粉を先に作る(1分)
小さな器に片栗粉小さじ1と水小さじ2を入れ、よく混ぜておく。

- **なぜ先に?** 片栗粉は放置すると沈殿する。使う直前にもう一度混ぜること。粉のまま鍋に入れるとダマになる。

### 3. スープを作る(5分)
鍋に水500mlと鶏がらスープの素を入れて沸かす。沸いたら**茎を先に**入れて1分、次に葉を入れて30秒。醤油を加える。

- **完了サイン**: 茎に透明感が出て、葉が鮮やかな緑になったところ。

### 4. とろみをつけてから卵を入れる(2分)
**火を弱め**、混ぜた水溶き片栗粉を回し入れて30秒煮る。次に、溶いた卵を**細く垂らしながら**円を描くように入れる。10秒待ってから、ゆっくり一度だけ混ぜる。最後にごま油を回しかけて火を止める。

- **完了サイン**: 卵がふわっと浮いて広がる。
- **なぜとろみを先につける?** ここがふわふわ卵スープの最大のコツ。とろみのないスープに卵を入れると、卵が沈んで散らばり濁ってしまう。**先に軽いとろみをつけておくと卵が液中に浮いた状態で固まる**ため、ふわっとした層になる。
- **なぜ細く垂らす?** 一度にドバッと入れると塊になる。細い流れにすると、鍋に触れた瞬間に薄い膜状に固まる。
- **なぜすぐ混ぜない?** 入れた直後に混ぜると卵が崩れて濁る。10秒待って固まってから、一度だけ静かに混ぜる。

## 栄養メモ
- **小松菜**: ほうれん草と似た葉物だが、**カルシウムは約3倍**。しかもほうれん草と違ってアクの原因になるシュウ酸が少ないので、下茹でなしでそのまま使える(今日のように鍋に直接入れられるのはこのため)。鉄分・βカロテンも豊富。
- **たまご**: 必須アミノ酸をすべて含む良質なたんぱく質。ビタミンCと食物繊維以外のほぼ全ての栄養素を含むため「完全栄養食品」と呼ばれる。少食で栄養を確保したいときの心強い味方。
- **βカロテンと油**: 小松菜のβカロテンは脂溶性なので、仕上げのごま油と一緒に摂ることで吸収率が上がる。増量方針にも合致していて、一石二鳥。

## 失敗しやすいポイント
1. **沸騰したまま卵を入れる** — 激しい対流で卵が散り、スープが濁る。必ず火を弱めてから。
2. **小松菜を入れすぎて煮すぎる** — 葉物は30秒で十分。長く煮るとビタミンCが流れ出し、色もくすむ。
',
       null, '在庫消化,増量対応', '2026-08-09T07:28:00+00'
where not exists (select 1 from recipes where household_id = '00000000-0000-4000-8000-000000000001' and name = '小松菜と卵の中華スープ');

-- [4] 豚しゃぶ肉とキャベツの回鍋肉風 の材料を 10 行足す
--      豚ロースしゃぶしゃぶ用 300g / キャベツ 1袋 / 玉ねぎ 1個 / 甜麺醤 1.5大さじ / 醤油 1大さじ / 酒 1大さじ / 砂糖 1小さじ / 桃屋のきざみにんにく 1小さじ / 片栗粉 2小さじ / ごま油 1大さじ
--      household_id は付けない(この表には無い列。世帯は recipes 経由で判定される)。
--      recipe_id はレシピ名から引く。SQLite の id をそのまま書くと別のレシピにぶら下がる。
--      同じレシピに同じ材料名が既にあれば飛ばす。
--      参考: カードは「キャベツ(カット)」、材料は「キャベツ」。在庫側は「キャベツ(カット)」だが、
--        lib/matching.ts:23 が括弧書きを落として突き合わせるので実害は無い。SQLite の表記のまま入れる。
insert into recipe_ingredients (recipe_id, name, qty, unit, optional)
select r.id, '豚ロースしゃぶしゃぶ用', 300, 'g', false
from recipes r
where r.household_id = '00000000-0000-4000-8000-000000000001' and r.name = '豚しゃぶ肉とキャベツの回鍋肉風'
  and not exists (select 1 from recipe_ingredients x where x.recipe_id = r.id and x.name = '豚ロースしゃぶしゃぶ用');
insert into recipe_ingredients (recipe_id, name, qty, unit, optional)
select r.id, 'キャベツ', 1, '袋', false
from recipes r
where r.household_id = '00000000-0000-4000-8000-000000000001' and r.name = '豚しゃぶ肉とキャベツの回鍋肉風'
  and not exists (select 1 from recipe_ingredients x where x.recipe_id = r.id and x.name = 'キャベツ');
insert into recipe_ingredients (recipe_id, name, qty, unit, optional)
select r.id, '玉ねぎ', 1, '個', false
from recipes r
where r.household_id = '00000000-0000-4000-8000-000000000001' and r.name = '豚しゃぶ肉とキャベツの回鍋肉風'
  and not exists (select 1 from recipe_ingredients x where x.recipe_id = r.id and x.name = '玉ねぎ');
insert into recipe_ingredients (recipe_id, name, qty, unit, optional)
select r.id, '甜麺醤', 1.5, '大さじ', false
from recipes r
where r.household_id = '00000000-0000-4000-8000-000000000001' and r.name = '豚しゃぶ肉とキャベツの回鍋肉風'
  and not exists (select 1 from recipe_ingredients x where x.recipe_id = r.id and x.name = '甜麺醤');
insert into recipe_ingredients (recipe_id, name, qty, unit, optional)
select r.id, '醤油', 1, '大さじ', false
from recipes r
where r.household_id = '00000000-0000-4000-8000-000000000001' and r.name = '豚しゃぶ肉とキャベツの回鍋肉風'
  and not exists (select 1 from recipe_ingredients x where x.recipe_id = r.id and x.name = '醤油');
insert into recipe_ingredients (recipe_id, name, qty, unit, optional)
select r.id, '酒', 1, '大さじ', false
from recipes r
where r.household_id = '00000000-0000-4000-8000-000000000001' and r.name = '豚しゃぶ肉とキャベツの回鍋肉風'
  and not exists (select 1 from recipe_ingredients x where x.recipe_id = r.id and x.name = '酒');
insert into recipe_ingredients (recipe_id, name, qty, unit, optional)
select r.id, '砂糖', 1, '小さじ', false
from recipes r
where r.household_id = '00000000-0000-4000-8000-000000000001' and r.name = '豚しゃぶ肉とキャベツの回鍋肉風'
  and not exists (select 1 from recipe_ingredients x where x.recipe_id = r.id and x.name = '砂糖');
insert into recipe_ingredients (recipe_id, name, qty, unit, optional)
select r.id, '桃屋のきざみにんにく', 1, '小さじ', false
from recipes r
where r.household_id = '00000000-0000-4000-8000-000000000001' and r.name = '豚しゃぶ肉とキャベツの回鍋肉風'
  and not exists (select 1 from recipe_ingredients x where x.recipe_id = r.id and x.name = '桃屋のきざみにんにく');
insert into recipe_ingredients (recipe_id, name, qty, unit, optional)
select r.id, '片栗粉', 2, '小さじ', false
from recipes r
where r.household_id = '00000000-0000-4000-8000-000000000001' and r.name = '豚しゃぶ肉とキャベツの回鍋肉風'
  and not exists (select 1 from recipe_ingredients x where x.recipe_id = r.id and x.name = '片栗粉');
insert into recipe_ingredients (recipe_id, name, qty, unit, optional)
select r.id, 'ごま油', 1, '大さじ', false
from recipes r
where r.household_id = '00000000-0000-4000-8000-000000000001' and r.name = '豚しゃぶ肉とキャベツの回鍋肉風'
  and not exists (select 1 from recipe_ingredients x where x.recipe_id = r.id and x.name = 'ごま油');

-- [5] 小松菜と卵の中華スープ の材料を 6 行足す
--      小松菜 1袋 / たまご 2個 / 鶏がらスープの素 2小さじ / 醤油 1小さじ / ごま油 1小さじ / 片栗粉 1小さじ
--      household_id は付けない(この表には無い列。世帯は recipes 経由で判定される)。
--      recipe_id はレシピ名から引く。SQLite の id をそのまま書くと別のレシピにぶら下がる。
--      同じレシピに同じ材料名が既にあれば飛ばす。
--      参考: カードの「水 500ml」と水溶き用の水は材料に入れない。
--        recipe_ingredients は買い物と在庫引き当ての表で、既存レシピ(麻婆豆腐など)も水を持っていない。
insert into recipe_ingredients (recipe_id, name, qty, unit, optional)
select r.id, '小松菜', 1, '袋', false
from recipes r
where r.household_id = '00000000-0000-4000-8000-000000000001' and r.name = '小松菜と卵の中華スープ'
  and not exists (select 1 from recipe_ingredients x where x.recipe_id = r.id and x.name = '小松菜');
insert into recipe_ingredients (recipe_id, name, qty, unit, optional)
select r.id, 'たまご', 2, '個', false
from recipes r
where r.household_id = '00000000-0000-4000-8000-000000000001' and r.name = '小松菜と卵の中華スープ'
  and not exists (select 1 from recipe_ingredients x where x.recipe_id = r.id and x.name = 'たまご');
insert into recipe_ingredients (recipe_id, name, qty, unit, optional)
select r.id, '鶏がらスープの素', 2, '小さじ', false
from recipes r
where r.household_id = '00000000-0000-4000-8000-000000000001' and r.name = '小松菜と卵の中華スープ'
  and not exists (select 1 from recipe_ingredients x where x.recipe_id = r.id and x.name = '鶏がらスープの素');
insert into recipe_ingredients (recipe_id, name, qty, unit, optional)
select r.id, '醤油', 1, '小さじ', false
from recipes r
where r.household_id = '00000000-0000-4000-8000-000000000001' and r.name = '小松菜と卵の中華スープ'
  and not exists (select 1 from recipe_ingredients x where x.recipe_id = r.id and x.name = '醤油');
insert into recipe_ingredients (recipe_id, name, qty, unit, optional)
select r.id, 'ごま油', 1, '小さじ', false
from recipes r
where r.household_id = '00000000-0000-4000-8000-000000000001' and r.name = '小松菜と卵の中華スープ'
  and not exists (select 1 from recipe_ingredients x where x.recipe_id = r.id and x.name = 'ごま油');
insert into recipe_ingredients (recipe_id, name, qty, unit, optional)
select r.id, '片栗粉', 1, '小さじ', false
from recipes r
where r.household_id = '00000000-0000-4000-8000-000000000001' and r.name = '小松菜と卵の中華スープ'
  and not exists (select 1 from recipe_ingredients x where x.recipe_id = r.id and x.name = '片栗粉');

-- [6] 在庫「玉ねぎ」には触らない(SQL 不要)
--      SQLite では 冷蔵 になっている(8/9 の書き込み)。
--      しかしこれは冷蔵庫の区画が【3つしか無かった頃の妥協】だった。
--        当時のコメントにも「本当の置き場所は野菜室だが check が通さない」と書いてある。
--        常温よりは冷蔵のほうがまし、という理由で選ばれた値で、正しい場所ではない。
--      区画を5つに増やした 12a/12b のあと、玉ねぎの正しい場所は【常温】。
--        取扱説明書どおり、玉ねぎ・いも類・かぼちゃは冷暗所で保存する。
--        Supabase 側は既に常温になっているので、直す必要が無い。
--      ここで SQLite の値を入れると、正しい常温を誤った冷蔵で上書きすることになる。
--      たまご(Supabase 9個 / SQLite 10個)にも触らない。減ったという新しい記録は Supabase 側にしか無い。

-- [7] 献立: 8/6 と 8/7 には触らない(SQL 不要)
--      8/6(サラダ+冷奴+惣菜の残り / 実施)は両者同じ。
--      8/7 は SQLite が「外食 / 予定」、Supabase が「外食 / 実施」。実際に外食したという記録は
--        Supabase 側にしかない(SQLite は 8/9 に 8/7 を見直していない)。上書きすると新しいほうを潰す。
--        → この行は Supabase のまま残す。SQL は1文も出さない。

-- [8] 献立: 書き換える前に 2026-08-08〜2026-08-12 の中身を検査する
--      献立が参照するレシピが1つでも欠けていたら、その場で全部やめる。
--      夕食が 6 行を超えていても全部やめる(begin 〜 commit の中なので何も残らない)。
--      同じレシピの行が2つ以上あっても、どちらを動かすか決められないのでやめる。
--      勝手に消して辻褄を合わせるより、止まって人に見せるほうがよい。
-- 想定外の形をしていたら、何も書かずに全部やめる。
-- 献立の突き合わせは「レシピ名で1行に絞れる」ことを前提にしているため。
do $$
declare cnt int; missing text;
begin
  -- 献立が参照するレシピが全部そろっているか。
  -- 1つでも欠けると、その行の update も insert も静かに0件で終わってしまう。
  select string_agg(x.name, ', ') into missing
    from (values
      ('豚しゃぶと玉ねぎの香味ポン酢'),
      ('豚しゃぶ肉とキャベツの回鍋肉風'),
      ('小松菜と卵の中華スープ'),
      ('銀鮭の照り焼き'),
      ('エアオーブンのノンフライ唐揚げ'),
      ('麻婆豆腐')
    ) as x(name)
   where not exists (select 1 from recipes r where r.household_id = '00000000-0000-4000-8000-000000000001' and r.name = x.name);
  if missing is not null then
    raise exception '献立が参照するレシピが Supabase にありません: %。中断しました。', missing;
  end if;

  select count(*) into cnt from meal_plan
   where household_id = '00000000-0000-4000-8000-000000000001' and slot = '夕食' and date between '2026-08-08' and '2026-08-12';
  if cnt > 6 then
    raise exception '2026-08-08〜2026-08-12 の夕食が % 行あります(移行後の想定は 6 行)。想定外の行があるので中断しました。末尾の確認用SELECTで中身を見てください。', cnt;
  end if;

  if exists (
    select 1 from meal_plan
     where household_id = '00000000-0000-4000-8000-000000000001' and slot = '夕食' and date between '2026-08-08' and '2026-08-12'
       and recipe_id is not null
     group by recipe_id having count(*) > 1
  ) then
    raise exception '2026-08-08〜2026-08-12 に同じレシピの夕食が2行以上あります。どちらを動かすか機械では決められないので中断しました。';
  end if;
end $$;

-- [9] 献立 2026-08-08 を「豚しゃぶと玉ねぎの香味ポン酢(自炊せず)」(中止)にする
--      既にある「豚しゃぶと玉ねぎの香味ポン酢」の行を 2026-08-08〜2026-08-12 の中から探して、日付と名前と状態を書き換える。消して作り直さない。
--      自炊しなかったという申告。予定より強い記録なので SQLite を優先する。
--      見つからなければ新しく作る。2回目以降は書き換えのほうが当たるので、行は増えない。
--      2026-08-08 以降のどこかに「豚しゃぶと玉ねぎの香味ポン酢」の行が既にあれば、書き換えが当たらなくても作らない。
--        2026-08-12 より後へ動かした献立を、2回目に流したときに復活させないため。
with moved as (
  update meal_plan set date = '2026-08-08', name = '豚しゃぶと玉ねぎの香味ポン酢(自炊せず)', status = '中止'
   where household_id = '00000000-0000-4000-8000-000000000001' and slot = '夕食'
     and date between '2026-08-08' and '2026-08-12'
     and recipe_id = (select r.id from recipes r where r.household_id = '00000000-0000-4000-8000-000000000001' and r.name = '豚しゃぶと玉ねぎの香味ポン酢')
  returning id
)
insert into meal_plan (household_id, date, slot, recipe_id, name, status)
select '00000000-0000-4000-8000-000000000001', '2026-08-08', '夕食', r.id, '豚しゃぶと玉ねぎの香味ポン酢(自炊せず)', '中止'
from recipes r
where r.household_id = '00000000-0000-4000-8000-000000000001' and r.name = '豚しゃぶと玉ねぎの香味ポン酢'
  and not exists (select 1 from moved)
  and not exists (
    select 1 from meal_plan m2
     where m2.household_id = '00000000-0000-4000-8000-000000000001' and m2.slot = '夕食'
       and m2.recipe_id = r.id and m2.date >= '2026-08-08'
  );

-- [10] 献立 2026-08-09 を「豚しゃぶ肉とキャベツの回鍋肉風」(予定)にする
--      8/9 に作った新レシピ。上で入れたレシピの id を名前で引いて紐づける。既存の行は無いので新しく作られる。
--      見つからなければ新しく作る。2回目以降は書き換えのほうが当たるので、行は増えない。
--      2026-08-08 以降のどこかに「豚しゃぶ肉とキャベツの回鍋肉風」の行が既にあれば、書き換えが当たらなくても作らない。
--        2026-08-12 より後へ動かした献立を、2回目に流したときに復活させないため。
with moved as (
  update meal_plan set date = '2026-08-09', name = '豚しゃぶ肉とキャベツの回鍋肉風', status = '予定'
   where household_id = '00000000-0000-4000-8000-000000000001' and slot = '夕食'
     and date between '2026-08-08' and '2026-08-12'
     and recipe_id = (select r.id from recipes r where r.household_id = '00000000-0000-4000-8000-000000000001' and r.name = '豚しゃぶ肉とキャベツの回鍋肉風')
  returning id
)
insert into meal_plan (household_id, date, slot, recipe_id, name, status)
select '00000000-0000-4000-8000-000000000001', '2026-08-09', '夕食', r.id, '豚しゃぶ肉とキャベツの回鍋肉風', '予定'
from recipes r
where r.household_id = '00000000-0000-4000-8000-000000000001' and r.name = '豚しゃぶ肉とキャベツの回鍋肉風'
  and not exists (select 1 from moved)
  and not exists (
    select 1 from meal_plan m2
     where m2.household_id = '00000000-0000-4000-8000-000000000001' and m2.slot = '夕食'
       and m2.recipe_id = r.id and m2.date >= '2026-08-08'
  );

-- [11] 献立 2026-08-09 を「小松菜と卵の中華スープ」(予定)にする
--      8/9 に作った新レシピ。上で入れたレシピの id を名前で引いて紐づける。既存の行は無いので新しく作られる。
--      見つからなければ新しく作る。2回目以降は書き換えのほうが当たるので、行は増えない。
--      2026-08-08 以降のどこかに「小松菜と卵の中華スープ」の行が既にあれば、書き換えが当たらなくても作らない。
--        2026-08-12 より後へ動かした献立を、2回目に流したときに復活させないため。
with moved as (
  update meal_plan set date = '2026-08-09', name = '小松菜と卵の中華スープ', status = '予定'
   where household_id = '00000000-0000-4000-8000-000000000001' and slot = '夕食'
     and date between '2026-08-08' and '2026-08-12'
     and recipe_id = (select r.id from recipes r where r.household_id = '00000000-0000-4000-8000-000000000001' and r.name = '小松菜と卵の中華スープ')
  returning id
)
insert into meal_plan (household_id, date, slot, recipe_id, name, status)
select '00000000-0000-4000-8000-000000000001', '2026-08-09', '夕食', r.id, '小松菜と卵の中華スープ', '予定'
from recipes r
where r.household_id = '00000000-0000-4000-8000-000000000001' and r.name = '小松菜と卵の中華スープ'
  and not exists (select 1 from moved)
  and not exists (
    select 1 from meal_plan m2
     where m2.household_id = '00000000-0000-4000-8000-000000000001' and m2.slot = '夕食'
       and m2.recipe_id = r.id and m2.date >= '2026-08-08'
  );

-- [12] 献立 2026-08-10 を「銀鮭の照り焼き」(予定)にする
--      既にある「銀鮭の照り焼き」の行を 2026-08-08〜2026-08-12 の中から探して、日付と名前と状態を書き換える。消して作り直さない。
--      見つからなければ新しく作る。2回目以降は書き換えのほうが当たるので、行は増えない。
--      2026-08-08 以降のどこかに「銀鮭の照り焼き」の行が既にあれば、書き換えが当たらなくても作らない。
--        2026-08-12 より後へ動かした献立を、2回目に流したときに復活させないため。
with moved as (
  update meal_plan set date = '2026-08-10', name = '銀鮭の照り焼き', status = '予定'
   where household_id = '00000000-0000-4000-8000-000000000001' and slot = '夕食'
     and date between '2026-08-08' and '2026-08-12'
     and recipe_id = (select r.id from recipes r where r.household_id = '00000000-0000-4000-8000-000000000001' and r.name = '銀鮭の照り焼き')
  returning id
)
insert into meal_plan (household_id, date, slot, recipe_id, name, status)
select '00000000-0000-4000-8000-000000000001', '2026-08-10', '夕食', r.id, '銀鮭の照り焼き', '予定'
from recipes r
where r.household_id = '00000000-0000-4000-8000-000000000001' and r.name = '銀鮭の照り焼き'
  and not exists (select 1 from moved)
  and not exists (
    select 1 from meal_plan m2
     where m2.household_id = '00000000-0000-4000-8000-000000000001' and m2.slot = '夕食'
       and m2.recipe_id = r.id and m2.date >= '2026-08-08'
  );

-- [13] 献立 2026-08-11 を「エアオーブンのノンフライ唐揚げ」(予定)にする
--      既にある「エアオーブンのノンフライ唐揚げ」の行を 2026-08-08〜2026-08-12 の中から探して、日付と名前と状態を書き換える。消して作り直さない。
--      見つからなければ新しく作る。2回目以降は書き換えのほうが当たるので、行は増えない。
--      2026-08-08 以降のどこかに「エアオーブンのノンフライ唐揚げ」の行が既にあれば、書き換えが当たらなくても作らない。
--        2026-08-12 より後へ動かした献立を、2回目に流したときに復活させないため。
with moved as (
  update meal_plan set date = '2026-08-11', name = 'エアオーブンのノンフライ唐揚げ', status = '予定'
   where household_id = '00000000-0000-4000-8000-000000000001' and slot = '夕食'
     and date between '2026-08-08' and '2026-08-12'
     and recipe_id = (select r.id from recipes r where r.household_id = '00000000-0000-4000-8000-000000000001' and r.name = 'エアオーブンのノンフライ唐揚げ')
  returning id
)
insert into meal_plan (household_id, date, slot, recipe_id, name, status)
select '00000000-0000-4000-8000-000000000001', '2026-08-11', '夕食', r.id, 'エアオーブンのノンフライ唐揚げ', '予定'
from recipes r
where r.household_id = '00000000-0000-4000-8000-000000000001' and r.name = 'エアオーブンのノンフライ唐揚げ'
  and not exists (select 1 from moved)
  and not exists (
    select 1 from meal_plan m2
     where m2.household_id = '00000000-0000-4000-8000-000000000001' and m2.slot = '夕食'
       and m2.recipe_id = r.id and m2.date >= '2026-08-08'
  );

-- [14] 献立 2026-08-12 を「麻婆豆腐」(予定)にする
--      既にある「麻婆豆腐」の行を 2026-08-08〜2026-08-12 の中から探して、日付と名前と状態を書き換える。消して作り直さない。
--      見つからなければ新しく作る。2回目以降は書き換えのほうが当たるので、行は増えない。
--      2026-08-08 以降のどこかに「麻婆豆腐」の行が既にあれば、書き換えが当たらなくても作らない。
--        2026-08-12 より後へ動かした献立を、2回目に流したときに復活させないため。
with moved as (
  update meal_plan set date = '2026-08-12', name = '麻婆豆腐', status = '予定'
   where household_id = '00000000-0000-4000-8000-000000000001' and slot = '夕食'
     and date between '2026-08-08' and '2026-08-12'
     and recipe_id = (select r.id from recipes r where r.household_id = '00000000-0000-4000-8000-000000000001' and r.name = '麻婆豆腐')
  returning id
)
insert into meal_plan (household_id, date, slot, recipe_id, name, status)
select '00000000-0000-4000-8000-000000000001', '2026-08-12', '夕食', r.id, '麻婆豆腐', '予定'
from recipes r
where r.household_id = '00000000-0000-4000-8000-000000000001' and r.name = '麻婆豆腐'
  and not exists (select 1 from moved)
  and not exists (
    select 1 from meal_plan m2
     where m2.household_id = '00000000-0000-4000-8000-000000000001' and m2.slot = '夕食'
       and m2.recipe_id = r.id and m2.date >= '2026-08-08'
  );

commit;

-- ============================================================
-- 検算1: 移した分がそろっているか。「元の件数」は jisui.db の実測値。
-- ============================================================
select
  (select count(*) from equipment where household_id = '00000000-0000-4000-8000-000000000001' and name = '日立 冷蔵庫 R-HWC54Y(2026年製)') as 冷蔵庫, 1 as 元の冷蔵庫,
  (select count(*) from recipes where household_id = '00000000-0000-4000-8000-000000000001'
    and name in ('豚しゃぶ肉とキャベツの回鍋肉風', '小松菜と卵の中華スープ')) as 新レシピ, 2 as 元の新レシピ,
  (select count(*) from recipe_ingredients ri join recipes r on r.id = ri.recipe_id
    where r.household_id = '00000000-0000-4000-8000-000000000001'
      and r.name in ('豚しゃぶ肉とキャベツの回鍋肉風', '小松菜と卵の中華スープ')) as 新レシピの材料, 16 as 元の材料,
  (select count(*) from meal_plan where household_id = '00000000-0000-4000-8000-000000000001'
    and date between '2026-08-08' and '2026-08-12') as 献立, 6 as 元の献立,
  (select location from inventory where household_id = '00000000-0000-4000-8000-000000000001' and name = '玉ねぎ') as 玉ねぎの場所, '常温' as 期待;

-- 検算2: 移行後の献立。右のコメントと1行ずつ見比べる。
select date, slot, name, status, recipe_id from meal_plan
 where household_id = '00000000-0000-4000-8000-000000000001' and date between '2026-08-06' and '2026-08-12'
 order by date, id;
--   2026-08-06 サラダ+冷奴+惣菜の残り(軽め)  実施  ← 触っていない
--   2026-08-07 外食  実施  ← 触っていない(Supabase のまま)
--   2026-08-08 豚しゃぶと玉ねぎの香味ポン酢(自炊せず)  中止
--   2026-08-09 豚しゃぶ肉とキャベツの回鍋肉風  予定
--   2026-08-09 小松菜と卵の中華スープ  予定
--   2026-08-10 銀鮭の照り焼き  予定
--   2026-08-11 エアオーブンのノンフライ唐揚げ  予定
--   2026-08-12 麻婆豆腐  予定

-- 検算3: 想定外の行が残っていないか。
-- 空なら成功。ここに何か出たら、それはこの移行が作った行ではない。
-- 消してよいかどうかは中身を読んでから人が決めること。自動では消さない。
select m.id, m.date, m.slot, m.name, m.status, m.recipe_id from meal_plan m
 where m.household_id = '00000000-0000-4000-8000-000000000001' and m.date between '2026-08-08' and '2026-08-12'
   and not exists (
     select 1 from (values
       ('2026-08-08'::date, '夕食', '豚しゃぶと玉ねぎの香味ポン酢(自炊せず)'),
       ('2026-08-09'::date, '夕食', '豚しゃぶ肉とキャベツの回鍋肉風'),
       ('2026-08-09'::date, '夕食', '小松菜と卵の中華スープ'),
       ('2026-08-10'::date, '夕食', '銀鮭の照り焼き'),
       ('2026-08-11'::date, '夕食', 'エアオーブンのノンフライ唐揚げ'),
       ('2026-08-12'::date, '夕食', '麻婆豆腐')
     ) as v(date, slot, name)
      where v.date = m.date
        and v.slot is not distinct from m.slot
        and v.name is not distinct from m.name
   )
 order by m.date, m.id;
