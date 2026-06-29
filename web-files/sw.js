/* Service worker — PWA shell + legacy rescue navigate (build 139+). */
importScripts("./js/build-version.js");

const BUILD_VERSION = self.WATCHLIST_BUILD_VERSION || "0";
const CACHE = `omn-shell-${BUILD_VERSION}`;
const CACHE_PREFIX = "omn-shell-";
const RESCUE_PARAM = "pwa_rescue";
const RESCUE_VALUE = "139";

/** Offline-safe static assets only — never precache HTML/JS/CSS. */
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
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

function deleteObsoleteShellCaches() {
  return caches.keys().then((keys) =>
    Promise.all(
      keys
        .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE)
        .map((key) => caches.delete(key))
    )
  );
}

function isRescuableAppUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    if (url.origin !== self.location.origin) return false;
    const path = url.pathname;
    if (path.endsWith("index.html") || path.endsWith("gate.html")) return true;
    if (path === "/" || /\/$/.test(path)) return true;
    return false;
  } catch (_error) {
    return false;
  }
}

function alreadyRescuedForBuild(rawUrl) {
  try {
    return new URL(rawUrl).searchParams.get(RESCUE_PARAM) === RESCUE_VALUE;
  } catch (_error) {
    return false;
  }
}

function rescueNavigateUrl(rawUrl) {
  const url = new URL(rawUrl);
  url.searchParams.set(RESCUE_PARAM, RESCUE_VALUE);
  return url.href;
}

async function rescueOpenClients() {
  const clients = await self.clients.matchAll({
    type: "window",
    includeUncontrolled: true,
  });

  await Promise.all(
    clients.map(async (client) => {
      if (!isRescuableAppUrl(client.url)) return;
      if (alreadyRescuedForBuild(client.url)) return;
      if (typeof client.navigate !== "function") return;
      try {
        await client.navigate(rescueNavigateUrl(client.url));
      } catch (_error) {
        /* navigate unsupported or blocked — no page JS fallback */
      }
    })
  );
}

self.addEventListener("activate", (event) => {
  event.waitUntil(
    deleteObsoleteShellCaches()
      .then(() => self.clients.claim())
      .then(() => rescueOpenClients())
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

function isNavigationRequest(request, url) {
  return (
    request.mode === "navigate" ||
    request.destination === "document" ||
    isMutableAppAsset(url.pathname)
  );
}

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  if (isSupabaseOrConfig(url.pathname)) {
    return;
  }

  if (isNavigationRequest(event.request, url)) {
    event.respondWith(
      fetch(event.request, { cache: "no-store" }).catch(() => Response.error())
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
