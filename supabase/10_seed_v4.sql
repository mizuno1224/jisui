-- ============================================================
-- 手元の家計簿(kakeibo.db)からの移行データ
-- scripts/migrate-kakeibo.mjs が生成。手で編集しない。
-- 09_schema_v4.sql の後に実行する。
-- 何度実行しても増えない(既にある行は飛ばす)。
-- ============================================================

begin;

-- 口座・資産・負債の台帳(9件)
-- 同じ名前が既にあれば作らない
insert into accounts (household_id, name, kind, category, sort_order)
select '00000000-0000-4000-8000-000000000001', 'SBI証券 NISAつみたて枠 投信', '資産', '投資', 0
where not exists (select 1 from accounts where household_id = '00000000-0000-4000-8000-000000000001' and name = 'SBI証券 NISAつみたて枠 投信');
insert into accounts (household_id, name, kind, category, sort_order)
select '00000000-0000-4000-8000-000000000001', 'SBI証券 NISA成長枠 投信', '資産', '投資', 10
where not exists (select 1 from accounts where household_id = '00000000-0000-4000-8000-000000000001' and name = 'SBI証券 NISA成長枠 投信');
insert into accounts (household_id, name, kind, category, sort_order)
select '00000000-0000-4000-8000-000000000001', 'SBI証券 NISA成長枠 株式', '資産', '投資', 20
where not exists (select 1 from accounts where household_id = '00000000-0000-4000-8000-000000000001' and name = 'SBI証券 NISA成長枠 株式');
insert into accounts (household_id, name, kind, category, sort_order)
select '00000000-0000-4000-8000-000000000001', 'SBI証券 旧つみたてNISA投信', '資産', '投資', 30
where not exists (select 1 from accounts where household_id = '00000000-0000-4000-8000-000000000001' and name = 'SBI証券 旧つみたてNISA投信');
insert into accounts (household_id, name, kind, category, sort_order)
select '00000000-0000-4000-8000-000000000001', 'iDeCo', '資産', '投資', 40
where not exists (select 1 from accounts where household_id = '00000000-0000-4000-8000-000000000001' and name = 'iDeCo');
insert into accounts (household_id, name, kind, category, sort_order)
select '00000000-0000-4000-8000-000000000001', 'あいち大高', '資産', '預金', 50
where not exists (select 1 from accounts where household_id = '00000000-0000-4000-8000-000000000001' and name = 'あいち大高');
insert into accounts (household_id, name, kind, category, sort_order)
select '00000000-0000-4000-8000-000000000001', '住信SBIネット銀行', '資産', '預金', 60
where not exists (select 1 from accounts where household_id = '00000000-0000-4000-8000-000000000001' and name = '住信SBIネット銀行');
insert into accounts (household_id, name, kind, category, sort_order)
select '00000000-0000-4000-8000-000000000001', '楽天銀行', '資産', '預金', 70
where not exists (select 1 from accounts where household_id = '00000000-0000-4000-8000-000000000001' and name = '楽天銀行');
insert into accounts (household_id, name, kind, category, sort_order)
select '00000000-0000-4000-8000-000000000001', '住宅ローン残高', '負債', 'ローン', 80
where not exists (select 1 from accounts where household_id = '00000000-0000-4000-8000-000000000001' and name = '住宅ローン残高');

-- 月ごとの残高(11件)
insert into balances (household_id, account_id, year_month, amount)
select '00000000-0000-4000-8000-000000000001', a.id, '2026-08', 2437664 from accounts a
where a.household_id = '00000000-0000-4000-8000-000000000001' and a.name = 'SBI証券 NISAつみたて枠 投信'
on conflict (account_id, year_month) do update set amount = excluded.amount;
insert into balances (household_id, account_id, year_month, amount)
select '00000000-0000-4000-8000-000000000001', a.id, '2026-08', 318710 from accounts a
where a.household_id = '00000000-0000-4000-8000-000000000001' and a.name = 'SBI証券 NISA成長枠 投信'
on conflict (account_id, year_month) do update set amount = excluded.amount;
insert into balances (household_id, account_id, year_month, amount)
select '00000000-0000-4000-8000-000000000001', a.id, '2026-08', 199230 from accounts a
where a.household_id = '00000000-0000-4000-8000-000000000001' and a.name = 'SBI証券 NISA成長枠 株式'
on conflict (account_id, year_month) do update set amount = excluded.amount;
insert into balances (household_id, account_id, year_month, amount)
select '00000000-0000-4000-8000-000000000001', a.id, '2026-08', 1093979 from accounts a
where a.household_id = '00000000-0000-4000-8000-000000000001' and a.name = 'SBI証券 旧つみたてNISA投信'
on conflict (account_id, year_month) do update set amount = excluded.amount;
insert into balances (household_id, account_id, year_month, amount)
select '00000000-0000-4000-8000-000000000001', a.id, '2026-08', 2726134 from accounts a
where a.household_id = '00000000-0000-4000-8000-000000000001' and a.name = 'iDeCo'
on conflict (account_id, year_month) do update set amount = excluded.amount;
insert into balances (household_id, account_id, year_month, amount)
select '00000000-0000-4000-8000-000000000001', a.id, '2026-08', 992908 from accounts a
where a.household_id = '00000000-0000-4000-8000-000000000001' and a.name = 'あいち大高'
on conflict (account_id, year_month) do update set amount = excluded.amount;
insert into balances (household_id, account_id, year_month, amount)
select '00000000-0000-4000-8000-000000000001', a.id, '2026-08', 369333 from accounts a
where a.household_id = '00000000-0000-4000-8000-000000000001' and a.name = '住信SBIネット銀行'
on conflict (account_id, year_month) do update set amount = excluded.amount;
insert into balances (household_id, account_id, year_month, amount)
select '00000000-0000-4000-8000-000000000001', a.id, '2026-08', 538845 from accounts a
where a.household_id = '00000000-0000-4000-8000-000000000001' and a.name = '楽天銀行'
on conflict (account_id, year_month) do update set amount = excluded.amount;
insert into balances (household_id, account_id, year_month, amount)
select '00000000-0000-4000-8000-000000000001', a.id, '2026-08', 39509971 from accounts a
where a.household_id = '00000000-0000-4000-8000-000000000001' and a.name = '住宅ローン残高'
on conflict (account_id, year_month) do update set amount = excluded.amount;
insert into balances (household_id, account_id, year_month, amount)
select '00000000-0000-4000-8000-000000000001', a.id, '2026-07', 992908 from accounts a
where a.household_id = '00000000-0000-4000-8000-000000000001' and a.name = 'あいち大高'
on conflict (account_id, year_month) do update set amount = excluded.amount;
insert into balances (household_id, account_id, year_month, amount)
select '00000000-0000-4000-8000-000000000001', a.id, '2026-07', 538845 from accounts a
where a.household_id = '00000000-0000-4000-8000-000000000001' and a.name = '楽天銀行'
on conflict (account_id, year_month) do update set amount = excluded.amount;

