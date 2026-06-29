(function () {
  "use strict";

  const ICON_NOTE_KEY = "omn-ios-icon-note-v3";
  const SW_RELOAD_SESSION_KEY = "omn-sw-update-reload";
  const SW_URL = "./sw.js";

  let bannerEl = null;
  let swRegistration = null;
  let hadServiceWorkerController = Boolean(navigator.serviceWorker?.controller);
  let skipControllerReloadOnce = false;
  let reloadInFlight = false;

  if (sessionStorage.getItem(SW_RELOAD_SESSION_KEY) === "1") {
    sessionStorage.removeItem(SW_RELOAD_SESSION_KEY);
    skipControllerReloadOnce = true;
  }

  try {
    const rescueUrl = new URL(window.location.href);
    if (rescueUrl.searchParams.has("pwa_rescue")) {
      rescueUrl.searchParams.delete("pwa_rescue");
      const next =
        rescueUrl.pathname +
        (rescueUrl.searchParams.toString() ? `?${rescueUrl.searchParams}` : "") +
        rescueUrl.hash;
      window.history.replaceState(null, "", next);
    }
  } catch (_error) {
    /* ignore */
  }

  function isIOS() {
    const ua = navigator.userAgent || "";
    if (/iPad|iPhone|iPod/.test(ua)) return true;
    return navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
  }

  function t(key) {
    return window.WatchlistI18n?.t?.(key) || key;
  }

  function dismissIconNote() {
    try {
      localStorage.setItem(ICON_NOTE_KEY, "1");
    } catch (_error) {
      /* ignore storage failures */
    }
    if (bannerEl) {
      bannerEl.remove();
      bannerEl = null;
    }
  }

  function renderIconNote() {
    if (!bannerEl) return;
    const titleEl = bannerEl.querySelector(".app-banner__title");
    const leadEl = bannerEl.querySelector(".app-banner__text");
    const listEl = bannerEl.querySelector(".app-banner__list");
    const dismissBtn = bannerEl.querySelector("[data-action='dismiss-ios-icon-note']");

    if (titleEl) titleEl.textContent = t("pwa.iconNoteTitle");
    if (leadEl) leadEl.textContent = t("pwa.iconNoteLead");
    if (listEl) {
      listEl.innerHTML = "";
      ["pwa.iconNoteStep1", "pwa.iconNoteStep2", "pwa.iconNoteStep3"].forEach((key) => {
        const item = document.createElement("li");
        item.textContent = t(key);
        listEl.appendChild(item);
      });
    }
    if (dismissBtn) dismissBtn.textContent = t("pwa.iconNoteDismiss");
  }

  function mountIconNote() {
    return;
  }

  function isCloudSavePending() {
    if (window.WatchlistSync?.isSyncing?.()) return true;
    if (window.WatchlistApp?.isCloudSavePending?.()) return true;
    return false;
  }

  async function waitForSafeReload() {
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
      if (!isCloudSavePending()) return;
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }

  async function reloadForServiceWorkerUpdate() {
    if (reloadInFlight) return;
    reloadInFlight = true;
    try {
      await waitForSafeReload();
      sessionStorage.setItem(SW_RELOAD_SESSION_KEY, "1");
      window.location.reload();
    } catch (_error) {
      reloadInFlight = false;
    }
  }

  function bindServiceWorkerUpdates(registration) {
    registration.addEventListener("updatefound", () => {
      const worker = registration.installing;
      if (!worker) return;
      worker.addEventListener("statechange", () => {
        if (worker.state === "installed" && navigator.serviceWorker.controller) {
          worker.postMessage({ type: "SKIP_WAITING" });
        }
      });
    });

    if (registration.waiting && navigator.serviceWorker.controller) {
      registration.waiting.postMessage({ type: "SKIP_WAITING" });
    }
  }

  function checkForServiceWorkerUpdate() {
    const update = swRegistration
      ? swRegistration.update()
      : navigator.serviceWorker.getRegistration().then((registration) => registration?.update());
    Promise.resolve(update).catch(() => {});
  }

  function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) return;

    navigator.serviceWorker
      .register(SW_URL, { updateViaCache: "none" })
      .then((registration) => {
        swRegistration = registration;
        bindServiceWorkerUpdates(registration);
        return registration.update();
      })
      .catch((error) => {
        console.warn("[pwa] service worker registration failed:", error);
      });
  }

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (skipControllerReloadOnce) {
        skipControllerReloadOnce = false;
        return;
      }
      if (!hadServiceWorkerController) {
        hadServiceWorkerController = true;
        return;
      }
      void reloadForServiceWorkerUpdate();
    });

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => {
        registerServiceWorker();
        checkForServiceWorkerUpdate();
      });
    } else {
      registerServiceWorker();
      checkForServiceWorkerUpdate();
    }

    window.addEventListener("load", checkForServiceWorkerUpdate);

    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        checkForServiceWorkerUpdate();
      }
    });

    window.addEventListener("pageshow", (event) => {
      if (event.persisted) {
        checkForServiceWorkerUpdate();
      }
    });

    window.addEventListener("focus", checkForServiceWorkerUpdate);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mountIconNote);
  } else {
    mountIconNote();
  }
})();
