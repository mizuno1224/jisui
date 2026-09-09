// スーパーの店内で電波が切れても起動できるようにするための Service Worker。
// ライブラリは使わず、必要な3種類のふるまいだけを書いている。
//
//   1. アプリ本体(HTML・JS・CSS)はキャッシュから即返す
//   2. 画面遷移はネットワークを 3 秒だけ待ち、駄目ならキャッシュへ落とす
//   3. Supabase への通信には触らない(同期は store.ts の outbox が受け持つ)

// 画面の作りを変えたら、ここの番号を1つ上げてから本番へ出す。
// このファイルの中身が変わると、ブラウザが新しい Service Worker として入れ直し、
// 古いキャッシュ(activate で削除)ごと画面を作り直す。
// 上げ忘れると、圏外で起動したときだけ古い画面が出る。
// v15: 在庫の区画を3つ(冷蔵/冷凍/常温)から5つ(冷蔵/氷温/野菜/冷凍/常温)に広げた。
//      ここを上げないと、古いキャッシュを持った端末が3タブのままになり、
//      '氷温' や '野菜' の在庫がどのタブにも出ない = 消えたように見える。
// v23: レシピ一覧に絞り込み(いま作れる/10分以内/器具)と並べ替えを足した。
//      上げないと、古い画面のまま「いま作れる」の札が出ない端末が残る。
// v24: 健康タブを足した(下のタブが6つ → 7つ)。ホームを全ジャンルの要約に変えた。
//      上げないと、古いキャッシュを持った端末はタブが6つのままで、
//      /health を開いてもホームが描かれる = 健康の機能が丸ごと無いように見える。
// v25: 記録の目録(/records)を足し、ホームの「ほかの画面」をそこへ寄せた。
//      健康診断(/health/exams)・作った記録・レシートの明細・台所の決めごと・
//      費目の決まりが、初めて画面から見られるようになった。
//      上げないと、古いキャッシュを持った端末はホームに旧い一覧を出したままで、
//      /records を開いてもホームが描かれる = 増えた画面がどこにも無いように見える。
//      あわせて在庫の一覧から【数量0の行を畳んだ】。本番では在庫22点に対して
//      0の行が30点あり、あるものより無いもののほうが多い画面になっていた。
// v26: ホームに「今日の候補」を足した(いま作れる・14日以内に作っていない・短い順)。
//      上げないと、古いキャッシュを持った端末にはこの欄が出ない。
// v27: 押しやすさの手直し。ホームの「今日の予定・今日の献立・今日の候補」を
//      行ごと押せるようにし(高さ48px)、献立からレシピへ直接飛ぶようにした。
//      レシピ一覧に「今日つくる」の絞り込みを足し、分類の札を実データから作るようにした
//      (0件の「麺・丼」「弁当おかず」が出て、4品ある「主食」が出ていなかった)。
// v28: 投資のまとめ(/spending/investments/summary)を足した。
//      方針.md の IPS に書いた線(FANG+15%キャップ・恒常積立・押し目ルール)と、
//      記録した数字を突き合わせる画面。売買はすすめない。
// v29: 投資のまとめに【表】を足した。保有銘柄(銘柄・口座・評価額・損益・比率)と
//      監視銘柄(株価・レンジ位置・利回り・PER・PBR・記録日)。横スクロールする。
// v30: /handoff に「依頼文をコピー」を足した(スキルを積んでいないスマホの
//      チャットでも、貼り込める JSON を返せるようにする文章)。あわせてホームに
//      「作ったか教えてください」(過ぎた日の献立を1タップで片付ける)を足した。
//      上げないと、古いキャッシュを持った端末は前の /handoff とホームのままで、
//      スマホだけで記録する道が【あるのに見えない】。
// v31: 買い物リストに「買い物をおわる」を足した(チェック済みをまとめて片付ける。
//      惣菜や日用品は「入れない」を選べば在庫に入れずに消せる)。あわせて
//      「切らしている常備品」の札を足した(lib/staples.ts)。
//      上げないと、古いキャッシュを持った端末はチェックを片付ける口が
//      ⋮ の中だけのままで、【買った行が残り続け、常備品の札も出ない】。
// v32: 買い物リストに「買い物をおわる」と「切らしている常備品」を足した。
//      在庫は【一覧を横に払うと隣の区画へ移る】ようにし、
//      「1つの袋に何個入っているか」(6Pチーズ=6)を記録できるようにした。
//      レシピは一番上で【普段のごはん / 冷凍弁当】に分かれるようにした。
//      上げないと、古いキャッシュを持った端末はどれも前のままで、
//      増えた道が【あるのに見えない】。
// v33: 在庫の残りを【スライダー】で動かせるようにした(全部の食材で同じ操作)。
//      満タンの数は買ったときの数量から自動で入り、6Pチーズ=6 のように
//      中身が複数のものだけ直せばよい。
//      上げないと、古いキャッシュを持った端末は数量の打ち込みのままになる。
//      あわせて「期限が近いものが N 点」から数量0の行を外した。
//      使い切った食材の期限まで赤で数えていた(実測19点のうち9点)。
const VERSION = "v39";
// v39: 個数を聞く食材を【レシピの書き方から決める】ようにした。
//      なす「3本」ピーマン「4個」は数える。小松菜「1袋」しめじ「1袋」は
//      使い切りなので聞かない。全部に聞くと意味の無い入力を毎回させることになる。
// v38: 「買い物をおわる」で【袋の中身の数】を入れられるようにした。
//      買い物リストの「なす3本」は買う前の見込みで、実際は2本だったりする。
//      買った直後がいちばん正確に数えられる場面なのに、そこで直せなかった。
// v37: 常備品の「あと少し」を台所の画面から押せるようにした。
//      これまで残り具合はチャットからしか直せず、瓶を持っているその場で
//      記録できなかった。気づきが消えて、そのまま切らしていた。
// v36: 在庫の一覧で【調味料・菓子を食材と分けた】。冷蔵の22点のうち15点が
//      調味料になり、今日使う食材がその中に埋もれていた。畳んでおくだけで、
//      開けば今までどおり出る。何が調味料かは名前ではなく食材の正体
//      (foods.kind)で決まるので、商品名から入れても正しく分かれる。
// v35: 【今日の献立からレシピを押しても反応しない】を直した。
//      Service Worker が、控えの無い住所に対してホーム画面を身代わりに返していた。
//      アプリで唯一 APP_SHELL に入れられない /recipes/(番号) だけが該当し、
//      住所は変わるのに中身はホームのまま = 反応しないように見えていた。
// v34: 横に払う操作をアプリ全体に広げた(在庫の区画・レシピの普段/弁当・
//      家計と資産の月・健康の夫/妻)。あわせて名前の突き合わせが
//      「の」を無視するようにした(「桃屋 きざみしょうが」と
//      「桃屋のきざみしょうが」が別物になり、家にあるのに買わせようとしていた)。
const SHELL_CACHE = `jisui-shell-${VERSION}`;
const RUNTIME_CACHE = `jisui-runtime-${VERSION}`;
const NAV_TIMEOUT_MS = 1500;
const DATA_TIMEOUT_MS = 2000;