-- 資産の内訳(3件)
insert into asset_details (household_id, item, sub_item, amount, as_of, note) values ('00000000-0000-4000-8000-000000000001', 'iDeCo', 'eMAXIS Slim 米国株式(S&P500)', 1582817, '2026-08-04', '拠出累計1,519,364円(掛金444,000+移換金1,075,364)・購入金額計1,510,212円。損益+1,215,922円(2026-08-04時点)')
on conflict (household_id, item, sub_item) do nothing;
insert into asset_details (household_id, item, sub_item, amount, as_of, note) values ('00000000-0000-4000-8000-000000000001', 'iDeCo', 'eMAXIS Slim 先進国株式インデックス', 838122, '2026-08-04', '拠出累計1,519,364円(掛金444,000+移換金1,075,364)・購入金額計1,510,212円。損益+1,215,922円(2026-08-04時点)')
on conflict (household_id, item, sub_item) do nothing;
insert into asset_details (household_id, item, sub_item, amount, as_of, note) values ('00000000-0000-4000-8000-000000000001', 'iDeCo', 'eMAXIS Slim 全世界株式(除く日本)', 305195, '2026-08-04', '拠出累計1,519,364円(掛金444,000+移換金1,075,364)・購入金額計1,510,212円。損益+1,215,922円(2026-08-04時点)')
on conflict (household_id, item, sub_item) do nothing;

-- 保有銘柄(12件)
insert into holdings (household_id, as_of, kind, account, code, name, quantity, acq_price, cur_price, acq_amount, value, pnl, accumulating) values ('00000000-0000-4000-8000-000000000001', '2026-08-03', '株式', 'NISA成長', '4661', 'OLC(オリエンタルランド)', 10, 2790, 3087, 27900, 30870, 2970, false)
on conflict (household_id, as_of, account, name) do nothing;
insert into holdings (household_id, as_of, kind, account, code, name, quantity, acq_price, cur_price, acq_amount, value, pnl, accumulating) values ('00000000-0000-4000-8000-000000000001', '2026-08-03', '株式', 'NISA成長', '4755', '楽天グループ', 200, 769, 841.8, 153800, 168360, 14560, false)
on conflict (household_id, as_of, account, name) do nothing;
insert into holdings (household_id, as_of, kind, account, code, name, quantity, acq_price, cur_price, acq_amount, value, pnl, accumulating) values ('00000000-0000-4000-8000-000000000001', '2026-08-03', '投信', 'NISA成長', null, 'iFreeNEXT FANG+インデックス', 34716, 86416, 91805, 300001, 318710, 18709, true)
on conflict (household_id, as_of, account, name) do nothing;
insert into holdings (household_id, as_of, kind, account, code, name, quantity, acq_price, cur_price, acq_amount, value, pnl, accumulating) values ('00000000-0000-4000-8000-000000000001', '2026-08-03', '投信', 'NISAつみたて', null, 'eMAXIS Slim 全世界株式(オール・カントリー)', 8924, 33618, 37521, 30000, 33483, 3483, false)
on conflict (household_id, as_of, account, name) do nothing;
insert into holdings (household_id, as_of, kind, account, code, name, quantity, acq_price, cur_price, acq_amount, value, pnl, accumulating) values ('00000000-0000-4000-8000-000000000001', '2026-08-03', '投信', 'NISAつみたて', null, 'eMAXIS Slim 先進国株式(除く日本)', 84346, 32012, 45064, 270008, 380096, 110088, false)
on conflict (household_id, as_of, account, name) do nothing;
insert into holdings (household_id, as_of, kind, account, code, name, quantity, acq_price, cur_price, acq_amount, value, pnl, accumulating) values ('00000000-0000-4000-8000-000000000001', '2026-08-03', '投信', 'NISAつみたて', null, 'iFreeNEXT FANG+インデックス', 34977, 85771, 91805, 300001, 321106, 21105, false)
on conflict (household_id, as_of, account, name) do nothing;
insert into holdings (household_id, as_of, kind, account, code, name, quantity, acq_price, cur_price, acq_amount, value, pnl, accumulating) values ('00000000-0000-4000-8000-000000000001', '2026-08-03', '投信', 'NISAつみたて', null, 'ニッセイ外国株式インデックスファンド', 63831, 42300, 59519, 270005, 379915, 109910, false)
on conflict (household_id, as_of, account, name) do nothing;
insert into holdings (household_id, as_of, kind, account, code, name, quantity, acq_price, cur_price, acq_amount, value, pnl, accumulating) values ('00000000-0000-4000-8000-000000000001', '2026-08-03', '投信', 'NISAつみたて', null, 'SBI・V・S&P500インデックス・ファンド', 329268, 30067, 40182, 990010, 1323064, 333054, true)
on conflict (household_id, as_of, account, name) do nothing;
insert into holdings (household_id, as_of, kind, account, code, name, quantity, acq_price, cur_price, acq_amount, value, pnl, accumulating) values ('00000000-0000-4000-8000-000000000001', '2026-08-03', '投信', '旧つみたてNISA', null, 'SBI・V・S&P500インデックス・ファンド', 272256, 14789, 40182, 402639, 1093979, 691340, false)
on conflict (household_id, as_of, account, name) do nothing;
insert into holdings (household_id, as_of, kind, account, code, name, quantity, acq_price, cur_price, acq_amount, value, pnl, accumulating) values ('00000000-0000-4000-8000-000000000001', '2026-08-04', 'iDeCo', 'iDeCo', null, 'eMAXIS Slim 米国株式(S&P500)', 368938, null, 42902, 862334, 1582817, 720483, true)
on conflict (household_id, as_of, account, name) do nothing;
insert into holdings (household_id, as_of, kind, account, code, name, quantity, acq_price, cur_price, acq_amount, value, pnl, accumulating) values ('00000000-0000-4000-8000-000000000001', '2026-08-04', 'iDeCo', 'iDeCo', null, 'eMAXIS Slim 先進国株式インデックス', 190925, null, 43898, 428990, 838122, 409132, false)
on conflict (household_id, as_of, account, name) do nothing;
insert into holdings (household_id, as_of, kind, account, code, name, quantity, acq_price, cur_price, acq_amount, value, pnl, accumulating) values ('00000000-0000-4000-8000-000000000001', '2026-08-04', 'iDeCo', 'iDeCo', null, 'eMAXIS Slim 全世界株式(除く日本)', 82172, null, 37141, 218888, 305195, 86307, false)
on conflict (household_id, as_of, account, name) do nothing;

