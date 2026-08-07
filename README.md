# jisui — 買い物リスト(フェーズ1)

設計書.md のフェーズ1。スーパーでのチェックが確実に記録されるところまで。

- 買い物リスト画面(売り場順・行全体タップ・残り件数・セール枠は別扱い)
- オフライン優先。チェックはまず手元(IndexedDB)に書き、通信は後追いで流す
- 夫婦2人のリアルタイム同期(Supabase Realtime)
- PWA。ホーム画面から起動できる

在庫・レシート・家計簿(フェーズ2以降)はまだ入っていない。DBのスキーマだけは
先に入れておける(下記のSQL 4本)。

---

## 1. すぐ動かす(Supabaseなし)

```bash
npm install
npm run dev
```

http://localhost:3000 を開く。環境変数が無いときは **ローカルモード** になり、
seed.sql と同じ6件をこの端末の中だけで扱う。画面の作りを試すのはこれで足りる。

## 2. Supabase につなぐ

### 2-1. SQL を実行する

Supabase の SQL Editor に、この順で貼って実行する。

| 順 | ファイル | 中身 |
|---|---|---|
| 1 | `schema.sql` | テーブル・RLS・リアルタイム設定 |
| 2 | `seed.sql` | 既存データ(器具11・常備品32・在庫18・レシピ6 ほか) |
| 3 | `patch_members.sql` | 相手の表示名が読めるようにする(任意。下記) |
| 4 | `schema_kakeibo.sql` | 家計簿(支出)のテーブル。使うのはフェーズ3 |
| 5 | `seed_kakeibo.sql` | 取引155件・分類辞書67件 |

`patch_members.sql` は任意。素の `schema.sql` では `household_members` の
SELECT ポリシーが自分の行しか返さないため、「誰がチェックしたか」の欄が
相手のときに `パートナー` の固定表示になる。実名を出したい場合だけ当てる。

### 2-2. ユーザーを2人作って世帯に入れる

Authentication → Users で2人分を作る(または一度ログインして自動作成させる)。
そのうえで SQL Editor から:

```sql
insert into household_members (household_id, user_id, display_name) values
  ('00000000-0000-4000-8000-000000000001', '<夫のuser_id>', '夫'),
  ('00000000-0000-4000-8000-000000000001', '<妻のuser_id>', '妻');
```

世帯 id は `seed.sql` が作る固定値。**ここを入れないと RLS で1件も見えない。**

### 2-3. メールログインの設定

Authentication → URL Configuration で Redirect URLs に追加する:

- `http://localhost:3000/auth/callback`
- `https://<本番のドメイン>/auth/callback`

### 2-4. 環境変数

```bash
cp .env.local.example .env.local
# NEXT_PUBLIC_SUPABASE_URL と NEXT_PUBLIC_SUPABASE_ANON_KEY を埋める
```

anon key は公開前提。守りは RLS で行う(設計書 7)。

## 3. Vercel へ出す

```bash
git init && git add -A && git commit -m "jisui phase 1"
# GitHub に push → Vercel で Import
```

Vercel の Environment Variables に上の2つを登録する。`jisui.db` や生成HTMLは
一つ上の `jisui\` にあるので、リポジトリには入らない。

## 4. スマホのホーム画面に追加

本番URLを開いて「ホーム画面に追加」。iOS は Safari から行う必要がある。
追加後はアドレスバーなしの全画面で立ち上がる。

---

## オフラインの確かめ方

Service Worker は本番ビルドのときだけ登録される(開発中は HMR とぶつかるため)。

```bash
npm run build && npm start
```

DevTools → Application → Service Workers で Offline にチェック → リロード。
アプリが起動し、チェックが効き、ヘッダーに「オフライン」「未送信 n」が出れば正しい。
オンラインに戻すと自動で送信され、バッジが消える。

## 決めごと(実装の理由)

**チェックは待たない。** タップした瞬間に IndexedDB へ書いて画面を更新し、
送信用の操作を outbox に積む。オンラインになった時点で積んだ順に流す
(`lib/store.ts`)。スーパーの地下で電波が切れても、操作は消えない。

**競合は「チェック済みが勝つ」。** 二重購入を防ぐのが最優先なので、
チェックは無条件で通す。逆に、チェックを外す操作は「自分がタップした後に
相手がチェックしていたら通さない」(`.lte("checked_at", op.at)`)。
外したいときはもう一度タップすればよい。

**セール枠は残り件数に含めない。** 「安ければ買う」候補であって、
買えなくても買い物は終わるため。黄色の別セクションで最後に出す。

**行全体がタップ領域(高さ64px)。** 片手で、あまり見ずに押せることを優先した。
もう一度タップで戻せる。長押しで削除。

## ファイルの見取り図

```
app/                 画面(/ = 買い物リスト、/login、/auth/callback)
components/          画面部品
lib/store.ts         状態と同期の中心。ここを読めば挙動が分かる
lib/local-db.ts      IndexedDB(items / outbox / meta)
lib/supabase/        クライアント。環境変数が無ければ null を返す
public/sw.js         Service Worker(手書き。ライブラリなし)
scripts/gen-icons.mjs アイコン生成 → npm run gen:icons
*.sql                Supabase に流すもの(設計書と同梱)
```

## 次にやること(設計書 フェーズ2以降)

7. 在庫画面(冷蔵/冷凍/常温、+/-、期限警告)
8. チェック済みを在庫へ流し込む導線
10-13. レシート撮影 → Claude API → 在庫と支出へ同時登録
14. Cowork の jisui スキルを Supabase 対応に書き換え
