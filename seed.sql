-- jisui 既存データの移行用シード。schema.sql の後に実行する。
-- 実行前に: Supabase Auth で2人分のユーザーを作り、下の household_members を埋めること。

begin;

-- 世帯を1つ作る(このIDを以降すべてで使う)
insert into households (id, name) values ('00000000-0000-4000-8000-000000000001', 'わが家');

-- ▼▼ 要編集: Supabase Auth のユーザーIDに置き換える ▼▼
-- insert into household_members (household_id, user_id, display_name) values
--   ('00000000-0000-4000-8000-000000000001', '<夫のuser_id>', '夫'),
--   ('00000000-0000-4000-8000-000000000001', '<妻のuser_id>', '妻');
-- ▲▲ ここまで ▲▲

-- equipment
insert into equipment (household_id, name, memo) values ('00000000-0000-4000-8000-000000000001', '電子レンジ', 'W数未確認(あとで登録)');
insert into equipment (household_id, name, memo) values ('00000000-0000-4000-8000-000000000001', 'アラジン グラファイトトースター CAT-GS13C', '2枚焼きオーブントースター。0.2秒瞬間発熱、トースト以外のグリル調理にも使える');
insert into equipment (household_id, name, memo) values ('00000000-0000-4000-8000-000000000001', 'レコルト エアーオーブン RAO-1', 'ノンフライヤー。容量2.8L。油なしで揚げ物・温め直し。2人分の唐揚げ等は2回に分ける想定');
insert into equipment (household_id, name, memo) values ('00000000-0000-4000-8000-000000000001', 'タイガー クックポット COK-B400', '電気圧力鍋。1台11役(圧力・煮込み等)、42オートメニュー。満水4.0L/調理容量目安2.5L。ほったらかし調理の主力');
insert into equipment (household_id, name, memo) values ('00000000-0000-4000-8000-000000000001', '和平フレイズ ランチーニ グリルパン RA-9505', '鉄製角型17×22cm・蓋付・IH対応。魚焼きグリルやトースター内での調理向け');
insert into equipment (household_id, name, memo) values ('00000000-0000-4000-8000-000000000001', 'ガスコンロ', null);
insert into equipment (household_id, name, memo) values ('00000000-0000-4000-8000-000000000001', 'フライパン', 'サイズ未確認');
insert into equipment (household_id, name, memo) values ('00000000-0000-4000-8000-000000000001', '片手鍋', 'サイズ未確認');
insert into equipment (household_id, name, memo) values ('00000000-0000-4000-8000-000000000001', '炊飯器', '容量未確認');
insert into equipment (household_id, name, memo) values ('00000000-0000-4000-8000-000000000001', '電気グリル鍋(丸型・蓋付)', '鍋・たこ焼き・焼き肉プレート対応。卓上調理向け');
insert into equipment (household_id, name, memo) values ('00000000-0000-4000-8000-000000000001', '弁当用保存容器', '大・中・小あり。数は十分(弁当バッチ5食は容器数の制約なし)');