-- 監視銘柄(15件)
insert into watchlist (household_id, code, name, market, memo) values ('00000000-0000-4000-8000-000000000001', '7203', 'トヨタ自動車', '東証P', '優待: 3月末100株以上でTOYOTA Wallet残高(1年未満500円/1年以上1,000円/3年以上3,000円。1,000株5年で30,000円)+抽選でモータースポーツ観戦等。配当推移: FY2024 75円→FY2025 90円→FY2026 95円→FY2027予想 100円と増配基調。 【8/4決算】Q1営業利益1兆634億円(-8.8%)・通期純利益を3.25兆円へ+8.3%上方修正(前期比-15.5%減益予想)。関税影響の織り込み縮小・自社株買い発表・配当100円維持。株価は一進一退、円高リスクが新論点(株探/日経)。')
on conflict (household_id, code) do nothing;
insert into watchlist (household_id, code, name, market, memo) values ('00000000-0000-4000-8000-000000000001', '8306', '三菱UFJフィナンシャルG', '東証P', 'メガバンク。金利上昇の恩恵・株主還元強化中。優待なし')
on conflict (household_id, code) do nothing;
insert into watchlist (household_id, code, name, market, memo) values ('00000000-0000-4000-8000-000000000001', '8058', '三菱商事', '東証P', '総合商社。累進配当方針(減配しない方針)+自社株買い実績。優待なし')
on conflict (household_id, code) do nothing;
insert into watchlist (household_id, code, name, market, memo) values ('00000000-0000-4000-8000-000000000001', '9432', 'NTT(日本電信電話)', '東証P', '通信最大手。25分割済みで最低投資額約1.5万円と少額から可。優待: dポイント(100株・継続2年以上1,500pt/5年以上3,000pt。毎年進呈ではない点に注意)')
on conflict (household_id, code) do nothing;
insert into watchlist (household_id, code, name, market, memo) values ('00000000-0000-4000-8000-000000000001', '9433', 'KDDI', '東証P', '通信大手。連続増配実績。優待: 100株以上でPontaポイント進呈(保有期間で増額・1.5倍交換キャンペーン等あり)')
on conflict (household_id, code) do nothing;
insert into watchlist (household_id, code, name, market, memo) values ('00000000-0000-4000-8000-000000000001', '2914', 'JT(日本たばこ産業)', '東証P', '高配当の代表格(利回り3.75%)。株主優待は2023年に廃止済み。配当性向高め')
on conflict (household_id, code) do nothing;
insert into watchlist (household_id, code, name, market, memo) values ('00000000-0000-4000-8000-000000000001', '8766', '東京海上HD', '東証P', '損保最大手。ROE18.7%・海外保険好調。累進配当的な増配実績。優待なし')
on conflict (household_id, code) do nothing;
insert into watchlist (household_id, code, name, market, memo) values ('00000000-0000-4000-8000-000000000001', '1605', 'INPEX', '東証P', '石油・ガス開発の国内最大手。中計で累進配当を明文化+自社株買い実績。原油価格連動が主リスク。優待: 保有株数・年数に応じQUOカード(400株〜)')
on conflict (household_id, code) do nothing;
insert into watchlist (household_id, code, name, market, memo) values ('00000000-0000-4000-8000-000000000001', '8001', '伊藤忠商事', '東証P', '総合商社(非資源比率高)。累進配当・ROE14.6%。分割後で1株2千円弱と買いやすい。優待なし')
on conflict (household_id, code) do nothing;
insert into watchlist (household_id, code, name, market, memo) values ('00000000-0000-4000-8000-000000000001', '8591', 'オリックス', '東証P', '多角金融。累進配当的な増配実績。かつての人気優待(カタログ)は廃止済み')
on conflict (household_id, code) do nothing;
insert into watchlist (household_id, code, name, market, memo) values ('00000000-0000-4000-8000-000000000001', '9434', 'ソフトバンク', '東証P', '通信子会社。利回り最高水準だが配当性向約75%で増配余地小。「高いが増えない」型。100株2.2万円')
on conflict (household_id, code) do nothing;
insert into watchlist (household_id, code, name, market, memo) values ('00000000-0000-4000-8000-000000000001', '4661', 'オリエンタルランド', '東証P', '保有10株(NISA成長・売却検討中)。高PER・配当極小のテーマパーク株。優待は500株以上のため10株では対象外')
on conflict (household_id, code) do nothing;
insert into watchlist (household_id, code, name, market, memo) values ('00000000-0000-4000-8000-000000000001', '4755', '楽天グループ', '東証P', '保有200株(NISA成長・優待目的)。優待: 100株以上で楽天モバイル音声+30GB 1年無料(年3万円超相当)。無配・自己資本比率3.4%が弱点。モバイル損失縮小が焦点')
on conflict (household_id, code) do nothing;
insert into watchlist (household_id, code, name, market, memo) values ('00000000-0000-4000-8000-000000000001', '6758', 'ソニーグループ', '東証P', 'ゲーム・音楽・映画・半導体(CIS)の複合。キャピタル狙い枠。Q1で通期上方修正')
on conflict (household_id, code) do nothing;
insert into watchlist (household_id, code, name, market, memo) values ('00000000-0000-4000-8000-000000000001', '7974', '任天堂', '東証P', 'Switch2サイクル中。キャピタル狙い枠・値動き大きい')
on conflict (household_id, code) do nothing;

