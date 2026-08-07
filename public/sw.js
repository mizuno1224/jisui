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
const VERSION = "v4";
const SHELL_CACHE = `jisui-shell-${VERSION}`;
const RUNTIME_CACHE = `jisui-runtime-${VERSION}`;
const NAV_TIMEOUT_MS = 3000;

// タブは5つとも圏外で開けるようにしておく。1つでも欠けると、
// そのタブだけ「/」(買い物リスト)が出てしまい、壊れたように見える。
const APP_SHELL = [
  "/",
  "/inventory",
  "/recipes",
  "/plan",
  "/plan/chores",
  "/spending",
  "/spending/assets",
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

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // Supabase 等はそのまま通す
  if (url.pathname.startsWith("/auth/")) return; // ログインの往復はキャッシュしない
  if (url.searchParams.has("_rsc")) return; // 部分遷移用のデータは古いものを返さない

  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request, { timeout: NAV_TIMEOUT_MS }));
    return;
  }

  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(cacheFirst(request));
    return;
  }

  event.respondWith(networkFirst(request));
});
