/* Toolkit — lock-screen / heads-up notifications (Android Chrome needs this SW). */
self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

function showQueueNote(data) {
  const title = (data && data.title) || "ChatGPT queue";
  const body = (data && (data.body || data.message)) || "";
  return self.registration.showNotification(title, {
    body,
    tag: "chatgpt-queue",
    renotify: true,
    silent: false,
    vibrate: [240, 120, 240, 120, 480],
    requireInteraction: true,
    data: data || {},
  });
}

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (_) {
    data = { title: "ChatGPT queue", body: event.data ? event.data.text() : "" };
  }
  event.waitUntil(showQueueNote(data));
});

self.addEventListener("message", (event) => {
  const msg = event.data || {};
  if (msg.type === "SHOW") {
    event.waitUntil(showQueueNote(msg));
  }
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      for (const client of windows) {
        if ("focus" in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow("/");
      return undefined;
    }),
  );
});
