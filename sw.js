// Kelder PWA service worker.
// Cache-versie: verhoog dit nummer bij elke update; oude caches worden
// automatisch opgeruimd. Je kelder-data staat in localStorage en wordt
// hierdoor NOOIT geraakt.
const CACHE = "kelder-v32";
const ASSETS = ["/", "/index.html", "/app.js", "/manifest.json", "/icon-192.png", "/icon-512.png", "/icon-180.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  // API-aanroepen altijd naar het netwerk
  if (url.pathname.startsWith("/api/")) return;
  if (e.request.method !== "GET") return;
  // Netwerk eerst (zodat updates meteen binnenkomen), cache als vangnet offline
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request).then((m) => m || caches.match("/index.html")))
  );
});
