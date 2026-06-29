/* Minimal service worker — offline shell for installable PWA. */
const CACHE = "omn-shell-v137";

const SHELL = [
  "./",
  "./index.html",
  "./gate.html",
  "./manifest.webmanifest",
  "./assets/icons/icon.svg",
  "./assets/icons/icon-maskable.svg",
  "./assets/icons/apple-touch-icon.png",
  "./assets/icons/icon-192.png",
  "./assets/icons/icon-512.png",
  "./assets/og/og-image.svg",
  "./css/styles.css",
  "./css/theme.css",
  "./css/theme-light.css",
  "./css/theme-purple.css",
  "./css/theme-brown.css",
  "./css/theme-pink.css",
  "./css/theme-consistency.css",
  "./css/typography.css",
  "./css/reduced-motion.css",
  "./css/accessibility.css",
  "./css/rtl.css",
  "./css/mobile.css",
  "./css/pull-to-refresh.css",
  "./js/pwa.js",
  "./js/i18n.js",
  "./js/accessibility.js",
  "./js/themes.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

function isMutableAppAsset(pathname) {
  return (
    pathname.includes("/js/") ||
    pathname.includes("/css/") ||
    pathname.endsWith(".html")
  );
}

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.includes("/rest/v1/") || url.pathname.endsWith("config.js")) {
    return;
  }

  if (isMutableAppAsset(url.pathname)) {
    event.respondWith(
      fetch(event.request, { cache: "no-store" }).catch(() =>
        caches.match(event.request).then((cached) => cached || caches.match("./index.html"))
      )
    );
    return;
  }

  event.respondWith(
    fetch(event.request, { cache: "no-store" })
      .then((response) => {
        if (response.ok && response.type === "basic") {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(() => caches.match(event.request).then((cached) => cached || caches.match("./gate.html")))
  );
});