// タブは7つとも圏外で開けるようにしておく。1つでも欠けると、
// そのタブだけ「/」(ホーム)が出てしまい、壊れたように見える。
// 買い物リストは "/" ではなく "/shopping"。ここを入れ忘れると、
// 圏外で買い物タブを押したとき URL は /shopping のままホームが描画される。
// スーパーの店内という、このアプリの一番大事な場面で起きる事故。
//
// 【addAll は全部そろって初めて成功する】。ここに書いたページを
// まだデプロイしていない状態でこの sw.js を配ると install ごと失敗し、
// 新しい Service Worker が二度と入らなくなる(自分では直らない)。
// ページの追加と sw.js の更新は必ず同じデプロイに乗せること。
const APP_SHELL = [
  "/",
  "/shopping",
  "/login",
  "/plan/todos",
  "/plan/tags",
  "/inventory",
  "/recipes",
  "/recipes/ask",
  "/handoff",
  "/plan",
  "/plan/chores",
  "/spending",
  "/spending/assets",
  "/spending/investments",
  "/spending/investments/summary",
  "/health",
  "/health/checkups",
  "/health/exams",
  "/records",
  "/records/cooking",
  "/records/receipts",
  "/records/kitchen",
  "/records/rules",
  "/help",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k !== SHELL_CACHE && k !== RUNTIME_CACHE)
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(RUNTIME_CACHE);
    cache.put(request, response.clone());
  }
  return response;
}

