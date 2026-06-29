(function () {
  "use strict";

  const ICON_NOTE_KEY = "omn-ios-icon-note-v3";
  let bannerEl = null;

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
    // Extension/icon reinstall reminder has been removed — always no-op.
    return;

    const main = document.getElementById("mainContent");
    if (!main?.parentElement) return;

    bannerEl = document.createElement("div");
    bannerEl.className = "app-banner app-banner--pwa-icon";
    bannerEl.setAttribute("role", "region");
    bannerEl.setAttribute("aria-labelledby", "iosIconNoteTitle");
    bannerEl.innerHTML = `
      <div class="app-banner__body">
        <h2 class="app-banner__title" id="iosIconNoteTitle"></h2>
        <p class="app-banner__text"></p>
        <ol class="app-banner__list"></ol>
      </div>
      <div class="app-banner__actions">
        <button type="button" class="btn btn--primary btn--sm" data-action="dismiss-ios-icon-note"></button>
      </div>
    `;

    bannerEl.addEventListener("click", (event) => {
      if (event.target.closest("[data-action='dismiss-ios-icon-note']")) {
        dismissIconNote();
      }
    });

    main.parentElement.insertBefore(bannerEl, main);

    renderIconNote();
    window.WatchlistI18n?.onChange?.(() => renderIconNote());
  }

  let swReloading = false;
  let hadServiceWorkerController = Boolean(navigator.serviceWorker.controller);

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
    navigator.serviceWorker.getRegistration().then((registration) => {
      registration?.update().catch(() => {});
    });
  }

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (!hadServiceWorkerController) {
        hadServiceWorkerController = true;
        return;
      }
      if (swReloading) return;
      swReloading = true;
      window.location.reload();
    });

    window.addEventListener("load", () => {
      navigator.serviceWorker
        .register("./sw.js?v=134", { updateViaCache: "none" })
        .then((registration) => {
          bindServiceWorkerUpdates(registration);
          return registration.update();
        })
        .catch((error) => {
          console.warn("[pwa] service worker registration failed:", error);
        });
    });

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
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mountIconNote);
  } else {
    mountIconNote();
  }
})();
