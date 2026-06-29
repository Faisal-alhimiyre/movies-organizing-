/**
 * Single deploy version for PWA cache busting.
 * Bump this when shipping JS/CSS/SW changes; keep index.html ?v= in sync.
 */
(function (global) {
  global.WATCHLIST_BUILD_VERSION = "139";
})(typeof self !== "undefined" ? self : window);
