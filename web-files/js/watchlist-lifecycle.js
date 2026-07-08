(function () {
  "use strict";

  const PHASE = {
    loading_local: "loading_local",
    loading_cloud: "loading_cloud",
    showing_cache: "showing_cache",
    cloud_retrying: "cloud_retrying",
    synced: "synced",
    restore_failed: "restore_failed",
  };

  const state = {
    phase: PHASE.loading_local,
    localInitComplete: false,
    cloudInitComplete: false,
    cachedItemCount: 0,
    cloudItemCount: null,
    localItemCount: 0,
    restoreBanner: false,
    lastError: "",
    cloudRestoreAttempt: 0,
  };

  function dispatch() {
    window.dispatchEvent(
      new CustomEvent("watchlist-lifecycle", {
        detail: { ...state, PHASE },
      })
    );
  }

  function setPhase(phase, extras = {}) {
    state.phase = phase;
    Object.assign(state, extras);
    dispatch();
  }

  function markLocalReady(itemCount = 0) {
    state.localInitComplete = true;
    state.localItemCount = itemCount;
    dispatch();
  }

  function markCloudReady(itemCount = null) {
    state.cloudInitComplete = true;
    if (itemCount != null) state.cloudItemCount = itemCount;
    dispatch();
  }

  function showRestoreBanner(show = true) {
    state.restoreBanner = show;
    dispatch();
  }

  function canWriteCloud() {
    if (!state.localInitComplete) return false;
    if (state.phase === PHASE.loading_local || state.phase === PHASE.loading_cloud) {
      return false;
    }
    return true;
  }

  function shouldBlockEmptyPush(localCount, remoteCount) {
    if (!canWriteCloud()) return true;
    if (localCount > 0) return false;
    if (remoteCount == null) return false;
    return remoteCount > 0;
  }

  function reset() {
    state.phase = PHASE.loading_local;
    state.localInitComplete = false;
    state.cloudInitComplete = false;
    state.cachedItemCount = 0;
    state.cloudItemCount = null;
    state.localItemCount = 0;
    state.restoreBanner = false;
    state.lastError = "";
    state.cloudRestoreAttempt = 0;
    dispatch();
  }

  function getState() {
    return { ...state, PHASE };
  }

  window.WatchlistLifecycle = {
    PHASE,
    setPhase,
    markLocalReady,
    markCloudReady,
    showRestoreBanner,
    canWriteCloud,
    shouldBlockEmptyPush,
    reset,
    getState,
    isLocalInitComplete: () => state.localInitComplete,
    isCloudInitComplete: () => state.cloudInitComplete,
  };
})();
