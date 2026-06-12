(function () {
  "use strict";

  const SESSION_KEY = "watchlist-session-v1";
  const MIN_CODE_LENGTH = 3;
  const CATALOG_CODE = "1234";

  function normalizeCode(code) {
    const lower = code.trim().toLowerCase();
    if (lower === CATALOG_CODE || lower === "watchlist") return CATALOG_CODE;
    return code.trim();
  }

  function isCatalogCode(code) {
    return normalizeCode(code) === CATALOG_CODE;
  }

  function listIdFromCode(code) {
    const trimmed = normalizeCode(code);
    let hash = 5381;

    for (let i = 0; i < trimmed.length; i++) {
      hash = (hash * 33) ^ trimmed.charCodeAt(i);
    }

    return "l" + (hash >>> 0).toString(36);
  }

  function getSession() {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function setSession(listId) {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ listId }));
  }

  function clearSession() {
    sessionStorage.removeItem(SESSION_KEY);
  }

  function isAuthenticated() {
    return Boolean(getSession()?.listId);
  }

  function getProfile() {
    return getSession()?.listId || null;
  }

  function storageKeys(listId) {
    const id = listId || getProfile();
    return {
      data: `watchlist-data-v2-${id}`,
      watched: `watchlist-watched-v1-${id}`,
      legacy: `watchlist-data-v1-${id}`,
    };
  }

  function isWatchlistEmpty(data) {
    if (!data || typeof data !== "object") return true;

    for (const genres of Object.values(data)) {
      if (!genres || typeof genres !== "object") continue;
      for (const titles of Object.values(genres)) {
        if (Array.isArray(titles) && titles.length > 0) return false;
      }
    }

    return true;
  }

  function readSavedWatchlist(listId) {
    const raw = localStorage.getItem(storageKeys(listId).data);
    if (!raw) return null;

    try {
      const data = JSON.parse(raw);
      return isWatchlistEmpty(data) ? null : data;
    } catch {
      return null;
    }
  }

  function listHasData(listId) {
    return Boolean(readSavedWatchlist(listId));
  }

  function clearEmptySavedWatchlist(listId) {
    const keys = storageKeys(listId);
    const raw = localStorage.getItem(keys.data);
    if (!raw) return;

    try {
      if (isWatchlistEmpty(JSON.parse(raw))) {
        localStorage.removeItem(keys.data);
      }
    } catch {
      localStorage.removeItem(keys.data);
    }
  }

  function migrateLegacyData(listId) {
    const keys = storageKeys(listId);
    if (listHasData(listId)) return;

    const migratedFlag = "watchlist-legacy-migrated-v1";
    if (localStorage.getItem(migratedFlag)) return;

    const dataSources = [
      "watchlist-data-v2-me",
      "watchlist-data-v2",
      "watchlist-data-v1-me",
      "watchlist-data-v1",
    ];

    let migrated = false;

    for (const source of dataSources) {
      const value = localStorage.getItem(source);
      if (!value) continue;
      localStorage.setItem(keys.data, value);
      if (source.startsWith("watchlist-data-v1")) {
        localStorage.setItem(keys.legacy, value);
      }
      migrated = true;
      break;
    }

    if (!migrated) return;

    const watchedSources = [
      "watchlist-watched-v1-me",
      "watchlist-watched-v1",
    ];

    for (const source of watchedSources) {
      const value = localStorage.getItem(source);
      if (!value) continue;
      localStorage.setItem(keys.watched, value);
      break;
    }

    localStorage.setItem(migratedFlag, "1");
  }

  function validateCode(code) {
    const trimmed = code.trim();
    if (trimmed.length < MIN_CODE_LENGTH) {
      return `Use at least ${MIN_CODE_LENGTH} characters.`;
    }
    return null;
  }

  function emptyListKey(listId) {
    return `watchlist-start-empty-${listId}`;
  }

  function signIn(code, options = {}) {
    const normalized = normalizeCode(code);
    const error = validateCode(normalized);
    if (error) return { ok: false, error };

    if (options.create && isCatalogCode(normalized)) {
      return {
        ok: false,
        error: "That code is already in use. Use Open list instead.",
      };
    }

    const listId = listIdFromCode(normalized);

    if (options.create) {
      localStorage.setItem(emptyListKey(listId), "1");
    } else {
      localStorage.removeItem(emptyListKey(listId));
      clearEmptySavedWatchlist(listId);
    }

    if (isCatalogCode(normalized)) {
      localStorage.removeItem(emptyListKey(listId));
      clearEmptySavedWatchlist(listId);
    }

    migrateLegacyData(listId);
    setSession(listId);
    return { ok: true, listId };
  }

  function isEmptyList(listId) {
    return Boolean(localStorage.getItem(emptyListKey(listId || getProfile())));
  }

  function clearEmptyListFlag(listId) {
    localStorage.removeItem(emptyListKey(listId || getProfile()));
  }

  function signOut() {
    clearSession();
    window.location.href = "gate.html";
  }

  function codeHasList(code) {
    return listHasData(listIdFromCode(code));
  }

  window.WatchlistAuth = {
    CATALOG_CODE,
    MIN_CODE_LENGTH,
    getProfile,
    isAuthenticated,
    listHasData,
    codeHasList,
    signIn,
    signOut,
    isEmptyList,
    isWatchlistEmpty,
    clearEmptyListFlag,
    storageKeys,
    migrateLegacyData(listId) {
      migrateLegacyData(listId || getProfile());
    },
  };
})();