-- pantry
insert into pantry (household_id, name, category, stock, staple, memo) values ('00000000-0000-4000-8000-000000000001', '醤油', '基本調味料', 'ある', false, null);
insert into pantry (household_id, name, category, stock, staple, memo) values ('00000000-0000-4000-8000-000000000001', '砂糖', '基本調味料', 'ある', false, null);
insert into pantry (household_id, name, category, stock, staple, memo) values ('00000000-0000-4000-8000-000000000001', '塩', '基本調味料', 'ある', false, null);
insert into pantry (household_id, name, category, stock, staple, memo) values ('00000000-0000-4000-8000-000000000001', 'みりん', '基本調味料', 'ある', false, null);
insert into pantry (household_id, name, category, stock, staple, memo) values ('00000000-0000-4000-8000-000000000001', '酒', '基本調味料', 'ある', false, null);
insert into pantry (household_id, name, category, stock, staple, memo) values ('00000000-0000-4000-8000-000000000001', 'ごま油', '基本調味料', 'ある', false, null);
insert into pantry (household_id, name, category, stock, staple, memo) values ('00000000-0000-4000-8000-000000000001', 'サラダ油', '基本調味料', 'ある', false, null);
insert into pantry (household_id, name, category, stock, staple, memo) values ('00000000-0000-4000-8000-000000000001', 'マヨネーズ', '基本調味料', 'ある', false, null);
insert into pantry (household_id, name, category, stock, staple, memo) values ('00000000-0000-4000-8000-000000000001', 'ケチャップ', '基本調味料', 'ある', false, null);
insert into pantry (household_id, name, category, stock, staple, memo) values ('00000000-0000-4000-8000-000000000001', 'オイスターソース', '基本調味料', 'ある', false, null);
insert into pantry (household_id, name, category, stock, staple, memo) values ('00000000-0000-4000-8000-000000000001', 'ウスターソース', '基本調味料', 'ある', false, null);
insert into pantry (household_id, name, category, stock, staple, memo) values ('00000000-0000-4000-8000-000000000001', '中濃ソース', '基本調味料', 'ある', false, null);
insert into pantry (household_id, name, category, stock, staple, memo) values ('00000000-0000-4000-8000-000000000001', 'かんたん酢', '基本調味料', 'ある', false, null);
insert into pantry (household_id, name, category, stock, staple, memo) values ('00000000-0000-4000-8000-000000000001', '白だし', '基本調味料', 'ある', false, null);
insert into pantry (household_id, name, category, stock, staple, memo) values ('00000000-0000-4000-8000-000000000001', '追いかつおつゆ', '基本調味料', 'ある', false, null);
insert into pantry (household_id, name, category, stock, staple, memo) values ('00000000-0000-4000-8000-000000000001', 'コンソメ', '基本調味料', 'ある', false, null);
insert into pantry (household_id, name, category, stock, staple, memo) values ('00000000-0000-4000-8000-000000000001', '鶏がらスープの素', '基本調味料', 'ある', false, null);
insert into pantry (household_id, name, category, stock, staple, memo) values ('00000000-0000-4000-8000-000000000001', '塩コショウ', 'スパイス', 'ある', false, null);
insert into pantry (household_id, name, category, stock, staple, memo) values ('00000000-0000-4000-8000-000000000001', '山椒', 'スパイス', 'ある', false, null);
insert into pantry (household_id, name, category, stock, staple, memo) values ('00000000-0000-4000-8000-000000000001', '桃屋 きざみしょうが', 'その他', 'ある', false, '瓶詰薬味。生姜の代用に使える');
insert into pantry (household_id, name, category, stock, staple, memo) values ('00000000-0000-4000-8000-000000000001', '桃屋 ラー油', 'その他', 'ある', false, '具入りラー油');
insert into pantry (household_id, name, category, stock, staple, memo) values ('00000000-0000-4000-8000-000000000001', '片栗粉', '乾物', 'ある', false, null);
insert into pantry (household_id, name, category, stock, staple, memo) values ('00000000-0000-4000-8000-000000000001', '小麦粉', '乾物', 'ある', false, null);
insert into pantry (household_id, name, category, stock, staple, memo) values ('00000000-0000-4000-8000-000000000001', 'ツナ缶', '乾物', 'ある', false, '缶詰');
insert into pantry (household_id, name, category, stock, staple, memo) values ('00000000-0000-4000-8000-000000000001', '牛乳', 'その他', 'ある', true, null);
insert into pantry (household_id, name, category, stock, staple, memo) values ('00000000-0000-4000-8000-000000000001', 'たまご', 'その他', 'ある', true, null);
insert into pantry (household_id, name, category, stock, staple, memo) values ('00000000-0000-4000-8000-000000000001', '納豆', 'その他', 'ある', true, null);
insert into pantry (household_id, name, category, stock, staple, memo) values ('00000000-0000-4000-8000-000000000001', '冷凍うどん', '主食', 'ある', true, null);
insert into pantry (household_id, name, category, stock, staple, memo) values ('00000000-0000-4000-8000-000000000001', 'ポン酢', '基本調味料', 'ある', false, null);
insert into pantry (household_id, name, category, stock, staple, memo) values ('00000000-0000-4000-8000-000000000001', '甜麺醤', '基本調味料', 'ある', false, 'テンメンジャン(甘味噌)。回鍋肉・麻婆に');
insert into pantry (household_id, name, category, stock, staple, memo) values ('00000000-0000-4000-8000-000000000001', '桃屋 きざみにんにく', 'その他', 'ある', false, '瓶詰薬味。にんにくの代用に使える');
insert into pantry (household_id, name, category, stock, staple, memo) values ('00000000-0000-4000-8000-000000000001', '米', '主食', 'ある', false, '実家で栽培したものをもらうため購入不要。買い出しリストに載せない');

