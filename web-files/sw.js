/* Service worker — installable PWA with automatic update on deploy. */
importScripts("./js/build-version.js");

const BUILD_VERSION = self.WATCHLIST_BUILD_VERSION || "0";
const CACHE = `omn-shell-${BUILD_VERSION}`;
const CACHE_PREFIX = "omn-shell-";

/** Offline-safe static assets only — never precache HTML/JS/CSS (versioned at deploy). */
const SHELL = [
  "./manifest.webmanifest",
  "./assets/icons/icon.svg",
  "./assets/icons/icon-maskable.svg",
  "./assets/icons/apple-touch-icon.png",
  "./assets/icons/icon-192.png",
  "./assets/icons/icon-512.png",
  "./assets/og/og-image.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
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
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

function isSupabaseOrConfig(pathname) {
  return pathname.includes("/rest/v1/") || pathname.endsWith("config.js");
}

function isMutableAppAsset(pathname) {
  return (
    pathname.includes("/js/") ||
    pathname.includes("/css/") ||
    pathname.endsWith(".html") ||
    pathname === "/" ||
    pathname.endsWith("/")
  );
}

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  if (isSupabaseOrConfig(url.pathname)) {
    return;
  }

  if (isMutableAppAsset(url.pathname)) {
    event.respondWith(
      fetch(event.request, { cache: "no-store" }).catch(() => {
        if (event.request.mode === "navigate") {
          return caches.match("./index.html");
        }
        return Response.error();
      })
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
      .catch(() => caches.match(event.request))
  );
});
