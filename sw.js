const CACHE_NAME = "decode-scout-v34";
const ASSETS = [
  "./",
  "./index.html",
  "./manifest.json",
  "./css/style.css",
  "./js/app.js",
  "./js/db.js",
  "./js/canvas.js",
  "./js/sync.js",
  "https://cdnjs.cloudflare.com/ajax/libs/qrious/4.0.2/qrious.min.js",
  "https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Outfit:wght@400;500;600;700;800&display=swap",
  "https://raw.githubusercontent.com/acmerobotics/MeepMeep/cd0a88ff91a5fd7fa740d0d95dfea60ba14f656c/src/main/resources/background/season-2025-decode/field-2025-official.png",
  "https://raw.githubusercontent.com/acmerobotics/MeepMeep/cd0a88ff91a5fd7fa740d0d95dfea60ba14f656c/src/main/resources/background/season-2025-decode/field-2025-juice-black.png",
  "https://raw.githubusercontent.com/acmerobotics/MeepMeep/cd0a88ff91a5fd7fa740d0d95dfea60ba14f656c/src/main/resources/background/season-2025-decode/field-2025-juice-light.png",
  "https://img.icons8.com/fluency/192/radar.png",
  "https://img.icons8.com/fluency/512/radar.png"
];

// Install Service Worker and cache all vital PWA assets
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log("[Service Worker] Caching application shell and field assets");
      return cache.addAll(ASSETS);
    }).then(() => self.skipWaiting())
  );
});

// Activate & remove old caches
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            console.log("[Service Worker] Removing old cache:", key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Intercept requests and serve from cache if offline
self.addEventListener("fetch", (event) => {
  // Only cache GET requests
  if (event.request.method !== "GET") return;

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }

      return fetch(event.request)
        .then((networkResponse) => {
          // If valid response, clone and cache it for future offline usage
          if (networkResponse && networkResponse.status === 200 && networkResponse.type === "basic") {
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseToCache);
            });
          }
          return networkResponse;
        })
        .catch(() => {
          // Network fail and not in cache
          console.log("[Service Worker] Fetch failed, resource offline:", event.request.url);
          // Return a standard fallback if desired, or let it fail gracefully
        });
    })
  );
});

// Support programmatic update skips
self.addEventListener("message", (event) => {
  if (event.data && event.data.action === "skipWaiting") {
    self.skipWaiting();
  }
});