-- preferences
insert into preferences (household_id, kind, item, memo) values ('00000000-0000-4000-8000-000000000001', '苦手', 'トマト', '基本的に使用しない。加熱・生とも提案から除外');
insert into preferences (household_id, kind, item, memo) values ('00000000-0000-4000-8000-000000000001', '好き', '冷奴のきざみしょうがのせ', '週1回は献立に入れる(副菜枠)。絹豆腐+桃屋のきざみしょうが');
insert into preferences (household_id, kind, item, memo) values ('00000000-0000-4000-8000-000000000001', '方針', '妻は少食だが体重を増量したい', '量を増やさず栄養・カロリー密度を上げる方針。油脂(9kcal/g)と毎食のたんぱく質を意識、妻の分は小盛りでも1食の栄養が確保できる構成に。汁物・副菜に卵や油を足す小技を活用。補食(ヨーグルト・チーズ・バナナ・牛乳)も提案に含める');
insert into preferences (household_id, kind, item, memo) values ('00000000-0000-4000-8000-000000000001', '苦手', 'バナナ', '夫婦ともに苦手。補食提案からも除外');
insert into preferences (household_id, kind, item, memo) values ('00000000-0000-4000-8000-000000000001', '方針', '米は購入しない', '実家で栽培した米をもらっている。買い出しリストに絶対に載せない');

-- inventory
insert into inventory (household_id, name, qty, unit, location, expiry, bought_on, price) values ('00000000-0000-4000-8000-000000000001', '玉ねぎ', 3.0, '個', '常温', null, null, null);
insert into inventory (household_id, name, qty, unit, location, expiry, bought_on, price) values ('00000000-0000-4000-8000-000000000001', 'きゅうり', 1.0, '袋', '冷蔵', null, '2026-08-06', 258);
insert into inventory (household_id, name, qty, unit, location, expiry, bought_on, price) values ('00000000-0000-4000-8000-000000000001', 'キャベツ(カット)', 1.0, '袋', '冷蔵', null, '2026-08-06', 128);
insert into inventory (household_id, name, qty, unit, location, expiry, bought_on, price) values ('00000000-0000-4000-8000-000000000001', '小松菜', 1.0, '袋', '冷蔵', null, '2026-08-06', 98);
insert into inventory (household_id, name, qty, unit, location, expiry, bought_on, price) values ('00000000-0000-4000-8000-000000000001', '長ねぎ', 1.0, '本', '冷蔵', null, '2026-08-06', 158);
insert into inventory (household_id, name, qty, unit, location, expiry, bought_on, price) values ('00000000-0000-4000-8000-000000000001', '人参', 1.0, '袋', '冷蔵', null, '2026-08-06', 86);
insert into inventory (household_id, name, qty, unit, location, expiry, bought_on, price) values ('00000000-0000-4000-8000-000000000001', '豚ロースしゃぶしゃぶ用', 300.0, 'g', '冷凍', null, '2026-08-06', 580);
insert into inventory (household_id, name, qty, unit, location, expiry, bought_on, price) values ('00000000-0000-4000-8000-000000000001', '生銀鮭', 2.0, '切れ', '冷凍', null, '2026-08-06', 622);
insert into inventory (household_id, name, qty, unit, location, expiry, bought_on, price) values ('00000000-0000-4000-8000-000000000001', '鶏もも肉(水炊き・唐揚用)', 1.0, 'パック', '冷凍', null, '2026-08-06', 380);
insert into inventory (household_id, name, qty, unit, location, expiry, bought_on, price) values ('00000000-0000-4000-8000-000000000001', '豚ひき肉', 1.0, 'パック', '冷凍', null, '2026-08-06', 245);
insert into inventory (household_id, name, qty, unit, location, expiry, bought_on, price) values ('00000000-0000-4000-8000-000000000001', '牛乳', 1.0, '本', '冷蔵', null, '2026-08-06', 218);
insert into inventory (household_id, name, qty, unit, location, expiry, bought_on, price) values ('00000000-0000-4000-8000-000000000001', '納豆(おろしだれ)', 1.0, 'パック', '冷蔵', null, '2026-08-06', 118);
insert into inventory (household_id, name, qty, unit, location, expiry, bought_on, price) values ('00000000-0000-4000-8000-000000000001', '納豆(金のつぶ たれ)', 1.0, 'パック', '冷蔵', null, '2026-08-06', 128);
insert into inventory (household_id, name, qty, unit, location, expiry, bought_on, price) values ('00000000-0000-4000-8000-000000000001', '6Pチーズ', 1.0, '箱', '冷蔵', null, '2026-08-06', 198);
insert into inventory (household_id, name, qty, unit, location, expiry, bought_on, price) values ('00000000-0000-4000-8000-000000000001', '明治ブルガリアヨーグルト', 1.0, 'パック', '冷蔵', null, '2026-08-06', 158);
insert into inventory (household_id, name, qty, unit, location, expiry, bought_on, price) values ('00000000-0000-4000-8000-000000000001', '讃岐うどん', 1.0, '袋', '冷凍', null, '2026-08-06', 348);
insert into inventory (household_id, name, qty, unit, location, expiry, bought_on, price) values ('00000000-0000-4000-8000-000000000001', 'カルピス 糖質60%オフ', 1.0, '本', '常温', null, '2026-08-06', 348);
insert into inventory (household_id, name, qty, unit, location, expiry, bought_on, price) values ('00000000-0000-4000-8000-000000000001', 'たまご', 10.0, '個', '冷蔵', null, '2026-08-06', 278);

