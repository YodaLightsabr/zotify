// Zotify's service worker. Pages always come from the network, so they're never stale. When there's no connection, or
// Zotify can't be reached (Cloudflare's error pages when the server or its tunnel is down, or the 503 proxy.ts sends while
// it starts up), a small "back shortly" page shows instead, and reloads once Zotify answers. It has everything inline, logo
// included, since nothing else is served from the cache. API calls go to the API's own origin and aren't touched.
const CACHE = "zotify-offline-v3";
const OFFLINE_URL = "/offline.html";

// Statuses that mean Zotify itself isn't answering: bad gateway, unavailable, gateway timeout, and Cloudflare's 520 to 530
const unreachable = status => status === 502 || status === 503 || status === 504 || (status >= 520 && status <= 530);

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

    event.respondWith(
        fetch(event.request)
            .then(async response => unreachable(response.status) ? (await caches.match(OFFLINE_URL)) ?? response : response)
            .catch(() => caches.match(OFFLINE_URL))
    );
});