-- 監視銘柄の記録(15件)
insert into watch_history (household_id, code, as_of, price, per, pbr, div_yield, dividend, year_high, year_low, note) values ('00000000-0000-4000-8000-000000000001', '7203', '2026-08-03', 2944.5, 12.79, 0.96, 3.4, 100, 4000, 2686, '株価はYahoo!ファイナンス表示(7/21時点表記)。年初来高値4,000円(2/9)・安値2,686円(6/24)。PBR1倍割れ')
on conflict (household_id, code, as_of) do nothing;
insert into watch_history (household_id, code, as_of, price, per, pbr, div_yield, dividend, year_high, year_low, note) values ('00000000-0000-4000-8000-000000000001', '8306', '2026-08-03', 3668, null, 1.86, 2.62, 96, 3733, 2516, '7/22終値。年初来高値3,733(7/15)・安値2,516(1/5)。高値圏。時価総額43.5兆円')
on conflict (household_id, code, as_of) do nothing;
insert into watch_history (household_id, code, as_of, price, per, pbr, div_yield, dividend, year_high, year_low, note) values ('00000000-0000-4000-8000-000000000001', '8058', '2026-08-03', 4776, 15.9, 1.85, 2.62, 125, 6012, 3610, '7/31終値。年初来高値6,012(5/15)・安値3,610(1/5)')
on conflict (household_id, code, as_of) do nothing;
insert into watch_history (household_id, code, as_of, price, per, pbr, div_yield, dividend, year_high, year_low, note) values ('00000000-0000-4000-8000-000000000001', '9432', '2026-08-03', 152.4, 12.66, 1.28, 3.54, 5.4, 161, 143, '7/31終値(前日比-4.15%)。年初来高値161(1/6)・安値143(6/23)。レンジ相場')
on conflict (household_id, code, as_of) do nothing;
insert into watch_history (household_id, code, as_of, price, per, pbr, div_yield, dividend, year_high, year_low, note) values ('00000000-0000-4000-8000-000000000001', '9433', '2026-08-03', 2921, null, 2.19, 2.88, 84, 3121, 2493, '7/31終値。行政指導報道で-4.26%の急落直後。年初来高値3,121(7/30)・安値2,493(5/12)')
on conflict (household_id, code, as_of) do nothing;
insert into watch_history (household_id, code, as_of, price, per, pbr, div_yield, dividend, year_high, year_low, note) values ('00000000-0000-4000-8000-000000000001', '2914', '2026-08-03', 6461, 20.12, 2.81, 3.75, 242, 6525, 5451, '7/24時点。年初来高値6,525(7/23)・安値5,451(1/29)。高値圏')
on conflict (household_id, code, as_of) do nothing;
insert into watch_history (household_id, code, as_of, price, per, pbr, div_yield, dividend, year_high, year_low, note) values ('00000000-0000-4000-8000-000000000001', '8766', '2026-08-03', 8279, 18.74, 1.95, 2.96, 245, 8289, 5529, '7/27時点。年初来高値8,289(7/27)更新中の高値圏。ROE18.68%')
on conflict (household_id, code, as_of) do nothing;
insert into watch_history (household_id, code, as_of, price, per, pbr, div_yield, dividend, year_high, year_low, note) values ('00000000-0000-4000-8000-000000000001', '1605', '2026-08-05', 3627, 12.05, 0.86, 2.98, 108, 4955, 3020, '7/31終値(Yahoo)。年初来高値4,955(3/30)・安値3,020(1/7)。位置31%')
on conflict (household_id, code, as_of) do nothing;
insert into watch_history (household_id, code, as_of, price, per, pbr, div_yield, dividend, year_high, year_low, note) values ('00000000-0000-4000-8000-000000000001', '8001', '2026-08-05', 1957.5, 14.4, 2.08, 2.25, 44, 2286, 1802, '7/24時点(Yahoo)。高値2,286(2/27)・安値1,802(6/11)。位置32%')
on conflict (household_id, code, as_of) do nothing;
insert into watch_history (household_id, code, as_of, price, per, pbr, div_yield, dividend, year_high, year_low, note) values ('00000000-0000-4000-8000-000000000001', '8591', '2026-08-05', 6205, 12.9, 1.52, 3.02, 187.36, 6438, 4528, '6/1時点(Yahoo・やや古い→要更新)。高値6,438(5/26)・安値4,528(3/30)')
on conflict (household_id, code, as_of) do nothing;
insert into watch_history (household_id, code, as_of, price, per, pbr, div_yield, dividend, year_high, year_low, note) values ('00000000-0000-4000-8000-000000000001', '9434', '2026-08-05', 223.4, 19.06, 4.05, 3.94, 8.8, 238, 203, '7/31終値(Yahoo)。高値238(7/29)・安値203(6/26)。位置41%')
on conflict (household_id, code, as_of) do nothing;
insert into watch_history (household_id, code, as_of, price, per, pbr, div_yield, dividend, year_high, year_low, note) values ('00000000-0000-4000-8000-000000000001', '4661', '2026-08-05', 3167, 45.63, 4.6, 0.51, 16, 3167, 2103, '7/31終値(Yahoo)。7/30決算(営業+23.1%)で年初来高値を更新中')
on conflict (household_id, code, as_of) do nothing;
insert into watch_history (household_id, code, as_of, price, per, pbr, div_yield, dividend, year_high, year_low, note) values ('00000000-0000-4000-8000-000000000001', '4755', '2026-08-05', 832, null, 2.01, null, null, 1026, 686, '7/28時点(Yahoo)。無配。売上+14.4%・モバイル損失縮小')
on conflict (household_id, code, as_of) do nothing;
insert into watch_history (household_id, code, as_of, price, per, pbr, div_yield, dividend, year_high, year_low, note) values ('00000000-0000-4000-8000-000000000001', '6758', '2026-08-05', 3565, 17.36, 2.5, 0.98, 35, 4124, 3043, '8/3時点(Yahoo)。7/31のQ1通期上方修正で+11%。位置48%')
on conflict (household_id, code, as_of) do nothing;
insert into watch_history (household_id, code, as_of, price, per, pbr, div_yield, dividend, year_high, year_low, note) values ('00000000-0000-4000-8000-000000000001', '7974', '2026-08-05', 7679, 28.56, 3, 2.11, 162, 10890, 6544, '7/31終値(Yahoo)。位置26%。次回決算8/6予定(決算またぎ注意)')
on conflict (household_id, code, as_of) do nothing;

-- ローン残高の予定(4件)
insert into loan_schedule (household_id, year_month, balance, kind, note) values ('00000000-0000-4000-8000-000000000001', '2026-04', 39800000, '実績', '借入実行(2026-04-24)')
on conflict (household_id, year_month) do nothing;
insert into loan_schedule (household_id, year_month, balance, kind, note) values ('00000000-0000-4000-8000-000000000001', '2026-08', 39509971, '実績', '確定データ台帳(2026-08)')
on conflict (household_id, year_month) do nothing;
insert into loan_schedule (household_id, year_month, balance, kind, note) values ('00000000-0000-4000-8000-000000000001', '2038-12', 28900000, '見込', '住宅ローン控除終了時点の残高目安')
on conflict (household_id, year_month) do nothing;
insert into loan_schedule (household_id, year_month, balance, kind, note) values ('00000000-0000-4000-8000-000000000001', '2054-12', 12960000, '見込', '60歳時点の残高目安')
on conflict (household_id, year_month) do nothing;

