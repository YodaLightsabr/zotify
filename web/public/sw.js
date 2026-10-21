// Zotify's service worker. Pages always come from the network, so they're never stale; when there's no connection,
// a small offline page shows instead of the browser's error. It has everything inline, logo included, since nothing else
// is served from the cache. API calls go to the API's own origin and aren't touched.
const CACHE = "zotify-offline-v2";
const OFFLINE_URL = "/offline.html";

self.addEventListener("install", event => {
    event.waitUntil(caches.open(CACHE).then(cache => cache.add(OFFLINE_URL)));
    self.skipWaiting();
});

self.addEventListener("activate", event => {
    // Drop caches from older versions of this file
    event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))));
    self.clients.claim();
});

self.addEventListener("fetch", event => {
    if (event.request.mode !== "navigate") return;

    event.respondWith(fetch(event.request).catch(() => caches.match(OFFLINE_URL)));
});
