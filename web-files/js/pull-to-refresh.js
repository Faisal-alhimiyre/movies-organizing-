(function () {
  "use strict";

  const PULL_ARM_DELTA = 28;
  const INDICATOR_THRESHOLD = 64;
  const PULL_THRESHOLD = 108;
  const MAX_PULL = 128;
  const PULL_DAMPING = 0.34;
  const MOBILE_QUERY = "(max-width: 640px), (hover: none) and (pointer: coarse)";

  let indicator = null;
  let spinner = null;
  let message = null;
  let touchStartY = 0;
  let pulling = false;
  let pullArmed = false;
  let pullDistance = 0;
  let bound = false;
  let refreshPromise = null;

  function t(key) {
    return window.WatchlistI18n?.t?.(key) || key;
  }

  function isMobilePtr() {
    return window.matchMedia(MOBILE_QUERY).matches;
  }

  function isScrollAtTop() {
    return (window.scrollY || document.documentElement.scrollTop || 0) <= 0;
  }

  function canStartPull() {
    if (!isMobilePtr()) return false;
    if (!isScrollAtTop()) return false;
    return window.WatchlistApp?.canPullToRefresh?.() === true;
  }

  function ensureIndicator() {
    if (indicator) return;
    indicator = document.getElementById("pullRefreshIndicator");
    if (!indicator) return;
    spinner = indicator.querySelector(".pull-refresh__spinner");
    message = indicator.querySelector(".pull-refresh__message");
  }

  function setIndicatorState({ visible, distance = 0, refreshing = false, error = false }) {
    ensureIndicator();
    if (!indicator) return;

    if (!visible) {
      indicator.hidden = true;
      indicator.classList.remove("pull-refresh--active", "pull-refresh--refreshing", "pull-refresh--error");
      indicator.style.setProperty("--pull-offset", "0px");
      return;
    }

    indicator.hidden = false;
    indicator.classList.toggle("pull-refresh--active", !refreshing && !error);
    indicator.classList.toggle("pull-refresh--refreshing", refreshing);
    indicator.classList.toggle("pull-refresh--error", error);
    indicator.style.setProperty("--pull-offset", `${Math.min(distance, MAX_PULL)}px`);

    if (message) {
      if (error) {
        message.textContent = t("ptr.failed");
      } else if (refreshing) {
        message.textContent = t("ptr.refreshing");
      } else {
        message.textContent = "";
      }
    }
  }

  function showErrorToast() {
    setIndicatorState({ visible: true, refreshing: false, error: true, distance: 40 });
    window.setTimeout(() => {
      if (!window.WatchlistApp?.isPullToRefreshActive?.()) {
        setIndicatorState({ visible: false });
      }
    }, 2400);
  }

  async function runRefresh() {
    if (refreshPromise) return refreshPromise;

    refreshPromise = (async () => {
      setIndicatorState({ visible: true, refreshing: true, distance: 52 });
      const result = await window.WatchlistApp?.pullToRefreshFromCloud?.();
      if (!result?.ok) {
        if (result?.reason === "error" || result?.reason === "empty") {
          showErrorToast();
        } else {
          setIndicatorState({ visible: false });
        }
        return;
      }
      setIndicatorState({ visible: false });
    })().finally(() => {
      refreshPromise = null;
      pulling = false;
      pullDistance = 0;
    });

    return refreshPromise;
  }

  function onTouchStart(event) {
    if (!canStartPull() || refreshPromise || window.WatchlistApp?.isPullToRefreshActive?.()) return;
    if (event.touches.length !== 1) return;
    touchStartY = event.touches[0].clientY;
    pulling = false;
    pullArmed = false;
    pullDistance = 0;
  }

  function onTouchMove(event) {
    if (refreshPromise || window.WatchlistApp?.isPullToRefreshActive?.()) return;
    if (!isScrollAtTop()) {
      pulling = false;
      pullArmed = false;
      pullDistance = 0;
      setIndicatorState({ visible: false });
      return;
    }

    const y = event.touches[0].clientY;
    const delta = y - touchStartY;
    if (delta <= 0) {
      pulling = false;
      pullArmed = false;
      pullDistance = 0;
      setIndicatorState({ visible: false });
      return;
    }

    if (delta < PULL_ARM_DELTA) return;

    if (!canStartPull() && !pullArmed) return;

    pullArmed = true;
    pulling = true;
    pullDistance = Math.min((delta - PULL_ARM_DELTA) * PULL_DAMPING, MAX_PULL);

    if (pullDistance >= INDICATOR_THRESHOLD) {
      setIndicatorState({ visible: true, distance: pullDistance, refreshing: false });
      event.preventDefault();
      return;
    }

    setIndicatorState({ visible: false });
  }

  function onTouchEnd() {
    if (!pullArmed || !pulling || refreshPromise || window.WatchlistApp?.isPullToRefreshActive?.()) {
      pulling = false;
      pullArmed = false;
      pullDistance = 0;
      if (!refreshPromise) setIndicatorState({ visible: false });
      return;
    }

    if (pullDistance >= PULL_THRESHOLD && canStartPull()) {
      void runRefresh();
      return;
    }

    pulling = false;
    pullArmed = false;
    pullDistance = 0;
    setIndicatorState({ visible: false });
  }

  function bind() {
    if (bound) return;
    bound = true;
    document.addEventListener("touchstart", onTouchStart, { passive: true });
    document.addEventListener("touchmove", onTouchMove, { passive: false });
    document.addEventListener("touchend", onTouchEnd, { passive: true });
    document.addEventListener("touchcancel", onTouchEnd, { passive: true });
  }

  function init() {
    ensureIndicator();
    bind();
  }

  window.WatchlistPullRefresh = { init };
})();