-- 俸給表(44件)
insert into salary_table (household_id, age, grade_no, monthly_salary, bonus_summer, bonus_winter, retire_rate_self, retire_rate_teinen, retire_rate_komu, note) values ('00000000-0000-4000-8000-000000000001', 22, 1, 231250, 585810, 940550, null, null, null, '愛知中高教諭俸給表(参考用・2019.8まで)')
on conflict (household_id, age) do nothing;
insert into salary_table (household_id, age, grade_no, monthly_salary, bonus_summer, bonus_winter, retire_rate_self, retire_rate_teinen, retire_rate_komu, note) values ('00000000-0000-4000-8000-000000000001', 23, 2, 238690, 603150, 968820, 0.6, 1, 3.6, '愛知中高教諭俸給表(参考用・2019.8まで)')
on conflict (household_id, age) do nothing;
insert into salary_table (household_id, age, grade_no, monthly_salary, bonus_summer, bonus_winter, retire_rate_self, retire_rate_teinen, retire_rate_komu, note) values ('00000000-0000-4000-8000-000000000001', 24, 3, 246130, 620480, 997090, 1.2, 2, 4.5, '愛知中高教諭俸給表(参考用・2019.8まで)')
on conflict (household_id, age) do nothing;
insert into salary_table (household_id, age, grade_no, monthly_salary, bonus_summer, bonus_winter, retire_rate_self, retire_rate_teinen, retire_rate_komu, note) values ('00000000-0000-4000-8000-000000000001', 25, 4, 253570, 637820, 1025370, 1.8, 3, 5.4, '愛知中高教諭俸給表(参考用・2019.8まで)')
on conflict (household_id, age) do nothing;
insert into salary_table (household_id, age, grade_no, monthly_salary, bonus_summer, bonus_winter, retire_rate_self, retire_rate_teinen, retire_rate_komu, note) values ('00000000-0000-4000-8000-000000000001', 26, 5, 261010, 655150, 1053640, 2.4, 4, 6, '愛知中高教諭俸給表(参考用・2019.8まで)')
on conflict (household_id, age) do nothing;
insert into salary_table (household_id, age, grade_no, monthly_salary, bonus_summer, bonus_winter, retire_rate_self, retire_rate_teinen, retire_rate_komu, note) values ('00000000-0000-4000-8000-000000000001', 27, 6, 268440, 672470, 1081870, 4, 5, 7.5, '愛知中高教諭俸給表(参考用・2019.8まで)')
on conflict (household_id, age) do nothing;
insert into salary_table (household_id, age, grade_no, monthly_salary, bonus_summer, bonus_winter, retire_rate_self, retire_rate_teinen, retire_rate_komu, note) values ('00000000-0000-4000-8000-000000000001', 28, 7, 281660, 703270, 1132110, 5.5, 6, 9, '愛知中高教諭俸給表(参考用・2019.8まで)')
on conflict (household_id, age) do nothing;
insert into salary_table (household_id, age, grade_no, monthly_salary, bonus_summer, bonus_winter, retire_rate_self, retire_rate_teinen, retire_rate_komu, note) values ('00000000-0000-4000-8000-000000000001', 29, 8, 294870, 734050, 1182310, 6.25, 7, 10.5, '愛知中高教諭俸給表(参考用・2019.8まで)')
on conflict (household_id, age) do nothing;
insert into salary_table (household_id, age, grade_no, monthly_salary, bonus_summer, bonus_winter, retire_rate_self, retire_rate_teinen, retire_rate_komu, note) values ('00000000-0000-4000-8000-000000000001', 30, 9, 308090, 764850, 1232540, 7, 8, 12, '愛知中高教諭俸給表(参考用・2019.8まで)')
on conflict (household_id, age) do nothing;
insert into salary_table (household_id, age, grade_no, monthly_salary, bonus_summer, bonus_winter, retire_rate_self, retire_rate_teinen, retire_rate_komu, note) values ('00000000-0000-4000-8000-000000000001', 31, 10, 321300, 795630, 1282740, 7.75, 9, 13.5, '愛知中高教諭俸給表(参考用・2019.8まで)')
on conflict (household_id, age) do nothing;
insert into salary_table (household_id, age, grade_no, monthly_salary, bonus_summer, bonus_winter, retire_rate_self, retire_rate_teinen, retire_rate_komu, note) values ('00000000-0000-4000-8000-000000000001', 32, 11, 334510, 826410, 1332940, 8.5, 10, 15, '愛知中高教諭俸給表(参考用・2019.8まで)')
on conflict (household_id, age) do nothing;
insert into salary_table (household_id, age, grade_no, monthly_salary, bonus_summer, bonus_winter, retire_rate_self, retire_rate_teinen, retire_rate_komu, note) values ('00000000-0000-4000-8000-000000000001', 33, 12, 348200, 858310, 1384960, 11, 13.875, 16.65, '愛知中高教諭俸給表(参考用・2019.8まで)')
on conflict (household_id, age) do nothing;
insert into salary_table (household_id, age, grade_no, monthly_salary, bonus_summer, bonus_winter, retire_rate_self, retire_rate_teinen, retire_rate_komu, note) values ('00000000-0000-4000-8000-000000000001', 34, 13, 361880, 890180, 1436940, 12.2, 15.25, 18.3, '愛知中高教諭俸給表(参考用・2019.8まで)')
on conflict (household_id, age) do nothing;
insert into salary_table (household_id, age, grade_no, monthly_salary, bonus_summer, bonus_winter, retire_rate_self, retire_rate_teinen, retire_rate_komu, note) values ('00000000-0000-4000-8000-000000000001', 35, 14, 375560, 922050, 1488930, 13.3, 16.625, 19.95, '愛知中高教諭俸給表(参考用・2019.8まで)')
on conflict (household_id, age) do nothing;
insert into salary_table (household_id, age, grade_no, monthly_salary, bonus_summer, bonus_winter, retire_rate_self, retire_rate_teinen, retire_rate_komu, note) values ('00000000-0000-4000-8000-000000000001', 36, 15, 389240, 953930, 1540910, 14.4, 18, 21.6, '愛知中高教諭俸給表(参考用・2019.8まで)')
on conflict (household_id, age) do nothing;
insert into salary_table (household_id, age, grade_no, monthly_salary, bonus_summer, bonus_winter, retire_rate_self, retire_rate_teinen, retire_rate_komu, note) values ('00000000-0000-4000-8000-000000000001', 37, 16, 402920, 985800, 1592900, 15.5, 19.375, 23.25, '愛知中高教諭俸給表(参考用・2019.8まで)')
on conflict (household_id, age) do nothing;
insert into salary_table (household_id, age, grade_no, monthly_salary, bonus_summer, bonus_winter, retire_rate_self, retire_rate_teinen, retire_rate_komu, note) values ('00000000-0000-4000-8000-000000000001', 38, 17, 417970, 1020870, 1650090, 16.6, 20.75, 24.9, '愛知中高教諭俸給表(参考用・2019.8まで)')
on conflict (household_id, age) do nothing;
insert into salary_table (household_id, age, grade_no, monthly_salary, bonus_summer, bonus_winter, retire_rate_self, retire_rate_teinen, retire_rate_komu, note) values ('00000000-0000-4000-8000-000000000001', 39, 18, 433010, 1055910, 1707240, 17.7, 22.125, 26.55, '愛知中高教諭俸給表(参考用・2019.8まで)')
on conflict (household_id, age) do nothing;
insert into salary_table (household_id, age, grade_no, monthly_salary, bonus_summer, bonus_winter, retire_rate_self, retire_rate_teinen, retire_rate_komu, note) values ('00000000-0000-4000-8000-000000000001', 40, 19, 448050, 1090960, 1764390, 18.8, 23.5, 28.2, '愛知中高教諭俸給表(参考用・2019.8まで)')
on conflict (household_id, age) do nothing;
insert into salary_table (household_id, age, grade_no, monthly_salary, bonus_summer, bonus_winter, retire_rate_self, retire_rate_teinen, retire_rate_komu, note) values ('00000000-0000-4000-8000-000000000001', 41, 20, 463090, 1126000, 1821540, 19.9, 24.875, 29.85, '愛知中高教諭俸給表(参考用・2019.8まで)')
on conflict (household_id, age) do nothing;
insert into salary_table (household_id, age, grade_no, monthly_salary, bonus_summer, bonus_winter, retire_rate_self, retire_rate_teinen, retire_rate_komu, note) values ('00000000-0000-4000-8000-000000000001', 42, 21, 478130, 1161040, 1878690, 21, 28.875, 34.65, '愛知中高教諭俸給表(参考用・2019.8まで)')
on conflict (household_id, age) do nothing;
insert into salary_table (household_id, age, grade_no, monthly_salary, bonus_summer, bonus_winter, retire_rate_self, retire_rate_teinen, retire_rate_komu, note) values ('00000000-0000-4000-8000-000000000001', 43, 22, 489990, 1188680, 1923760, 22.2, 33.3, 36.63, '愛知中高教諭俸給表(参考用・2019.8まで)')
on conflict (household_id, age) do nothing;
insert into salary_table (household_id, age, grade_no, monthly_salary, bonus_summer, bonus_winter, retire_rate_self, retire_rate_teinen, retire_rate_komu, note) values ('00000000-0000-4000-8000-000000000001', 44, 23, 501840, 1216290, 1968790, 23.4, 35.1, 38.61, '愛知中高教諭俸給表(参考用・2019.8まで)')
on conflict (household_id, age) do nothing;
insert into salary_table (household_id, age, grade_no, monthly_salary, bonus_summer, bonus_winter, retire_rate_self, retire_rate_teinen, retire_rate_komu, note) values ('00000000-0000-4000-8000-000000000001', 45, 24, 513700, 1243920, 2013860, 24.6, 36.9, 40.59, '愛知中高教諭俸給表(参考用・2019.8まで)')
on conflict (household_id, age) do nothing;
insert into salary_table (household_id, age, grade_no, monthly_salary, bonus_summer, bonus_winter, retire_rate_self, retire_rate_teinen, retire_rate_komu, note) values ('00000000-0000-4000-8000-000000000001', 46, 25, 525550, 1271530, 2058890, 25.8, 38.7, 42.57, '愛知中高教諭俸給表(参考用・2019.8まで)')
on conflict (household_id, age) do nothing;
insert into salary_table (household_id, age, grade_no, monthly_salary, bonus_summer, bonus_winter, retire_rate_self, retire_rate_teinen, retire_rate_komu, note) values ('00000000-0000-4000-8000-000000000001', 47, 26, 537400, 1299140, 2103920, 28.375, 44.55, 44.55, '愛知中高教諭俸給表(参考用・2019.8まで)')
on conflict (household_id, age) do nothing;
insert into salary_table (household_id, age, grade_no, monthly_salary, bonus_summer, bonus_winter, retire_rate_self, retire_rate_teinen, retire_rate_komu, note) values ('00000000-0000-4000-8000-000000000001', 48, 27, 542890, 1311930, 2124780, 30.95, 46.53, 46.53, '愛知中高教諭俸給表(参考用・2019.8まで)')
on conflict (household_id, age) do nothing;
insert into salary_table (household_id, age, grade_no, monthly_salary, bonus_summer, bonus_winter, retire_rate_self, retire_rate_teinen, retire_rate_komu, note) values ('00000000-0000-4000-8000-000000000001', 49, 28, 548380, 1324730, 2145640, 33.525, 48.51, 48.51, '愛知中高教諭俸給表(参考用・2019.8まで)')
on conflict (household_id, age) do nothing;
insert into salary_table (household_id, age, grade_no, monthly_salary, bonus_summer, bonus_winter, retire_rate_self, retire_rate_teinen, retire_rate_komu, note) values ('00000000-0000-4000-8000-000000000001', 50, 29, 553860, 1337490, 2166470, 36.1, 50.49, 50.49, '愛知中高教諭俸給表(参考用・2019.8まで)')
on conflict (household_id, age) do nothing;
insert into salary_table (household_id, age, grade_no, monthly_salary, bonus_summer, bonus_winter, retire_rate_self, retire_rate_teinen, retire_rate_komu, note) values ('00000000-0000-4000-8000-000000000001', 51, 30, 559350, 1350290, 2187330, 38.675, 52.47, 52.47, '愛知中高教諭俸給表(参考用・2019.8まで)')
on conflict (household_id, age) do nothing;
insert into salary_table (household_id, age, grade_no, monthly_salary, bonus_summer, bonus_winter, retire_rate_self, retire_rate_teinen, retire_rate_komu, note) values ('00000000-0000-4000-8000-000000000001', 52, 31, 564830, 1363050, 2208150, 49.5, 54.45, 54.45, '愛知中高教諭俸給表(参考用・2019.8まで)')
on conflict (household_id, age) do nothing;
insert into salary_table (household_id, age, grade_no, monthly_salary, bonus_summer, bonus_winter, retire_rate_self, retire_rate_teinen, retire_rate_komu, note) values ('00000000-0000-4000-8000-000000000001', 53, 32, 567220, 1368620, 2217240, 51.15, 56.265, 56.265, '愛知中高教諭俸給表(参考用・2019.8まで)')
on conflict (household_id, age) do nothing;
insert into salary_table (household_id, age, grade_no, monthly_salary, bonus_summer, bonus_winter, retire_rate_self, retire_rate_teinen, retire_rate_komu, note) values ('00000000-0000-4000-8000-000000000001', 54, 33, 569610, 1374190, 2226320, 52.8, 58.08, 58.08, '愛知中高教諭俸給表(参考用・2019.8まで)')
on conflict (household_id, age) do nothing;
insert into salary_table (household_id, age, grade_no, monthly_salary, bonus_summer, bonus_winter, retire_rate_self, retire_rate_teinen, retire_rate_komu, note) values ('00000000-0000-4000-8000-000000000001', 55, 34, 571990, 1379740, 2235360, 54.45, 59.895, 59.895, '愛知中高教諭俸給表(参考用・2019.8まで)')
on conflict (household_id, age) do nothing;
insert into salary_table (household_id, age, grade_no, monthly_salary, bonus_summer, bonus_winter, retire_rate_self, retire_rate_teinen, retire_rate_komu, note) values ('00000000-0000-4000-8000-000000000001', 56, 35, 574380, 1385310, 2244440, 56.1, 61.71, 61.71, '愛知中高教諭俸給表(参考用・2019.8まで)')
on conflict (household_id, age) do nothing;
insert into salary_table (household_id, age, grade_no, monthly_salary, bonus_summer, bonus_winter, retire_rate_self, retire_rate_teinen, retire_rate_komu, note) values ('00000000-0000-4000-8000-000000000001', 57, 36, 576760, 1390850, 2253490, 57.75, 63.525, 63.525, '愛知中高教諭俸給表(参考用・2019.8まで)')
on conflict (household_id, age) do nothing;
insert into salary_table (household_id, age, grade_no, monthly_salary, bonus_summer, bonus_winter, retire_rate_self, retire_rate_teinen, retire_rate_komu, note) values ('00000000-0000-4000-8000-000000000001', 58, 37, 578260, 1394350, 2259190, 59.4, 64.289, 64.289, '愛知中高教諭俸給表(参考用・2019.8まで)')
on conflict (household_id, age) do nothing;
insert into salary_table (household_id, age, grade_no, monthly_salary, bonus_summer, bonus_winter, retire_rate_self, retire_rate_teinen, retire_rate_komu, note) values ('00000000-0000-4000-8000-000000000001', 59, 38, 579760, 1397840, 2264890, 60.775, 65.053, 65.053, '愛知中高教諭俸給表(参考用・2019.8まで)')
on conflict (household_id, age) do nothing;
insert into salary_table (household_id, age, grade_no, monthly_salary, bonus_summer, bonus_winter, retire_rate_self, retire_rate_teinen, retire_rate_komu, note) values ('00000000-0000-4000-8000-000000000001', 60, 39, 581260, 1401340, 2270590, 65.817, 65.817, 65.817, '愛知中高教諭俸給表(参考用・2019.8まで)')
on conflict (household_id, age) do nothing;
insert into salary_table (household_id, age, grade_no, monthly_salary, bonus_summer, bonus_winter, retire_rate_self, retire_rate_teinen, retire_rate_komu, note) values ('00000000-0000-4000-8000-000000000001', 61, 40, 582760, 1404830, 2276290, 66.581, 66.581, 66.581, '愛知中高教諭俸給表(参考用・2019.8まで)')
on conflict (household_id, age) do nothing;
insert into salary_table (household_id, age, grade_no, monthly_salary, bonus_summer, bonus_winter, retire_rate_self, retire_rate_teinen, retire_rate_komu, note) values ('00000000-0000-4000-8000-000000000001', 62, 41, 584260, 1408330, 2281990, 70.4, 70.4, 70.4, '愛知中高教諭俸給表(参考用・2019.8まで)')
on conflict (household_id, age) do nothing;
insert into salary_table (household_id, age, grade_no, monthly_salary, bonus_summer, bonus_winter, retire_rate_self, retire_rate_teinen, retire_rate_komu, note) values ('00000000-0000-4000-8000-000000000001', 63, 42, 585760, 1411820, 2287690, 70.4, 70.4, 70.4, '愛知中高教諭俸給表(参考用・2019.8まで)')
on conflict (household_id, age) do nothing;
insert into salary_table (household_id, age, grade_no, monthly_salary, bonus_summer, bonus_winter, retire_rate_self, retire_rate_teinen, retire_rate_komu, note) values ('00000000-0000-4000-8000-000000000001', 64, 43, 587260, 1415320, 2293300, 70.4, 70.4, 70.4, '愛知中高教諭俸給表(参考用・2019.8まで)')
on conflict (household_id, age) do nothing;
insert into salary_table (household_id, age, grade_no, monthly_salary, bonus_summer, bonus_winter, retire_rate_self, retire_rate_teinen, retire_rate_komu, note) values ('00000000-0000-4000-8000-000000000001', 65, 44, 588760, 1418810, 2299090, 70.4, 70.4, 70.4, '愛知中高教諭俸給表(参考用・2019.8まで)')
on conflict (household_id, age) do nothing;