-- recipes(レシピカードはMarkdown本文をDBへ埋め込む)
insert into recipes (id, household_id, name, category, protein, time_min, freezable, freeze_notes, card_md, source, tags) values (1, '00000000-0000-4000-8000-000000000001', '豚しゃぶと蒸しなすの香味ポン酢', '主菜', '豚', 15, false, null, '# 豚しゃぶと蒸しなすの香味ポン酢

## 基本情報
- 2人分 / 調理時間 約15分
- 使う器具: 電子レンジ、片手鍋、ガスコンロ

## 材料(2人分)
- 豚ロースしゃぶしゃぶ用 300g
- なす 2本
- きゅうり 1本
- ポン酢 大さじ3
- ごま油 小さじ1
- 桃屋のきざみしょうが 小さじ2
- 塩 小さじ1(茹で湯用。湯1Lに対して)

## 手順

### 1. なすをレンジで蒸す(5分)
なすのヘタを切り落とし、皮にフォークで4〜5カ所穴を開ける。1本ずつラップでぴったり包み、600Wで3分30秒加熱。ラップのまま冷水に1分つけて冷ます。

- **完了サイン**: 指で軽く押すと全体がふにゃっとへこむ。硬い部分が残っていたら30秒追加。
- **なぜ穴を開ける?** 加熱中になすの内部の水蒸気が膨張するため、逃げ道がないと破裂する。穴はその圧力の逃げ道。
- **なぜ冷水につける?** なすの紫色(アントシアニン系色素のナスニン)は熱に弱く退色しやすい。急冷すると色止めになり、余熱で加熱が進みすぎるのも防げる。

### 2. きゅうりを切る(2分)
きゅうりは両端を切り落とし、ピーラーで縞に皮をむいてから斜め薄切り(3mm幅)にする。皿に敷いておく。

### 3. 豚肉を茹でる(5分)
片手鍋に湯1Lを沸かし、塩小さじ1を入れたら**火を止める**。豚肉を1枚ずつ広げて入れ、色が変わったら(約20〜30秒)引き上げてザルへ。全量を2〜3回に分けて茹でる。氷水には取らない。

- **完了サイン**: ピンク色が完全に消えて白くなったら即引き上げ。
- **なぜ火を止めて茹でる?** 豚肉のたんぱく質は65℃を超えると急激に収縮して硬くなる。沸騰した湯(100℃)ではなく80℃前後の湯で優しく火を通すと、しっとり柔らかく仕上がる。冷しゃぶを氷水に取らないのも同じ理由で、急冷すると脂が固まり肉が締まってパサつくため。ザルで粗熱を取るのが正解。

### 4. 盛り付けとタレ(3分)
なすを手で縦に裂いて(包丁より味が染みやすい)きゅうりの上に並べ、豚肉をのせる。ポン酢・ごま油・きざみしょうがを混ぜて全体にかける。

- **なぜ手で裂く?** 断面がギザギザになり表面積が増えるので、タレの絡みが包丁切りより良くなる。

## 栄養メモ
- **豚肉**: ビタミンB1が豊富(全食材トップクラス)。糖質をエネルギーに変える代謝に必須で、疲労回復のビタミンと呼ばれる。夏バテ対策にまさに今夜向き。
- **なす**: 90%以上が水分で低カロリー。皮のナスニンはポリフェノールの一種で抗酸化作用がある。皮ごと食べるのが正解。
- **しょうが**: 辛味成分ジンゲロールに血行促進・消化促進の働き。さっぱり系の薬味は「食欲がないときに消化を助ける」という理にかなった組み合わせ。

## 失敗しやすいポイント
1. **豚肉を茹ですぎる** — 「まだ早いかな」くらいで引き上げてOK。余熱でも火が入る。茹ですぎ=硬くパサつく最大の原因。
2. **なすのラップが緩い** — 蒸気が逃げて蒸しむらになる。ぴったり密着させて包む。
', null, null);
insert into recipes (id, household_id, name, category, protein, time_min, freezable, freeze_notes, card_md, source, tags) values (2, '00000000-0000-4000-8000-000000000001', '銀鮭の照り焼き', '主菜', '魚', 20, true, '冷凍1ヶ月。1切れずつラップ。解凍はレンジ弱→トースターで温め直すと皮がパリッとする', null, null, null);
insert into recipes (id, household_id, name, category, protein, time_min, freezable, freeze_notes, card_md, source, tags) values (3, '00000000-0000-4000-8000-000000000001', 'エアオーブンのノンフライ唐揚げ', '主菜', '鶏', 30, true, '冷凍3週間。凍ったままエアオーブン180℃6分で復活。衣が薄いので自然解凍は不向き', null, null, null);
insert into recipes (id, household_id, name, category, protein, time_min, freezable, freeze_notes, card_md, source, tags) values (4, '00000000-0000-4000-8000-000000000001', '麻婆豆腐', '主菜', '豆', 20, false, null, null, null, null);
insert into recipes (id, household_id, name, category, protein, time_min, freezable, freeze_notes, card_md, source, tags) values (5, '00000000-0000-4000-8000-000000000001', '冷奴のきざみしょうがのせ', '副菜', '豆', 3, false, null, '# 冷奴のきざみしょうがのせ

## 基本情報
- 2人分 / 調理時間 約3分
- 使う器具: なし(包丁とキッチンペーパーのみ)

## 材料(2人分)
- 絹豆腐 1丁(300g) ※半丁ずつ
- 桃屋のきざみしょうが 小さじ2
- 醤油 小さじ2(またはポン酢 小さじ2、白だし 小さじ1+水 小さじ1でも)

## 手順

### 1. 豆腐の水を切る(2分)
豆腐をパックから出し、キッチンペーパー2枚で包んで皿にのせ、2分置く。急ぐときはペーパーで包んで軽く手で挟み、水気を押し出す。

- **完了サイン**: ペーパーがしっとり濡れて、豆腐表面の水膜が消えている。
- **なぜ水を切る?** 表面に水が残っていると醤油が薄まり、味がぼやける。豆腐の水切りは「味を決めるための下ごしらえ」で、冷奴程度なら2分の軽い水切りで十分。麻婆豆腐のような加熱料理では崩れ防止の意味も持つ。

### 2. 盛り付け
半丁ずつ器に盛り、きざみしょうがをのせ、食べる直前に醤油をかける。

- **なぜ直前にかける?** 醤油の塩分が豆腐の水分を浸透圧で引き出すため、早くかけると水っぽくなる。漬物や塩もみと同じ原理。

## 栄養メモ
- **絹豆腐**: 植物性たんぱく質を約1丁15g含み、脂質は肉より控えめ。大豆イソフラボンやカルシウムも摂れる。加熱しないぶんビタミンB群の損失もない。主菜が肉の日のたんぱく質の「植物枠」として優秀で、週1どころか毎日でも理にかなった副菜。
- **しょうが**: ジンゲロールの消化促進作用で、食事の最初に食べると胃が動き出しやすい。

## 失敗しやすいポイント
1. **醤油のかけすぎ** — 豆腐は淡泊なので塩味が乗りやすい。小さじ1/人から。足りなければ後がけで調整。
', null, '週1定番,火を使わない');
insert into recipes (id, household_id, name, category, protein, time_min, freezable, freeze_notes, card_md, source, tags) values (6, '00000000-0000-4000-8000-000000000001', '豚しゃぶと玉ねぎの香味ポン酢', '主菜', '豚', 15, false, null, '# 豚しゃぶと玉ねぎの香味ポン酢

## 基本情報
- 2人分 / 調理時間 約15分
- 使う器具: 片手鍋、ガスコンロ

## 材料(2人分)
- 豚ロースしゃぶしゃぶ用 300g
- 玉ねぎ 1個
- きゅうり 1本
- ポン酢 大さじ3
- ごま油 小さじ1(妻の分は小さじ2に増量)
- 桃屋のきざみしょうが 小さじ2
- 塩 小さじ1(茹で湯用。湯1Lに対して)

## 手順

### 1. 玉ねぎをスライスして空気にさらす(最初にやる・15分置く)
玉ねぎを縦半分に切り、切り口を下にして**繊維を断つ向き**(横向き)に2mm厚の薄切りにする。バットや皿に広げて、そのまま15分置く。

- **完了サイン**: 生の玉ねぎの刺激臭が和らぎ、甘い香りが立ってくる。
- **なぜ水にさらさない?** 玉ねぎの辛味は硫化アリル(アリシン)という成分で、これは水溶性なので水にさらすと確かに辛味が抜ける。ただし同時に、豚肉のビタミンB1の吸収を助ける有効成分まで流れ出てしまう。空気に15分さらすだけでも辛味成分は揮発して和らぐので、栄養を残したいこの料理では「空気にさらす」が正解。
- **なぜ繊維を断つ向き?** 繊維に沿って切ると辛味が残りシャキシャキ感が強い。繊維を断つと細胞が壊れて辛味が抜けやすく、口当たりも柔らかくなる。生で食べるときは断つ向きが向いている。

### 2. きゅうりを切る(2分)
きゅうりは両端を切り落とし、ピーラーで縞に皮をむいてから斜め薄切り(3mm幅)にする。皿に敷いておく。

### 3. 豚肉を茹でる(5分)
片手鍋に湯1Lを沸かし、塩小さじ1を入れたら**火を止める**。豚肉を1枚ずつ広げて入れ、色が変わったら(約20〜30秒)引き上げてザルへ。全量を2〜3回に分けて茹でる。氷水には取らない。

- **完了サイン**: ピンク色が完全に消えて白くなったら即引き上げ。
- **なぜ火を止めて茹でる?** 豚肉のたんぱく質は65℃を超えると急激に収縮して硬くなる。沸騰した湯(100℃)ではなく80℃前後で優しく火を通すと、しっとり柔らかく仕上がる。氷水に取らないのも同じ理由で、急冷すると脂が固まって肉が締まりパサつく。ザルで粗熱を取るのが正解。

### 4. 盛り付けとタレ(3分)
きゅうりの上に玉ねぎ、豚肉の順に重ね、ポン酢・ごま油・きざみしょうがを混ぜてかける。

- **増量のコツ**: 妻の分は皿を小さめにして、ごま油を小さじ2に増やす。見た目の量は変えずにカロリーだけ上げられる(脂質は1gあたり9kcalで、たんぱく質・糖質の4kcalの倍以上)。

## 栄養メモ
- **豚肉**: ビタミンB1が全食材トップクラス。糖質をエネルギーに変える代謝に必須で、疲労回復のビタミンと呼ばれる。
- **玉ねぎ**: 硫化アリル(アリシン)がビタミンB1と結合して「アリチアミン」になり、B1の吸収率と体内滞留時間を大きく高める。豚肉+玉ねぎは科学的に理にかなった黄金の組み合わせで、生姜焼きが定番なのも同じ理由。
- **しょうが**: ジンゲロールに消化促進・血行促進の働き。食欲が落ちる時期の薬味として理にかなっている。

## 失敗しやすいポイント
1. **豚肉を茹ですぎる** — 「まだ早いかな」で引き上げてOK。余熱でも火が入る。茹ですぎが硬さの最大の原因。
2. **玉ねぎを切ってすぐ食べる** — 辛味がきつい。15分置く時間を確保するため、玉ねぎを最初に切るのが段取りのコツ。
', null, 'さっぱり,増量対応');
select setval('recipes_id_seq', (select max(id) from recipes));

-- recipe_ingredients
insert into recipe_ingredients (recipe_id, name, qty, unit, optional) values (1, '豚ロースしゃぶしゃぶ用', 300.0, 'g', false);
insert into recipe_ingredients (recipe_id, name, qty, unit, optional) values (1, 'なす', 2.0, '本', false);
insert into recipe_ingredients (recipe_id, name, qty, unit, optional) values (1, 'きゅうり', 1.0, '本', false);
insert into recipe_ingredients (recipe_id, name, qty, unit, optional) values (1, 'ポン酢', 3.0, '大さじ', false);
insert into recipe_ingredients (recipe_id, name, qty, unit, optional) values (1, 'ごま油', 1.0, '小さじ', false);
insert into recipe_ingredients (recipe_id, name, qty, unit, optional) values (1, '桃屋のきざみしょうが', 2.0, '小さじ', false);
insert into recipe_ingredients (recipe_id, name, qty, unit, optional) values (2, '銀鮭', 2.0, '切れ', false);
insert into recipe_ingredients (recipe_id, name, qty, unit, optional) values (2, '醤油', 1.5, '大さじ', false);
insert into recipe_ingredients (recipe_id, name, qty, unit, optional) values (2, 'みりん', 1.5, '大さじ', false);
insert into recipe_ingredients (recipe_id, name, qty, unit, optional) values (2, '酒', 1.0, '大さじ', false);
insert into recipe_ingredients (recipe_id, name, qty, unit, optional) values (2, '砂糖', 1.0, '小さじ', false);
insert into recipe_ingredients (recipe_id, name, qty, unit, optional) values (2, '小麦粉', 2.0, '小さじ', false);
insert into recipe_ingredients (recipe_id, name, qty, unit, optional) values (2, 'サラダ油', 1.0, '小さじ', false);
insert into recipe_ingredients (recipe_id, name, qty, unit, optional) values (3, '鶏もも肉', 300.0, 'g', false);
insert into recipe_ingredients (recipe_id, name, qty, unit, optional) values (3, '醤油', 1.5, '大さじ', false);
insert into recipe_ingredients (recipe_id, name, qty, unit, optional) values (3, '酒', 1.0, '大さじ', false);
insert into recipe_ingredients (recipe_id, name, qty, unit, optional) values (3, '桃屋のきざみにんにく', 1.0, '小さじ', false);
insert into recipe_ingredients (recipe_id, name, qty, unit, optional) values (3, '桃屋のきざみしょうが', 1.0, '小さじ', false);
insert into recipe_ingredients (recipe_id, name, qty, unit, optional) values (3, '片栗粉', 3.0, '大さじ', false);
insert into recipe_ingredients (recipe_id, name, qty, unit, optional) values (3, 'サラダ油', 2.0, '小さじ', false);
insert into recipe_ingredients (recipe_id, name, qty, unit, optional) values (4, '絹豆腐', 1.0, '丁(300g)', false);
insert into recipe_ingredients (recipe_id, name, qty, unit, optional) values (4, '豚ひき肉', 200.0, 'g', false);
insert into recipe_ingredients (recipe_id, name, qty, unit, optional) values (4, '長ねぎ', 0.5, '本', false);
insert into recipe_ingredients (recipe_id, name, qty, unit, optional) values (4, '甜麺醤', 1.0, '大さじ', false);
insert into recipe_ingredients (recipe_id, name, qty, unit, optional) values (4, '鶏がらスープの素', 1.0, '小さじ', false);
insert into recipe_ingredients (recipe_id, name, qty, unit, optional) values (4, '醤油', 1.0, '大さじ', false);
insert into recipe_ingredients (recipe_id, name, qty, unit, optional) values (4, '桃屋のきざみにんにく', 1.0, '小さじ', false);
insert into recipe_ingredients (recipe_id, name, qty, unit, optional) values (4, '片栗粉', 1.0, '大さじ', false);
insert into recipe_ingredients (recipe_id, name, qty, unit, optional) values (4, 'ごま油', 1.0, '小さじ', false);
insert into recipe_ingredients (recipe_id, name, qty, unit, optional) values (4, '桃屋 ラー油', 1.0, '小さじ', true);
insert into recipe_ingredients (recipe_id, name, qty, unit, optional) values (5, '絹豆腐', 1.0, '丁(300g)', false);
insert into recipe_ingredients (recipe_id, name, qty, unit, optional) values (5, '桃屋のきざみしょうが', 2.0, '小さじ', false);
insert into recipe_ingredients (recipe_id, name, qty, unit, optional) values (5, '醤油', 2.0, '小さじ', false);
insert into recipe_ingredients (recipe_id, name, qty, unit, optional) values (6, '豚ロースしゃぶしゃぶ用', 300.0, 'g', false);
insert into recipe_ingredients (recipe_id, name, qty, unit, optional) values (6, '玉ねぎ', 1.0, '個', false);
insert into recipe_ingredients (recipe_id, name, qty, unit, optional) values (6, 'きゅうり', 1.0, '本', false);
insert into recipe_ingredients (recipe_id, name, qty, unit, optional) values (6, 'ポン酢', 3.0, '大さじ', false);
insert into recipe_ingredients (recipe_id, name, qty, unit, optional) values (6, 'ごま油', 1.0, '小さじ', false);
insert into recipe_ingredients (recipe_id, name, qty, unit, optional) values (6, '桃屋のきざみしょうが', 2.0, '小さじ', false);

-- cook_log
insert into cook_log (household_id, date, recipe_id, name, batch, rating, memo) values ('00000000-0000-4000-8000-000000000001', '2026-08-06', 5, '冷奴のきざみしょうがのせ', false, null, 'サラダ・惣菜の残りと合わせて軽めの夕食');

-- meal_plan
insert into meal_plan (household_id, date, slot, recipe_id, name, status) values ('00000000-0000-4000-8000-000000000001', '2026-08-06', '夕食', null, 'サラダ+冷奴+惣菜の残り(軽め)', '実施');
insert into meal_plan (household_id, date, slot, recipe_id, name, status) values ('00000000-0000-4000-8000-000000000001', '2026-08-07', '夕食', null, '外食', '予定');
insert into meal_plan (household_id, date, slot, recipe_id, name, status) values ('00000000-0000-4000-8000-000000000001', '2026-08-08', '夕食', 6, '豚しゃぶと玉ねぎの香味ポン酢', '予定');
insert into meal_plan (household_id, date, slot, recipe_id, name, status) values ('00000000-0000-4000-8000-000000000001', '2026-08-09', '夕食', 2, '銀鮭の照り焼き', '予定');
insert into meal_plan (household_id, date, slot, recipe_id, name, status) values ('00000000-0000-4000-8000-000000000001', '2026-08-10', '夕食', 3, 'エアオーブンのノンフライ唐揚げ', '予定');
insert into meal_plan (household_id, date, slot, recipe_id, name, status) values ('00000000-0000-4000-8000-000000000001', '2026-08-11', '夕食', 4, '麻婆豆腐', '予定');

-- shopping_list(未購入のみ移行)
insert into shopping_list (household_id, item, qty, reason, section, sort_order, status) values ('00000000-0000-4000-8000-000000000001', '鶏むね肉', '安ければ', 'セール枠→唐揚げを差し替え or 冷凍ストック', 'セール枠', 10, '未購入');
insert into shopping_list (household_id, item, qty, reason, section, sort_order, status) values ('00000000-0000-4000-8000-000000000001', '豚こま', '安ければ', 'セール枠→冷凍ストック', 'セール枠', 20, '未購入');
insert into shopping_list (household_id, item, qty, reason, section, sort_order, status) values ('00000000-0000-4000-8000-000000000001', 'オクラ・ピーマン等の夏野菜', '安ければ', 'セール枠→副菜追加', 'セール枠', 30, '未購入');
insert into shopping_list (household_id, item, qty, reason, section, sort_order, status) values ('00000000-0000-4000-8000-000000000001', 'ミックスナッツ(素焼き)', '1袋', '妻の増量サポート補食(任意)。バナナの代替', '加工品・その他', 40, '未購入');
insert into shopping_list (household_id, item, qty, reason, section, sort_order, status) values ('00000000-0000-4000-8000-000000000001', '絹豆腐', '1丁', '冷奴の分が不足(麻婆で1丁使うため)', '乳製品・卵・豆腐', 50, '未購入');
insert into shopping_list (household_id, item, qty, reason, section, sort_order, status) values ('00000000-0000-4000-8000-000000000001', 'ドレッシング', '1本', 'サラダ用。ノンオイルより普通のオイル入りが増量方針に合う', '調味料', 60, '未購入');

commit;
