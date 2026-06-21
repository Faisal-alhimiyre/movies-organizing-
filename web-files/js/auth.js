(function () {
  "use strict";

  const SESSION_KEY = "watchlist-session-v2";
  const LEGACY_SESSION_KEY = "watchlist-session-v1";
  const LEGACY_LIBRARY_KEY = "watchlist-library-v1";
  const LIBRARY_PREFIX = "watchlist-library-v2-";
  const MIN_CODE_LENGTH = 6;

  function readJson(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  }

  function libraryKey(accountId) {
    return `${LIBRARY_PREFIX}${accountId}`;
  }

  function getAccountId() {
    return getSession()?.accountId || null;
  }

  function getLibrary(accountId) {
    const id = accountId || getAccountId();
    if (!id) return [];
    return readJson(libraryKey(id), []);
  }

  function saveLibrary(accountId, entries) {
    if (!accountId) return;
    localStorage.setItem(libraryKey(accountId), JSON.stringify(entries));
  }

  function migrateLegacyLibrary(accountId) {
    const existing = getLibrary(accountId);
    if (existing.length) return;

    const legacy = readJson(LEGACY_LIBRARY_KEY, []);
    const relevant = legacy
      .filter((entry) => entry.listId === accountId || entry.accountId === accountId)
      .map((entry) => ({
        listId: entry.listId,
        accountId,
        name: entry.name || entry.label || "My list",
        description: entry.description || "",
        addedAt: entry.addedAt || Date.now(),
        updatedAt: Date.now(),
      }));

    if (relevant.length) {
      saveLibrary(accountId, relevant);
      return;
    }

    if (listHasData(accountId) || localStorage.getItem(emptyListKey(accountId))) {
      saveLibrary(accountId, [
        {
          listId: accountId,
          accountId,
          name: "My list",
          description: "",
          addedAt: Date.now(),
          updatedAt: Date.now(),
        },
      ]);
    }
  }

  function registerList(listId, meta = {}) {
    const accountId = meta.accountId || getAccountId();
    if (!accountId || !listId) return;

    const library = getLibrary(accountId);
    const index = library.findIndex((entry) => entry.listId === listId);
    const next = {
      listId,
      accountId,
      name: meta.name || meta.label || "My list",
      description: meta.description || "",
      updatedAt: Date.now(),
    };

    if (index >= 0) {
      library[index] = { ...library[index], ...next };
    } else {
      library.push({ ...next, addedAt: Date.now() });
    }

    saveLibrary(accountId, library);
  }

  function getListEntry(listId) {
    const id = listId || getProfile();
    return getLibrary().find((entry) => entry.listId === id) || null;
  }

  function getListLabel(listId) {
    return getListEntry(listId)?.name || "My list";
  }

  function getListDescription(listId) {
    return getListEntry(listId)?.description || "";
  }

  function lastListKey(accountId) {
    return `watchlist-last-list-${accountId}`;
  }

  function defaultListKey(accountId) {
    return `watchlist-default-list-${accountId}`;
  }

  function getDefaultListId(accountId) {
    const id = accountId || getAccountId();
    if (!id) return null;
    const stored = localStorage.getItem(defaultListKey(id));
    if (stored) return stored;
    return localStorage.getItem(lastListKey(id));
  }

  function assignDefaultList(listId) {
    const accountId = getAccountId();
    if (!accountId || !listId) return false;
    if (!getLibrary(accountId).some((entry) => entry.listId === listId)) {
      return false;
    }
    localStorage.setItem(defaultListKey(accountId), listId);
    return true;
  }

  function switchList(listId) {
    const accountId = getAccountId();
    if (!accountId || !listId) return;
    if (!getLibrary(accountId).some((entry) => entry.listId === listId)) return;
    setSession(accountId, listId);
  }

  function writeListData(listId, watchlist, watched) {
    const keys = storageKeys(listId);
    localStorage.setItem(keys.data, JSON.stringify(watchlist));
    localStorage.setItem(keys.watched, JSON.stringify(watched || {}));
    localStorage.removeItem(emptyListKey(listId));
  }

  function emptyWatchlist() {
    return { movies: {}, tvSeries: {}, anime: {} };
  }

  function normalizeCode(code) {
    return String(code).trim().toLowerCase();
  }

  function isLegacyNumericCode(code) {
    const normalized = normalizeCode(code);
    return /^[0-9]{3,}$/.test(normalized);
  }

  function validateCode(code, options = {}) {
    const forCreate = Boolean(options.forCreate);
    const raw = String(code);

    if (/\s/.test(raw)) {
      return "Spaces are not allowed.";
    }

    const normalized = normalizeCode(code);

    if (!forCreate && isLegacyNumericCode(code)) {
      return null;
    }

    if (normalized.length < MIN_CODE_LENGTH) {
      return `Use at least ${MIN_CODE_LENGTH} characters.`;
    }

    if (!/[a-z]/.test(normalized)) {
      return "Use at least one letter.";
    }

    if (!/[0-9]/.test(normalized)) {
      return "Use at least one number.";
    }

    return null;
  }

  function accountIdFromCode(code) {
    const trimmed = normalizeCode(code);
    let hash = 5381;

    for (let i = 0; i < trimmed.length; i++) {
      hash = (hash * 33) ^ trimmed.charCodeAt(i);
    }

    return "l" + (hash >>> 0).toString(36);
  }

  function listIdFromCode(code) {
    return accountIdFromCode(code);
  }

  function generateListId() {
    return `lst_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function migrateLegacySession() {
    try {
      const legacy = sessionStorage.getItem(LEGACY_SESSION_KEY);
      if (!legacy || sessionStorage.getItem(SESSION_KEY)) return;

      const parsed = JSON.parse(legacy);
      if (!parsed?.listId) return;

      const accountId = parsed.accountId || parsed.listId;
      sessionStorage.setItem(
        SESSION_KEY,
        JSON.stringify({
          accountId,
          listId: parsed.listId,
          needsCodeUpgrade: parsed.needsCodeUpgrade,
        })
      );
      sessionStorage.removeItem(LEGACY_SESSION_KEY);
    } catch {
      /* ignore */
    }
  }

  function getSession() {
    migrateLegacySession();
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function setSession(accountId, listId, extras = {}) {
    sessionStorage.setItem(
      SESSION_KEY,
      JSON.stringify({ accountId, listId, ...extras })
    );
  }

  function clearSession() {
    sessionStorage.removeItem(SESSION_KEY);
    sessionStorage.removeItem(LEGACY_SESSION_KEY);
  }

  function isAuthenticated() {
    return Boolean(getSession()?.accountId && getSession()?.listId);
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

  function syncMetaKey(listId) {
    return `watchlist-sync-meta-${listId}`;
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

  function migrateLegacyData(accountId) {
    const primaryListId = accountId;
    const keys = storageKeys(primaryListId);
    if (listHasData(primaryListId)) return;

    const migratedFlag = `watchlist-legacy-migrated-v2-${accountId}`;
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

    const watchedSources = ["watchlist-watched-v1-me", "watchlist-watched-v1"];

    for (const source of watchedSources) {
      const value = localStorage.getItem(source);
      if (!value) continue;
      localStorage.setItem(keys.watched, value);
      break;
    }

    localStorage.setItem(migratedFlag, "1");
  }

  function emptyListKey(listId) {
    return `watchlist-start-empty-${listId}`;
  }

  function needsCodeUpgrade() {
    return Boolean(getSession()?.needsCodeUpgrade);
  }

  function ensureDefaultList(accountId) {
    migrateLegacyLibrary(accountId);
    const library = getLibrary(accountId);

    if (library.length) {
      return library[0].listId;
    }

    const listId = accountId;
    registerList(listId, { accountId, name: "My list", description: "" });
    return listId;
  }

  function signIn(code, options = {}) {
    const error = validateCode(code, { forCreate: Boolean(options.create) });
    if (error) return { ok: false, error };

    const normalized = normalizeCode(code);
    const accountId = accountIdFromCode(normalized);
    migrateLegacyData(accountId);
    migrateLegacyLibrary(accountId);

    if (options.create) {
      const listId = accountId;
      registerList(listId, {
        accountId,
        name: options.listName || "My list",
        description: options.description || "",
      });
      localStorage.setItem(emptyListKey(listId), "1");
      localStorage.setItem(defaultListKey(accountId), listId);
      setSession(accountId, listId);
      return { ok: true, accountId, listId };
    }

    clearEmptySavedWatchlist(accountId);
    const listId = ensureDefaultList(accountId);
    const library = getLibrary(accountId);
    const defaultListId = getDefaultListId(accountId);
    const activeListId =
      (defaultListId && library.some((entry) => entry.listId === defaultListId)
        ? defaultListId
        : null) ||
      library[0]?.listId ||
      listId;
    const needsUpgrade = isLegacyNumericCode(code);

    setSession(accountId, activeListId, needsUpgrade ? { needsCodeUpgrade: true } : {});

    return { ok: true, accountId, listId: activeListId };
  }

  function validateListName(name) {
    const trimmed = String(name || "").trim();
    if (!trimmed) return "Give your list a name.";
    if (trimmed.length > 48) return "Keep the name under 48 characters.";
    return null;
  }

  function createList(name, description) {
    const accountId = getAccountId();
    if (!accountId) return { ok: false, error: "Not signed in." };

    const nameError = validateListName(name);
    if (nameError) return { ok: false, error: nameError };

    const listId = generateListId();
    const trimmedDescription = String(description || "").trim().slice(0, 120);

    registerList(listId, {
      accountId,
      name: String(name).trim(),
      description: trimmedDescription,
    });

    writeListData(listId, emptyWatchlist(), {});
    localStorage.setItem(emptyListKey(listId), "1");
    setSession(accountId, listId);

    return { ok: true, accountId, listId };
  }

  function updateList(listId, name, description) {
    const accountId = getAccountId();
    if (!accountId || !listId) return { ok: false, error: "Not signed in." };

    const nameError = validateListName(name);
    if (nameError) return { ok: false, error: nameError };

    const library = getLibrary(accountId);
    const index = library.findIndex((entry) => entry.listId === listId);
    if (index < 0) return { ok: false, error: "List not found." };

    library[index] = {
      ...library[index],
      name: String(name).trim(),
      description: String(description || "").trim().slice(0, 120),
      updatedAt: Date.now(),
    };
    saveLibrary(accountId, library);

    return { ok: true, accountId, listId };
  }

  function prepareChangeCode(newCode) {
    const error = validateCode(newCode, { forCreate: true });
    if (error) return { ok: false, error };

    const oldAccountId = getAccountId();
    if (!oldAccountId) {
      return { ok: false, error: "Not signed in." };
    }

    const newAccountId = accountIdFromCode(normalizeCode(newCode));
    if (newAccountId === oldAccountId) {
      return { ok: false, error: "Choose a different code." };
    }

    return { ok: true, oldAccountId, newAccountId };
  }

  function migrateLocalAccount(oldAccountId, newAccountId) {
    const library = getLibrary(oldAccountId).map((entry) => ({
      ...entry,
      accountId: newAccountId,
      updatedAt: Date.now(),
    }));

    saveLibrary(newAccountId, library);
    localStorage.removeItem(libraryKey(oldAccountId));

    const defaultId = localStorage.getItem(defaultListKey(oldAccountId));
    if (defaultId) {
      localStorage.setItem(defaultListKey(newAccountId), defaultId);
      localStorage.removeItem(defaultListKey(oldAccountId));
    }

    const currentListId = getProfile();
    setSession(newAccountId, currentListId);
  }

  function isEmptyList(listId) {
    return Boolean(localStorage.getItem(emptyListKey(listId || getProfile())));
  }

  function clearEmptyListFlag(listId) {
    localStorage.removeItem(emptyListKey(listId || getProfile()));
  }

  function getListTitleCount(listId) {
    const data = readSavedWatchlist(listId);
    if (!data) return 0;

    let count = 0;
    for (const genres of Object.values(data)) {
      if (!genres || typeof genres !== "object") continue;
      for (const titles of Object.values(genres)) {
        if (Array.isArray(titles)) count += titles.length;
      }
    }

    return count;
  }

  async function accountExists(code) {
    const accountId = accountIdFromCode(code);
    const library = getLibrary(accountId);

    if (library.length) return true;
    if (listHasData(accountId)) return true;
    if (localStorage.getItem(emptyListKey(accountId))) return true;

    if (window.WatchlistSync?.isConfigured()) {
      return window.WatchlistSync.accountExists(accountId);
    }

    return false;
  }

  function discoverListIds() {
    const accountId = getAccountId();
    if (!accountId) return [];

    return getLibrary(accountId).map((entry) => entry.listId);
  }

  function purgeList(listId) {
    if (!listId) return;

    const keys = storageKeys(listId);
    for (const key of ["data", "watched", "legacy"]) {
      localStorage.removeItem(keys[key]);
    }
    localStorage.removeItem(syncMetaKey(listId));
    localStorage.removeItem(emptyListKey(listId));

    const accountId = getAccountId();
    if (!accountId) return;

    const wasDefault = getDefaultListId(accountId) === listId;
    const library = getLibrary(accountId).filter((entry) => entry.listId !== listId);
    saveLibrary(accountId, library);

    if (wasDefault) {
      if (library.length > 0) {
        localStorage.setItem(defaultListKey(accountId), library[0].listId);
      } else {
        localStorage.removeItem(defaultListKey(accountId));
      }
    }
  }

  function purgeAccount(accountId) {
    if (!accountId) return;

    const library = getLibrary(accountId);
    for (const entry of library) {
      const keys = storageKeys(entry.listId);
      for (const key of ["data", "watched", "legacy"]) {
        localStorage.removeItem(keys[key]);
      }
      localStorage.removeItem(syncMetaKey(entry.listId));
      localStorage.removeItem(emptyListKey(entry.listId));
    }

    localStorage.removeItem(libraryKey(accountId));
    localStorage.removeItem(lastListKey(accountId));
    localStorage.removeItem(defaultListKey(accountId));
  }

  function signOut(options = {}) {
    clearSession();
    window.location.href = options.deleted ? "gate.html?deleted=1" : "gate.html";
  }

  function codeHasList(code) {
    return listHasData(accountIdFromCode(code));
  }

  window.WatchlistAuth = {
    MIN_CODE_LENGTH,
    getAccountId,
    getProfile,
    isAuthenticated,
    listHasData,
    codeHasList,
    accountExists,
    signIn,
    signOut,
    createList,
    updateList,
    validateListName,
    isEmptyList,
    isWatchlistEmpty,
    clearEmptyListFlag,
    storageKeys,
    accountIdFromCode,
    listIdFromCode,
    prepareChangeCode,
    migrateLocalAccount,
    migrateLocalList: migrateLocalAccount,
    validateCode,
    needsCodeUpgrade,
    isLegacyNumericCode,
    getLibrary,
    registerList,
    getListLabel,
    getListDescription,
    getListEntry,
    getListTitleCount,
    switchList,
    getDefaultListId,
    assignDefaultList,
    writeListData,
    purgeList,
    purgeAccount,
    discoverListIds,
    migrateLegacyData(accountId) {
      migrateLegacyData(accountId || getAccountId());
    },
  };
})();