-- やること(19件)
insert into todos (household_id, title, detail, status, created_at, done_at)
select '00000000-0000-4000-8000-000000000001', '生活費・ローン折半の実額を記録する', '妻(明日香さん)との折半額。台帳の未確定項目', 'open', '2026-08-03 13:17:11', null
where not exists (select 1 from todos where household_id = '00000000-0000-4000-8000-000000000001' and title = '生活費・ローン折半の実額を記録する');
insert into todos (household_id, title, detail, status, created_at, done_at)
select '00000000-0000-4000-8000-000000000001', '明日香さんの資産・収入・NISAデータをもらう', '世帯全体の資産把握のため。別管理', 'open', '2026-08-03 13:17:11', null
where not exists (select 1 from todos where household_id = '00000000-0000-4000-8000-000000000001' and title = '明日香さんの資産・収入・NISAデータをもらう');
insert into todos (household_id, title, detail, status, created_at, done_at)
select '00000000-0000-4000-8000-000000000001', '物件価格を記録する', '台帳の未確定項目', 'open', '2026-08-03 13:17:11', null
where not exists (select 1 from todos where household_id = '00000000-0000-4000-8000-000000000001' and title = '物件価格を記録する');
insert into todos (household_id, title, detail, status, created_at, done_at)
select '00000000-0000-4000-8000-000000000001', '不動産取得税の申告・納付', '2026年内・名古屋南部県税事務所', 'open', '2026-08-03 13:17:11', null
where not exists (select 1 from todos where household_id = '00000000-0000-4000-8000-000000000001' and title = '不動産取得税の申告・納付');
insert into todos (household_id, title, detail, status, created_at, done_at)
select '00000000-0000-4000-8000-000000000001', 'iDeCo掛金増額(12,000→20,000円)の反映確認', '2026-07-27時点でまだ12,000円の引き落とし', 'open', '2026-08-03 13:17:11', null
where not exists (select 1 from todos where household_id = '00000000-0000-4000-8000-000000000001' and title = 'iDeCo掛金増額(12,000→20,000円)の反映確認');
insert into todos (household_id, title, detail, status, created_at, done_at)
select '00000000-0000-4000-8000-000000000001', 'FANG+縮小の時期・条件を明文化する', 'IPS未確定項目。月20万円の積立は一時的', 'done', '2026-08-03 13:17:11', '2026-08-04 10:45:33'
where not exists (select 1 from todos where household_id = '00000000-0000-4000-8000-000000000001' and title = 'FANG+縮小の時期・条件を明文化する');
insert into todos (household_id, title, detail, status, created_at, done_at)
select '00000000-0000-4000-8000-000000000001', '住宅ローン控除の初回確定申告', '2027-02-16〜03-15 必須。年21万円×13年', 'open', '2026-08-03 13:17:11', null
where not exists (select 1 from todos where household_id = '00000000-0000-4000-8000-000000000001' and title = '住宅ローン控除の初回確定申告');
insert into todos (household_id, title, detail, status, created_at, done_at)
select '00000000-0000-4000-8000-000000000001', 'SBI: FANG+積立を取得100万円到達で停止', '現在取得約60万円。あと2ヶ月(月20万)で到達 → 積立設定を解除。IPS 2026-08-05改定による', 'open', '2026-08-04 10:45:33', null
where not exists (select 1 from todos where household_id = '00000000-0000-4000-8000-000000000001' and title = 'SBI: FANG+積立を取得100万円到達で停止');
insert into todos (household_id, title, detail, status, created_at, done_at)
select '00000000-0000-4000-8000-000000000001', 'SBI: 日本高配当投信の積立を月2〜3万円で設定', '信託報酬0.1%級・年4回分配型をNISA成長枠で。IPS改定による', 'open', '2026-08-04 10:45:33', null
where not exists (select 1 from todos where household_id = '00000000-0000-4000-8000-000000000001' and title = 'SBI: 日本高配当投信の積立を月2〜3万円で設定');
insert into todos (household_id, title, detail, status, created_at, done_at)
select '00000000-0000-4000-8000-000000000001', '修繕積立 月1万円を開始', '個人向け国債 変動10(現行1.80%)をSBIで購入。2036〜2040年の自宅修繕100〜200万円が目標', 'open', '2026-08-04 10:45:33', null
where not exists (select 1 from todos where household_id = '00000000-0000-4000-8000-000000000001' and title = '修繕積立 月1万円を開始');
insert into todos (household_id, title, detail, status, created_at, done_at)
select '00000000-0000-4000-8000-000000000001', 'SBI: 配当受取方式が「株式数比例配分方式」か確認', '未設定だとNISAでも配当に課税される。個別株を買う前に必須', 'open', '2026-08-04 10:45:33', null
where not exists (select 1 from todos where household_id = '00000000-0000-4000-8000-000000000001' and title = 'SBI: 配当受取方式が「株式数比例配分方式」か確認');
insert into todos (household_id, title, detail, status, created_at, done_at)
select '00000000-0000-4000-8000-000000000001', 'カード: 三井住友の利用を固定費+タッチ7%対象店に限定', '年100万到達後は楽天カードへ。今年は既に超過中のため、以降の共用支出を楽天カードに切替(方針.md §4)', 'open', '2026-08-08 13:41:51', null
where not exists (select 1 from todos where household_id = '00000000-0000-4000-8000-000000000001' and title = 'カード: 三井住友の利用を固定費+タッチ7%対象店に限定');
insert into todos (household_id, title, detail, status, created_at, done_at)
select '00000000-0000-4000-8000-000000000001', 'カード: スマホのVisaタッチ設定(Apple Pay/Google Pay)', 'セブン・ローソン・マクドナルド等の対象店で最大7%。夫のスマホに三井住友ゴールドを登録', 'open', '2026-08-08 13:41:51', null
where not exists (select 1 from todos where household_id = '00000000-0000-4000-8000-000000000001' and title = 'カード: スマホのVisaタッチ設定(Apple Pay/Google Pay)');
insert into todos (household_id, title, detail, status, created_at, done_at)
select '00000000-0000-4000-8000-000000000001', 'カード: 夫の楽天カード引落口座を住信SBIに変更', '楽天銀行への送金ステップを廃止するため', 'open', '2026-08-08 13:41:51', null
where not exists (select 1 from todos where household_id = '00000000-0000-4000-8000-000000000001' and title = 'カード: 夫の楽天カード引落口座を住信SBIに変更');
insert into todos (household_id, title, detail, status, created_at, done_at)
select '00000000-0000-4000-8000-000000000001', '銀行: 住信SBIで「定額自動入金」を設定(あいち大高から)', '毎月の手動振替を自動化。無料', 'open', '2026-08-08 13:41:51', null
where not exists (select 1 from todos where household_id = '00000000-0000-4000-8000-000000000001' and title = '銀行: 住信SBIで「定額自動入金」を設定(あいち大高から)');
insert into todos (household_id, title, detail, status, created_at, done_at)
select '00000000-0000-4000-8000-000000000001', '銀行: 妻の楽天銀行で「毎月おまかせ振込予約」を設定(SBIへ定額)', '定額拠出制の自動化', 'open', '2026-08-08 13:41:51', null
where not exists (select 1 from todos where household_id = '00000000-0000-4000-8000-000000000001' and title = '銀行: 妻の楽天銀行で「毎月おまかせ振込予約」を設定(SBIへ定額)');
insert into todos (household_id, title, detail, status, created_at, done_at)
select '00000000-0000-4000-8000-000000000001', '銀行: 夫の楽天銀行のマネーブリッジ設定を確認し防衛資金を移す', '普通預金0.74%。防衛資金の金庫に役割変更', 'open', '2026-08-08 13:41:51', null
where not exists (select 1 from todos where household_id = '00000000-0000-4000-8000-000000000001' and title = '銀行: 夫の楽天銀行のマネーブリッジ設定を確認し防衛資金を移す');
insert into todos (household_id, title, detail, status, created_at, done_at)
select '00000000-0000-4000-8000-000000000001', '銀行: あおぞら銀行BANK口座の開設を検討(任意)', '普通預金1.0%(100万まで)。防衛資金の一部の置き場', 'open', '2026-08-08 13:41:51', null
where not exists (select 1 from todos where household_id = '00000000-0000-4000-8000-000000000001' and title = '銀行: あおぞら銀行BANK口座の開設を検討(任意)');
insert into todos (household_id, title, detail, status, created_at, done_at)
select '00000000-0000-4000-8000-000000000001', '確認: あいち大高のローンに給与受取指定の条件がないか', '金利優遇条件の場合、給与受取口座は動かせないため', 'open', '2026-08-08 13:41:51', null
where not exists (select 1 from todos where household_id = '00000000-0000-4000-8000-000000000001' and title = '確認: あいち大高のローンに給与受取指定の条件がないか');

