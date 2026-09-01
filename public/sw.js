const VERSION = "benchly-v2";
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil((async () => {
  const keys = await caches.keys();
  await Promise.all(keys.filter((key) => key.startsWith("benchly-") && key !== VERSION).map((key) => caches.delete(key)));
  await self.clients.claim();
})()));
self.addEventListener("fetch", () => {
  // Map tiles, bench data and third-party imagery deliberately remain network-only in v1.
});