/*
 * ネットワークを先に試し、駄目なら控えを返す。
 *
 * 【「/」を身代わりに返さないこと】
 * ここは長いあいだ、失敗したときに (キャッシュ) || (「/」) を返していた。
 * その「/」はホーム画面の中身なので、**求められたものと別の物を渡していた。**
 *
 * とくに ?_rsc= の要求(タブ移動でNext.jsが取りにいく部分描画のデータ)で
 * ホーム画面の HTML を返すと、受け取った側は読めずに黙って諦める。
 * 画面には何も起こらない。**「押しても反応しない」がこれ。**
 * 実際に、今日の献立からレシピを押しても何も起きなかった。
 *
 * 控えが無いなら、正直に失敗させる。そのほうが Next.js は
 * 素直にページごと読み込み直しにいくので、結果として先へ進める。
 */
async function networkFirst(request, { timeout } = {}) {
  const cache = await caches.open(RUNTIME_CACHE);
  try {
    const response = await (timeout
      ? Promise.race([
          fetch(request),
          new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), timeout)),
        ])
      : fetch(request));
    if (response && response.ok) cache.put(request, response.clone());
    return response;
  } catch (err) {
    const cached = await caches.match(request);
    if (cached) return cached;
    throw err;
  }
}

/**
 * キャッシュを即返し、裏で最新に入れ替える。起動の体感がこれで決まる。
 *
 * 【「/」に落とすのは、本当に最後だけ】
 * ここも以前は、控えを探すその場で「/」を身代わりにしていた。
 * すると【一度も開いたことのない住所】は、通信を試しもせずに
 * ホーム画面が返っていた。アプリの中で唯一そうなるのが
 * **レシピの詳細(/recipes/123)** で、住所だけ変わって中身はホーム、
 * という状態になる。人からは「押しても反応しない」ように見える。
 * ほかのタブは全部 APP_SHELL に入れてあるので、ここだけが穴だった。
 *
 * 正しい順番はこう:
 *   1. その住所ぴったりの控えがあれば即返す(速さのため)
 *   2. 無ければ通信を待つ
 *   3. 通信も駄目(=圏外)なら、最後の手段としてホームの殻を返す
 */
async function staleWhileRevalidate(request) {
  const cached = await caches.match(request);
  const fetching = fetch(request)
    .then(async (response) => {
      if (response && response.ok) {
        const cache = await caches.open(RUNTIME_CACHE);
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => null);

  if (cached) return cached;
  const fresh = await Promise.race([
    fetching,
    new Promise((resolve) => setTimeout(() => resolve(null), NAV_TIMEOUT_MS)),
  ]);
  return fresh || (await fetching) || (await caches.match("/")) || Response.error();
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // Supabase 等はそのまま通す
  if (url.pathname.startsWith("/auth/")) return; // ログインの往復はキャッシュしない
  /*
   * タブ移動で取りにいく部分描画用のデータ。
   * 以前は素通ししていたため、「電波はあるのに通らない」場所では
   * Next 側にも打ち切りが無く、タブを押しても延々何も起きなかった。
   * 短めに打ち切り、駄目ならキャッシュへ落とす。
   * 5画面とも中身は client 側で決まるので、多少古くても表示は狂わない。
   */
  if (url.searchParams.has("_rsc")) {
    event.respondWith(networkFirst(request, { timeout: DATA_TIMEOUT_MS }));
    return;
  }

  /*
   * 画面遷移。まずキャッシュを返し、裏で取り直す(stale-while-revalidate)。
   * ホーム画面から開くのは毎回この経路なので、待たせると毎回
   * 白い画面から始まることになる。中身は client 側で描き直される。
   */
  if (request.mode === "navigate") {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(cacheFirst(request));
    return;
  }

  event.respondWith(networkFirst(request));
});
