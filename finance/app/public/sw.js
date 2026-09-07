self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// Chromium needs a fetch handler to treat this as an installable app.
// Pass through so Vite HMR still works.
self.addEventListener("fetch", (event) => {
  event.respondWith(fetch(event.request));
});
