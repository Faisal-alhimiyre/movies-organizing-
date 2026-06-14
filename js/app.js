(function () {
  "use strict";

  const TYPE_META = {
    movies: { label: "Movies", short: "Movie", className: "movies" },
    tvSeries: { label: "TV Series", short: "TV Series", className: "tvSeries" },
    anime: { label: "Anime", short: "Anime", className: "anime" },
  };

  const LEGACY_DATA_KEY = "watchlist-data-v2";
  const LEGACY_WATCHED_KEY = "watchlist-watched-v1";
  const LEGACY_DATA_KEY_V1 = "watchlist-data-v1";

  function storageKeys() {
    return (
      window.WatchlistAuth?.storageKeys() || {
        data: LEGACY_DATA_KEY,
        watched: LEGACY_WATCHED_KEY,
        legacy: LEGACY_DATA_KEY_V1,
      }
    );
  }

  function emptyWatchlist() {
    return { movies: {}, tvSeries: {}, anime: {} };
  }

  const LEGACY_GENRE_MAP = {
    "Crime, Gangster & Serious Thrillers": "Crime",
    "Action & Adventure": "Action",
    "Sports & Racing": "Sports",
    "Dark Comedy & Satire": "Comedy",
    "Mystery & Detective": "Mystery",
    "Crime, Mystery & Psychological Thrillers": "Thriller",
    "Science Fiction, Fantasy & Supernatural": "Science Fiction",
    "Historical & War Drama": "Historical",
    "Drama & Character-Focused": "Drama",
    "Action & Dark Fantasy": "Action",
    "Sports & Competition": "Sports",
    "Science & Adventure": "Adventure",
    "Psychological & Mystery": "Thriller",
  };

  const STANDARD_GENRES = window.STANDARD_GENRES || [];

  const CARD_LAYOUT_KEY = "watchlist-card-layout-v2";
  const CARD_LAYOUTS = ["hover", "poster"];
  const SYNC_META_PREFIX = "watchlist-sync-meta-";

  let pendingImportPayload = null;
  let editingListId = null;

  const state = {
    type: "all",
    selectedGenres: [],
    search: "",
    watchedFilter: "all",
    watched: {},
    data: null,
    items: [],
    editingId: null,
    formSecondary: [],
    formLeads: [],
    cardLayout: "hover",
    hoverCardId: null,
    hoverHideTimer: null,
    hoverShowTimer: null,
    syncStatus: "local",
    addMode: "single",
    ratingItemId: null,
    ratingPickerValue: null,
    ratingPickerChosen: false,
  };

  const els = {
    main: document.getElementById("mainContent"),
    loading: document.getElementById("loading"),
    stats: document.getElementById("stats"),
    search: document.getElementById("searchInput"),
    genre: document.getElementById("genreSelect"),
    genreFilterChips: document.getElementById("genreFilterChips"),
    watchedFilter: document.getElementById("watchedFilter"),
    exportBtn: null,
    importBtn: null,
    manageListsBtn: null,
    manageListsModal: document.getElementById("manageListsModal"),
    manageListsBody: document.getElementById("manageListsBody"),
    createListModal: document.getElementById("createListModal"),
    createListModalTitle: document.getElementById("createListModalTitle"),
    createListForm: document.getElementById("createListForm"),
    createListSubmit: document.getElementById("createListSubmit"),
    createListName: document.getElementById("createListName"),
    createListDescription: document.getElementById("createListDescription"),
    createListError: document.getElementById("createListError"),
    importInput: document.getElementById("importInput"),
    accountMenu: document.getElementById("accountMenu"),
    accountMenuBtn: document.getElementById("accountMenuBtn"),
    accountMenuPanel: document.getElementById("accountMenuPanel"),
    accountMenuSwitchWrap: document.getElementById("accountMenuSwitchWrap"),
    shareModal: document.getElementById("shareModal"),
    changeCodeBtn: null,
    deleteAccountBtn: null,
    changeCodeModal: document.getElementById("changeCodeModal"),
    changeCodeForm: document.getElementById("changeCodeForm"),
    changeCodeNew: document.getElementById("changeCodeNew"),
    changeCodeConfirm: document.getElementById("changeCodeConfirm"),
    changeCodeError: document.getElementById("changeCodeError"),
    listSwitcherWrap: document.getElementById("accountMenuSwitchWrap"),
    listSwitcher: document.getElementById("listSwitcher"),
    importShareModal: document.getElementById("importShareModal"),
    importShareModalText: document.getElementById("importShareModalText"),
    importShareModalHint: document.getElementById("importShareModalHint"),
    importMergeBtn: document.getElementById("importMergeBtn"),
    importReplaceBtn: document.getElementById("importReplaceBtn"),
    layoutToggles: document.getElementById("layoutToggles"),
    linkPreviewPopover: document.getElementById("linkPreviewPopover"),
    linkPreviewPopoverInner: document.getElementById("linkPreviewPopoverInner"),
    app: document.getElementById("app"),
    addBtn: document.getElementById("addBtn"),
    typeTabs: document.querySelectorAll(".type-tab"),
    modal: document.getElementById("itemModal"),
    addModeTabs: document.getElementById("addModeTabs"),
    bulkAddPanel: document.getElementById("bulkAddPanel"),
    bulkPasteInput: document.getElementById("bulkPasteInput"),
    bulkPasteError: document.getElementById("bulkPasteError"),
    copyBulkTemplate: document.getElementById("copyBulkTemplate"),
    bulkAddConfirm: document.getElementById("bulkAddConfirm"),
    ratingModal: document.getElementById("ratingModal"),
    ratingModalTitle: document.getElementById("ratingModalTitle"),
    ratingForm: document.getElementById("ratingForm"),
    ratingPicker: document.getElementById("ratingPicker"),
    ratingValueDisplay: document.getElementById("ratingValueDisplay"),
    ratingNote: document.getElementById("ratingNote"),
    ratingError: document.getElementById("ratingError"),
    form: document.getElementById("itemForm"),
    modalTitle: document.getElementById("modalTitle"),
    deleteBtn: document.getElementById("deleteBtn"),
    formType: document.getElementById("formType"),
    formKind: document.getElementById("formKind"),
    formGenre: document.getElementById("formGenre"),
    formTitle: document.getElementById("formTitle"),
    formLeadInput: document.getElementById("formLeadInput"),
    formLeadAdd: document.getElementById("formLeadAdd"),
    formLeadChips: document.getElementById("formLeadChips"),
    formLink: document.getElementById("formLink"),
    formSummary: document.getElementById("formSummary"),
    formatField: document.getElementById("formatField"),
    formSecondaryAdd: document.getElementById("formSecondaryAdd"),
    formSecondaryChips: document.getElementById("formSecondaryChips"),
  };

  function loadJson(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  }

  function syncMetaKey(listId) {
    return `${SYNC_META_PREFIX}${listId}`;
  }

  function readSyncMeta(listId) {
    return loadJson(syncMetaKey(listId), { localUpdated: 0, syncedAt: 0 });
  }

  function writeSyncMeta(listId, patch) {
    const current = readSyncMeta(listId);
    localStorage.setItem(
      syncMetaKey(listId),
      JSON.stringify({ ...current, ...patch })
    );
  }

  function listSyncMeta() {
    const listId = window.WatchlistAuth?.getProfile();
    return {
      accountId: window.WatchlistAuth?.getAccountId(),
      name: window.WatchlistAuth?.getListLabel(listId),
      description: window.WatchlistAuth?.getListDescription(listId),
    };
  }

  function touchLocalUpdated() {
    const listId = window.WatchlistAuth?.getProfile();
    if (!listId) return;
    writeSyncMeta(listId, { localUpdated: Date.now() });
  }

  function queueCloudSync() {
    const listId = window.WatchlistAuth?.getProfile();
    if (!listId || !window.WatchlistSync?.isConfigured()) return;

    touchLocalUpdated();
    state.syncStatus = "pending";
    updateStats();

    window.WatchlistSync.schedulePush(
      listId,
      () => ({
        watchlist: state.data,
        watched: state.watched,
        meta: listSyncMeta(),
      }),
      (result) => {
        if (result?.ok) {
          writeSyncMeta(listId, { syncedAt: Date.now() });
          state.syncStatus = "saved";
        } else {
          state.syncStatus = "error";
        }
        updateStats();
      }
    );
  }

  async function syncAccountLists() {
    const accountId = window.WatchlistAuth?.getAccountId();
    if (!accountId || !window.WatchlistSync?.isConfigured()) return;

    const remoteLists = await window.WatchlistSync.fetchListsForAccount(accountId);
    for (const row of remoteLists) {
      window.WatchlistAuth.registerList(row.list_id, {
        accountId,
        name: row.name,
        description: row.description,
      });
    }
  }

  async function reconcileWithCloud() {
    const listId = window.WatchlistAuth?.getProfile();
    if (!listId || !window.WatchlistSync?.isConfigured()) return;

    const bundled = window.WATCHLIST
      ? structuredClone(window.WATCHLIST)
      : null;
    const meta = readSyncMeta(listId);
    const remote = await window.WatchlistSync.fetchSnapshot(listId);
    const syncMeta = listSyncMeta();

    if (!remote) {
      if (!window.WatchlistAuth.isWatchlistEmpty(state.data)) {
        const result = await window.WatchlistSync.pushSnapshot(
          listId,
          state.data,
          state.watched,
          syncMeta
        );
        if (result.ok) {
          writeSyncMeta(listId, { syncedAt: Date.now() });
          state.syncStatus = "saved";
        }
      }
      return;
    }

    const remoteUpdated = new Date(remote.updated_at || 0).getTime();
    const localHasData = !window.WatchlistAuth.isWatchlistEmpty(state.data);
    const remoteHasData = !window.WatchlistAuth.isWatchlistEmpty(remote.watchlist);
    const localStamp = Math.max(meta.localUpdated, meta.syncedAt);

    if (
      remoteHasData &&
      (!localHasData || remoteUpdated > localStamp)
    ) {
      state.data = applyBundledGenreCorrections(remote.watchlist, bundled);
      state.watched = remote.watched || {};
      state.items = flattenWatchlist(state.data);
      state.data = itemsToNested(state.items);
      if (remote.name) {
        window.WatchlistAuth.registerList(listId, {
          accountId: window.WatchlistAuth.getAccountId(),
          name: remote.name,
          description: remote.description || "",
        });
      }
      writeSyncMeta(listId, { syncedAt: remoteUpdated, localUpdated: remoteUpdated });
      state.syncStatus = "saved";
      return;
    }

    if (localHasData && (!remoteHasData || localStamp > remoteUpdated)) {
      const result = await window.WatchlistSync.pushSnapshot(
        listId,
        state.data,
        state.watched,
        syncMeta
      );
      if (result.ok) {
        writeSyncMeta(listId, { syncedAt: Date.now() });
        state.syncStatus = "saved";
      }
    }
  }

  function saveWatched() {
    const { watched } = storageKeys();
    localStorage.setItem(watched, JSON.stringify(state.watched));
    queueCloudSync();
  }

  function saveData() {
    const { data } = storageKeys();
    state.data = itemsToNested(state.items);
    localStorage.setItem(data, JSON.stringify(state.data));
    queueCloudSync();
  }

  function normalizeGenre(genre) {
    if (STANDARD_GENRES.includes(genre)) return genre;
    return LEGACY_GENRE_MAP[genre] || "Drama";
  }

  function resolveBulkGenre(genre) {
    const trimmed = String(genre || "").trim();
    if (!trimmed) return null;
    if (STANDARD_GENRES.includes(trimmed)) return trimmed;
    const caseMatch = STANDARD_GENRES.find(
      (g) => g.toLowerCase() === trimmed.toLowerCase()
    );
    if (caseMatch) return caseMatch;
    if (LEGACY_GENRE_MAP[trimmed]) return LEGACY_GENRE_MAP[trimmed];
    return null;
  }

  function parseSummary(entry) {
    return entry.summary || entry.reminder || "";
  }

  function parseLeads(entry) {
    if (Array.isArray(entry.leads) && entry.leads.length) {
      return entry.leads.map((name) => name.trim()).filter(Boolean);
    }
    if (entry.lead) {
      return entry.lead
        .split(/,\s*/)
        .map((name) => name.trim())
        .filter(Boolean);
    }
    return [];
  }

  function normalizeLink(url) {
    const trimmed = (url || "").trim();
    if (!trimmed) return "";

    try {
      const parsed = new URL(
        /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
      );
      if (!["http:", "https:"].includes(parsed.protocol)) return "";
      return parsed.href;
    } catch {
      return "";
    }
  }

  function normalizeSecondaryGenres(primary, secondary) {
    if (!Array.isArray(secondary)) return [];

    const seen = new Set([primary]);
    const result = [];

    for (const genre of secondary) {
      const normalized = normalizeGenre(genre);
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      result.push(normalized);
    }

    return result.sort(
      (a, b) => STANDARD_GENRES.indexOf(a) - STANDARD_GENRES.indexOf(b)
    );
  }

  function remapWatchlistGenres(data) {
    const remapped = { movies: {}, tvSeries: {}, anime: {} };

    for (const [contentType, genres] of Object.entries(data)) {
      for (const [genre, titles] of Object.entries(genres)) {
        const standardGenre = normalizeGenre(genre);
        if (!remapped[contentType][standardGenre]) {
          remapped[contentType][standardGenre] = [];
        }
        remapped[contentType][standardGenre].push(...titles);
      }
    }

    return remapped;
  }

  function migrateWatchedIds(oldWatched, items) {
    const migrated = {};

    for (const item of items) {
      const wasWatched = Object.entries(oldWatched).some(([oldId, value]) => {
        if (!value) return false;
        const parts = oldId.split("::");
        return parts[0] === item.contentType && parts[parts.length - 1] === item.title;
      });
      if (wasWatched) migrated[item.id] = normalizeWatchEntry(value) || {};
    }

    return migrated;
  }

  function itemKey(contentType, title) {
    return `${contentType}::${title}`;
  }

  function mergeLegacyWithBundled(legacy, bundled) {
    const merged = structuredClone(bundled);
    const bundledKeys = new Set(
      flattenWatchlist(bundled).map((i) => itemKey(i.contentType, i.title))
    );

    const legacyItems = flattenWatchlist(remapWatchlistGenres(legacy));
    for (const item of legacyItems) {
      if (bundledKeys.has(itemKey(item.contentType, item.title))) continue;

      if (!merged[item.contentType][item.genre]) {
        merged[item.contentType][item.genre] = [];
      }

      const entry = {
        title: item.title,
        lead: item.lead,
        summary: parseSummary(item),
        kind: normalizeKind(item.kind, item.contentType),
      };
      if (item.altTitle) entry.altTitle = item.altTitle;
      if (item.link) entry.link = item.link;
      const leads = item.leads?.length ? item.leads : parseLeads(item);
      if (leads.length) {
        entry.leads = leads;
        entry.lead = leads.join(", ");
      }
      if (item.secondaryGenres?.length) {
        entry.secondaryGenres = item.secondaryGenres;
      }

      merged[item.contentType][item.genre].push(entry);
    }

    return merged;
  }

  function applyBundledGenreCorrections(data, bundled) {
    if (!bundled) return remapWatchlistGenres(data);

    const bundledByKey = new Map();
    for (const item of flattenWatchlist(bundled)) {
      bundledByKey.set(itemKey(item.contentType, item.title), item);
    }

    const savedItems = flattenWatchlist(remapWatchlistGenres(data));
    const savedByTitle = new Map(
      savedItems.map((i) => [itemKey(i.contentType, i.title), i])
    );

    const items = flattenWatchlist(remapWatchlistGenres(data));
    for (const item of items) {
      const key = itemKey(item.contentType, item.title);
      const saved = savedByTitle.get(key);
      const bundledItem = bundledByKey.get(key);

      if (bundledItem) {
        item.genre = bundledItem.genre;
        if (bundledItem.link) {
          item.link = bundledItem.link;
        }
      }
      if (saved?.secondaryGenres?.length) {
        item.secondaryGenres = normalizeSecondaryGenres(
          item.genre,
          saved.secondaryGenres
        );
      }
    }

    return itemsToNested(items);
  }

  function loadWatchlist() {
    window.WatchlistAuth?.migrateLegacyData();

    const { data, legacy } = storageKeys();
    const useCloud = window.WatchlistSync?.isConfigured();
    const bundled =
      !useCloud && window.WATCHLIST
        ? structuredClone(window.WATCHLIST)
        : null;
    const saved = loadJson(data, null);
    const hasSavedTitles =
      saved && !window.WatchlistAuth?.isWatchlistEmpty(saved);

    if (hasSavedTitles) {
      return applyBundledGenreCorrections(saved, bundled);
    }

    const legacySaved = loadJson(legacy, null);

    if (legacySaved && bundled) {
      const merged = mergeLegacyWithBundled(legacySaved, bundled);
      localStorage.setItem(data, JSON.stringify(merged));
      localStorage.removeItem(legacy);

      const items = flattenWatchlist(merged);
      state.watched = migrateWatchedIds(state.watched, items);
      saveWatched();
      window.WatchlistAuth?.clearEmptyListFlag();
      return merged;
    }

    if (window.WatchlistAuth?.isEmptyList()) {
      return emptyWatchlist();
    }

    if (useCloud) {
      return emptyWatchlist();
    }

    if (bundled) {
      const seeded = applyBundledGenreCorrections(
        structuredClone(bundled),
        bundled
      );
      localStorage.setItem(data, JSON.stringify(seeded));
      window.WatchlistAuth?.clearEmptyListFlag();
      return seeded;
    }

    return emptyWatchlist();
  }

  function loadWatchedState() {
    const { watched } = storageKeys();
    const raw = loadJson(watched, {});
    const normalized = {};

    for (const [id, value] of Object.entries(raw)) {
      const entry = normalizeWatchEntry(value);
      if (entry) normalized[id] = entry;
    }

    return normalized;
  }

  function normalizeWatchEntry(value) {
    if (!value) return null;
    if (value === true) return {};
    if (typeof value !== "object") return {};

    const entry = {};
    const rating = parseWatchRating(value.rating);

    if (rating != null) entry.rating = rating;
    if (value.note) entry.note = String(value.note).trim();

    return entry;
  }

  function isItemWatched(id) {
    return Boolean(state.watched[id]);
  }

  function getWatchEntry(id) {
    return normalizeWatchEntry(state.watched[id]) || {};
  }

  function hasWatchRating(entry) {
    return entry?.rating != null && Number.isFinite(entry.rating);
  }

  function parseWatchRating(raw) {
    const trimmed = String(raw ?? "").trim().replace(",", ".");
    if (!trimmed) return null;

    const num = Number(trimmed);
    if (!Number.isFinite(num) || num < 0 || num > 10) return null;

    return Math.round(num * 100) / 100;
  }

  function formatWatchRating(rating) {
    const num = Number(rating);
    if (!Number.isFinite(num)) return "0";
    if (Number.isInteger(num)) return String(num);
    return num.toFixed(1);
  }

  function clampRatingValue(value) {
    return Math.min(10, Math.max(0, Math.round(Number(value) * 10) / 10));
  }

  function defaultRatingPickerValue() {
    return 8;
  }

  function resetRatingPicker({ chosen = false, rating = null } = {}) {
    state.ratingPickerChosen = chosen;
    state.ratingPickerValue =
      chosen && rating != null && Number.isFinite(Number(rating))
        ? clampRatingValue(rating)
        : null;
    updateRatingPickerDisplay();
  }

  function chooseRatingPickerValue(rating) {
    state.ratingPickerChosen = true;
    state.ratingPickerValue = clampRatingValue(rating);
    updateRatingPickerDisplay();
  }

  function setRatingPickerValue(rating) {
    if (rating == null || !Number.isFinite(Number(rating))) {
      resetRatingPicker();
      return;
    }
    chooseRatingPickerValue(rating);
  }

  function adjustRatingPicker(delta) {
    if (!state.ratingPickerChosen) {
      chooseRatingPickerValue(defaultRatingPickerValue());
    }
    chooseRatingPickerValue(state.ratingPickerValue + Number(delta));
  }

  function updateRatingPickerDisplay() {
    if (!els.ratingValueDisplay) return;

    const chosen = state.ratingPickerChosen;
    const value = state.ratingPickerValue;

    els.ratingPicker?.classList.toggle("rating-picker--idle", !chosen);

    els.ratingValueDisplay.textContent = chosen
      ? formatWatchRating(value)
      : "—";

    els.ratingPicker?.querySelectorAll("[data-rating-star]").forEach((button) => {
      const star = Number(button.dataset.ratingStar);
      const filled = chosen && value != null && star <= Math.floor(value + 0.001);
      button.classList.toggle("rating-picker__star--filled", filled);
      button.setAttribute("aria-pressed", String(filled));
    });
  }

  function getRatingPickerValue() {
    if (!state.ratingPickerChosen || state.ratingPickerValue == null) return null;
    return clampRatingValue(state.ratingPickerValue);
  }

  function setRatingError(message) {
    if (!els.ratingError) return;
    els.ratingError.hidden = !message;
    els.ratingError.textContent = message || "";
    els.ratingError.classList.toggle("backup-modal__hint--error", Boolean(message));
  }

  function openRatingModal(itemId) {
    const item = state.items.find((entry) => entry.id === itemId);
    if (!item || !els.ratingModal) return;

    state.ratingItemId = itemId;
    els.ratingModalTitle.textContent = `Rate “${item.title}”`;
    setRatingError("");

    const existing = getWatchEntry(itemId);
    if (hasWatchRating(existing)) {
      resetRatingPicker({ chosen: true, rating: existing.rating });
    } else {
      resetRatingPicker();
    }
    els.ratingNote.value = existing.note || "";

    els.ratingModal.hidden = false;
    updateBodyScrollLock();
    els.ratingPicker?.querySelector('[data-rating-star="5"]')?.focus();
  }

  function closeRatingModal() {
    if (!els.ratingModal) return;
    els.ratingModal.hidden = true;
    state.ratingItemId = null;
    setRatingError("");
    if (els.ratingForm) els.ratingForm.reset();
    resetRatingPicker();
    updateBodyScrollLock();
  }

  function saveWatchRating({ rating, note }) {
    const id = state.ratingItemId;
    if (!id) return false;

    const parsedRating = parseWatchRating(rating);
    if (parsedRating == null) {
      setRatingError("Tap a star to choose your score first.");
      return false;
    }

    const entry = { rating: parsedRating };
    const trimmedNote = String(note || "").trim();
    if (trimmedNote) entry.note = trimmedNote;

    state.watched[id] = entry;
    saveWatched();
    closeRatingModal();
    render();
    return true;
  }

  function markItemWatchedLater() {
    const id = state.ratingItemId;
    if (!id) return;

    if (!isItemWatched(id)) {
      state.watched[id] = {};
      saveWatched();
    }

    closeRatingModal();
    render();
  }

  function makeId(contentType, genre, title) {
    return `${contentType}::${genre}::${title}`;
  }

  function flattenWatchlist(data) {
    const items = [];

    for (const [contentType, genres] of Object.entries(data)) {
      for (const [genre, titles] of Object.entries(genres)) {
        for (const entry of titles) {
          const { note: _legacyNote, ...entryClean } = entry;
          const primaryGenre = normalizeGenre(genre);
          const leads = parseLeads(entryClean);
          const summary = parseSummary(entryClean);
          items.push({
            ...entryClean,
            contentType,
            genre: primaryGenre,
            kind: normalizeKind(entryClean.kind, contentType),
            summary,
            leads,
            lead: leads.join(", "),
            link: normalizeLink(entryClean.link),
            secondaryGenres: normalizeSecondaryGenres(
              primaryGenre,
              entryClean.secondaryGenres || []
            ),
            id: makeId(contentType, primaryGenre, entryClean.title),
          });
        }
      }
    }

    return items;
  }

  function itemsToNested(items) {
    const data = { movies: {}, tvSeries: {}, anime: {} };

    for (const item of items) {
      if (!data[item.contentType][item.genre]) {
        data[item.contentType][item.genre] = [];
      }

      const leads = item.leads?.length ? item.leads : parseLeads(item);
      const entry = {
        title: item.title,
        lead: leads.join(", "),
        leads,
        summary: item.summary || parseSummary(item),
        kind: normalizeKind(item.kind, item.contentType),
      };

      if (item.altTitle) entry.altTitle = item.altTitle;
      if (item.link) entry.link = item.link;
      if (item.poster) entry.poster = item.poster;
      if (item.imdbRating) entry.imdbRating = item.imdbRating;
      if (item.year) entry.year = item.year;
      if (item.secondaryGenres?.length) {
        entry.secondaryGenres = item.secondaryGenres;
      }

      data[item.contentType][item.genre].push(entry);
    }

    return data;
  }

  function rebuildItems() {
    state.items = flattenWatchlist(state.data);
  }

  function normalizeKind(kind, contentType) {
    if (kind === "franchise") return "film series";
    if (contentType !== "movies") return "series";
    return kind === "film series" ? "film series" : "movie";
  }

  function getTypeBadge(item) {
    if (item.contentType === "anime") {
      return { label: "Anime", className: "anime" };
    }
    if (item.kind === "film series") {
      return { label: "Film series", className: "franchise" };
    }
    if (item.contentType === "tvSeries") {
      return { label: "TV Series", className: "tvSeries" };
    }
    return { label: "Movie", className: "movie" };
  }

  function matchesSearch(item, query) {
    if (!query) return true;
    const haystack = [
      item.title,
      item.altTitle,
      item.lead,
      ...(item.leads || []),
      item.summary,
      item.genre,
      ...(item.secondaryGenres || []),
      TYPE_META[item.contentType]?.label,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return haystack.includes(query);
  }

  function itemGenres(item) {
    return [item.genre, ...(item.secondaryGenres || [])];
  }

  function itemHasGenre(item, genre) {
    return itemGenres(item).includes(genre);
  }

  function itemMatchesAllSelectedGenres(item) {
    if (!state.selectedGenres.length) return false;
    return state.selectedGenres.every((genre) => itemHasGenre(item, genre));
  }

  function itemMatchesGenreFilter(item) {
    if (!state.selectedGenres.length) return true;
    return state.selectedGenres.some((genre) => itemHasGenre(item, genre));
  }

  function getFilterDisplayGenre(item) {
    const selected = state.selectedGenres;
    if (!selected.length) return item.genre;

    const matching = selected.filter((genre) => itemHasGenre(item, genre));
    if (!matching.length) return item.genre;

    if (matching.includes(item.genre)) return item.genre;

    return matching[0];
  }

  function itemMatchesWatchedFilter(item) {
    if (state.watchedFilter === "watched") return isItemWatched(item.id);
    if (state.watchedFilter === "unwatched") return !isItemWatched(item.id);
    return true;
  }

  function getFilteredItems() {
    const query = state.search.trim().toLowerCase();

    return state.items.filter((item) => {
      if (state.type !== "all" && item.contentType !== state.type) return false;
      if (!itemMatchesGenreFilter(item)) return false;
      if (!matchesSearch(item, query)) return false;
      if (!itemMatchesWatchedFilter(item)) return false;
      return true;
    });
  }

  function sortItemsInGroup(items) {
    const typeOrder = ["movies", "tvSeries", "anime"];

    return [...items].sort((a, b) => {
      const aWatched = isItemWatched(a.id);
      const bWatched = isItemWatched(b.id);
      if (aWatched !== bWatched) return aWatched ? 1 : -1;

      const typeDiff =
        typeOrder.indexOf(a.contentType) - typeOrder.indexOf(b.contentType);
      if (typeDiff !== 0) return typeDiff;

      return a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
    });
  }

  function groupItems(items) {
    const groups = [];
    const mergeByGenreOnly = state.type === "all";
    const selectedGenres = state.selectedGenres;
    const showAllMatchSection = selectedGenres.length > 1;

    const allMatchItems = showAllMatchSection
      ? items.filter((item) => itemMatchesAllSelectedGenres(item))
      : [];
    const reservedIds = new Set(allMatchItems.map((item) => item.id));
    const remainingItems = items.filter((item) => !reservedIds.has(item.id));

    if (showAllMatchSection && allMatchItems.length) {
      groups.push({
        contentType: null,
        genre: selectedGenres.join(" · "),
        isAllMatch: true,
        items: sortItemsInGroup(allMatchItems),
      });
    }

    const byDisplayGenre = new Map();
    const useFilterGrouping = selectedGenres.length > 0;

    for (const item of remainingItems) {
      const sectionGenre = useFilterGrouping
        ? getFilterDisplayGenre(item)
        : item.genre;
      const key = mergeByGenreOnly
        ? sectionGenre
        : `${item.contentType}|||${sectionGenre}`;
      if (!byDisplayGenre.has(key)) {
        byDisplayGenre.set(key, {
          contentType: mergeByGenreOnly ? null : item.contentType,
          genre: sectionGenre,
          isAllMatch: false,
          items: [],
        });
      }
      byDisplayGenre.get(key).items.push(item);
    }

    const typeOrder = ["movies", "tvSeries", "anime"];
    const genreGroups = [...byDisplayGenre.values()]
      .map((group) => ({
        ...group,
        items: sortItemsInGroup(group.items),
      }))
      .sort((a, b) => {
        if (useFilterGrouping) {
          const aIndex = selectedGenres.indexOf(a.genre);
          const bIndex = selectedGenres.indexOf(b.genre);
          const aInFilter = aIndex >= 0;
          const bInFilter = bIndex >= 0;
          if (aInFilter && bInFilter) return aIndex - bIndex;
          if (aInFilter) return -1;
          if (bInFilter) return 1;
        }

        if (mergeByGenreOnly) {
          return (
            STANDARD_GENRES.indexOf(a.genre) - STANDARD_GENRES.indexOf(b.genre)
          );
        }

        const typeDiff =
          typeOrder.indexOf(a.contentType) - typeOrder.indexOf(b.contentType);
        if (typeDiff !== 0) return typeDiff;
        return (
          STANDARD_GENRES.indexOf(a.genre) - STANDARD_GENRES.indexOf(b.genre)
        );
      });

    return [...groups, ...genreGroups];
  }

  function getItemsForGenreFilter() {
    if (state.type === "all") return state.items;
    return state.items.filter((item) => item.contentType === state.type);
  }

  function getAvailableFilterGenres() {
    const used = new Set();
    for (const item of getItemsForGenreFilter()) {
      for (const genre of itemGenres(item)) {
        used.add(genre);
      }
    }
    return STANDARD_GENRES.filter((genre) => used.has(genre));
  }

  function renderGenreFilterChips() {
    els.genreFilterChips.innerHTML = state.selectedGenres
      .map(
        (genre) => `
        <span class="genre-chip genre-chip--filter">
          ${escapeHtml(genre)}
          <button
            type="button"
            class="genre-chip__remove"
            data-action="remove-filter-genre"
            data-genre="${escapeHtml(genre)}"
            aria-label="Remove ${escapeHtml(genre)} filter"
          >×</button>
        </span>`
      )
      .join("");
  }

  function updateGenreOptions() {
    const available = new Set(getAvailableFilterGenres());
    state.selectedGenres = state.selectedGenres.filter((genre) =>
      available.has(genre)
    );

    renderGenreFilterChips();

    const placeholder = state.selectedGenres.length ? "Add genre…" : "All genres";
    const remaining = [...available].filter(
      (genre) => !state.selectedGenres.includes(genre)
    );

    els.genre.innerHTML =
      `<option value="">${placeholder}</option>` +
      remaining
        .map(
          (genre) =>
            `<option value="${escapeHtml(genre)}">${escapeHtml(genre)}</option>`
        )
        .join("");
    els.genre.value = "";
  }

  function addGenreFilter(genre) {
    if (!genre || state.selectedGenres.includes(genre)) return;
    state.selectedGenres.push(genre);
    state.selectedGenres.sort(
      (a, b) => STANDARD_GENRES.indexOf(a) - STANDARD_GENRES.indexOf(b)
    );
  }

  function clearGenreFilters() {
    state.selectedGenres = [];
  }

  function removeGenreFilter(genre) {
    state.selectedGenres = state.selectedGenres.filter((g) => g !== genre);
  }

  function populateFormGenreSelect(selected) {
    els.formGenre.innerHTML =
      '<option value="" disabled>Choose genre</option>' +
      STANDARD_GENRES.map(
        (genre) =>
          `<option value="${escapeHtml(genre)}"${selected === genre ? " selected" : ""}>${escapeHtml(genre)}</option>`
      ).join("");
  }

  function getPrimaryGenre() {
    return normalizeGenre(els.formGenre.value.trim());
  }

  function setFormSecondary(genres) {
    const primary = getPrimaryGenre();
    state.formSecondary = normalizeSecondaryGenres(primary, genres);
    renderSecondaryChips();
    updateSecondaryAddOptions();
  }

  function addFormSecondary(genre) {
    const primary = getPrimaryGenre();
    if (!genre || genre === primary) return;
    state.formSecondary = normalizeSecondaryGenres(primary, [
      ...state.formSecondary,
      genre,
    ]);
    renderSecondaryChips();
    updateSecondaryAddOptions();
  }

  function removeFormSecondary(genre) {
    state.formSecondary = state.formSecondary.filter((g) => g !== genre);
    renderSecondaryChips();
    updateSecondaryAddOptions();
  }

  function updateSecondaryAddOptions() {
    const primary = getPrimaryGenre();
    const taken = new Set([primary, ...state.formSecondary]);
    const available = STANDARD_GENRES.filter((g) => !taken.has(g));

    els.formSecondaryAdd.innerHTML =
      '<option value="">Add another genre…</option>' +
      available
        .map(
          (genre) =>
            `<option value="${escapeHtml(genre)}">${escapeHtml(genre)}</option>`
        )
        .join("");

    els.formSecondaryAdd.disabled = available.length === 0;
  }

  function renderSecondaryChips() {
    els.formSecondaryChips.innerHTML = state.formSecondary
      .map(
        (genre) => `
        <span class="genre-chip">
          ${escapeHtml(genre)}
          <button
            type="button"
            class="genre-chip__remove"
            data-action="remove-secondary"
            data-genre="${escapeHtml(genre)}"
            aria-label="Remove ${escapeHtml(genre)}"
          >×</button>
        </span>
      `
      )
      .join("");
  }

  function setFormLeads(leads) {
    state.formLeads = [...new Set(leads.map((n) => n.trim()).filter(Boolean))];
    renderLeadChips();
  }

  function addFormLead(name) {
    const trimmed = name.trim();
    if (!trimmed || state.formLeads.includes(trimmed)) return;
    state.formLeads.push(trimmed);
    renderLeadChips();
  }

  function removeFormLead(name) {
    state.formLeads = state.formLeads.filter((n) => n !== name);
    renderLeadChips();
  }

  function renderLeadChips() {
    els.formLeadChips.innerHTML = state.formLeads
      .map(
        (name) => `
        <span class="genre-chip">
          ${escapeHtml(name)}
          <button
            type="button"
            class="genre-chip__remove"
            data-action="remove-lead"
            data-name="${escapeHtml(name)}"
            aria-label="Remove ${escapeHtml(name)}"
          >×</button>
        </span>
      `
      )
      .join("");
  }

  function syncStatusLabel() {
    if (!window.WatchlistSync?.isConfigured()) return "";
    if (state.syncStatus === "pending") return " · saving…";
    if (state.syncStatus === "error") return " · save failed";
    if (state.syncStatus === "saved") return " · saved";
    return "";
  }

  function updateStats() {
    const total = state.items.length;
    const watchedCount = state.items.filter((i) => isItemWatched(i.id)).length;

    const byType = {
      movies: state.items.filter((i) => i.contentType === "movies").length,
      tvSeries: state.items.filter((i) => i.contentType === "tvSeries").length,
      anime: state.items.filter((i) => i.contentType === "anime").length,
    };

    els.stats.textContent = `${total} total · ${watchedCount} watched${syncStatusLabel()}`;

    const tabCounts = {
      all: total,
      movies: byType.movies,
      tvSeries: byType.tvSeries,
      anime: byType.anime,
    };

    document.querySelectorAll(".type-tab__count").forEach((el) => {
      const key = el.dataset.count;
      el.textContent = tabCounts[key] ?? "";
    });
  }

  function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }

  function getImdbId(item) {
    return window.WatchlistMetadata?.extractImdbId(item.link) || null;
  }

  function loadCardLayout() {
    const saved = localStorage.getItem(CARD_LAYOUT_KEY);
    return CARD_LAYOUTS.includes(saved) ? saved : "hover";
  }

  function saveCardLayout(layout) {
    localStorage.setItem(CARD_LAYOUT_KEY, layout);
  }

  function applyCardLayout() {
    if (els.app) {
      els.app.dataset.layout = state.cardLayout;
    }
  }

  function syncLayoutToggles() {
    if (!els.layoutToggles) return;

    els.layoutToggles.querySelectorAll("[data-layout]").forEach((button) => {
      const active = button.dataset.layout === state.cardLayout;
      button.classList.toggle("layout-toggle--active", active);
      button.setAttribute("aria-pressed", String(active));
    });
  }

  function setCardLayout(layout) {
    if (!CARD_LAYOUTS.includes(layout)) return;
    state.cardLayout = layout;
    saveCardLayout(layout);
    applyCardLayout();
    syncLayoutToggles();
    hideLinkPreviewPopover();
    render();
  }

  function buildPreviewDetails(meta, item) {
    const title = meta?.title || item.title;
    const year = meta?.year || item.year || "";
    const rating = meta?.rating || item.imdbRating || "";
    const plot = meta?.plot || item.summary || parseSummary(item) || "";
    const poster = meta?.poster || item.poster || "";
    const metaParts = [year, rating ? `IMDb ${rating}` : ""].filter(Boolean);

    return { title, year, rating, plot, poster, metaParts };
  }

  function renderPreviewMarkup(meta, item) {
    const details = buildPreviewDetails(meta, item);
    const posterMarkup = details.poster
      ? `<img class="link-preview-popover__poster" src="${escapeHtml(details.poster)}" alt="" loading="lazy" />`
      : `<div class="link-preview-popover__poster link-preview-popover__poster--empty" aria-hidden="true">🎬</div>`;

    return `
      <div class="link-preview-popover__content">
        ${posterMarkup}
        <div>
          <p class="link-preview-popover__title">${escapeHtml(details.title)}</p>
          ${
            details.metaParts.length
              ? `<p class="link-preview-popover__meta">${escapeHtml(details.metaParts.join(" · "))}</p>`
              : ""
          }
          ${
            details.plot
              ? `<p class="link-preview-popover__plot">${escapeHtml(details.plot)}</p>`
              : ""
          }
        </div>
      </div>
    `;
  }

  async function fetchPreviewMeta(item) {
    const imdbId = getImdbId(item);
    if (!imdbId) return null;
    if (item.poster && item.summary) {
      return {
        title: item.title,
        poster: item.poster,
        rating: item.imdbRating || "",
        year: item.year || "",
        plot: item.summary || parseSummary(item),
      };
    }
    return window.WatchlistMetadata?.getMetadata(imdbId);
  }

  function hideLinkPreviewPopover() {
    clearTimeout(state.hoverShowTimer);
    clearTimeout(state.hoverHideTimer);
    state.hoverCardId = null;
    if (els.linkPreviewPopover) {
      els.linkPreviewPopover.hidden = true;
    }
  }

  function positionLinkPreviewPopover(card) {
    if (!els.linkPreviewPopover || !card) return;

    const rect = card.getBoundingClientRect();
    const popoverWidth = Math.min(320, window.innerWidth - 32);
    let left = rect.left + rect.width / 2 - popoverWidth / 2;
    left = Math.max(16, Math.min(left, window.innerWidth - popoverWidth - 16));

    let top = rect.bottom + 10;
    const estimatedHeight = 180;
    if (top + estimatedHeight > window.innerHeight - 16) {
      top = Math.max(16, rect.top - estimatedHeight - 10);
    }

    els.linkPreviewPopover.style.width = `${popoverWidth}px`;
    els.linkPreviewPopover.style.left = `${left}px`;
    els.linkPreviewPopover.style.top = `${top}px`;
  }

  async function showLinkPreviewPopover(card, item) {
    if (!els.linkPreviewPopover || !els.linkPreviewPopoverInner || !item?.link) {
      return;
    }

    state.hoverCardId = item.id;
    els.linkPreviewPopoverInner.innerHTML =
      '<p class="link-preview-popover__loading">Loading preview…</p>';
    els.linkPreviewPopover.hidden = false;
    positionLinkPreviewPopover(card);

    const meta = await fetchPreviewMeta(item);
    if (state.hoverCardId !== item.id) return;

    els.linkPreviewPopoverInner.innerHTML = renderPreviewMarkup(meta, item);
    positionLinkPreviewPopover(card);
  }

  function setCardPoster(card, posterUrl) {
    const slot = card.querySelector("[data-poster-slot]");
    if (!slot || !posterUrl) return;

    const img = document.createElement("img");
    img.className = "card__poster";
    img.loading = "lazy";
    img.alt = "";
    img.src = posterUrl;
    slot.replaceWith(img);
  }

  async function hydratePosters() {
    const cards = els.main.querySelectorAll(".card[data-imdb-id]");
    for (const card of cards) {
      const item = state.items.find((entry) => entry.id === card.dataset.id);
      if (!item?.link) continue;

      if (item.poster) {
        setCardPoster(card, item.poster);
        continue;
      }

      const imdbId = card.dataset.imdbId;
      const meta = await window.WatchlistMetadata?.getMetadata(imdbId);
      if (meta?.poster) {
        item.poster = meta.poster;
        setCardPoster(card, meta.poster);
      }
    }
  }

  function shouldHydratePosters() {
    return state.cardLayout === "poster";
  }

  function applyPostRender() {
    applyCardLayout();
    if (shouldHydratePosters()) {
      hydratePosters();
    }
  }

  function renderCard(item) {
    const typeBadge = getTypeBadge(item);
    const isWatched = isItemWatched(item.id);
    const watchEntry = getWatchEntry(item.id);
    const rated = isWatched && hasWatchRating(watchEntry);
    const altTitle = item.altTitle
      ? `<span class="card__alt">${escapeHtml(item.altTitle)}</span>`
      : "";
    const secondaryBadges = (item.secondaryGenres || [])
      .map(
        (genre) =>
          `<span class="badge badge--genre-secondary">${escapeHtml(genre)}</span>`
      )
      .join("");
    const mainGenreBadge = item.genre
      ? `<span class="badge badge--genre-primary">${escapeHtml(item.genre)}</span>`
      : "";

    const imdbId = getImdbId(item);
    const linkedClass = item.link ? " card--linked" : "";
    const linkAttr = item.link
      ? ` data-link="${escapeHtml(item.link)}" title="Open link"`
      : "";
    const imdbAttr = imdbId ? ` data-imdb-id="${escapeHtml(imdbId)}"` : "";

    const hasLink = Boolean(item.link);
    const titleBlock = `
      <div class="card__top">
        <h3 class="card__title">
          ${escapeHtml(item.title)}
          ${altTitle}
        </h3>
      </div>
    `;
    const badgesBlock = `
      <div class="card__badges">
        <div class="card__type-row">
          <span class="badge badge--${typeBadge.className}">${escapeHtml(typeBadge.label)}</span>
        </div>
        <div class="card__genre-row">
          ${mainGenreBadge}
          ${secondaryBadges}
        </div>
      </div>
    `;

    const posterBlock = hasLink
      ? `<div class="card__media">${
          item.poster
            ? `<img class="card__poster" src="${escapeHtml(item.poster)}" alt="" loading="lazy" />`
            : `<div class="card__poster card__poster--placeholder" data-poster-slot aria-hidden="true">🎬</div>`
        }<div class="card__overlay">${badgesBlock}${titleBlock}</div></div>`
      : "";

    const useCardBody = state.cardLayout === "poster" || hasLink;
    const bodyStart = useCardBody ? '<div class="card__body">' : "";
    const bodyEnd = useCardBody ? "</div>" : "";
    const bodyHeader = `<div class="card__head">${badgesBlock}${titleBlock}</div>`;
    const ratingBlock = rated
      ? `<div class="card__rating">
          <span class="card__rating-score">${escapeHtml(formatWatchRating(watchEntry.rating))}/10</span>
          ${
            watchEntry.note
              ? `<p class="card__rating-note">${escapeHtml(watchEntry.note)}</p>`
              : ""
          }
        </div>`
      : isWatched
        ? `<div class="card__rating card__rating--pending">
            <button
              type="button"
              class="btn btn--ghost btn--sm card__rate-btn"
              data-action="rate"
              data-id="${escapeHtml(item.id)}"
            >
              Rate
            </button>
          </div>`
        : "";

    return `
      <article class="card${linkedClass}${isWatched ? " card--watched" : ""}" data-id="${escapeHtml(item.id)}"${linkAttr}${imdbAttr}>
        ${posterBlock}
        ${bodyStart}
        ${bodyHeader}
        <p class="card__lead">${escapeHtml((item.leads || parseLeads(item)).join(", "))}</p>
        <p class="card__summary">${escapeHtml(item.summary || parseSummary(item))}</p>
        ${ratingBlock}
        <div class="card__footer">
          <button
            type="button"
            class="watched-btn${isWatched ? " watched-btn--active" : ""}"
            data-action="toggle-watched"
            data-id="${escapeHtml(item.id)}"
            aria-pressed="${isWatched}"
          >
            ${isWatched ? "✓ Watched" : "Mark watched"}
          </button>
          <div class="card__actions">
            <button
              type="button"
              class="btn btn--ghost btn--sm"
              data-action="edit"
              data-id="${escapeHtml(item.id)}"
            >
              Edit
            </button>
            <button
              type="button"
              class="btn btn--danger btn--sm"
              data-action="delete"
              data-id="${escapeHtml(item.id)}"
            >
              Delete
            </button>
          </div>
        </div>
        ${bodyEnd}
      </article>
    `;
  }

  function render() {
    updateGenreOptions();
    const filtered = getFilteredItems();
    updateStats();

    if (state.items.length === 0) {
      els.main.innerHTML = `
        <div class="empty-state">
          <p class="empty-state__title">Your watchlist is empty</p>
          <p>Add titles one by one, or use <strong>Multiple titles</strong> with your AI to add many at once.</p>
          <div class="empty-state__actions">
            <button type="button" class="btn btn--primary empty-state__btn" data-action="add">
              Add title
            </button>
            <button type="button" class="btn btn--ghost empty-state__btn" data-action="share">
              Share
            </button>
          </div>
        </div>
      `;
      return;
    }

    if (filtered.length === 0) {
      els.main.innerHTML = `
        <div class="empty-state">
          <p class="empty-state__title">No titles match your filters</p>
          <p>Try a different search, genre, or type tab.</p>
        </div>
      `;
      return;
    }

    const groups = groupItems(filtered);
    const html = groups
      .map((group) => {
        const meta = group.contentType ? TYPE_META[group.contentType] : null;
        const cards = group.items.map(renderCard).join("");
        const sectionId = group.isAllMatch
          ? `all-match-${group.genre}`
          : group.contentType
            ? `${group.contentType}-${group.genre}`
            : group.genre;
        const typeBadge = meta
          ? `<span class="genre-section__type genre-section__type--${meta.className}">${escapeHtml(meta.short)}</span>`
          : "";
        const allMatchBadge = group.isAllMatch
          ? `<span class="genre-section__match">All selected</span>`
          : "";

        return `
          <section class="genre-section${group.isAllMatch ? " genre-section--all-match" : ""}" id="${escapeHtml(sectionId.replace(/\W+/g, "-"))}">
            <header class="genre-section__header">
              ${typeBadge}
              ${allMatchBadge}
              <h2 class="genre-section__title">${escapeHtml(group.genre)}</h2>
              <span class="genre-section__count">${group.items.length} title${group.items.length === 1 ? "" : "s"}</span>
            </header>
            <div class="cards">${cards}</div>
          </section>
        `;
      })
      .join("");

    els.main.innerHTML = html;
    applyPostRender();
  }

  function syncFormFields() {
    const isMovie = els.formType.value === "movies";

    els.formatField.hidden = !isMovie;

    if (isMovie) {
      els.formKind.innerHTML = `
        <option value="movie">Single film</option>
        <option value="film series">Film series</option>
      `;
    } else {
      els.formKind.value = "series";
    }
  }

  function setBulkPasteError(message) {
    if (!els.bulkPasteError) return;
    els.bulkPasteError.hidden = !message;
    els.bulkPasteError.textContent = message || "";
    els.bulkPasteError.classList.toggle("backup-modal__hint--error", Boolean(message));
  }

  function setAddMode(mode) {
    state.addMode = mode;
    const isBulk = mode === "bulk";

    els.addModeTabs?.querySelectorAll("[data-add-mode]").forEach((tab) => {
      const active = tab.dataset.addMode === mode;
      tab.classList.toggle("add-mode-tab--active", active);
      tab.setAttribute("aria-selected", String(active));
    });

    if (els.form) els.form.hidden = isBulk;
    if (els.bulkAddPanel) els.bulkAddPanel.hidden = !isBulk;

    if (isBulk) {
      setBulkPasteError("");
      els.bulkPasteInput?.focus();
    } else {
      els.formTitle?.focus();
    }
  }

  function openModal(mode, item) {
    state.editingId = mode === "edit" ? item.id : null;
    els.modalTitle.textContent = mode === "edit" ? "Edit title" : "Add title";
    els.deleteBtn.hidden = mode !== "edit";

    if (els.addModeTabs) {
      els.addModeTabs.hidden = mode === "edit";
    }

    if (mode === "add") {
      setAddMode("single");
      setBulkPasteError("");
      if (els.bulkPasteInput) els.bulkPasteInput.value = "";
    }

    els.form.hidden = false;
    if (els.bulkAddPanel) els.bulkAddPanel.hidden = true;
    els.form.reset();
    populateFormGenreSelect();

    if (item) {
      const kind = normalizeKind(
        item.kind || (item.contentType === "movies" ? "movie" : "series"),
        item.contentType
      );
      els.formType.value = item.contentType;
      syncFormFields();
      els.formKind.value = kind;
      els.formGenre.value = item.genre;
      els.formTitle.value = item.title;
      setFormLeads(item.leads || parseLeads(item));
      els.formLink.value = item.link || "";
      els.formSummary.value = item.summary || parseSummary(item);
      setFormSecondary(item.secondaryGenres || []);
    } else {
      const defaultType = state.type !== "all" ? state.type : "movies";
      els.formType.value = defaultType;
      syncFormFields();
      if (state.selectedGenres.length === 1) {
        els.formGenre.value = state.selectedGenres[0];
      }
      setFormSecondary([]);
      setFormLeads([]);
    }

    els.modal.hidden = false;
    updateBodyScrollLock();
    if (state.addMode === "bulk") {
      els.bulkPasteInput?.focus();
    } else {
      els.formTitle.focus();
    }
  }

  function closeModal() {
    els.modal.hidden = true;
    updateBodyScrollLock();
    state.editingId = null;
    state.addMode = "single";
    state.formSecondary = [];
    state.formLeads = [];
    setBulkPasteError("");
    if (els.form) els.form.hidden = false;
    if (els.bulkAddPanel) els.bulkAddPanel.hidden = true;
    els.form.reset();
  }

  function updateBodyScrollLock() {
    const anyOpen =
      !els.modal.hidden ||
      !els.ratingModal?.hidden ||
      !els.shareModal?.hidden ||
      !els.changeCodeModal?.hidden ||
      !els.importShareModal?.hidden ||
      !els.manageListsModal?.hidden ||
      !els.createListModal?.hidden;
    document.body.style.overflow = anyOpen ? "hidden" : "";
  }

  function setChangeCodeError(message) {
    if (!els.changeCodeError) return;
    els.changeCodeError.hidden = !message;
    els.changeCodeError.textContent = message || "";
    els.changeCodeError.classList.toggle("backup-modal__hint--error", Boolean(message));
  }

  function openChangeCodeModal() {
    if (!els.changeCodeModal) return;
    els.changeCodeForm?.reset();
    setChangeCodeError("");
    els.changeCodeModal.hidden = false;
    updateBodyScrollLock();
    els.changeCodeNew?.focus();
  }

  function closeChangeCodeModal() {
    if (!els.changeCodeModal) return;
    els.changeCodeModal.hidden = true;
    setChangeCodeError("");
    updateBodyScrollLock();
  }

  async function codeIsTakenRemotely(code) {
    if (!window.WatchlistSync?.isConfigured()) return false;
    const accountId = window.WatchlistAuth.accountIdFromCode(code);
    return window.WatchlistSync.accountExists(accountId);
  }

  function readLocalListPayload(listId) {
    const keys = window.WatchlistAuth.storageKeys(listId);
    const data = loadJson(keys.data, { movies: {}, tvSeries: {}, anime: {} });
    const watched = loadJson(keys.watched, {});
    return { watchlist: data, watched };
  }

  async function handleChangeCodeSubmit(event) {
    event.preventDefault();
    setChangeCodeError("");

    const newCode = els.changeCodeNew?.value || "";
    const confirmCode = els.changeCodeConfirm?.value || "";

    const formatError = window.WatchlistAuth.validateCode(newCode, { forCreate: true });
    if (formatError) {
      setChangeCodeError(formatError);
      return;
    }

    if (newCode !== confirmCode) {
      setChangeCodeError("Codes do not match.");
      return;
    }

    const prep = window.WatchlistAuth.prepareChangeCode(newCode);
    if (!prep.ok) {
      setChangeCodeError(prep.error);
      return;
    }

    if (window.WatchlistAuth.codeHasList(newCode)) {
      setChangeCodeError("That code is already in use. Pick another.");
      return;
    }

    if (await codeIsTakenRemotely(newCode)) {
      setChangeCodeError("That code is already in use. Pick another.");
      return;
    }

    const submitBtn = document.getElementById("changeCodeSubmit");
    if (submitBtn) submitBtn.disabled = true;

    try {
      if (window.WatchlistSync?.isConfigured()) {
        const library = window.WatchlistAuth.getLibrary().map((entry) => {
          const local = readLocalListPayload(entry.listId);
          return {
            listId: entry.listId,
            name: entry.name || entry.label || "My list",
            description: entry.description || "",
            watchlist: local.watchlist,
            watched: local.watched,
          };
        });

        const result = await window.WatchlistSync.migrateAccount(
          prep.oldAccountId,
          prep.newAccountId,
          library
        );
        if (!result.ok) {
          setChangeCodeError("Could not update cloud account. Try again.");
          return;
        }
      }

      window.WatchlistAuth.migrateLocalAccount(prep.oldAccountId, prep.newAccountId);
      closeChangeCodeModal();
      await window.WatchlistDialog.alert(
        "Sign in with your new code from now on, and share it only with friends you trust.",
        { title: "Code updated" }
      );
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  }

  function openShareModal() {
    if (!els.shareModal) return;
    els.shareModal.hidden = false;
    updateBodyScrollLock();
    els.shareModal.querySelector("[data-action='share-send']")?.focus();
  }

  function closeShareModal() {
    if (!els.shareModal) return;
    els.shareModal.hidden = true;
    updateBodyScrollLock();
  }

  function closeAccountMenu() {
    if (!els.accountMenuPanel || !els.accountMenuBtn) return;
    els.accountMenuPanel.hidden = true;
    els.accountMenuBtn.setAttribute("aria-expanded", "false");
  }

  function openAccountMenu() {
    if (!els.accountMenuPanel || !els.accountMenuBtn) return;
    els.accountMenuPanel.hidden = false;
    els.accountMenuBtn.setAttribute("aria-expanded", "true");
  }

  function toggleAccountMenu() {
    if (!els.accountMenuPanel) return;
    if (els.accountMenuPanel.hidden) {
      openAccountMenu();
    } else {
      closeAccountMenu();
    }
  }

  function renderManageLists() {
    if (!els.manageListsBody) return;

    const library = window.WatchlistAuth?.getLibrary() || [];
    const currentId = window.WatchlistAuth?.getProfile();
    const listIds = window.WatchlistAuth?.discoverListIds() || [];

    if (!listIds.length) {
      els.manageListsBody.innerHTML = "";
      return;
    }

    els.manageListsBody.innerHTML = listIds
      .map((listId) => {
        const entry = library.find((item) => item.listId === listId);
        const label = entry?.name || entry?.label || "Unnamed list";
        const description = entry?.description || "";
        const titleCount = window.WatchlistAuth.getListTitleCount(listId);
        const isCurrent = listId === currentId;
        const badge = isCurrent
          ? '<span class="manage-lists__badge">Signed in now</span>'
          : "";
        const meta = `<span class="manage-lists__meta">${titleCount} titles</span>`;
        const about = description
          ? `<span class="manage-lists__about">${escapeHtml(description)}</span>`
          : "";
        return `<li class="manage-lists__item">
          <div class="manage-lists__info">
            <span class="manage-lists__name">${escapeHtml(label)}</span>
            ${about}
            ${meta}
            ${badge}
          </div>
          <div class="manage-lists__actions">
            <button
              type="button"
              class="btn btn--ghost btn--sm"
              data-action="edit-list"
              data-list-id="${escapeHtml(listId)}"
            >
              Edit
            </button>
            <button
              type="button"
              class="btn btn--ghost btn--danger btn--sm"
              data-action="delete-list"
              data-list-id="${escapeHtml(listId)}"
            >
              Delete
            </button>
          </div>
        </li>`;
      })
      .join("");
  }

  function openManageListsModal() {
    if (!els.manageListsModal) return;
    renderManageLists();
    els.manageListsModal.hidden = false;
    updateBodyScrollLock();
  }

  function closeManageListsModal() {
    if (!els.manageListsModal) return;
    els.manageListsModal.hidden = true;
    updateBodyScrollLock();
  }

  function setCreateListError(message) {
    if (!els.createListError) return;
    els.createListError.hidden = !message;
    els.createListError.textContent = message || "";
    els.createListError.classList.toggle("backup-modal__hint--error", Boolean(message));
  }

  function setListFormMode(mode) {
    const isEdit = mode === "edit";
    if (els.createListModalTitle) {
      els.createListModalTitle.textContent = isEdit ? "Edit list" : "New list";
    }
    if (els.createListSubmit) {
      els.createListSubmit.textContent = isEdit ? "Save" : "Create list";
    }
  }

  function openCreateListModal() {
    if (!els.createListModal) return;
    editingListId = null;
    setListFormMode("create");
    closeManageListsModal();
    els.createListForm?.reset();
    setCreateListError("");
    els.createListModal.hidden = false;
    updateBodyScrollLock();
    els.createListName?.focus();
  }

  function openEditListModal(listId) {
    if (!els.createListModal || !listId) return;

    editingListId = listId;
    setListFormMode("edit");
    closeManageListsModal();
    setCreateListError("");

    if (els.createListName) {
      els.createListName.value = window.WatchlistAuth.getListLabel(listId);
    }
    if (els.createListDescription) {
      els.createListDescription.value = window.WatchlistAuth.getListDescription(listId);
    }

    els.createListModal.hidden = false;
    updateBodyScrollLock();
    els.createListName?.focus();
  }

  function closeCreateListModal() {
    if (!els.createListModal) return;
    els.createListModal.hidden = true;
    editingListId = null;
    setCreateListError("");
    updateBodyScrollLock();
  }

  async function handleCreateListSubmit(event) {
    event.preventDefault();
    setCreateListError("");

    const name = els.createListName?.value || "";
    const description = els.createListDescription?.value || "";

    if (editingListId) {
      const editedId = editingListId;
      const result = window.WatchlistAuth.updateList(editedId, name, description);
      if (!result.ok) {
        setCreateListError(result.error);
        return;
      }

      if (window.WatchlistSync?.isConfigured()) {
        const cloud = await window.WatchlistSync.updateListMeta(
          result.listId,
          result.accountId,
          name.trim(),
          description.trim()
        );
        if (!cloud.ok) {
          setCreateListError("Saved locally, but cloud sync failed. Try again.");
          return;
        }
      }

      closeCreateListModal();
      openManageListsModal();

      if (editedId === window.WatchlistAuth.getProfile()) {
        const headerTitle = document.getElementById("headerTitle");
        if (headerTitle) headerTitle.textContent = name.trim();
      }

      renderListSwitcher();
      return;
    }

    const result = window.WatchlistAuth.createList(name, description);

    if (!result.ok) {
      setCreateListError(result.error);
      return;
    }

    if (window.WatchlistSync?.isConfigured()) {
      const cloud = await window.WatchlistSync.createListRow(
        result.accountId,
        result.listId,
        name.trim(),
        description.trim()
      );
      if (!cloud.ok) {
        setCreateListError("Saved locally, but cloud sync failed. Try again.");
        return;
      }
    }

    closeCreateListModal();
    window.location.reload();
  }

  async function deleteCurrentAccount() {
    const accountId = window.WatchlistAuth.getAccountId();
    if (!accountId) return;

    const listCount = window.WatchlistAuth.getLibrary().length;

    const confirmed = await window.WatchlistDialog.confirm(
      `Delete your account and all ${listCount} list${listCount === 1 ? "" : "s"}? Your sign-in code will be free to use again.`,
      {
        title: "Delete account?",
        confirmLabel: "Delete account",
        cancelLabel: "Cancel",
        danger: true,
      }
    );
    if (!confirmed) return;

    window.WatchlistSync?.cancelScheduledPush();

    let cloudOk = true;
    if (window.WatchlistSync?.isConfigured()) {
      const result = await window.WatchlistSync.deleteAccount(accountId);
      cloudOk = result.ok;
    }

    window.WatchlistAuth.purgeAccount(accountId);

    if (!cloudOk) {
      await window.WatchlistDialog.alert(
        "Removed from this device, but cloud delete failed. Try Delete account once more.",
        { title: "Partially deleted" }
      );
    }

    window.WatchlistAuth.signOut({ deleted: true });
  }

  async function deleteListById(listId) {
    if (!listId) return;

    const library = window.WatchlistAuth.getLibrary();
    const entry = library.find((item) => item.listId === listId);
    const label = entry?.name || entry?.label || "This list";
    const titleCount = window.WatchlistAuth.getListTitleCount(listId);
    const isCurrent = listId === window.WatchlistAuth.getProfile();

    const confirmed = await window.WatchlistDialog.confirm(
      `Delete "${label}" (${titleCount} titles)? Your account and other lists stay.`,
      {
        title: "Delete list?",
        confirmLabel: "Delete",
        cancelLabel: "Cancel",
        danger: true,
      }
    );
    if (!confirmed) return;

    if (isCurrent) {
      window.WatchlistSync?.cancelScheduledPush();
    }

    let cloudOk = true;
    if (window.WatchlistSync?.isConfigured()) {
      const result = await window.WatchlistSync.deleteList(listId);
      cloudOk = result.ok;
    }

    window.WatchlistAuth.purgeList(listId);

    if (isCurrent) {
      const remaining = window.WatchlistAuth.getLibrary();
      if (remaining.length > 0) {
        window.WatchlistAuth.switchList(remaining[0].listId);
        window.location.reload();
        return;
      }
      window.WatchlistAuth.signOut({ deleted: true });
      return;
    }

    renderManageLists();
    renderListSwitcher();

    if (!cloudOk) {
      await window.WatchlistDialog.alert(
        "Removed from this device, but cloud delete failed. Try deleting again or check your connection.",
        { title: "Partially deleted" }
      );
    }
  }

  function formToItem() {
    const contentType = els.formType.value;
    const genre = normalizeGenre(els.formGenre.value.trim());
    const title = els.formTitle.value.trim();
    const leads = [...state.formLeads];
    const link = normalizeLink(els.formLink.value);
    const summary = els.formSummary.value.trim();
    let kind = els.formKind.value;

    if (contentType !== "movies") {
      kind = "series";
    } else {
      kind = normalizeKind(kind, contentType);
    }

    const secondaryGenres = normalizeSecondaryGenres(
      genre,
      state.formSecondary
    );

    const item = {
      contentType,
      genre,
      title,
      leads,
      lead: leads.join(", "),
      link,
      summary,
      kind,
      secondaryGenres,
    };

    if (state.editingId) {
      const existing = state.items.find((i) => i.id === state.editingId);
      if (existing?.altTitle) item.altTitle = existing.altTitle;
    }

    item.id = makeId(contentType, genre, title);
    return item;
  }

  function findDuplicate(item, excludeId) {
    return state.items.find(
      (i) =>
        i.contentType === item.contentType &&
        i.title === item.title &&
        i.id !== excludeId
    );
  }

  function saveItem(item) {
    if (state.editingId) {
      const index = state.items.findIndex((i) => i.id === state.editingId);
      if (index === -1) return false;

      const oldId = state.editingId;
      state.items[index] = item;

      if (oldId !== item.id && state.watched[oldId]) {
        state.watched[item.id] = state.watched[oldId];
        delete state.watched[oldId];
        saveWatched();
      }
    } else {
      state.items.push(item);
    }

    state.data = itemsToNested(state.items);
    saveData();
    return true;
  }

  function deleteItem(id) {
    state.items = state.items.filter((i) => i.id !== id);
    delete state.watched[id];
    saveWatched();
    state.data = itemsToNested(state.items);
    saveData();
  }

  async function copyBulkTemplate() {
    const template = window.WatchlistBulkTitles?.buildTemplate(STANDARD_GENRES);
    if (!template) return;

    try {
      await navigator.clipboard.writeText(template);
      await window.WatchlistDialog.alert(
        "Template copied. Paste it into your AI, add your title list, then paste the filled JSON back here.",
        { title: "Copied" }
      );
    } catch {
      window.WatchlistDialog.alert(
        "Could not copy automatically. Select the template text from the AI instructions and copy manually.",
        { title: "Copy failed" }
      );
    }
  }

  async function handleBulkAdd() {
    setBulkPasteError("");

    const raw = els.bulkPasteInput?.value || "";
    const parsed = window.WatchlistBulkTitles?.parseBulkPaste(raw, {
      normalizeGenre,
      resolveGenre: resolveBulkGenre,
      normalizeKind,
      parseLeads,
      normalizeLink,
      standardGenres: STANDARD_GENRES,
    });

    if (!parsed?.ok) {
      setBulkPasteError(parsed?.error || "Could not read that paste.");
      return;
    }

    let added = 0;
    let skipped = 0;

    for (const entry of parsed.items) {
      const item = {
        ...entry,
        id: makeId(entry.contentType, entry.genre, entry.title),
      };

      if (findDuplicate(item, null)) {
        skipped += 1;
        continue;
      }

      state.items.push(item);
      added += 1;
    }

    if (!added) {
      setBulkPasteError(
        skipped
          ? "Every title was already on your list."
          : "No titles could be added."
      );
      return;
    }

    state.data = itemsToNested(state.items);
    saveData();
    updateGenreOptions();
    closeModal();
    render();

    const warning =
      parsed.errors?.length || skipped
        ? `\n\n${window.WatchlistBulkTitles?.formatBulkErrors(
            [
              ...(skipped
                ? [
                    `${skipped} duplicate${skipped === 1 ? "" : "s"} skipped.`,
                  ]
                : []),
              ...(parsed.errors || []),
            ],
            { maxShown: 8 }
          )}`
        : "";

    await window.WatchlistDialog.alert(
      `Added ${added} title${added === 1 ? "" : "s"} to your list.${warning}`,
      { title: "Titles added" }
    );
  }

  function handleFormSubmit(event) {
    event.preventDefault();

    const item = formToItem();

    if (!item.genre || !item.title || !item.leads.length || !item.summary) {
      if (!item.leads.length) {
        window.WatchlistDialog.alert("Add at least one lead actor.", {
          title: "Missing actor",
        });
      }
      return;
    }

    if (els.formLink.value.trim() && !item.link) {
      window.WatchlistDialog.alert("Enter a valid link (IMDb or Rotten Tomatoes URL).", {
        title: "Invalid link",
      });
      return;
    }

    const duplicate = findDuplicate(item, state.editingId);
    if (duplicate) {
      window.WatchlistDialog.alert("A title with this name already exists in this type.", {
        title: "Duplicate title",
      });
      return;
    }

    saveItem(item);
    updateGenreOptions();
    closeModal();
    render();
  }

  async function handleDelete() {
    if (!state.editingId) return;

    const item = state.items.find((i) => i.id === state.editingId);
    const name = item ? item.title : "this title";

    const confirmed = await window.WatchlistDialog.confirm(
      `Remove "${name}" from your watchlist? This cannot be undone.`,
      {
        title: "Delete title",
        confirmLabel: "Delete",
        danger: true,
      }
    );
    if (!confirmed) return;

    deleteItem(state.editingId);
    updateGenreOptions();
    closeModal();
    render();
  }

  function setType(type) {
    state.type = type;
    els.typeTabs.forEach((tab) => {
      const active = tab.dataset.type === type;
      tab.classList.toggle("type-tab--active", active);
      tab.setAttribute("aria-selected", String(active));
    });
    updateGenreOptions();
    render();
  }

  function countTitles(data) {
    return flattenWatchlist(data || emptyWatchlist()).length;
  }

  function closeImportShareModal() {
    if (!els.importShareModal) return;
    els.importShareModal.hidden = true;
    pendingImportPayload = null;
    updateBodyScrollLock();
  }

  function renderListSwitcher() {
    if (!els.listSwitcher || !els.accountMenuSwitchWrap) return;

    const library = window.WatchlistAuth?.getLibrary() || [];
    const currentId = window.WatchlistAuth?.getProfile();

    if (library.length <= 1) {
      els.accountMenuSwitchWrap.hidden = true;
      return;
    }

    els.accountMenuSwitchWrap.hidden = false;
    els.listSwitcher.innerHTML = library
      .map((entry) => {
        const selected = entry.listId === currentId ? " selected" : "";
        return `<option value="${escapeHtml(entry.listId)}"${selected}>${escapeHtml(entry.name || entry.label || "My list")}</option>`;
      })
      .join("");
  }

  function uniqueImportedListName(baseName) {
    const trimmed = String(baseName || "Imported list").trim().slice(0, 48) || "Imported list";
    const library = window.WatchlistAuth?.getLibrary() || [];
    const taken = new Set(library.map((entry) => entry.name));

    if (!taken.has(trimmed)) return trimmed;

    for (let suffix = 2; suffix < 100; suffix += 1) {
      const candidate = `${trimmed.slice(0, 44)} (${suffix})`;
      if (!taken.has(candidate)) return candidate;
    }

    return `${trimmed.slice(0, 40)} ${Date.now()}`;
  }

  function openImportShareModal(payload) {
    if (!els.importShareModal) return;

    pendingImportPayload = payload;
    const listName = payload.listName || "Shared list";
    const titleCount = countTitles(payload.watchlist);
    const currentCount = state.items.length;
    const currentListName = window.WatchlistAuth?.getListLabel() || "My list";

    if (currentCount > 0) {
      els.importShareModalText.textContent = `"${listName}" has ${titleCount} titles. You're on "${currentListName}" with ${currentCount}.`;
      if (els.importShareModalHint) {
        els.importShareModalHint.textContent =
          "Open as a new list to keep yours untouched, or add/replace titles on your current list.";
      }
      if (els.importMergeBtn) els.importMergeBtn.hidden = false;
      if (els.importReplaceBtn) {
        els.importReplaceBtn.hidden = false;
        els.importReplaceBtn.textContent = "Replace my current list";
        els.importReplaceBtn.classList.remove("btn--ghost");
        els.importReplaceBtn.classList.add("btn--danger");
      }
    } else {
      els.importShareModalText.textContent = `"${listName}" has ${titleCount} titles. Your current list is empty.`;
      if (els.importShareModalHint) {
        els.importShareModalHint.textContent =
          "Open as a new list (recommended), or add these titles to your current list.";
      }
      if (els.importMergeBtn) els.importMergeBtn.hidden = true;
      if (els.importReplaceBtn) {
        els.importReplaceBtn.hidden = false;
        els.importReplaceBtn.textContent = "Add to this list";
        els.importReplaceBtn.classList.remove("btn--danger");
        els.importReplaceBtn.classList.add("btn--ghost");
      }
    }

    els.importShareModal.hidden = false;
    closeShareModal();
    updateBodyScrollLock();
    els.importShareModal.querySelector("[data-action='import-new-list']")?.focus();
  }

  async function importAsNewList(payload) {
    const titleCount = countTitles(payload.watchlist);
    const name = uniqueImportedListName(payload.listName);
    const description = `Imported ${titleCount} title${titleCount === 1 ? "" : "s"}`;

    const result = window.WatchlistAuth.createList(name, description);
    if (!result.ok) {
      await window.WatchlistDialog.alert(result.error || "Could not create a new list.", {
        title: "Import failed",
      });
      return false;
    }

    if (window.WatchlistSync?.isConfigured()) {
      const cloud = await window.WatchlistSync.createListRow(
        result.accountId,
        result.listId,
        name,
        description
      );
      if (!cloud.ok) {
        await window.WatchlistDialog.alert(
          "Created locally, but cloud sync failed. Your new list is on this device.",
          { title: "Saved locally" }
        );
      }
    }

    applyImportToCurrentList(payload);
    const cloud = await syncCurrentListToCloud();
    return { ok: cloud.ok, listName: name };
  }

  function updateHeaderTitle() {
    const headerTitle = document.getElementById("headerTitle");
    if (headerTitle) {
      headerTitle.textContent = window.WatchlistAuth?.getListLabel() || "My list";
    }
  }

  async function syncCurrentListToCloud() {
    if (!window.WatchlistSync?.isConfigured()) return { ok: true };
    const listId = window.WatchlistAuth.getProfile();
    return window.WatchlistSync.pushSnapshot(
      listId,
      state.data,
      state.watched,
      listSyncMeta()
    );
  }

  function findImportedWatchEntry(item, watchedMap) {
    for (const [oldId, value] of Object.entries(watchedMap || {})) {
      if (!value) continue;
      const parts = oldId.split("::");
      if (parts[0] === item.contentType && parts[parts.length - 1] === item.title) {
        return normalizeWatchEntry(value);
      }
    }
    return null;
  }

  function buildExportPayload() {
    const watched = {};
    for (const [id, value] of Object.entries(state.watched)) {
      const entry = normalizeWatchEntry(value);
      if (entry) watched[id] = entry;
    }

    let ratedCount = 0;
    for (const entry of Object.values(watched)) {
      if (hasWatchRating(entry)) ratedCount += 1;
    }

    return {
      formatVersion: 2,
      app: "Our Movie Nights",
      exportedAt: new Date().toISOString(),
      listName: window.WatchlistAuth?.getListLabel() || "My list",
      watchlist: state.data,
      watched,
      stats: {
        titles: state.items.length,
        watched: Object.keys(watched).length,
        rated: ratedCount,
      },
    };
  }

  function exportFilename(payload) {
    const safeName = (payload.listName || "watchlist")
      .replace(/[^\w\-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .toLowerCase();
    return `${safeName || "watchlist"}-${new Date().toISOString().slice(0, 10)}.json`;
  }

  async function exportBackup() {
    const payload = buildExportPayload();
    const json = JSON.stringify(payload, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const filename = exportFilename(payload);
    const file = new File([blob], filename, { type: "application/json" });

    closeShareModal();

    if (navigator.share) {
      try {
        const shareData = {
          title: `${payload.listName} — Our Movie Nights`,
          text: "My watchlist backup. Open Our Movie Nights → Share → Import a list.",
          files: [file],
        };

        if (!navigator.canShare || navigator.canShare(shareData)) {
          await navigator.share(shareData);
          await window.WatchlistDialog.alert(
            "If the share finished, your friend can import the file from Share → Import a list.",
            { title: "List shared" }
          );
          return;
        }
      } catch (error) {
        if (error?.name === "AbortError") return;
      }
    }

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);

    await window.WatchlistDialog.alert(
      "Your list file was downloaded. Send it by WhatsApp, email, or any chat app. Your friend opens the app → Share → Import a list.",
      { title: "List ready to send" }
    );
  }

  function applyImportToCurrentList(payload) {
    state.data = remapWatchlistGenres(payload.watchlist);
    state.watched = {};
    for (const [id, value] of Object.entries(payload.watched || {})) {
      const entry = normalizeWatchEntry(value);
      if (entry) state.watched[id] = entry;
    }
    state.items = flattenWatchlist(state.data);
    state.data = itemsToNested(state.items);
    window.WatchlistAuth?.clearEmptyListFlag();
    saveData();
    saveWatched();
  }

  async function finishImport(payload, mode) {
    let cloud = { ok: true };
    let importedListName = "";

    if (mode === "new-list") {
      const result = await importAsNewList(payload);
      if (!result) return;
      cloud = result;
      importedListName = result.listName;
    } else if (mode === "merge") {
      mergeImportIntoCurrentList(payload);
      cloud = await syncCurrentListToCloud();
    } else {
      applyImportToCurrentList(payload);
      cloud = await syncCurrentListToCloud();
    }

    pendingImportPayload = null;
    closeImportShareModal();
    updateGenreOptions();
    renderListSwitcher();
    updateHeaderTitle();
    render();

    if (!cloud.ok) {
      await window.WatchlistDialog.alert(
        "Saved on this device, but cloud sync failed. Your changes are still here locally.",
        { title: "Saved locally" }
      );
      return;
    }

    const message =
      mode === "new-list"
        ? `Opened "${importedListName}" as a new list. Your previous list is unchanged.`
        : mode === "merge"
          ? "New titles were added to your current list."
          : "Your current list was updated with the imported file.";
    await window.WatchlistDialog.alert(message, {
      title: mode === "new-list" ? "New list created" : "List updated",
    });
  }

  async function importBackup(file) {
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const payload = JSON.parse(reader.result);
        if (!payload?.watchlist) {
          throw new Error("Invalid backup");
        }

        closeShareModal();
        openImportShareModal(payload);
      } catch {
        window.WatchlistDialog.alert(
          "Could not read that file. Ask your friend to send one downloaded from this app.",
          { title: "Could not open file" }
        );
      }
    };
    reader.readAsText(file);
  }

  function mergeImportIntoCurrentList(payload) {
    const merged = mergeLegacyWithBundled(payload.watchlist, state.data);
    state.data = applyBundledGenreCorrections(merged, null);
    state.items = flattenWatchlist(state.data);
    state.data = itemsToNested(state.items);

    const importedItems = flattenWatchlist(remapWatchlistGenres(payload.watchlist));
    for (const item of importedItems) {
      const watchEntry = findImportedWatchEntry(item, payload.watched);
      if (!watchEntry) continue;

      state.watched[makeId(item.contentType, item.genre, item.title)] = watchEntry;
    }

    window.WatchlistAuth?.clearEmptyListFlag();
    saveData();
    saveWatched();
  }

  function bindEvents() {
    els.typeTabs.forEach((tab) => {
      tab.addEventListener("click", () => setType(tab.dataset.type));
    });

    els.search.addEventListener("input", () => {
      state.search = els.search.value;
      render();
    });

    els.genre.addEventListener("change", () => {
      const genre = els.genre.value;
      if (!genre) {
        clearGenreFilters();
      } else {
        addGenreFilter(genre);
      }
      render();
    });

    els.genreFilterChips.addEventListener("click", (event) => {
      const btn = event.target.closest("[data-action='remove-filter-genre']");
      if (!btn) return;
      removeGenreFilter(btn.dataset.genre);
      render();
    });

    els.watchedFilter?.addEventListener("change", () => {
      state.watchedFilter = els.watchedFilter.value || "all";
      render();
    });

    els.accountMenuBtn?.addEventListener("click", (event) => {
      event.stopPropagation();
      toggleAccountMenu();
    });

    els.accountMenuPanel?.addEventListener("click", async (event) => {
      const action = event.target.closest("[data-action]")?.dataset.action;
      if (!action) return;

      closeAccountMenu();

      if (action === "manage-lists") {
        openManageListsModal();
        return;
      }

      if (action === "share") {
        openShareModal();
        return;
      }

      if (action === "change-code") {
        openChangeCodeModal();
        return;
      }

      if (action === "delete-account") {
        await deleteCurrentAccount();
        return;
      }

      if (action === "sign-out") {
        window.WatchlistAuth?.signOut();
      }
    });

    document.addEventListener("click", (event) => {
      if (!els.accountMenuPanel || els.accountMenuPanel.hidden) return;
      if (event.target.closest("#accountMenu")) return;
      closeAccountMenu();
    });
    els.shareModal?.addEventListener("click", async (event) => {
      const action = event.target.closest("[data-action]")?.dataset.action;
      if (!action) return;

      if (action === "close-share-modal") {
        closeShareModal();
        return;
      }

      if (action === "share-send") {
        await exportBackup();
        return;
      }

      if (action === "share-receive") {
        closeShareModal();
        els.importInput?.click();
      }
    });

    els.importInput?.addEventListener("change", () => {
      const file = els.importInput.files?.[0];
      importBackup(file);
      els.importInput.value = "";
    });

    els.manageListsModal?.addEventListener("click", async (event) => {
      const action = event.target.closest("[data-action]")?.dataset.action;
      if (!action) return;

      if (action === "close-manage-lists-modal") {
        closeManageListsModal();
        return;
      }

      if (action === "create-new-list") {
        openCreateListModal();
        return;
      }

      if (action === "edit-list") {
        const listId = event.target.closest("[data-list-id]")?.dataset.listId;
        openEditListModal(listId);
        return;
      }

      if (action === "delete-list") {
        const listId = event.target.closest("[data-list-id]")?.dataset.listId;
        await deleteListById(listId);
      }
    });

    els.createListForm?.addEventListener("submit", handleCreateListSubmit);
    els.createListModal?.addEventListener("click", (event) => {
      if (event.target.closest("[data-action='close-create-list-modal']")) {
        closeCreateListModal();
      }
    });

    els.importShareModal?.addEventListener("click", async (event) => {
      const action = event.target.closest("[data-action]")?.dataset.action;
      if (!action) return;

      if (action === "close-import-share-modal") {
        closeImportShareModal();
        return;
      }

      if (action === "import-new-list" && pendingImportPayload) {
        await finishImport(pendingImportPayload, "new-list");
        return;
      }

      if (action === "import-merge" && pendingImportPayload) {
        const listName = pendingImportPayload.listName || "Shared list";
        const titleCount = countTitles(pendingImportPayload.watchlist);
        const currentName = window.WatchlistAuth?.getListLabel() || "My list";
        const confirmed = await window.WatchlistDialog.confirm(
          `Add ${titleCount} titles from "${listName}" to "${currentName}"? Duplicates will be skipped.`,
          {
            title: "Add to current list?",
            confirmLabel: "Add titles",
            cancelLabel: "Cancel",
          }
        );
        if (!confirmed) return;
        await finishImport(pendingImportPayload, "merge");
        return;
      }

      if (action === "import-replace" && pendingImportPayload) {
        const listName = pendingImportPayload.listName || "Shared list";
        const titleCount = countTitles(pendingImportPayload.watchlist);
        const currentName = window.WatchlistAuth?.getListLabel() || "My list";
        const replacing = state.items.length > 0;
        const confirmed = await window.WatchlistDialog.confirm(
          replacing
            ? `Replace "${currentName}" with "${listName}" (${titleCount} titles)? Your current list will be lost.`
            : `Add ${titleCount} titles from "${listName}" to your list?`,
          {
            title: replacing ? "Replace current list?" : "Add to this list?",
            confirmLabel: replacing ? "Replace list" : "Add titles",
            cancelLabel: "Cancel",
            danger: replacing,
          }
        );
        if (!confirmed) return;
        await finishImport(pendingImportPayload, "replace");
      }
    });

    els.listSwitcher?.addEventListener("change", () => {
      const listId = els.listSwitcher.value;
      if (!listId || listId === window.WatchlistAuth?.getProfile()) return;
      closeAccountMenu();
      window.WatchlistAuth.switchList(listId);
      window.location.reload();
    });

    els.layoutToggles?.addEventListener("click", (event) => {
      const toggle = event.target.closest("[data-layout]");
      if (!toggle) return;
      setCardLayout(toggle.dataset.layout);
    });
    els.addBtn.addEventListener("click", () => openModal("add"));

    els.changeCodeForm?.addEventListener("submit", handleChangeCodeSubmit);
    els.changeCodeModal?.addEventListener("click", (event) => {
      if (event.target.closest("[data-action='close-change-code-modal']")) {
        closeChangeCodeModal();
      }
    });

    els.formType.addEventListener("change", syncFormFields);

    els.formGenre.addEventListener("change", () => {
      setFormSecondary(state.formSecondary);
    });

    els.formSecondaryAdd.addEventListener("change", () => {
      const genre = els.formSecondaryAdd.value;
      if (genre) addFormSecondary(genre);
      els.formSecondaryAdd.value = "";
    });

    els.formSecondaryChips.addEventListener("click", (event) => {
      const btn = event.target.closest("[data-action='remove-secondary']");
      if (!btn) return;
      removeFormSecondary(btn.dataset.genre);
    });

    els.formLeadAdd.addEventListener("click", () => {
      addFormLead(els.formLeadInput.value);
      els.formLeadInput.value = "";
      els.formLeadInput.focus();
    });

    els.formLeadInput.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      addFormLead(els.formLeadInput.value);
      els.formLeadInput.value = "";
    });

    els.formLeadChips.addEventListener("click", (event) => {
      const btn = event.target.closest("[data-action='remove-lead']");
      if (!btn) return;
      removeFormLead(btn.dataset.name);
    });

    els.form.addEventListener("submit", handleFormSubmit);
    els.addModeTabs?.addEventListener("click", (event) => {
      const tab = event.target.closest("[data-add-mode]");
      if (!tab) return;
      setAddMode(tab.dataset.addMode);
    });
    els.copyBulkTemplate?.addEventListener("click", copyBulkTemplate);
    els.bulkAddConfirm?.addEventListener("click", handleBulkAdd);
    els.deleteBtn.addEventListener("click", handleDelete);

    els.ratingPicker?.addEventListener("click", (event) => {
      const starButton = event.target.closest("[data-rating-star]");
      if (starButton) {
        chooseRatingPickerValue(Number(starButton.dataset.ratingStar));
        return;
      }

      const adjustButton = event.target.closest("[data-rating-adjust]");
      if (adjustButton) {
        adjustRatingPicker(adjustButton.dataset.ratingAdjust);
      }
    });

    els.ratingForm?.addEventListener("submit", (event) => {
      event.preventDefault();
      saveWatchRating({
        rating: getRatingPickerValue(),
        note: els.ratingNote?.value,
      });
    });

    els.ratingModal?.addEventListener("click", (event) => {
      const action = event.target.closest("[data-action]")?.dataset.action;
      if (action === "close-rating-modal") {
        markItemWatchedLater();
      }
      if (action === "rate-later") {
        markItemWatchedLater();
      }
    });

    els.modal.addEventListener("click", (event) => {
      if (event.target.closest("[data-action='close-modal']")) {
        closeModal();
      }
    });

    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      if (!els.accountMenuPanel?.hidden) {
        closeAccountMenu();
        return;
      }
      if (!els.createListModal?.hidden) {
        closeCreateListModal();
        return;
      }
      if (!els.manageListsModal?.hidden) {
        closeManageListsModal();
        return;
      }
      if (!els.importShareModal?.hidden) {
        closeImportShareModal();
        return;
      }
      if (!els.changeCodeModal?.hidden) {
        closeChangeCodeModal();
        return;
      }
      if (!els.shareModal?.hidden) {
        closeShareModal();
        return;
      }
      if (!els.ratingModal?.hidden) {
        markItemWatchedLater();
        return;
      }
      if (!els.modal.hidden) {
        closeModal();
      }
    });

    document.addEventListener("scroll", hideLinkPreviewPopover, true);
    window.addEventListener("resize", hideLinkPreviewPopover);

    els.main.addEventListener("mouseover", (event) => {
      if (state.cardLayout !== "hover") return;
      const card = event.target.closest(".card--linked");
      if (!card) return;

      const related = event.relatedTarget?.closest?.(".card--linked");
      if (related === card) return;

      clearTimeout(state.hoverHideTimer);
      clearTimeout(state.hoverShowTimer);

      const item = state.items.find((entry) => entry.id === card.dataset.id);
      if (!item) return;

      state.hoverShowTimer = setTimeout(() => {
        showLinkPreviewPopover(card, item);
      }, 280);
    });

    els.main.addEventListener("mouseout", (event) => {
      if (state.cardLayout !== "hover") return;
      const card = event.target.closest(".card--linked");
      if (!card) return;

      const related = event.relatedTarget;
      if (related && card.contains(related)) return;
      if (related && els.linkPreviewPopover?.contains(related)) return;

      clearTimeout(state.hoverShowTimer);
      state.hoverHideTimer = setTimeout(hideLinkPreviewPopover, 120);
    });

    els.linkPreviewPopover?.addEventListener("mouseenter", () => {
      clearTimeout(state.hoverHideTimer);
    });

    els.linkPreviewPopover?.addEventListener("mouseleave", () => {
      state.hoverHideTimer = setTimeout(hideLinkPreviewPopover, 120);
    });

    els.main.addEventListener("click", async (event) => {
      const card = event.target.closest(".card--linked");
      if (card && !event.target.closest("button") && card.dataset.link) {
        window.open(card.dataset.link, "_blank", "noopener,noreferrer");
        return;
      }

      const target = event.target.closest("[data-action]");
      if (!target) return;

      const action = target.dataset.action;
      const id = target.dataset.id;

      if (action === "toggle-watched") {
        if (isItemWatched(id)) {
          delete state.watched[id];
          saveWatched();
          render();
        } else {
          state.watched[id] = {};
          saveWatched();
          render();
          openRatingModal(id);
        }
        return;
      }

      if (action === "rate") {
        openRatingModal(id);
        return;
      }

      if (action === "edit") {
        const item = state.items.find((i) => i.id === id);
        if (item) openModal("edit", item);
        return;
      }

      if (action === "delete") {
        const item = state.items.find((i) => i.id === id);
        const name = item ? item.title : "this title";
        const confirmed = await window.WatchlistDialog.confirm(
          `Remove "${name}" from your watchlist? This cannot be undone.`,
          {
            title: "Delete title",
            confirmLabel: "Delete",
            danger: true,
          }
        );
        if (!confirmed) return;
        deleteItem(id);
        updateGenreOptions();
        render();
        return;
      }

      if (action === "share") {
        openShareModal();
        return;
      }

      if (action === "add") {
        openModal("add");
      }
    });
  }

  async function init() {
    if (!window.WatchlistAuth?.isAuthenticated()) {
      window.location.replace("gate.html");
      return;
    }

    state.watched = loadWatchedState();
    state.cardLayout = loadCardLayout();
    applyCardLayout();
    syncLayoutToggles();
    state.data = loadWatchlist();
    state.items = flattenWatchlist(state.data);
    state.data = itemsToNested(state.items);

    if (window.WatchlistSync?.isConfigured()) {
      state.syncStatus = "pending";
      updateStats();
      try {
        await syncAccountLists();
        await reconcileWithCloud();
      } catch (error) {
        console.warn("[sync] reconcile failed:", error);
        state.syncStatus = "error";
      }
    }

    const { data, watched } = storageKeys();
    localStorage.setItem(data, JSON.stringify(state.data));
    localStorage.setItem(watched, JSON.stringify(state.watched));

    if (state.syncStatus === "pending") {
      state.syncStatus = window.WatchlistSync?.isConfigured() ? "saved" : "local";
    }

    if (!state.data) {
      els.main.innerHTML = `
        <div class="empty-state">
          <p class="empty-state__title">Could not load watchlist data</p>
          <p>Make sure js/data.js is present.</p>
        </div>
      `;
      return;
    }

    els.loading?.remove();
    const headerTitle = document.getElementById("headerTitle");
    if (headerTitle) {
      headerTitle.textContent = window.WatchlistAuth.getListLabel();
    }
    window.WatchlistAuth?.registerList(window.WatchlistAuth.getProfile(), {
      accountId: window.WatchlistAuth.getAccountId(),
      name: window.WatchlistAuth.getListLabel(),
      description: window.WatchlistAuth.getListDescription(),
    });
    updateGenreOptions();
    bindEvents();
    renderListSwitcher();
    updateStats();
    render();

    if (window.WatchlistAuth.needsCodeUpgrade()) {
      await window.WatchlistDialog.alert(
        "Your old code (like 1234) no longer fits the new rules. Pick a new personal code with letters and numbers — at least 6 characters.",
        { title: "Update your sign-in code" }
      );
      openChangeCodeModal();
    }

    window.addEventListener("watchlist-sync-status", (event) => {
      const status = event.detail?.status;
      if (status === "pending") state.syncStatus = "pending";
      if (status === "saved") state.syncStatus = "saved";
      if (status === "error") state.syncStatus = "error";
      if (status === "saving") state.syncStatus = "pending";
      updateStats();
    });
  }

  window.WatchlistApp = { init };

  if (document.getElementById("mainContent")) {
    init();
  }
})();
