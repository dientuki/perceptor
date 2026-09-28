const CACHE_NAME = "perceptor-offline-v1";

let hasRefreshedOfflineCache = false;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.add("/offline"))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate") {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (!hasRefreshedOfflineCache) {
          hasRefreshedOfflineCache = true;
          caches.open(CACHE_NAME).then((cache) => cache.add("/offline"));
        }
        return response;
      })
      .catch(() => caches.match("/offline")),
  );
});
