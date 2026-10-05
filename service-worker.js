const CACHE_NAME = "ai-news-v1";
const APP_SHELL = [
  "",
  "index.html",
  "styles.css",
  "app.js",
  "app-config.js",
  "manifest.webmanifest",
  "icon.svg",
  "news.json",
].map((path) => new URL(path, self.registration.scope).href);

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) =>
      Promise.all(
        cacheNames
          .filter((cacheName) => cacheName.startsWith("ai-news-") && cacheName !== CACHE_NAME)
          .map((cacheName) => caches.delete(cacheName)),
      ),
    ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;

  if (url.pathname.endsWith("/api/news") || url.pathname.endsWith("/news.json")) {
    event.respondWith(fetchNews(request));
    return;
  }

  event.respondWith(fetchAppResource(request));
});

async function fetchNews(request) {
  let response;
  try {
    response = await fetch(request);
  } catch (error) {
    const cached = await caches.match(request);
    if (cached) {
      const headers = new Headers(cached.headers);
      headers.set("X-AI-News-Offline", "true");
      return new Response(await cached.arrayBuffer(), {
        status: cached.status,
        statusText: cached.statusText,
        headers,
      });
    }
    return Response.json(
      { error: "オフラインです。インターネット接続後に再度お試しください。" },
      { status: 503 },
    );
  }

  if (!response.ok) {
    const cached = await caches.match(request);
    if (cached) return cached;
    return response;
  }

  const cache = await caches.open(CACHE_NAME);
  await cache.put(request, response.clone());
  const previousNews = (await cache.keys()).filter((key) => {
    const path = new URL(key.url).pathname;
    return key.url !== request.url &&
      (path.endsWith("/api/news") || path.endsWith("/news.json"));
  });
  await Promise.all(previousNews.map((key) => cache.delete(key)));
  return response;
}

async function fetchAppResource(request) {
  try {
    const response = await fetch(request);
    if (response.ok && response.type === "basic") {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    const cached = await caches.match(request);
    if (cached) return cached;
    return new Response("アプリを読み込めません。インターネット接続を確認してください。", {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
}

self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});