commit;

-- ============================================================
-- 検算: 左が移した件数、右が手元にあった件数。全部そろっていれば成功。
-- ============================================================
select
  (select count(*) from accounts      where household_id = '00000000-0000-4000-8000-000000000001') as 口座,       9 as 元の口座,
  (select count(*) from balances      where household_id = '00000000-0000-4000-8000-000000000001') as 残高,       11 as 元の残高,
  (select count(*) from asset_details where household_id = '00000000-0000-4000-8000-000000000001') as 内訳,       3 as 元の内訳,
  (select count(*) from holdings      where household_id = '00000000-0000-4000-8000-000000000001') as 保有銘柄,   12 as 元の保有銘柄,
  (select count(*) from watchlist     where household_id = '00000000-0000-4000-8000-000000000001') as 監視銘柄,   15 as 元の監視銘柄,
  (select count(*) from watch_history where household_id = '00000000-0000-4000-8000-000000000001') as 株価記録,   15 as 元の株価記録,
  (select count(*) from loan_schedule where household_id = '00000000-0000-4000-8000-000000000001') as ローン予定, 4 as 元のローン予定,
  (select count(*) from salary_table  where household_id = '00000000-0000-4000-8000-000000000001') as 俸給表,     44 as 元の俸給表,
  (select count(*) from todos         where household_id = '00000000-0000-4000-8000-000000000001') as やること,   19 as 元のやること;
