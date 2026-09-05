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
const VERSION = "v26";
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
    const cached = (await caches.match(request)) || (await caches.match("/"));
    if (cached) return cached;
    throw err;
  }
}

/** キャッシュを即返し、裏で最新に入れ替える。起動の体感がこれで決まる。 */
async function staleWhileRevalidate(request) {
  const cached = (await caches.match(request)) || (await caches.match("/"));
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
  return fresh || (await fetching) || Response.error();
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
