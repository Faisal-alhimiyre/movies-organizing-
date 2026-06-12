(function () {
  "use strict";

  const SESSION_KEY = "watchlist-session-v1";
  const MIN_CODE_LENGTH = 3;

  function listIdFromCode(code) {
    const trimmed = code.trim();
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

  function listHasData(listId) {
    return Boolean(localStorage.getItem(storageKeys(listId).data));
  }

  function migrateLegacyData(listId) {
    const keys = storageKeys(listId);
    if (localStorage.getItem(keys.data)) return;

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
    const error = validateCode(code);
    if (error) return { ok: false, error };

    const listId = listIdFromCode(code);

    if (options.create) {
      localStorage.setItem(emptyListKey(listId), "1");
    } else {
      localStorage.removeItem(emptyListKey(listId));
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
    MIN_CODE_LENGTH,
    getProfile,
    isAuthenticated,
    listHasData,
    codeHasList,
    signIn,
    signOut,
    isEmptyList,
    clearEmptyListFlag,
    storageKeys,
    migrateLegacyData(listId) {
      migrateLegacyData(listId || getProfile());
    },
  };
})();
