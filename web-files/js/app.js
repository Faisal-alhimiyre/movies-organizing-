(function () {
  "use strict";

  function t(key, vars) {
    return window.WatchlistI18n?.t(key, vars) ?? key;
  }

  function ltr(text) {
    return window.WatchlistI18n?.isolateLtr?.(text) ?? text;
  }

  function localizeMessage(message) {
    if (!message) return "";
    return (
      window.WatchlistI18n?.translateAppMessage?.(message) ||
      window.WatchlistI18n?.translateAuthError?.(message) ||
      message
    );
  }

  function listLabel(listId, fallbackKey = "list.myList") {
    return window.WatchlistAuth?.getListLabel?.(listId) || t(fallbackKey);
  }

  function genreLabel(genre) {
    return window.WatchlistI18n?.genreLabel?.(genre) ?? genre;
  }

  function typeSectionShort(contentType) {
    if (contentType === "movies") return t("type.movie");
    if (contentType === "tvSeries") return t("type.tvSeries");
    if (contentType === "anime") return t("type.anime");
    return "";
  }

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
  const PENDING_SHARE_KEY = "watchlist-pending-share";
  let editingListId = null;
  let moveListItemId = null;
  let searchDebounceTimer = null;
  let formLinkLookupTimer = null;
  let addSaveInFlight = false;
  let searchPickLoading = false;
  let searchConfirmReturnFocus = null;
  let ratingsBackfillRunning = false;
  let titleMetaBackfillRunning = false;
  let yearsBackfillRunning = false;

  const state = {
    type: "all",
    selectedGenres: [],
    search: "",
    watchedFilter: "all",
    ratingFilterSource: "all",
    ratingFilterSort: "default",
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
    syncRetrying: false,
    addMode: "search",
    searchQuery: "",
    searchPage: 1,
    searchTotal: 0,
    searchResults: [],
    searchResultFocusIndex: -1,
    searchLoading: false,
    searchPickDetails: null,
    searchConfirmSecondary: [],
    manualLinkMeta: null,
    manualLinkPreviewDetails: null,
    ratingItemId: null,
    ratingHadScore: false,
    ratingPickerValue: null,
    ratingPickerChosen: false,
    shareArrival: null,
    activeListId: null,
  };

  function canPersistActiveList(listId = state.activeListId) {
    return Boolean(
      listId &&
        listId === state.activeListId &&
        listId === window.WatchlistAuth?.getProfile(),
    );
  }

  function stopBackgroundListWrites() {
    ratingsBackfillRunning = false;
    titleMetaBackfillRunning = false;
    yearsBackfillRunning = false;
    window.WatchlistSync?.cancelScheduledPush();
  }

  function switchToList(nextListId) {
    activateList(nextListId);
  }

  function activateList(nextListId) {
    const currentId = state.activeListId || window.WatchlistAuth?.getProfile();
    if (!nextListId || !currentId || nextListId === currentId) return;

    stopBackgroundListWrites();

    if (state.data) {
      state.data = itemsToNested(state.items);
      window.WatchlistAuth.writeListData(currentId, state.data, state.watched);
      writeSyncMeta(currentId, { localUpdated: Date.now() });
    }

    window.WatchlistAuth.switchList(nextListId);
    state.activeListId = nextListId;

    state.watched = loadWatchedState();
    state.data = loadWatchlist();
    state.items = flattenWatchlist(state.data);
    state.data = itemsToNested(state.items);

    state.syncStatus = window.WatchlistSync?.isConfigured() ? "pending" : "local";

    updateHeaderTitle();
    renderListSwitcher();
    updateGenreOptions();
    if (els.ratingFilter?.value === "rt-best" || els.ratingFilter?.value === "rt-worst") {
      els.ratingFilter.value = "all";
      applyRatingFilter("all");
    }
    updateRatingFilterOptions();
    updateStats();
    updateAppBanners();
    render();

    void runBackgroundCloudSync();
  }

  async function runBackgroundCloudSync() {
    if (!window.WatchlistSync?.isConfigured()) return;
    const listId = state.activeListId;
    if (!listId) return;

    state.syncStatus = "pending";
    updateStats();

    try {
      await syncAccountLists();
      if (state.activeListId !== listId) return;
      await reconcileWithCloud();
      if (state.activeListId !== listId) return;

      const { data, watched } = storageKeys();
      localStorage.setItem(data, JSON.stringify(state.data));
      localStorage.setItem(watched, JSON.stringify(state.watched));

      if (state.syncStatus === "pending") {
        state.syncStatus = "saved";
      }

      updateHeaderTitle();
      renderListSwitcher();
      updateGenreOptions();
      updateStats();
      render();
      void runMetadataBackfill();
    } catch (error) {
      console.warn("[sync] background sync failed:", error);
      if (state.activeListId === listId) {
        state.syncStatus = resolveSyncFailureStatus();
        updateStats();
      }
    }
  }

  const els = {
    main: document.getElementById("mainContent"),
    loading: document.getElementById("loading"),
    stats: document.getElementById("stats"),
    search: document.getElementById("searchInput"),
    genre: document.getElementById("genreSelect"),
    genreFilterChips: document.getElementById("genreFilterChips"),
    watchedFilter: document.getElementById("watchedFilter"),
    ratingFilter: document.getElementById("ratingFilter"),
    sortDirectionBtn: document.getElementById("sortDirectionBtn"),
    clearFiltersBtn: document.getElementById("clearFiltersBtn"),
    ratingsBackfillBanner: document.getElementById("ratingsBackfillBanner"),
    shareArrivalBanner: document.getElementById("shareArrivalBanner"),
    shareArrivalTitle: document.getElementById("shareArrivalTitle"),
    shareArrivalText: document.getElementById("shareArrivalText"),
    shareArrivalImportBtn: document.getElementById("shareArrivalImportBtn"),
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
    moveListModal: document.getElementById("moveListModal"),
    moveListModalTitle: document.getElementById("moveListModalTitle"),
    moveListModalText: document.getElementById("moveListModalText"),
    moveListPicker: document.getElementById("moveListPicker"),
    importInput: document.getElementById("importInput"),
    accountMenu: document.getElementById("accountMenu"),
    accountMenuBtn: document.getElementById("accountMenuBtn"),
    accountMenuPanel: document.getElementById("accountMenuPanel"),
    accountMenuSwitchWrap: document.getElementById("accountMenuSwitchWrap"),
    shareModal: document.getElementById("shareModal"),
    themeModal: document.getElementById("themeModal"),
    changeCodeBtn: null,
    deleteAccountBtn: null,
    changeCodeModal: document.getElementById("changeCodeModal"),
    changeCodeForm: document.getElementById("changeCodeForm"),
    changeCodeNew: document.getElementById("changeCodeNew"),
    changeCodeConfirm: document.getElementById("changeCodeConfirm"),
    changeCodeError: document.getElementById("changeCodeError"),
    listSwitcherWrap: document.getElementById("accountMenuSwitchWrap"),
    listSwitcher: document.getElementById("listSwitcher"),
    headerTitle: document.getElementById("headerTitle"),
    listTitleDropdown: document.getElementById("listTitleDropdown"),
    listTitleDropdownBtn: document.getElementById("listTitleDropdownBtn"),
    listTitleDropdownLabel: document.getElementById("listTitleDropdownLabel"),
    listTitleDropdownPanel: document.getElementById("listTitleDropdownPanel"),
    importShareModal: document.getElementById("importShareModal"),
    importShareModalText: document.getElementById("importShareModalText"),
    importShareModalHint: document.getElementById("importShareModalHint"),
    importMergeBtn: document.getElementById("importMergeBtn"),
    importMergeWatchedBtn: document.getElementById("importMergeWatchedBtn"),
    importNewListModal: document.getElementById("importNewListModal"),
    importNewListForm: document.getElementById("importNewListForm"),
    importNewListName: document.getElementById("importNewListName"),
    importNewListDescription: document.getElementById("importNewListDescription"),
    importNewListError: document.getElementById("importNewListError"),
    layoutToggles: document.getElementById("layoutToggles"),
    linkPreviewPopover: document.getElementById("linkPreviewPopover"),
    linkPreviewPopoverInner: document.getElementById("linkPreviewPopoverInner"),
    app: document.getElementById("app"),
    addBtn: document.getElementById("addBtn"),
    typeTabs: document.querySelectorAll(".type-tab"),
    modal: document.getElementById("itemModal"),
    modalPanel: document.querySelector("#itemModal .modal__panel"),
    addModeTabs: document.getElementById("addModeTabs"),
    searchAddPanel: document.getElementById("searchAddPanel"),
    searchAddStep: document.getElementById("searchAddStep"),
    titleSearchInput: document.getElementById("titleSearchInput"),
    titleSearchType: document.getElementById("titleSearchType"),
    titleSearchStatus: document.getElementById("titleSearchStatus"),
    titleSearchResults: document.getElementById("titleSearchResults"),
    titleSearchMore: document.getElementById("titleSearchMore"),
    searchConfirmStep: document.getElementById("searchConfirmStep"),
    searchConfirmBack: document.getElementById("searchConfirmBack"),
    searchConfirmPreview: document.getElementById("searchConfirmPreview"),
    searchConfirmType: document.getElementById("searchConfirmType"),
    searchConfirmTypePicker: document.getElementById("searchConfirmTypePicker"),
    searchConfirmGenre: document.getElementById("searchConfirmGenre"),
    searchConfirmSecondaryAdd: document.getElementById("searchConfirmSecondaryAdd"),
    searchConfirmSecondaryChips: document.getElementById("searchConfirmSecondaryChips"),
    searchConfirmAdd: document.getElementById("searchConfirmAdd"),
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
    formTypePicker: document.getElementById("formTypePicker"),
    formGenre: document.getElementById("formGenre"),
    formTitle: document.getElementById("formTitle"),
    formLeadInput: document.getElementById("formLeadInput"),
    formLeadAdd: document.getElementById("formLeadAdd"),
    formLeadChips: document.getElementById("formLeadChips"),
    formLink: document.getElementById("formLink"),
    formLinkStatus: document.getElementById("formLinkStatus"),
    formLinkPreview: document.getElementById("formLinkPreview"),
    formLinkPreviewHint: document.getElementById("formLinkPreviewHint"),
    formLinkPreviewCard: document.getElementById("formLinkPreviewCard"),
    formSummary: document.getElementById("formSummary"),
    formSecondaryAdd: document.getElementById("formSecondaryAdd"),
    formSecondaryChips: document.getElementById("formSecondaryChips"),
  };

  function isAppDialogOpen() {
    return Boolean(document.querySelector(".app-dialog:not([hidden])"));
  }

  function isSearchConfirmVisible() {
    return Boolean(els.searchConfirmStep && !els.searchConfirmStep.hidden);
  }

  function setButtonLoading(button, loading, { loadingKey } = {}) {
    if (!button) return;
    if (loading) {
      if (!button.dataset.defaultLabel) {
        button.dataset.defaultLabel = button.textContent.trim();
      }
      button.disabled = true;
      button.classList.add("btn--loading");
      button.setAttribute("aria-busy", "true");
      if (loadingKey) button.textContent = t(loadingKey);
    } else {
      button.disabled = false;
      button.classList.remove("btn--loading");
      button.removeAttribute("aria-busy");
      if (button.dataset.defaultLabel) {
        button.textContent = button.dataset.defaultLabel;
        delete button.dataset.defaultLabel;
      }
    }
  }

  function getTopmostOpenModal() {
    const candidates = [
      { el: els.ratingModal, panel: els.ratingModal?.querySelector(".modal__panel") },
      { el: els.createListModal, panel: els.createListModal?.querySelector(".modal__panel") },
      { el: els.manageListsModal, panel: els.manageListsModal?.querySelector(".modal__panel") },
      { el: els.moveListModal, panel: els.moveListModal?.querySelector(".modal__panel") },
      { el: els.importShareModal, panel: els.importShareModal?.querySelector(".modal__panel") },
      { el: els.importNewListModal, panel: els.importNewListModal?.querySelector(".modal__panel") },
      { el: els.changeCodeModal, panel: els.changeCodeModal?.querySelector(".modal__panel") },
      { el: els.shareModal, panel: els.shareModal?.querySelector(".modal__panel") },
      { el: els.themeModal, panel: els.themeModal?.querySelector(".modal__panel") },
      { el: els.modal, panel: els.modalPanel },
    ];
    return candidates.find((entry) => entry.el && !entry.el.hidden) || null;
  }

  function getModalFocusableElements(panel = els.modalPanel) {
    if (!panel) return [];
    return [
      ...panel.querySelectorAll(
        'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
      ),
    ].filter((el) => !el.closest("[hidden]") && el.getClientRects().length > 0);
  }

  function handleModalFocusTrap(event) {
    const openModalEntry = getTopmostOpenModal();
    if (!openModalEntry || isAppDialogOpen()) return;
    if (event.key !== "Tab") return;

    const focusable = getModalFocusableElements(openModalEntry.panel);
    if (!focusable.length) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;

    if (event.shiftKey) {
      if (active === first || !openModalEntry.panel?.contains(active)) {
        event.preventDefault();
        last.focus();
      }
      return;
    }

    if (active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function shouldIgnoreAddEnterTarget(target) {
    if (!target) return true;
    if (target.tagName === "TEXTAREA") return true;
    if (target.tagName === "SELECT") return true;
    if (target.tagName === "BUTTON") return true;
    if (target.closest(".content-type-picker")) return true;
    return false;
  }

  function handleAddModalKeydown(event) {
    if (els.modal?.hidden || isAppDialogOpen()) return;

    if (event.key === "Enter" && !event.shiftKey && !event.ctrlKey && !event.metaKey) {
      if (event.isComposing || event.defaultPrevented) return;
      if (shouldIgnoreAddEnterTarget(event.target)) return;

      if (isSearchConfirmVisible()) {
        event.preventDefault();
        handleSearchConfirmAdd();
        return;
      }

      if (state.addMode === "bulk" && !els.bulkAddPanel?.hidden) {
        event.preventDefault();
        handleBulkAdd();
        return;
      }

      if (state.addMode === "manual" && !els.form?.hidden && els.form?.checkValidity()) {
        event.preventDefault();
        els.form.requestSubmit();
      }
    }
  }

  function setSearchPickLoading(loading) {
    searchPickLoading = loading;
    if (els.searchAddStep) {
      els.searchAddStep.classList.toggle("title-search--loading", loading);
      els.searchAddStep.setAttribute("aria-busy", String(loading));
    }
    els.searchAddPanel
      ?.querySelectorAll("[data-action='pick-search-result']")
      .forEach((button) => {
        button.disabled = loading;
      });
    if (els.titleSearchMore) els.titleSearchMore.disabled = loading;
    if (els.titleSearchInput) els.titleSearchInput.readOnly = loading;
  }

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

  function listSyncMeta(listId) {
    const id = listId || window.WatchlistAuth?.getProfile();
    return {
      accountId: window.WatchlistAuth?.getAccountId(),
      name: window.WatchlistAuth?.getListLabel(id),
      description: window.WatchlistAuth?.getListDescription(id),
    };
  }

  function touchLocalUpdated() {
    const listId = window.WatchlistAuth?.getProfile();
    if (!listId) return;
    writeSyncMeta(listId, { localUpdated: Date.now() });
  }

  function queueCloudSync() {
    const listId = state.activeListId;
    if (!listId || !canPersistActiveList(listId)) return;
    if (!window.WatchlistSync?.isConfigured()) return;

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
          state.syncStatus = resolveSyncFailureStatus();
        }
        updateStats();
      }
    );
  }

  function resolveSyncFailureStatus() {
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      return "offline";
    }
    return "error";
  }

  async function notifyCloudSyncFailed(context = "default") {
    state.syncStatus = resolveSyncFailureStatus();
    updateStats();
    const messageKey =
      context === "delete" ? "alert.cloudSyncFailedDelete" : "alert.cloudSyncFailed";
    await window.WatchlistDialog.alert(t(messageKey), {
      title: t("alert.savedLocallyTitle"),
    });
  }

  async function retryCloudSync() {
    if (!window.WatchlistSync?.isConfigured() || state.syncRetrying) return;
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      state.syncStatus = "offline";
      updateStats();
      return;
    }

    state.syncRetrying = true;
    state.syncStatus = "pending";
    updateStats();

    try {
      await syncAccountLists();
      await reconcileWithCloud();

      const listId = window.WatchlistAuth?.getProfile();
      if (
        listId &&
        state.syncStatus !== "error" &&
        state.syncStatus !== "offline" &&
        !window.WatchlistAuth.isWatchlistEmpty(state.data)
      ) {
        const result = await window.WatchlistSync.pushSnapshot(
          listId,
          state.data,
          state.watched,
          listSyncMeta()
        );
        if (result?.ok) {
          writeSyncMeta(listId, { syncedAt: Date.now() });
          state.syncStatus = "saved";
        } else {
          state.syncStatus = resolveSyncFailureStatus();
        }
      } else if (state.syncStatus === "pending") {
        state.syncStatus = "saved";
      }

      const { data, watched } = storageKeys();
      localStorage.setItem(data, JSON.stringify(state.data));
      localStorage.setItem(watched, JSON.stringify(state.watched));
      updateHeaderTitle();
      renderListSwitcher();
      render();
    } catch (error) {
      console.warn("[sync] retry failed:", error);
      state.syncStatus = resolveSyncFailureStatus();
    } finally {
      state.syncRetrying = false;
      updateStats();
    }
  }

  function bindOfflineSyncListeners() {
    window.addEventListener("online", () => {
      if (state.syncStatus === "offline") {
        state.syncStatus = "error";
        updateStats();
      }
    });
    window.addEventListener("offline", () => {
      if (state.syncStatus === "pending" || state.syncStatus === "error") {
        state.syncStatus = "offline";
        updateStats();
      }
    });
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
    if (window.WatchlistAuth?.getProfile() !== listId) return;
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
        } else {
          state.syncStatus = resolveSyncFailureStatus();
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
      if (window.WatchlistAuth?.getProfile() !== listId) return;
      const localAddedById = new Map();
      if (localHasData) {
        for (const item of flattenWatchlist(state.data)) {
          if (item.addedAt) localAddedById.set(item.id, item.addedAt);
        }
      }

      state.data = applyBundledGenreCorrections(remote.watchlist, bundled);
      state.watched = remote.watched || {};
      state.items = flattenWatchlist(state.data);

      if (localAddedById.size) {
        for (const item of state.items) {
          const localAt = localAddedById.get(item.id);
          if (localAt) item.addedAt = localAt;
        }
      }
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
      if (window.WatchlistAuth?.getProfile() !== listId) return;
      const result = await window.WatchlistSync.pushSnapshot(
        listId,
        state.data,
        state.watched,
        syncMeta
      );
      if (result.ok) {
        writeSyncMeta(listId, { syncedAt: Date.now() });
        state.syncStatus = "saved";
      } else {
        state.syncStatus = resolveSyncFailureStatus();
      }
    }
  }

  function saveWatched() {
    if (!canPersistActiveList()) return;
    const { watched } = storageKeys();
    localStorage.setItem(watched, JSON.stringify(state.watched));
    queueCloudSync();
  }

  function saveData() {
    if (!canPersistActiveList()) return;
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

  function normalizeContentType(value) {
    if (value === "movies" || value === "tvSeries" || value === "anime") {
      return value;
    }
    return "movies";
  }

  function syncContentTypePicker(picker, hiddenInput, value) {
    if (!picker || !hiddenInput) return;
    const normalized = normalizeContentType(value);
    hiddenInput.value = normalized;
    picker.querySelectorAll("[data-type]").forEach((btn) => {
      const active = btn.dataset.type === normalized;
      btn.classList.toggle("content-type-picker__btn--active", active);
      btn.setAttribute("aria-pressed", String(active));
    });
  }

  function initContentTypePicker(picker, hiddenInput) {
    if (!picker || !hiddenInput || picker.dataset.bound === "true") return;
    picker.dataset.bound = "true";
    picker.addEventListener("click", (event) => {
      const btn = event.target.closest("[data-type]");
      if (!btn) return;
      syncContentTypePicker(picker, hiddenInput, btn.dataset.type);
    });
  }

  function setFormLinkStatus(message, { error = false } = {}) {
    if (!els.formLinkStatus) return;
    els.formLinkStatus.textContent = message || "";
    els.formLinkStatus.classList.toggle("form-field__status--error", Boolean(error));
  }

  function setFormLinkPreview(details) {
    if (!els.formLinkPreview) return;
    if (!details?.title) {
      els.formLinkPreview.hidden = true;
      if (els.formLinkPreviewCard) els.formLinkPreviewCard.innerHTML = "";
      if (els.formLinkPreviewHint) els.formLinkPreviewHint.innerHTML = "";
      state.manualLinkPreviewDetails = null;
      return;
    }

    state.manualLinkPreviewDetails = details;
    if (els.formLinkPreviewHint) {
      els.formLinkPreviewHint.innerHTML = t("manual.filled");
    }
    renderTitlePreview(els.formLinkPreviewCard, details);
    els.formLinkPreview.hidden = false;
  }

  function applyMetadataToManualForm(meta) {
    if (!meta) return;

    if (meta.title) els.formTitle.value = meta.title;
    if (meta.plot) els.formSummary.value = meta.plot;
    if (meta.actors?.length) setFormLeads(meta.actors);

    if (meta.contentType) {
      syncContentTypePicker(
        els.formTypePicker,
        els.formType,
        normalizeContentType(meta.contentType)
      );
    }

    const suggested = window.WatchlistMetadata?.suggestGenres(
      meta.genres,
      STANDARD_GENRES,
      normalizeContentType(meta.contentType || els.formType?.value)
    );
    if (suggested?.[0]) {
      els.formGenre.value = suggested[0];
      updateSecondaryAddOptions();
      setFormSecondary(suggested.slice(1));
    }

    state.manualLinkMeta = {
      poster: meta.poster || "",
      imdbRating: meta.anilistRating ? "" : meta.rating || "",
      anilistRating: meta.anilistRating || "",
      year: meta.year || "",
      imdbId: meta.imdbId || "",
      ageRating: meta.ageRating || "",
      runtime: meta.runtime || "",
      seasonCount: meta.seasonCount || null,
      episodeCount: meta.episodeCount || null,
    };
  }

  async function handleFormLinkLookup() {
    const link = normalizeLink(els.formLink?.value);
    if (!link) {
      state.manualLinkMeta = null;
      setFormLinkStatus("");
      setFormLinkPreview(null);
      return;
    }

    if (!window.WatchlistMetadata?.isSupportedLink(link)) {
      state.manualLinkMeta = null;
      setFormLinkStatus("");
      setFormLinkPreview(null);
      return;
    }

    const isAnimeLink =
      window.WatchlistMetadata.isAnilistLink(link) ||
      window.WatchlistMetadata.isMalLink(link);
    if (
      !isAnimeLink &&
      !window.WatchlistMetadata.hasOmdbKey() &&
      !window.WatchlistMetadata.hasTmdbKey()
    ) {
      setFormLinkStatus(
        t("manual.needKey"),
        { error: true }
      );
      return;
    }

    setFormLinkPreview(null);
    setFormLinkStatus(t("manual.lookingUp"));
    if (els.formLink) {
      els.formLink.setAttribute("aria-busy", "true");
      els.formLink.classList.add("form-input--loading");
    }
    let meta;
    try {
      meta = await window.WatchlistMetadata.resolveMetadataFromLink(link);
    } finally {
      if (els.formLink) {
        els.formLink.removeAttribute("aria-busy");
        els.formLink.classList.remove("form-input--loading");
      }
    }
    if (!meta?.title) {
      state.manualLinkMeta = null;
      const isAnime =
        window.WatchlistMetadata.isAnilistLink(link) ||
        window.WatchlistMetadata.isMalLink(link);
      setFormLinkStatus(
        isAnime ? t("manual.animeFail") : t("manual.linkFail"),
        { error: true }
      );
      return;
    }

    applyMetadataToManualForm(meta);
    setFormLinkStatus("");
    setFormLinkPreview(meta);
  }

  function queueFormLinkLookup() {
    clearTimeout(formLinkLookupTimer);
    formLinkLookupTimer = setTimeout(handleFormLinkLookup, 500);
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
      if (item.poster) entry.poster = item.poster;
      if (item.imdbRating) entry.imdbRating = item.imdbRating;
      if (item.anilistRating) entry.anilistRating = item.anilistRating;
      if (item.ageRating) entry.ageRating = item.ageRating;
      if (item.runtime) entry.runtime = item.runtime;
      if (item.seasonCount) entry.seasonCount = item.seasonCount;
      if (item.episodeCount) entry.episodeCount = item.episodeCount;
      if (item.year) entry.year = item.year;
      if (item.link) entry.link = item.link;
      entry.addedAt = item.addedAt || Date.now();

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

    // Preserve granular progress when present.
    if (value.progress && typeof value.progress === "object" &&
        Array.isArray(value.progress.episodes)) {
      entry.progress = { version: 1, episodes: value.progress.episodes };
    }

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
    if (!state.ratingPickerChosen) return;
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
    els.ratingValueDisplay.classList.add("text-num");

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
    els.ratingError.textContent = localizeMessage(message);
    els.ratingError.classList.toggle("backup-modal__hint--error", Boolean(message));
  }

  function updateRatingModalActions() {
    const laterBtn = els.ratingForm?.querySelector('[data-action="rate-later"]');
    const submitBtn = els.ratingForm?.querySelector('button[type="submit"]');
    if (!laterBtn || !submitBtn) return;

    if (state.ratingHadScore) {
      laterBtn.textContent = t("btn.cancel");
      submitBtn.textContent = t("btn.save");
    } else {
      laterBtn.textContent = t("btn.rateLater");
      submitBtn.textContent = t("btn.saveRating");
    }
  }

  function watchEntryHasUserData(entry) {
    if (!entry) return false;
    return hasWatchRating(entry) || Boolean(String(entry.note || "").trim());
  }

  async function markItemUnwatched(itemId) {
    const entry = state.watched[itemId];
    if (!entry) return;

    if (watchEntryHasUserData(entry)) {
      const confirmed = await window.WatchlistDialog.confirm(t("alert.markUnwatchedConfirm"), {
        title: t("alert.markUnwatchedTitle"),
        confirmLabel: t("card.markUnwatched"),
        cancelLabel: t("btn.cancel"),
        danger: true,
      });
      if (!confirmed) return;
    }

    delete state.watched[itemId];
    saveWatched();
    render();
  }

  function openRatingModal(itemId) {
    const item = state.items.find((entry) => entry.id === itemId);
    if (!item || !els.ratingModal) return;

    state.ratingItemId = itemId;
    setRatingError("");

    const existing = getWatchEntry(itemId);
    state.ratingHadScore = hasWatchRating(existing);
    els.ratingModalTitle.textContent = t("rating.rateItem", { title: item.title });

    if (state.ratingHadScore) {
      resetRatingPicker({ chosen: true, rating: existing.rating });
    } else {
      resetRatingPicker();
    }
    els.ratingNote.value = existing?.note || "";

    updateRatingModalActions();
    els.ratingModal.hidden = false;
    updateBodyScrollLock();
    closeAllCardMenus();
    els.ratingPicker?.querySelector('[data-rating-star="5"]')?.focus();
  }

  function closeRatingModal() {
    if (!els.ratingModal) return;
    els.ratingModal.hidden = true;
    state.ratingItemId = null;
    state.ratingHadScore = false;
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
      setRatingError(t("rating.chooseStarFirst"));
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

  function dismissRatingModal() {
    if (state.ratingHadScore) {
      closeRatingModal();
      return;
    }
    markItemWatchedLater();
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

  function migrateLegacyAnilistRating(item) {
    if (item.anilistRating || !item.imdbRating) return;
    const hasAnilistLink =
      window.WatchlistMetadata?.extractAnilistId?.(item.link) ||
      window.WatchlistMetadata?.extractMalId?.(item.link);
    if (!hasAnilistLink || getImdbId(item)) return;

    const score = parseScoreValue(item.imdbRating);
    if (score == null) return;

    item.anilistRating = score <= 10 ? String(Math.round(score * 10)) : String(Math.round(score));
    delete item.imdbRating;
  }

  function backfillMissingAddedAt(items) {
    const now = Date.now();
    items.forEach((item, index) => {
      if (!item.addedAt) {
        item.addedAt = now - (items.length - index) * 1000;
      }
    });
  }

  function stampItemAddedAt(item, { existing = null, at = null } = {}) {
    if (existing?.addedAt) {
      item.addedAt = existing.addedAt;
    } else if (!item.addedAt) {
      item.addedAt = at ?? Date.now();
    }
    return item;
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
          migrateLegacyAnilistRating(items[items.length - 1]);
        }
      }
    }

    backfillMissingAddedAt(items);
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
      if (item.anilistRating) entry.anilistRating = item.anilistRating;
      if (item.ageRating) entry.ageRating = item.ageRating;
      if (item.runtime) entry.runtime = item.runtime;
      if (item.seasonCount) entry.seasonCount = item.seasonCount;
      if (item.episodeCount) entry.episodeCount = item.episodeCount;
      if (item.year) entry.year = item.year;
      if (item.addedAt) entry.addedAt = item.addedAt;
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
      return { label: t("type.anime"), className: "anime" };
    }
    if (item.kind === "film series") {
      return { label: t("type.filmSeries"), className: "franchise" };
    }
    if (item.contentType === "tvSeries") {
      return { label: t("type.tvSeries"), className: "tvSeries" };
    }
    return { label: t("type.movie"), className: "movie" };
  }

  function matchesSearch(item, query) {
    if (!query) return true;
    const haystack = [
      item.title,
      item.altTitle,
      item.lead,
      ...(item.leads || []),
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

  /**
   * Returns the three-state derived progress for a title using only its watch
   * entry (no episode-count lookups required — suitable for list filtering).
   *
   * "watched"    — legacy-complete entry (bulk "Mark watched") or entry with no
   *                granular progress object (e.g. entry = {} or {rating, note})
   * "inProgress" — entry has a granular episodes array with ≥1 watched key
   * "unwatched"  — no entry, or entry has granular progress but 0 watched keys
   */
  function itemProgressState(id) {
    const raw = state.watched[id];
    if (!raw) return "unwatched";
    const entry = normalizeWatchEntry(raw);
    if (!entry) return "unwatched";
    const P = window.WatchlistProgress;
    if (!P || P.isLegacyComplete(entry)) return "watched";
    const prog = P.getProgress(entry);
    if (!prog || !Array.isArray(prog.episodes)) return "unwatched";
    if (prog.completed === true) return "watched";      // all episodes annotated complete
    if (prog.episodes.length > 0) return "inProgress"; // some episodes watched
    return "unwatched";
  }

  function itemMatchesWatchedFilter(item) {
    if (state.watchedFilter === "watched") return itemProgressState(item.id) === "watched";
    if (state.watchedFilter === "inProgress") return itemProgressState(item.id) === "inProgress";
    if (state.watchedFilter === "unwatched") return itemProgressState(item.id) === "unwatched";
    return true;
  }

  function parseScoreValue(raw) {
    if (raw == null || raw === "") return null;
    const num = Number(String(raw).replace(",", ".").replace("%", "").trim());
    return Number.isFinite(num) ? num : null;
  }

  function getItemImdbScore(item) {
    return parseScoreValue(item.imdbRating);
  }

  function getItemPersonalScore(item) {
    const entry = getWatchEntry(item.id);
    if (!entry || !hasWatchRating(entry)) return null;
    return parseScoreValue(entry.rating);
  }

  function getItemAnilistScore(item) {
    const raw = parseScoreValue(item.anilistRating);
    if (raw == null) return null;
    return raw > 10 ? raw / 10 : raw;
  }

  function getItemAnilistSortScore(item) {
    const raw = parseScoreValue(item.anilistRating);
    if (raw == null) return null;
    return raw > 10 ? raw : raw * 10;
  }

  function getRatingSortScore(item) {
    const source = state.ratingFilterSource;
    if (!source || source === "all") return null;
    if (source === "imdb") return getItemImdbScore(item);
    if (source === "anilist") return getItemAnilistSortScore(item);
    if (source === "personal") return getItemPersonalScore(item);
    if (source === "age") return window.WatchlistMetadata?.ageRatingSortRank?.(item.ageRating) ?? null;
    return null;
  }

  function formatImdbDisplay(value) {
    const score = parseScoreValue(value);
    if (score == null) return "";
    return Number.isInteger(score) ? String(score) : score.toFixed(1);
  }

  function formatAnilistDisplay(value) {
    const score = parseScoreValue(value);
    if (score == null) return "";
    const pct = score > 10 ? Math.round(score) : Math.round(score * 10);
    return `${pct}%`;
  }

  const BRAND_IMDB_LOGO = "assets/brand/imdb.svg";
  const BRAND_ANILIST_LOGO = "assets/brand/anilist.svg";

  function renderExternalRatings(item) {
    const parts = [];
    const imdb = formatImdbDisplay(item.imdbRating);
    const anilist = formatAnilistDisplay(item.anilistRating);

    if (imdb) {
      parts.push(
        `<span class="card__score card__score--imdb" title="IMDb ${escapeHtml(imdb)}">
          <span class="card__score-value text-num">${escapeHtml(imdb)}</span>
          <img class="card__score-logo card__score-logo--imdb" src="${BRAND_IMDB_LOGO}" width="46" height="20" alt="" />
        </span>`
      );
    }
    if (anilist) {
      parts.push(
        `<span class="card__score card__score--anilist" title="AniList ${escapeHtml(anilist)}">
          <span class="card__score-value text-num">${escapeHtml(anilist)}</span>
          <img class="card__score-logo card__score-logo--anilist" src="${BRAND_ANILIST_LOGO}" width="34" height="26" alt="" />
        </span>`
      );
    }

    if (!parts.length) return "";
    return `<div class="card__rating-badges">${parts.join("")}</div>`;
  }

  function parseReleaseYear(value) {
    if (value == null || value === "") return null;
    const raw = String(value).trim();
    if (!raw || /^n\/a$/i.test(raw)) return null;
    const match = raw.match(/\b(18[89]\d|19\d{2}|20\d{2})\b/);
    if (!match) return null;
    const year = parseInt(match[1], 10);
    return Number.isFinite(year) ? year : null;
  }

  function hasValidReleaseYear(item) {
    return parseReleaseYear(item?.year) != null;
  }

  function formatReleaseYearDisplay(value) {
    const year = parseReleaseYear(value);
    return year == null ? "" : String(year);
  }

  function renderReleaseYearBadge(item) {
    const year = formatReleaseYearDisplay(item.year);
    if (!year) return "";
    return `<span class="badge badge--year text-num" title="${escapeHtml(t("card.releaseYear"))}">${escapeHtml(year)}</span>`;
  }

  function isDateSortSource(source) {
    return source === "added" || source === "release";
  }

  function isRatingSortSource(source) {
    return source === "imdb" || source === "anilist" || source === "personal" || source === "age";
  }

  function isReleaseSortActive() {
    return state.ratingFilterSource === "release";
  }

  function isToggleSortActive() {
    const source = state.ratingFilterSource;
    return Boolean(source && source !== "all");
  }

  function isSortNewestFirst() {
    return state.ratingFilterSort !== "oldest";
  }

  function isSortBestFirst() {
    return state.ratingFilterSort !== "worst";
  }

  function isSortDescendingPreferred() {
    if (isDateSortSource(state.ratingFilterSource)) return isSortNewestFirst();
    if (isRatingSortSource(state.ratingFilterSource)) return isSortBestFirst();
    return true;
  }

  function getSortDirectionLabel() {
    if (isDateSortSource(state.ratingFilterSource)) {
      return isSortNewestFirst() ? t("filter.sortNewestFirst") : t("filter.sortOldestFirst");
    }
    if (isRatingSortSource(state.ratingFilterSource)) {
      return isSortBestFirst() ? t("filter.sortHighestFirst") : t("filter.sortLowestFirst");
    }
    return t("filter.sortDirection");
  }

  function sortItemsByRelease(items) {
    const newest = isSortNewestFirst();
    return [...items].sort((a, b) => {
      const aYear = parseReleaseYear(a.year);
      const bYear = parseReleaseYear(b.year);
      if (aYear == null && bYear == null) {
        return a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
      }
      if (aYear == null) return 1;
      if (bYear == null) return -1;
      if (aYear !== bYear) return newest ? bYear - aYear : aYear - bYear;
      return a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
    });
  }

  function updateSortDirectionButton() {
    if (!els.sortDirectionBtn) return;

    const show = isToggleSortActive();
    els.sortDirectionBtn.hidden = !show;
    if (!show) return;

    els.sortDirectionBtn.classList.toggle(
      "sort-direction-btn--oldest",
      !isSortDescendingPreferred()
    );
    const label = getSortDirectionLabel();
    els.sortDirectionBtn.setAttribute("aria-label", `${t("filter.sortDirection")}: ${label}`);
    els.sortDirectionBtn.title = label;
  }

  function toggleSortDirection() {
    if (!isToggleSortActive()) return;
    if (isDateSortSource(state.ratingFilterSource)) {
      state.ratingFilterSort = isSortNewestFirst() ? "oldest" : "newest";
    } else if (isRatingSortSource(state.ratingFilterSource)) {
      state.ratingFilterSort = isSortBestFirst() ? "worst" : "best";
    }
    updateSortDirectionButton();
    render();
  }

  function isRatingSortActive() {
    return isRatingSortSource(state.ratingFilterSource);
  }

  function isAddedSortActive() {
    return state.ratingFilterSource === "added";
  }

  function isFlatSortActive() {
    return isToggleSortActive() && state.selectedGenres.length === 0;
  }

  function sortItemsByRating(items) {
    const bestFirst = isSortBestFirst();
    return [...items].sort((a, b) => {
      const aScore = getRatingSortScore(a);
      const bScore = getRatingSortScore(b);
      if (aScore == null && bScore == null) {
        return a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
      }
      if (aScore == null) return 1;
      if (bScore == null) return -1;
      const diff = bestFirst ? bScore - aScore : aScore - bScore;
      if (diff !== 0) return diff;
      return a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
    });
  }

  function sortItemsByAdded(items) {
    const newest = isSortNewestFirst();
    return [...items].sort((a, b) => {
      const aTime = a.addedAt || 0;
      const bTime = b.addedAt || 0;
      if (aTime !== bTime) return newest ? bTime - aTime : aTime - bTime;
      return a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
    });
  }

  function itemMatchesRatingFilter(item) {
    const source = state.ratingFilterSource;
    if (!source || source === "all" || source === "added" || source === "release") {
      return true;
    }
    return getRatingSortScore(item) != null;
  }

  function ratingFilterOptions() {
    return [
      { value: "all", labelKey: "filter.ratingOptionAll" },
      { value: "added", labelKey: "filter.ratingOptionAdded" },
      { value: "release", labelKey: "filter.ratingOptionRelease" },
      { value: "age", labelKey: "filter.ratingOptionAge" },
      { value: "imdb", labelKey: "filter.ratingOptionImdb" },
      { value: "anilist", labelKey: "filter.ratingOptionAnilist" },
      { value: "personal", labelKey: "filter.ratingOptionPersonal" },
    ];
  }

  function parseRatingFilter(value) {
    if (!value || value === "all") {
      return { source: "all", sort: "default" };
    }
    if (value === "added" || value === "added-newest") {
      return { source: "added", sort: "newest" };
    }
    if (value === "added-oldest") {
      return { source: "added", sort: "oldest" };
    }
    if (value === "release") {
      return { source: "release", sort: "newest" };
    }
    if (value === "imdb" || value === "anilist" || value === "personal" || value === "age") {
      return { source: value, sort: "best" };
    }
    const [source, sort] = String(value).split("-");
    if (!source || source === "rt") {
      return { source: "all", sort: "default" };
    }
    if (isDateSortSource(source)) {
      return {
        source,
        sort: sort === "oldest" ? "oldest" : "newest",
      };
    }
    return {
      source,
      sort: sort === "worst" ? "worst" : "best",
    };
  }

  function getRatingFilterValue() {
    const source = state.ratingFilterSource;
    if (!source || source === "all") return "all";
    return source;
  }

  function applyRatingFilter(value) {
    const parsed = parseRatingFilter(value);
    const prev = state.ratingFilterSource;
    const prevSort = state.ratingFilterSort;

    if (isDateSortSource(prev) && isDateSortSource(parsed.source) && parsed.source !== prev) {
      parsed.sort = prevSort === "oldest" ? "oldest" : "newest";
    }
    if (
      isRatingSortSource(prev) &&
      isRatingSortSource(parsed.source) &&
      parsed.source !== prev
    ) {
      parsed.sort = prevSort === "worst" ? "worst" : "best";
    }

    state.ratingFilterSource = parsed.source;
    state.ratingFilterSort = parsed.sort;
    updateSortDirectionButton();
  }

  function updateRatingFilterOptions() {
    if (!els.ratingFilter) return;

    const options = ratingFilterOptions();
    const current = getRatingFilterValue();
    const valid = options.some((opt) => opt.value === current);
    const next = valid ? current : "all";

    els.ratingFilter.innerHTML = options
      .map(
        (opt) =>
          `<option value="${escapeHtml(opt.value)}">${escapeHtml(t(opt.labelKey))}</option>`
      )
      .join("");
    els.ratingFilter.value = next;
    applyRatingFilter(next);
    updateSortDirectionButton();
  }

  function itemMatchesFiltersExceptType(item) {
    const query = state.search.trim().toLowerCase();
    if (!itemMatchesGenreFilter(item)) return false;
    if (!matchesSearch(item, query)) return false;
    if (!itemMatchesWatchedFilter(item)) return false;
    if (!itemMatchesRatingFilter(item)) return false;
    return true;
  }

  function getFilteredItems() {
    return state.items.filter((item) => {
      if (state.type !== "all" && item.contentType !== state.type) return false;
      return itemMatchesFiltersExceptType(item);
    });
  }

  function sortItemsInGroup(items) {
    if (isAddedSortActive()) {
      return sortItemsByAdded(items);
    }
    if (isReleaseSortActive()) {
      return sortItemsByRelease(items);
    }
    if (isRatingSortActive()) {
      return sortItemsByRating(items);
    }

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
    if (isFlatSortActive()) {
      const sorted = isAddedSortActive()
        ? sortItemsByAdded(items)
        : isReleaseSortActive()
          ? sortItemsByRelease(items)
          : sortItemsByRating(items);
      return [
        {
          contentType: null,
          genre: null,
          isAllMatch: false,
          isRatingSorted: true,
          items: sorted,
        },
      ];
    }

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
    const hasChips = state.selectedGenres.length > 0;
    if (els.genreFilterChips) {
      els.genreFilterChips.setAttribute(
        "aria-label",
        hasChips ? t("chip.activeFilters") : ""
      );
      if (!hasChips) {
        els.genreFilterChips.removeAttribute("aria-label");
      }
    }

    els.genreFilterChips.innerHTML = state.selectedGenres
      .map(
        (genre) => `
        <span class="genre-chip genre-chip--filter">
          ${escapeHtml(genreLabel(genre))}
          <button
            type="button"
            class="genre-chip__remove"
            data-action="remove-filter-genre"
            data-genre="${escapeHtml(genre)}"
            aria-label="${escapeHtml(t("chip.removeFilter", { genre: genreLabel(genre) }))}"
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

    const placeholder = t("filter.allGenres");
    const remaining = [...available].filter(
      (genre) => !state.selectedGenres.includes(genre)
    );

    els.genre.innerHTML =
      `<option value="">${placeholder}</option>` +
      remaining
        .map(
          (genre) =>
            `<option value="${escapeHtml(genre)}">${escapeHtml(genreLabel(genre))}</option>`
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

  function hasActiveFilters() {
    return (
      state.type !== "all" ||
      state.search.trim() !== "" ||
      state.selectedGenres.length > 0 ||
      state.watchedFilter !== "all" ||
      state.ratingFilterSource !== "all"
    );
  }

  function hasPanelFilters() {
    return (
      state.search.trim() !== "" ||
      state.selectedGenres.length > 0 ||
      state.watchedFilter !== "all" ||
      state.ratingFilterSource !== "all"
    );
  }

  function updateClearFiltersButton() {
    if (!els.clearFiltersBtn) return;
    const show = hasPanelFilters();
    els.clearFiltersBtn.hidden = !show;
    els.clearFiltersBtn.textContent = t("empty.clearFilters");
  }

  function clearAllFilters() {
    state.type = "all";
    state.search = "";
    clearGenreFilters();
    state.watchedFilter = "all";
    applyRatingFilter("all");
    if (els.search) els.search.value = "";
    if (els.watchedFilter) els.watchedFilter.value = "all";
    if (els.ratingFilter) els.ratingFilter.value = "all";
    els.typeTabs.forEach((tab) => {
      const active = tab.dataset.type === "all";
      tab.classList.toggle("type-tab--active", active);
      tab.setAttribute("aria-selected", String(active));
    });
    updateGenreOptions();
    updateRatingFilterOptions();
    updateClearFiltersButton();
    render();
  }

  function dismissShareArrival() {
    clearPendingShareId();
    stripShareFromUrl();
    state.shareArrival = null;
    updateShareArrivalBanner();
  }

  function updateShareArrivalBanner() {
    if (!els.shareArrivalBanner) return;
    const arrival = state.shareArrival;
    if (!arrival) {
      els.shareArrivalBanner.hidden = true;
      return;
    }

    els.shareArrivalBanner.hidden = false;
    if (els.shareArrivalTitle) {
      els.shareArrivalTitle.textContent = t("share.arrivalTitle");
    }

    const dismissBtn = els.shareArrivalBanner.querySelector(
      "[data-action='dismiss-share-arrival']"
    );
    if (dismissBtn) dismissBtn.textContent = t("share.arrivalDismiss");

    if (arrival.loading) {
      if (els.shareArrivalText) {
        els.shareArrivalText.textContent = t("share.arrivalLoading");
      }
      if (els.shareArrivalImportBtn) els.shareArrivalImportBtn.hidden = true;
      return;
    }

    if (arrival.error) {
      let message = t("share.arrivalInvalid");
      if (arrival.error === "expired") message = t("share.arrivalExpired");
      else if (arrival.error === "empty") message = t("alert.importEmptyList");
      else if (arrival.error === "cloud") message = t("alert.shareNeedsCloud");
      if (els.shareArrivalText) els.shareArrivalText.textContent = message;
      if (els.shareArrivalImportBtn) els.shareArrivalImportBtn.hidden = true;
      return;
    }

    const listName = arrival.payload?.listName || "Shared list";
    const titleCount = countTitles(arrival.payload?.watchlist);
    if (els.shareArrivalText) {
      els.shareArrivalText.textContent = t("share.arrivalText", {
        name: listName,
        count: titleCount,
      });
    }
    if (els.shareArrivalImportBtn) {
      els.shareArrivalImportBtn.hidden = false;
      els.shareArrivalImportBtn.textContent = t("share.arrivalImport");
    }
  }

  function updateAppBanners() {
    updateShareArrivalBanner();
  }

  async function openShareArrivalImport() {
    const arrival = state.shareArrival;
    if (!arrival?.payload) {
      if (arrival?.error === "cloud") {
        await window.WatchlistDialog.alert(t("alert.shareNeedsCloud"), {
          title: t("alert.couldNotOpenFileTitle"),
        });
      }
      return;
    }
    openImportShareModal(arrival.payload);
  }

  async function initShareArrival() {
    const shareId = readPendingShareId();
    if (!shareId) {
      state.shareArrival = null;
      updateShareArrivalBanner();
      return;
    }

    state.shareArrival = { shareId, loading: true, payload: null, error: null };
    updateShareArrivalBanner();

    if (!window.WatchlistSync?.isConfigured?.()) {
      state.shareArrival = { shareId, loading: false, payload: null, error: "cloud" };
      updateShareArrivalBanner();
      return;
    }

    const result = await window.WatchlistSync.fetchShareSnapshot(shareId);
    if (!result.ok) {
      state.shareArrival = {
        shareId,
        loading: false,
        payload: null,
        error: result.error === "expired" ? "expired" : "invalid",
      };
      updateShareArrivalBanner();
      return;
    }

    if (!isImportPayloadValid(result.payload)) {
      state.shareArrival = { shareId, loading: false, payload: null, error: "empty" };
      updateShareArrivalBanner();
      return;
    }

    state.shareArrival = {
      shareId,
      loading: false,
      payload: result.payload,
      error: null,
    };
    pendingImportPayload = result.payload;
    updateShareArrivalBanner();
  }

  function renderEmptyListState() {
    return `
      <div class="empty-state">
        <p class="empty-state__title">${escapeHtml(t("empty.firstTitle"))}</p>
        <p class="empty-state__subtitle">${escapeHtml(t("empty.firstSubtitle"))}</p>
        <ul class="empty-state__hints">
          <li>${escapeHtml(t("empty.hintSearch"))}</li>
          <li>${escapeHtml(t("empty.hintLink"))}</li>
          <li>${escapeHtml(t("empty.hintBulk"))}</li>
        </ul>
        <div class="empty-state__actions">
          <button type="button" class="btn btn--primary empty-state__btn" data-action="add">
            ${escapeHtml(t("btn.addTitle"))}
          </button>
          <button type="button" class="btn btn--ghost empty-state__btn" data-action="open-add-search">
            ${escapeHtml(t("empty.ctaSearch"))}
          </button>
          <button type="button" class="btn btn--ghost empty-state__btn" data-action="open-add-bulk">
            ${escapeHtml(t("empty.ctaBulk"))}
          </button>
          <button type="button" class="btn btn--ghost empty-state__btn" data-action="share">
            ${escapeHtml(t("empty.ctaImport"))}
          </button>
        </div>
      </div>
    `;
  }

  function renderEmptyFilterState() {
    const ratingHint = hasActiveFilters() ? null : emptyStateRatingHint();
    const clearBtn = hasActiveFilters()
      ? `<div class="empty-state__actions">
          <button type="button" class="btn btn--primary empty-state__btn" data-action="clear-filters">
            ${escapeHtml(t("empty.clearFilters"))}
          </button>
        </div>`
      : "";
    return `
      <div class="empty-state">
        <p class="empty-state__title">${escapeHtml(t("empty.noMatch"))}</p>
        <p>${escapeHtml(ratingHint || t("empty.noMatchHint"))}</p>
        ${clearBtn}
      </div>
    `;
  }

  function removeGenreFilter(genre) {
    state.selectedGenres = state.selectedGenres.filter((g) => g !== genre);
  }

  function populateFormGenreSelect(selected) {
    els.formGenre.innerHTML =
      `<option value="" disabled>${t("search.chooseGenre")}</option>` +
      STANDARD_GENRES.map(
        (genre) =>
          `<option value="${escapeHtml(genre)}"${selected === genre ? " selected" : ""}>${escapeHtml(genreLabel(genre))}</option>`
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
      `<option value="">${t("form.addGenre")}</option>` +
      available
        .map(
          (genre) =>
            `<option value="${escapeHtml(genre)}">${escapeHtml(genreLabel(genre))}</option>`
        )
        .join("");

    els.formSecondaryAdd.disabled = available.length === 0;
  }

  function renderSecondaryChips() {
    els.formSecondaryChips.innerHTML = state.formSecondary
      .map(
        (genre) => `
        <span class="genre-chip">
          ${escapeHtml(genreLabel(genre))}
          <button
            type="button"
            class="genre-chip__remove"
            data-action="remove-secondary"
            data-genre="${escapeHtml(genre)}"
            aria-label="${escapeHtml(t("chip.removeGenre", { genre: genreLabel(genre) }))}"
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
            aria-label="${escapeHtml(t("chip.removeLead", { name }))}"
          >×</button>
        </span>
      `
      )
      .join("");
  }

  function syncStatusMeta() {
    if (!window.WatchlistSync?.isConfigured()) return null;

    let status = state.syncStatus === "local" ? "saved" : state.syncStatus;
    if (
      typeof navigator !== "undefined" &&
      navigator.onLine === false &&
      (status === "error" || status === "pending")
    ) {
      status = "offline";
    }

    // Quiet when backed up — only show when something is in progress or needs action.
    if (status === "saved" || status === "local") return null;

    const labels = {
      pending: t("sync.savingShort"),
      error: t("sync.failedShort"),
      offline: t("sync.offlineShort"),
    };

    return {
      status,
      label: labels[status] || labels.error,
      showRetry: status === "error" || status === "offline",
    };
  }

  function updateStats() {
    const total = state.items.length;
    const watchedCount = state.items.filter((i) => isItemWatched(i.id)).length;

    const filteredForTabs = state.items.filter(itemMatchesFiltersExceptType);
    const tabCounts = {
      all: filteredForTabs.length,
      movies: filteredForTabs.filter((i) => i.contentType === "movies").length,
      tvSeries: filteredForTabs.filter((i) => i.contentType === "tvSeries").length,
      anime: filteredForTabs.filter((i) => i.contentType === "anime").length,
    };

    const syncMeta = syncStatusMeta();
    const syncHtml = syncMeta
      ? `<span class="header__stat-chip header__stat-chip--sync" data-status="${escapeHtml(syncMeta.status)}">
           <span class="header__stat-label">${escapeHtml(syncMeta.label)}</span>${
             syncMeta.showRetry
               ? `<button type="button" class="header__sync-retry" data-action="sync-retry" aria-label="${escapeHtml(t("sync.retryAria"))}">${escapeHtml(t("sync.retry"))}</button>`
               : ""
           }
         </span>`
      : "";

    els.stats.innerHTML = `
      <span class="header__stat-chip">
        <span class="header__stat-value text-num">${total}</span>
        <span class="header__stat-label">${escapeHtml(t("stats.totalWord"))}</span>
      </span>
      <span class="header__stat-chip">
        <span class="header__stat-value text-num">${watchedCount}</span>
        <span class="header__stat-label">${escapeHtml(t("stats.watchedWord"))}</span>
      </span>
      ${syncHtml}
    `;

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

  function getAnilistId(item) {
    return window.WatchlistMetadata?.extractAnilistId?.(item.link) || null;
  }

  function itemNeedsImdbBackfill(item) {
    const imdbId = getImdbId(item);
    return Boolean(imdbId && !item.imdbRating);
  }

  function itemNeedsAnilistBackfill(item) {
    if (item.contentType !== "anime" || item.anilistRating) return false;
    if (getAnilistBackfillTarget(item)) return true;
    return Boolean(item.title?.trim());
  }

  async function fetchAnilistMetaForItem(item) {
    const target = getAnilistBackfillTarget(item);
    if (target?.type === "mal") {
      return window.WatchlistMetadata.fetchAnilistByMalId(target.id);
    }
    if (target?.type === "anilist") {
      return window.WatchlistMetadata.fetchAnilistById(target.id);
    }
    if (item.contentType === "anime" && item.title) {
      const score = await window.WatchlistMetadata.fetchAnilistScoreByTitle(
        item.title,
        item.year
      );
      return score ? { anilistRating: score } : null;
    }
    return null;
  }

  function getAnilistBackfillTarget(item) {
    const anilistId = getAnilistId(item);
    if (anilistId) return { type: "anilist", id: anilistId };
    const malId = window.WatchlistMetadata?.extractMalId?.(item.link);
    if (malId) return { type: "mal", id: malId };
    return null;
  }

  function emptyStateRatingHint() {
    const source = state.ratingFilterSource;
    if (!source || source === "all" || source === "personal") return null;

    if (source === "release") {
      if (yearsBackfillRunning) return t("empty.releaseYearLoading");
      if (yearBackfillNeedsMovieApiKeys()) return t("empty.yearsNeedConfig");
      const withYear = state.items.some((item) => hasValidReleaseYear(item));
      if (!withYear) return t("empty.releaseYearMissing");
      return null;
    }

    if (source === "age") {
      if (titleMetaBackfillRunning) return t("empty.ageRatingLoading");
      if (yearBackfillNeedsMovieApiKeys()) return t("empty.yearsNeedConfig");
      const withAge = state.items.some((item) => String(item.ageRating || "").trim());
      if (!withAge) return t("empty.ageRatingMissing");
      return null;
    }

    if (ratingsBackfillRunning) {
      return source === "anilist" ? t("empty.anilistRatingLoading") : t("empty.ratingLoading");
    }

    if (source === "anilist") {
      const hasAnime = state.items.some(
        (item) => item.contentType === "anime" && item.title?.trim()
      );
      if (!hasAnime) return null;
    } else if (source === "imdb") {
      const withLink = state.items.some((item) => getImdbId(item));
      if (!withLink) return null;
    }

    const hasScores = state.items.some((item) => {
      if (source === "imdb") return getItemImdbScore(item) != null;
      if (source === "anilist") return getItemAnilistScore(item) != null;
      return false;
    });

    if (!hasScores) {
      return source === "anilist" ? t("empty.anilistRatingMissing") : t("empty.ratingMissing");
    }
    return null;
  }

  function updateRatingsBackfillBanner({ running, done = 0, total = 0, phase = "" } = {}) {
    if (!els.ratingsBackfillBanner) return;
    const active = running ?? ratingsBackfillRunning ?? yearsBackfillRunning;
    if (!active || total <= 0) {
      els.ratingsBackfillBanner.hidden = true;
      els.ratingsBackfillBanner.textContent = "";
      return;
    }

    const key =
      phase === "year"
        ? "ratings.backfillYear"
        : phase === "anilist"
          ? "ratings.backfillAnilist"
          : phase === "imdb"
            ? "ratings.backfillImdb"
            : "ratings.backfillProgress";
    els.ratingsBackfillBanner.textContent = t(key, { done, total });
    els.ratingsBackfillBanner.hidden = false;
  }

  function itemNeedsYearBackfill(item) {
    if (hasValidReleaseYear(item)) return false;
    if (getImdbId(item)) return true;
    if (item.contentType === "anime" && item.title?.trim()) return true;
    if (getAnilistBackfillTarget(item)) return true;
    if (item.link && window.WatchlistMetadata?.isSupportedLink?.(item.link)) return true;
    return false;
  }

  async function fetchYearForItem(item) {
    const imdbId = getImdbId(item);
    if (
      imdbId &&
      (window.WatchlistMetadata?.hasOmdbKey?.() ||
        window.WatchlistMetadata?.hasTmdbKey?.())
    ) {
      const meta = await window.WatchlistMetadata.getMetadata(imdbId);
      if (meta?.year) return { year: meta.year, anilistRating: meta.anilistRating };
    }

    if (item.link) {
      const meta = await window.WatchlistMetadata.resolveMetadataFromLink(item.link);
      if (meta?.year) return { year: meta.year, anilistRating: meta.anilistRating };
    }

    if (item.contentType === "anime") {
      const target = getAnilistBackfillTarget(item);
      if (target?.type === "anilist") {
        const meta = await window.WatchlistMetadata.fetchAnilistById(target.id);
        if (meta?.year) return { year: meta.year, anilistRating: meta.anilistRating };
      }
      if (target?.type === "mal") {
        const meta = await window.WatchlistMetadata.fetchAnilistByMalId(target.id);
        if (meta?.year) return { year: meta.year, anilistRating: meta.anilistRating };
      }
      if (item.title?.trim()) {
        const meta = await window.WatchlistMetadata.fetchAnilistMatchByTitle(
          item.title,
          item.year
        );
        if (meta?.year) return { year: meta.year, anilistRating: meta.anilistRating };
      }
    }

    return null;
  }

  function yearBackfillNeedsMovieApiKeys() {
    const hasMovieKeys =
      window.WatchlistMetadata?.hasOmdbKey?.() ||
      window.WatchlistMetadata?.hasTmdbKey?.();
    if (hasMovieKeys) return false;

    return state.items.some((item) => {
      if (hasValidReleaseYear(item) || !itemNeedsYearBackfill(item)) return false;
      if (getImdbId(item)) return true;
      if (item.contentType !== "anime" && item.link) return true;
      return false;
    });
  }

  async function backfillMissingYears() {
    if (yearsBackfillRunning) return;

    const queue = state.items.filter(itemNeedsYearBackfill);
    if (!queue.length) return;

    const listId = state.activeListId;
    if (!listId) return;

    if (yearBackfillNeedsMovieApiKeys()) {
      if (isReleaseSortActive()) render();
      return;
    }

    yearsBackfillRunning = true;
    let done = 0;
    const total = queue.length;
    let updated = 0;
    updateRatingsBackfillBanner({ running: true, done, total, phase: "year" });
    if (isReleaseSortActive()) render();

    for (const item of queue) {
      if (!yearsBackfillRunning || !canPersistActiveList(listId)) break;
      try {
        const meta = await fetchYearForItem(item);
        const year = formatReleaseYearDisplay(meta?.year);
        if (year) {
          item.year = year;
          updated += 1;
          if (!item.anilistRating && meta?.anilistRating) {
            item.anilistRating = meta.anilistRating;
          }
          if (updated % 3 === 0) {
            state.data = itemsToNested(state.items);
            saveData();
            render();
          }
        }
      } catch (error) {
        console.warn("[years] backfill failed:", item.title, error);
      }

      done += 1;
      updateRatingsBackfillBanner({ running: true, done, total, phase: "year" });
      await new Promise((resolve) => setTimeout(resolve, 280));
    }

    yearsBackfillRunning = false;
    updateRatingsBackfillBanner({ running: false });

    if (updated > 0) {
      state.data = itemsToNested(state.items);
      saveData();
      render();
    } else if (isReleaseSortActive()) {
      render();
    }
  }

  async function backfillMissingRatings() {
    if (ratingsBackfillRunning) return;

    const anilistQueue = state.items.filter(itemNeedsAnilistBackfill);
    const imdbQueue = state.items.filter(itemNeedsImdbBackfill);
    if (!anilistQueue.length && !imdbQueue.length) {
      return;
    }

    const listId = state.activeListId;
    if (!listId) return;

    ratingsBackfillRunning = true;
    const total = anilistQueue.length + imdbQueue.length;
    let done = 0;
    updateRatingsBackfillBanner({ running: true, done, total, phase: "anilist" });
    if (state.ratingFilterSource !== "all") render();

    let updated = 0;

    const applyAnilistBackfill = async (item) => {
      const meta = await fetchAnilistMetaForItem(item);
      let changed = false;
      if (meta?.anilistRating && !item.anilistRating) {
        item.anilistRating = meta.anilistRating;
        changed = true;
      }
      if (meta) {
        const before = itemHasTitleMeta(item);
        window.WatchlistMetadata.applyTitleMetaFromDetails(meta, item);
        if (!before && itemHasTitleMeta(item)) changed = true;
      }
      if (changed) {
        updated += 1;
        state.data = itemsToNested(state.items);
        saveData();
        render();
        return true;
      }
      return false;
    };

    for (const item of anilistQueue) {
      if (!ratingsBackfillRunning || !canPersistActiveList(listId)) break;
      try {
        await applyAnilistBackfill(item);
      } catch (error) {
        console.warn("[ratings] anilist backfill failed:", item.title, error);
      }
      done += 1;
      updateRatingsBackfillBanner({ running: true, done, total, phase: "anilist" });
      await new Promise((resolve) => setTimeout(resolve, 320));
    }

    if (imdbQueue.length) {
      updateRatingsBackfillBanner({ running: true, done, total, phase: "imdb" });
    }

    for (const item of imdbQueue) {
      if (!ratingsBackfillRunning || !canPersistActiveList(listId)) break;
      try {
        if (!window.WatchlistMetadata?.hasOmdbKey?.()) break;

        const imdbId = getImdbId(item);
        const meta = await window.WatchlistMetadata.getMetadata(imdbId);
        let changed = false;
        if (meta?.rating && !item.imdbRating) {
          item.imdbRating = meta.rating;
          changed = true;
        }
        if (meta) {
          const before = itemHasTitleMeta(item);
          window.WatchlistMetadata.applyTitleMetaFromDetails(meta, item);
          if (!before && itemHasTitleMeta(item)) changed = true;
        }
        if (changed) {
          updated += 1;
          if (state.ratingFilterSource !== "all" && updated % 3 === 0) {
            state.data = itemsToNested(state.items);
            saveData();
            render();
          }
        }
      } catch (error) {
        console.warn("[ratings] imdb backfill failed:", item.title, error);
      }

      done += 1;
      updateRatingsBackfillBanner({ running: true, done, total, phase: "imdb" });
      await new Promise((resolve) => setTimeout(resolve, 280));
    }

    ratingsBackfillRunning = false;
    updateRatingsBackfillBanner({ running: false });

    if (updated > 0) {
      state.data = itemsToNested(state.items);
      saveData();
      render();
    } else if (state.ratingFilterSource !== "all") {
      render();
    }
  }

  function itemHasTitleMeta(item) {
    if (item?.ageRating) return true;
    if (item?.runtime) return true;
    const seasons = parseInt(String(item?.seasonCount || "").trim(), 10);
    if (Number.isFinite(seasons) && seasons > 0) return true;
    const episodes = parseInt(String(item?.episodeCount || "").trim(), 10);
    if (Number.isFinite(episodes) && episodes > 0) return true;
    return false;
  }

  function itemNeedsEpisodeRuntime(item) {
    if (item?.contentType === "movies") return false;
    if (item?.runtime) return false;
    return true;
  }

  function itemNeedsTitleMetaBackfill(item) {
    const hasLink =
      getImdbId(item) ||
      Boolean(item?.link && window.WatchlistMetadata?.isSupportedLink?.(item.link));
    if (!hasLink) return false;
    if (!itemHasTitleMeta(item)) return true;
    return itemNeedsEpisodeRuntime(item);
  }

  async function backfillTitleMeta() {
    if (titleMetaBackfillRunning) return;

    const queue = state.items.filter(itemNeedsTitleMetaBackfill);
    if (!queue.length) return;

    const listId = state.activeListId;
    if (!listId) return;

    titleMetaBackfillRunning = true;
    let updated = 0;

    for (const item of queue) {
      if (!titleMetaBackfillRunning || !canPersistActiveList(listId)) break;
      try {
        let meta = null;
        const imdbId = getImdbId(item);
        if (imdbId) {
          meta = await window.WatchlistMetadata?.getMetadata(imdbId);
        } else if (window.WatchlistMetadata?.isSupportedLink?.(item.link)) {
          meta = await window.WatchlistMetadata.resolveMetadataFromLink(item.link);
        }

        if (meta) {
          const before = itemHasTitleMeta(item);
          const beforeRuntime = item.runtime || "";
          window.WatchlistMetadata.applyTitleMetaFromDetails(meta, item);
          if (
            (!before && itemHasTitleMeta(item)) ||
            (!beforeRuntime && item.runtime)
          ) {
            updated += 1;
          }
        }
      } catch (error) {
        console.warn("[title-meta] backfill failed:", item.title, error);
      }

      await new Promise((resolve) => setTimeout(resolve, 280));
    }

    titleMetaBackfillRunning = false;

    if (updated > 0) {
      state.data = itemsToNested(state.items);
      saveData();
      render();
    }
  }

  async function runMetadataBackfill() {
    if (isReleaseSortActive()) {
      await backfillMissingYears();
      await backfillMissingRatings();
      await backfillTitleMeta();
      return;
    }
    await backfillMissingRatings();
    await backfillMissingYears();
    await backfillTitleMeta();
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
    const anilistRating = meta?.anilistRating || item.anilistRating || "";
    const plot = meta?.plot || item.summary || parseSummary(item) || "";
    const poster = meta?.poster || item.poster || "";
    const contentType = meta?.contentType || item.contentType || "";
    const titleMetaBadges = renderTitleMetaBadges({
      ageRating: meta?.ageRating || item.ageRating || "",
      runtime: meta?.runtime || item.runtime || "",
      seasonCount: meta?.seasonCount || item.seasonCount || null,
      episodeCount: meta?.episodeCount || item.episodeCount || null,
      contentType,
    });
    const metaParts = [
      year,
      rating ? `IMDb ${rating}` : "",
      anilistRating ? `AniList ${formatAnilistDisplay(anilistRating)}` : "",
    ].filter(Boolean);

    return { title, year, rating, plot, poster, metaParts, titleMetaBadges };
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
            details.titleMetaBadges || details.metaParts.length
              ? `<div class="link-preview-popover__meta-row">${
                  details.titleMetaBadges
                    ? `<div class="card__meta-badges">${details.titleMetaBadges}</div>`
                    : ""
                }${
                  details.metaParts.length
                    ? `<p class="link-preview-popover__meta">${escapeHtml(details.metaParts.join(" · "))}</p>`
                    : ""
                }</div>`
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
    if (imdbId) {
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

    if (item.link && window.WatchlistMetadata?.isSupportedLink(item.link)) {
      if (item.poster && item.summary) {
        return {
          title: item.title,
          poster: item.poster,
          rating: item.imdbRating || "",
          year: item.year || "",
          plot: item.summary || parseSummary(item),
        };
      }
      return window.WatchlistMetadata?.resolveMetadataFromLink(item.link);
    }

    return null;
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
    const slot = card.querySelector(
      "[data-poster-slot], .card__poster--placeholder, .card__poster--broken, .card__poster"
    );
    if (!slot || !posterUrl) return;

    const img = document.createElement("img");
    img.className = "card__poster";
    img.loading = "lazy";
    img.alt = "";
    img.src = posterUrl;
    img.addEventListener(
      "error",
      () => {
        const item = state.items.find((entry) => entry.id === card.dataset.id);
        markCardPosterBroken(card, item);
      },
      { once: true }
    );
    slot.replaceWith(img);
  }

  function posterPlaceholderMarkup(broken = false) {
    if (broken) {
      return `<div class="card__poster card__poster--placeholder card__poster--broken" data-poster-slot data-poster-broken="true" role="status">
        <span class="card__poster-message">${escapeHtml(t("card.posterBroken"))}</span>
      </div>`;
    }
    return `<div class="card__poster card__poster--placeholder" data-poster-slot aria-hidden="true">🎬</div>`;
  }

  function markCardPosterBroken(card, item) {
    if (!card) return;
    if (item) item.posterBroken = true;

    const target = card.querySelector(
      ".card__poster, [data-poster-slot], .card__poster--broken"
    );
    if (!target) return;

    const replacement = posterPlaceholderMarkup(true);
    if (target.outerHTML) {
      target.outerHTML = replacement;
    }
  }

  function bindPosterErrorHandlers() {
    els.main.querySelectorAll(".card__poster[src]").forEach((img) => {
      if (img.dataset.posterErrorBound === "1") return;
      img.dataset.posterErrorBound = "1";
      img.addEventListener(
        "error",
        () => {
          const card = img.closest(".card");
          const item = state.items.find((entry) => entry.id === card?.dataset?.id);
          markCardPosterBroken(card, item);
        },
        { once: true }
      );
    });
  }

  async function hydratePosters() {
    const cards = els.main.querySelectorAll(".card--linked");
    for (const card of cards) {
      const item = state.items.find((entry) => entry.id === card.dataset.id);
      if (!item?.link || item.posterBroken) continue;

      if (item.poster) {
        setCardPoster(card, item.poster);
        continue;
      }

      const imdbId = getImdbId(item);
      let meta = null;
      if (imdbId) {
        meta = await window.WatchlistMetadata?.getMetadata(imdbId);
      } else if (window.WatchlistMetadata?.isSupportedLink(item.link)) {
        meta = await window.WatchlistMetadata?.resolveMetadataFromLink(item.link);
      }

      if (meta) {
        window.WatchlistMetadata?.applyTitleMetaFromDetails(meta, item);
        if (meta.poster) {
          item.poster = meta.poster;
          setCardPoster(card, meta.poster);
        } else {
          markCardPosterBroken(card, item);
        }
      } else {
        markCardPosterBroken(card, item);
      }
    }
  }

  function shouldHydratePosters() {
    return state.cardLayout === "poster";
  }

  function applyPostRender() {
    applyCardLayout();
    bindPosterErrorHandlers();
    if (shouldHydratePosters()) {
      hydratePosters();
    }
  }

  function renderWatchedCheck() {
    return `<span class="card__watched-check" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></span>`;
  }

  function renderTitleMetaBadges(item) {
    const badges =
      window.WatchlistMetadata?.buildTitleMetaBadges(item, item.contentType) || [];
    if (!badges.length) return "";
    return badges
      .map(
        (badge) => {
          const titleAttr =
            badge.kind === "age" && badge.title
              ? ` title="${escapeHtml(badge.title)}"`
              : "";
          return `<span class="badge badge--${badge.kind}"${titleAttr}>${escapeHtml(badge.label)}</span>`;
        }
      )
      .join("");
  }

  function renderCardSection(labelKey, content, modifierClass = "") {
    const body = String(content || "").trim();
    if (!body) return "";
    return `
      <div class="card__section ${modifierClass}">
        <span class="card__section-label">${escapeHtml(t(labelKey))}</span>
        ${body}
      </div>
    `;
  }

  function renderCard(item) {
    const typeBadge = getTypeBadge(item);
    const isWatched = isItemWatched(item.id);
    const watchEntry = getWatchEntry(item.id);
    const rated = isWatched && hasWatchRating(watchEntry);
    const progressState = itemProgressState(item.id);
    const altTitle = item.altTitle
      ? `<span class="card__alt text-ltr">${escapeHtml(ltr(item.altTitle))}</span>`
      : "";
    const secondaryBadges = (item.secondaryGenres || [])
      .map(
        (genre) =>
          `<span class="badge badge--genre-secondary">${escapeHtml(genreLabel(genre))}</span>`
      )
      .join("");
    const mainGenreBadge = item.genre
      ? `<span class="badge badge--genre-primary">${escapeHtml(genreLabel(item.genre))}</span>`
      : "";

    const imdbId = getImdbId(item);
    const linkedClass = item.link ? " card--linked" : "";
    const linkAttr = item.link
      ? ` data-link="${escapeHtml(item.link)}" title="${escapeHtml(t("card.openLink"))}"`
      : "";
    const imdbAttr = imdbId ? ` data-imdb-id="${escapeHtml(imdbId)}"` : "";
    const externalScores = renderExternalRatings(item);
    const yearBadge = renderReleaseYearBadge(item);
    const hasLink = Boolean(item.link);
    const titleMetaBadges = renderTitleMetaBadges(item);
    const genreBadges = `${mainGenreBadge}${secondaryBadges}`;
    const titleBlock = `
      <div class="card__top">
        ${progressState === "watched" ? renderWatchedCheck() : ""}
        <h3 class="card__title">
          <span class="text-ltr">${escapeHtml(ltr(item.title))}</span>
          ${altTitle}
        </h3>
      </div>
    `;
    const detailsContent = `
      <div class="card__info-row">
        <span class="badge badge--${typeBadge.className}">${escapeHtml(typeBadge.label)}</span>
        ${yearBadge}
        ${titleMetaBadges}
      </div>
    `;
    const cardSections = `
      <div class="card__sections">
        ${detailsContent}
        ${
          genreBadges
            ? renderCardSection(
                "card.sectionGenres",
                `<div class="card__genre-row">${genreBadges}</div>`,
                "card__section--genres"
              )
            : ""
        }
      </div>
    `;
    const overlaySections = `
      <div class="card__sections card__sections--overlay">
        ${detailsContent}
        ${
          genreBadges
            ? renderCardSection(
                "card.sectionGenres",
                `<div class="card__genre-row card__genre-row--single-line">${genreBadges}</div>`,
                "card__section--genres"
              )
            : ""
        }
      </div>
    `;
    const overlayBlock = `${overlaySections}${titleBlock}`;

    const posterBlock = hasLink
      ? `<div class="card__media">${
          item.posterBroken
            ? posterPlaceholderMarkup(true)
            : item.poster
              ? `<img class="card__poster" src="${escapeHtml(item.poster)}" alt="" loading="lazy" />`
              : posterPlaceholderMarkup(false)
        }<div class="card__overlay">${overlayBlock}</div></div>`
      : "";

    const useCardBody = state.cardLayout === "poster" || hasLink;
    const bodyStart = useCardBody ? '<div class="card__body">' : "";
    const bodyEnd = useCardBody ? "</div>" : "";
    const bodyHeader = `<div class="card__head">${titleBlock}${cardSections}</div>`;
    const listIds = window.WatchlistAuth?.discoverListIds() || [];
    const canMoveToList = listIds.length > 1;
    const ratingFooter = rated
      ? `<button
          type="button"
          class="card__rating card__rating--rated"
          data-action="rate"
          data-id="${escapeHtml(item.id)}"
          aria-label="${escapeHtml(t("mobile.editRating"))}"
        >
          <div class="card__rating-top">
            <span class="card__rating-label">${escapeHtml(t("card.yourRating"))}</span>
            <span class="card__rating-score text-num">${escapeHtml(formatWatchRating(watchEntry.rating))}/10</span>
          </div>
          ${
            watchEntry.note
              ? `<p class="card__rating-note">${escapeHtml(watchEntry.note)}</p>`
              : ""
          }
        </button>`
      : isWatched
        ? `<div class="card__rating card__rating--pending">
            <div class="card__rating-top">
              <span class="card__rating-label">${escapeHtml(t("card.yourRating"))}</span>
              <button
                type="button"
                class="btn btn--ghost btn--sm card__rate-btn"
                data-action="rate"
                data-id="${escapeHtml(item.id)}"
              >
                ${escapeHtml(t("card.rate"))}
              </button>
            </div>
          </div>`
        : `<span class="card__footer-badge card__footer-badge--unwatched">${escapeHtml(t("card.notWatchedShort"))}</span>`;

    const mobileFooter = !isWatched
      ? `<span class="card__watch-status">${escapeHtml(t("card.notWatchedShort"))}</span>`
      : rated
        ? `<div class="card__watch-rating">
            <div class="card__watch-rating-top">
              <span class="card__watch-rating-label">${escapeHtml(t("card.yourRating"))}</span>
              <span class="card__watch-rating-score">${escapeHtml(formatWatchRating(watchEntry.rating))}/10</span>
            </div>
            ${
              watchEntry.note
                ? `<p class="card__watch-rating-note">${escapeHtml(watchEntry.note)}</p>`
                : ""
            }
          </div>`
        : progressState === "inProgress"
          ? `<span class="card__watch-status card__watch-status--in-progress">${escapeHtml(t("card.inProgress"))}</span>`
          : `<span class="card__watch-status card__watch-status--watched">${escapeHtml(t("card.watched"))}</span>`;
    const moveToListItem = canMoveToList
      ? `<button
          type="button"
          class="card-menu__item"
          role="menuitem"
          data-action="move-to-list"
          data-id="${escapeHtml(item.id)}"
        >
          ${escapeHtml(t("card.moveToList"))}
        </button>`
      : "";

    const openLinkItem = item.link
      ? `<button
          type="button"
          class="card-menu__item"
          role="menuitem"
          data-action="open-card-link"
          data-link="${escapeHtml(item.link)}"
          data-id="${escapeHtml(item.id)}"
        >
          ${escapeHtml(t("card.openLink"))}
        </button>`
      : "";

    const watchedLabel = isWatched ? t("card.markUnwatched") : t("card.markWatched");
    const cardProgressClass = progressState === "inProgress" ? " card--in-progress" : "";

    return `
      <article class="card${linkedClass}${progressState === "watched" ? " card--watched" : ""}${cardProgressClass}" data-id="${escapeHtml(item.id)}"${linkAttr}${imdbAttr}>
        ${posterBlock}
        ${bodyStart}
        ${bodyHeader}
        <p class="card__lead">${escapeHtml((item.leads || parseLeads(item)).join(", "))}</p>
        <p class="card__summary">${escapeHtml(item.summary || parseSummary(item))}</p>
        ${externalScores}
        <div class="card__footer">
          <div class="card__footer-mobile">${mobileFooter}</div>
          ${ratingFooter}
          <div class="card-menu">
            <button
              type="button"
              class="card-menu__trigger"
              data-action="toggle-card-menu"
              data-id="${escapeHtml(item.id)}"
              aria-label="${escapeHtml(t("card.actions"))}"
              aria-haspopup="menu"
              aria-expanded="false"
            >
              <span class="card-menu__trigger-icon card-menu__trigger-icon--desktop" aria-hidden="true">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <circle cx="12" cy="5" r="1.75" fill="currentColor"/>
                  <circle cx="12" cy="12" r="1.75" fill="currentColor"/>
                  <circle cx="12" cy="19" r="1.75" fill="currentColor"/>
                </svg>
              </span>
              <svg class="card-menu__trigger-icon card-menu__trigger-icon--mobile" viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="12" cy="5" r="1.75" fill="currentColor"/>
                <circle cx="12" cy="12" r="1.75" fill="currentColor"/>
                <circle cx="12" cy="19" r="1.75" fill="currentColor"/>
              </svg>
            </button>
            <div class="card-menu__panel" hidden role="menu">
              ${openLinkItem}
              <button
                type="button"
                class="card-menu__item"
                role="menuitem"
                data-action="toggle-watched"
                data-id="${escapeHtml(item.id)}"
              >
                ${escapeHtml(watchedLabel)}
              </button>
              <button
                type="button"
                class="card-menu__item"
                role="menuitem"
                data-action="edit"
                data-id="${escapeHtml(item.id)}"
              >
                ${escapeHtml(t("card.edit"))}
              </button>
              ${moveToListItem}
              <button
                type="button"
                class="card-menu__item card-menu__item--danger"
                role="menuitem"
                data-action="delete"
                data-id="${escapeHtml(item.id)}"
              >
                ${escapeHtml(t("card.delete"))}
              </button>
            </div>
          </div>
        </div>
        ${bodyEnd}
      </article>
    `;
  }

  function render() {
    updateClearFiltersButton();
    updateGenreOptions();
    const filtered = getFilteredItems();
    updateStats();

    if (state.items.length === 0) {
      els.main.innerHTML = renderEmptyListState();
      return;
    }

    if (filtered.length === 0) {
      els.main.innerHTML = renderEmptyFilterState();
      return;
    }

    const groups = groupItems(filtered);
    const html = groups
      .map((group) => {
        const cards = group.items.map(renderCard).join("");
        if (group.isRatingSorted) {
          return `<div class="cards cards--rating-sorted">${cards}</div>`;
        }

        const meta = group.contentType ? TYPE_META[group.contentType] : null;
        const sectionId = group.isAllMatch
          ? `all-match-${group.genre}`
          : group.contentType
            ? `${group.contentType}-${group.genre}`
            : group.genre;
        const typeBadge = meta
          ? `<span class="genre-section__type genre-section__type--${meta.className}">${escapeHtml(typeSectionShort(group.contentType))}</span>`
          : "";
        const allMatchBadge = group.isAllMatch
          ? `<span class="genre-section__match">${escapeHtml(t("genre.allSelected"))}</span>`
          : "";

        return `
          <section class="genre-section${group.isAllMatch ? " genre-section--all-match" : ""}" id="${escapeHtml(sectionId.replace(/\W+/g, "-"))}">
            <header class="genre-section__header">
              <div class="genre-section__bar">
                <div class="genre-section__badges">
                  ${typeBadge}
                  ${allMatchBadge}
                </div>
                <h2 class="genre-section__title">${escapeHtml(genreLabel(group.genre))}</h2>
                <span class="genre-section__count">${escapeHtml(window.WatchlistI18n?.titleCount(group.items.length) || `${group.items.length} titles`)}</span>
              </div>
            </header>
            <div class="cards">${cards}</div>
          </section>
        `;
      })
      .join("");

    els.main.innerHTML = html;
    applyPostRender();
  }

  function formKindForItem(contentType, existingKind) {
    if (contentType !== "movies") return "series";
    if (existingKind === "film series") return "film series";
    return "movie";
  }

  function setBulkPasteError(message) {
    if (!els.bulkPasteError) return;
    els.bulkPasteError.hidden = !message;
    els.bulkPasteError.textContent = localizeMessage(message);
    els.bulkPasteError.classList.toggle("backup-modal__hint--error", Boolean(message));
    if (message) {
      els.bulkPasteError.setAttribute("role", "alert");
    } else {
      els.bulkPasteError.removeAttribute("role");
    }
  }

  function getSearchConfirmPrimaryGenre() {
    return normalizeGenre(els.searchConfirmGenre?.value?.trim() || "");
  }

  function setSearchConfirmSecondary(genres) {
    const primary = getSearchConfirmPrimaryGenre();
    state.searchConfirmSecondary = normalizeSecondaryGenres(primary, genres);
    renderSearchConfirmSecondaryChips();
    updateSearchConfirmSecondaryOptions();
  }

  function addSearchConfirmSecondary(genre) {
    const primary = getSearchConfirmPrimaryGenre();
    if (!genre || genre === primary) return;
    state.searchConfirmSecondary = normalizeSecondaryGenres(primary, [
      ...state.searchConfirmSecondary,
      genre,
    ]);
    renderSearchConfirmSecondaryChips();
    updateSearchConfirmSecondaryOptions();
  }

  function removeSearchConfirmSecondary(genre) {
    state.searchConfirmSecondary = state.searchConfirmSecondary.filter(
      (g) => g !== genre
    );
    renderSearchConfirmSecondaryChips();
    updateSearchConfirmSecondaryOptions();
  }

  function updateSearchConfirmSecondaryOptions() {
    if (!els.searchConfirmSecondaryAdd) return;
    const primary = getSearchConfirmPrimaryGenre();
    const taken = new Set([primary, ...state.searchConfirmSecondary]);
    const available = STANDARD_GENRES.filter((g) => !taken.has(g));

    els.searchConfirmSecondaryAdd.innerHTML =
      `<option value="">${t("form.addGenre")}</option>` +
      available
        .map(
          (genre) =>
            `<option value="${escapeHtml(genre)}">${escapeHtml(genreLabel(genre))}</option>`
        )
        .join("");

    els.searchConfirmSecondaryAdd.disabled = available.length === 0;
  }

  function renderSearchConfirmSecondaryChips() {
    if (!els.searchConfirmSecondaryChips) return;
    els.searchConfirmSecondaryChips.innerHTML = state.searchConfirmSecondary
      .map(
        (genre) => `
        <span class="genre-chip genre-chip--secondary">
          ${escapeHtml(genreLabel(genre))}
          <button
            type="button"
            class="genre-chip__remove"
            data-action="remove-search-secondary"
            data-genre="${escapeHtml(genre)}"
            aria-label="${escapeHtml(t("chip.removeGenre", { genre: genreLabel(genre) }))}"
          >×</button>
        </span>
      `
      )
      .join("");
  }

  function formatSearchConfirmRating(details) {
    if (!details) return "";
    if (details.anilistRating || details.source === "anilist") {
      const pct = formatAnilistDisplay(details.anilistRating || details.rating);
      if (pct) return pct;
    }
    const score = formatImdbDisplay(details.rating);
    return score ? `${score}/10` : "";
  }

  function renderTitlePreview(container, details) {
    if (!container || !details) return;

    const poster = details.poster
      ? `<img class="title-search-confirm__poster" src="${escapeHtml(details.poster)}" alt="" />`
      : `<div class="title-search-confirm__poster title-search-confirm__poster--empty" aria-hidden="true">🎬</div>`;
    const yearHtml = details.year
      ? `<span class="title-search-confirm__year">${escapeHtml(String(details.year))}</span>`
      : "";
    const rating = formatSearchConfirmRating(details);
    const ratingHtml = rating
      ? `<span class="title-search-confirm__rating">${escapeHtml(rating)}</span>`
      : "";
    const titleMetaBadges = renderTitleMetaBadges(details);
    const titleMetaHtml = titleMetaBadges
      ? `<span class="title-search-confirm__meta-badges">${titleMetaBadges}</span>`
      : "";
    const actors = details.actors?.length
      ? details.actors.slice(0, 4)
      : details.director
        ? [details.director]
        : [];
    const actorsHtml = actors.length
      ? `<span class="title-search-confirm__actors">${actors
          .map(
            (name) =>
              `<span class="title-search-confirm__actor">${escapeHtml(name)}</span>`
          )
          .join("")}</span>`
      : "";

    container.innerHTML = `
      ${poster}
      <div class="title-search-confirm__body">
        <h3 class="title-search-confirm__name">${escapeHtml(details.title)}</h3>
        ${
          yearHtml || titleMetaHtml || ratingHtml || actorsHtml
            ? `<div class="title-search-confirm__meta">${yearHtml}${titleMetaHtml}${ratingHtml}${actorsHtml}</div>`
            : ""
        }
        <p class="title-search-confirm__plot">${escapeHtml(details.plot || t("search.noSummary"))}</p>
      </div>
    `;
  }

  function renderSearchConfirmPreview(details) {
    renderTitlePreview(els.searchConfirmPreview, details);
  }

  function populateSearchConfirmGenreSelect(selected) {
    if (!els.searchConfirmGenre) return;
    els.searchConfirmGenre.innerHTML =
      `<option value="" disabled>${t("search.chooseGenre")}</option>` +
      STANDARD_GENRES.map(
        (genre) =>
          `<option value="${escapeHtml(genre)}"${selected === genre ? " selected" : ""}>${escapeHtml(genreLabel(genre))}</option>`
      ).join("");
  }

  function setTitleSearchStatus(message, { error = false } = {}) {
    if (!els.titleSearchStatus) return;
    els.titleSearchStatus.textContent = message || "";
    els.titleSearchStatus.classList.toggle("title-search__status--error", Boolean(error));
  }

  function formatSearchResultType(type) {
    const value = String(type || "").toLowerCase();
    if (value === "movie") return t("searchResult.movie");
    if (value === "series") return t("searchResult.series");
    if (value === "anime") return t("searchResult.anime");
    if (value === "episode") return t("searchResult.episode");
    return type || t("searchResult.title");
  }

  function searchPickFromButton(button) {
    if (!button) return null;
    return {
      source: button.dataset.pickSource || "omdb",
      imdbId: button.dataset.imdbId || null,
      anilistId: button.dataset.anilistId ? Number(button.dataset.anilistId) : null,
      tmdbType: button.dataset.tmdbType || null,
      tmdbId: button.dataset.tmdbId ? Number(button.dataset.tmdbId) : null,
    };
  }

  function hasLookupId(pick) {
    return Boolean(pick?.imdbId || pick?.anilistId || pick?.tmdbId);
  }

  function normalizeTitleKey(title) {
    return String(title || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  function searchResultFromPick(pick) {
    if (!pick) return null;
    return (
      state.searchResults.find((result) => {
        if (pick.imdbId && result.imdbId) {
          return result.imdbId.toLowerCase() === pick.imdbId.toLowerCase();
        }
        if (pick.anilistId && result.anilistId) {
          return Number(result.anilistId) === Number(pick.anilistId);
        }
        if (pick.tmdbId && result.tmdbId) {
          return (
            Number(result.tmdbId) === Number(pick.tmdbId) &&
            (!pick.tmdbType || result.tmdbType === pick.tmdbType)
          );
        }
        return false;
      }) || null
    );
  }

  function isSearchResultOnList(result) {
    if (!result?.title) return false;

    const imdbId = result.imdbId ? String(result.imdbId).toLowerCase() : "";
    const anilistId = result.anilistId ? String(result.anilistId) : "";
    const titleKey = normalizeTitleKey(result.title);
    const resultYear = String(result.year || "").slice(0, 4);

    return state.items.some((item) => {
      if (imdbId) {
        const itemImdb = getImdbId(item);
        if (itemImdb && itemImdb === imdbId) return true;
      }
      if (anilistId) {
        const itemAnilist = getAnilistId(item);
        if (itemAnilist && itemAnilist === anilistId) return true;
      }
      if (!titleKey) return false;
      if (normalizeTitleKey(item.title) !== titleKey) return false;
      if (resultYear && item.year) {
        return String(item.year).slice(0, 4) === resultYear;
      }
      return true;
    });
  }

  function renderTitleSearchResults() {
    if (!els.titleSearchResults) return;

    if (!state.searchResults.length) {
      els.titleSearchResults.innerHTML = "";
      state.searchResultFocusIndex = -1;
      return;
    }

    els.titleSearchResults.setAttribute("role", "listbox");
    els.titleSearchResults.setAttribute("aria-label", t("search.label"));

    els.titleSearchResults.innerHTML = state.searchResults
      .map((result, index) => {
        const onList = isSearchResultOnList(result);
        const poster = result.poster
          ? `<img class="title-search__poster" src="${escapeHtml(result.poster)}" alt="" loading="lazy" />`
          : `<div class="title-search__poster title-search__poster--empty" aria-hidden="true">🎬</div>`;
        const meta = [result.year, formatSearchResultType(result.type)]
          .filter(Boolean)
          .join(" · ");
        const pickLabel = onList
          ? `${result.title} — ${t("search.alreadyOnList")}`
          : t("search.pickResult", { title: result.title, meta });
        const listBadge = onList
          ? `<span class="title-search__badge">${escapeHtml(t("search.alreadyOnList"))}</span>`
          : "";
        const tabIndex = index === state.searchResultFocusIndex ? "0" : "-1";
        return `<li role="presentation">
          <button
            type="button"
            class="title-search__item${onList ? " title-search__item--on-list" : ""}"
            data-action="pick-search-result"
            data-pick-source="${escapeHtml(result.source || "omdb")}"
            data-imdb-id="${escapeHtml(result.imdbId || "")}"
            data-anilist-id="${result.anilistId || ""}"
            data-tmdb-type="${escapeHtml(result.tmdbType || "")}"
            data-tmdb-id="${result.tmdbId || ""}"
            role="option"
            aria-selected="false"
            aria-disabled="${onList ? "true" : "false"}"
            aria-label="${escapeHtml(pickLabel)}"
            tabindex="${tabIndex}"
            ${onList ? "disabled" : ""}
          >
            ${poster}
            <span class="title-search__info">
              <span class="title-search__title text-ltr">${escapeHtml(ltr(result.title))}</span>
              <span class="title-search__meta">${escapeHtml(meta)}</span>
            </span>
            ${listBadge}
          </button>
        </li>`;
      })
      .join("");

    if (els.titleSearchMore) {
      const hasMore = state.searchResults.length < state.searchTotal;
      els.titleSearchMore.hidden = !hasMore || state.searchLoading;
    }
  }

  function getSearchResultButtons() {
    return [
      ...(els.titleSearchResults?.querySelectorAll(
        "[data-action='pick-search-result']:not([disabled])"
      ) || []),
    ];
  }

  function focusSearchResult(index) {
    const buttons = getSearchResultButtons();
    if (!buttons.length) {
      state.searchResultFocusIndex = -1;
      return;
    }
    const next = Math.max(0, Math.min(index, buttons.length - 1));
    state.searchResultFocusIndex = next;
    buttons.forEach((button, buttonIndex) => {
      button.tabIndex = buttonIndex === next ? 0 : -1;
      button.setAttribute("aria-selected", String(buttonIndex === next));
    });
    buttons[next]?.focus();
  }

  function handleTitleSearchKeydown(event) {
    if (els.modal?.hidden || state.addMode !== "search" || isSearchConfirmVisible()) return;

    const buttons = getSearchResultButtons();
    if (!buttons.length) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      focusSearchResult(state.searchResultFocusIndex < 0 ? 0 : state.searchResultFocusIndex + 1);
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      focusSearchResult(
        state.searchResultFocusIndex <= 0 ? 0 : state.searchResultFocusIndex - 1
      );
      return;
    }

    if (event.key === "Enter" && state.searchResultFocusIndex >= 0) {
      if (document.activeElement?.closest("#titleSearchResults")) {
        event.preventDefault();
        buttons[state.searchResultFocusIndex]?.click();
      }
    }
  }

  function resetSearchAddState() {
    clearTimeout(searchDebounceTimer);
    state.searchQuery = "";
    state.searchPage = 1;
    state.searchTotal = 0;
    state.searchResults = [];
    state.searchResultFocusIndex = -1;
    state.searchLoading = false;
    state.searchPickDetails = null;
    state.searchConfirmSecondary = [];

    if (els.titleSearchInput) els.titleSearchInput.value = "";
    if (els.titleSearchType) {
      const typeFilter =
        state.type === "movies"
          ? "movie"
          : state.type === "tvSeries"
            ? "series"
            : state.type === "anime"
              ? "anime"
              : "all";
      els.titleSearchType.value = typeFilter;
    }
    if (els.titleSearchResults) els.titleSearchResults.innerHTML = "";
    if (els.titleSearchMore) els.titleSearchMore.hidden = true;
    if (els.searchAddStep) els.searchAddStep.hidden = false;
    if (els.searchConfirmStep) els.searchConfirmStep.hidden = true;
    setTitleSearchStatus("");
  }

  function showSearchConfirmStep(details) {
    if (!els.searchAddStep || !els.searchConfirmStep || !details) return;

    searchConfirmReturnFocus = document.activeElement;
    state.searchPickDetails = details;
    els.searchAddStep.hidden = true;
    els.searchConfirmStep.hidden = false;

    const defaultType =
      details.contentType ||
      (state.type !== "all" ? state.type : "movies");
    const contentType = normalizeContentType(defaultType);

    const suggested = window.WatchlistMetadata?.suggestGenres(
      details.genres,
      STANDARD_GENRES,
      contentType
    );
    const primaryGenre = suggested[0] || "";

    populateSearchConfirmGenreSelect(primaryGenre);
    syncContentTypePicker(
      els.searchConfirmTypePicker,
      els.searchConfirmType,
      contentType
    );
    setSearchConfirmSecondary(
      contentType === "anime"
        ? suggested.slice(1).filter((genre) => genre.toLowerCase() !== "animation")
        : suggested.slice(1)
    );
    renderSearchConfirmPreview(details);

    els.searchConfirmGenre?.focus();
  }

  function hideSearchConfirmStep() {
    state.searchPickDetails = null;
    state.searchConfirmSecondary = [];
    if (els.searchAddStep) els.searchAddStep.hidden = false;
    if (els.searchConfirmStep) els.searchConfirmStep.hidden = true;
    const restore = searchConfirmReturnFocus;
    searchConfirmReturnFocus = null;
    if (restore?.focus && els.modalPanel?.contains(restore)) {
      restore.focus();
    } else {
      els.titleSearchInput?.focus();
    }
  }

  async function runTitleSearch({ append = false } = {}) {
    const query = state.searchQuery.trim();
    if (query.length < 2) {
      state.searchResults = [];
      state.searchTotal = 0;
      renderTitleSearchResults();
      setTitleSearchStatus(t("search.minChars"));
      return;
    }

    if (!window.WatchlistMetadata?.hasSearchConfigured()) {
      setTitleSearchStatus(t("search.unavailable"), { error: true });
      return;
    }

    state.searchLoading = true;
    setTitleSearchStatus(t("search.searching"));
    if (els.titleSearchMore) els.titleSearchMore.hidden = true;

    const result = await window.WatchlistMetadata.searchTitles(query, {
      page: state.searchPage,
      type: els.titleSearchType?.value || "all",
    });

    state.searchLoading = false;

    if (!result.ok) {
      if (!append) {
        state.searchResults = [];
        state.searchTotal = 0;
        renderTitleSearchResults();
      }
      setTitleSearchStatus(result.error || t("search.failed"), { error: true });
      return;
    }

    state.searchTotal = result.total || 0;
    const merged = append
      ? [...state.searchResults, ...(result.results || [])]
      : result.results || [];
    const seen = new Set();
    state.searchResults = merged.filter((entry) => {
      if (!entry?.title) return false;
      const key = entry.resultKey || `${entry.title}::${entry.year || ""}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    renderTitleSearchResults();

    if (els.titleSearchMore) {
      els.titleSearchMore.hidden = true;
    }

    if (!state.searchResults.length) {
      setTitleSearchStatus(result.message || t("search.noMatches"));
      return;
    }

    const shown = state.searchResults.length;
    const total = state.searchTotal;
    setTitleSearchStatus(
      total > shown
        ? t("search.showing", { shown, total })
        : shown === 1
          ? t("search.foundOne")
          : t("search.foundMany", { count: shown })
    );
  }

  function queueTitleSearch() {
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => {
      state.searchPage = 1;
      runTitleSearch();
    }, 350);
  }

  async function handleSearchResultPick(pickButton) {
    const pick = searchPickFromButton(pickButton);
    if (!hasLookupId(pick) || searchPickLoading) return;

    const result = searchResultFromPick(pick);
    if (result && isSearchResultOnList(result)) {
      await window.WatchlistDialog.alert(t("alert.duplicateOnList"), {
        title: t("alert.duplicateTitle"),
      });
      return;
    }

    setSearchPickLoading(true);
    setTitleSearchStatus(t("search.loadingDetails"));
    try {
      const details = await window.WatchlistMetadata.getDetailsForPick(pick);
      if (!details?.title) {
        setTitleSearchStatus(t("search.loadFailed"), { error: true });
        return;
      }

      setTitleSearchStatus("");
      showSearchConfirmStep(details);
    } finally {
      setSearchPickLoading(false);
    }
  }

  function applyRatingsFromDetails(details, item) {
    if (details.anilistRating || details.source === "anilist" || details.anilistId) {
      if (details.anilistRating) {
        item.anilistRating = details.anilistRating;
      } else if (details.rating) {
        const score = parseScoreValue(details.rating);
        if (score != null) {
          item.anilistRating =
            score <= 10 ? String(Math.round(score * 10)) : String(Math.round(score));
        }
      }
      return;
    }
    if (details.rating) item.imdbRating = details.rating;
  }

  function buildItemFromSearchDetails(details, options) {
    const contentType = options.contentType;
    const genre = normalizeGenre(options.genre);
    const suggested = window.WatchlistMetadata?.suggestGenres(
      details.genres,
      STANDARD_GENRES,
      contentType
    );
    const secondaryGenres = normalizeSecondaryGenres(
      genre,
      options.secondaryGenres ??
        suggested.filter((entry) => entry !== genre)
    );
    const leads =
      details.actors?.length > 0
        ? details.actors
        : details.director
          ? [details.director]
          : [];

    const item = {
      contentType,
      genre,
      title: details.title.trim(),
      leads,
      lead: leads.join(", "),
      link: window.WatchlistMetadata?.defaultLinkForDetails(details) || "",
      summary: details.plot || "",
      kind: contentType === "movies" ? "movie" : "series",
      secondaryGenres,
    };

    if (details.poster) item.poster = details.poster;
    applyRatingsFromDetails(details, item);
    if (details.year) item.year = details.year;
    window.WatchlistMetadata?.applyTitleMetaFromDetails(details, item);
    item.id = makeId(contentType, genre, item.title);
    stampItemAddedAt(item);
    return item;
  }

  async function handleSearchConfirmAdd() {
    if (addSaveInFlight) return;

    const details = state.searchPickDetails;
    if (!details) return;

    const genre = els.searchConfirmGenre?.value?.trim() || "";
    const contentType = normalizeContentType(els.searchConfirmType?.value || "movies");

    if (!genre) {
      await window.WatchlistDialog.alert(t("alert.genreRequired"), {
        title: t("alert.genreRequiredTitle"),
      });
      return;
    }

    const item = buildItemFromSearchDetails(details, {
      contentType,
      genre,
      secondaryGenres: state.searchConfirmSecondary,
    });

    if (!item.title || !item.summary) {
      await window.WatchlistDialog.alert(t("alert.incomplete"), {
        title: t("alert.incompleteTitle"),
      });
      return;
    }

    if (!item.leads.length) {
      await window.WatchlistDialog.alert(t("alert.missingActors"), {
        title: t("alert.missingActorsTitle"),
      });
      return;
    }

    const duplicate = findDuplicate(item, null);
    if (duplicate) {
      await window.WatchlistDialog.alert(t("alert.duplicateOnList"), {
        title: t("alert.nameExistsTitle"),
      });
      return;
    }

    addSaveInFlight = true;
    setButtonLoading(els.searchConfirmAdd, true, { loadingKey: "btn.adding" });
    if (els.searchConfirmBack) els.searchConfirmBack.disabled = true;
    if (els.searchConfirmStep) els.searchConfirmStep.setAttribute("aria-busy", "true");

    try {
      state.items.push(item);
      state.data = itemsToNested(state.items);
      saveData();
      closeModal();
      updateGenreOptions();
      render();
    } finally {
      addSaveInFlight = false;
      setButtonLoading(els.searchConfirmAdd, false);
      if (els.searchConfirmBack) els.searchConfirmBack.disabled = false;
      if (els.searchConfirmStep) els.searchConfirmStep.removeAttribute("aria-busy");
    }
  }

  function setAddMode(mode) {
    state.addMode = mode;
    const isBulk = mode === "bulk";
    const isSearch = mode === "search";
    const isManual = mode === "manual";

    els.addModeTabs?.querySelectorAll("[data-add-mode]").forEach((tab) => {
      const active = tab.dataset.addMode === mode;
      tab.classList.toggle("add-mode-tab--active", active);
      tab.setAttribute("aria-selected", String(active));
    });

    if (els.searchAddPanel) els.searchAddPanel.hidden = !isSearch;
    if (els.form) els.form.hidden = !isManual;
    if (els.bulkAddPanel) els.bulkAddPanel.hidden = !isBulk;

    if (!isSearch) {
      state.searchPickDetails = null;
      if (els.searchAddStep) els.searchAddStep.hidden = false;
      if (els.searchConfirmStep) els.searchConfirmStep.hidden = true;
    }

    if (isBulk) {
      setBulkPasteError("");
      els.bulkPasteInput?.focus();
    } else if (isSearch) {
      hideSearchConfirmStep();
      els.titleSearchInput?.focus();
    } else {
      els.formLink?.focus();
    }
  }

  function openModal(mode, item) {
    state.editingId = mode === "edit" ? item.id : null;
    els.modalTitle.textContent = mode === "edit" ? t("modal.editTitle") : t("modal.addTitle");
    els.deleteBtn.hidden = mode !== "edit";

    if (els.addModeTabs) {
      els.addModeTabs.hidden = mode !== "add";
    }

    if (mode === "add") {
      resetSearchAddState();
      setAddMode("search");
      setBulkPasteError("");
      if (els.bulkPasteInput) els.bulkPasteInput.value = "";
    }

    if (mode === "edit") {
      if (els.searchAddPanel) els.searchAddPanel.hidden = true;
      if (els.bulkAddPanel) els.bulkAddPanel.hidden = true;
      if (els.form) els.form.hidden = false;
    } else if (state.addMode === "bulk") {
      if (els.form) els.form.hidden = true;
      if (els.searchAddPanel) els.searchAddPanel.hidden = true;
      if (els.bulkAddPanel) els.bulkAddPanel.hidden = false;
    } else if (state.addMode === "search") {
      if (els.form) els.form.hidden = true;
      if (els.bulkAddPanel) els.bulkAddPanel.hidden = true;
      if (els.searchAddPanel) els.searchAddPanel.hidden = false;
    } else {
      if (els.form) els.form.hidden = false;
      if (els.bulkAddPanel) els.bulkAddPanel.hidden = true;
      if (els.searchAddPanel) els.searchAddPanel.hidden = true;
    }

    els.form.reset();
    populateFormGenreSelect();
    setFormLinkPreview(null);
    state.manualLinkMeta = null;

    if (item) {
      syncContentTypePicker(
        els.formTypePicker,
        els.formType,
        normalizeContentType(item.contentType)
      );
      els.formGenre.value = item.genre;
      els.formTitle.value = item.title;
      setFormLeads(item.leads || parseLeads(item));
      els.formLink.value = item.link || "";
      els.formSummary.value = item.summary || parseSummary(item);
      setFormSecondary(item.secondaryGenres || []);
    } else {
      const defaultType = state.type !== "all" ? state.type : "movies";
      syncContentTypePicker(
        els.formTypePicker,
        els.formType,
        normalizeContentType(defaultType)
      );
      if (state.selectedGenres.length === 1) {
        els.formGenre.value = state.selectedGenres[0];
      }
      setFormSecondary([]);
      setFormLeads([]);
    }

    els.modal.hidden = false;
    updateBodyScrollLock();
    closeAllCardMenus();
    if (mode === "edit") {
      els.formTitle?.focus();
    } else if (state.addMode === "bulk") {
      els.bulkPasteInput?.focus();
    } else if (state.addMode === "search") {
      els.titleSearchInput?.focus();
    } else {
      els.formLink?.focus();
    }
  }

  function closeModal() {
    els.modal.hidden = true;
    addSaveInFlight = false;
    setSearchPickLoading(false);
    searchConfirmReturnFocus = null;
    updateBodyScrollLock();
    state.editingId = null;
    state.addMode = "search";
    state.formSecondary = [];
    state.formLeads = [];
    state.manualLinkMeta = null;
    clearTimeout(searchDebounceTimer);
    clearTimeout(formLinkLookupTimer);
    setFormLinkStatus("");
    setFormLinkPreview(null);
    resetSearchAddState();
    setBulkPasteError("");
    if (els.form) els.form.hidden = true;
    if (els.bulkAddPanel) els.bulkAddPanel.hidden = true;
    if (els.searchAddPanel) els.searchAddPanel.hidden = true;
    els.form.reset();
  }

  function updateBodyScrollLock() {
    const anyOpen =
      !els.modal.hidden ||
      !els.ratingModal?.hidden ||
      !els.shareModal?.hidden ||
      !els.themeModal?.hidden ||
      !els.changeCodeModal?.hidden ||
      !els.importShareModal?.hidden ||
      !els.importNewListModal?.hidden ||
      !els.manageListsModal?.hidden ||
      !els.createListModal?.hidden ||
      !els.moveListModal?.hidden;
    document.body.style.overflow = anyOpen ? "hidden" : "";
  }

  function setChangeCodeError(message) {
    if (!els.changeCodeError) return;
    els.changeCodeError.hidden = !message;
    els.changeCodeError.textContent = localizeMessage(message);
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
      await window.WatchlistDialog.alert(t("alert.codeUpdated"), {
        title: t("alert.codeUpdatedTitle"),
      });
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

  function openThemeModal() {
    if (!els.themeModal) return;
    els.themeModal.hidden = false;
    updateBodyScrollLock();
    window.WatchlistThemes?.applyThemeUi?.();
    els.themeModal.querySelector(".theme-option")?.focus();
  }

  function closeThemeModal() {
    if (!els.themeModal) return;
    els.themeModal.hidden = true;
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
    const defaultId = window.WatchlistAuth?.getDefaultListId?.();
    const listIds = window.WatchlistAuth?.discoverListIds() || [];

    if (!listIds.length) {
      els.manageListsBody.innerHTML = "";
      return;
    }

    els.manageListsBody.innerHTML = listIds
      .map((listId) => {
        const entry = library.find((item) => item.listId === listId);
        const label = entry?.name || entry?.label || t("manage.unnamedList");
        const description = entry?.description || "";
        const titleCount = window.WatchlistAuth.getListTitleCount(listId);
        const isCurrent = listId === currentId;
        const isDefault = listId === defaultId;
        const badge = isCurrent
          ? `<span class="manage-lists__badge">${escapeHtml(t("manage.signedInNow"))}</span>`
          : "";
        const defaultBadge = isDefault
          ? `<span class="manage-lists__badge manage-lists__badge--default">${escapeHtml(t("manage.defaultList"))}</span>`
          : "";
        const meta = `<span class="manage-lists__meta">${escapeHtml(
          window.WatchlistI18n?.titleCountPhrase?.(titleCount) ?? `${titleCount} titles`
        )}</span>`;
        const about = description
          ? `<span class="manage-lists__about">${escapeHtml(description)}</span>`
          : "";
        const assignBtn = isDefault
          ? ""
          : `<button
              type="button"
              class="btn btn--ghost btn--sm"
              data-action="assign-default-list"
              data-list-id="${escapeHtml(listId)}"
              aria-label="${escapeHtml(t("manage.assignDefault"))}: ${escapeHtml(label)}"
            >
              ${escapeHtml(t("manage.assignDefault"))}
            </button>`;
        return `<li class="manage-lists__item"${isCurrent ? ' aria-current="true"' : ""}>
          <div class="manage-lists__info">
            <span class="manage-lists__name">${escapeHtml(label)}</span>
            ${about}
            ${meta}
            ${badge}
            ${defaultBadge}
          </div>
          <div class="manage-lists__actions">
            ${assignBtn}
            <button
              type="button"
              class="btn btn--ghost btn--sm"
              data-action="edit-list"
              data-list-id="${escapeHtml(listId)}"
              aria-label="${escapeHtml(t("manage.editListName", { name: label }))}"
            >
              ${escapeHtml(t("card.edit"))}
            </button>
            <button
              type="button"
              class="btn btn--ghost btn--danger btn--sm"
              data-action="delete-list"
              data-list-id="${escapeHtml(listId)}"
              aria-label="${escapeHtml(t("manage.deleteListName", { name: label }))}"
            >
              ${escapeHtml(t("card.delete"))}
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
    els.manageListsModal
      .querySelector("[data-action='create-new-list']")
      ?.focus();
  }

  function closeManageListsModal() {
    if (!els.manageListsModal) return;
    els.manageListsModal.hidden = true;
    updateBodyScrollLock();
  }

  function resetCardMenuPosition(panel) {
    if (!panel) return;
    panel.style.removeProperty("left");
    panel.style.removeProperty("right");
    panel.style.removeProperty("top");
    panel.style.removeProperty("bottom");
  }

  function positionCardMenuPanel(panel) {
    if (!panel) return;
    resetCardMenuPosition(panel);
    const rtl = document.documentElement.getAttribute("dir") === "rtl";

    if (rtl) {
      panel.style.left = "0";
      panel.style.right = "auto";
    } else {
      panel.style.right = "0";
      panel.style.left = "auto";
    }
    panel.style.bottom = "calc(100% + 0.25rem)";

    requestAnimationFrame(() => {
      const margin = 10;
      let rect = panel.getBoundingClientRect();

      if (rect.left < margin) {
        panel.style.left = "auto";
        panel.style.right = "0";
        rect = panel.getBoundingClientRect();
      }

      if (rect.right > window.innerWidth - margin) {
        panel.style.right = "auto";
        panel.style.left = "0";
        rect = panel.getBoundingClientRect();
      }

      if (rect.top < margin) {
        panel.style.bottom = "auto";
        panel.style.top = "calc(100% + 0.25rem)";
      }
    });
  }

  function closeAllCardMenus(exceptId) {
    els.main?.querySelectorAll(".card-menu__panel:not([hidden])").forEach((panel) => {
      const card = panel.closest(".card");
      const cardId = card?.dataset.id;
      if (exceptId && cardId === exceptId) return;
      panel.hidden = true;
      resetCardMenuPosition(panel);
      panel
        .closest(".card-menu")
        ?.querySelector(".card-menu__trigger")
        ?.setAttribute("aria-expanded", "false");
    });
  }

  function toggleCardMenu(cardId) {
    const card = els.main?.querySelector(`.card[data-id="${CSS.escape(cardId)}"]`);
    if (!card) return;

    const panel = card.querySelector(".card-menu__panel");
    const trigger = card.querySelector(".card-menu__trigger");
    if (!panel || !trigger) return;

    const willOpen = panel.hidden;
    closeAllCardMenus(willOpen ? cardId : null);

    if (willOpen) {
      panel.hidden = false;
      positionCardMenuPanel(panel);
      trigger.setAttribute("aria-expanded", "true");
    } else {
      panel.hidden = true;
      resetCardMenuPosition(panel);
      trigger.setAttribute("aria-expanded", "false");
    }
  }

  function findDuplicateInItems(items, item) {
    return items.find(
      (entry) =>
        entry.contentType === item.contentType && entry.title === item.title
    );
  }

  async function duplicateItemToList(itemId, targetListId) {
    const item = state.items.find((entry) => entry.id === itemId);
    if (!item) return { ok: false, error: t("alert.titleNotFound") };

    const currentListId = window.WatchlistAuth?.getProfile();
    if (targetListId === currentListId) {
      return { ok: false, error: t("alert.alreadyOnThisList") };
    }

    const payload = readLocalListPayload(targetListId);
    const targetItems = flattenWatchlist(payload.watchlist);
    const copy = structuredClone(item);
    copy.id = makeId(copy.contentType, copy.genre, copy.title);
    stampItemAddedAt(copy);

    if (findDuplicateInItems(targetItems, copy)) {
      return {
        ok: false,
        error: t("alert.alreadyOnList", {
          title: ltr(item.title),
          listName: listLabel(targetListId),
        }),
      };
    }

    targetItems.push(copy);
    const watchlist = itemsToNested(targetItems);
    const watched = { ...payload.watched };
    if (state.watched[itemId]) {
      watched[copy.id] = structuredClone(state.watched[itemId]);
    }

    window.WatchlistAuth.writeListData(targetListId, watchlist, watched);
    writeSyncMeta(targetListId, { localUpdated: Date.now() });

    if (window.WatchlistSync?.isConfigured()) {
      const result = await window.WatchlistSync.pushSnapshot(
        targetListId,
        watchlist,
        watched,
        listSyncMeta(targetListId)
      );
      if (result?.ok) {
        writeSyncMeta(targetListId, { syncedAt: Date.now() });
      }
    }

    return {
      ok: true,
      listName: window.WatchlistAuth.getListLabel(targetListId),
    };
  }

  function renderMoveListPicker() {
    if (!els.moveListPicker) return;

    const currentListId = window.WatchlistAuth?.getProfile();
    const library = window.WatchlistAuth?.getLibrary() || [];
    const listIds = (window.WatchlistAuth?.discoverListIds() || []).filter(
      (listId) => listId !== currentListId
    );

    if (!listIds.length) {
      els.moveListPicker.innerHTML = `<li class="move-list-picker__empty">${escapeHtml(t("move.empty"))}</li>`;
      return;
    }

    els.moveListPicker.innerHTML = listIds
      .map((listId) => {
        const entry = library.find((item) => item.listId === listId);
        const label = entry?.name || entry?.label || t("manage.unnamedList");
        const titleCount = window.WatchlistAuth.getListTitleCount(listId);
        return `<li>
          <button
            type="button"
            class="move-list-picker__item"
            data-action="pick-move-list"
            data-list-id="${escapeHtml(listId)}"
          >
            <span class="move-list-picker__name">${escapeHtml(label)}</span>
            <span class="move-list-picker__meta">${escapeHtml(
              window.WatchlistI18n?.titleCountPhrase?.(titleCount) ?? `${titleCount} titles`
            )}</span>
          </button>
        </li>`;
      })
      .join("");
  }

  function openMoveListModal(itemId) {
    if (!els.moveListModal) return;

    const item = state.items.find((entry) => entry.id === itemId);
    if (!item) return;

    moveListItemId = itemId;
    if (els.moveListModalTitle) {
      els.moveListModalTitle.textContent = t("move.title");
    }
    if (els.moveListModalText) {
      els.moveListModalText.textContent = t("move.text", { title: item.title });
    }
    renderMoveListPicker();
    closeAllCardMenus();
    els.moveListModal.hidden = false;
    updateBodyScrollLock();
    els.moveListPicker?.querySelector("button")?.focus();
  }

  function closeMoveListModal() {
    if (!els.moveListModal) return;
    els.moveListModal.hidden = true;
    moveListItemId = null;
    updateBodyScrollLock();
  }

  async function handleMoveListPick(targetListId) {
    if (!moveListItemId || !targetListId) return;

    const item = state.items.find((entry) => entry.id === moveListItemId);
    const result = await duplicateItemToList(moveListItemId, targetListId);
    closeMoveListModal();

    if (!result.ok) {
      await window.WatchlistDialog.alert(result.error, {
        title: t("alert.couldNotMoveTitle"),
      });
      return;
    }

    await window.WatchlistDialog.alert(
      t("alert.titleCopied", {
        title: ltr(item?.title || t("searchResult.title")),
        listName: result.listName,
      }),
      { title: t("alert.titleCopiedTitle") }
    );
  }

  function setCreateListError(message) {
    if (!els.createListError) return;
    els.createListError.hidden = !message;
    els.createListError.textContent = localizeMessage(message);
    els.createListError.classList.toggle("backup-modal__hint--error", Boolean(message));
  }

  function setListFormMode(mode) {
    const isEdit = mode === "edit";
    if (els.createListModalTitle) {
      els.createListModalTitle.textContent = isEdit ? t("create.editList") : t("create.newList");
    }
    if (els.createListSubmit) {
      els.createListSubmit.textContent = isEdit ? t("btn.save") : t("btn.createList");
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
          closeCreateListModal();
          openManageListsModal();
          if (editedId === window.WatchlistAuth.getProfile()) {
            updateHeaderTitle();
          }
          renderListSwitcher();
          await notifyCloudSyncFailed();
          return;
        }
      }

      closeCreateListModal();
      openManageListsModal();

      if (editedId === window.WatchlistAuth.getProfile()) {
        updateHeaderTitle();
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
        closeCreateListModal();
        await notifyCloudSyncFailed();
        window.location.reload();
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
      t("alert.deleteAccountConfirm", {
        lists: window.WatchlistI18n?.listCountPhrase?.(listCount) || `${listCount}`,
      }),
      {
        title: t("alert.deleteAccountTitle"),
        confirmLabel: t("menu.deleteAccount"),
        cancelLabel: t("btn.cancel"),
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
      await notifyCloudSyncFailed("delete");
    }

    window.WatchlistAuth.signOut({ deleted: true });
  }

  async function deleteListById(listId) {
    if (!listId) return;

    const library = window.WatchlistAuth.getLibrary();
    const entry = library.find((item) => item.listId === listId);
    const label = entry?.name || entry?.label || t("list.thisList");
    const titleCount = window.WatchlistAuth.getListTitleCount(listId);
    const isCurrent = listId === window.WatchlistAuth.getProfile();

    const confirmed = await window.WatchlistDialog.confirm(
      t("alert.deleteListConfirm", {
        label: ltr(label),
        titles: window.WatchlistI18n?.titleCountPhrase?.(titleCount) || `${titleCount}`,
      }),
      {
        title: t("alert.deleteListTitle"),
        confirmLabel: t("btn.delete"),
        cancelLabel: t("btn.cancel"),
        danger: true,
      }
    );
    if (!confirmed) return;

    if (isCurrent) {
      stopBackgroundListWrites();
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
        const defaultId = window.WatchlistAuth.getDefaultListId();
        const nextId =
          (defaultId && remaining.some((e) => e.listId === defaultId)
            ? defaultId
            : null) || remaining[0].listId;
        window.WatchlistAuth.switchList(nextId);
        window.location.reload();
        return;
      }
      window.WatchlistAuth.signOut({ deleted: true });
      return;
    }

    renderManageLists();
    renderListSwitcher();

    if (!cloudOk) {
      await notifyCloudSyncFailed("delete");
    }
  }

  function formToItem() {
    const contentType = normalizeContentType(els.formType.value);
    const genre = normalizeGenre(els.formGenre.value.trim());
    const title = els.formTitle.value.trim();
    const leads = [...state.formLeads];
    const link = normalizeLink(els.formLink.value);
    const summary = els.formSummary.value.trim();
    const existing = state.editingId
      ? state.items.find((i) => i.id === state.editingId)
      : null;
    const kind = formKindForItem(contentType, existing?.kind);

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

    if (state.editingId && existing) {
      if (existing.altTitle) item.altTitle = existing.altTitle;
      if (existing?.poster && !item.poster) item.poster = existing.poster;
      if (existing?.imdbRating && !item.imdbRating) item.imdbRating = existing.imdbRating;
      if (existing?.anilistRating && !item.anilistRating) {
        item.anilistRating = existing.anilistRating;
      }
      if (existing?.year && !item.year) item.year = existing.year;
      if (existing?.ageRating && !item.ageRating) item.ageRating = existing.ageRating;
      if (existing?.runtime && !item.runtime) item.runtime = existing.runtime;
      if (existing?.seasonCount && !item.seasonCount) {
        item.seasonCount = existing.seasonCount;
      }
      if (existing?.episodeCount && !item.episodeCount) {
        item.episodeCount = existing.episodeCount;
      }
      stampItemAddedAt(item, { existing });
    } else {
      stampItemAddedAt(item);
    }

    item.id = makeId(contentType, genre, title);

    if (state.manualLinkMeta) {
      if (state.manualLinkMeta.poster) item.poster = state.manualLinkMeta.poster;
      if (state.manualLinkMeta.imdbRating) item.imdbRating = state.manualLinkMeta.imdbRating;
      if (state.manualLinkMeta.anilistRating) {
        item.anilistRating = state.manualLinkMeta.anilistRating;
      }
      if (state.manualLinkMeta.year) item.year = state.manualLinkMeta.year;
      if (state.manualLinkMeta.ageRating) item.ageRating = state.manualLinkMeta.ageRating;
      if (state.manualLinkMeta.runtime) item.runtime = state.manualLinkMeta.runtime;
      if (state.manualLinkMeta.seasonCount) {
        item.seasonCount = state.manualLinkMeta.seasonCount;
      }
      if (state.manualLinkMeta.episodeCount) {
        item.episodeCount = state.manualLinkMeta.episodeCount;
      }
      item.posterBroken = false;
    }

    if (existing && normalizeLink(existing.link) !== link) {
      delete item.poster;
      item.posterBroken = false;
    }

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
      const previous = state.items[index];
      stampItemAddedAt(item, { existing: previous });
      state.items[index] = item;

      if (oldId !== item.id && state.watched[oldId]) {
        state.watched[item.id] = state.watched[oldId];
        delete state.watched[oldId];
        saveWatched();
      }
    } else {
      stampItemAddedAt(item);
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
      await window.WatchlistDialog.alert(t("alert.bulkTemplateCopied"), {
        title: t("alert.bulkTemplateCopiedTitle"),
      });
    } catch {
      window.WatchlistDialog.alert(t("alert.bulkCopyFailed"), {
        title: t("alert.bulkCopyFailedTitle"),
      });
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
    const batchStart = Date.now();

    for (const entry of parsed.items) {
      const item = stampItemAddedAt(
        {
          ...entry,
          id: makeId(entry.contentType, entry.genre, entry.title),
        },
        { at: batchStart + added }
      );

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
                    skipped === 1
                      ? t("bulk.duplicatesSkipped", { count: skipped })
                      : t("bulk.duplicatesSkippedPlural", { count: skipped }),
                  ]
                : []),
              ...(parsed.errors || []),
            ],
            { maxShown: 8 }
          )}`
        : "";

    await window.WatchlistDialog.alert(
      added === 1
        ? t("alert.bulkAddedOne", { extra: warning })
        : t("alert.bulkAddedMany", { added, extra: warning }),
      { title: t("alert.bulkAddedTitle") }
    );
  }

  function handleFormSubmit(event) {
    event.preventDefault();
    if (addSaveInFlight) return;

    const item = formToItem();

    if (!item.genre || !item.title || !item.leads.length || !item.summary) {
      if (!item.leads.length) {
        window.WatchlistDialog.alert(t("alert.leadRequired"), {
          title: t("alert.missingActorTitle"),
        });
      } else {
        window.WatchlistDialog.alert(t("alert.incomplete"), {
          title: t("alert.incompleteTitle"),
        });
      }
      return;
    }

    if (els.formLink.value.trim() && !item.link) {
      window.WatchlistDialog.alert(t("alert.invalidLink"), {
        title: t("alert.invalidLinkTitle"),
      });
      return;
    }

    const duplicate = findDuplicate(item, state.editingId);
    if (duplicate) {
      window.WatchlistDialog.alert(t("alert.nameExists"), {
        title: t("alert.nameExistsTitle"),
      });
      return;
    }

    addSaveInFlight = true;
    const saveBtn = els.form?.querySelector('button[type="submit"]');
    setButtonLoading(saveBtn, true, { loadingKey: "btn.saving" });

    try {
      saveItem(item);
      state.manualLinkMeta = null;
      closeModal();
      updateGenreOptions();
      render();
    } finally {
      addSaveInFlight = false;
      setButtonLoading(saveBtn, false);
    }
  }

  async function handleDelete() {
    if (!state.editingId) return;

    const item = state.items.find((i) => i.id === state.editingId);
    const name = item ? item.title : t("list.thisTitle");

    const confirmed = await window.WatchlistDialog.confirm(
      t("alert.deleteTitleConfirm", { name: ltr(name) }),
      {
        title: t("alert.deleteTitleTitle"),
        confirmLabel: t("btn.delete"),
        cancelLabel: t("btn.cancel"),
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
      tab.tabIndex = active ? 0 : -1;
    });
    updateGenreOptions();
    render();
  }

  function countTitles(data) {
    return flattenWatchlist(data || emptyWatchlist()).length;
  }

  function isImportPayloadValid(payload) {
    return Boolean(payload?.watchlist && countTitles(payload.watchlist) > 0);
  }

  async function alertEmptyImport() {
    await window.WatchlistDialog.alert(t("alert.importEmptyList"), {
      title: t("alert.importEmptyListTitle"),
    });
  }

  function closeImportShareModal() {
    if (!els.importShareModal) return;
    els.importShareModal.hidden = true;
    pendingImportPayload = null;
    updateBodyScrollLock();
  }

  function closeListTitleDropdown() {
    if (!els.listTitleDropdownPanel || !els.listTitleDropdownBtn) return;
    els.listTitleDropdownPanel.hidden = true;
    els.listTitleDropdownBtn.setAttribute("aria-expanded", "false");
  }

  function openListTitleDropdown() {
    if (!els.listTitleDropdownPanel || !els.listTitleDropdownBtn) return;
    closeAccountMenu();
    renderListTitleDropdownPanel();
    els.listTitleDropdownPanel.hidden = false;
    els.listTitleDropdownBtn.setAttribute("aria-expanded", "true");
  }

  function toggleListTitleDropdown() {
    if (!els.listTitleDropdownPanel) return;
    if (els.listTitleDropdownPanel.hidden) {
      openListTitleDropdown();
    } else {
      closeListTitleDropdown();
    }
  }

  function renderListTitleDropdownPanel() {
    if (!els.listTitleDropdownPanel) return;

    const library = window.WatchlistAuth?.getLibrary() || [];
    const currentId = window.WatchlistAuth?.getProfile();
    const sorted = [...library].sort((a, b) => {
      if (a.listId === currentId) return -1;
      if (b.listId === currentId) return 1;
      return 0;
    });
    const checkIcon =
      '<svg class="list-title-dropdown__check" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';

    els.listTitleDropdownPanel.innerHTML = sorted
      .map((entry) => {
        const isCurrent = entry.listId === currentId;
        const name = escapeHtml(entry.name || entry.label || t("list.myList"));
        return `<button type="button" class="list-title-dropdown__item${
          isCurrent ? " list-title-dropdown__item--active" : ""
        }" role="option" data-list-id="${escapeHtml(entry.listId)}" aria-selected="${isCurrent}"><span>${name}</span>${
          isCurrent ? checkIcon : ""
        }</button>`;
      })
      .join("");
  }

  function renderListTitleDropdown() {
    const name = window.WatchlistAuth?.getListLabel() || t("list.myList");
    const library = window.WatchlistAuth?.getLibrary() || [];
    const hasMultiple = library.length > 1;

    if (els.headerTitle) {
      els.headerTitle.hidden = hasMultiple;
      if (!hasMultiple) els.headerTitle.textContent = name;
    }

    if (els.listTitleDropdown) {
      els.listTitleDropdown.hidden = !hasMultiple;
    }

    if (els.listTitleDropdownLabel) {
      els.listTitleDropdownLabel.textContent = name;
    }

    if (!hasMultiple) {
      closeListTitleDropdown();
      return;
    }

    renderListTitleDropdownPanel();
  }

  function renderListSwitcher() {
    const library = window.WatchlistAuth?.getLibrary() || [];
    const currentId = window.WatchlistAuth?.getProfile();

    // List switching lives in the header title dropdown (matches Flutter app).
    if (els.accountMenuSwitchWrap) {
      els.accountMenuSwitchWrap.hidden = true;
    }

    if (els.listSwitcher && library.length > 1) {
      els.listSwitcher.innerHTML = library
        .map((entry) => {
          const selected = entry.listId === currentId ? " selected" : "";
          return `<option value="${escapeHtml(entry.listId)}"${selected}>${escapeHtml(entry.name || entry.label || t("list.myList"))}</option>`;
        })
        .join("");
    }

    renderListTitleDropdown();
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

  function importedListDescription(payload) {
    const raw = String(payload.listDescription ?? payload.listSummary ?? "").trim();
    if (raw) return raw.slice(0, 120);
    const titleCount = countTitles(payload.watchlist);
    return t("import.listDescription", { count: titleCount });
  }

  function shareLinkText(payload) {
    const summary = String(payload.listDescription || "").trim();
    const summaryPart = summary ? t("share.linkSummaryPart", { summary }) : "";
    return t("share.linkMessage", { name: payload.listName, summary: summaryPart });
  }

  function setImportNewListError(message) {
    if (!els.importNewListError) return;
    els.importNewListError.hidden = !message;
    els.importNewListError.textContent = localizeMessage(message);
    els.importNewListError.classList.toggle("backup-modal__hint--error", Boolean(message));
  }

  function openImportNewListModal() {
    if (!els.importNewListModal || !pendingImportPayload) return;

    const payload = pendingImportPayload;
    els.importNewListName.value = payload.listName || t("list.sharedList");
    els.importNewListDescription.value = importedListDescription(payload);
    setImportNewListError("");
    els.importNewListModal.hidden = false;
    updateBodyScrollLock();
    els.importNewListName?.focus();
    els.importNewListName?.select();
  }

  function closeImportNewListModal() {
    if (!els.importNewListModal) return;
    els.importNewListModal.hidden = true;
    setImportNewListError("");
    els.importNewListForm?.reset();
    updateBodyScrollLock();
  }

  function openImportShareModal(payload) {
    if (!els.importShareModal) return;
    if (!isImportPayloadValid(payload)) {
      void alertEmptyImport();
      return;
    }

    pendingImportPayload = payload;
    const listName = payload.listName || "Shared list";
    const listDescription = String(payload.listDescription || "").trim();
    const titleCount = countTitles(payload.watchlist);
    const currentCount = state.items.length;
    const currentListName = window.WatchlistAuth?.getListLabel() || "My list";

    const summaryLine = listDescription
      ? t("import.summaryWithDescription", { description: listDescription })
      : "";

    if (currentCount > 0) {
      els.importShareModalText.textContent = [
        t("import.summaryWithCurrent", {
          listName,
          count: titleCount,
          currentName: currentListName,
          currentCount,
        }),
        summaryLine,
      ]
        .filter(Boolean)
        .join(" ");
      if (els.importShareModalHint) {
        els.importShareModalHint.textContent = t("import.hint");
      }
    } else {
      els.importShareModalText.textContent = [
        t("import.summaryEmpty", {
          listName,
          count: titleCount,
        }),
        summaryLine,
      ]
        .filter(Boolean)
        .join(" ");
      if (els.importShareModalHint) {
        els.importShareModalHint.textContent = t("import.hintEmpty");
      }
    }

    els.importShareModal.hidden = false;
    closeShareModal();
    updateBodyScrollLock();
    els.importShareModal.querySelector("[data-action='import-new-list']")?.focus();
  }

  async function importAsNewList(payload, options = {}) {
    const titleCount = countTitles(payload.watchlist);
    const name = uniqueImportedListName(options.name || payload.listName);
    const description = String(options.description ?? importedListDescription(payload)).trim().slice(
      0,
      120
    );

    const result = window.WatchlistAuth.createList(name, description);
    if (!result.ok) {
      await window.WatchlistDialog.alert(
        window.WatchlistI18n?.translateAuthError?.(result.error) ||
          result.error ||
          t("alert.couldNotCreateList"),
        { title: t("alert.importFailedTitle") }
      );
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
        await notifyCloudSyncFailed();
      }
    }

    applyImportToCurrentList(payload);
    const cloud = await syncCurrentListToCloud();
    return { ok: cloud.ok, listName: name };
  }

  function updateHeaderTitle() {
    const name = window.WatchlistAuth?.getListLabel() || t("list.myList");
    document.title = name;
    renderListTitleDropdown();
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
      listDescription: window.WatchlistAuth?.getListDescription?.() || "",
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

  async function exportBackupFile(payload = null) {
    const exportData = payload || buildExportPayload();
    const json = JSON.stringify(exportData, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const filename = exportFilename(exportData);
    const file = new File([blob], filename, { type: "application/json" });

    if (navigator.share) {
      try {
        const shareData = {
          title: `${exportData.listName} — Our Movie Nights`,
          text: t("share.fileMessage"),
          files: [file],
        };

        if (!navigator.canShare || navigator.canShare(shareData)) {
          await navigator.share(shareData);
          await window.WatchlistDialog.alert(t("alert.listSharedFile"), {
            title: t("alert.listSharedTitle"),
          });
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

    await window.WatchlistDialog.alert(t("alert.listReadyToSend"), {
      title: t("alert.listReadyToSendTitle"),
    });
  }

  async function shareListLink() {
    const payload = buildExportPayload();
    closeShareModal();

    if (!window.WatchlistSync?.isConfigured?.()) {
      await exportBackupFile(payload);
      return;
    }

    const published = await window.WatchlistSync.publishShareSnapshot(payload);
    if (!published.ok) {
      await window.WatchlistDialog.alert(t("alert.shareLinkFailed"), {
        title: t("alert.shareLinkFailedTitle"),
      });
      await exportBackupFile(payload);
      return;
    }

    const shareUrl = buildShareUrl(published.shareId);
    if (!shareUrl) {
      await window.WatchlistDialog.alert(t("alert.shareLocalhost"), {
        title: t("alert.shareLocalhostTitle"),
      });
      await exportBackupFile(payload);
      return;
    }

    if (navigator.share) {
      try {
        const shareData = {
          title: `${payload.listName} — Our Movie Nights`,
          text: shareLinkText(payload),
          url: shareUrl,
        };
        if (!navigator.canShare || navigator.canShare(shareData)) {
          await navigator.share(shareData);
          await window.WatchlistDialog.alert(t("alert.listSharedLink"), {
            title: t("alert.listSharedTitle"),
          });
          return;
        }
      } catch (error) {
        if (error?.name === "AbortError") return;
      }
    }

    try {
      await navigator.clipboard.writeText(shareUrl);
      await window.WatchlistDialog.alert(t("alert.linkCopied"), {
        title: t("alert.listSharedTitle"),
      });
    } catch {
      await window.WatchlistDialog.alert(shareUrl, {
        title: t("alert.copyLinkManualTitle"),
      });
    }
  }

  function getShareBaseUrl() {
    const configured = window.WATCHLIST_CONFIG?.publicAppUrl?.trim();
    if (configured) {
      try {
        const url = new URL(configured);
        return url.href.endsWith("/") ? url.href : `${url.href}/`;
      } catch {
        return null;
      }
    }

    const host = window.location.hostname;
    if (host === "localhost" || host === "127.0.0.1") return null;
    return new URL("./", window.location.href).href;
  }

  function buildShareUrl(shareId) {
    const base = getShareBaseUrl();
    if (!base) return "";
    const url = new URL("gate.html", base);
    url.search = "";
    url.searchParams.set("share", shareId);
    return url.toString();
  }

  function readPendingShareId() {
    const fromUrl = new URLSearchParams(window.location.search).get("share")?.trim();
    if (fromUrl) return fromUrl;
    try {
      return sessionStorage.getItem(PENDING_SHARE_KEY)?.trim() || "";
    } catch {
      return "";
    }
  }

  function clearPendingShareId() {
    try {
      sessionStorage.removeItem(PENDING_SHARE_KEY);
    } catch {
      /* ignore */
    }
  }

  function stripShareFromUrl() {
    const params = new URLSearchParams(window.location.search);
    if (!params.has("share")) return;
    params.delete("share");
    const qs = params.toString();
    const next = `${window.location.pathname}${qs ? `?${qs}` : ""}`;
    window.history.replaceState({}, "", next);
  }

  async function consumePendingShare() {
    await initShareArrival();
  }

  async function exportBackup() {
    await shareListLink();
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

  async function finishImport(payload, mode, newListOptions = null) {
    let cloud = { ok: true };
    let importedListName = "";

    if (mode === "new-list") {
      const result = await importAsNewList(payload, newListOptions || {});
      if (!result) return;
      cloud = result;
      importedListName = result.listName;
    } else if (mode === "merge" || mode === "merge-watched") {
      const includeWatched = mode === "merge-watched";
      const mergeResult = mergeImportIntoCurrentList(payload, { includeWatched });
      cloud = await syncCurrentListToCloud();
      pendingImportPayload = null;
      closeImportShareModal();
      closeImportNewListModal();
      updateGenreOptions();
      renderListSwitcher();
      updateHeaderTitle();
      render();
      updateStats();

      if (!cloud.ok) {
        await notifyCloudSyncFailed();
      }

      let message;
      if (includeWatched) {
        message =
          mergeResult.skipped > 0
            ? t("alert.importMergedWithWatchSkips", {
                added: mergeResult.added,
                skipped: mergeResult.skipped,
              })
            : t("alert.importMergedWithWatch");
      } else {
        message =
          mergeResult.skipped > 0
            ? t("alert.importMergedSkips", {
                added: mergeResult.added,
                skipped: mergeResult.skipped,
              })
            : t("alert.importMerged");
      }

      await window.WatchlistDialog.alert(message, {
        title: t("alert.listUpdatedTitle"),
      });
      dismissShareArrival();
      return;
    }

    pendingImportPayload = null;
    closeImportShareModal();
    closeImportNewListModal();
    updateGenreOptions();
    renderListSwitcher();
    updateHeaderTitle();
    render();

    if (!cloud.ok) {
      await notifyCloudSyncFailed();
      dismissShareArrival();
      return;
    }

    const message = t("alert.importOpenedNewList", { name: ltr(importedListName) });
    await window.WatchlistDialog.alert(message, {
      title: t("alert.newListCreatedTitle"),
    });
    dismissShareArrival();
  }

  async function importBackup(file) {
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const payload = JSON.parse(reader.result);
        if (!isImportPayloadValid(payload)) {
          throw new Error("Invalid backup");
        }

        closeShareModal();
        openImportShareModal(payload);
      } catch {
        window.WatchlistDialog.alert(t("alert.couldNotOpenFile"), {
          title: t("alert.couldNotOpenFileTitle"),
        });
      }
    };
    reader.readAsText(file);
  }

  function mergeImportIntoCurrentList(payload, { includeWatched = false } = {}) {
    const beforeKeys = new Set(
      flattenWatchlist(state.data).map((item) => itemKey(item.contentType, item.title))
    );
    const importItems = flattenWatchlist(remapWatchlistGenres(payload.watchlist));
    let skipped = 0;
    for (const item of importItems) {
      if (beforeKeys.has(itemKey(item.contentType, item.title))) {
        skipped += 1;
      }
    }

    const merged = mergeLegacyWithBundled(payload.watchlist, state.data);
    state.data = applyBundledGenreCorrections(merged, null);
    state.items = flattenWatchlist(state.data);
    state.data = itemsToNested(state.items);

    if (includeWatched) {
      for (const item of importItems) {
        const watchEntry = findImportedWatchEntry(item, payload.watched);
        if (!watchEntry) continue;

        state.watched[makeId(item.contentType, item.genre, item.title)] = watchEntry;
      }
    }

    window.WatchlistAuth?.clearEmptyListFlag();
    saveData();
    saveWatched();

    const afterCount = state.items.length;
    const beforeCount = beforeKeys.size;
    return {
      added: Math.max(0, afterCount - beforeCount),
      skipped,
    };
  }

  function bindEvents() {
    document.getElementById("app")?.addEventListener("click", async (event) => {
      const target = event.target.closest("[data-action]");
      if (!target || target.closest("#mainContent")) return;

      const action = target.dataset.action;
      if (action === "sync-retry") {
        await retryCloudSync();
        return;
      }
      if (action === "dismiss-share-arrival") {
        dismissShareArrival();
        return;
      }
      if (action === "share-arrival-import") {
        await openShareArrivalImport();
      }
    });

    els.typeTabs.forEach((tab) => {
      tab.addEventListener("click", () => setType(tab.dataset.type));
    });

    document.querySelector(".type-tabs")?.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      const tabs = [...els.typeTabs];
      const current = tabs.findIndex((tab) => tab.dataset.type === state.type);
      if (current < 0) return;
      event.preventDefault();
      const rtl = document.documentElement.getAttribute("dir") === "rtl";
      const delta = event.key === "ArrowRight" ? 1 : -1;
      const step = rtl ? -delta : delta;
      const next = tabs[(current + step + tabs.length) % tabs.length];
      setType(next.dataset.type);
      next.focus();
    });

    els.typeTabs.forEach((tab) => {
      tab.tabIndex = tab.dataset.type === state.type ? 0 : -1;
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

    els.ratingFilter?.addEventListener("change", () => {
      applyRatingFilter(els.ratingFilter.value || "all");
      if (isReleaseSortActive()) {
        void backfillMissingYears();
      }
      render();
    });

    els.sortDirectionBtn?.addEventListener("click", () => {
      toggleSortDirection();
    });

    els.clearFiltersBtn?.addEventListener("click", () => {
      clearAllFilters();
    });

    els.accountMenuBtn?.addEventListener("click", (event) => {
      event.stopPropagation();
      toggleAccountMenu();
    });

    els.listTitleDropdownBtn?.addEventListener("click", (event) => {
      event.stopPropagation();
      toggleListTitleDropdown();
    });

    els.listTitleDropdownPanel?.addEventListener("click", (event) => {
      const item = event.target.closest("[data-list-id]");
      if (!item) return;
      const listId = item.dataset.listId;
      if (!listId || listId === window.WatchlistAuth?.getProfile()) {
        closeListTitleDropdown();
        return;
      }
      closeListTitleDropdown();
      switchToList(listId);
    });

    els.accountMenuPanel?.addEventListener("click", async (event) => {
      const action = event.target.closest("[data-action]")?.dataset.action;
      if (!action) return;

      if (action === "set-language") {
        const lang = event.target.closest("[data-action='set-language']")?.dataset.lang;
        if (lang) window.WatchlistI18n?.setLang(lang);
        return;
      }

      closeAccountMenu();

      if (action === "open-theme") {
        openThemeModal();
        return;
      }

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

    document.addEventListener("click", (event) => {
      if (!els.listTitleDropdownPanel || els.listTitleDropdownPanel.hidden) return;
      if (event.target.closest("#listTitleDropdown")) return;
      closeListTitleDropdown();
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
      }
    });

    els.themeModal?.addEventListener("click", (event) => {
      const action = event.target.closest("[data-action]")?.dataset.action;
      if (!action) return;

      if (action === "close-theme-modal") {
        closeThemeModal();
        return;
      }

      if (action === "set-theme") {
        const theme = event.target.closest("[data-action='set-theme']")?.dataset.theme;
        if (theme) window.WatchlistThemes?.setTheme(theme);
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

      if (action === "assign-default-list") {
        const listId = event.target.closest("[data-list-id]")?.dataset.listId;
        if (listId) {
          window.WatchlistAuth.assignDefaultList(listId);
          renderManageLists();
        }
        return;
      }

      if (action === "switch-list") {
        const listId = event.target.closest("[data-list-id]")?.dataset.listId;
        if (listId && listId !== window.WatchlistAuth?.getProfile()) {
          switchToList(listId);
        }
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

    els.moveListModal?.addEventListener("click", async (event) => {
      const target = event.target.closest("[data-action]");
      if (!target) return;

      const action = target.dataset.action;
      if (action === "close-move-list-modal") {
        closeMoveListModal();
        return;
      }

      if (action === "pick-move-list") {
        await handleMoveListPick(target.dataset.listId);
      }
    });

    document.addEventListener("click", (event) => {
      if (event.target.closest(".card-menu")) return;
      closeAllCardMenus();
    });

    els.importShareModal?.addEventListener("click", async (event) => {
      const action = event.target.closest("[data-action]")?.dataset.action;
      if (!action) return;

      if (action === "close-import-share-modal") {
        closeImportShareModal();
        return;
      }

      if (action === "import-new-list" && pendingImportPayload) {
        openImportNewListModal();
        return;
      }

      if (action === "import-merge" && pendingImportPayload) {
        const listName = pendingImportPayload.listName || t("list.sharedList");
        const titleCount = countTitles(pendingImportPayload.watchlist);
        const currentName = window.WatchlistAuth?.getListLabel() || t("list.myList");
        const confirmed = await window.WatchlistDialog.confirm(
          t("alert.importMergeConfirm", {
            count: titleCount,
            listName: ltr(listName),
            currentName: ltr(currentName),
          }),
          {
            title: t("alert.importMergeTitle"),
            confirmLabel: t("btn.addTitles"),
            cancelLabel: t("btn.cancel"),
          }
        );
        if (!confirmed) return;
        await finishImport(pendingImportPayload, "merge");
        return;
      }

      if (action === "import-merge-watched" && pendingImportPayload) {
        const listName = pendingImportPayload.listName || t("list.sharedList");
        const titleCount = countTitles(pendingImportPayload.watchlist);
        const currentName = window.WatchlistAuth?.getListLabel() || t("list.myList");
        const confirmed = await window.WatchlistDialog.confirm(
          t("alert.importMergeWithWatchConfirm", {
            count: titleCount,
            listName: ltr(listName),
            currentName: ltr(currentName),
          }),
          {
            title: t("alert.importMergeWithWatchTitle"),
            confirmLabel: t("btn.addTitles"),
            cancelLabel: t("btn.cancel"),
          }
        );
        if (!confirmed) return;
        await finishImport(pendingImportPayload, "merge-watched");
      }
    });

    els.importNewListModal?.addEventListener("click", (event) => {
      if (event.target.closest("[data-action='close-import-new-list-modal']")) {
        closeImportNewListModal();
      }
    });

    els.importNewListForm?.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!pendingImportPayload) return;

      const name = els.importNewListName?.value?.trim() || "";
      const description = els.importNewListDescription?.value?.trim() || "";

      if (!name) {
        setImportNewListError(t("auth.listNameRequired"));
        els.importNewListName?.focus();
        return;
      }

      if (name.length > 48) {
        setImportNewListError(t("auth.listNameLong"));
        els.importNewListName?.focus();
        return;
      }

      setImportNewListError("");
      closeImportNewListModal();
      await finishImport(pendingImportPayload, "new-list", { name, description });
    });

    els.listSwitcher?.addEventListener("change", () => {
      const listId = els.listSwitcher.value;
      if (!listId || listId === window.WatchlistAuth?.getProfile()) return;
      closeAccountMenu();
      switchToList(listId);
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

    els.formGenre.addEventListener("change", () => {
      setFormSecondary(state.formSecondary);
    });

    initContentTypePicker(els.formTypePicker, els.formType);
    initContentTypePicker(els.searchConfirmTypePicker, els.searchConfirmType);

    els.searchConfirmGenre?.addEventListener("change", () => {
      setSearchConfirmSecondary(state.searchConfirmSecondary);
    });

    els.searchConfirmSecondaryAdd?.addEventListener("change", () => {
      const genre = els.searchConfirmSecondaryAdd.value;
      if (genre) addSearchConfirmSecondary(genre);
      els.searchConfirmSecondaryAdd.value = "";
    });

    els.searchConfirmSecondaryChips?.addEventListener("click", (event) => {
      const btn = event.target.closest("[data-action='remove-search-secondary']");
      if (!btn) return;
      removeSearchConfirmSecondary(btn.dataset.genre);
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

    els.formLink?.addEventListener("input", queueFormLinkLookup);
    els.formLink?.addEventListener("blur", handleFormLinkLookup);

    els.form.addEventListener("submit", handleFormSubmit);
    els.addModeTabs?.addEventListener("click", (event) => {
      const tab = event.target.closest("[data-add-mode]");
      if (!tab) return;
      setAddMode(tab.dataset.addMode);
    });

    els.titleSearchInput?.addEventListener("input", () => {
      state.searchQuery = els.titleSearchInput.value;
      queueTitleSearch();
    });

    els.titleSearchInput?.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      clearTimeout(searchDebounceTimer);
      state.searchPage = 1;
      runTitleSearch();
    });

    els.titleSearchType?.addEventListener("change", () => {
      state.searchPage = 1;
      runTitleSearch();
    });

    els.titleSearchMore?.addEventListener("click", () => {
      if (state.searchLoading) return;
      state.searchPage += 1;
      runTitleSearch({ append: true });
    });

    els.searchAddPanel?.addEventListener("click", async (event) => {
      const pick = event.target.closest("[data-action='pick-search-result']");
      if (pick) {
        await handleSearchResultPick(pick);
      }
    });

    els.searchConfirmBack?.addEventListener("click", hideSearchConfirmStep);
    els.searchConfirmAdd?.addEventListener("click", handleSearchConfirmAdd);

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

    els.ratingPicker?.addEventListener("keydown", (event) => {
      const stars = [
        ...(els.ratingPicker?.querySelectorAll("[data-rating-star]") || []),
      ];
      if (!stars.length) return;

      const rtl = document.documentElement.getAttribute("dir") === "rtl";
      const activeIndex = stars.indexOf(document.activeElement);

      if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
        event.preventDefault();
        const delta = event.key === "ArrowRight" ? 1 : -1;
        const step = rtl ? -delta : delta;
        const nextIndex = Math.min(
          stars.length - 1,
          Math.max(0, (activeIndex >= 0 ? activeIndex : 4) + step)
        );
        chooseRatingPickerValue(Number(stars[nextIndex].dataset.ratingStar));
        stars[nextIndex]?.focus();
        return;
      }

      if (event.key === "Home") {
        event.preventDefault();
        chooseRatingPickerValue(Number(stars[0].dataset.ratingStar));
        stars[0]?.focus();
        return;
      }

      if (event.key === "End") {
        event.preventDefault();
        chooseRatingPickerValue(Number(stars[stars.length - 1].dataset.ratingStar));
        stars[stars.length - 1]?.focus();
        return;
      }

      if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        adjustRatingPicker(0.1);
        return;
      }

      if (event.key === "-" || event.key === "_") {
        event.preventDefault();
        adjustRatingPicker(-0.1);
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
        dismissRatingModal();
      }
      if (action === "rate-later") {
        dismissRatingModal();
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
      if (!els.listTitleDropdownPanel?.hidden) {
        closeListTitleDropdown();
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
      if (!els.moveListModal?.hidden) {
        closeMoveListModal();
        return;
      }
      if (!els.importNewListModal?.hidden) {
        closeImportNewListModal();
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
      if (!els.themeModal?.hidden) {
        closeThemeModal();
        return;
      }
      if (!els.ratingModal?.hidden) {
        dismissRatingModal();
        return;
      }
      if (!els.modal.hidden) {
        if (isSearchConfirmVisible()) {
          hideSearchConfirmStep();
          return;
        }
        closeModal();
        return;
      }
    });

    document.addEventListener("keydown", handleModalFocusTrap);
    els.modal?.addEventListener("keydown", handleAddModalKeydown);
    els.titleSearchInput?.addEventListener("keydown", handleTitleSearchKeydown);
    els.titleSearchResults?.addEventListener("keydown", handleTitleSearchKeydown);

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
      // Card-body click → title-detail.js handles it in capture phase.
      // The old "linked card click → open link" shortcut is intentionally
      // removed; the link is now opened via the detail's "Open link" button.

      const target = event.target.closest("[data-action]");
      if (!target) return;

      const action = target.dataset.action;
      const id = target.dataset.id;

      if (action === "toggle-card-menu") {
        event.stopPropagation();
        toggleCardMenu(id);
        return;
      }

      if (action === "open-card-link") {
        closeAllCardMenus();
        const url = target.dataset.link;
        if (url) window.open(url, "_blank", "noopener,noreferrer");
        return;
      }

      if (action === "move-to-list") {
        closeAllCardMenus();
        openMoveListModal(id);
        return;
      }

      if (action === "toggle-watched") {
        if (isItemWatched(id)) {
          await markItemUnwatched(id);
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
        const name = item ? item.title : t("list.thisTitle");
        const confirmed = await window.WatchlistDialog.confirm(
          t("alert.deleteTitleConfirm", { name: ltr(name) }),
          {
            title: t("alert.deleteTitleTitle"),
            confirmLabel: t("btn.delete"),
            cancelLabel: t("btn.cancel"),
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

      if (action === "clear-filters") {
        clearAllFilters();
        return;
      }

      if (action === "open-add-search") {
        openModal("add");
        setAddMode("search");
        return;
      }

      if (action === "open-add-bulk") {
        openModal("add");
        setAddMode("bulk");
        return;
      }

      if (action === "add") {
        openModal("add");
      }
    });
  }

  function renderLoadingSkeletonHtml() {
    const cards = Array.from(
      { length: 6 },
      () => `<div class="list-skeleton__card" aria-hidden="true">
        <div class="list-skeleton__poster"></div>
        <div class="list-skeleton__body">
          <div class="list-skeleton__line list-skeleton__line--title"></div>
          <div class="list-skeleton__line list-skeleton__line--short"></div>
          <div class="list-skeleton__line"></div>
        </div>
      </div>`
    ).join("");

    return `
      <div class="list-skeleton" role="status" aria-live="polite" aria-busy="true">
        <div class="list-skeleton__heading" aria-hidden="true"></div>
        <div class="list-skeleton__grid">${cards}</div>
        <p class="list-skeleton__status">${escapeHtml(t("loading.watchlist"))}</p>
      </div>`;
  }

  function showLoadingSkeleton() {
    if (!els.loading) return;
    els.loading.className = "list-skeleton-wrap";
    els.loading.innerHTML = renderLoadingSkeletonHtml();
  }

  function hideLoadingSkeleton() {
    els.loading?.remove();
  }

  async function init() {
    if (!window.WatchlistAuth?.isAuthenticated()) {
      const shareId = new URLSearchParams(window.location.search).get("share")?.trim();
      window.location.replace(
        shareId ? `gate.html?share=${encodeURIComponent(shareId)}` : "gate.html"
      );
      return;
    }

    updateHeaderTitle();

    state.watched = loadWatchedState();
    state.cardLayout = loadCardLayout();
    applyCardLayout();
    syncLayoutToggles();
    state.activeListId = window.WatchlistAuth.getProfile();
    state.data = loadWatchlist();
    state.items = flattenWatchlist(state.data);
    state.data = itemsToNested(state.items);

    const cloudConfigured = window.WatchlistSync?.isConfigured();
    const hasLocal =
      state.data && !window.WatchlistAuth.isWatchlistEmpty(state.data);

    if (cloudConfigured) {
      state.syncStatus = "pending";
      if (!hasLocal) {
        showLoadingSkeleton();
        updateStats();
        try {
          await syncAccountLists();
          await reconcileWithCloud();
        } catch (error) {
          console.warn("[sync] reconcile failed:", error);
          state.syncStatus = resolveSyncFailureStatus();
        }
      }
    }

    const { data, watched } = storageKeys();
    localStorage.setItem(data, JSON.stringify(state.data));
    localStorage.setItem(watched, JSON.stringify(state.watched));

    if (state.syncStatus === "pending" && !cloudConfigured) {
      state.syncStatus = "local";
    } else if (state.syncStatus === "pending" && !hasLocal) {
      state.syncStatus = cloudConfigured ? "saved" : "local";
    }

    if (!state.data) {
      hideLoadingSkeleton();
      els.main.innerHTML = `
        <div class="empty-state">
          <p class="empty-state__title">${escapeHtml(t("error.loadWatchlistFailed"))}</p>
          <p>${escapeHtml(t("error.loadWatchlistHint"))}</p>
        </div>
      `;
      return;
    }

    hideLoadingSkeleton();
    updateHeaderTitle();
    window.WatchlistAuth?.registerList(window.WatchlistAuth.getProfile(), {
      accountId: window.WatchlistAuth.getAccountId(),
      name: window.WatchlistAuth.getListLabel(),
      description: window.WatchlistAuth.getListDescription(),
    });
    updateGenreOptions();
    bindEvents();
    bindOfflineSyncListeners();
    syncContentTypePicker(els.formTypePicker, els.formType, els.formType?.value || "movies");
    renderListSwitcher();
    if (els.ratingFilter?.value === "rt-best" || els.ratingFilter?.value === "rt-worst") {
      els.ratingFilter.value = "all";
      applyRatingFilter("all");
    }
    updateRatingFilterOptions();
    updateStats();
    updateAppBanners();
    render();
    if (cloudConfigured && hasLocal) {
      void runBackgroundCloudSync();
    } else {
      void runMetadataBackfill();
    }
    await consumePendingShare();

    window.WatchlistI18n?.onChange(() => {
      window.WatchlistI18n.applyDocument();
      updateHeaderTitle();
      updateAppBanners();
      updateGenreOptions();
      updateRatingFilterOptions();
      renderListSwitcher();
      updateStats();
      render();
      if (!els.modal.hidden) {
        els.modalTitle.textContent = state.editingId
          ? t("modal.editTitle")
          : t("modal.addTitle");
        renderSecondaryChips();
        renderLeadChips();
      }
      if (!els.createListModal.hidden) {
        const isEdit = Boolean(state.editingListId);
        els.createListModalTitle.textContent = isEdit
          ? t("create.editList")
          : t("create.newList");
        els.createListSubmit.textContent = isEdit ? t("btn.save") : t("btn.createList");
      }
      if (!els.manageListsModal?.hidden) renderManageLists();
      if (!els.moveListModal?.hidden) renderMoveListPicker();
    });

    if (window.WatchlistAuth.needsCodeUpgrade()) {
      await window.WatchlistDialog.alert(t("alert.codeUpgrade"), {
        title: t("alert.codeUpgradeTitle"),
      });
      openChangeCodeModal();
    }

    window.addEventListener("watchlist-sync-status", (event) => {
      const status = event.detail?.status;
      if (status === "pending") state.syncStatus = "pending";
      if (status === "saved") state.syncStatus = "saved";
      if (status === "error") state.syncStatus = resolveSyncFailureStatus();
      if (status === "saving") state.syncStatus = "pending";
      updateStats();
    });
  }

  window.WatchlistApp = {
    init,
    renderExternalRatings,
    updateRatingModalActions,
    // Exposed for title-detail.js
    findItem: (id) => state.items.find((i) => i.id === id) ?? null,
    isWatched: isItemWatched,
    getWatchEntry,
    progressState: itemProgressState,
    closeAllMenus: closeAllCardMenus,
    deleteAndRender: (id) => { deleteItem(id); updateGenreOptions(); render(); },
    // Exposed for title-seasons.js — save watch entry locally without full render
    saveWatchedEntry: (id, entry) => {
      if (!id) return;
      if (entry === null || entry === undefined) {
        delete state.watched[id];
      } else {
        state.watched[id] = entry;
      }
      saveWatched();
    },
    // Re-render a single card in-place (no full list rebuild)
    updateCardInPlace: (id) => {
      if (!id) return;
      const item = state.items.find((i) => i.id === id);
      if (!item) return;
      const card = document.querySelector(`.card[data-id="${CSS.escape(id)}"]`);
      if (!card) return;
      const tmp = document.createElement("div");
      tmp.innerHTML = renderCard(item);
      const newCard = tmp.firstElementChild;
      if (newCard) card.replaceWith(newCard);
    },
  };

  if (document.getElementById("mainContent")) {
    init();
  }
})();
