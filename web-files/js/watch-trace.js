/**
 * Temporary runtime tracing for watched-state UI refresh (GitHub Pages diagnosis).
 * Remove after the refresh pipeline bug is confirmed fixed.
 */
(function () {
  const VERSION = "20250625-watchtrace";

  window.WATCHLIST_WATCH_TRACE_VERSION = VERSION;

  let seq = 0;
  let activeSource = null;
  let lastCardBadge = null;
  let lastDetailBadge = null;

  function snapshot(entry) {
    if (entry === undefined) return undefined;
    if (entry == null) return entry;
    try {
      return JSON.parse(JSON.stringify(entry));
    } catch {
      return String(entry);
    }
  }

  function readCardBadge(itemId) {
    if (!itemId) return { cardFound: false, badgeFound: false, text: null };
    const card = document.querySelector(`.card[data-id="${CSS.escape(itemId)}"]`);
    if (!card) return { cardFound: false, badgeFound: false, text: null };
    const badge = card.querySelector(".card__footer-badge, .card__watch-status");
    return {
      cardFound: true,
      badgeFound: Boolean(badge),
      text: badge?.textContent?.trim() ?? null,
    };
  }

  function readDetailBadge() {
    const root = document.querySelector("#tdScroll .td-my-rating");
    if (!root) return { badgeFound: false, text: null };
    const btn = root.querySelector(
      ".card__footer-badge, .card__watch-status, .td-my-rating__rate-btn"
    );
    return {
      badgeFound: Boolean(btn),
      text: btn?.textContent?.trim() ?? root.textContent?.trim()?.slice(0, 120) ?? null,
    };
  }

  function log(step, data = {}) {
    seq += 1;
    console.info(`[watch-trace:${VERSION}] #${seq} ${step}`, {
      scriptVersion: VERSION,
      traceSource: activeSource,
      ...data,
    });
  }

  function setSource(source) {
    activeSource = source;
    log("action-source", { source });
  }

  function clearSource() {
    activeSource = null;
  }

  function logBadgeUpdate(surface, itemId, before, after, caller) {
    const prev = surface === "card" ? lastCardBadge : lastDetailBadge;
    const record = { seq, itemId, before, after, caller, at: Date.now() };
    const overwrittenByLater = Boolean(
      prev &&
        prev.itemId === itemId &&
        prev.after != null &&
        after != null &&
        prev.after !== after &&
        prev.seq < seq - 1
    );
    log(`badge-${surface}`, {
      itemId,
      before,
      after,
      caller,
      overwrittenByLater,
      previousUpdate: prev,
    });
    if (surface === "card") lastCardBadge = record;
    else lastDetailBadge = record;
  }

  function schedulePostCheck(itemId, label) {
    const runCheck = (phase) => {
      const card = readCardBadge(itemId);
      const detail = readDetailBadge();
      const openId = window.WatchlistTitleDetail?.activeItemId?.();
      const stateEntry = window.WatchlistApp?.getWatchEntry?.(itemId);
      const hasWatchedKey = window.WatchlistApp?.isWatched?.(itemId);
      log(`post-check:${phase}`, {
        label,
        itemId,
        expectedProgress: window.WatchlistApp?.progressState?.(itemId) ?? null,
        stateHasWatchedKey: hasWatchedKey,
        stateEntry: snapshot(hasWatchedKey ? stateEntry : null),
        openDetailItemId: openId ?? null,
        detailItemIdMatches: openId === itemId,
        cardBadge: card,
        detailBadge: detail,
      });
    };

    runCheck("sync");
    queueMicrotask(() => runCheck("microtask"));
    requestAnimationFrame(() => {
      runCheck("raf");
      setTimeout(() => runCheck("timeout-0"), 0);
      setTimeout(() => runCheck("timeout-250"), 250);
    });
  }

  window.WatchlistWatchTrace = {
    version: VERSION,
    log,
    snapshot,
    setSource,
    clearSource,
    readCardBadge,
    readDetailBadge,
    logBadgeUpdate,
    schedulePostCheck,
  };

  log("trace-module-loaded", { href: location.href });
})();
