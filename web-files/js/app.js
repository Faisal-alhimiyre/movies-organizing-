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
    "Sci-Fi": "Science Fiction",
    "Sci-fi": "Science Fiction",
    "sci-fi": "Science Fiction",
  };

  const STANDARD_GENRES = window.STANDARD_GENRES || [];

  const CARD_LAYOUT_KEY = "watchlist-card-layout-v2";
  const CARD_LAYOUTS = ["hover", "poster"];
  const SYNC_META_PREFIX = "watchlist-sync-meta-";
  const LEGACY_UI_PREFS_PREFIX = "watchlist-ui-prefs-";

  let pendingImportPayload = null;
  const PENDING_SHARE_KEY = "watchlist-pending-share";
  let editingListId = null;
  let moveListItemId = null;
  let searchDebounceTimer = null;
  let listSearchDebounceTimer = null;
  let formLinkLookupTimer = null;
  let addSaveInFlight = false;
  let searchPickLoading = false;
  let searchConfirmReturnFocus = null;
  let ratingsBackfillRunning = false;
  let titleMetaBackfillRunning = false;
  let episodeTotalsBackfillRunning = false;
  let yearsBackfillRunning = false;
  /** Single in-flight gate for years/ratings/title-meta/episode-totals idle work. */
  let metadataBackfillRunning = false;
  let ptrRefreshing = false;
  let ptrLastDoneAt = 0;
  const PTR_COOLDOWN_MS = 2000;
  let mutationRevision = 0;
  const itemMutationRevision = new Map();
  let bulkImportStatusFilter = "all";
  let bulkImportExpandedRowId = null;
  let bulkImportSearchQuery = "";
  let bulkImportWorkerBusy = false;
  let bulkImportCommitBusy = false;
  let bulkImportTypeEditId = null;
  let bulkImportAutoCommitTimer = null;
  let bulkImportAutoCommitInFlight = false;
  let bulkImportAutoCommitStallStreak = 0;
  let bulkImportWakeLock = null;
  let bulkImportCopyUnresolvedResetTimer = null;
  let bulkImportPreviewRenderTimer = null;
  let bulkImportPreviewRenderLastAt = 0;
  const BULK_IMPORT_PREVIEW_RENDER_MIN_GAP_MS = 600;
  let cloudShrinkPushAllowed = false;
  const SYNC_RACE_WINDOW_MS = 5 * 60 * 1000;
  let cacheRecoveryProbed = false;
  const enrichmentUpsertTimers = new Map();
  const ENRICHMENT_UPSERT_DEBOUNCE_MS = 700;

  const INIT_CLOUD_SYNC_TIMEOUT_MS = Math.max(
    5000,
    parseInt(window.WATCHLIST_CONFIG?.initCloudSyncTimeoutMs || "25000", 10) || 25000
  );

  function withTimeout(promise, ms, label) {
    return Promise.race([
      promise,
      new Promise((_, reject) => {
        setTimeout(() => {
          reject(new Error(`${label || "Operation"} timed out after ${ms}ms`));
        }, ms);
      }),
    ]);
  }

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
    searchPickResultKey: null,
    searchConfirmOrigin: "search",
    searchConfirmForceOnList: false,
    searchConfirmSecondary: [],
    searchAddedKeys: new Set(),
    searchAddingKeys: new Set(),
    manualLinkMeta: null,
    manualLinkPreviewDetails: null,
    ratingItemId: null,
    ratingHadScore: false,
    ratingNoteOnly: false,
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

  function persistWatchlistCache(listId = state.activeListId) {
    if (!listId || !state.data) return;
    void window.WatchlistIdb?.putWatchlistCache?.(listId, state.data, state.watched, {
      itemCount: state.items.length,
      revision: Date.now(),
    });
  }

  async function loadWatchlistCacheFirst(listId) {
    if (!listId || !window.WatchlistIdb) return false;
    try {
      const cached = await window.WatchlistIdb.getWatchlistCache(listId);
      if (!cached?.data || window.WatchlistAuth?.isWatchlistEmpty?.(cached.data)) return false;
      state.data = cached.data;
      state.items = flattenWatchlist(state.data);
      state.watched = { ...state.watched, ...(cached.watched || {}) };
      window.WatchlistLifecycle?.setPhase?.(window.WatchlistLifecycle.PHASE.showing_cache, {
        cachedItemCount: cached.itemCount || state.items.length,
      });
      return true;
    } catch (err) {
      console.warn("[app] cache load failed:", err);
      return false;
    }
  }

  async function cloudBootstrap(listId, hadLocal) {
    await syncAccountLists();
    if (state.activeListId !== listId) return;

    const remote = await window.WatchlistSync.fetchSnapshot(listId);
    if (state.activeListId !== listId) return;

    const remoteCount = remote
      ? window.WatchlistSync.countWatchlistItems(remote.watchlist)
      : 0;
    window.WatchlistLifecycle?.markCloudReady(remoteCount);

    if (!hadLocal && remoteCount > 0) {
      applyRemoteSnapshotQuiet(remote);
      writeSyncMeta(listId, {
        syncedAt: new Date(remote.updated_at || Date.now()).getTime(),
        localUpdated: Date.now(),
      });
      persistWatchlistCache(listId);
      return;
    }

    if (hadLocal) {
      await reconcileWithCloud();
      if (state.activeListId === listId) persistWatchlistCache(listId);
    }
  }

  async function restoreListFromCloud() {
    const listId = state.activeListId;
    if (!listId || !window.WatchlistSync?.isConfigured()) {
      return { ok: false, reason: "not-configured" };
    }

    window.WatchlistLifecycle?.showRestoreBanner(true);
    window.WatchlistLifecycle?.setPhase(window.WatchlistLifecycle.PHASE.loading_cloud);

    try {
      stopBackgroundListWrites();
      const remote = await window.WatchlistSync.fetchSnapshot(listId);
      if (!remote || window.WatchlistAuth.isWatchlistEmpty(remote.watchlist)) {
        window.WatchlistLifecycle?.setPhase(window.WatchlistLifecycle.PHASE.restore_failed);
        return { ok: false, reason: "empty-remote" };
      }

      applyRemoteSnapshotQuiet(remote);
      const { data, watched } = storageKeys();
      localStorage.setItem(data, JSON.stringify(state.data));
      localStorage.setItem(watched, JSON.stringify(state.watched));
      writeSyncMeta(listId, {
        syncedAt: new Date(remote.updated_at || Date.now()).getTime(),
        localUpdated: Date.now(),
      });
      persistWatchlistCache(listId);
      window.WatchlistLifecycle?.markLocalReady(state.items.length);
      window.WatchlistLifecycle?.markCloudReady(state.items.length);
      window.WatchlistLifecycle?.setPhase(window.WatchlistLifecycle.PHASE.synced);
      window.WatchlistLifecycle?.showRestoreBanner(false);
      updateHeaderTitle();
      renderListSwitcher();
      updateGenreOptions();
      updateStats();
      render();
      return { ok: true, count: state.items.length };
    } catch (error) {
      console.warn("[app] restore from cloud failed:", error);
      window.WatchlistLifecycle?.setPhase(window.WatchlistLifecycle.PHASE.restore_failed);
      return { ok: false, reason: "error", error };
    }
  }

  function updateCloudRestoreBanner() {
    if (!els.cloudRestoreBanner) return;
    const lifecycle = window.WatchlistLifecycle?.getState?.();
    const show =
      lifecycle?.restoreBanner ||
      lifecycle?.phase === window.WatchlistLifecycle?.PHASE.loading_cloud ||
      lifecycle?.phase === window.WatchlistLifecycle?.PHASE.cloud_retrying;
    els.cloudRestoreBanner.hidden = !show;
    if (!show) {
      els.cloudRestoreBanner.textContent = "";
      return;
    }
    els.cloudRestoreBanner.textContent = t("sync.cloudRestore");
  }

  function stopBackgroundListWrites() {
    metadataBackfillRunning = false;
    ratingsBackfillRunning = false;
    titleMetaBackfillRunning = false;
    episodeTotalsBackfillRunning = false;
    yearsBackfillRunning = false;
    window.WatchlistSync?.cancelScheduledPush();
  }

  function isIdleBackfillDebugEnabled() {
    try {
      return localStorage.getItem("watchlist-debug-add") === "1";
    } catch {
      return false;
    }
  }

  /** Stop idle backfill on list switch, abort flags, or backgrounded tab. */
  function shouldAbortIdleBackfill(listId) {
    if (!canPersistActiveList(listId)) return true;
    try {
      if (typeof document !== "undefined" && document.hidden) return true;
    } catch {
      /* ignore */
    }
    return false;
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
    resetSessionFilters({ renderNow: false });
    if (els.ratingFilter?.value === "rt-best" || els.ratingFilter?.value === "rt-worst") {
      els.ratingFilter.value = "all";
      applyRatingFilter("all");
    }
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
      scheduleMetadataBackfill();
      if (!cacheRecoveryProbed) {
        cacheRecoveryProbed = true;
        void probeWatchlistCacheRecovery(listId);
      }
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
    searchClear: document.getElementById("searchClearBtn"),
    genre: document.getElementById("genreSelect"),
    genreFilter: document.querySelector(".genre-filter"),
    watchedFilterWrap: document.querySelector(".watched-filter"),
    ratingFilterWrap: document.querySelector(".rating-filter"),
    genreFilterChips: document.getElementById("genreFilterChips"),
    watchedFilter: document.getElementById("watchedFilter"),
    ratingFilter: document.getElementById("ratingFilter"),
    sortDirectionBtn: document.getElementById("sortDirectionBtn"),
    clearFiltersBtn: document.getElementById("clearFiltersBtn"),
    ratingsBackfillBanner: document.getElementById("ratingsBackfillBanner"),
    cloudRestoreBanner: document.getElementById("cloudRestoreBanner"),
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
    creditsModal: document.getElementById("creditsModal"),
    creditsDatasetMeta: document.getElementById("creditsDatasetMeta"),
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
    titleSearchClear: document.getElementById("titleSearchClearBtn"),
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
    bulkAddSteps: document.getElementById("bulkAddSteps"),
    bulkPasteInput: document.getElementById("bulkPasteInput"),
    bulkPasteError: document.getElementById("bulkPasteError"),
    bulkImportPreview: document.getElementById("bulkImportPreview"),
    bulkImportSummary: document.getElementById("bulkImportSummary"),
    bulkImportFilterHeading: document.getElementById("bulkImportFilterHeading"),
    bulkImportSearch: document.getElementById("bulkImportSearch"),
    bulkImportSearchClear: document.getElementById("bulkImportSearchClear"),
    bulkImportShowAll: document.getElementById("bulkImportShowAll"),
    bulkImportContinue: document.getElementById("bulkImportContinue"),
    bulkImportResolve: document.getElementById("bulkImportResolve"),
    bulkImportEndJob: document.getElementById("bulkImportEndJob"),
    bulkImportMainActions: document.getElementById("bulkImportMainActions"),
    bulkImportAccounting: document.getElementById("bulkImportAccounting"),
    bulkImportPersistenceError: document.getElementById("bulkImportPersistenceError"),
    bulkImportCopyUnresolved: document.getElementById("bulkImportCopyUnresolved"),
    bulkImportPasteCorrected: document.getElementById("bulkImportPasteCorrected"),
    bulkImportAdvanced: document.getElementById("bulkImportAdvanced"),
    bulkImportCorrectedTsv: document.getElementById("bulkImportCorrectedTsv"),
    bulkCorrectedTsvModal: document.getElementById("bulkCorrectedTsvModal"),
    bulkCorrectedTsvInput: document.getElementById("bulkCorrectedTsvInput"),
    bulkCorrectedTsvPaste: document.getElementById("bulkCorrectedTsvPaste"),
    bulkCorrectedTsvApply: document.getElementById("bulkCorrectedTsvApply"),
    bulkImportToolbar: document.getElementById("bulkImportToolbar"),
    bulkImportProgress: document.getElementById("bulkImportProgress"),
    bulkImportTableBody: document.getElementById("bulkImportTableBody"),
    bulkImportPause: document.getElementById("bulkImportPause"),
    bulkImportResume: document.getElementById("bulkImportResume"),
    bulkImportRetry: document.getElementById("bulkImportRetry"),
    bulkImportCancel: document.getElementById("bulkImportCancel"),
    bulkFileInput: document.getElementById("bulkFileInput"),
    bulkAddPasteFooter: document.getElementById("bulkAddPasteFooter"),
    bulkImportPreviewFooter: document.getElementById("bulkImportPreviewFooter"),
    bulkImportBack: document.getElementById("bulkImportBack"),
    bulkImportConfirm: document.getElementById("bulkImportConfirm"),
    copyBulkTemplate: document.getElementById("copyBulkTemplate"),
    bulkAddConfirm: document.getElementById("bulkAddConfirm"),
    ratingModal: document.getElementById("ratingModal"),
    ratingModalTitle: document.getElementById("ratingModalTitle"),
    ratingForm: document.getElementById("ratingForm"),
    ratingPicker: document.getElementById("ratingPicker"),
    ratingValueDisplay: document.getElementById("ratingValueDisplay"),
    ratingNote: document.getElementById("ratingNote"),
    ratingError: document.getElementById("ratingError"),
    ratingSaveBtn: document.getElementById("ratingSaveBtn"),
    ratingEpisodeAvgSuggest: document.getElementById("ratingEpisodeAvgSuggest"),
    ratingEpisodeAvgLabel: document.getElementById("ratingEpisodeAvgLabel"),
    ratingEpisodeAvgMeta: document.getElementById("ratingEpisodeAvgMeta"),
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
    formImdbLink: document.getElementById("formImdbLink"),
    formImdbLinkField: document.getElementById("formImdbLinkField"),
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
      button.classList.remove("btn--loading");
      button.removeAttribute("aria-busy");
      if (button === els.searchConfirmAdd) {
        delete button.dataset.defaultLabel;
        syncSearchConfirmAddButton();
        return;
      }
      button.disabled = false;
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
        if (els.bulkImportPreview && !els.bulkImportPreview.hidden) return;
        event.preventDefault();
        handleBulkAdd();
        return;
      }

      if (state.editingId && !els.form?.hidden && els.form?.checkValidity()) {
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
    return loadJson(syncMetaKey(listId), { localUpdated: 0, syncedAt: 0, lastPushedCount: 0 });
  }

  function recordCloudPushSuccess(listId, count = countLocalTitles()) {
    if (!listId) return;
    writeSyncMeta(listId, {
      syncedAt: Date.now(),
      lastPushedCount: count,
    });
    cloudShrinkPushAllowed = false;
  }

  function writeSyncMeta(listId, patch) {
    const current = readSyncMeta(listId);
    localStorage.setItem(
      syncMetaKey(listId),
      JSON.stringify({ ...current, ...patch })
    );
  }

  function purgeLegacyFilterPrefsStorage() {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key?.startsWith(LEGACY_UI_PREFS_PREFIX)) {
        localStorage.removeItem(key);
      }
    }
  }

  function resetSessionFilters({ renderNow = false } = {}) {
    state.type = "all";
    state.search = "";
    clearGenreFilters();
    state.watchedFilter = "all";
    applyRatingFilter("all");
    if (els.search) els.search.value = "";
    if (els.searchClear) els.searchClear.hidden = true;
    if (els.watchedFilter) els.watchedFilter.value = "all";
    if (els.ratingFilter) els.ratingFilter.value = "all";
    els.typeTabs.forEach((tab) => {
      const active = tab.dataset.type === "all";
      tab.classList.toggle("type-tab--active", active);
      tab.setAttribute("aria-selected", String(active));
      tab.tabIndex = active ? 0 : -1;
    });
    updateGenreOptions();
    updateRatingFilterOptions();
    updateFilterFieldHighlights();
    updateClearFiltersButton();
    if (renderNow) render();
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

  function buildCloudPushOptions(listId) {
    const meta = readSyncMeta(listId);
    return {
      allowShrink: cloudShrinkPushAllowed,
      lastPushedCount: meta.lastPushedCount ?? 0,
    };
  }

  function queueCloudSync() {
    const listId = state.activeListId;
    if (!listId || !canPersistActiveList(listId)) return;
    if (bulkImportCommitBusy) return;
    if (!window.WatchlistSync?.isConfigured()) return;
    if (window.WatchlistLifecycle && !window.WatchlistLifecycle.canWriteCloud()) return;

    touchLocalUpdated();
    state.syncStatus = "pending";
    updateStats();

    window.WatchlistSync.schedulePush(
      listId,
      () => ({
        watchlist: state.data,
        watched: state.watched,
        meta: listSyncMeta(),
        pushOptions: buildCloudPushOptions(listId),
      }),
      (result) => {
        if (result?.skipped) {
          state.syncStatus = "saved";
          updateStats();
          return;
        }
        if (result?.ok) {
          recordCloudPushSuccess(listId);
          state.syncStatus = "saved";
        } else if (result?.blocked && result?.reason === "shrink-vs-cloud") {
          cloudShrinkPushAllowed = false;
          console.error("[sync:data-loss-prevented] blocked stale shrink push");
          state.syncStatus = "error";
        } else {
          state.syncStatus = resolveSyncFailureStatus();
        }
        updateStats();
      }
    );
  }

  function bumpItemMutation(itemId) {
    mutationRevision += 1;
    const revision = mutationRevision;
    if (itemId) itemMutationRevision.set(itemId, revision);
    return revision;
  }

  const ENRICHMENT_PROTECTED_FIELDS = new Set([
    "poster",
    "cardPoster",
    "posterBroken",
    "link",
    "provider",
    "providerId",
    "contentType",
    "anilistId",
    "tmdbId",
    "imdbId",
    "imdbLink",
    "lastSelectedSeason",
    "cardSeasonName",
    "noSpecials",
    "genre",
    "secondaryGenres",
    "title",
    "id",
    "kind",
  ]);

  function isPosterOverwriteDebugEnabled() {
    try {
      return localStorage.getItem("watchlist-debug-poster-overwrite") === "1";
    } catch {
      return false;
    }
  }

  function isCastEnrichDebugEnabled() {
    return isPosterOverwriteDebugEnabled() || isImportAuditDebugEnabled();
  }

  function isBulkPosterTraceTitle(title) {
    return window.WatchlistMetadata?.isBulkAddTraceTitle?.(title);
  }

  function itemPosterUrl(item) {
    return String(item?.cardPoster || item?.poster || "").trim();
  }

  function isTrustedPosterUrl(url, item = null) {
    const trimmed = String(url || "").trim();
    if (!trimmed || !/^https?:\/\//i.test(trimmed)) return false;
    if (trimmed.includes("/extraLarge/")) return false;
    const WM = window.WatchlistMetadata;
    if (item?.contentType === "anime" || trimmed.includes("anilist")) {
      return WM?.isRawAnilistPosterUrl?.(trimmed) ?? trimmed.includes("anilist.co");
    }
    return true;
  }

  function itemHasTrustedPoster(item) {
    return isTrustedPosterUrl(itemPosterUrl(item), item);
  }

  function stripProtectedEnrichmentFields(patch, item) {
    if (!patch || typeof patch !== "object") return {};
    const safe = { ...patch };
    for (const key of ENRICHMENT_PROTECTED_FIELDS) {
      if (!(key in safe)) continue;
      if (key === "poster" || key === "cardPoster") {
        if (!isTrustedPosterUrl(safe[key], item)) delete safe[key];
        continue;
      }
      if (key === "posterBroken") {
        if (safe[key] === true && itemHasTrustedPoster(item)) delete safe[key];
        continue;
      }
      delete safe[key];
    }
    return safe;
  }

  function shouldApplyEnrichmentPoster(item, incomingUrl) {
    const incoming = String(incomingUrl || "").trim();
    if (!isTrustedPosterUrl(incoming, item)) return false;
    const current = itemPosterUrl(item);
    if (!current) return true;
    if (item?.contentType === "anime") {
      if (item.posterBroken || !isTrustedPosterUrl(current, item)) return true;
      return false;
    }
    if (item.posterBroken || !current || current.includes("/extraLarge/")) return true;
    return false;
  }

  function preservePosterFieldsOnItem(item, incoming = {}) {
    if (!item) return item;
    const beforePoster = itemPosterUrl(item);
    const beforeBroken = Boolean(item.posterBroken);
    const incomingPoster = String(incoming.poster || incoming.cardPoster || "").trim();
    if (incomingPoster && shouldApplyEnrichmentPoster(item, incomingPoster)) {
      item.poster = incomingPoster;
      item.cardPoster = incoming.cardPoster || incomingPoster;
      item.posterBroken = false;
    } else if (itemHasTrustedPoster(item)) {
      item.posterBroken = false;
    }
    if (isPosterOverwriteDebugEnabled() && isBulkPosterTraceTitle(item.title)) {
      const afterPoster = itemPosterUrl(item);
      if (beforePoster !== afterPoster || beforeBroken !== Boolean(item.posterBroken)) {
        console.warn("[poster-overwrite-trace]", {
          title: item.title,
          functionName: incoming.__source || "preservePosterFieldsOnItem",
          itemId: item.id,
          posterBefore: beforePoster,
          posterAfter: afterPoster,
          posterBrokenBefore: beforeBroken,
          posterBrokenAfter: Boolean(item.posterBroken),
          updatePayloadKeys: Object.keys(incoming).filter((k) => k !== "__source"),
          payloadContainsPoster: "poster" in incoming || "cardPoster" in incoming,
          payloadContainsPosterBroken: "posterBroken" in incoming,
          source: incoming.__source || "poster preserve",
        });
      }
    }
    return item;
  }

  function tracePosterFieldWrite(item, functionName, patch, source) {
    if (!isPosterOverwriteDebugEnabled() || !isBulkPosterTraceTitle(item?.title)) return;
    const touchesPoster =
      patch &&
      ("poster" in patch || "cardPoster" in patch || "posterBroken" in patch);
    if (!touchesPoster) return;
    console.warn("[poster-overwrite-trace]", {
      title: item?.title || "",
      functionName,
      itemId: item?.id || "",
      posterBefore: itemPosterUrl(item),
      posterAfter: String(patch?.cardPoster || patch?.poster || itemPosterUrl(item) || ""),
      posterBrokenBefore: Boolean(item?.posterBroken),
      posterBrokenAfter:
        "posterBroken" in (patch || {})
          ? Boolean(patch.posterBroken)
          : Boolean(item?.posterBroken),
      updatePayloadKeys: patch ? Object.keys(patch) : [],
      payloadContainsPoster: Boolean(
        patch && ("poster" in patch || "cardPoster" in patch)
      ),
      payloadContainsPosterBroken: Boolean(patch && "posterBroken" in patch),
      source,
    });
  }

  function applyOwnedEnrichmentFields(item, patch, source) {
    if (!item || !patch) return false;
    const safe = stripProtectedEnrichmentFields(patch, item);
    let changed = false;
    for (const [key, value] of Object.entries(safe)) {
      if (value == null || value === "") continue;
      tracePosterFieldWrite(item, "applyOwnedEnrichmentFields", { [key]: value }, source);
      if (item[key] !== value) {
        item[key] = value;
        changed = true;
      }
    }
    preservePosterFieldsOnItem(item, { __source: source });
    return changed;
  }

  function getEnrichmentRevision(itemId) {
    return itemMutationRevision.get(itemId) || 0;
  }

  function isEnrichmentStale(itemId, revisionAtStart) {
    return getEnrichmentRevision(itemId) !== revisionAtStart;
  }


  function notifyItemStateChanged(itemId, expectedRevision) {
    if (!itemId) return;
    const revisionStale =
      expectedRevision != null && itemMutationRevision.get(itemId) !== expectedRevision;


    refreshItemWatchUi(itemId);

    if (revisionStale) return;
  }

  /** Derive unwatched | inProgress | watched from a watch entry object. */
  function deriveItemProgressState(id, rawEntry) {
    if (!rawEntry) return "unwatched";
    const entry = normalizeWatchEntry(rawEntry);
    if (!entry) return "unwatched";

    const item = state.items.find((i) => i.id === id);
    const P = window.WatchlistProgress;
    if (item?.contentType === "movies" && P?.movieWatchState) {
      const movieState = P.movieWatchState(entry);
      if (movieState === "inprogress") return "inProgress";
      if (movieState === "watched") return "watched";
      return "unwatched";
    }

    if (!P || P.isLegacyComplete(entry)) return "watched";
    const prog = P.getProgress(entry);
    if (!prog || !Array.isArray(prog.episodes)) return "unwatched";
    if (prog.completed === true) return "watched";
    const regularEps = prog.episodes.filter((k) => !k.startsWith("0:"));
    if (regularEps.length > 0) return "inProgress";
    return "unwatched";
  }

  function itemProgressStateFromEntry(id, entry) {
    if (entry == null) return "unwatched";
    return deriveItemProgressState(id, entry);
  }

  /**
   * Refresh list card + open detail watch UI after local state mutation.
   * Order: derive state from entry → detail UI → outside card/stats/sort.
   */
  function refreshItemWatchUi(itemId, { seasonNum = null } = {}) {
    if (!itemId) return;

    const liveEntry = state.watched[itemId] ?? null;
    const sn = seasonNum ?? window.WatchlistSeasons?.getSelectedSeason?.() ?? null;
    const openDetailItemId = window.WatchlistTitleDetail?.activeItemId?.() ?? null;
    const detailItemIdMatches = openDetailItemId === itemId;


    if (detailItemIdMatches) {
      window.WatchlistTitleDetail?.refreshWatchBadge?.(itemId, liveEntry);
      window.WatchlistTitleDetail?.refreshMenuItems?.();
      window.WatchlistSeasons?.refreshWatchUiAfterSave?.(sn, liveEntry);
    }

    syncListCard(itemId);
  }

  function persistWatchedLocal() {
    if (!canPersistActiveList()) return;
    const { watched } = storageKeys();
    localStorage.setItem(watched, JSON.stringify(state.watched));
  }

  function queueCloudSyncForItem(itemId, revision, watchedSnapshot) {
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
        if (itemId && itemMutationRevision.get(itemId) !== revision) return;
        if (result?.skipped) {
          state.syncStatus = "saved";
          updateStats();
          return;
        }
        if (result?.ok) {
          writeSyncMeta(listId, { syncedAt: Date.now() });
          state.syncStatus = "saved";
        } else if (watchedSnapshot) {
          state.watched = watchedSnapshot;
          persistWatchedLocal();
          bumpItemMutation(itemId);
          notifyItemStateChanged(itemId);
          state.syncStatus = resolveSyncFailureStatus();
          void notifyCloudSyncFailed();
        } else {
          state.syncStatus = resolveSyncFailureStatus();
        }
        updateStats();
      }
    );
  }

  function commitWatchChange(itemId, mutateFn, uiOptions = {}) {
    if (!itemId || typeof mutateFn !== "function") return;


    const watchedSnapshot = JSON.parse(JSON.stringify(state.watched));
    const revision = bumpItemMutation(itemId);
    mutateFn();


    persistWatchedLocal();
    refreshItemWatchUi(itemId, uiOptions);
    queueCloudSyncForItem(itemId, revision, watchedSnapshot);
  }

  async function awaitCloudPushIdle() {
    const deadline = Date.now() + 15000;
    while (window.WatchlistSync?.isSyncing?.()) {
      if (Date.now() > deadline) break;
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
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
          listSyncMeta(),
          buildCloudPushOptions(listId)
        );
        if (result?.ok) {
          recordCloudPushSuccess(listId);
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
      // Re-trigger cloud sync and re-enrich any cards with missing data
      setTimeout(() => {
        queueCloudSync();
        // Re-enrich items whose posters or badges may have failed while offline
        const missingPosterIds = (state.items || [])
          .filter((item) => !item.poster || item.poster === "")
          .map((item) => item.id);
        for (const id of missingPosterIds) {
          queueItemBadgeEnrichment(id);
        }
      }, 800);
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
          syncMeta,
          buildCloudPushOptions(listId)
        );
        if (result.ok) {
          recordCloudPushSuccess(listId);
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
    // Re-read — a local delete/edit may have bumped localUpdated after this reconcile started.
    const freshMeta = readSyncMeta(listId);
    const localStamp = Math.max(freshMeta.localUpdated, freshMeta.syncedAt);

    if (
      remoteHasData &&
      (!localHasData || remoteUpdated > localStamp)
    ) {
      if (window.WatchlistAuth?.getProfile() !== listId) return;
      const localCount = countLocalTitles();
      const truncation = remoteSnapshotLooksTruncated(localCount, remote, listId, {
        remoteUpdated,
        localStamp,
      });
      if (truncation) {
        console.error("[sync:data-loss-prevented]", truncation);
        if (localHasData) {
          const result = await window.WatchlistSync.pushSnapshot(
            listId,
            state.data,
            state.watched,
            syncMeta,
            buildCloudPushOptions(listId)
          );
          if (result.ok) {
            recordCloudPushSuccess(listId);
            state.syncStatus = "saved";
          } else {
            state.syncStatus = resolveSyncFailureStatus();
          }
        }
        return;
      }
      if (window.WatchlistAuth?.getProfile() !== listId) return;
      const remoteCount =
        remote.fetched_count ??
        window.WatchlistSync?.countWatchlistItems?.(remote.watchlist) ??
        0;
      if (localCount > remoteCount + 2) {
        console.warn("[sync] applying smaller remote snapshot", {
          localCount,
          remoteCount,
          listId,
        });
      }
      applyRemoteSnapshotQuiet(remote, listId, { remoteUpdated, localStamp });
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
        syncMeta,
        buildCloudPushOptions(listId)
      );
      if (result.ok) {
        recordCloudPushSuccess(listId);
        state.syncStatus = "saved";
      } else {
        state.syncStatus = resolveSyncFailureStatus();
      }
    }
  }

  function watchEntryRichness(entry) {
    const normalized = normalizeWatchEntry(entry);
    if (!normalized) return 0;
    const P = window.WatchlistProgress;
    if (P?.isLegacyComplete?.(normalized)) {
      let score = 1000;
      if (hasWatchRating(normalized)) score += 1;
      if (String(normalized.note || "").trim()) score += 1;
      return score;
    }
    const prog = P?.getProgress?.(normalized);
    if (prog && Array.isArray(prog.episodes)) {
      const regularEps = prog.episodes.filter((key) => !String(key).startsWith("0:"));
      return (
        100 +
        regularEps.length +
        (prog.completed === true ? 500 : 0) +
        (prog.episodeRatings ? Object.keys(prog.episodeRatings).length : 0)
      );
    }
    if (hasWatchRating(normalized) || String(normalized.note || "").trim()) return 10;
    return 5;
  }

  function richerWatchEntry(a, b) {
    return watchEntryRichness(a) >= watchEntryRichness(b) ? a : b;
  }

  function mergeWatchedPreferRicher(remote, local) {
    const merged = { ...(remote || {}) };
    for (const [id, entry] of Object.entries(local || {})) {
      if (!merged[id]) {
        merged[id] = entry;
      } else {
        merged[id] = richerWatchEntry(merged[id], entry);
      }
    }
    return merged;
  }

  function itemPtrSignature(item) {
    return JSON.stringify({
      title: item.title,
      genre: item.genre,
      contentType: item.contentType,
      year: item.year,
      link: item.link,
      imdbLink: item.imdbLink,
      cardPoster: item.cardPoster,
      lastSelectedSeason: item.lastSelectedSeason,
      cardSeasonName: item.cardSeasonName,
      noSpecials: item.noSpecials,
      seasonCount: item.seasonCount,
      episodeCount: item.episodeCount,
      imdbRating: item.imdbRating,
      anilistRating: item.anilistRating,
      watched: state.watched[item.id] ?? null,
    });
  }

  function isPullRefreshBlocked() {
    if (window.WatchlistTitleDetail?.isOpen?.()) return true;
    if (isAppDialogOpen()) return true;
    if (isSearchConfirmVisible()) return true;
    if (els.ratingModal && !els.ratingModal.hidden) return true;
    if (els.modal && !els.modal.hidden) return true;
    if (els.manageListsModal && !els.manageListsModal.hidden) return true;
    if (els.createListModal && !els.createListModal.hidden) return true;
    if (els.moveListModal && !els.moveListModal.hidden) return true;
    if (state.syncRetrying) return true;
    return false;
  }

  function canPullToRefresh() {
    if (ptrRefreshing) return false;
    if (Date.now() - ptrLastDoneAt < PTR_COOLDOWN_MS) return false;
    if (!window.WatchlistSync?.isConfigured?.()) return false;
    if (typeof navigator !== "undefined" && navigator.onLine === false) return false;
    if (!state.activeListId) return false;
    if (isPullRefreshBlocked()) return false;
    return true;
  }

  function isPullToRefreshActive() {
    return ptrRefreshing;
  }

  function countLocalTitles() {
    return state.items?.length || 0;
  }

  function remoteSnapshotLooksTruncated(localCount, remote, listId, syncTiming = {}) {
    if (!remote) return false;
    const remoteCount =
      remote.fetched_count ??
      window.WatchlistSync?.countWatchlistItems?.(remote.watchlist) ??
      0;
    const expected = Number(remote.title_count) || 0;
    const meta = listId ? readSyncMeta(listId) : {};
    const lastPushed = Number(meta.lastPushedCount) || 0;
    const remoteUpdated =
      syncTiming.remoteUpdated ?? new Date(remote.updated_at || 0).getTime();
    const localStamp =
      syncTiming.localStamp ?? Math.max(meta.localUpdated, meta.syncedAt);
    const recentRace = Math.abs(remoteUpdated - localStamp) < SYNC_RACE_WINDOW_MS;

    if (expected > 0 && remoteCount > 0 && remoteCount < expected * 0.9) {
      return { truncated: true, reason: "fetch-below-title-count", localCount, remoteCount, expected };
    }

    if (
      localCount > 150 &&
      remoteCount > 0 &&
      remoteCount <= 100 &&
      localCount > remoteCount + 50
    ) {
      return { truncated: true, reason: "large-local-gap", localCount, remoteCount, expected };
    }

    if (localCount > 120 && remoteCount > 0 && localCount > remoteCount * 1.35) {
      return { truncated: true, reason: "ratio-gap", localCount, remoteCount, expected };
    }

    if (
      recentRace &&
      lastPushed > 0 &&
      localCount >= lastPushed - 1 &&
      remoteCount > 0 &&
      remoteCount < lastPushed - 2
    ) {
      return {
        truncated: true,
        reason: "remote-below-last-push",
        localCount,
        remoteCount,
        expected: lastPushed,
      };
    }

    return null;
  }

  function applyRemoteSnapshotQuiet(remote, listId = state.activeListId, syncTiming = {}) {
    const localCount = countLocalTitles();
    const truncation = remoteSnapshotLooksTruncated(localCount, remote, listId, syncTiming);
    if (truncation) {
      console.error("[sync:data-loss-prevented]", truncation);
      return false;
    }

    const bundled = window.WATCHLIST ? structuredClone(window.WATCHLIST) : null;
    const scrollY = window.scrollY;
    const oldSignatures = new Map(state.items.map((item) => [item.id, itemPtrSignature(item)]));
    const oldIds = new Set(state.items.map((item) => item.id));

    const localAddedById = new Map();
    const localPosterById = new Map();
    for (const item of state.items) {
      if (item.addedAt) localAddedById.set(item.id, item.addedAt);
      if (itemHasTrustedPoster(item)) {
        localPosterById.set(item.id, {
          poster: item.poster || "",
          cardPoster: item.cardPoster || item.poster || "",
          posterBroken: false,
          anilistId: item.anilistId,
          provider: item.provider,
          providerId: item.providerId,
        });
      }
    }

    state.data = applyBundledGenreCorrections(remote.watchlist, bundled);
    state.watched = mergeWatchedPreferRicher(remote.watched || {}, state.watched);
    state.items = flattenWatchlist(state.data);

    if (localAddedById.size) {
      for (const item of state.items) {
        const localAt = localAddedById.get(item.id);
        if (localAt) item.addedAt = localAt;
      }
    }
    for (const item of state.items) {
      const localPoster = localPosterById.get(item.id);
      if (!localPoster) continue;
      const remotePoster = itemPosterUrl(item);
      if (!isTrustedPosterUrl(remotePoster, item) && localPoster.poster) {
        if (isPosterOverwriteDebugEnabled() && isBulkPosterTraceTitle(item.title)) {
          console.warn("[poster-overwrite-trace]", {
            title: item.title,
            functionName: "applyRemoteSnapshotQuiet",
            itemId: item.id,
            posterBefore: remotePoster,
            posterAfter: localPoster.cardPoster || localPoster.poster,
            posterBrokenBefore: Boolean(item.posterBroken),
            posterBrokenAfter: false,
            updatePayloadKeys: ["poster", "cardPoster", "posterBroken"],
            payloadContainsPoster: true,
            payloadContainsPosterBroken: true,
            source: "cloud sync",
          });
        }
        item.poster = localPoster.poster;
        item.cardPoster = localPoster.cardPoster;
        item.posterBroken = false;
      }
      if (!item.anilistId && localPoster.anilistId) item.anilistId = localPoster.anilistId;
      if (!item.provider && localPoster.provider) item.provider = localPoster.provider;
      if (!item.providerId && localPoster.providerId) item.providerId = localPoster.providerId;
    }
    state.data = itemsToNested(state.items);

    if (remote.name) {
      window.WatchlistAuth.registerList(listId, {
        accountId: window.WatchlistAuth.getAccountId(),
        name: remote.name,
        description: remote.description || "",
      });
    }

    saveData();
    saveWatched();

    const remoteUpdated = new Date(remote.updated_at || 0).getTime() || Date.now();
    writeSyncMeta(listId, { syncedAt: remoteUpdated, localUpdated: remoteUpdated });

    let needsFullRender = false;
    const newIds = new Set(state.items.map((item) => item.id));

    for (const id of oldIds) {
      if (!newIds.has(id)) {
        removeCardFromDom(id);
        needsFullRender = true;
      }
    }

    for (const item of state.items) {
      if (!oldIds.has(item.id)) {
        needsFullRender = true;
        break;
      }
      if (itemPtrSignature(item) !== oldSignatures.get(item.id)) {
        syncListCard(item.id);
      }
    }

    if (needsFullRender) {
      render();
      window.scrollTo(0, scrollY);
    }

    updateHeaderTitle();
    renderListSwitcher();
    updateGenreOptions();
    updateStats();
    updateClearFiltersButton();
    updateFilterFieldHighlights();

    if (window.WatchlistTitleDetail?.isOpen?.()) {
      window.WatchlistTitleDetail.refresh?.();
      window.WatchlistSeasons?.onExternalRefresh?.();
    }
    return true;
  }

  async function pullToRefreshFromCloud() {
    if (!canPullToRefresh()) return { ok: false, reason: "blocked" };

    const listId = state.activeListId;
    ptrRefreshing = true;
    let outcome = { ok: false, reason: "error" };

    try {
      await awaitCloudPushIdle();
      window.WatchlistSync?.cancelScheduledPush?.();
      await syncAccountLists();
      if (state.activeListId !== listId) {
        outcome = { ok: false, reason: "list-changed" };
        return outcome;
      }

      const remote = await window.WatchlistSync.fetchSnapshot(listId);
      if (state.activeListId !== listId) {
        outcome = { ok: false, reason: "list-changed" };
        return outcome;
      }

      if (!remote) {
        outcome = { ok: false, reason: "error" };
        return outcome;
      }

      const remoteHasData = !window.WatchlistAuth.isWatchlistEmpty(remote.watchlist);
      const localHasData = !window.WatchlistAuth.isWatchlistEmpty(state.data);

      if (!remoteHasData && localHasData) {
        outcome = { ok: true };
        state.syncStatus = "saved";
        return outcome;
      }

      if (!remoteHasData) {
        outcome = { ok: false, reason: "empty" };
        return outcome;
      }

      const applied = applyRemoteSnapshotQuiet(remote, listId, {
        remoteUpdated: new Date(remote.updated_at || 0).getTime(),
        localStamp: Math.max(readSyncMeta(listId).localUpdated, readSyncMeta(listId).syncedAt),
      });
      if (!applied) {
        outcome = { ok: false, reason: "truncated-remote" };
        return outcome;
      }
      state.syncStatus = "saved";
      outcome = { ok: true };
      return outcome;
    } catch (error) {
      console.warn("[ptr] pull refresh failed:", error);
      outcome = { ok: false, reason: "error" };
      return outcome;
    } finally {
      ptrRefreshing = false;
      ptrLastDoneAt = Date.now();
      if (outcome.ok) {
        state.syncStatus = "saved";
      } else if (state.syncStatus === "pending") {
        state.syncStatus = "saved";
      }
      updateStats();
    }
  }

  function saveWatched() {
    persistWatchedLocal();
    queueCloudSync();
  }

  function saveData() {
    if (!canPersistActiveList()) return;
    const { data } = storageKeys();
    state.data = itemsToNested(state.items);
    try {
    localStorage.setItem(data, JSON.stringify(state.data));
    } catch (err) {
      console.warn("[app] local save failed:", err);
      window.WatchlistStorageDiagnostics?.clearDisposableCaches?.();
      try {
        localStorage.setItem(data, JSON.stringify(state.data));
      } catch (retryErr) {
        console.error("[app] local save failed after cache trim:", retryErr);
      }
    }
    persistWatchlistCache();
    queueCloudSync();
    // Keep the anime duplicate-detection lookups fresh so a second add in the
    // same session never sees a stale (pre-save) watchlist snapshot.
    invalidateWatchlistFranchiseLookupCache();
    invalidateWatchlistTitleLookupCache();
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

  function anilistUrlForItem(item) {
    const WM = window.WatchlistMetadata;
    const link = item?.link || "";
    if (WM?.extractAnilistId?.(link)) return link;
    if (WM?.extractMalId?.(link)) return link;
    return "";
  }

  function imdbUrlForItem(item) {
    const WM = window.WatchlistMetadata;
    const imdbLink = item?.imdbLink || "";
    if (WM?.extractImdbId?.(imdbLink)) return imdbLink;
    const link = item?.link || "";
    if (WM?.extractImdbId?.(link)) return link;
    return "";
  }

  async function backfillAnimeLinksForForm(item) {
    if (!item || normalizeContentType(item.contentType) !== "anime") return;

    if (!els.formLink?.value.trim()) {
      const match = await window.WatchlistMetadata?.fetchAnilistMatchByTitle?.(
        item.title,
        item.year
      );
      if (match?.anilistId) {
        els.formLink.value = `https://anilist.co/anime/${match.anilistId}/`;
      }
    }

    if (!els.formImdbLink?.value.trim()) {
      const imdbId = getImdbId(item);
      if (imdbId) {
        els.formImdbLink.value = `https://www.imdb.com/title/${imdbId}/`;
      } else if (els.formLink.value.trim()) {
        const anilistId = window.WatchlistMetadata?.extractAnilistId?.(
          els.formLink.value
        );
        if (anilistId) {
          const linked = await window.WatchlistSeriesMetadata?.resolveLinkedImdbId?.({
            anilistId: Number(anilistId),
          });
          if (linked) {
            els.formImdbLink.value = `https://www.imdb.com/title/${linked}/`;
          }
        }
      }
    }
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

  function updateFormImdbLinkVisibility(contentType) {
    if (!els.formImdbLinkField) return;
    const show = normalizeContentType(contentType) === "anime";
    els.formImdbLinkField.hidden = !show;
    const linkLabel = els.formLink?.closest(".form-field")?.querySelector(".form-field__label");
    if (linkLabel) {
      linkLabel.textContent = show ? "AniList link" : "Link";
    }
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
    if (picker === els.formTypePicker) {
      updateFormImdbLinkVisibility(normalized);
    }
    if (picker === els.searchConfirmTypePicker) {
      void refreshSearchConfirmForType();
    }
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
      sourceGenres: meta.genres || [],
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

    const contentType = normalizeContentType(meta.contentType || els.formType?.value);
    if (
      (contentType === "tvSeries" || contentType === "anime") &&
      !Number.isFinite(parseInt(String(meta.episodeCount || "").trim(), 10))
    ) {
      const locale = window.WatchlistI18n?.getLang?.() || "en";
      const total = await window.WatchlistSeriesMetadata?.fetchTitleEpisodeTotal?.(
        { contentType, link },
        locale
      );
      if (total > 0) meta.episodeCount = total;
    }

    applyMetadataToManualForm(meta);
    if (
      normalizeContentType(els.formType?.value) === "anime" &&
      els.formImdbLink &&
      !els.formImdbLink.value.trim()
    ) {
      if (meta.imdbId) {
        els.formImdbLink.value = `https://www.imdb.com/title/${meta.imdbId}/`;
      } else if (window.WatchlistMetadata?.isAnilistLink?.(link)) {
        const anilistId = window.WatchlistMetadata.extractAnilistId(link);
        const linked = anilistId
          ? await window.WatchlistSeriesMetadata?.resolveLinkedImdbId?.({ anilistId })
          : null;
        if (linked) {
          els.formImdbLink.value = `https://www.imdb.com/title/${linked}/`;
        }
      }
    }
    if (els.formImdbLink?.value.trim()) {
      const imdbId = window.WatchlistMetadata?.extractImdbId?.(
        els.formImdbLink.value
      );
      if (imdbId) {
        const imdbMeta = await window.WatchlistMetadata?.getMetadata?.(imdbId);
        if (imdbMeta?.rating) {
          state.manualLinkMeta = state.manualLinkMeta || {};
          state.manualLinkMeta.imdbRating = imdbMeta.rating;
        }
      }
    }
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

    // Preserve granular progress (episodes, per-episode ratings, season totals).
    const progress = window.WatchlistProgress?.exportProgressObject?.(value.progress);
    if (progress) entry.progress = progress;

    return entry;
  }

  function isItemWatched(id) {
    return Boolean(state.watched[id]);
  }

  function isWatchEntryEmpty(entry) {
    if (!entry) return true;
    const P = window.WatchlistProgress;
    if (P?.isLegacyComplete(entry)) return false;
    const prog = P?.getProgress(entry);
    if (prog?.completed === true) return false;
    if (Array.isArray(prog?.episodes) && prog.episodes.length > 0) return false;
    // seasonTotals is a cached episode-count (written whenever a season's
    // episode list loads) — it is NOT a watched signal on its own. Treating
    // it as "meaningful" here kept fully-unmarked entries alive forever,
    // which made isItemWatched()/the card badge report "Watched" even after
    // every episode in the season was unmarked (confirmed via runtime logs:
    // episodes: [] but seasonTotals present still returned false/not-empty).
    if (prog?.episodeRatings && Object.keys(prog.episodeRatings).length > 0) return false;
    if (typeof prog?.moviePosition === "number" && prog.moviePosition > 0) return false;
    if (hasWatchRating(entry)) return false;
    if (String(entry.note || "").trim()) return false;
    return true;
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

    syncRatingSaveEnabled();
  }

  function syncRatingSaveEnabled() {
    const submitBtn =
      els.ratingSaveBtn ||
      els.ratingForm?.querySelector('button[type="submit"]');
    if (!submitBtn) return;
    // Note-only mode: allow save without stars. Rating mode: require a score.
    if (state.ratingNoteOnly) {
      submitBtn.disabled = false;
      return;
    }
    submitBtn.disabled = !state.ratingPickerChosen || state.ratingPickerValue == null;
  }

  function formatEpisodeAvgDisplay(avg) {
    const num = Number(avg);
    if (!Number.isFinite(num)) return "";
    return num % 1 === 0 ? String(num) : num.toFixed(1);
  }

  function updateRatingEpisodeAvgSuggest(itemId) {
    const box = els.ratingEpisodeAvgSuggest;
    if (!box) return;
    box.hidden = true;
    box.dataset.avg = "";

    if (state.ratingNoteOnly) return;
    const item = state.items.find((entry) => entry.id === itemId);
    if (!item) return;
    const type = normalizeContentType(item.contentType);
    if (type !== "tvSeries" && type !== "anime") return;

    const entry = getWatchEntry(itemId);
    const stats = window.WatchlistProgress?.episodeRatingStats?.(entry, {
      includeSpecials: false,
    });
    if (!stats) return;

    const avgText = formatEpisodeAvgDisplay(stats.avg);
    if (els.ratingEpisodeAvgLabel) {
      els.ratingEpisodeAvgLabel.textContent = t("seasons.episodeAvgSuggest", {
        rating: avgText,
      });
    }
    if (els.ratingEpisodeAvgMeta) {
      const total = parseInt(String(item.episodeCount || "").trim(), 10);
      els.ratingEpisodeAvgMeta.textContent =
        Number.isFinite(total) && total > 0
          ? t("seasons.episodeAvgRatedMeta", {
              rated: stats.ratedCount,
              total,
            })
          : t("seasons.episodeAvgRatedMetaShort", {
              rated: stats.ratedCount,
            });
    }
    box.dataset.avg = String(stats.avg);
    box.hidden = false;
  }

  function applyRatingEpisodeAvgSuggest() {
    const raw = els.ratingEpisodeAvgSuggest?.dataset?.avg;
    const avg = Number(raw);
    if (!Number.isFinite(avg) || avg <= 0) return;
    chooseRatingPickerValue(avg);
    setRatingError("");
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

    if (state.ratingNoteOnly) {
      // In-progress note-only mode: no rating terminology
      laterBtn.textContent = t("btn.cancel");
      submitBtn.textContent = t("btn.save");
    } else if (state.ratingHadScore) {
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
    if (!entry) {
      return;
    }

    if (watchEntryHasUserData(entry)) {
      const confirmed = await window.WatchlistDialog.confirm(t("alert.markUnwatchedConfirm"), {
        title: t("alert.markUnwatchedTitle"),
        confirmLabel: t("card.markUnwatched"),
        cancelLabel: t("btn.cancel"),
        danger: true,
      });
      if (!confirmed) {
        return;
      }
    }

    commitWatchChange(itemId, () => {
      delete state.watched[itemId];
    });
  }

  async function markItemWatched(itemId, { openRating = false } = {}) {
    if (!itemId) return;
    if (itemProgressState(itemId) === "watched") {
      return;
    }

    commitWatchChange(itemId, () => {
      const existing = normalizeWatchEntry(state.watched[itemId]);
      const entry = existing ? { ...existing } : {};
      delete entry.progress;
      state.watched[itemId] = entry;
    });

    if (openRating) openRatingModal(itemId);
  }

  /** Re-render one list card + header/filter chrome after any item or watch mutation. */
  function syncListCard(itemId, { invalidateTypeCache = true } = {}) {
    if (!itemId) {
      return;
    }
    // Cosmetic backfill patches keep type-tab DOM cache; structural changes clear it.
    if (invalidateTypeCache) clearTypeViewDomCache();
    closeAllCardMenus();

    const item = state.items.find((entry) => entry.id === itemId);
    const filtered = getFilteredItems();
    const stillVisible = Boolean(item && filtered.some((entry) => entry.id === itemId));
    const card = els.main?.querySelector(`.card[data-id="${CSS.escape(itemId)}"]`);

    if (stillVisible && item && card) {
      const existingPoster = card.querySelector("img.card__poster[src]");
      const existingPosterSrc = existingPoster
        ? normalizePosterUrl(existingPoster.getAttribute("src") || existingPoster.src)
        : "";
      const desiredPoster = normalizePosterUrl(cardDisplayPoster(item));

      const tmp = document.createElement("div");
      tmp.innerHTML = renderCard(item);
      const newCard = tmp.firstElementChild;
      if (newCard) {
        // Reuse the live <img> when the URL is unchanged so mobile does not re-download.
        if (
          existingPoster &&
          desiredPoster &&
          existingPosterSrc === desiredPoster
        ) {
          const newPosterSlot = newCard.querySelector(
            "img.card__poster, [data-poster-slot], .card__poster--placeholder, .card__poster--broken"
          );
          if (newPosterSlot) newPosterSlot.replaceWith(existingPoster);
        }
        card.replaceWith(newCard);
        bindPosterErrorHandlers();
        bindPosterLoadTracking();
      }
    } else if (!stillVisible && card) {
      card.remove();
    } else if (stillVisible && item && !card) {
      render();
      return;
    }

    if (!els.main?.querySelector(".card")) {
      if (state.items.length === 0) {
        els.main.innerHTML = renderEmptyListState();
      } else if (filtered.length === 0) {
        els.main.innerHTML = renderEmptyFilterState();
      }
    }

    updateStats();
    updateClearFiltersButton();
    updateFilterFieldHighlights();
    if (stillVisible && item) reorderListCardInGroup(itemId);
  }

  function reorderListCardInGroup(itemId) {
    const card = els.main?.querySelector(`.card[data-id="${CSS.escape(itemId)}"]`);
    if (!card) return;
    const container = card.closest(".cards, .cards--rating-sorted");
    if (!container) return;

    const filtered = getFilteredItems();
    const groups = groupItems(filtered);
    const group = groups.find((g) => g.items.some((i) => i.id === itemId));
    if (!group) return;

    const idsInContainer = new Set(
      [...container.querySelectorAll(":scope > .card")].map((el) => el.dataset.id)
    );
    const sorted = group.items.filter((i) => idsInContainer.has(i.id));
    const order = new Map(sorted.map((entry, index) => [entry.id, index]));
    const cards = [...container.querySelectorAll(":scope > .card")];
    cards.sort(
      (a, b) => (order.get(a.dataset.id) ?? 9999) - (order.get(b.dataset.id) ?? 9999)
    );
    for (const el of cards) container.appendChild(el);
  }

  /** Reorder all visible card groups to match current filter sort — no innerHTML wipe. */
  function reorderVisibleCardsByCurrentSort() {
    if (!els.main) return;
    const filtered = getFilteredItems();
    const groups = groupItems(filtered);
    for (const group of groups) {
      if (!group.items?.length) continue;
      const firstId = group.items[0]?.id;
      if (!firstId) continue;
      const card = els.main.querySelector(`.card[data-id="${CSS.escape(firstId)}"]`);
      const container = card?.closest(".cards, .cards--rating-sorted");
      if (!container) continue;
      const idsInContainer = new Set(
        [...container.querySelectorAll(":scope > .card")].map((el) => el.dataset.id)
      );
      const sorted = group.items.filter((i) => idsInContainer.has(i.id));
      const order = new Map(sorted.map((entry, index) => [entry.id, index]));
      const cards = [...container.querySelectorAll(":scope > .card")];
      cards.sort(
        (a, b) => (order.get(a.dataset.id) ?? 9999) - (order.get(b.dataset.id) ?? 9999)
      );
      for (const el of cards) container.appendChild(el);
    }
  }

  function refreshCardWatchState(itemId) {
    syncListCard(itemId);
  }

  function openRatingModal(itemId) {
    const item = state.items.find((entry) => entry.id === itemId);
    if (!item || !els.ratingModal) return;

    const isFullyWatched = itemProgressState(itemId) === "watched";

    state.ratingItemId = itemId;
    state.ratingNoteOnly = !isFullyWatched;
    setRatingError("");

    const existing = getWatchEntry(itemId);
    state.ratingHadScore = hasWatchRating(existing);

    // Title: "Your thoughts" for note-only, "Rate …" for rating mode
    if (state.ratingNoteOnly) {
      els.ratingModalTitle.textContent = t("rating.yourThoughts");
    } else {
      els.ratingModalTitle.textContent = t("rating.rateItem", { title: item.title });
    }

    if (state.ratingHadScore) {
      resetRatingPicker({ chosen: true, rating: existing.rating });
    } else {
      resetRatingPicker();
    }

    // Pre-fill note; change placeholder to "Thoughts so far" in note-only mode
    els.ratingNote.value = existing?.note || "";
    if (els.ratingNote) {
      els.ratingNote.placeholder = state.ratingNoteOnly
        ? t("rating.thoughtsSoFar")
        : t("rating.notePlaceholder");
    }

    // Hide the rating picker when the title isn't fully watched yet
    if (els.ratingPicker) els.ratingPicker.hidden = !isFullyWatched;

    updateRatingEpisodeAvgSuggest(itemId);
    updateRatingModalActions();
    syncRatingSaveEnabled();
    els.ratingModal.hidden = false;
    updateBodyScrollLock();
    closeAllCardMenus();
    if (isFullyWatched) {
      els.ratingPicker?.querySelector('[data-rating-star="5"]')?.focus();
    } else {
      els.ratingNote?.focus();
    }
  }

  function closeRatingModal() {
    if (!els.ratingModal) return;
    els.ratingModal.hidden = true;
    state.ratingItemId = null;
    state.ratingHadScore = false;
    state.ratingNoteOnly = false;
    setRatingError("");
    if (els.ratingForm) els.ratingForm.reset();
    if (els.ratingPicker) els.ratingPicker.hidden = false; // restore for next open
    if (els.ratingNote) els.ratingNote.placeholder = t("rating.notePlaceholder");
    if (els.ratingEpisodeAvgSuggest) {
      els.ratingEpisodeAvgSuggest.hidden = true;
      els.ratingEpisodeAvgSuggest.dataset.avg = "";
    }
    resetRatingPicker();
    updateBodyScrollLock();
  }

  function saveWatchRating({ rating, note }) {
    const id = state.ratingItemId;
    if (!id) return false;

    const isFullyWatched = itemProgressState(id) === "watched";
    const parsedRating = parseWatchRating(rating);

    // If fully watched, a star rating is required. For other states, allow note-only.
    if (isFullyWatched && parsedRating == null) {
      setRatingError(t("rating.chooseStarFirst"));
      return false;
    }

    const existing = getWatchEntry(id);
    const entry = { ...existing };
    if (parsedRating != null) entry.rating = parsedRating;
    const trimmedNote = String(note || "").trim();
    if (trimmedNote) entry.note = trimmedNote;
    else delete entry.note;

    // Ensure a watch entry exists even for unwatched/in-progress titles with a note
    state.watched[id] = entry;
    saveWatched();
    closeRatingModal();
    render();
    return true;
  }

  function dismissRatingModal() {
    // In note-only mode (in-progress) or when editing an existing rating, just close
    if (state.ratingNoteOnly || state.ratingHadScore) {
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
            imdbLink: normalizeLink(entryClean.imdbLink),
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
      if (item.imdbLink) entry.imdbLink = item.imdbLink;
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
      if (item.sourceGenres?.length) {
        entry.sourceGenres = item.sourceGenres;
      }
      if (item.cardPoster) entry.cardPoster = item.cardPoster;
      if (item.posterBroken === true) entry.posterBroken = true;
      if (item.anilistId) entry.anilistId = item.anilistId;
      if (item.tmdbId) entry.tmdbId = item.tmdbId;
      if (item.imdbId) entry.imdbId = item.imdbId;
      if (item.provider) entry.provider = item.provider;
      if (item.providerId) entry.providerId = item.providerId;
      if (item.lastSelectedSeason != null) entry.lastSelectedSeason = item.lastSelectedSeason;
      if (item.cardSeasonName) entry.cardSeasonName = item.cardSeasonName;
      if (item.noSpecials === true) entry.noSpecials = true;

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
    return deriveItemProgressState(id, raw);
  }

  function progressSortRank(id) {
    const progress = itemProgressState(id);
    if (progress === "inProgress") return 1;
    if (progress === "watched") return 2;
    // Entry exists but granular state is empty — still sort with watched (matches footer).
    if (isItemWatched(id)) return 2;
    return 0;
  }

  function compareItemsByProgress(a, b) {
    return progressSortRank(a.id) - progressSortRank(b.id);
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

  function parseRuntimeMinutes(runtime) {
    const raw = String(runtime || "").trim();
    if (!raw) return null;
    const match = raw.match(/(\d{1,4})/);
    if (!match) return null;
    const minutes = parseInt(match[1], 10);
    return Number.isFinite(minutes) && minutes > 0 ? minutes : null;
  }

  function parseEpisodeCount(item) {
    const value = parseInt(String(item?.episodeCount || "").trim(), 10);
    return Number.isFinite(value) && value > 0 ? value : null;
  }

  function getRatingSortScore(item) {
    const source = state.ratingFilterSource;
    if (!source || source === "all") return null;
    if (source === "imdb") return getItemImdbScore(item);
    if (source === "anilist") return getItemAnilistSortScore(item);
    if (source === "personal") return getItemPersonalScore(item);
    if (source === "age") return window.WatchlistMetadata?.ageRatingSortRank?.(item.ageRating) ?? null;
    if (source === "duration") return parseRuntimeMinutes(item?.runtime);
    if (source === "episodes") {
      if (item?.contentType !== "tvSeries" && item?.contentType !== "anime") return null;
      return parseEpisodeCount(item);
    }
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
    return (
      source === "imdb" ||
      source === "anilist" ||
      source === "personal" ||
      source === "age" ||
      source === "duration" ||
      source === "episodes"
    );
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
    const options = [
      { value: "all", labelKey: "filter.ratingOptionAll" },
      { value: "added", labelKey: "filter.ratingOptionAdded" },
      { value: "release", labelKey: "filter.ratingOptionRelease" },
      { value: "age", labelKey: "filter.ratingOptionAge" },
      { value: "imdb", labelKey: "filter.ratingOptionImdb" },
      { value: "anilist", labelKey: "filter.ratingOptionAnilist" },
      { value: "personal", labelKey: "filter.ratingOptionPersonal" },
    ];
    if (state.type === "movies") {
      options.splice(4, 0, { value: "duration", labelKey: "filter.ratingOptionDuration" });
    } else if (state.type === "tvSeries" || state.type === "anime") {
      options.splice(4, 0, { value: "episodes", labelKey: "filter.ratingOptionEpisodes" });
    }
    return options;
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
    if (
      value === "imdb" ||
      value === "anilist" ||
      value === "personal" ||
      value === "age" ||
      value === "duration" ||
      value === "episodes"
    ) {
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
      const progressDiff = compareItemsByProgress(a, b);
      if (progressDiff !== 0) return progressDiff;

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

  function updateFilterFieldHighlights() {
    const genreActive = state.selectedGenres.length > 0;
    els.genreFilter?.classList.toggle("genre-filter--active", genreActive);
    els.genre?.classList.toggle("filter-field--active", genreActive);

    const watchedActive = state.watchedFilter !== "all";
    els.watchedFilterWrap?.classList.toggle("watched-filter--active", watchedActive);
    els.watchedFilter?.classList.toggle("filter-field--active", watchedActive);

    const sortActive = state.ratingFilterSource !== "all";
    els.ratingFilterWrap?.classList.toggle("rating-filter--active", sortActive);
    els.ratingFilter?.classList.toggle("filter-field--active", sortActive);
  }

  function updateClearFiltersButton() {
    if (!els.clearFiltersBtn) return;
    const show = hasPanelFilters();
    els.clearFiltersBtn.hidden = !show;
    els.clearFiltersBtn.textContent = t("empty.clearFilters");
  }

  function clearAllFilters() {
    resetSessionFilters({ renderNow: true });
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
    updateCloudRestoreBanner();
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
        <div class="empty-state__actions">
          <button type="button" class="btn btn--primary empty-state__btn" data-action="add">
            ${escapeHtml(t("btn.addTitle"))}
          </button>
          <button type="button" class="btn btn--ghost empty-state__btn" data-action="open-add-bulk">
            ${escapeHtml(t("empty.ctaBulk"))}
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

  function applyWatchedFilter(value) {
    const next =
      value === "watched" || value === "inProgress" || value === "unwatched" || value === "all"
        ? value
        : "all";
    state.watchedFilter = next;
    if (els.watchedFilter) els.watchedFilter.value = next;
    updateFilterFieldHighlights();
    updateClearFiltersButton();
    render();
  }

  function headerStatChipActiveClass(filterValue) {
    return state.watchedFilter === filterValue ? " header__stat-chip--active" : "";
  }

  function updateStats() {
    const total = state.items.length;
    const watchedCount = state.items.filter((i) => itemProgressState(i.id) === "watched").length;
    const inProgressCount = state.items.filter((i) => itemProgressState(i.id) === "inProgress").length;

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
      <button type="button" class="header__stat-chip header__stat-chip--filter${headerStatChipActiveClass("all")}"
        data-action="filter-watched" data-watched-filter="all"
        aria-label="${escapeHtml(t("stats.filterAll"))}">
        <span class="header__stat-value text-num">${total}</span>
        <span class="header__stat-label">${escapeHtml(t("stats.totalWord"))}</span>
      </button>
      <button type="button" class="header__stat-chip header__stat-chip--watched header__stat-chip--filter${headerStatChipActiveClass("watched")}"
        data-action="filter-watched" data-watched-filter="watched"
        aria-label="${escapeHtml(t("stats.filterWatched"))}">
        <span class="header__stat-value text-num">${watchedCount}</span>
        <span class="header__stat-label">${escapeHtml(t("stats.watchedWord"))}</span>
      </button>
      <button type="button" class="header__stat-chip header__stat-chip--in-progress header__stat-chip--filter${headerStatChipActiveClass("inProgress")}"
        data-action="filter-watched" data-watched-filter="inProgress"
        aria-label="${escapeHtml(t("stats.filterInProgress"))}">
        <span class="header__stat-value text-num">${inProgressCount}</span>
        <span class="header__stat-label">${escapeHtml(t("stats.inProgressWord"))}</span>
      </button>
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
    if (item?.imdbId) {
      const id = String(item.imdbId).trim().toLowerCase();
      return id.startsWith("tt") ? id : `tt${id.replace(/^tt/i, "")}`;
    }
    return window.WatchlistMetadata?.extractImdbId(item.imdbLink || item.link) || null;
  }

  function getAnilistId(item) {
    const SM = window.WatchlistSeriesMetadata;
    const sync = SM?.resolveWatchlistItemAnilistIdSync?.(item);
    if (sync) return String(sync);
    if (item?.anilistId != null && item.anilistId !== "") {
      return String(item.anilistId);
    }
    return window.WatchlistMetadata?.extractAnilistId?.(item.link) || null;
  }

  function getWatchlistAnimeItems() {
    const SM = window.WatchlistSeriesMetadata;
    return state.items
      .filter((item) => item.contentType === "anime")
      .map((item) => {
        const anilistId = SM?.resolveWatchlistItemAnilistIdSync?.(item) || getAnilistId(item);
        if (!anilistId) return null;
        return { ...item, anilistId: Number(anilistId) };
      })
      .filter(Boolean);
  }

  async function resolveWatchlistAnimeItems(options = {}) {
    const SM = window.WatchlistSeriesMetadata;
    const resolved = [];
    let changed = false;

    for (const item of state.items) {
      if (item.contentType !== "anime") continue;
      const result = await SM?.resolveWatchlistItemAnilistId?.(item, {
        persist: options.persist !== false,
        allowLive: options.allowLive !== false,
        allowOffline: options.allowOffline !== false,
      });
      if (result?.anilistId) {
        if (result.source && result.source !== "stored") changed = true;
        resolved.push({ ...item, anilistId: Number(result.anilistId) });
      }
    }

    if (changed && options.persist !== false) saveData();
    return resolved;
  }

  const ANIME_GROUP_DEBUG_TITLES = [
    "fairy tail",
    "100 years quest",
    "naruto",
    "shippuden",
    "boruto",
  ];

  function itemMatchesAnimeGroupDebug(item) {
    if (!item || item.contentType !== "anime") return false;
    const hay = String(item.title || "").toLowerCase();
    return ANIME_GROUP_DEBUG_TITLES.some((needle) => hay.includes(needle));
  }

  function buildAnimeGroupDebugRow(item, resolved, group, probe) {
    const watchEntry = state.watched[item.id] || null;
    const decision = group?.groupingDecision || (group?.ok ? "unknown" : "unresolved");
    return {
      watchlistItemId: item.id,
      title: item.title,
      contentType: item.contentType,
      link: item.link || "",
      anilistId: resolved?.anilistId ?? item.anilistId ?? null,
      anilistResolveSource: resolved?.source || item.anilistIdSource || null,
      provider: item.provider || null,
      providerId: item.providerId || null,
      providerCacheHit: Boolean(probe?.providerCacheHit),
      providerCacheId: probe?.providerCacheId ?? null,
      animeTitleIndexHit: Boolean(probe?.animeTitleIndexHit),
      animeTitleIndexId: probe?.animeTitleIndexId ?? null,
      resolvedAnilistId: resolved?.anilistId ?? null,
      resolveSource: resolved?.source || null,
      rootAnilistId: group?.rootAnilistId ?? null,
      rootTitle: group?.rootTitle || "",
      relationPath: group?.relationPath || group?.chainIds || [],
      allFranchiseTvIds: group?.allFranchiseTvIds || [],
      groupRole: group?.groupRole ?? null,
      groupingDecision: decision,
      shouldMerge: group?.shouldMerge ?? false,
      standaloneReason: group?.standaloneReason || group?.reason || "",
      poster: item.cardPoster || item.poster || "",
      posterBroken: Boolean(item.posterBroken),
      selectedSeason: item.lastSelectedSeason ?? item.selectedSeason ?? null,
      selectedSeasonName: item.cardSeasonName || "",
      groupedDuplicateReview: Boolean(item.groupedDuplicateReview),
      addedAt: item.addedAt || null,
      watched: Boolean(watchEntry?.watched),
      inProgress: Boolean(watchEntry?.inProgress),
      rating: watchEntry?.rating ?? null,
      note: watchEntry?.note || "",
      episodeProgressCount: Array.isArray(watchEntry?.progress?.episodes)
        ? watchEntry.progress.episodes.length
        : 0,
    };
  }

  async function debugAnimeGroupState(titleNeedles = ANIME_GROUP_DEBUG_TITLES) {
    const SM = window.WatchlistSeriesMetadata;
    const needles = (titleNeedles || []).map((s) => String(s).toLowerCase());
    const rows = [];

    for (const item of state.items) {
      if (item.contentType !== "anime") continue;
      const hay = String(item.title || "").toLowerCase();
      if (needles.length && !needles.some((needle) => hay.includes(needle))) continue;

      const probe = await SM?.probeWatchlistItemAnilistId?.(item);
      const resolved = await SM?.resolveWatchlistItemAnilistId?.(item, {
        persist: false,
        allowLive: true,
        allowOffline: true,
      });
      const group = resolved?.anilistId
        ? await SM?.resolveAnimeSeriesGroup?.(item, {
            persist: false,
            allowLive: false,
            groupingOnly: true,
            includeChain: true,
          })
        : null;
      const row = buildAnimeGroupDebugRow(item, resolved, group, probe);
      rows.push(row);
      if (isIdleBackfillDebugEnabled()) console.warn("[anime-group-debug]", row);
    }

    const byRoot = new Map();
    for (const row of rows) {
      if (!row.rootAnilistId) continue;
      const key = String(row.rootAnilistId);
      if (!byRoot.has(key)) byRoot.set(key, []);
      byRoot.get(key).push(row.title);
    }
    for (const [rootId, titles] of byRoot.entries()) {
      if (titles.length > 1 && isIdleBackfillDebugEnabled()) {
        console.warn("[anime-group-debug] franchise cluster", { rootAnilistId: rootId, titles });
      }
    }

    return rows;
  }

  function itemNeedsImdbBackfill(item) {
    if (item.imdbRating) return false;
    const imdbId = getImdbId(item);
    if (imdbId) return true;
    if (item.contentType === "anime" && getAnilistId(item)) return true;
    return false;
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

  /**
   * After a metadata backfill patch: persist + update one card.
   * Never full-list render() — that tears down every poster <img> on mobile.
   */
  function persistBackfillItem(itemId) {
    state.data = itemsToNested(state.items);
    saveData();
    syncListCard(itemId, { invalidateTypeCache: false });
  }

  /** Let first-paint posters load before background badge/rating API work. */
  function scheduleMetadataBackfill() {
    const run = () => {
      void runMetadataBackfill();
    };
    if (typeof requestIdleCallback === "function") {
      requestIdleCallback(run, { timeout: 4000 });
    } else {
      window.setTimeout(run, 1500);
    }
  }

  async function backfillMissingYears() {
    if (yearsBackfillRunning) return;

    const queue = state.items.filter(itemNeedsYearBackfill);
    if (!queue.length) return;

    const listId = state.activeListId;
    if (!listId) return;

    if (yearBackfillNeedsMovieApiKeys()) {
      return;
    }

    yearsBackfillRunning = true;
    let done = 0;
    const total = queue.length;
    let updated = 0;
    let failCount = 0;
    const touchedIds = [];
    updateRatingsBackfillBanner({ running: true, done, total, phase: "year" });

    for (const item of queue) {
      if (!yearsBackfillRunning || shouldAbortIdleBackfill(listId)) break;
      try {
        const meta = await fetchYearForItem(item);
        const year = formatReleaseYearDisplay(meta?.year);
        if (year) {
          item.year = year;
          updated += 1;
          touchedIds.push(item.id);
          if (!item.anilistRating && meta?.anilistRating) {
            item.anilistRating = meta.anilistRating;
          }
          if (updated % 3 === 0) {
            state.data = itemsToNested(state.items);
            saveData();
            syncListCard(item.id, { invalidateTypeCache: false });
          }
        }
      } catch {
        failCount += 1;
      }

      done += 1;
      updateRatingsBackfillBanner({ running: true, done, total, phase: "year" });
      await new Promise((resolve) => setTimeout(resolve, 280));
    }

    yearsBackfillRunning = false;
    updateRatingsBackfillBanner({ running: false });
    if (isIdleBackfillDebugEnabled() && (updated || failCount)) {
      console.warn("[years] backfill summary", { updated, failCount, total });
    }

    if (updated > 0) {
      state.data = itemsToNested(state.items);
      saveData();
      for (const id of touchedIds) syncListCard(id, { invalidateTypeCache: false });
      if (isReleaseSortActive()) {
        // One idle reorder pass — never wipe posters mid-backfill.
        if (typeof requestIdleCallback === "function") {
          requestIdleCallback(() => reorderVisibleCardsByCurrentSort(), { timeout: 2000 });
        } else {
          window.setTimeout(() => reorderVisibleCardsByCurrentSort(), 0);
        }
      }
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

    let updated = 0;
    let failCount = 0;

    const applyAnilistBackfill = async (item) => {
      const meta = await fetchAnilistMetaForItem(item);
      let changed = false;
      if (meta?.anilistRating && !item.anilistRating) {
        item.anilistRating = meta.anilistRating;
        changed = true;
      }
      if (meta) {
        const before = itemHasTitleMeta(item);
        window.WatchlistMetadata.applyTitleMetaFromDetails(meta, item, item.contentType);
        preservePosterFieldsOnItem(item, { __source: "rating backfill" });
        if (!before && itemHasTitleMeta(item)) changed = true;
      }
      if (changed) {
        updated += 1;
        persistBackfillItem(item.id);
        return true;
      }
      return false;
    };

    for (const item of anilistQueue) {
      if (!ratingsBackfillRunning || shouldAbortIdleBackfill(listId)) break;
      const anilistPaused =
        window.WatchlistSeriesMetadata?.isAnilistRateLimited?.() ||
        window.WatchlistMetadata?.getAnilistQueueStatus?.()?.paused;
      if (anilistPaused) {
        if (isIdleBackfillDebugEnabled()) {
          console.warn("[ratings] AniList paused — skipping AniList rating backfill");
        }
        break;
      }
      try {
        await applyAnilistBackfill(item);
      } catch {
        failCount += 1;
      }
      done += 1;
      updateRatingsBackfillBanner({ running: true, done, total, phase: "anilist" });
      await new Promise((resolve) => setTimeout(resolve, 320));
    }

    if (imdbQueue.length) {
      updateRatingsBackfillBanner({ running: true, done, total, phase: "imdb" });
    }

    for (const item of imdbQueue) {
      if (!ratingsBackfillRunning || shouldAbortIdleBackfill(listId)) break;
      try {
        if (!window.WatchlistMetadata?.hasOmdbKey?.()) break;

        let imdbId = getImdbId(item);
        if (!imdbId && item.contentType === "anime") {
          const anilistId = getAnilistId(item);
          const linked = await window.WatchlistSeriesMetadata?.resolveLinkedImdbId?.(
            anilistId ? { anilistId: Number(anilistId) } : {},
            item,
            {
              title: item.title,
              altTitle: item.altTitle,
              year: item.year,
              skipAnilist: true,
            }
          );
          if (linked) {
            imdbId = linked;
            item.imdbId = linked;
            item.imdbLink = `https://www.imdb.com/title/${linked}/`;
          }
        }
        if (!imdbId) continue;

        const meta = await window.WatchlistMetadata.getMetadata(imdbId);
        let changed = false;
        if (meta?.rating && !item.imdbRating) {
          item.imdbRating = meta.rating;
          changed = true;
        }
        if (meta) {
          const before = itemHasTitleMeta(item);
          window.WatchlistMetadata.applyTitleMetaFromDetails(meta, item, item.contentType);
          preservePosterFieldsOnItem(item, { __source: "imdb rating backfill" });
          if (!before && itemHasTitleMeta(item)) changed = true;
        }
        if (changed) {
          updated += 1;
          persistBackfillItem(item.id);
        }
      } catch {
        failCount += 1;
      }

      done += 1;
      updateRatingsBackfillBanner({ running: true, done, total, phase: "imdb" });
      await new Promise((resolve) => setTimeout(resolve, 420));
    }

    ratingsBackfillRunning = false;
    updateRatingsBackfillBanner({ running: false });
    if (isIdleBackfillDebugEnabled() && (updated || failCount)) {
      console.warn("[ratings] backfill summary", { updated, failCount, total });
    }

    if (updated > 0) {
      state.data = itemsToNested(state.items);
      saveData();
      if (state.ratingFilterSource !== "all") {
        if (typeof requestIdleCallback === "function") {
          requestIdleCallback(() => reorderVisibleCardsByCurrentSort(), { timeout: 2000 });
        } else {
          window.setTimeout(() => reorderVisibleCardsByCurrentSort(), 0);
        }
      }
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
    let failCount = 0;

    for (const item of queue) {
      if (!titleMetaBackfillRunning || shouldAbortIdleBackfill(listId)) break;
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
          window.WatchlistMetadata.applyTitleMetaFromDetails(meta, item, item.contentType);
          preservePosterFieldsOnItem(item, { __source: "title meta backfill" });
          if (
            (!before && itemHasTitleMeta(item)) ||
            (!beforeRuntime && item.runtime)
          ) {
            updated += 1;
            persistBackfillItem(item.id);
          }
        }
      } catch {
        failCount += 1;
      }

      await new Promise((resolve) => setTimeout(resolve, 280));
    }

    titleMetaBackfillRunning = false;
    if (isIdleBackfillDebugEnabled() && (updated || failCount)) {
      console.warn("[title-meta] backfill summary", {
        updated,
        failCount,
        total: queue.length,
      });
    }

    if (updated > 0) {
      state.data = itemsToNested(state.items);
      saveData();
    }
  }

  function itemNeedsEpisodeTotalBackfill(item) {
    if (itemNeedsSeriesBadgeRefresh(item)) return true;
    if (item?.contentType !== "tvSeries" && item?.contentType !== "anime") {
      return false;
    }
    const episodes = parseInt(String(item?.episodeCount || "").trim(), 10);
    if (Number.isFinite(episodes) && episodes > 0) return false;
    return Boolean(
      getImdbId(item) ||
        (item?.link && window.WatchlistMetadata?.isSupportedLink?.(item.link))
    );
  }

  /** Stale counts for live-action TV only — anime uses AniList (1 season / N eps is normal). */
  function itemNeedsSeriesBadgeRefresh(item) {
    if (item?.contentType !== "tvSeries") {
      return false;
    }
    if (
      !item?.link ||
      !window.WatchlistMetadata?.isSupportedLink?.(item.link)
    ) {
      return false;
    }
    const seasons = parseInt(String(item?.seasonCount || "").trim(), 10);
    const episodes = parseInt(String(item?.episodeCount || "").trim(), 10);
    if (!Number.isFinite(seasons) && Number.isFinite(episodes) && episodes > 0) {
      return true;
    }
    return false;
  }

  function applyBadgePatches(item, patches) {
    if (!item || !patches) return false;
    const safe = stripProtectedEnrichmentFields(patches, item);
    let changed = false;

    // imdbId/imdbLink are enrichment-protected identity fields, but badge
    // enrichment intentionally corrects wrong AniList/suggest IMDb ids
    // (e.g. Arms Alchemy tt11916660 → Buso Renkin tt0877507).
    if (patches.imdbId) {
      const id = String(patches.imdbId).trim().toLowerCase();
      if (id.startsWith("tt") && (item.imdbId !== id || getImdbId(item) !== id)) {
        item.imdbId = id;
        item.imdbLink = `https://www.imdb.com/title/${id}/`;
        changed = true;
      }
    }

    for (const [key, value] of Object.entries(safe)) {
      if (value == null || value === "") continue;
      if (key === "episodeCount" || key === "seasonCount") {
        const n = parseInt(String(value).trim(), 10);
        if (!Number.isFinite(n) || n <= 0) continue;
        if (Number(item[key]) === n) continue;
        item[key] = n;
        changed = true;
        continue;
      }
      if (key === "sourceGenres") {
        if (!Array.isArray(value) || !value.length) continue;
        const prev = JSON.stringify(item.sourceGenres || []);
        const next = JSON.stringify(value);
        if (prev === next) continue;
        item.sourceGenres = value;
        changed = true;
        continue;
      }
      if (key === "imdbRating") {
        if (!value || item.imdbRating === value) continue;
        item.imdbRating = value;
        changed = true;
        continue;
      }
      if (key === "imdbId") {
        const id = String(value).toLowerCase();
        if (!id.startsWith("tt")) continue;
        if (item.imdbId === id && getImdbId(item) === id) continue;
        item.imdbId = id;
        item.imdbLink = `https://www.imdb.com/title/${id}/`;
        changed = true;
        continue;
      }
      if (item[key] !== value) {
        item[key] = value;
        changed = true;
      }
    }
    preservePosterFieldsOnItem(item, { __source: "badge enrichment" });
    return changed;
  }

  function itemNeedsAnimeProviderRefresh(item) {
    if (item?.contentType !== "anime") return false;
    const WM = window.WatchlistMetadata;
    return Boolean(
      WM?.extractAnilistId?.(item?.link) ||
        WM?.extractMalId?.(item?.link) ||
        getImdbId(item)
    );
  }

  /**
   * Badge enrichment (fetchTitleBadgeMeta) is the last step of the
   * post-add enrichment chain for every code path (see enrichImportedItem,
   * which always calls queueItemBadgeEnrichment on its way out). Clear the
   * "still finishing" card flag here, whatever the outcome, so a bulk-added
   * anime card never stays stuck showing a shimmer/skeleton forever.
   */
  function finishEnrichmentPending(itemId) {
    const live = state.items.find((i) => i.id === itemId);
    if (!live || !live.enrichmentPending) return false;
    live.enrichmentPending = false;
    persistEnrichmentSave(itemId);
    syncListCard(itemId);
    return true;
  }

  async function enrichItemBadges(itemId) {
    const listId = state.activeListId;
    if (!listId || !itemId) return;

    const item = state.items.find((i) => i.id === itemId);
    if (!item) return;
    if (item.contentType !== "tvSeries" && item.contentType !== "anime" && item.contentType !== "movies") {
      return;
    }
    let forceImdbHeal = false;
    if (
      item.contentType === "anime" &&
      item.imdbRating &&
      getAnilistId(item) &&
      getImdbId(item)
    ) {
      try {
        const meta = await window.WatchlistMetadata?.getMetadata?.(getImdbId(item));
        if (!meta) forceImdbHeal = true;
      } catch {
        forceImdbHeal = true;
      }
    }
    if (!itemNeedsBadgeEnrichment(item) && !forceImdbHeal) {
      if (item.contentType === "anime") cacheAnimeProviderSnapshot(item);
      finishEnrichmentPending(itemId);
      return;
    }

    try {
      const locale = window.WatchlistI18n?.getLang?.() || "en";
      const patches = await window.WatchlistSeriesMetadata?.fetchTitleBadgeMeta?.(
        item,
        locale
      );
      if (!patches || !canPersistActiveList(listId)) {
        finishEnrichmentPending(itemId);
        return;
      }

      const live = state.items.find((i) => i.id === itemId);
      if (!live) return;

      const changed = applyBadgePatches(live, patches);
      if (patches.imdbRating && !live.imdbRating) {
        live.imdbRating = patches.imdbRating;
      }
      if (patches.imdbId) {
        const id = String(patches.imdbId).trim().toLowerCase();
        if (id.startsWith("tt") && getImdbId(live) !== id) {
          live.imdbId = id;
          live.imdbLink = `https://www.imdb.com/title/${id}/`;
        }
      }
      preservePosterFieldsOnItem(live, { __source: "badge enrichment" });
      const pendingCleared = live.enrichmentPending ? ((live.enrichmentPending = false), true) : false;
      if (live.contentType === "anime") cacheAnimeProviderSnapshot(live);
      if (!changed && !patches.imdbRating && !pendingCleared) return;

      persistEnrichmentSave(itemId);
      syncListCard(itemId, { invalidateTypeCache: false });
      if (window.WatchlistTitleDetail?.activeItemId?.() === itemId) {
        window.WatchlistTitleDetail.refresh?.();
      }
    } catch (error) {
      if (isIdleBackfillDebugEnabled()) {
        console.warn("[badge-enrich] failed:", error);
      }
      finishEnrichmentPending(itemId);
    }
  }

  function queueItemBadgeEnrichment(itemId) {
    if (!itemId) return;
    void enrichItemBadges(itemId);
  }

  const bulkEnrichmentQueue = [];
  let bulkEnrichmentRunning = false;

  // Post-add enrichment (re-fetching full details, cast, and badge fields —
  // age rating/runtime/episode counts, each of which can be a TMDb/OMDb/AniList
  // call) is only "nice to have" polish for a title that's already on the
  // list. During a bulk import it was firing per-item almost immediately after
  // each auto-commit, competing with the actual match queue for the same
  // AniList capacity — a big contributor to the 429 storms/freezes. Enrichment
  // now waits for the bulk import queue to go idle before draining.
  function isBulkImportActivelyMatching() {
    const IJ = window.WatchlistImportJob;
    const listId = state.activeListId;
    if (!IJ || !listId) return false;
    if (IJ.isWorkerActive?.()) return true;
    const job = IJ.loadJob?.(listId);
    return Boolean(job && !job.paused && job.status === "processing");
  }

  function queueImportedItemEnrichment(itemId) {
    if (!itemId || bulkEnrichmentQueue.includes(itemId)) return;
    bulkEnrichmentQueue.push(itemId);
    // Don't start draining while matching — just park the ids. Drain kicks
    // in from drainBulkEnrichmentQueue's idle wait / next schedule.
    if (!isBulkImportActivelyMatching()) {
      void drainBulkEnrichmentQueue();
    }
  }

  /** Save whatever we've collected for this anime title into the shared
   * title_provider_cache (see metadata.js) so the next import of the same
   * title — this list or anyone else's — can skip (or shrink) the live
   * AniList call. Best-effort only; failures are swallowed by the callee. */
  function cacheAnimeProviderSnapshot(item) {
    const anilistId = getAnilistId(item);
    if (!anilistId || !item?.title) return;
    void window.WatchlistMetadata?.upsertTitleProviderCacheEntry?.("anilist", anilistId, {
      title: item.title,
      poster: item.poster || item.cardPoster || "",
      year: item.year || "",
      contentType: "anime",
      genres: item.sourceGenres || [],
      ageRating: item.ageRating || "",
      episodeCount: item.episodeCount || null,
      seasonCount: item.seasonCount || null,
      runtime: item.runtime || "",
      imdbRating: item.imdbRating || "",
    });
  }

  function applyCastFromEnrichment(item, castResult) {
    if (!item || !castResult) return false;
    const names = castResult.names || [];
    if (!names.length) {
      if (isCastEnrichDebugEnabled()) {
        console.warn("[cast-enrich:save]", {
          title: item.title,
          provider: castResult.provider || "—",
          providerId: castResult.providerId || "—",
          castSource: castResult.source || "—",
          namesSaved: [],
          reason: castResult.reason || "no_cast_available",
        });
      }
      return false;
    }
    if (item.leads?.length) return false;

    const beforePoster = itemPosterUrl(item);
    const beforeBroken = Boolean(item.posterBroken);
    item.leads = names;
    item.lead = names.join(", ");
    preservePosterFieldsOnItem(item, { __source: "cast enrichment" });
    if (isCastEnrichDebugEnabled()) {
      console.warn("[cast-enrich:save]", {
        title: item.title,
        provider: castResult.provider,
        providerId: castResult.providerId,
        castSource: castResult.source,
        namesSaved: names,
      });
    }
    if (isPosterOverwriteDebugEnabled() && isBulkPosterTraceTitle(item.title)) {
      const afterPoster = itemPosterUrl(item);
      if (beforePoster !== afterPoster || beforeBroken !== Boolean(item.posterBroken)) {
        console.warn("[poster-overwrite-trace]", {
          title: item.title,
          functionName: "applyCastFromEnrichment",
          itemId: item.id,
          posterBefore: beforePoster,
          posterAfter: afterPoster,
          posterBrokenBefore: beforeBroken,
          posterBrokenAfter: Boolean(item.posterBroken),
          updatePayloadKeys: ["leads", "lead"],
          payloadContainsPoster: false,
          payloadContainsPosterBroken: false,
          source: "cast enrichment",
        });
      }
    }
    return true;
  }

  async function enrichItemCast(item, details = null) {
    if (!item || item.leads?.length) return false;
    const WM = window.WatchlistMetadata;
    if (!WM?.enrichLeadCastForItem) return false;
    try {
      const castResult = await WM.enrichLeadCastForItem(item, details);
      return applyCastFromEnrichment(item, castResult);
    } catch (error) {
      if (isCastEnrichDebugEnabled()) {
        console.warn("[cast-enrich:save]", {
          title: item.title,
          provider: "—",
          providerId: "—",
          castSource: "—",
          namesSaved: [],
          reason: String(error?.message || error),
        });
      }
      return false;
    }
  }

  async function enrichImportedItem(itemId) {
    const revisionAtStart = getEnrichmentRevision(itemId);
    const item = state.items.find((entry) => entry.id === itemId);
    if (!item) return;

    const WM = window.WatchlistMetadata;
    if (!WM?.getDetailsForPick) {
      queueItemBadgeEnrichment(itemId);
      return;
    }

    let pick = null;
    const linkedAnilistId = getAnilistId(item);
    if (item.anilistId || linkedAnilistId) {
      pick = {
        source: "anilist",
        anilistId: item.anilistId || linkedAnilistId,
        title: item.title,
        year: item.year || "",
      };
    } else if (item.tmdbId) {
      pick = {
        source: "tmdb",
        tmdbId: item.tmdbId,
        tmdbType: item.contentType === "tvSeries" ? "tv" : "movie",
        imdbId: item.imdbId || null,
        title: item.title,
        year: item.year || "",
      };
    } else if (item.imdbId) {
      pick = {
        source: "imdb",
        imdbId: item.imdbId,
        title: item.title,
        year: item.year || "",
        type: item.contentType === "tvSeries" ? "series" : "movie",
      };
    }

    if (!pick) {
      queueItemBadgeEnrichment(itemId);
      return;
    }

    try {
      const details = await WM.getDetailsForPick(pick, {
        searchQuery: item.title,
        preferAnime: item.contentType === "anime",
      });
      const live = state.items.find((entry) => entry.id === itemId);
      if (!live) return;
      if (isEnrichmentStale(itemId, revisionAtStart)) {
        await enrichItemCast(live, null);
        queueItemBadgeEnrichment(itemId);
        return;
      }

      if (!details) {
        const castChanged = await enrichItemCast(live, null);
        if (castChanged) {
          persistEnrichmentSave(itemId);
          syncListCard(itemId);
        }
        queueItemBadgeEnrichment(itemId);
        return;
      }

      if (details.plot && !live.summary) live.summary = details.plot;
      await WM.mergeAndApplyItemGenres?.(live, details, {
        contentType: live.contentType,
        standardGenres: STANDARD_GENRES,
        debugLabel: live.title,
      });
      applyRatingsFromDetails(details, live);
      if (live.contentType === "anime" && !live.imdbRating) {
        const anilistId = getAnilistId(live) || details.anilistId;
        if (anilistId) {
          const linked = await window.WatchlistSeriesMetadata?.resolveLinkedImdbId?.(
            { anilistId: Number(anilistId) },
            live,
            {
              title: live.title,
              altTitle: live.altTitle,
              year: live.year,
              skipAnilist: window.WatchlistSeriesMetadata?.isAnilistRateLimited?.(),
            }
          );
          if (linked) {
            live.imdbId = linked;
            live.imdbLink = `https://www.imdb.com/title/${linked}/`;
            const hasOmdb = !!window.WatchlistMetadata?.hasOmdbKey?.();
            let omdbRating = null;
            if (hasOmdb) {
              const imdbMeta = await window.WatchlistMetadata.getMetadata(linked);
              omdbRating = imdbMeta?.rating || null;
              if (omdbRating) live.imdbRating = omdbRating;
            }
          }
        }
      }
      if (details.poster && shouldApplyEnrichmentPoster(live, details.poster)) {
        const rawPoster = String(details.poster).trim();
        if (live.contentType === "anime") {
          live.poster = rawPoster;
          live.cardPoster = rawPoster;
          live.posterBroken = false;
        } else {
          const poster =
            window.WatchlistMetadata?.upgradePosterForStorage?.(details.poster, details) ||
            details.poster;
          live.poster = poster;
          live.cardPoster = poster;
          live.posterBroken = false;
        }
      }
      preservePosterFieldsOnItem(live, {
        __source: "metadata backfill",
        poster: details.poster,
      });
      if (details.year && !live.year) live.year = details.year;
      WM.applyTitleMetaFromDetails?.(details, live, live.contentType);
      const castChanged = await enrichItemCast(live, details);
      if (isEnrichmentStale(itemId, revisionAtStart)) {
        queueItemBadgeEnrichment(itemId);
        return;
      }
      persistEnrichmentSave(itemId);
      syncListCard(itemId);
      if (castChanged) {
        WM.cacheResolvedPreview?.(pick, {
          ...details,
          poster: live.poster || details.poster || "",
          cardPoster: live.cardPoster || live.poster || "",
        });
      }
    } catch (error) {
      console.warn("[bulk-enrich] failed:", item.title, error);
    }

    queueItemBadgeEnrichment(itemId);
    if (!state.items.find((entry) => entry.id === itemId)?.leads?.length) {
      void enrichItemCast(state.items.find((entry) => entry.id === itemId), null).then(
        (changed) => {
          if (!changed) return;
          const live = state.items.find((entry) => entry.id === itemId);
          if (!live) return;
          preservePosterFieldsOnItem(live, { __source: "cast enrichment retry" });
          persistEnrichmentSave(itemId);
          syncListCard(itemId);
        }
      );
    }
  }

  async function drainBulkEnrichmentQueue() {
    if (bulkEnrichmentRunning) return;
    bulkEnrichmentRunning = true;
    while (bulkEnrichmentQueue.length) {
      if (isBulkImportActivelyMatching()) {
        await new Promise((resolve) => setTimeout(resolve, 3000));
        continue;
      }
      const itemId = bulkEnrichmentQueue.shift();
      await enrichImportedItem(itemId);
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    bulkEnrichmentRunning = false;
  }

  async function backfillEpisodeTotals() {
    if (episodeTotalsBackfillRunning) return;

    const queue = state.items.filter(itemNeedsEpisodeTotalBackfill);
    if (!queue.length) return;

    const listId = state.activeListId;
    if (!listId) return;

    episodeTotalsBackfillRunning = true;
    let updated = 0;
    let failCount = 0;
    const locale = window.WatchlistI18n?.getLang?.() || "en";

    for (const item of queue) {
      if (!episodeTotalsBackfillRunning || shouldAbortIdleBackfill(listId)) break;
      try {
        const patches = await window.WatchlistSeriesMetadata?.fetchTitleBadgeMeta?.(
          item,
          locale
        );
        if (patches && applyBadgePatches(item, patches)) {
          updated += 1;
          persistBackfillItem(item.id);
        }
      } catch {
        failCount += 1;
      }
      await new Promise((resolve) => setTimeout(resolve, 400));
    }

    episodeTotalsBackfillRunning = false;
    if (isIdleBackfillDebugEnabled() && (updated || failCount)) {
      console.warn("[episode-total] backfill summary", {
        updated,
        failCount,
        total: queue.length,
      });
    }

    if (updated > 0) {
      state.data = itemsToNested(state.items);
      saveData();
    }
  }

  /**
   * One idle worker for years / ratings / title-meta / episode-totals.
   * Sequential phases, single in-flight, aborts on list switch or hidden tab.
   */
  async function runMetadataBackfill() {
    if (metadataBackfillRunning) return;
    try {
      if (typeof document !== "undefined" && document.hidden) return;
    } catch {
      /* ignore */
    }
    metadataBackfillRunning = true;
    try {
      if (isReleaseSortActive()) {
        await backfillMissingYears();
        if (shouldAbortIdleBackfill(state.activeListId)) return;
        await backfillMissingRatings();
        if (shouldAbortIdleBackfill(state.activeListId)) return;
        await backfillTitleMeta();
        if (shouldAbortIdleBackfill(state.activeListId)) return;
        await backfillEpisodeTotals();
        return;
      }
      await backfillMissingRatings();
      if (shouldAbortIdleBackfill(state.activeListId)) return;
      await backfillMissingYears();
      if (shouldAbortIdleBackfill(state.activeListId)) return;
      await backfillTitleMeta();
      if (shouldAbortIdleBackfill(state.activeListId)) return;
      await backfillEpisodeTotals();
    } finally {
      metadataBackfillRunning = false;
    }
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
    clearTypeViewDomCache();
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

  function cardDisplayPoster(item) {
    const raw = item?.cardPoster || item?.poster || "";
    if (!raw) return "";
    if (item?.contentType === "anime" || String(raw).includes("anilist")) return raw;
    const WM = window.WatchlistMetadata;
    if (!WM?.upgradePosterForStorage) return raw;
    return WM.upgradePosterForStorage(raw, item);
  }

  function itemNeedsBadgeEnrichment(item) {
    if (!item) return false;
    if (item.contentType === "movies") {
      return !item.ageRating || !item.runtime;
    }
    if (item.contentType === "tvSeries") {
      const seasons = parseInt(String(item.seasonCount || "").trim(), 10);
      const episodes = parseInt(String(item.episodeCount || "").trim(), 10);
      return (
        !item.ageRating ||
        !item.runtime ||
        !Number.isFinite(seasons) ||
        seasons <= 0 ||
        !Number.isFinite(episodes) ||
        episodes <= 0
      );
    }
    if (item.contentType === "anime") {
      const episodes = parseInt(String(item.episodeCount || "").trim(), 10);
      if (!Number.isFinite(episodes) || episodes <= 0) return true;
      if (!item.ageRating) return true;
      if (!item.runtime) return true;
      if (!item.imdbRating && (getImdbId(item) || getAnilistId(item))) return true;
      return false;
    }
    return false;
  }

  function itemPosterNeedsHeal(item) {
    if (!item) return false;
    if (item.contentType === "anime") return false;
    if (item.posterBroken) return true;
    const poster = item.cardPoster || item.poster || "";
    return poster.includes("/extraLarge/");
  }

  function animePosterShouldUseAnilist(item) {
    if (item?.contentType !== "anime") return false;
    const anilistId = item.anilistId || getAnilistId(item);
    if (!anilistId) return false;
    const url = String(item.cardPoster || item.poster || "").trim();
    if (!url) return true;
    return !url.includes("anilist.co");
  }

  function itemAnimePosterNeedsRepair(item) {
    if (item?.contentType !== "anime") return false;
    if (item.posterBroken) return true;
    if (animePosterShouldUseAnilist(item)) return true;
    const SM = window.WatchlistSeriesMetadata;
    const url = item?.cardPoster || item?.poster || "";
    return !SM?.isUsableAnimePosterUrl?.(url);
  }

  function repairAnimePosterFromSeasons(item, seasons, options = {}) {
    const SM = window.WatchlistSeriesMetadata;
    const WM = window.WatchlistMetadata;
    if (!item || !SM?.pickAnimeMainPosterFallback) return false;
    if (!itemAnimePosterNeedsRepair(item) && !options.force) return false;

    const wasBroken = Boolean(item.posterBroken);
    const currentPoster = item.cardPoster || item.poster || "";
    const seasonPostersFound = (seasons || [])
      .filter((s) => s?.poster)
      .map((s) => ({ seasonNumber: s.seasonNumber, poster: s.poster }));

    const fallback = SM.pickAnimeMainPosterFallback(item, seasons, options);
    if (!fallback?.poster) {
      if (isPosterOverwriteDebugEnabled()) console.warn("[anime-poster-repair]", {
        title: item.title,
        currentPoster,
        posterBroken: wasBroken,
        seasonPostersFound,
        selectedFallbackPoster: null,
        savedTo: null,
        cardRefreshed: false,
        reason: "no_usable_fallback",
      });
      return false;
    }

    item.poster = fallback.poster;
    item.cardPoster = fallback.poster;
    item.posterBroken = false;

    const savedTo = ["watchlist"];
    if (item.anilistId && WM?.cacheResolvedPreview) {
      WM.cacheResolvedPreview(
        { source: "anilist", anilistId: item.anilistId },
        { poster: fallback.poster, anilistId: item.anilistId, source: "anilist" }
      );
      savedTo.push("provider_cache");
    }

    const persist = options.persist !== false;
    if (persist) saveData();
    const refreshCard = options.refreshCard !== false;
    if (refreshCard) syncListCard(item.id);

    if (isPosterOverwriteDebugEnabled()) console.warn("[anime-poster-repair]", {
      title: item.title,
      currentPoster,
      posterBroken: wasBroken,
      seasonPostersFound,
      selectedFallbackPoster: fallback.poster,
      fallbackSource: fallback.source,
      savedTo: savedTo.join("+"),
      cardRefreshed: refreshCard,
    });
    return true;
  }

  async function pickVerifiedAnimePoster(candidates) {
    const SM = window.WatchlistSeriesMetadata;
    const WM = window.WatchlistMetadata;
    for (const cand of candidates || []) {
      const url = WM?.upgradePosterForStorage?.(cand.url, {}) || cand.url;
      if (!url || !SM?.isUsableAnimePosterUrl?.(url)) continue;
      if (await testPosterUrlLoads(url)) {
        return { url, source: cand.source || "verified" };
      }
    }
    return null;
  }

  function testPosterUrlLoads(url, timeoutMs = 8000) {
    return new Promise((resolve) => {
      const trimmed = String(url || "").trim();
      if (!trimmed) {
        resolve(false);
        return;
      }
      const img = new Image();
      let settled = false;
      const finish = (ok) => {
        if (settled) return;
        settled = true;
        resolve(ok);
      };
      const timer = setTimeout(() => finish(false), timeoutMs);
      img.onload = () => {
        clearTimeout(timer);
        finish(true);
      };
      img.onerror = () => {
        clearTimeout(timer);
        finish(false);
      };
      img.src = trimmed;
    });
  }

  async function repairAnimePosterForItem(item, options = {}) {
    if (!options.force && !itemAnimePosterNeedsRepair(item)) return false;

    const SM = window.WatchlistSeriesMetadata;
    const WM = window.WatchlistMetadata;
    const locale = window.WatchlistI18n?.getLang?.() || "en";
    const currentPoster = item?.cardPoster || item?.poster || "";
    const wasBroken = Boolean(item.posterBroken);

    const resolved = await SM?.resolveWatchlistItemAnilistId?.(item, {
      persist: options.persist !== false,
      allowLive: options.allowLive !== false,
      allowOffline: true,
    });
    const anilistId = resolved?.anilistId;
    if (!anilistId) {
      if (isPosterOverwriteDebugEnabled()) console.warn("[anime-poster-repair]", {
        title: item?.title,
        resolvedAnilistId: null,
        rootAnilistId: null,
        currentPoster,
        posterBroken: wasBroken,
        seasonPostersFound: [],
        chosenFallbackPoster: null,
        saveResult: "skipped_no_anilist_id",
        cardRefreshed: false,
      });
      return false;
    }

    const group = await SM?.resolveAnimeSeriesGroup?.(item, {
      persist: false,
      allowLive: false,
      groupingOnly: true,
      includeChain: true,
    });
    const groupSeasons = (group?.members || [])
      .filter((member) => {
        const format = String(member.format || "").toUpperCase();
        return format === "TV" || format === "TV_SHORT" || format === "ONA";
      })
      .map((member) => ({
        seasonNumber: member.seasonNumber,
        poster: member.poster,
        name: member.title,
        episodeCount: member.episodes,
        isSpecials: false,
        isRelated: false,
      }));
    const seasonPostersFound = groupSeasons
      .filter((season) => season?.poster)
      .map((season) => ({ seasonNumber: season.seasonNumber, poster: season.poster }));

    async function saveVerifiedPoster(poster, sourceLabel, seasonList = seasonPostersFound) {
      const verified = await pickVerifiedAnimePoster([
        { url: poster, source: sourceLabel },
        ...seasonList.map((s) => ({ url: s.poster, source: `season_${s.seasonNumber}` })),
        ...(group?.members || []).map((m) => ({
          url: m.poster,
          source: `franchise_member_${m.anilistId}`,
        })),
      ]);
      if (!verified?.url) {
        animePosterRepairFailed.add(item.id);
        if (isPosterOverwriteDebugEnabled()) console.warn("[anime-poster-repair]", {
          title: item.title,
          resolvedAnilistId: anilistId,
          rootAnilistId: group?.rootAnilistId ?? anilistId,
          currentPoster,
          imageError: true,
          posterBroken: wasBroken,
          seasonPostersFound: seasonList,
          chosenPosterUrl: null,
          saveResult: "no_verified_poster",
          cardRefreshed: false,
        });
        return false;
      }
      item.poster = verified.url;
      item.cardPoster = verified.url;
      item.posterBroken = false;
      SM?.persistResolvedAnilistIdOnItem?.(item, anilistId, resolved?.source || "repair");
      if (options.persist !== false) saveData();
      if (options.refreshCard !== false) syncListCard(item.id);
      if (WM?.cacheResolvedPreview) {
        WM.cacheResolvedPreview(
          { source: "anilist", anilistId: Number(anilistId) },
          { poster: verified.url, anilistId: Number(anilistId), source: "anilist" }
        );
      }
      if (isPosterOverwriteDebugEnabled()) console.warn("[anime-poster-repair]", {
        title: item.title,
        resolvedAnilistId: anilistId,
        rootAnilistId: group?.rootAnilistId ?? anilistId,
        currentPoster,
        imageError: wasBroken,
        posterBroken: wasBroken,
        seasonPostersFound: seasonList,
        chosenPosterUrl: verified.url,
        fallbackSource: verified.source,
        saveResult: "saved",
        cardRefreshed: options.refreshCard !== false,
      });
      return true;
    }

    async function applyDirectAnilistPoster(sourceLabel) {
      const details = await WM?.fetchAnilistById?.(Number(anilistId));
      const poster = WM?.upgradePosterForStorage?.(details?.poster, details) || details?.poster;
      if (!poster || !SM?.isUsableAnimePosterUrl?.(poster)) return false;
      return saveVerifiedPoster(poster, sourceLabel);
    }

    if (groupSeasons.length) {
      const fallback = SM.pickAnimeMainPosterFallback(item, groupSeasons, {
        seriesPoster: groupSeasons[0]?.poster || "",
        force: true,
      });
      if (fallback?.poster) {
        const saved = await saveVerifiedPoster(fallback.poster, fallback.source || "grouped_season_chain");
        if (saved) return true;
      }
    }

    try {
      const result = await SM.fetchSeriesMetadata(
        { anilistId: Number(anilistId), source: "anilist" },
        locale,
        item.poster || ""
      );
      if (result?.seasons?.length) {
        const repaired = repairAnimePosterFromSeasons(item, result.seasons, {
          seriesPoster: result.series?.poster,
          force: options.force,
          persist: options.persist,
          refreshCard: options.refreshCard,
        });
        if (repaired) {
          SM?.persistResolvedAnilistIdOnItem?.(item, anilistId, resolved?.source || "repair");
          if (isPosterOverwriteDebugEnabled()) console.warn("[anime-poster-repair]", {
            title: item.title,
            resolvedAnilistId: anilistId,
            rootAnilistId: group?.rootAnilistId ?? anilistId,
            currentPoster,
            posterBroken: wasBroken,
            seasonPostersFound: (result.seasons || [])
              .filter((s) => s?.poster)
              .map((s) => ({ seasonNumber: s.seasonNumber, poster: s.poster })),
            chosenFallbackPoster: item.cardPoster || item.poster,
            fallbackSource: "fetch_series_metadata",
            saveResult: "saved",
            cardRefreshed: options.refreshCard !== false,
          });
          return true;
        }
      }
      return applyDirectAnilistPoster("direct_anilist");
    } catch (error) {
      if (isPosterOverwriteDebugEnabled()) console.warn("[anime-poster-repair] fetch failed:", item.title, error);
      try {
        return await applyDirectAnilistPoster("direct_anilist_fallback");
      } catch (fallbackError) {
        if (isPosterOverwriteDebugEnabled()) console.warn("[anime-poster-repair]", {
          title: item.title,
          resolvedAnilistId: anilistId,
          rootAnilistId: group?.rootAnilistId ?? anilistId,
          currentPoster,
          posterBroken: wasBroken,
          seasonPostersFound,
          chosenFallbackPoster: null,
          saveResult: `failed:${String(fallbackError?.message || fallbackError)}`,
          cardRefreshed: false,
        });
        return false;
      }
    }
  }

  const animePosterRepairQueued = new Set();
  /** At most one auto-repair attempt per item per session (avoids CDN error storms). */
  const animePosterRepairAttempted = new Set();

  function queueAnimePosterRepair(itemId, options = {}) {
    if (!itemId || animePosterRepairQueued.has(itemId)) return;
    if (!options.force && animePosterRepairAttempted.has(itemId)) return;
    const item = state.items.find((entry) => entry.id === itemId);
    if (!options.force && !itemAnimePosterNeedsRepair(item)) return;
    animePosterRepairAttempted.add(itemId);
    animePosterRepairQueued.add(itemId);
    void repairAnimePosterForItem(item, options).finally(() => {
      animePosterRepairQueued.delete(itemId);
    });
  }

  function queueAnimePosterRepairsForList() {
    for (const item of state.items) {
      if (item.contentType === "anime" && itemAnimePosterNeedsRepair(item)) {
        queueAnimePosterRepair(item.id);
      }
    }
  }

  const ANIME_GROUP_REPAIR_VERSION = 8;
  const ANIME_GROUP_REPAIR_MAX_MERGES = 24;
  const ANIME_GROUP_REPAIR_AUTO_RUN = false;
  const ANIME_MAINTENANCE_DEFER_MS = 30_000;

  function scheduleDeferredAnimeMaintenance() {
    if (!ANIME_GROUP_REPAIR_AUTO_RUN) return;
    window.setTimeout(() => {
      void repairAnimeGroupedDuplicates(
        state.activeListId || window.WatchlistAuth?.getProfile()
      );
    }, ANIME_MAINTENANCE_DEFER_MS);
  }

  async function restoreWatchlistFromLocalCache() {
    const listId = state.activeListId || window.WatchlistAuth?.getProfile();
    if (!listId) return { ok: false, reason: "no-list" };
    const restored = await loadWatchlistCacheFirst(listId);
    if (!restored) return { ok: false, reason: "no-cache" };
    saveData();
    saveWatched();
    updateGenreOptions();
    updateStats();
    render();
    if (window.WatchlistSync?.isConfigured()) {
      const result = await window.WatchlistSync.pushSnapshot(
        listId,
        state.data,
        state.watched,
        listSyncMeta(listId),
        buildCloudPushOptions(listId)
      );
      if (result?.ok) {
        recordCloudPushSuccess(listId);
        state.syncStatus = "saved";
        updateStats();
      }
    }
    return { ok: true, count: state.items.length };
  }

  async function probeWatchlistCacheRecovery(listId = state.activeListId) {
    if (!listId || !window.WatchlistIdb || !window.WatchlistDialog?.confirm) {
      return { offered: false };
    }
    try {
      const cached = await window.WatchlistIdb.getWatchlistCache(listId);
      const cachedCount =
        cached?.itemCount ?? window.WatchlistIdb.countNestedItems?.(cached?.data) ?? 0;
      const current = state.items.length;
      if (!cachedCount || cachedCount < current + 3) {
        return { offered: false, cachedCount, current };
      }
      const gap = cachedCount - current;
      const confirmed = await window.WatchlistDialog.confirm(
        t("sync.cacheRecoveryPrompt", { cached: cachedCount, current, gap }),
        { title: t("sync.cacheRecoveryTitle") }
      );
      if (!confirmed) {
        return { offered: true, declined: true, cachedCount, current };
      }
      const result = await restoreWatchlistFromLocalCache();
      return {
        offered: true,
        restored: result.ok,
        count: result.count,
        cachedCount,
        current,
      };
    } catch (err) {
      console.warn("[sync] cache recovery probe failed:", err);
      return { offered: false, error: err };
    }
  }

  async function diagnoseWatchlistIntegrity() {
    const listId = state.activeListId || window.WatchlistAuth?.getProfile();
    let lsCount = state.items.length;
    try {
      lsCount = flattenWatchlist(loadWatchlist()).length;
    } catch {
      /* use in-memory count */
    }
    const meta = readSyncMeta(listId);
    const cached = await window.WatchlistIdb?.getWatchlistCache?.(listId);
    let remoteTitleCount = null;
    let remoteUpdated = null;
    if (window.WatchlistSync?.isConfigured?.() && listId) {
      const stats = await window.WatchlistSync.fetchListStats(listId);
      remoteTitleCount = stats?.title_count ?? null;
      remoteUpdated = stats?.updated_at ?? null;
    }
    const report = {
      listId,
      inMemory: state.items.length,
      localStorage: lsCount,
      idbCacheCount: cached?.itemCount ?? null,
      idbSavedAt: cached?.savedAt ? new Date(cached.savedAt).toISOString() : null,
      syncMeta: meta,
      remoteTitleCount,
      remoteUpdated,
    };
    console.info("[watchlist-diagnose]", report);
    return report;
  }

  function animeGroupRepairStorageKey(listId) {
    return `watchlist-anime-group-repair:${listId}`;
  }

  function loadAnimeGroupRepairState(listId) {
    const raw = localStorage.getItem(animeGroupRepairStorageKey(listId));
    if (!raw) return null;
    if (/^\d+$/.test(raw)) {
      return { version: Number(raw), completed: true };
    }
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  function saveAnimeGroupRepairState(listId, report) {
    localStorage.setItem(animeGroupRepairStorageKey(listId), JSON.stringify(report));
  }

  function watchlistItemHasUserData(item) {
    if (!item) return false;
    const entry = state.watched[item.id];
    if (!entry) return false;
    if (entry.rating != null && entry.rating !== "") return true;
    if (entry.note && String(entry.note).trim()) return true;
    if (entry.watched || entry.inProgress) return true;
    if (Array.isArray(entry.progress?.episodes) && entry.progress.episodes.length) {
      return true;
    }
    return false;
  }

  function migrateChildWatchDataToParent(child, parent) {
    const childEntry = state.watched[child.id];
    if (!childEntry) return { ok: true, migrated: false };

    if (Array.isArray(childEntry.progress?.episodes) && childEntry.progress.episodes.length) {
      return { ok: false, migrated: false, reason: "episode_progress" };
    }

    let parentEntry = state.watched[parent.id];
    if (!parentEntry || typeof parentEntry !== "object") {
      parentEntry = {};
    } else {
      parentEntry = { ...parentEntry };
    }

    let migrated = false;
    if (childEntry.rating != null && childEntry.rating !== "" && parentEntry.rating == null) {
      parentEntry.rating = childEntry.rating;
      migrated = true;
    }
    if (childEntry.note?.trim() && !String(parentEntry.note || "").trim()) {
      parentEntry.note = childEntry.note;
      migrated = true;
    }

    if (migrated) {
      state.watched[parent.id] = parentEntry;
      saveWatched();
    }
    delete state.watched[child.id];
    saveWatched();
    return { ok: true, migrated };
  }

  function countSplitDebugFranchiseFamiliesOnList() {
    const debugItems = state.items.filter(itemMatchesAnimeGroupDebug);
    const families = [
      (title) => /naruto|shippuden|boruto/i.test(title),
      (title) => /fairy tail|100 years quest/i.test(title),
    ];
    let splitFamilies = 0;
    for (const matchFamily of families) {
      const cards = debugItems.filter((item) => matchFamily(String(item.title || "")));
      if (cards.length > 1) splitFamilies += 1;
    }
    return splitFamilies;
  }

  function buildAnimeGroupingRepairDiagnostics(animeItems, idToRoot, rootMapResult) {
    const debugTitles = ANIME_GROUP_DEBUG_TITLES;
    const rows = [];
    for (const item of animeItems) {
      const hay = String(item.title || "").toLowerCase();
      if (!debugTitles.some((needle) => hay.includes(needle))) continue;
      rows.push({
        title: item.title,
        watchlistItemId: item.id,
        anilistId: item.anilistId,
        rootAnilistId: idToRoot?.get?.(item.anilistId) ?? null,
        cachedChain: window.WatchlistSeriesMetadata?.readCachedChainIdsFromSeriesMetadata?.(
          item.anilistId
        ),
      });
    }
    return {
      animeItemCount: animeItems.length,
      rootMapSize: idToRoot?.size ?? 0,
      unresolvedIds: rootMapResult?.unresolvedIds || [],
      splitDebugFamilies: countSplitDebugFranchiseFamiliesOnList(),
      debugRows: rows,
    };
  }

  function countVisibleAnimeFranchiseDuplicateCards(animeItems, idToRoot) {
    const byRoot = new Map();
    for (const item of animeItems) {
      const rootId = idToRoot?.get?.(item.anilistId);
      if (!rootId) continue;
      const key = String(rootId);
      if (!byRoot.has(key)) byRoot.set(key, []);
      byRoot.get(key).push(item);
    }
    let duplicateCards = 0;
    for (const members of byRoot.values()) {
      if (members.length > 1) duplicateCards += members.length - 1;
    }
    return duplicateCards;
  }

  function buildAnimeGroupFromRootMap(anilistId, rootAnilistId, chainIds = []) {
    const id = Number(anilistId);
    const rootId = Number(rootAnilistId);
    const isRoot = id === rootId;
    const childIndex = chainIds.indexOf(id);
    let seasonNumber = null;
    if (childIndex > 0) {
      seasonNumber = childIndex + 1;
    } else if (childIndex === 0) {
      seasonNumber = 1;
    } else if (!isRoot) {
      seasonNumber = chainIds.length + 1;
    }
    const grouping = window.WatchlistSeriesMetadata?.computeAnimeGroupingDecision?.({
      ok: true,
      isRoot,
      isFranchiseChild: !isRoot,
    }) || {
      shouldMerge: !isRoot,
      groupRole: isRoot ? "root" : "child",
      groupingDecision: isRoot ? "keep_as_parent" : "merge_into_root",
      standaloneReason: isRoot ? "franchise_root_card" : "",
    };
    return {
      ok: true,
      anilistId: id,
      rootAnilistId: rootId,
      isRoot,
      isFranchiseChild: !isRoot,
      seasonNumber,
      chainIds,
      relationPath: chainIds,
      relationType: "sequel_chain",
      shouldMerge: grouping.shouldMerge,
      groupRole: grouping.groupRole,
      groupingDecision: grouping.groupingDecision,
      standaloneReason: grouping.standaloneReason,
    };
  }

  async function repairAnimeGroupedDuplicates(listId, options = {}) {
    const SM = window.WatchlistSeriesMetadata;
    const force = Boolean(options.force);
    const empty = {
      inspected: 0,
      merged: 0,
      skipped: 0,
      needsReview: 0,
      failed: 0,
      candidateChildren: 0,
      completed: false,
      pairs: [],
    };
    if (!listId || !SM?.buildAnimeFranchiseRootMap) return empty;
    if (!force && !ANIME_GROUP_REPAIR_AUTO_RUN) {
      return { ...empty, disabled: true };
    }

    const prior = loadAnimeGroupRepairState(listId);
    if (
      !force &&
      prior?.version === ANIME_GROUP_REPAIR_VERSION &&
      prior?.completed === true
    ) {
      return { ...empty, skippedRun: true, prior };
    }

    if (options.debug) {
      await debugAnimeGroupState();
    }

    if (SM.isAnilistRateLimited?.()) {
      const rateLimited = {
        ...empty,
        rateLimited: true,
        completed: false,
        resumeAt: SM.getAnilistRateLimitResumeAt?.() || null,
      };
      if (!force) {
        saveAnimeGroupRepairState(listId, {
          version: ANIME_GROUP_REPAIR_VERSION,
          completed: false,
          at: Date.now(),
          ...rateLimited,
        });
      }
      console.warn("[anime-group-repair] paused — AniList rate limited", rateLimited);
      return rateLimited;
    }

    const result = {
      inspected: 0,
      merged: 0,
      skipped: 0,
      needsReview: 0,
      failed: 0,
      candidateChildren: 0,
      completed: false,
      pairs: [],
      franchiseClusters: [],
    };

    const resolveOpts = {
      persist: false,
      allowLive: false,
      allowOffline: true,
    };
    const animeItems = [];
    for (const item of state.items) {
      if (item.contentType !== "anime") continue;
      const syncId = SM?.resolveWatchlistItemAnilistIdSync?.(item);
      const resolved = syncId
        ? { anilistId: syncId, source: "stored" }
        : await SM?.resolveWatchlistItemAnilistId?.(item, resolveOpts);
      if (resolved?.anilistId) {
        animeItems.push({ ...item, anilistId: Number(resolved.anilistId) });
      } else if (itemMatchesAnimeGroupDebug(item)) {
        result.failed += 1;
        console.warn("[anime-group-repair]", {
          action: "failed",
          childTitle: item.title,
          childWatchlistItemId: item.id,
          reason: "anilist_id_unresolved",
        });
      }
    }
    if (resolveOpts.persist) saveData();

    if (animeItems.length < 2) {
      const splitFamilies = countSplitDebugFranchiseFamiliesOnList();
      result.completed = splitFamilies === 0;
      result.diagnostics = buildAnimeGroupingRepairDiagnostics(animeItems, new Map(), null);
      if (!force) {
        saveAnimeGroupRepairState(listId, {
          version: ANIME_GROUP_REPAIR_VERSION,
          completed: result.completed,
          at: Date.now(),
          ...result,
        });
      }
      return result;
    }

    const rootMapResult = await SM.buildAnimeFranchiseRootMap(
      animeItems.map((entry) => entry.anilistId),
      { throttle: true }
    );
    if (rootMapResult.rateLimited) {
      result.rateLimited = true;
      result.completed = false;
      result.unresolvedIds = rootMapResult.unresolvedIds || [];
      if (!force) {
        saveAnimeGroupRepairState(listId, {
          version: ANIME_GROUP_REPAIR_VERSION,
          completed: false,
          at: Date.now(),
          ...result,
        });
      }
      console.warn("[anime-group-repair] paused mid-run — AniList rate limited", result);
      return result;
    }

    const idToRoot = rootMapResult.idToRoot;
    result.diagnostics = buildAnimeGroupingRepairDiagnostics(animeItems, idToRoot, rootMapResult);
    if (result.diagnostics.splitDebugFamilies > 0 && result.diagnostics.debugRows.length) {
      console.warn("[anime-group-repair] root map preview", result.diagnostics);
    }

    const franchiseGroups = new Map();
    for (const item of animeItems) {
      const rootAnilistId = idToRoot.get(item.anilistId);
      if (!rootAnilistId) {
        if (itemMatchesAnimeGroupDebug(item)) {
          console.warn("[anime-group-repair]", {
            action: "failed",
            childTitle: item.title,
            childAnilistId: item.anilistId,
            reason: "franchise_root_unresolved",
          });
          result.failed += 1;
        }
        continue;
      }
      const chainIds = SM.readCachedChainIdsFromSeriesMetadata?.(rootAnilistId) || [];
      const group = buildAnimeGroupFromRootMap(item.anilistId, rootAnilistId, chainIds);
      const key = String(rootAnilistId);
      if (!franchiseGroups.has(key)) {
        const cachedRoot = SM.readFranchiseRootCacheEntry?.(rootAnilistId);
        franchiseGroups.set(key, {
          rootAnilistId,
          rootTitle: cachedRoot?.rootTitle || "",
          members: [],
        });
      }
      franchiseGroups.get(key).members.push({
        item,
        anilistId: item.anilistId,
        group,
      });
    }

    const removedIds = [];

    for (const franchiseGroup of franchiseGroups.values()) {
      if (franchiseGroup.members.length < 2) continue;

      result.franchiseClusters.push({
        rootAnilistId: franchiseGroup.rootAnilistId,
        rootTitle: franchiseGroup.rootTitle,
        memberCount: franchiseGroup.members.length,
        titles: franchiseGroup.members.map((m) => m.item.title),
        watchlistItemIds: franchiseGroup.members.map((m) => m.item.id),
      });

      let primary =
        franchiseGroup.members.find(
          (member) => member.anilistId === franchiseGroup.rootAnilistId
        ) || null;
      if (!primary) {
        franchiseGroup.members.sort(
          (a, b) => (a.item.year ?? 9999) - (b.item.year ?? 9999)
        );
        primary = franchiseGroup.members[0];
      }

      for (const member of franchiseGroup.members) {
        const child = member.item;
        if (child.id === primary.item.id) continue;
        if (removedIds.includes(child.id)) continue;

        result.inspected += 1;
        result.candidateChildren += 1;

        const parent = primary.item;
        const logBase = {
          parentTitle: parent.title,
          parentWatchlistItemId: parent.id,
          parentAnilistId: franchiseGroup.rootAnilistId,
          childTitle: child.title,
          childWatchlistItemId: child.id,
          childAnilistId: member.anilistId,
          relationType: member.group?.relationType || "sequel_chain",
          relationPath: member.group?.relationPath || [],
        };

        const hadUserData = watchlistItemHasUserData(child);
        if (hadUserData) {
          const migration = migrateChildWatchDataToParent(child, parent);
          if (!migration.ok) {
            child.groupedDuplicateReview = true;
            result.needsReview += 1;
            const pair = {
              ...logBase,
              action: "needs_review",
              reason: migration.reason || "user_data",
            };
            result.pairs.push(pair);
            console.warn("[anime-group-repair]", pair);
            continue;
          }
        }

        try {
          deleteItem(child.id);
          removedIds.push(child.id);
          removeCardFromDom(child.id);
          result.merged += 1;
          const pair = {
            ...logBase,
            action: "merged",
            reason: hadUserData ? "migrated_user_data" : "no_user_data",
          };
          result.pairs.push(pair);
          console.warn("[anime-group-repair]", pair);
          queueAnimePosterRepair(parent.id, { force: true });
        } catch (error) {
          result.failed += 1;
          const pair = {
            ...logBase,
            action: "failed",
            reason: String(error?.message || error),
          };
          result.pairs.push(pair);
          console.warn("[anime-group-repair]", pair);
        }

        if (result.merged >= ANIME_GROUP_REPAIR_MAX_MERGES) {
          console.warn("[anime-group-repair] stopped at safety cap", {
            max: ANIME_GROUP_REPAIR_MAX_MERGES,
            merged: result.merged,
          });
          break;
        }
      }
      if (result.merged >= ANIME_GROUP_REPAIR_MAX_MERGES) break;
    }

    if (result.merged > 0) {
      state.data = itemsToNested(state.items);
      saveData();
      updateGenreOptions();
      updateStats();
      render();
    }

    const pendingFranchiseCards = result.franchiseClusters.reduce((sum, cluster) => {
      const mergedInCluster = result.pairs.filter(
        (pair) =>
          pair.parentAnilistId === cluster.rootAnilistId && pair.action === "merged"
      ).length;
      const needsReviewInCluster = result.pairs.filter(
        (pair) =>
          pair.parentAnilistId === cluster.rootAnilistId && pair.action === "needs_review"
      ).length;
      const handled = mergedInCluster + needsReviewInCluster + result.failed;
      const expected = Math.max(0, cluster.memberCount - 1);
      return sum + Math.max(0, expected - handled);
    }, 0);

    const visibleDuplicateCards = countVisibleAnimeFranchiseDuplicateCards(
      animeItems.filter((entry) => !removedIds.includes(entry.id)),
      idToRoot
    );
    const splitDebugFamilies = countSplitDebugFranchiseFamiliesOnList();

    const allCandidatesHandled =
      result.candidateChildren === 0 ||
      result.merged + result.needsReview + result.failed >= result.candidateChildren;
    const unresolvedCandidates =
      result.candidateChildren > 0 && result.merged === 0 && result.needsReview === 0 && result.failed === 0;
    const shouldComplete =
      allCandidatesHandled &&
      !unresolvedCandidates &&
      pendingFranchiseCards === 0 &&
      visibleDuplicateCards === 0 &&
      splitDebugFamilies === 0 &&
      !result.rateLimited &&
      !(rootMapResult.unresolvedIds?.length > 0 && splitDebugFamilies > 0);

    result.completed = shouldComplete;
    if (result.completed && result.merged === 0 && splitDebugFamilies > 0) {
      result.completed = false;
    }

    if (!force) {
      saveAnimeGroupRepairState(listId, {
        version: ANIME_GROUP_REPAIR_VERSION,
        completed: result.completed,
        at: Date.now(),
        ...result,
      });
    }

    if (result.candidateChildren > 0 && result.merged === 0) {
      console.warn("[anime-group-repair] candidates found but nothing merged", result);
    }
    if (visibleDuplicateCards > 0 && result.merged === 0) {
      console.warn("[anime-group-repair] franchise duplicate cards remain on list", {
        visibleDuplicateCards,
        unresolvedIds: rootMapResult.unresolvedIds || [],
        franchiseClusters: result.franchiseClusters,
        diagnostics: result.diagnostics,
      });
    }
    if (splitDebugFamilies > 0 && result.merged === 0) {
      console.warn("[anime-group-repair] known franchise families still split on list", {
        splitDebugFamilies,
        diagnostics: result.diagnostics,
      });
    }

    return result;
  }

  async function runAnimeGroupingRepairNow(options = {}) {
    const listId = state.activeListId || window.WatchlistAuth?.getProfile();
    return repairAnimeGroupedDuplicates(listId, { ...options, force: true });
  }

  function healItemPosterUrl(item, { persist = false } = {}) {
    if (!item) return false;
    if (item.contentType === "anime") return false;
    const WM = window.WatchlistMetadata;
    let changed = false;

    for (const field of ["poster", "cardPoster"]) {
      const raw = item[field];
      if (!raw) continue;
      const healed = WM?.upgradePosterForStorage?.(raw, item) || raw;
      if (healed && healed !== raw) {
        const prev = raw;
        item[field] = healed;
        if (field === "poster" && item.cardPoster === prev) item.cardPoster = healed;
        changed = true;
      }
    }

    if (item.posterBroken && (item.poster || item.cardPoster)) {
      const display = item.cardPoster || item.poster || "";
      if (display && !display.includes("/extraLarge/")) {
        item.posterBroken = false;
        changed = true;
      }
    }

    if (changed && persist) persistWatchlistLocalOnly();
    return changed;
  }

  function healAllPosterUrls({ persist = false } = {}) {
    let any = false;
    for (const item of state.items) {
      if (!itemPosterNeedsHeal(item)) continue;
      if (healItemPosterUrl(item)) any = true;
    }
    if (any && persist) persistWatchlistLocalOnly();
    return any;
  }

  function upgradeItemPosterInPlace(item, { persist = true } = {}) {
    if (!item?.poster || item.contentType === "anime") return false;
    const WM = window.WatchlistMetadata;
    if (!WM?.isLowResPosterUrl?.(item.poster)) return false;
    const upgraded = WM.upgradePosterForStorage(item.poster, item);
    if (!upgraded || upgraded === item.poster) return false;
    const prev = item.poster;
    item.poster = upgraded;
    if (item.cardPoster && item.cardPoster === prev) item.cardPoster = upgraded;
    if (persist) persistWatchlistLocalOnly();
    return true;
  }

  let posterUpgradeObserver = null;
  /** Session memory of poster URLs that finished loading — reuse eager on re-render. */
  const loadedPosterUrls = new Set();
  /** Cached main-list HTML per type tab so switching tabs does not re-download posters. */
  const typeViewDomCache = new Map();
  /** First-paint budget: eager-load only the first few posters to avoid flooding mobile. */
  let posterEagerBudget = 0;

  function normalizePosterUrl(url) {
    return String(url || "").trim();
  }

  function rememberLoadedPoster(url) {
    const normalized = normalizePosterUrl(url);
    if (normalized) loadedPosterUrls.add(normalized);
  }

  function posterAlreadyLoaded(url) {
    return loadedPosterUrls.has(normalizePosterUrl(url));
  }

  function posterLoadingAttr(url) {
    // iOS Safari often re-fetches lazy <img>s after DOM rebuild; eager helps reuse cache.
    if (posterAlreadyLoaded(url)) return ' loading="eager"';
    if (posterEagerBudget > 0) {
      posterEagerBudget -= 1;
      return ' loading="eager" fetchpriority="high"';
    }
    return ' loading="lazy"';
  }

  function clearTypeViewDomCache() {
    typeViewDomCache.clear();
  }

  function filtersAllowTypeViewCache() {
    return (
      !String(state.search || "").trim() &&
      state.watchedFilter === "all" &&
      state.ratingFilterSource === "all" &&
      (!state.selectedGenres || state.selectedGenres.length === 0)
    );
  }

  function ensurePosterUpgradeObserver() {
    if (posterUpgradeObserver || typeof IntersectionObserver === "undefined") return;
    posterUpgradeObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const card = entry.target;
          const item = state.items.find((row) => row.id === card.dataset.id);
          if (!item) continue;
          if (upgradeItemPosterInPlace(item)) {
            setCardPoster(card, cardDisplayPoster(item));
          }
          posterUpgradeObserver.unobserve(card);
        }
      },
      { rootMargin: "120px 0px", threshold: 0.05 }
    );
  }

  function observeCardPosterUpgrade(card) {
    if (!card) return;
    ensurePosterUpgradeObserver();
    if (!posterUpgradeObserver) return;
    const item = state.items.find((row) => row.id === card.dataset.id);
    if (!item?.poster || !window.WatchlistMetadata?.isLowResPosterUrl?.(item.poster)) return;
    posterUpgradeObserver.observe(card);
  }

  function cardDisplayTitle(item) {
    if (!item) return "";
    const showTitle = String(item.title || "").trim();
    if (item.cardSeasonName) {
      const seasonName = String(item.cardSeasonName).trim();
      if (!showTitle) return seasonName;
      if (seasonName.toLowerCase().startsWith(showTitle.toLowerCase())) return seasonName;
      return `${showTitle}: ${seasonName}`;
    }
    const seasonNum = Number(item.lastSelectedSeason);
    if (
      (item.contentType === "tvSeries" || item.contentType === "anime") &&
      Number.isFinite(seasonNum) &&
      seasonNum > 0
    ) {
      const seasonLabel = t("seasons.seasonNum", { n: seasonNum });
      if (showTitle) return `${showTitle}: ${seasonLabel}`;
      return seasonLabel;
    }
    return showTitle;
  }

  function setCardPoster(card, posterUrl) {
    const slot = card.querySelector(
      "[data-poster-slot], .card__poster--placeholder, .card__poster--broken, .card__poster"
    );
    if (!slot || !posterUrl) return;

    if (slot.tagName === "IMG") {
      const current = normalizePosterUrl(slot.getAttribute("src"));
      if (current === normalizePosterUrl(posterUrl)) {
        rememberLoadedPoster(slot.currentSrc || slot.src || posterUrl);
        return;
      }
    }

    const img = document.createElement("img");
    img.className = "card__poster";
    img.loading = posterAlreadyLoaded(posterUrl) ? "eager" : "lazy";
    img.alt = "";
    img.src = posterUrl;
    img.addEventListener(
      "load",
      () => rememberLoadedPoster(img.currentSrc || img.src || posterUrl),
      { once: true }
    );
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

  function posterPlaceholderMarkup(broken = false, pending = false) {
    if (broken) {
      return `<div class="card__poster card__poster--placeholder card__poster--broken" data-poster-slot data-poster-broken="true" role="status">
        <span class="card__poster-message">${escapeHtml(t("card.posterBroken"))}</span>
      </div>`;
    }
    if (pending) {
      // Cover still finishing in the background (see queueImportedItemEnrichment) —
      // a quiet shimmer reads as "in progress", not broken.
      return `<div class="card__poster card__poster--placeholder card__poster--pending" data-poster-slot aria-hidden="true" role="status"></div>`;
    }
    return `<div class="card__poster card__poster--placeholder" data-poster-slot aria-hidden="true">🎬</div>`;
  }

  function markCardPosterBroken(card, item) {
    if (!card) return;
    if (item) {
      if (itemHasTrustedPoster(item)) {
        if (isPosterOverwriteDebugEnabled() && isBulkPosterTraceTitle(item.title)) {
          console.warn("[poster-overwrite-trace]", {
            title: item.title,
            functionName: "markCardPosterBroken",
            itemId: item.id,
            posterBefore: itemPosterUrl(item),
            posterAfter: itemPosterUrl(item),
            posterBrokenBefore: Boolean(item.posterBroken),
            posterBrokenAfter: true,
            updatePayloadKeys: ["posterBroken"],
            payloadContainsPoster: false,
            payloadContainsPosterBroken: true,
            source: "card renderer image error",
          });
        }
        return;
      }
      item.posterBroken = true;
      saveData();
      if (item.contentType === "anime" && !animePosterRepairFailed.has(item.id)) {
        // Soft retry only — force:true was cascading AniList+season fetches on flaky CDNs.
        queueAnimePosterRepair(item.id);
      }
    }

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

  function bindPosterLoadTracking() {
    els.main?.querySelectorAll(".card__poster[src]").forEach((img) => {
      if (img.dataset.posterLoadBound === "1") return;
      img.dataset.posterLoadBound = "1";
      const mark = () => rememberLoadedPoster(img.currentSrc || img.getAttribute("src"));
      if (img.complete && img.naturalWidth > 0) {
        mark();
        return;
      }
      img.addEventListener("load", mark, { once: true });
    });
  }

  async function hydratePosters() {
    // Skip live poster hydration while bulk import is matching — it walks
    // every card and can fire metadata fetches for titles still finishing.
    if (isBulkImportActivelyMatching()) return;
    const cards = [...els.main.querySelectorAll(".card--linked")];

    // Phase 1: sync DOM to known poster URLs without tearing down identical <img>s.
    for (const card of cards) {
      const item = state.items.find((entry) => entry.id === card.dataset.id);
      if (!item?.link || item.posterBroken) continue;
      const desired = cardDisplayPoster(item);
      if (!desired) continue;
      setCardPoster(card, desired);
    }
    bindPosterLoadTracking();

    // Phase 2: only fill missing posters near the viewport (cap work on mobile).
    const viewportPad = 200;
    const nearViewport = (el) => {
      const rect = el.getBoundingClientRect();
      return rect.bottom >= -viewportPad && rect.top <= window.innerHeight + viewportPad;
    };
    const missingCards = cards.filter((card) => {
      if (!nearViewport(card)) return false;
      const item = state.items.find((entry) => entry.id === card.dataset.id);
      return Boolean(item?.link && !item.posterBroken && !cardDisplayPoster(item));
    }).slice(0, 12);
    if (!missingCards.length) return;

    const fillMissing = async () => {
      for (const card of missingCards) {
        if (!els.main?.contains(card)) continue;
        const item = state.items.find((entry) => entry.id === card.dataset.id);
        if (!item?.link || item.posterBroken || cardDisplayPoster(item)) continue;

        const imdbId = getImdbId(item);
        let meta = null;
        try {
          if (imdbId) {
            meta = await window.WatchlistMetadata?.getMetadata(imdbId);
          } else if (window.WatchlistMetadata?.isSupportedLink(item.link)) {
            meta = await window.WatchlistMetadata?.resolveMetadataFromLink(item.link);
          }
        } catch {
          // Transient miss — leave placeholder; do not mark broken.
          continue;
        }

        if (!els.main?.contains(card)) continue;

        if (meta?.poster) {
          window.WatchlistMetadata?.applyTitleMetaFromDetails(meta, item, item.contentType);
          item.poster =
            window.WatchlistMetadata?.upgradePosterForStorage?.(meta.poster, meta) ||
            meta.poster;
          setCardPoster(card, cardDisplayPoster(item));
        }
        // No markCardPosterBroken on empty meta — avoid repair storms from flaky CDNs.
      }
    };

    if (typeof requestIdleCallback === "function") {
      requestIdleCallback(() => {
        void fillMissing();
      }, { timeout: 2500 });
    } else {
      window.setTimeout(() => {
        void fillMissing();
      }, 400);
    }
  }

  function shouldHydratePosters() {
    return state.cardLayout === "poster";
  }

  function applyPostRender() {
    applyCardLayout();
    bindPosterErrorHandlers();
    bindPosterLoadTracking();
    if (shouldHydratePosters()) {
      els.main.querySelectorAll(".card").forEach(observeCardPosterUpgrade);
      hydratePosters();
    }
  }

  function renderWatchedCheck() {
    return `<span class="card__watched-check" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></span>`;
  }

  function renderInProgressCheck() {
    return `<span class="card__progress-check" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><circle cx="12" cy="12" r="9" opacity="0.35"/><path d="M12 3a9 9 0 0 1 0 18" fill="currentColor" stroke="none"/></svg></span>`;
  }

  /**
   * Poster badges stay off by default so artwork stays visible. When the user
   * sorts/filters by a field that maps to a badge, show only that one for
   * quick scanning — genres never appear on the card exterior.
   */
  function cardExteriorBadgeKind() {
    const source = state.ratingFilterSource;
    if (source === "release") return "year";
    if (source === "age") return "age";
    if (source === "duration") return "duration";
    if (source === "episodes") return "episodes";
    return null;
  }

  function renderTitleMetaBadges(item, allowedKind) {
    const badges =
      window.WatchlistMetadata?.buildTitleMetaBadges(item, item.contentType) || [];
    const visible = allowedKind
      ? badges.filter((badge) => badge.kind === allowedKind)
      : badges;
    return visible
      .map((badge) => {
          const titleAttr =
            badge.kind === "age" && badge.title
              ? ` title="${escapeHtml(badge.title)}"`
              : "";
          return `<span class="badge badge--${badge.kind}"${titleAttr}>${escapeHtml(badge.label)}</span>`;
      })
      .join("");
  }

  function renderCardInfoRow(item) {
    const typeBadge = getTypeBadge(item);
    const kind = cardExteriorBadgeKind();
    let badgesHtml = `<span class="badge badge--${typeBadge.className}">${escapeHtml(typeBadge.label)}</span>`;
    if (kind === "year") {
      badgesHtml += renderReleaseYearBadge(item);
    } else if (kind) {
      badgesHtml += renderTitleMetaBadges(item, kind);
    }
    // Enrichment status is not a filter badge — keep it when details are still loading.
    if (item.enrichmentPending) {
      badgesHtml += `<span class="badge badge--pending" aria-busy="true">${escapeHtml(t("card.finishingDetails"))}</span>`;
    }
    return `<div class="card__info-row">${badgesHtml}</div>`;
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
    const isWatched = isItemWatched(item.id);
    const watchEntry = getWatchEntry(item.id);
    const rated = isWatched && hasWatchRating(watchEntry);
    const progressState = itemProgressState(item.id);
    const altTitle = item.altTitle
      ? `<span class="card__alt text-ltr">${escapeHtml(ltr(item.altTitle))}</span>`
      : "";

    const imdbId = getImdbId(item);
    const linkedClass = item.link ? " card--linked" : "";
    const linkAttr = item.link
      ? ` data-link="${escapeHtml(item.link)}" title="${escapeHtml(t("card.openLink"))}"`
      : "";
    const imdbAttr = imdbId ? ` data-imdb-id="${escapeHtml(imdbId)}"` : "";
    const externalScores = renderExternalRatings(item);
    const hasLink = Boolean(item.link);
    const displayTitle = cardDisplayTitle(item);
    const titleBlock = `
      <div class="card__top">
        ${progressState === "watched" ? renderWatchedCheck() : progressState === "inProgress" ? renderInProgressCheck() : ""}
        <h3 class="card__title">
          <span class="text-ltr">${escapeHtml(ltr(displayTitle))}</span>
          ${altTitle}
        </h3>
      </div>
    `;
    const detailsContent = renderCardInfoRow(item);
    const cardSections = detailsContent
      ? `<div class="card__sections">${detailsContent}</div>`
      : "";
    const overlaySections = detailsContent
      ? `<div class="card__sections card__sections--overlay">${detailsContent}</div>`
      : "";
    const overlayBlock = `${overlaySections}${titleBlock}`;

    const displayPoster = cardDisplayPoster(item);
    const posterBlock = hasLink
      ? `<div class="card__media">${
          item.posterBroken && !displayPoster
            ? posterPlaceholderMarkup(true)
            : displayPoster
              ? `<img class="card__poster" src="${escapeHtml(displayPoster)}" alt=""${posterLoadingAttr(displayPoster)} />`
              : posterPlaceholderMarkup(false, Boolean(item.enrichmentPending))
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
      : progressState === "inProgress"
        ? `<button type="button" class="card__footer-badge card__footer-badge--in-progress" data-action="quick-toggle-watched" data-id="${escapeHtml(item.id)}" aria-label="${escapeHtml(t("card.markWatched"))}">${escapeHtml(t("card.inProgress"))}</button>`
      : progressState === "watched" || (isWatched && !rated)
        ? `<button type="button" class="card__footer-badge card__footer-badge--watched" data-action="quick-toggle-watched" data-id="${escapeHtml(item.id)}" aria-label="${escapeHtml(t("card.markUnwatched"))}">${escapeHtml(t("card.watched"))}</button>`
        : `<button type="button" class="card__footer-badge card__footer-badge--unwatched" data-action="quick-toggle-watched" data-id="${escapeHtml(item.id)}" aria-label="${escapeHtml(t("card.markWatched"))}">${escapeHtml(t("card.notWatchedShort"))}</button>`;

    const mobileFooter = !isWatched
      ? `<button type="button" class="card__watch-status" data-action="quick-toggle-watched" data-id="${escapeHtml(item.id)}" aria-label="${escapeHtml(t("card.markWatched"))}">${escapeHtml(t("card.notWatchedShort"))}</button>`
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
          ? `<button type="button" class="card__watch-status card__watch-status--in-progress" data-action="quick-toggle-watched" data-id="${escapeHtml(item.id)}" aria-label="${escapeHtml(t("card.markWatched"))}">${escapeHtml(t("card.inProgress"))}</button>`
          : `<button type="button" class="card__watch-status card__watch-status--watched" data-action="quick-toggle-watched" data-id="${escapeHtml(item.id)}" aria-label="${escapeHtml(t("card.markUnwatched"))}">${escapeHtml(t("card.watched"))}</button>`;
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

    // In-progress titles show "Mark watched" so one click completes them,
    // not "Mark unwatched" which would trash their episode progress.
    const watchedLabel = progressState === "watched"
      ? t("card.markUnwatched")
      : t("card.markWatched");
    const cardProgressClass = progressState === "inProgress" ? " card--in-progress" : "";

    const busyAttr = item.enrichmentPending ? ' aria-busy="true"' : "";
    return `
      <article class="card${linkedClass}${progressState === "watched" ? " card--watched" : ""}${cardProgressClass}" data-id="${escapeHtml(item.id)}"${linkAttr}${imdbAttr}${busyAttr}>
        ${posterBlock}
        ${bodyStart}
        ${bodyHeader}
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

  function render({ preserveTypeViewCache = false } = {}) {
    if (!preserveTypeViewCache) clearTypeViewDomCache();
    posterEagerBudget = 18;
    healAllPosterUrls({ persist: true });
    updateClearFiltersButton();
    updateFilterFieldHighlights();
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

  function addTitlePosterMarkup(posterUrl, title, posterClass, { lazy = true, lightbox = true } = {}) {
    if (!posterUrl) {
      return `<div class="${posterClass} ${posterClass}--empty" aria-hidden="true">🎬</div>`;
    }
    const lazyAttr = lazy ? ' loading="lazy"' : "";
    const img = `<img class="${posterClass}" src="${escapeHtml(posterUrl)}" alt=""${lazyAttr} />`;
    if (!lightbox) return img;
    const viewLabel = t("detail.viewPoster", { title: title || "" });
    return `<button type="button" class="search-poster-btn" data-action="view-search-poster"
      aria-label="${escapeHtml(viewLabel)}">
      ${img}
    </button>`;
  }

  function openAddTitlePosterLightbox(event) {
    const posterBtn = event.target.closest("[data-action='view-search-poster']");
    if (!posterBtn) return false;
    event.preventDefault();
    event.stopPropagation();
    const img = posterBtn.querySelector("img");
    const src = img?.currentSrc || img?.src || img?.getAttribute("src") || "";
    if (src) {
      window.WatchlistTitleDetail?.openPosterLightbox?.(src, img?.alt || "");
    }
    return true;
  }

  function formatSearchConfirmRating(details) {
    if (!details) return "";
    if (details.anilistRating || details.source === "anilist") {
      const pct = formatAnilistDisplay(details.anilistRating || details.rating);
      if (pct) return pct;
    }
    const score = formatImdbDisplay(details.rating || details.imdbRating);
    return score ? `${score}/10` : "";
  }

  function renderSearchConfirmRatingBadge(details) {
    if (!details) return "";
    if (details.anilistRating || details.source === "anilist") {
      const pct = formatAnilistDisplay(details.anilistRating || details.rating);
      if (!pct) return "";
      return `<span class="card__score card__score--anilist" title="AniList ${escapeHtml(pct)}">
        <span class="card__score-value text-num">${escapeHtml(pct)}</span>
        <img class="card__score-logo card__score-logo--anilist" src="${BRAND_ANILIST_LOGO}" width="34" height="26" alt="" />
      </span>`;
    }
    const imdb = formatImdbDisplay(details.rating || details.imdbRating);
    if (!imdb) return "";
    return `<span class="card__score card__score--imdb" title="IMDb ${escapeHtml(imdb)}">
      <span class="card__score-value text-num">${escapeHtml(imdb)}</span>
      <img class="card__score-logo card__score-logo--imdb" src="${BRAND_IMDB_LOGO}" width="46" height="20" alt="" />
    </span>`;
  }

  function renderTitlePreview(container, details) {
    if (!container || !details) return;

    const poster = addTitlePosterMarkup(
      details.poster,
      details.title,
      "title-search-confirm__poster",
      { lazy: false }
    );
    const year = formatReleaseYearDisplay(details.year);
    const yearHtml = year
      ? `<span class="badge badge--year text-num" title="${escapeHtml(t("card.releaseYear"))}">${escapeHtml(year)}</span>`
      : "";
    const ratingHtml = renderSearchConfirmRatingBadge(details);
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
    const contentType = normalizeContentType(
      els.searchConfirmType?.value || details?.contentType || "movies"
    );
    const preview = { ...details, contentType };
    if (
      contentType === "anime" &&
      String(preview.mediaType || preview.omdbType || "").toLowerCase() !== "movie" &&
      !preview.seasonCount
    ) {
      preview.seasonCount = 1;
    }
    renderTitlePreview(els.searchConfirmPreview, preview);
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
    const pick = {
      source: button.dataset.pickSource || "omdb",
      imdbId: button.dataset.imdbId || null,
      anilistId: button.dataset.anilistId ? Number(button.dataset.anilistId) : null,
      tmdbType: button.dataset.tmdbType || null,
      tmdbId: button.dataset.tmdbId ? Number(button.dataset.tmdbId) : null,
    };
    const result = searchResultFromPick(pick);
    if (result?.title) pick.title = result.title;
    if (result?.year) pick.year = result.year;
    if (result?.poster) pick.poster = result.poster;
    if (result?.displayType) pick.displayType = result.displayType;
    if (result?.originalLanguage) pick.originalLanguage = result.originalLanguage;
    if (result?.originCountry) pick.originCountry = result.originCountry;
    if (result?.genreIds) pick.genreIds = result.genreIds;
    return pick;
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

  function setModalSearchMode(hasResults) {
    // Toggle class so CSS can switch between auto-height (no results / confirm)
    // and full-height (search results are visible and need to scroll).
    els.modal?.classList.toggle("modal--has-results", Boolean(hasResults));
    syncItemModalViewport();
  }

  function renderTitleSearchResults() {
    if (!els.titleSearchResults) return;

    if (!state.searchResults.length) {
      els.titleSearchResults.innerHTML = "";
      state.searchResultFocusIndex = -1;
      setModalSearchMode(false);
      return;
    }
    setModalSearchMode(true);

    els.titleSearchResults.setAttribute("role", "listbox");
    els.titleSearchResults.setAttribute("aria-label", t("search.label"));

    els.titleSearchResults.innerHTML = state.searchResults
      .map((result, index) => {
        const onList = isSearchResultOnList(result);
        const resultKey =
          result.resultKey ||
          `${result.title}::${result.year || ""}`;
        const isAdded = onList || state.searchAddedKeys.has(resultKey);
        const isAdding = state.searchAddingKeys.has(resultKey);

        const poster = addTitlePosterMarkup(
          result.poster,
          result.title,
          "title-search__poster",
          { lightbox: false }
        );
        const meta = [result.year, formatSearchResultType(
          result.displayType ||
            window.WatchlistMetadata?.displayTypeForSearchResult?.(result) ||
            result.type
        )]
          .filter(Boolean)
          .join(" · ");
        const pickLabel = isAdded
          ? `${result.title} — ${t("search.alreadyOnList")}`
          : t("search.pickResult", { title: result.title, meta });
        const tabIndex = index === state.searchResultFocusIndex ? "0" : "-1";

        // + / ✓ add button
        const addBtnLabel = isAdded
          ? t("search.added")
          : t("search.addResult", { title: result.title });
        const addBtnIcon = isAdded
          ? `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="2,8 6,12 14,4"/></svg>`
          : isAdding
            ? `<svg viewBox="0 0 16 16" width="16" height="16"><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="30" stroke-dashoffset="10"><animateTransform attributeName="transform" type="rotate" from="0 8 8" to="360 8 8" dur="0.8s" repeatCount="indefinite"/></circle></svg>`
            : `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="8" y1="2" x2="8" y2="14"/><line x1="2" y1="8" x2="14" y2="8"/></svg>`;

        const sharedDataAttrs = `data-pick-source="${escapeHtml(result.source || "omdb")}" data-imdb-id="${escapeHtml(result.imdbId || "")}" data-anilist-id="${result.anilistId || ""}" data-tmdb-type="${escapeHtml(result.tmdbType || "")}" data-tmdb-id="${result.tmdbId || ""}" data-result-key="${escapeHtml(resultKey)}"`;

        return `<li class="title-search__row" role="presentation">
          <div
            class="title-search__item${isAdded ? " title-search__item--on-list" : ""}"
            data-action="${isAdded ? "" : "pick-search-result"}"
            ${sharedDataAttrs}
            role="option"
            aria-selected="false"
            aria-disabled="${isAdded ? "true" : "false"}"
            aria-label="${escapeHtml(pickLabel)}"
            tabindex="${isAdded ? "-1" : tabIndex}"
          >
            ${poster}
            <span class="title-search__info">
              <span class="title-search__title text-ltr">${escapeHtml(ltr(result.title))}</span>
              <span class="title-search__meta">${escapeHtml(meta)}${isAdded ? ` · ${escapeHtml(t("search.alreadyOnList"))}` : ""}</span>
            </span>
            <button
              type="button"
              class="title-search__add-btn${isAdded ? " title-search__add-btn--added" : ""}"
              data-action="add-search-result"
              ${sharedDataAttrs}
              aria-label="${escapeHtml(addBtnLabel)}"
              ${isAdded || isAdding ? "disabled" : ""}
            >${addBtnIcon}</button>
          </div>
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
        "[data-action='pick-search-result']"
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

  function syncTitleSearchTypePills() {
    const value = els.titleSearchType?.value || "all";
    document.querySelectorAll("#titleSearchTypePills [data-search-type]").forEach((pill) => {
      const active = pill.dataset.searchType === value;
      pill.classList.toggle("title-search__type-pill--active", active);
      pill.setAttribute("aria-pressed", String(active));
    });
  }

  function resetSearchAddState() {
    setModalSearchMode(false);
    clearTimeout(searchDebounceTimer);
    state.searchQuery = "";
    state.searchPage = 1;
    state.searchTotal = 0;
    state.searchResults = [];
    state.searchResultFocusIndex = -1;
    state.searchLoading = false;
    state.searchPickDetails = null;
    state.searchPickResultKey = null;
    state.searchConfirmOrigin = "search";
    state.searchConfirmForceOnList = false;
    state.searchConfirmSecondary = [];
    state.searchAddedKeys = new Set();
    state.searchAddingKeys = new Set();

    if (els.titleSearchInput) els.titleSearchInput.value = "";
    if (els.titleSearchClear) els.titleSearchClear.hidden = true;
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
    syncTitleSearchTypePills();
    if (els.titleSearchResults) els.titleSearchResults.innerHTML = "";
    if (els.titleSearchMore) els.titleSearchMore.hidden = true;
    if (els.searchAddStep) els.searchAddStep.hidden = false;
    if (els.searchConfirmStep) els.searchConfirmStep.hidden = true;
    setTitleSearchStatus("");
    syncSearchConfirmBackLabel();
    syncSearchConfirmAddButton(null);
  }

  function getSearchConfirmBackKey() {
    return state.searchConfirmOrigin === "related"
      ? "search.backSimple"
      : "search.back";
  }

  function syncSearchConfirmBackLabel() {
    if (!els.searchConfirmBack) return;
    els.searchConfirmBack.textContent = t(getSearchConfirmBackKey());
  }

  function isSearchConfirmOnList(details = state.searchPickDetails) {
    if (state.searchConfirmForceOnList) return true;
    if (!details?.title) return false;
    return isTitleOnList({
      title: details.title,
      imdbId: details.imdbId,
      anilistId: details.anilistId,
      year: details.year,
    });
  }

  function getSearchConfirmAddKey(details = state.searchPickDetails) {
    return isSearchConfirmOnList(details)
      ? "detail.relatedMovieOnList"
      : "btn.addTitle";
  }

  function syncSearchConfirmAddButton(details = state.searchPickDetails) {
    const btn = els.searchConfirmAdd;
    if (!btn) return;
    const onList = isSearchConfirmOnList(details);
    btn.dataset.onList = onList ? "true" : "false";
    if (btn.classList.contains("btn--loading")) return;
    delete btn.dataset.defaultLabel;
    btn.disabled = onList;
    btn.textContent = t(getSearchConfirmAddKey(details));
    btn.classList.toggle("title-search-confirm__add--on-list", onList);
  }

  async function openAddTitleConfirm(details, options = {}) {
    if (!details?.title) return;
    openModal("add");
    state.searchConfirmOrigin =
      options.origin === "related" ? "related" : "search";
    state.searchConfirmForceOnList = Boolean(options.forceOnList);
    if (els.addModeTabs) {
      els.addModeTabs.hidden = state.searchConfirmOrigin === "related";
    }
    if (els.titleSearchType && options.defaultContentType) {
      const map = {
        movies: "movie",
        tvSeries: "series",
        anime: "anime",
      };
      const filter = map[options.defaultContentType];
      if (filter) els.titleSearchType.value = filter;
      syncTitleSearchTypePills();
    }
    const enriched = {
      ...details,
      contentType: options.defaultContentType || details.contentType,
    };
    await showSearchConfirmStep(enriched);
  }

  /**
   * Instant add from related/similar + buttons — no confirm sheet.
   * Uses suggested genres (or the parent card's genre when provided).
   */
  async function quickAddFromDetails(details, options = {}) {
    if (!details?.title) return { ok: false, reason: "no_title" };

    const contentType = normalizeContentType(
      options.defaultContentType || details.contentType || "movies"
    );
    const WM = window.WatchlistMetadata;

    let resolvedDetails = { ...details, contentType };
    if (contentType === "anime") {
      resolvedDetails =
        (await WM?.resolveDetailsForWatchlistAdd?.(
          {
            anilistId: details.anilistId,
            title: details.title,
            year: details.year,
            source: "anilist",
            poster: details.poster,
            plot: details.plot,
          },
          "anime",
          { pipeline: "related-quick-add", posterRequired: false }
        )) ||
        (await WM?.ensureAnimeDetails?.(details, { forceAnime: true })) ||
        resolvedDetails;
    }

    if (isTitleOnList({
      title: resolvedDetails.title || details.title,
      imdbId: resolvedDetails.imdbId || details.imdbId,
      anilistId: resolvedDetails.anilistId || details.anilistId,
      year: resolvedDetails.year || details.year,
    })) {
      return { ok: true, alreadyOnList: true };
    }

    const suggested =
      resolvedDetails.mergedGenres ||
      WM?.suggestGenres?.(resolvedDetails.genres, STANDARD_GENRES, contentType) ||
      [];
    const genre = normalizeGenre(
      options.genre ||
        suggested[0] ||
        WM?.defaultGenreForContentType?.(contentType)
    );
    const secondaryGenres = normalizeSecondaryGenres(
      genre,
      options.secondaryGenres ??
        suggested.filter((entry) => entry !== genre)
    );

    const item = buildItemFromSearchDetails(resolvedDetails, {
      contentType,
      genre,
      secondaryGenres,
    });
    if (!item?.title) return { ok: false, reason: "no_title" };

    const duplicate = findDuplicate(item, null);
    if (duplicate) {
      return { ok: true, alreadyOnList: true, item: duplicate };
    }

    state.items.push(item);
    state.data = itemsToNested(state.items);
    saveData();
    updateGenreOptions();
    updateStats();
    clearTypeViewDomCache();
    queueItemBadgeEnrichment(item.id);
    // Keep an open title-detail sheet intact; list will catch up when it closes.
    if (!window.WatchlistTitleDetail?.isOpen?.()) {
      syncListCard(item.id);
    }

    return { ok: true, alreadyOnList: false, item };
  }

  function isTitleOnList(hints) {
    if (!hints) return false;
    return isSearchResultOnList({
      title: hints.title,
      imdbId: hints.imdbId,
      anilistId: hints.anilistId,
      year: hints.year,
    });
  }

  /**
   * Resolved AniList ids for every anime item already on the active list —
   * cache-only (no network), used to detect when a "similar title"
   * recommendation is actually a different season/sequel of a show the user
   * already has (e.g. "My Hero Academia Season 4" vs "My Hero Academia").
   */
  function getAnimeWatchlistAnilistIds() {
    const SM = window.WatchlistSeriesMetadata;
    const ids = [];
    for (const item of state.items) {
      if (item.contentType !== "anime") continue;
      const id = SM?.resolveWatchlistItemAnilistIdSync?.(item);
      if (Number.isFinite(id)) ids.push(id);
    }
    return ids;
  }

  async function quickToggleWatched(itemId) {
    if (!itemId) return;
    const progress = itemProgressState(itemId);
    if (progress === "watched") {
      await markItemUnwatched(itemId);
      return;
    }
    await markItemWatched(itemId);
  }

  async function refreshSearchConfirmForType() {
    const details = state.searchPickDetails;
    if (!details || !els.searchConfirmType) return;
    const contentType = normalizeContentType(els.searchConfirmType.value);
    if (contentType !== "anime") {
      renderSearchConfirmPreview(details);
      syncSearchConfirmAddButton(details);
      return;
    }
    const enriched = await window.WatchlistMetadata.ensureAnimeDetails(details, {
      forceAnime: true,
    });
    state.searchPickDetails = enriched;
    renderSearchConfirmPreview(enriched);
    syncSearchConfirmAddButton(enriched);
  }

  async function showSearchConfirmStep(details) {
    if (!els.searchAddStep || !els.searchConfirmStep || !details) return;

    setModalSearchMode(false);

    searchConfirmReturnFocus = document.activeElement;
    state.searchPickDetails = details;
    els.searchAddStep.hidden = true;
    els.searchConfirmStep.hidden = false;
    syncSearchConfirmBackLabel();
    if (els.addModeTabs && state.searchConfirmOrigin === "related") {
      els.addModeTabs.hidden = true;
    }

    const searchTabAnime = els.titleSearchType?.value === "anime";
    const defaultType =
      (searchTabAnime ? "anime" : null) ||
      (details.anilistId ? "anime" : null) ||
      window.WatchlistMetadata?.resolveContentTypeForWatchlistAdd?.(null, details, {
        searchTypeFilter: els.titleSearchType?.value,
      }) ||
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

    let previewDetails = details;
    if (contentType === "anime") {
      previewDetails = await window.WatchlistMetadata.ensureAnimeDetails(details, {
        forceAnime: true,
      });
      state.searchPickDetails = previewDetails;
    }

    renderSearchConfirmPreview(previewDetails);
    syncSearchConfirmAddButton(previewDetails);

    els.searchConfirmGenre?.focus();
    syncItemModalViewport();
  }

  function hideSearchConfirmStep() {
    if (state.searchConfirmOrigin === "related") {
      closeModal();
      return;
    }
    state.searchPickDetails = null;
    state.searchPickResultKey = null;
    state.searchConfirmSecondary = [];
    if (els.searchAddStep) els.searchAddStep.hidden = false;
    if (els.searchConfirmStep) els.searchConfirmStep.hidden = true;
    if (els.addModeTabs && state.editingId == null) {
      els.addModeTabs.hidden = false;
    }
    syncSearchConfirmBackLabel();
    syncSearchConfirmAddButton(null);
    const restore = searchConfirmReturnFocus;
    searchConfirmReturnFocus = null;
    if (restore?.focus && els.modalPanel?.contains(restore)) {
      restore.focus();
    } else {
      els.titleSearchInput?.focus();
    }
    syncItemModalViewport();
  }

  function markSearchResultAdded(resultKey) {
    if (resultKey) state.searchAddedKeys.add(resultKey);
  }

  function finishRelatedConfirmAdd() {
    closeModal();
    window.WatchlistSeasons?.refreshRelatedPanels?.();
  }

  function returnToSearchAfterAdd(title, { alreadyOnList = false, resultKey = null } = {}) {
    if (state.searchConfirmOrigin === "related") {
      finishRelatedConfirmAdd();
      return;
    }
    if (resultKey) markSearchResultAdded(resultKey);
    hideSearchConfirmStep();
    renderTitleSearchResults();
    setModalSearchMode(state.searchResults.length > 0);
    if (alreadyOnList) {
      setTitleSearchStatus(
        title
          ? `${title} — ${t("search.alreadyOnList")}`
          : t("search.alreadyOnList")
      );
    } else if (title) {
      setTitleSearchStatus(t("search.addedStatus", { title }));
    }
    els.titleSearchInput?.focus();
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
      const key =
        entry.resultKey ||
        window.WatchlistMetadata?.resultProviderIdentityKey?.(entry) ||
        `${entry.title}::${entry.year || ""}::${entry.source || ""}`;
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
    const resultKey =
      pickButton.dataset.resultKey ||
      result?.resultKey ||
      `${result?.title || ""}::${result?.year || ""}`;

    if (state.searchAddedKeys.has(resultKey)) {
      returnToSearchAfterAdd(result?.title || "", { alreadyOnList: true, resultKey });
      return;
    }

    if (result && isSearchResultOnList(result)) {
      returnToSearchAfterAdd(result.title, { alreadyOnList: true, resultKey });
      return;
    }

    setSearchPickLoading(true);
    setTitleSearchStatus(t("search.loadingDetails"));
    try {
      const preferAnime = els.titleSearchType?.value === "anime";
      let details = await window.WatchlistMetadata.resolveDetailsForWatchlistAdd?.(
        { ...pick, title: searchResultFromPick(pick)?.title || pick.title },
        preferAnime ? "anime" : null,
        {
          searchQuery: state.searchQuery,
          searchTypeFilter: els.titleSearchType?.value,
          pipeline: "search-pick",
        }
      );
      if (!details?.title) {
        details = await window.WatchlistMetadata.getDetailsForPick(pick, {
        searchQuery: state.searchQuery,
        preferAnime,
      });
      if (preferAnime && details) {
        details = await window.WatchlistMetadata.ensureAnimeDetails(details, {
          pick,
          preferAnime: true,
          forceAnime: true,
        });
        }
      }
      if (!details?.title) {
        setTitleSearchStatus(t("search.loadFailed"), { error: true });
        return;
      }

      const searchResult = searchResultFromPick(pick);
      if (searchResult?.title) {
        details = {
          ...details,
          title: window.WatchlistMetadata.preferLocalizedTitle(
            searchResult.title,
            details.title,
            state.searchQuery
          ),
        };
      }

      state.searchPickResultKey = resultKey;
      state.searchConfirmOrigin = "search";
      setTitleSearchStatus("");
      showSearchConfirmStep(details);
    } finally {
      setSearchPickLoading(false);
    }
  }

  /**
   * Directly add a title from a search result row, without showing the confirm step.
   * Falls back to the confirm step when essential metadata is missing.
   */
  async function handleSearchResultDirectAdd(addBtn) {
    const pick = searchPickFromButton(addBtn);
    if (!hasLookupId(pick)) return;

    const resultKey = addBtn.dataset.resultKey || "";
    if (state.searchAddedKeys.has(resultKey) || state.searchAddingKeys.has(resultKey)) return;

    const existingResult = searchResultFromPick(pick);
    if (existingResult && isSearchResultOnList(existingResult)) {
      // Already on list — show checkmark without re-adding
      state.searchAddedKeys.add(resultKey);
      renderTitleSearchResults();
      return;
    }

    state.searchAddingKeys.add(resultKey);
    renderTitleSearchResults();

    let details = null;
    const searchResult = searchResultFromPick(pick);
    try {
      const preferAnime = els.titleSearchType?.value === "anime";
      details = await window.WatchlistMetadata.resolveDetailsForWatchlistAdd?.(
        { ...pick, title: searchResult?.title },
        preferAnime ? "anime" : null,
        {
          searchQuery: state.searchQuery,
          searchTypeFilter: els.titleSearchType?.value,
          pipeline: "search-direct",
          posterRequired: preferAnime,
        }
      );
      if (!details?.title) {
      details = await window.WatchlistMetadata.getDetailsForPick(pick, {
        searchQuery: state.searchQuery,
        preferAnime,
      });
      if (preferAnime && details) {
        details = await window.WatchlistMetadata.ensureAnimeDetails(details, {
          pick,
          preferAnime: true,
          forceAnime: true,
        });
        }
      }
    } catch (_) {}

    if (!details?.title) {
      state.searchAddingKeys.delete(resultKey);
      setTitleSearchStatus(t("search.loadFailed"), { error: true });
      renderTitleSearchResults();
      return;
    }

    // Preserve the localized title from the search result (e.g. Arabic title)
    // instead of the English title returned by the details fetch.
    if (searchResult?.title) {
      details = {
        ...details,
        title: window.WatchlistMetadata.preferLocalizedTitle(
          searchResult.title,
          details.title,
          state.searchQuery
        ),
      };
    }

    const WM = window.WatchlistMetadata;
    const contentType =
      WM?.resolveContentTypeForWatchlistAdd?.(pick, details, {
        searchTypeFilter: els.titleSearchType?.value,
      }) ||
      normalizeContentType(
        details.contentType ||
          (pick.tmdbType === "movie" ? "movies" : pick.type === "movie" ? "movies" : "tvSeries")
      );

    const suggested = window.WatchlistMetadata?.suggestGenres(
      details.genres,
      STANDARD_GENRES,
      contentType
    ) || [];
    const genre =
      suggested[0] ||
      window.WatchlistMetadata?.defaultGenreForContentType?.(contentType) ||
      "Drama";

    const item = buildItemFromSearchDetails(details, {
      contentType,
      genre,
      secondaryGenres: suggested.slice(1),
    });
    WM?.logBulkVsSearchBuild?.("search-saved", {
      title: item.title,
      builtPoster: details.poster || "",
      finalSavedPoster: item.poster || "",
      anilistId: item.anilistId || details.anilistId || null,
      link: item.link || "",
      posterBroken: Boolean(item.posterBroken),
    });

    state.searchAddingKeys.delete(resultKey);

    // Missing summary is fine — providers may still be enriching. Only title is required.
    if (!item.title) {
      renderTitleSearchResults();
      state.searchPickResultKey = resultKey;
      state.searchConfirmOrigin = "search";
      showSearchConfirmStep(details);
      return;
    }

    const duplicate = findDuplicate(item, null);
    if (duplicate) {
      markSearchResultAdded(resultKey);
      renderTitleSearchResults();
      setTitleSearchStatus(`${item.title} — ${t("search.alreadyOnList")}`);
      return;
    }

    state.items.push(item);
    state.data = itemsToNested(state.items);
    saveData();
    updateGenreOptions();
    render();
    queueItemBadgeEnrichment(item.id);

    markSearchResultAdded(resultKey);
    renderTitleSearchResults();
    setTitleSearchStatus(t("search.addedStatus", { title: item.title }));
  }

  function applyRatingsFromDetails(details, item) {
    const fromAnilist =
      details.anilistRating ||
      details.source === "anilist" ||
      details.anilistId;

    if (fromAnilist) {
      if (details.anilistRating) {
        item.anilistRating = details.anilistRating;
      } else if (details.rating && !details.imdbId) {
        const score = parseScoreValue(details.rating);
        if (score != null) {
          item.anilistRating =
            score <= 10 ? String(Math.round(score * 10)) : String(Math.round(score));
        }
      }
    } else if (details.rating) {
      item.imdbRating = details.rating;
    }

    if (!item.imdbRating && details.imdbId) {
      const imdbRating = details.imdbRating || details.rating;
      if (imdbRating) item.imdbRating = imdbRating;
    }

    if (details.imdbId) {
      const id = String(details.imdbId).toLowerCase();
      if (id.startsWith("tt")) {
        item.imdbId = id;
        if (!item.imdbLink) {
          item.imdbLink = `https://www.imdb.com/title/${id}/`;
        }
      }
    }
  }

  function buildItemFromSearchDetails(details, options) {
    const contentType = options.contentType;
    const WM = window.WatchlistMetadata;
    const suggested =
      details.mergedGenres ||
      WM?.suggestGenres(details.genres, STANDARD_GENRES, contentType) ||
      [];
    const genre = normalizeGenre(options.genre || suggested[0] || WM?.defaultGenreForContentType?.(contentType));
    const secondaryGenres = normalizeSecondaryGenres(
      genre,
      options.secondaryGenres ?? suggested.filter((entry) => entry !== genre)
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
      link:
        contentType === "anime" && details.anilistId
          ? `https://anilist.co/anime/${details.anilistId}/`
          : window.WatchlistMetadata?.defaultLinkForDetails(details, contentType) || "",
      summary: details.plot || "",
      kind: contentType === "movies" ? "movie" : "series",
      secondaryGenres,
    };

    if (contentType === "anime" && details.imdbId) {
      item.imdbLink = `https://www.imdb.com/title/${details.imdbId}/`;
    }

    if (details.poster) {
      if (contentType === "anime" && details.anilistId) {
        item.poster = String(details.poster).trim();
        item.cardPoster = item.poster;
        item.posterBroken = false;
      } else {
        item.poster =
          window.WatchlistMetadata?.upgradePosterForStorage?.(details.poster, details) ||
          details.poster;
        item.posterBroken = false;
      }
    }
    if (contentType === "anime" && details.anilistId) {
      item.provider = "anilist";
      item.providerId = String(details.anilistId);
      item.posterBroken = false;
    }
    applyRatingsFromDetails(details, item);
    if (details.year) item.year = details.year;
    window.WatchlistMetadata?.applyTitleMetaFromDetails(details, item, contentType);
    if (details.genres?.length) item.sourceGenres = details.genres;
    // Save external IDs so detail/season sheets can use them without re-fetching
    if (details.imdbId) item.imdbId = details.imdbId;
    if (details.tmdbId) item.tmdbId = details.tmdbId;
    if (details.anilistId) item.anilistId = details.anilistId;
    item.id = makeId(contentType, genre, item.title);
    stampItemAddedAt(item);
    return item;
  }

  async function handleSearchConfirmAdd() {
    if (addSaveInFlight) return;

    const details = state.searchPickDetails;
    if (!details) return;

    if (isSearchConfirmOnList(details)) {
      returnToSearchAfterAdd(details.title, { alreadyOnList: true });
      return;
    }

    const genre = els.searchConfirmGenre?.value?.trim() || "";
    const contentType = normalizeContentType(els.searchConfirmType?.value || "movies");

    if (!genre) {
      await window.WatchlistDialog.alert(t("alert.genreRequired"), {
        title: t("alert.genreRequiredTitle"),
      });
      return;
    }

    let resolvedDetails = details;
    if (contentType === "anime") {
      resolvedDetails = await window.WatchlistMetadata.resolveDetailsForWatchlistAdd?.(
        { anilistId: details.anilistId, title: details.title, year: details.year, source: "anilist" },
        "anime",
        { pipeline: "search-confirm", posterRequired: true }
      ) || (await window.WatchlistMetadata.ensureAnimeDetails(details, {
        forceAnime: true,
      }));
    }

    const item = buildItemFromSearchDetails(resolvedDetails, {
      contentType,
      genre,
      secondaryGenres: state.searchConfirmSecondary,
    });
    window.WatchlistMetadata?.logBulkVsSearchBuild?.("search-saved", {
      title: item.title,
      builtPoster: resolvedDetails?.poster || "",
      finalSavedPoster: item.poster || "",
      anilistId: item.anilistId || resolvedDetails?.anilistId || null,
      link: item.link || "",
      posterBroken: Boolean(item.posterBroken),
    });

    if (!item.title) return;

    // Summary/actors come from providers — never block save for missing metadata.

    const duplicate = findDuplicate(item, null);
    if (duplicate) {
      const resultKey =
        state.searchPickResultKey ||
        `${details.title || item.title}::${resolvedDetails.year || details.year || ""}`;
      returnToSearchAfterAdd(item.title, { alreadyOnList: true, resultKey });
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
      updateGenreOptions();
      render();
      queueItemBadgeEnrichment(item.id);

      const resultKey =
        state.searchPickResultKey ||
        `${details.title || item.title}::${resolvedDetails.year || details.year || ""}`;
      returnToSearchAfterAdd(item.title, { resultKey });
    } finally {
      addSaveInFlight = false;
      setButtonLoading(els.searchConfirmAdd, false);
      if (els.searchConfirmBack) els.searchConfirmBack.disabled = false;
      if (els.searchConfirmStep) els.searchConfirmStep.removeAttribute("aria-busy");
    }
  }

  function setAddMode(mode) {
    // Manual add removed — keep form only for edit. Map legacy "manual" to search.
    if (mode === "manual") mode = "search";
    state.addMode = mode;
    const isBulk = mode === "bulk";
    const isSearch = mode === "search";

    els.addModeTabs?.querySelectorAll("[data-add-mode]").forEach((tab) => {
      const active = tab.dataset.addMode === mode;
      tab.classList.toggle("add-mode-tab--active", active);
      tab.setAttribute("aria-selected", String(active));
    });

    if (els.searchAddPanel) els.searchAddPanel.hidden = !isSearch;
    if (els.form) els.form.hidden = true;
    if (els.bulkAddPanel) els.bulkAddPanel.hidden = !isBulk;

    if (!isSearch) {
      state.searchPickDetails = null;
      if (els.searchAddStep) els.searchAddStep.hidden = false;
      if (els.searchConfirmStep) els.searchConfirmStep.hidden = true;
    }

    if (isBulk) {
      setBulkPasteError("");
      resumeImportJobUiIfAny();
      if (!els.bulkImportPreview || els.bulkImportPreview.hidden) {
      els.bulkPasteInput?.focus();
      }
    } else {
      hideSearchConfirmStep();
      els.titleSearchInput?.focus();
    }
    syncItemModalViewport();
  }

  // Mobile add-title sheet: keyboard viewport + swipe-to-dismiss (title-detail parity)
  let itemModalSavedScrollY = 0;
  let itemModalPanelDrag = null;
  let itemModalSwipeBound = false;
  let itemModalViewportBound = false;
  let itemModalTouchBlockBound = false;
  const ITEM_MODAL_MOBILE_MQ = "(max-width: 640px)";
  const ITEM_MODAL_DRAG_CLOSE_PX = 120;
  const ITEM_MODAL_DRAG_START_PX = 8;

  function isItemModalMobileSheet() {
    return window.matchMedia(ITEM_MODAL_MOBILE_MQ).matches;
  }

  function lockItemModalBackground() {
    if (!isItemModalMobileSheet()) return;
    itemModalSavedScrollY = window.scrollY || window.pageYOffset || 0;
    document.documentElement.classList.add("item-modal-scroll-lock");
    document.body.classList.add("item-modal-scroll-lock");
    document.body.style.position = "fixed";
    document.body.style.top = `-${itemModalSavedScrollY}px`;
    document.body.style.left = "0";
    document.body.style.right = "0";
    document.body.style.width = "100%";
  }

  function restorePageScrollY(y) {
    const root = document.documentElement;
    const prev = root.style.scrollBehavior;
    root.style.scrollBehavior = "auto";
    window.scrollTo(0, y);
    root.style.scrollBehavior = prev;
  }

  function unlockItemModalBackground() {
    const hadLock =
      document.body.classList.contains("item-modal-scroll-lock") ||
      document.documentElement.classList.contains("item-modal-scroll-lock");
    if (!hadLock) return;
    document.documentElement.classList.remove("item-modal-scroll-lock");
    document.body.classList.remove("item-modal-scroll-lock");
    const y = itemModalSavedScrollY;
    document.body.style.position = "";
    document.body.style.top = "";
    document.body.style.left = "";
    document.body.style.right = "";
    document.body.style.width = "";
    restorePageScrollY(y);
  }

  function syncItemModalViewport() {
    // Soft keyboards must overlay fixed modals — never shrink/translate sheets to
    // visualViewport (that jumps every window when the keyboard opens).
    // Viewport meta uses interactive-widget=overlays-content for the same reason.
    if (!els.modalPanel || itemModalPanelDrag?.dragging) return;
    els.modalPanel.style.maxHeight = "";
    els.modalPanel.style.height = "";
  }

  function resetItemModalViewport() {
    if (!els.modal) return;
    itemModalPanelDrag = null;
    resetItemModalDragStyles();
    if (els.modalPanel) {
      els.modalPanel.style.maxHeight = "";
      els.modalPanel.style.height = "";
      els.modalPanel.style.transform = "";
    }
  }

  function onItemModalDocumentTouchMove(event) {
    if (!els.modal || !isItemModalMobileSheet()) return;
    if (els.modal.hidden) {
      unbindItemModalTouchBlock();
      return;
    }
    if (!els.modal.contains(event.target)) return;

    const target = event.target;
    if (!target?.closest) return;

    // Allow scroll only inside the sheet's scroll regions.
    if (
      target.closest(
        "#itemModal .title-search__scroll, #itemModal .modal__form, " +
          "#itemModal .modal__bulk, #itemModal .title-search-confirm, " +
          "#itemModal .bulk-import-preview__table-wrap"
      )
    ) {
      return;
    }

    // Block backdrop scroll chaining (iOS ignores overflow:hidden).
    event.preventDefault();
  }

  function bindItemModalTouchBlock() {
    if (itemModalTouchBlockBound || !els.modal) return;
    itemModalTouchBlockBound = true;
    els.modal.addEventListener("touchmove", onItemModalDocumentTouchMove, {
      passive: false,
    });
  }

  function unbindItemModalTouchBlock() {
    if (!itemModalTouchBlockBound || !els.modal) return;
    itemModalTouchBlockBound = false;
    els.modal.removeEventListener("touchmove", onItemModalDocumentTouchMove);
  }

  function modalIsVisible(el) {
    return Boolean(el && el.hidden === false);
  }

  function titleDetailLocksPageScroll() {
    if (window.WatchlistTitleDetail?.isOpen?.() !== true) return false;
    return window.matchMedia("(max-width: 640px)").matches;
  }

  function updateBodyScrollLock() {
    const itemModalOpen = modalIsVisible(els.modal);
    const anyModalOpen = [
      els.modal,
      els.ratingModal,
      els.bulkCorrectedTsvModal,
      els.shareModal,
      els.themeModal,
      els.creditsModal,
      els.changeCodeModal,
      els.importShareModal,
      els.importNewListModal,
      els.manageListsModal,
      els.createListModal,
      els.moveListModal,
    ].some(modalIsVisible);
    const dialogOpen = isAppDialogOpen();
    const detailLocksPage = titleDetailLocksPageScroll();
    const detailOpen = window.WatchlistTitleDetail?.isOpen?.() === true;
    const anyOpen = anyModalOpen || dialogOpen || detailLocksPage;

    if (!itemModalOpen) {
      unbindItemModalTouchBlock();
      document.documentElement.classList.remove("item-modal-scroll-lock");
      document.body.classList.remove("item-modal-scroll-lock");
    }

    if (!itemModalOpen && !detailOpen) {
      const savedY = Math.abs(parseInt(document.body.style.top || "0", 10) || 0);
      document.body.style.position = "";
      document.body.style.top = "";
      document.body.style.left = "";
      document.body.style.right = "";
      document.body.style.width = "";
      if (savedY > 0) {
        window.scrollTo(0, savedY);
      }
    }

    if (anyOpen) {
      document.documentElement.style.overflow = "hidden";
      document.body.style.overflow = "hidden";
    } else {
      document.documentElement.classList.remove(
        "td-scroll-lock",
        "td-scroll-lock-desktop",
        "item-modal-scroll-lock"
      );
      document.body.classList.remove(
        "td-scroll-lock",
        "td-scroll-lock-desktop",
        "item-modal-scroll-lock"
      );
      document.documentElement.style.overflow = "";
      document.body.style.overflow = "";
    }
  }

  function bindItemModalViewport() {
    // Intentionally unused: do not follow visualViewport resize (keyboard).
    itemModalViewportBound = true;
  }

  function unbindItemModalViewport() {
    itemModalViewportBound = false;
  }

  function getItemModalScrollEl() {
    const confirm = document.getElementById("searchConfirmStep");
    if (confirm && !confirm.hidden) return confirm;
    if (els.form && !els.form.hidden) return els.form;
    if (els.bulkAddPanel && !els.bulkAddPanel.hidden) {
      if (els.bulkImportPreview && !els.bulkImportPreview.hidden) {
        return els.bulkImportPreview;
      }
      return els.bulkAddPanel;
    }
    return els.modalPanel?.querySelector(".title-search__scroll") || null;
  }

  function itemModalScrollAtTop() {
    const scrollEl = getItemModalScrollEl();
    return (scrollEl?.scrollTop ?? 0) <= 0;
  }

  function canStartItemModalDrag(target) {
    if (!target?.closest) return false;
    if (
      target.closest(
        "button, a, input, textarea, select, label, [role='tab'], .title-search__results button"
      )
    ) {
      return false;
    }
    return true;
  }

  function resetItemModalDragStyles() {
    if (!els.modal || !els.modalPanel) return;
    els.modal.classList.remove("modal--dragging");
    els.modalPanel.classList.remove("modal__panel--dragging");
    els.modalPanel.style.transform = "";
    const backdrop = els.modal.querySelector(".modal__backdrop");
    if (backdrop) backdrop.style.opacity = "";
  }

  function onItemModalPanelTouchStart(event) {
    if (!isItemModalMobileSheet() || els.modal.hidden || itemModalPanelDrag) return;
    if (!canStartItemModalDrag(event.target)) return;

    const onHeader = Boolean(event.target.closest(".modal__header, .add-mode-tabs"));
    if (!itemModalScrollAtTop() && !onHeader) return;

    const touch = event.changedTouches?.[0] || event.touches?.[0];
    if (!touch) return;

    itemModalPanelDrag = {
      pointerId: touch.identifier,
      startY: touch.clientY,
      startX: touch.clientX,
      dragging: false,
    };
  }

  function onItemModalPanelTouchMove(event) {
    if (!itemModalPanelDrag || els.modal.hidden) return;

    const touch =
      Array.from(event.changedTouches).find(
        (t) => t.identifier === itemModalPanelDrag.pointerId
      ) || event.touches?.[0];
    if (!touch || touch.identifier !== itemModalPanelDrag.pointerId) return;

    const dy = touch.clientY - itemModalPanelDrag.startY;
    const dx = touch.clientX - itemModalPanelDrag.startX;

    if (!itemModalPanelDrag.dragging) {
      if (dy <= 0) return;
      if (Math.abs(dx) > Math.abs(dy)) {
        itemModalPanelDrag = null;
        return;
      }
      if (dy < ITEM_MODAL_DRAG_START_PX) return;
      if (!itemModalScrollAtTop()) {
        itemModalPanelDrag = null;
        return;
      }
      itemModalPanelDrag.dragging = true;
      els.modal.classList.add("modal--dragging");
      els.modalPanel.classList.add("modal__panel--dragging");
    }

    event.preventDefault();
    const offset = Math.max(0, dy);
    els.modalPanel.style.transform = `translateY(${offset}px)`;
    const backdrop = els.modal.querySelector(".modal__backdrop");
    if (backdrop) {
      const fade = Math.max(0, 1 - offset / 280);
      backdrop.style.opacity = String(0.65 * fade);
    }
  }

  function onItemModalPanelTouchEnd(event) {
    if (!itemModalPanelDrag) return;

    const touch = Array.from(event.changedTouches).find(
      (t) => t.identifier === itemModalPanelDrag.pointerId
    );
    const dy = touch ? touch.clientY - itemModalPanelDrag.startY : 0;
    const wasDragging = itemModalPanelDrag.dragging;
    itemModalPanelDrag = null;

    resetItemModalDragStyles();

    if (!wasDragging) return;

    const panelHeight = els.modalPanel?.offsetHeight || 0;
    if (dy > ITEM_MODAL_DRAG_CLOSE_PX || dy > panelHeight * 0.22) closeModal();
  }

  function setupItemModalSwipe() {
    if (itemModalSwipeBound || !els.modalPanel) return;
    itemModalSwipeBound = true;
    els.modalPanel.addEventListener("touchstart", onItemModalPanelTouchStart, { passive: true });
    els.modalPanel.addEventListener("touchmove", onItemModalPanelTouchMove, { passive: false });
    els.modalPanel.addEventListener("touchend", onItemModalPanelTouchEnd, { passive: true });
    els.modalPanel.addEventListener("touchcancel", onItemModalPanelTouchEnd, { passive: true });
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
      els.formLink.value = anilistUrlForItem(item);
      if (els.formImdbLink) {
        els.formImdbLink.value = imdbUrlForItem(item);
      }
      updateFormImdbLinkVisibility(normalizeContentType(item.contentType));
      void backfillAnimeLinksForForm(item);
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
    lockItemModalBackground();
    bindItemModalViewport();
    bindItemModalTouchBlock();
    syncItemModalViewport();
    setupItemModalSwipe();
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
    window.WatchlistTitleDetail?.closePosterLightbox?.();
    unbindItemModalTouchBlock();
    unbindItemModalViewport();
    unlockItemModalBackground();
    resetItemModalViewport();
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
    hideBulkImportPreview();
    if (els.form) els.form.hidden = true;
    if (els.bulkAddPanel) els.bulkAddPanel.hidden = true;
    if (els.searchAddPanel) els.searchAddPanel.hidden = true;
    els.form.reset();
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

  async function openCreditsModal() {
    if (!els.creditsModal) return;
    els.creditsModal.hidden = false;
    updateBodyScrollLock();
    if (els.creditsDatasetMeta) {
      els.creditsDatasetMeta.hidden = true;
      els.creditsDatasetMeta.textContent = "";
      try {
        const meta = await window.WatchlistMetadata?.fetchAnimeIndexMeta?.();
        const row = meta?.meta;
        if (row?.active_version) {
          els.creditsDatasetMeta.hidden = false;
          els.creditsDatasetMeta.textContent = t("credits.indexVersion", {
            version: row.active_version,
            count: row.accepted_rows || "—",
            updated: row.upstream_last_update || "—",
          });
        }
      } catch {
        /* offline or not configured */
      }
    }
    els.creditsModal.querySelector(".btn--primary")?.focus();
  }

  function closeCreditsModal() {
    if (!els.creditsModal) return;
    els.creditsModal.hidden = true;
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
    let listIds = window.WatchlistAuth?.discoverListIds() || [];

    if (!listIds.length) {
      els.manageListsBody.innerHTML = "";
      return;
    }

    // Put the default list first, then the rest in their original order.
    if (defaultId && listIds.includes(defaultId)) {
      listIds = [defaultId, ...listIds.filter((id) => id !== defaultId)];
    }

    els.manageListsBody.innerHTML = listIds
      .map((listId) => {
        const entry = library.find((item) => item.listId === listId);
        // Fall back to the current list's ID-derived label when no name is registered
        const label = entry?.name || entry?.label
          || (listId === currentId ? t("manage.myList") : t("manage.unnamedList"));
        const description = entry?.description || "";
        const titleCount = window.WatchlistAuth.getListTitleCount(listId);
        const isCurrent = listId === currentId;
        const isDefault = listId === defaultId;
        const badgeRow = [
          isCurrent ? `<span class="manage-lists__badge">${escapeHtml(t("manage.signedInNow"))}</span>` : "",
          isDefault ? `<span class="manage-lists__badge manage-lists__badge--default">${escapeHtml(t("manage.defaultList"))}</span>` : "",
        ].filter(Boolean).join("");
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
            >${escapeHtml(t("manage.assignDefault"))}</button>`;
        return `<li class="manage-lists__item"${isCurrent ? ' aria-current="true"' : ""}>
          <div class="manage-lists__info">
            <span class="manage-lists__name">${escapeHtml(label)}</span>
            ${about}
            <div class="manage-lists__badges">${meta}${badgeRow}</div>
          </div>
          <div class="manage-lists__actions">
            ${assignBtn}
            <button
              type="button"
              class="btn btn--ghost btn--sm"
              data-action="edit-list"
              data-list-id="${escapeHtml(listId)}"
              aria-label="${escapeHtml(t("manage.editListName", { name: label }))}"
            >${escapeHtml(t("card.edit"))}</button>
            <button
              type="button"
              class="btn btn--ghost btn--danger btn--sm"
              data-action="delete-list"
              data-list-id="${escapeHtml(listId)}"
              aria-label="${escapeHtml(t("manage.deleteListName", { name: label }))}"
            >${escapeHtml(t("card.delete"))}</button>
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
    panel.style.removeProperty("transform");
  }

  function positionCardMenuPanel(panel) {
    if (!panel) return;
    resetCardMenuPosition(panel);
    const rtl = document.documentElement.getAttribute("dir") === "rtl";
    const margin = 14;

    if (rtl) {
      panel.style.left = "0";
      panel.style.right = "auto";
    } else {
      panel.style.right = "0";
      panel.style.left = "auto";
    }
    panel.style.bottom = "calc(100% + 0.25rem)";

    requestAnimationFrame(() => {
      let rect = panel.getBoundingClientRect();

      if (rect.left < margin) {
        panel.style.transform = `translateX(${margin - rect.left}px)`;
        rect = panel.getBoundingClientRect();
      } else if (rect.right > window.innerWidth - margin) {
        panel.style.transform = `translateX(${window.innerWidth - margin - rect.right}px)`;
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
    const anilistLink = normalizeLink(els.formLink.value);
    const imdbLink = normalizeLink(els.formImdbLink?.value);
    const summary = els.formSummary.value.trim();
    const existing = state.editingId
      ? state.items.find((i) => i.id === state.editingId)
      : null;
    const kind = formKindForItem(contentType, existing?.kind);
    const linksChanged =
      existing &&
      (normalizeLink(existing.link || "") !== anilistLink ||
        normalizeLink(existing.imdbLink || "") !== imdbLink);

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
      link: contentType === "anime" ? anilistLink : (anilistLink || imdbLink),
      imdbLink: contentType === "anime" ? imdbLink : undefined,
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
      if (!linksChanged) {
        if (existing?.seasonCount && !item.seasonCount) {
          item.seasonCount = existing.seasonCount;
        }
        if (existing?.episodeCount && !item.episodeCount) {
          item.episodeCount = existing.episodeCount;
        }
      }
      if (existing?.sourceGenres?.length && !linksChanged) {
        item.sourceGenres = existing.sourceGenres;
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
      if (state.manualLinkMeta.sourceGenres?.length) {
        item.sourceGenres = state.manualLinkMeta.sourceGenres;
      }
      item.posterBroken = false;
    }

    if (existing && normalizeLink(existing.link) !== anilistLink) {
      delete item.poster;
      item.posterBroken = false;
    }

    return item;
  }

  function findDuplicate(item, excludeId) {
    const titleKey = normalizeTitleKey(item.title);
    const titleMatch = state.items.find(
      (i) =>
        i.contentType === item.contentType &&
        normalizeTitleKey(i.title) === titleKey &&
        i.id !== excludeId
    );
    if (titleMatch) return titleMatch;

    // Anime seasons/sequels are separate AniList media ids, so a title-string
    // match alone misses e.g. "Show Season 4" when "Show" (season 1) is
    // already on the list. Centralizing this here (rather than per add
    // feature) means every add/edit path — search, confirm, manual form,
    // bulk import, and any future feature — is protected by one rule.
    if (item.contentType === "anime") {
      const franchiseMatch = findWatchlistFranchiseDuplicateForImport(item);
      if (franchiseMatch && franchiseMatch.id !== excludeId) return franchiseMatch;
    }

    return null;
  }

  function findWatchlistFranchiseDuplicateForImport(item) {
    const lookup = getWatchlistFranchiseLookupForImport();
    return lookup?.find?.(item) || null;
  }

  let watchlistFranchiseLookupCache = null;
  let watchlistFranchiseLookupAt = 0;

  function getWatchlistFranchiseLookupForImport() {
    const SM = window.WatchlistSeriesMetadata;
    if (!SM?.buildWatchlistFranchiseLookup) return null;
    const now = Date.now();
    if (watchlistFranchiseLookupCache && now - watchlistFranchiseLookupAt < 5000) {
      return watchlistFranchiseLookupCache;
    }
    watchlistFranchiseLookupCache = SM.buildWatchlistFranchiseLookup(getWatchlistAnimeItems());
    watchlistFranchiseLookupAt = now;
    return watchlistFranchiseLookupCache;
  }

  function invalidateWatchlistFranchiseLookupCache() {
    watchlistFranchiseLookupCache = null;
    watchlistFranchiseLookupAt = 0;
  }

  // "Already on your list" duplicate checks run per-row against the whole
  // watchlist, and — for bulk import — that heal pass reruns on every batch
  // cycle (dozens of times on a large import). Recomputing normalizeTitleKey
  // for every watchlist item on every single lookup call was a real,
  // multi-second synchronous cost on larger watchlists/imports (a likely
  // contributor to the tab-level "Page Unresponsive" hang). Build the
  // normalized-title set once and reuse it for a few seconds at a time.
  let watchlistTitleLookupCache = null;
  let watchlistTitleLookupAt = 0;
  const WATCHLIST_TITLE_LOOKUP_TTL_MS = 5000;

  function getWatchlistTitleLookup() {
    const now = Date.now();
    if (watchlistTitleLookupCache && now - watchlistTitleLookupAt < WATCHLIST_TITLE_LOOKUP_TTL_MS) {
      return watchlistTitleLookupCache;
    }
    const set = new Set();
    for (const item of state.items) {
      set.add(`${item.contentType}::${normalizeTitleKey(item.title)}`);
    }
    watchlistTitleLookupCache = set;
    watchlistTitleLookupAt = now;
    return watchlistTitleLookupCache;
  }

  function invalidateWatchlistTitleLookupCache() {
    watchlistTitleLookupCache = null;
    watchlistTitleLookupAt = 0;
  }

  function isTitleOnWatchlist(contentType, title) {
    const lookup = getWatchlistTitleLookup();
    return lookup.has(`${contentType}::${normalizeTitleKey(title)}`);
  }

  function persistWatchlistLocalOnly() {
    if (!canPersistActiveList()) return;
    const { data } = storageKeys();
    state.data = itemsToNested(state.items);
    try {
      localStorage.setItem(data, JSON.stringify(state.data));
    } catch (err) {
      console.warn("[app] local save failed:", err);
    }
    persistWatchlistCache();
  }

  function queueItemCloudUpsert(itemId) {
    const listId = state.activeListId;
    if (!listId || !itemId || !canPersistActiveList(listId)) return;
    if (bulkImportCommitBusy) return;
    if (!window.WatchlistSync?.isConfigured()) return;
    if (window.WatchlistLifecycle && !window.WatchlistLifecycle.canWriteCloud()) return;

    const prev = enrichmentUpsertTimers.get(itemId);
    if (prev) clearTimeout(prev);
    enrichmentUpsertTimers.set(
      itemId,
      setTimeout(async () => {
        enrichmentUpsertTimers.delete(itemId);
        if (window.WatchlistAuth?.getProfile() !== listId) return;
        if (bulkImportCommitBusy) return;
        state.data = itemsToNested(state.items);
        const result = await window.WatchlistSync.pushRowsUpsert(
          listId,
          state.data,
          state.watched,
          [itemId],
          listSyncMeta(listId)
        );
        if (result?.ok) {
          writeSyncMeta(listId, { syncedAt: Date.now() });
          state.syncStatus = "saved";
          updateStats();
        }
      }, ENRICHMENT_UPSERT_DEBOUNCE_MS)
    );
  }

  let enrichmentPersistTimer = null;
  let enrichmentPersistPendingIds = null;

  function persistEnrichmentSave(itemId) {
    if (!canPersistActiveList()) return;
    // Coalesce enrichment writes — rewriting the entire nested watchlist
    // to localStorage/IDB after every single badge/poster update during
    // bulk import was another Out-of-Memory path.
    if (!enrichmentPersistPendingIds) enrichmentPersistPendingIds = new Set();
    if (itemId) enrichmentPersistPendingIds.add(itemId);
    if (enrichmentPersistTimer) return;
    enrichmentPersistTimer = window.setTimeout(() => {
      enrichmentPersistTimer = null;
      const ids = enrichmentPersistPendingIds;
      enrichmentPersistPendingIds = null;
      if (!canPersistActiveList()) return;
      state.data = itemsToNested(state.items);
      persistWatchlistLocalOnly();
      if (ids) {
        for (const id of ids) queueItemCloudUpsert(id);
      }
    }, 2000);
  }

  function setBulkCommitButtonLoading(loading, { current = 0, total = 0 } = {}, options = {}) {
    bulkImportCommitBusy = loading;
    // Silent auto-commits shouldn't flicker the "Add to watchlist" button —
    // that button is only meaningful for a manual click, so leave its DOM
    // alone when the commit is happening automatically in the background.
    if (options.silent) return;
    const btn = els.bulkImportConfirm;
    if (!btn) return;
    if (loading) {
      btn.hidden = false;
      btn.disabled = true;
      btn.classList.add("btn--loading");
      btn.setAttribute("aria-busy", "true");
      btn.textContent =
        total > 0
          ? t("bulk.addingProgress", { current, total })
          : t("btn.adding");
    } else {
      btn.classList.remove("btn--loading");
      btn.removeAttribute("aria-busy");
    }
  }

  function setBulkActionButtonLoading(button, loading, labelKey) {
    if (!button) return;
    if (loading) {
      if (!button.dataset.defaultLabel) {
        button.dataset.defaultLabel = button.textContent.trim();
      }
      button.disabled = true;
      button.classList.add("btn--loading");
      button.setAttribute("aria-busy", "true");
      if (labelKey) button.textContent = t(labelKey);
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
    cloudShrinkPushAllowed = true;
    state.items = state.items.filter((i) => i.id !== id);
    delete state.watched[id];
    saveWatched();
    state.data = itemsToNested(state.items);
    saveData();
  }

  function removeCardFromDom(id) {
    if (!id || !els.main) return;
    const card = els.main.querySelector(`.card[data-id="${CSS.escape(id)}"]`);
    if (!card) return;
    const section = card.closest(".genre-section");
    card.remove();
    if (section && !section.querySelector(".card")) {
      section.remove();
    }
  }

  function deleteAndRender(id) {
    if (!id) return;
    deleteItem(id);
    if (window.WatchlistTitleDetail?.activeItemId?.() === id) {
      window.WatchlistTitleDetail.close();
    }
    removeCardFromDom(id);
    updateGenreOptions();
    updateStats();
    render();
  }

  async function copyBulkTemplate() {
    const template = window.WatchlistBulkTitles?.buildTemplate();
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

  let bulkProgressTimer = null;

  function formatImportRetryClock(retryAt) {
    if (!retryAt) return "";
    try {
      return new Date(retryAt).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return "";
    }
  }

  function bulkImportPersistenceMessage(listId, job) {
    const storeMsg =
      window.WatchlistImportJobStore?.getPersistenceFailure?.(listId)?.userMessage || "";
    if (storeMsg) return storeMsg;
    if (job?.persistenceError) return job.persistenceError;
    return "";
  }

  /** Anime titles added via the offline-first fast path (see import-job.js
   * finalizeMatchPick) still need a background AniList pass for a better
   * poster + badges/genres (queueImportedItemEnrichment). That work keeps
   * running after the match queue itself goes idle, so the bulk import
   * progress line needs its own "still finishing details" note independent
   * of whether the match queue is processing. */
  function countPendingEnrichmentItems() {
    return state.items.reduce((n, item) => (item.enrichmentPending ? n + 1 : n), 0);
  }

  function updateBulkImportProgressLine(job, items) {
    if (!els.bulkImportProgress) return;
    const IJ = window.WatchlistImportJob;
    const listId = state.activeListId || job?.listId;
    const pendingEnrichment = countPendingEnrichmentItems();
    const finishingSuffix = pendingEnrichment
      ? ` ${t("bulk.finishingDetails", { count: pendingEnrichment })}`
      : "";
    const setLine = (text) => {
      els.bulkImportProgress.textContent = text ? `${text}${finishingSuffix}` : text;
    };

    const persistenceMessage = bulkImportPersistenceMessage(listId, job);
    if (persistenceMessage || IJ?.isImportPersistenceBlocked?.(listId)) {
      els.bulkImportProgress.hidden = false;
      els.bulkImportProgress.textContent =
        persistenceMessage || t("bulk.persistenceFailed");
      return;
    }
    const stats = job?.stats || IJ?.recomputeStats(items);
    const hasWaiting = (stats.waiting || 0) > 0;
    const processing = job?.status === "processing" || IJ?.isWorkerActive?.();
    const paused = job?.status === "paused" || job?.paused;
    const showProgress =
      processing || paused || hasWaiting || job?.retryProgress || pendingEnrichment > 0;
    els.bulkImportProgress.hidden = !showProgress;
    if (!showProgress) return;

    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      els.bulkImportProgress.textContent = t("bulk.queueOffline");
      return;
    }

    if (paused) {
      const persistenceMessage = bulkImportPersistenceMessage(
        state.activeListId || job?.listId,
        job
      );
      els.bulkImportProgress.textContent =
        persistenceMessage || t("bulk.jobPaused");
      return;
    }

    const queueStatus = IJ?.formatQueueStatusLine?.(items, job);
    const progress = queueStatus?.progress || IJ?.formatQueueProgress?.(items) || {
      resolved: 0,
      submitted: 0,
      due: 0,
    };

    if (queueStatus?.kind === "anilist_paused") {
      setLine(
        t("bulk.anilistPaused", {
          time: formatImportRetryClock(queueStatus.resumeAt),
          // Use "resolved" (added + matched + skipped + needs-attention), not the
          // raw "matched-but-not-yet-added" count — with auto-add on, items move
          // to "added" almost immediately, so "matched" alone sits near 0 even
          // while the offline index/AniList are actively resolving titles.
          matched: progress.resolved,
          total: progress.submitted,
          remaining: progress.remainingAnime ?? 0,
        })
      );
      return;
    }

    if (job?.retryProgress) {
      setLine(
        t("bulk.retryProgress", {
          label: job.retryProgress.label,
          current: job.retryProgress.current,
          total: job.retryProgress.total,
        })
      );
      return;
    }

    if (job?.workerLabel) {
      setLine(job.workerLabel);
      return;
    }

    if (queueStatus?.kind === "waiting" && queueStatus.detail) {
      const { detail } = queueStatus;
      setLine(
        t("bulk.waitingRetryIn", {
          provider: detail.provider || "provider",
          seconds: detail.countdown || "…",
          time: formatImportRetryClock(detail.nextRetryAt),
          resolved: progress.resolved,
          total: progress.submitted,
        })
      );
      return;
    }

    if (queueStatus?.kind === "stalled" && progress.due > 0) {
      setLine(
        t("bulk.queueStalled", {
          due: progress.due,
          resolved: progress.resolved,
          total: progress.submitted,
        })
      );
      return;
    }

    if (processing || hasWaiting) {
      if ((progress.remainingAnime ?? 0) > 0) {
        setLine(
          t("bulk.matchProgress", {
            matched: progress.resolved,
            total: progress.submitted,
            remaining: progress.remainingAnime,
          })
        );
      } else {
        setLine(
          t("bulk.queueResolved", {
            resolved: progress.resolved,
            total: progress.submitted,
          })
        );
      }
      return;
    }

    if (pendingEnrichment > 0) {
      els.bulkImportProgress.textContent = t("bulk.finishingDetailsOnly", {
        count: pendingEnrichment,
      });
      return;
    }

    els.bulkImportProgress.textContent = "";
  }

  function ensureBulkProgressTicker() {
    if (bulkProgressTimer) return;
    bulkProgressTimer = window.setInterval(() => {
      if (!els.bulkImportPreview || els.bulkImportPreview.hidden) {
        window.clearInterval(bulkProgressTimer);
        bulkProgressTimer = null;
        return;
      }
      const listId = state.activeListId;
      const IJ = window.WatchlistImportJob;
      if (!listId || !IJ?.loadJob) return;
      updateBulkImportProgressLine(IJ.loadJob(listId), IJ.loadItems(listId));
    }, 1000);
  }

  function stopBulkProgressTicker() {
    if (!bulkProgressTimer) return;
    window.clearInterval(bulkProgressTimer);
    bulkProgressTimer = null;
  }

  function bulkImportTypeLabel(contentType) {
    if (contentType === "movies") return t("bulk.type.movies");
    if (contentType === "tvSeries") return t("bulk.type.tvSeries");
    if (contentType === "anime") return t("bulk.type.anime");
    return "";
  }

  function bulkImportRowStatusLabel(row) {
    const IJ = window.WatchlistImportJob;
    if (IJ?.isTypeCorrectedFromAnime?.(row)) {
      return t("bulk.status.corrected");
    }
    if (row?.franchiseMember && row.duplicateSourceTitle) {
      if (row.groupedUnderWatchlistId) {
        return t("bulk.willBeAddedInside", { parent: row.duplicateSourceTitle });
      }
      return t("bulk.groupedUnderParent", { parent: row.duplicateSourceTitle });
    }
    return bulkImportJobStatusLabel(row.status);
  }

  function bulkImportJobStatusLabel(status) {
    const S = window.WatchlistImportJob?.STATUS;
    if (!S) return status;
    const map = {
      [S.pending]: "bulk.status.pending",
      [S.processing]: "bulk.status.processing",
      [S.exact_match]: "bulk.status.exact",
      [S.possible_match]: "bulk.status.possible",
      [S.duplicate]: "bulk.status.duplicate",
      [S.grouped]: "bulk.status.grouped",
      [S.not_found]: "bulk.status.notFound",
      [S.invalid]: "bulk.status.invalid",
      [S.failed]: "bulk.status.failed",
      [S.ready_to_add]: "bulk.status.ready",
      [S.added]: "bulk.status.added",
      [S.cancelled]: "bulk.status.cancelled",
      [S.waiting_retry]: "bulk.status.waiting",
      [S.ready]: "bulk.status.ready",
      [S.needs_attention]: "bulk.status.failed",
    };
    return t(map[status] || "bulk.status.pending");
  }

  function bulkImportJobStatusClass(status, row) {
    const S = window.WatchlistImportJob?.STATUS;
    if (row && window.WatchlistImportJob?.isTypeCorrectedFromAnime?.(row)) {
      return "bulk-import-preview__status--failed";
    }
    if (status === S?.ready_to_add || status === S?.exact_match) {
      return "bulk-import-preview__status--ready";
    }
    if (status === S?.failed) return "bulk-import-preview__status--failed";
    if (status === S?.not_found) return "bulk-import-preview__status--not-found";
    if (status === S?.possible_match || status === S?.processing || status === S?.pending) {
      return "bulk-import-preview__status--pending";
    }
    if (status === S?.duplicate || status === S?.grouped) {
      return "bulk-import-preview__status--duplicate";
    }
    if (status === S?.invalid) {
      return "bulk-import-preview__status--invalid";
    }
    if (status === S?.added) return "bulk-import-preview__status--added";
    return "bulk-import-preview__status--pending";
  }

  function bulkImportRowClass(row) {
    const S = window.WatchlistImportJob?.STATUS;
    const parts = ["bulk-import-preview__row"];
    if (row.id === bulkImportExpandedRowId) parts.push("is-expanded");
    if (row.status === S?.failed) parts.push("bulk-import-preview__row--failed");
    if (row.status === S?.not_found) parts.push("bulk-import-preview__row--not-found");
    return parts.join(" ");
  }

  function bulkImportFilterLabel(filter) {
    const map = {
      all: "bulk.filter.all",
      submitted: "bulk.jobSubmitted",
      ready: "bulk.jobReady",
      needs_attention: "bulk.jobNeedsAttention",
      duplicates: "bulk.jobDuplicates",
      processing: "bulk.jobProcessing",
      waiting: "bulk.jobWaiting",
      grouped: "bulk.jobGrouped",
      corrected: "bulk.jobCorrected",
      other: "bulk.jobOther",
      added: "bulk.jobAdded",
    };
    return t(map[filter] || "bulk.filter.all");
  }

  function renderBulkImportStatBoxes(stats, activeFilter) {
    const boxes = [
      { filter: "submitted", label: "bulk.jobSubmitted", count: stats.submitted },
      { filter: "ready", label: "bulk.jobReady", count: stats.ready },
      {
        filter: "needs_attention",
        label: "bulk.jobNeedsAttention",
        count: stats.needsAttention || 0,
      },
      {
        filter: "grouped",
        label: "bulk.jobGrouped",
        count: stats.grouped || 0,
      },
      {
        filter: "duplicates",
        label: "bulk.jobDuplicates",
        count: stats.duplicates || 0,
      },
      { filter: "added", label: "bulk.jobAdded", count: stats.added },
    ];
    if (stats.processing) {
      boxes.push({
        filter: "processing",
        label: "bulk.jobProcessing",
        count: stats.processing,
      });
    }
    if (stats.waiting) {
      boxes.push({
        filter: "waiting",
        label: "bulk.jobWaiting",
        count: stats.waiting,
      });
    }
    if (stats.other) {
      boxes.push({
        filter: "other",
        label: "bulk.jobOther",
        count: stats.other,
      });
    }
    if (stats.corrected) {
      boxes.push({
        filter: "corrected",
        label: "bulk.jobCorrected",
        count: stats.corrected,
      });
    }
    return boxes
      .map(({ filter, label, count }) => {
        const isActive =
          activeFilter === filter ||
          (filter === "submitted" && activeFilter === "all" && false);
        return `
      <button
        type="button"
        class="bulk-import-preview__stat${isActive ? " is-active" : ""}"
        data-import-filter="${filter}"
        aria-pressed="${isActive ? "true" : "false"}"
      >
        <span class="bulk-import-preview__stat-label">${escapeHtml(t(label))}</span>
        <span class="bulk-import-preview__stat-value">${count}</span>
      </button>`;
      })
      .join("");
  }

  function renderImportTypeCell(row, IJ) {
    const needsAttention = IJ?.isPermanentUnresolved?.(row);
    const typeNote = IJ?.formatTypeCorrectionNote?.(row) || "";
    const label = bulkImportTypeLabel(row.contentType);
    const isEditing = bulkImportTypeEditId === row.id;

    if (isEditing && needsAttention) {
      return `<td class="bulk-import-preview__cell-type" data-import-type-cell="${escapeHtml(row.id)}">
        <div class="bulk-import-preview__type-edit">
          <select class="bulk-import-preview__type-select" data-import-change-type="${escapeHtml(row.id)}" aria-label="${escapeHtml(t("bulk.changeType"))}">
            <option value="movies"${row.contentType === "movies" ? " selected" : ""}>${escapeHtml(t("bulk.type.movies"))}</option>
            <option value="tvSeries"${row.contentType === "tvSeries" ? " selected" : ""}>${escapeHtml(t("bulk.type.tvSeries"))}</option>
            <option value="anime"${row.contentType === "anime" ? " selected" : ""}>${escapeHtml(t("bulk.type.anime"))}</option>
          </select>
          <div class="bulk-import-preview__type-edit-actions">
            <button type="button" class="btn btn--ghost btn--sm" data-import-apply-type="${escapeHtml(row.id)}">${escapeHtml(t("bulk.changeTypeApply"))}</button>
            <button type="button" class="btn btn--ghost btn--sm" data-import-cancel-type="${escapeHtml(row.id)}">${escapeHtml(t("btn.cancel"))}</button>
          </div>
        </div>
      </td>`;
    }

    const typeBtn = needsAttention
      ? `<button type="button" class="bulk-import-preview__type-btn" data-import-type-toggle="${escapeHtml(row.id)}">${escapeHtml(label)}</button>`
      : `<span>${escapeHtml(label)}</span>`;
    const note = typeNote
      ? `<span class="bulk-import-preview__type-note">${escapeHtml(typeNote)}</span>`
      : "";
    return `<td class="bulk-import-preview__cell-type" data-import-type-cell="${escapeHtml(row.id)}">${typeBtn}${note}</td>`;
  }

  function replaceImportTypeCell(rowId, item) {
    if (!els.bulkImportTableBody || !item || !rowId) return;
    const IJ = window.WatchlistImportJob;
    const row = els.bulkImportTableBody.querySelector(
      `[data-import-row="${CSS.escape(rowId)}"]`
    );
    if (!row) return;
    const typeCell = row.querySelector(".bulk-import-preview__cell-type");
    if (!typeCell) return;
    const tpl = document.createElement("template");
    tpl.innerHTML = renderImportTypeCell(item, IJ).trim();
    const newCell = tpl.content.firstElementChild;
    if (newCell) typeCell.replaceWith(newCell);
  }

  function openImportTypeEditor(itemId) {
    if (!itemId) return;
    bulkImportTypeEditId = itemId;
    const listId = state.activeListId;
    const IJ = window.WatchlistImportJob;
    if (!listId || !IJ) return;
    const item = IJ.loadItems(listId)?.[itemId];
    if (!item) return;
    replaceImportTypeCell(itemId, item);
    const select = els.bulkImportTableBody?.querySelector(
      `[data-import-change-type="${CSS.escape(itemId)}"]`
    );
    select?.focus?.();
  }

  function closeImportTypeEditor(itemId) {
    bulkImportTypeEditId = null;
    const listId = state.activeListId;
    const IJ = window.WatchlistImportJob;
    if (!listId || !IJ || !itemId) return;
    const item = IJ.loadItems(listId)?.[itemId];
    if (item) replaceImportTypeCell(itemId, item);
  }

  function restoreImportTypeEditorIfOpen(items) {
    if (!bulkImportTypeEditId || !items) return;
    const item = items[bulkImportTypeEditId];
    if (item) replaceImportTypeCell(bulkImportTypeEditId, item);
  }

  function renderImportRowExpandedDetail(row, IJ) {
    const S = IJ?.STATUS;
    const parts = [];
    if (IJ?.isDuplicateRow?.(row)) {
      const dupLabel = IJ.formatDuplicateCategory?.(row.duplicateCategory) || row.error;
      const onWatchlist = row.duplicateCategory === IJ?.DUPLICATE_CATEGORY?.on_watchlist;
      parts.push(
        `<p><strong>${escapeHtml(t("bulk.dupHeading"))}</strong> ${escapeHtml(dupLabel)}</p>`
      );
      if (row.duplicateSourceTitle) {
        parts.push(
          `<p>${escapeHtml(t("bulk.dupMatchedAgainst"))}: ${escapeHtml(ltr(row.duplicateSourceTitle))}</p>`
        );
      }
      const provider =
        row.lastProvider || IJ?.providerForItem(row) || row.providerKey || "—";
      parts.push(
        `<p>${escapeHtml(t("bulk.dupProvider"))}: ${escapeHtml(provider)}${row.providerKey ? ` · ${escapeHtml(row.providerKey)}` : ""}</p>`
      );
      parts.push(
        `<p>${escapeHtml(t("bulk.dupWatchlistState"))}: ${escapeHtml(
          onWatchlist ? t("bulk.dupOnWatchlist") : t("bulk.dupImportOnly")
        )}</p>`
      );
    }

    const originalType = row.originalType || row.contentType;
    const correctedType = row.correctedType;
    if (originalType || correctedType) {
      parts.push(
        `<p>${escapeHtml(t("bulk.typeOriginal"))}: ${escapeHtml(bulkImportTypeLabel(originalType))}` +
          (correctedType
            ? ` · ${escapeHtml(t("bulk.typeCorrected"))}: ${escapeHtml(bulkImportTypeLabel(correctedType))}`
            : "") +
          `</p>`
      );
    }

    if (row.typeConflictAmbiguous || row.typeConflictAnime || row.typeConflictTv) {
      const conflictLines = [];
      parts.push(`<p><strong>Imported type:</strong> ${escapeHtml(bulkImportTypeLabel(originalType))}</p>`);
      if (row.typeConflictAnime) {
        const a = row.typeConflictAnime;
        const lookup = a.lookupState || (a.anilistId ? "found" : "not found");
        conflictLines.push(
          `<li><strong>Anime candidate:</strong> ${escapeHtml(lookup)}` +
            ` · ${escapeHtml(a.provider || "AniList")}` +
            (a.anilistId ? ` · AniList ${escapeHtml(String(a.anilistId))}` : "") +
            (a.score != null ? ` · score ${escapeHtml(String(a.score))}` : "") +
            (a.title ? ` · ${escapeHtml(ltr(a.title))}` : "") +
            `</li>`
        );
      } else {
        conflictLines.push(`<li><strong>Anime candidate:</strong> not found</li>`);
      }
      if (row.typeConflictTv) {
        const tv = row.typeConflictTv;
        conflictLines.push(
          `<li><strong>TMDb candidate:</strong> found` +
            (tv.tmdbId ? ` · TMDb ${escapeHtml(String(tv.tmdbId))}` : "") +
            (tv.score != null ? ` · score ${escapeHtml(String(tv.score))}` : "") +
            (tv.title ? ` · ${escapeHtml(ltr(tv.title))}` : "") +
            `</li>`
        );
      }
      if (conflictLines.length) {
        const decision =
          row.typeConflictReason === "anime_lookup_waiting"
            ? "Retry anime lookup"
            : "Review needed";
        parts.push(
          `<p><strong>Type conflict</strong> · ${escapeHtml(row.typeConflictReason || "anime_tv_type_conflict")}</p>` +
            `<ul>${conflictLines.join("")}</ul>` +
            `<p><strong>Decision:</strong> ${escapeHtml(decision)}</p>`
        );
      }
    }

    if (IJ?.isPermanentUnresolved?.(row)) {
      parts.push(
        `<p class="bulk-import-preview__type-hint">${escapeHtml(t("bulk.changeTypeHint"))}</p>`
      );
    }

    const history = (row.retryHistory || [])
      .slice(-4)
      .map(
        (h) =>
          `<li>${escapeHtml(h.message || h.kind || "")}${h.retries ? ` (${h.retries})` : ""}</li>`
      )
      .join("");
    if (row.error && !IJ?.isDuplicateRow?.(row)) {
      parts.push(`<p>${escapeHtml(row.error)}</p>`);
    }
    if (history) parts.push(`<ul>${history}</ul>`);
    return parts.join("");
  }

  function updateImportPreviewChrome(job, items, stats, allRows) {
    const IJ = window.WatchlistImportJob;
    const S = IJ?.STATUS;
    const processing = job.status === "processing" || IJ?.isWorkerActive?.();
    const paused = job.status === "paused" || job.paused;
    const hasWaiting = (stats.waiting || 0) > 0;
    const needsAttention = stats.needsAttention || 0;
    const eligibleCount = IJ?.countCommitEligible?.(items) ?? stats.ready ?? 0;
    const canAdd = eligibleCount > 0 && !bulkImportCommitBusy;
    const queueProgress = IJ?.formatQueueProgress?.(allRows) || {
      due: 0,
      waiting: hasWaiting ? stats.waiting : 0,
    };
    // Nothing left for the queue to do automatically: not actively processing,
    // nothing waiting on a retry timer, and nothing due/queued right now.
    const jobDone =
      !processing &&
      !bulkImportWorkerBusy &&
      !hasWaiting &&
      queueProgress.due === 0 &&
      (stats.processing || 0) === 0;

    updateBulkImportProgressLine(job, items);
    // Keep the ticker alive while background enrichment is still finishing
    // cards (see queueImportedItemEnrichment) even after the match queue
    // itself has gone idle, so the "finishing details for N…" count stays
    // live instead of freezing at whatever it was when matching stopped.
    if (hasWaiting || processing || countPendingEnrichmentItems() > 0) {
      ensureBulkProgressTicker();
    } else {
      stopBulkProgressTicker();
    }

    if (els.bulkImportContinue) {
      const queued = stats.processing || 0;
      // Only offer "Continue processing" when the worker has actually
      // stopped — a title merely sitting in a retry-wait state (normal,
      // automatic) is not a reason to show a manual restart button while
      // the queue is still actively running on its own.
      const showContinue =
        !paused &&
        !processing &&
        !bulkImportWorkerBusy &&
        typeof navigator !== "undefined" &&
        navigator.onLine !== false &&
        (queued > 0 || hasWaiting || queueProgress.due > 0);
      els.bulkImportContinue.hidden = !showContinue;
      els.bulkImportContinue.disabled = bulkImportWorkerBusy;
    }

    if (els.bulkImportToolbar) els.bulkImportToolbar.hidden = true;
    if (els.bulkImportResolve) {
      els.bulkImportResolve.hidden = needsAttention === 0;
      els.bulkImportResolve.disabled = bulkImportWorkerBusy;
    }
    if (els.bulkImportAdvanced) {
      els.bulkImportAdvanced.hidden = needsAttention === 0 && !hasWaiting;
    }

    // "Add to watchlist" is only for leftovers after the job is idle —
    // e.g. a needs-attention row you just fixed. While matching/auto-add
    // is running, ready rows are committed silently; showing a count button
    // here just looks like a stuck second step.
    const confirmShowingOwnLoadingState =
      els.bulkImportConfirm?.classList.contains("btn--loading");
    const showManualAdd = jobDone && canAdd;
    if (els.bulkImportConfirm && !confirmShowingOwnLoadingState) {
      els.bulkImportConfirm.hidden = !showManualAdd;
      els.bulkImportConfirm.disabled = !showManualAdd;
      els.bulkImportConfirm.setAttribute("aria-disabled", String(!showManualAdd));
      if (showManualAdd) {
        els.bulkImportConfirm.textContent = t("bulk.addVerifiedCount", { count: eligibleCount });
        els.bulkImportConfirm.title = "";
      }
    }
    if (els.bulkImportEndJob) {
      els.bulkImportEndJob.hidden = !jobDone || showManualAdd || confirmShowingOwnLoadingState;
    }
  }

  // The worker fires a change event for every single title it resolves
  // (potentially hundreds of times over a long bulk import). Rebuilding the
  // whole preview table + stat boxes on every one of those was the main
  // cause of the UI becoming unresponsive (and, over many minutes, crashing)
  // during active processing. Coalesce bursts of updates into at most ~1-2
  // renders per second, always using the freshest job/items when it fires.
  function scheduleImportPreviewRenderThrottled(listId, job, items, options) {
    const now = Date.now();
    const elapsed = now - bulkImportPreviewRenderLastAt;
    if (elapsed >= BULK_IMPORT_PREVIEW_RENDER_MIN_GAP_MS) {
      bulkImportPreviewRenderLastAt = now;
      renderImportJobPreview(job, items, options);
      return;
    }
    if (bulkImportPreviewRenderTimer) return;
    bulkImportPreviewRenderTimer = window.setTimeout(() => {
      bulkImportPreviewRenderTimer = null;
      bulkImportPreviewRenderLastAt = Date.now();
      const IJ = window.WatchlistImportJob;
      if (listId !== state.activeListId) return;
      if (!els.bulkImportPreview || els.bulkImportPreview.hidden) return;
      const latestJob = IJ?.loadJob(listId) || job;
      const latestItems = IJ?.loadItems(listId) || items;
      renderImportJobPreview(latestJob, latestItems, options);
    }, BULK_IMPORT_PREVIEW_RENDER_MIN_GAP_MS - elapsed);
  }

  function renderImportJobPreview(job, items, { preserveTypeEditor = false } = {}) {
    if (!job || !els.bulkImportSummary || !els.bulkImportTableBody) return;
    const IJ = window.WatchlistImportJob;
    IJ._helpers.isOnList = isTitleOnWatchlist;
    IJ._helpers.getWatchlistAnime = getWatchlistAnimeItems;
    IJ._helpers.findWatchlistFranchiseDuplicate = findWatchlistFranchiseDuplicateForImport;
    IJ._helpers.getWatchlistFranchiseLookup = getWatchlistFranchiseLookupForImport;
    const stats = job.stats || IJ?.recomputeStats(items);
    const S = IJ?.STATUS;
    const allRows = Object.values(items || {});
    let filteredRows = IJ?.filterRowsByPreviewFilter(allRows, bulkImportStatusFilter) || allRows;
    filteredRows = IJ?.filterRowsBySearch?.(filteredRows, bulkImportSearchQuery) || filteredRows;
    let rows = IJ?.sortPreviewRows(filteredRows) || filteredRows;
    const PREVIEW_ROW_CAP = 80;
    const truncated = rows.length > PREVIEW_ROW_CAP;
    if (truncated) rows = rows.slice(0, PREVIEW_ROW_CAP);

    els.bulkImportSummary.innerHTML = renderBulkImportStatBoxes(
      stats,
      bulkImportStatusFilter
    );

    if (els.bulkImportAccounting) {
      const accountingLine = IJ?.formatAccountingLine?.(stats) || "";
      els.bulkImportAccounting.hidden = !accountingLine;
      els.bulkImportAccounting.textContent = accountingLine;
    }

    const persistenceMessage = bulkImportPersistenceMessage(
      state.activeListId || job?.listId,
      job
    );
    if (els.bulkImportPersistenceError) {
      els.bulkImportPersistenceError.hidden = !persistenceMessage;
      els.bulkImportPersistenceError.textContent = persistenceMessage || "";
    }

    const filterLabel = bulkImportFilterLabel(
      bulkImportStatusFilter === "all" ? "all" : bulkImportStatusFilter
    );
    const headingText =
      bulkImportStatusFilter === "all"
        ? t("bulk.filter.allCount", { count: rows.length })
        : t("bulk.filter.statusCount", { status: filterLabel, count: rows.length });

    if (els.bulkImportFilterHeading) {
      els.bulkImportFilterHeading.textContent = headingText;
    }
    if (els.bulkImportSearchClear) {
      els.bulkImportSearchClear.hidden = !String(bulkImportSearchQuery || "").trim();
    }

    if (preserveTypeEditor) {
      updateImportPreviewChrome(job, items, stats, allRows);
      restoreImportTypeEditorIfOpen(items);
      return;
    }

    els.bulkImportTableBody.innerHTML = rows
      .map((row) => {
        const statusLabel = bulkImportRowStatusLabel(row);
        const statusClass = bulkImportJobStatusClass(row.status, row);
        const matchTitle = row.details?.title
          ? `<span class="bulk-import-preview__match">${escapeHtml(ltr(row.details.title))}</span>`
          : "";
        const reason = IJ?.humanizeFailureReason(row) || row.error || "";
        const provider =
          row.lastProvider ||
          IJ?.providerForItem(row) ||
          (row.status === S?.ready_to_add || row.status === S?.added
            ? IJ?.providerForItem(row)
            : "");
        const yearText =
          row.year != null && Number.isFinite(row.year)
            ? escapeHtml(String(row.year))
            : escapeHtml(t("bulk.yearUnknown"));
        const isWaiting = IJ?.isWaitingItem?.(row);
        const isQueued =
          row.status === S?.pending && !isWaiting && row.status !== S?.processing;
        const needsAttention = IJ?.isPermanentUnresolved?.(row);
        const showReason =
          needsAttention || isWaiting || isQueued || row.status === S?.invalid;
        let reasonCell = "—";
        if (showReason) {
          if (isQueued && !needsAttention) {
            reasonCell = escapeHtml(t("bulk.status.matching"));
          } else if (isWaiting && !needsAttention && IJ?.formatWaitingItemDetail) {
            const detail = IJ.formatWaitingItemDetail(row);
            const parts = [
              t("bulk.waitingRowDetail", {
                provider: detail.provider || "—",
                retries: detail.retries,
                reason: detail.reason || "—",
              }),
            ];
            if (detail.countdown) {
              parts.push(t("bulk.waitingRowCountdown", { seconds: detail.countdown }));
            }
            if (detail.nextRetryAt) {
              parts.push(formatImportRetryClock(detail.nextRetryAt));
            }
            reasonCell = escapeHtml(parts.join(" · "));
          } else {
            reasonCell = escapeHtml(reason || "—");
          }
        } else if (row.franchiseMember && row.duplicateSourceTitle) {
          reasonCell = escapeHtml(
            row.groupedUnderWatchlistId
              ? t("bulk.willBeAddedInside", { parent: row.duplicateSourceTitle })
              : t("bulk.groupedUnderParent", { parent: row.duplicateSourceTitle })
          );
        } else if (row.details?.title) {
          reasonCell = escapeHtml(t("bulk.matchedOk"));
        }
        const expanded = row.id === bulkImportExpandedRowId;
        const detailBody = expanded ? renderImportRowExpandedDetail(row, IJ) : "";
        const detailRow =
          expanded && detailBody
            ? `<tr class="bulk-import-preview__row-detail"><td colspan="6"><div class="bulk-import-preview__row-detail-body">${detailBody}</div></td></tr>`
            : "";

        const typeCorrectionNote = IJ?.formatTypeCorrectionNote?.(row);
        const titleExtra = typeCorrectionNote
          ? `<span class="bulk-import-preview__type-note bulk-import-preview__type-note--inline">${escapeHtml(typeCorrectionNote)}</span>`
          : "";

        return `
          <tr class="${bulkImportRowClass(row)}" data-import-row="${escapeHtml(row.id)}" tabindex="0" role="button" aria-expanded="${expanded ? "true" : "false"}">
            <td class="bulk-import-preview__cell-title">${escapeHtml(ltr(row.title || "—"))}${matchTitle}${titleExtra}</td>
            <td>${yearText}</td>
            ${renderImportTypeCell(row, IJ)}
            <td><span class="bulk-import-preview__status ${statusClass}">${escapeHtml(statusLabel)}</span></td>
            <td>${escapeHtml(provider || "—")}</td>
            <td class="bulk-import-preview__cell-reason">${reasonCell}</td>
          </tr>
          ${detailRow}
        `;
      })
      .join("");

    if (truncated) {
      els.bulkImportTableBody.insertAdjacentHTML(
        "beforeend",
        `<tr class="bulk-import-preview__row-detail"><td colspan="6"><div class="bulk-import-preview__row-detail-body">${escapeHtml(
          t("bulk.previewTruncated", { shown: PREVIEW_ROW_CAP, total: filteredRows.length })
        )}</div></td></tr>`
      );
    }

    restoreImportTypeEditorIfOpen(items);

    updateImportPreviewChrome(job, items, stats, allRows);
  }

  function queueCastBackfillForImportAdds(listId) {
    const IJ = window.WatchlistImportJob;
    const items = IJ?.loadItems?.(listId);
    if (!items) return;
    const addedStatus = IJ?.STATUS?.added;
    for (const row of Object.values(items)) {
      if (row.status !== addedStatus || !row.watchlistItemId) continue;
      const watchItem = state.items.find((entry) => entry.id === row.watchlistItemId);
      if (!watchItem || watchItem.leads?.length) continue;
      if (!watchItem.tmdbId && !watchItem.imdbId && !watchItem.anilistId) continue;
      queueImportedItemEnrichment(row.watchlistItemId);
    }
  }

  function isImportAuditDebugEnabled() {
    try {
      return localStorage.getItem("watchlist-debug-import-audit") === "1";
    } catch {
      return false;
    }
  }

  function probePosterImageLoad(url) {
    return new Promise((resolve) => {
      const trimmed = String(url || "").trim();
      if (!trimmed) {
        resolve({ result: "no_url", url: "", errorUrl: "" });
        return;
      }
      const img = new Image();
      let settled = false;
      const finish = (loaded) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        img.onload = null;
        img.onerror = null;
        img.src = "";
        resolve({
          result: loaded ? "loaded" : "error",
          url: trimmed,
          errorUrl: loaded ? "" : trimmed,
        });
      };
      const timer = setTimeout(() => finish(false), 8000);
      img.onload = () => finish(true);
      img.onerror = () => finish(false);
      img.src = trimmed;
    });
  }

  async function logBulkPosterRootCause(row, rootCause, item, extra = {}) {
    if (!isBulkPosterTraceTitle(row?.title || rootCause?.title)) return null;
    const saved = state.items.find((entry) => entry.id === item?.id) || item;
    const displayUrl = saved ? cardDisplayPoster(saved) : "";
    const probe = displayUrl
      ? await probePosterImageLoad(displayUrl)
      : { result: "no_url", url: "", errorUrl: "" };
    let failingStage = rootCause?.failingStage || "";
    if (!failingStage) {
      if (!rootCause?.liveCoverFetchRan) failingStage = "A";
      else if (!rootCause?.rawCoverImageExtraLarge && !rootCause?.rawCoverImageLarge && !rootCause?.rawCoverImageMedium) {
        failingStage = "B";
      } else if (!rootCause?.selectedPosterBeforeFinalBuild) failingStage = "G";
      else if (!item?.poster) failingStage = "C";
      else if (!saved?.poster) failingStage = "D";
      else if (displayUrl && saved?.poster && displayUrl !== saved.poster) failingStage = "F";
      else if (probe.result === "error") failingStage = "G";
      else if (!displayUrl && saved?.poster) failingStage = "E";
    }
    return {
      title: rootCause?.title || row?.title || "",
      importedType: rootCause?.importedType || row?.contentType || "",
      resolvedAnilistId: rootCause?.resolvedAnilistId ?? row?.pick?.anilistId ?? null,
      providerCacheKey: rootCause?.providerCacheKey || "",
      providerCachePosterBeforeFetch: rootCause?.providerCachePosterBefore || "",
      providerCacheCoverExtraLargeBefore: rootCause?.providerCacheCoverExtraLargeBefore || "",
      providerCacheCoverLargeBefore: rootCause?.providerCacheCoverLargeBefore || "",
      providerCacheCoverMediumBefore: rootCause?.providerCacheCoverMediumBefore || "",
      liveCoverFetchRan: rootCause?.liveCoverFetchRan ? "yes" : "no",
      liveAnilistOperation: rootCause?.liveAnilistOperation || "",
      liveAnilistRequestUrl: rootCause?.liveAnilistRequestUrl || "",
      liveAnilistResponseStatus: rootCause?.liveAnilistResponseStatus ?? null,
      rawCoverImageExtraLarge: rootCause?.rawCoverImageExtraLarge || "",
      rawCoverImageLarge: rootCause?.rawCoverImageLarge || "",
      rawCoverImageMedium: rootCause?.rawCoverImageMedium || "",
      selectedPosterBeforeFinalBuild: rootCause?.selectedPosterBeforeFinalBuild || "",
      builderFunction: rootCause?.builderFunction || "buildItemFromSearchDetails",
      finalItemPosterBeforeInsert: item?.poster || rootCause?.finalItemPosterBeforeInsert || "",
      finalItemPosterBroken: Boolean(item?.posterBroken),
      rowSavedToLocalStatePoster: saved?.poster || "",
      rowSavedToSupabasePoster: extra.rowSavedToSupabasePoster ?? saved?.poster ?? "",
      cardRendererImageSrc: displayUrl || "",
      imageLoadResult: probe.result,
      imageLoadFailedUrl: probe.errorUrl || "",
      failingStage,
      ...extra,
    };
  }

  async function applyAddedImportTypeCorrections(listId) {
    if (!isImportAuditDebugEnabled()) return null;
    const IJ = window.WatchlistImportJob;
    const WM = window.WatchlistMetadata;
    if (!listId || !IJ?.auditAddedWatchlistTypes) return null;

    const audit = await IJ.auditAddedWatchlistTypes(listId, {
      getWatchlistItem: (id) => state.items.find((entry) => entry.id === id),
      getWatchedState: () => state.watched,
    });
    if (audit?.skipped) return audit;

    const items = IJ.loadItems(listId);
    if (!items) {
      IJ.markAddedTypeCorrectionsApplied?.(listId);
      return audit;
    }

    if (!audit?.actions?.length) {
      IJ.markAddedTypeCorrectionsApplied?.(listId);
      return audit;
    }

    let changed = false;
    const correctedIds = [];

    for (const action of audit.actions) {
      const row = items[action.importRowId];
      const watchItem = state.items.find((entry) => entry.id === action.watchlistItemId);
      if (!row || !watchItem) continue;

      if (action.action === "flag") {
        row.typeReviewRequired = true;
        row.typeConflictAmbiguous = true;
        row.typeCorrectionReason = action.reason || "ambiguous_type_evidence";
        watchItem.typeReviewRequired = true;
        changed = true;
        continue;
      }

      if (action.action !== "correct") continue;

      const fromType = watchItem.contentType;
      const toType = action.toType;
      const importedType = row.originalType || row.contentType;
      if (importedType === "anime" && toType !== "anime") continue;
      if (fromType === "anime" && toType === "tvSeries") continue;
      const pick = action.pick;
      const oldId = watchItem.id;
      const newId = makeId(toType, watchItem.genre, watchItem.title);

      if (newId !== oldId) {
        const dupe = state.items.find((entry) => entry.id === newId && entry.id !== oldId);
        if (dupe) {
          row.typeReviewRequired = true;
          row.typeConflictAmbiguous = true;
          row.typeCorrectionReason = "id_collision_after_type_fix";
          watchItem.typeReviewRequired = true;
          changed = true;
          continue;
        }
      }

      IJ.recordImportTypeCorrection(row, row.originalType || fromType, toType, {
        reason: action.reason,
        provider: action.provider,
        topScore: action.topScore,
        pick,
      });

      watchItem.contentType = toType;
      watchItem.kind = formKindForItem(toType, watchItem.kind);

      if (pick?.anilistId) {
        watchItem.anilistId = pick.anilistId;
        watchItem.link = `https://anilist.co/anime/${pick.anilistId}/`;
      }
      if (pick?.tmdbId) {
        watchItem.tmdbId = pick.tmdbId;
        const mediaType = toType === "movies" ? "movie" : "tv";
        watchItem.link =
          WM?.defaultLinkForDetails?.(
            {
              tmdbId: pick.tmdbId,
              tmdbType: mediaType,
              imdbId: pick.imdbId || watchItem.imdbId,
            },
            toType
          ) || watchItem.link;
      }
      if (pick?.imdbId) watchItem.imdbId = pick.imdbId;

      if (newId !== oldId) {
        watchItem.id = newId;
        if (state.watched[oldId]) {
          state.watched[newId] = state.watched[oldId];
          delete state.watched[oldId];
          saveWatched();
        }
        row.watchlistItemId = newId;
      }

      const lightDetails = WM?.buildLightweightDetailsFromSearchResult?.(pick, toType);
      if (lightDetails) {
        row.details = { ...(row.details || {}), ...lightDetails };
      }

      correctedIds.push(watchItem.id);
      changed = true;
    }

    if (changed) {
      IJ.saveImportItems?.(listId, items);
    state.data = itemsToNested(state.items);
    saveData();
      render();
      for (const id of correctedIds) {
        queueImportedItemEnrichment(id);
      }
    }

    IJ.markAddedTypeCorrectionsApplied?.(listId);
    return audit;
  }

  function showBulkImportPreview(job, items, options = {}) {
    if (!els.bulkAddSteps || !els.bulkImportPreview) return;
    renderImportJobPreview(job, items);
    els.bulkAddSteps.hidden = true;
    els.bulkImportPreview.hidden = false;
    els.modal?.classList.add("modal--bulk-preview");
    if (els.bulkAddPasteFooter) els.bulkAddPasteFooter.hidden = true;
    if (els.bulkImportPreviewFooter) els.bulkImportPreviewFooter.hidden = false;
    syncItemModalViewport();
    syncBulkImportWakeLock(job);

    if (options.skipBackgroundWork) return;

    const listId = state.activeListId || window.WatchlistAuth?.getProfile();
    const IJ = window.WatchlistImportJob;
    const jobActive =
      job &&
      !job.paused &&
      job.status !== "cancelled" &&
      job.status !== "completed";

    // Defer heavy follow-up so the preview paints before franchise work.
    // Do NOT run type-audit here while matching is active — the old path
    // re-searched TMDb for every ready row and logged full pick objects,
    // which is what caused the Out-of-Memory crashes mid-import.
    window.setTimeout(async () => {
      if (listId !== state.activeListId) return;
      if (!els.bulkImportPreview || els.bulkImportPreview.hidden) return;

      // Legacy watchlist anime added before anilistId was persisted on the
      // item (only anilistRating was stored, for the badge) are invisible to
      // every franchise-duplicate check below, since those all key off
      // resolveWatchlistItemAnilistIdSync(). Backfill them once (cheap: only
      // runs the live/offline lookup for items still missing an id, then
      // persists it) so franchise dedup can actually see them.
      try {
        await resolveWatchlistAnimeItems({ allowLive: true, allowOffline: true });
      } catch (error) {
        console.warn("[bulk-import:anilist-id-backfill]", error);
      }
      if (listId !== state.activeListId) return;
      if (!els.bulkImportPreview || els.bulkImportPreview.hidden) return;

      invalidateWatchlistFranchiseLookupCache();
      invalidateWatchlistTitleLookupCache();
      if (listId && IJ?.healDuplicateClassifications) {
        const fresh = IJ.loadItems(listId) || items;
        if (IJ.healDuplicateClassifications(fresh)) {
          job.stats = IJ.recomputeStats(fresh, job);
          IJ.saveImportItems?.(listId, fresh);
          IJ.saveJob?.(listId, job);
          renderImportJobPreview(job, fresh);
        }
      }

      if (jobActive && listId && IJ?.kickImportQueue) {
        IJ.kickImportQueue(listId);
      }

      // Franchise grouping only when the queue is idle — running it on every
      // preview open during a 300+ title import competes with matching.
      if (!jobActive && listId && IJ?.applyAnimeGrouping) {
        void (async () => {
          const fresh = IJ.loadItems(listId) || items;
          await IJ.applyAnimeGrouping(listId, fresh);
          IJ.saveImportItems?.(listId, fresh);
          const latestJob = IJ.loadJob(listId) || job;
          renderImportJobPreview(latestJob, fresh);
        })();
      }

      // Local-only type audit, and only when the job is not actively matching.
      if (!jobActive && listId && IJ?.auditMisclassifiedTypes) {
        void IJ.auditMisclassifiedTypes(listId, { autoRetry: true }).then((audit) => {
          if (audit?.retried > 0) {
            renderImportJobPreview(IJ.loadJob(listId), IJ.loadItems(listId));
          }
        });
      }
      if (!jobActive && listId && isImportAuditDebugEnabled()) {
        void applyAddedImportTypeCorrections(listId).then((audit) => {
          if (audit?.corrected > 0 || audit?.flagged > 0) {
            renderImportJobPreview(IJ.loadJob(listId), IJ.loadItems(listId));
          }
        });
      }

      // Auto-commit anything already confidently matched (including titles left
      // over as "ready to add" from a previous session) so the user doesn't have
      // to take an extra manual step.
      scheduleBulkImportAutoCommit(listId, 300);
    }, 50);
  }

  function hideBulkImportPreview() {
    if (!els.bulkAddSteps || !els.bulkImportPreview) return;
    stopBulkProgressTicker();
    releaseBulkImportWakeLock();
    if (bulkImportPreviewRenderTimer) {
      window.clearTimeout(bulkImportPreviewRenderTimer);
      bulkImportPreviewRenderTimer = null;
    }
    els.bulkAddSteps.hidden = false;
    els.bulkImportPreview.hidden = true;
    els.modal?.classList.remove("modal--bulk-preview");
    if (els.bulkAddPasteFooter) els.bulkAddPasteFooter.hidden = false;
    if (els.bulkImportPreviewFooter) els.bulkImportPreviewFooter.hidden = true;
    syncItemModalViewport();
  }

  async function resumeImportJobUiIfAny() {
    const listId = state.activeListId || window.WatchlistAuth?.getProfile();
    const IJ = window.WatchlistImportJob;
    if (!listId || !IJ?.loadJob) return;

    // Let the Import tab paint first — large leftover jobs can freeze the UI.
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    if (state.addMode !== "bulk" || els.bulkAddPanel?.hidden) return;

    let job = IJ.loadJob(listId);
    let items = IJ.loadItems(listId);
    if (!job || !items || !Object.keys(items).length) {
      const hydrated = (await IJ.hydrateJobDataAsync?.(listId)) || IJ.hydrateJobData?.(listId);
      if (state.addMode !== "bulk" || els.bulkAddPanel?.hidden) return;
      job = hydrated?.job || IJ.loadJob(listId);
      items = hydrated?.items || IJ.loadItems(listId);
    }
    if (!job || !items || !Object.keys(items).length) return;

    const rowCount = Object.keys(items).length;
    const stats = IJ.recomputeStats?.(items) || job.stats || {};
    job.stats = stats;

    // An unfinished/unclosed job should always resume into the processing/preview
    // display rather than dropping the user back to the 3-step paste screen. Use
    // "End import job" (handleBulkImportEndJob) to actually close it out.
    IJ.healTransientFailedItems?.(items);

    if (rowCount > 80 && bulkImportStatusFilter === "all") {
      if ((stats.ready || 0) > 0) bulkImportStatusFilter = "ready";
      else if ((stats.needsAttention || 0) > 0) bulkImportStatusFilter = "needs_attention";
      else if ((stats.failed || 0) > 0 || (stats.notFound || 0) > 0) {
        bulkImportStatusFilter = "needs_attention";
      } else {
        bulkImportStatusFilter = "ready";
      }
    }

    showBulkImportPreview(job, items);
  }

  const animePosterRepairFailed = new Set();

  async function buildAnimeWatchlistItemForAdd(row, options = {}) {
    const WM = window.WatchlistMetadata;
    const pick = row.pick;
    const contentType = "anime";

    if (!pick?.anilistId) {
      return { ok: false, reason: "no_identity" };
    }

    const existingPoster = String(row.details?.poster || "").trim();
    const canReuseImportPoster =
      existingPoster && !row.details?.posterPending && !row.details?.posterBroken;

    const rootCause = {
      title: row.title || pick.title || "",
      importedType: row.contentType || contentType,
      resolvedAnilistId: Number(pick.anilistId),
      reusedImportPoster: canReuseImportPoster,
    };

    let details = row.details;
    if (!details?.title) {
      // Never hit live AniList during commit for identity — matching already
      // verified anilistId. Build a minimal card; enrichment fills the rest.
      details =
        WM?.getLightweightDetailsForPick?.(pick, {
          contentType,
          importTitle: row.title,
          year: row.year,
        }) || {
          title: pick.title || row.title || "",
          year: pick.year || row.year || "",
          anilistId: pick.anilistId,
          poster: pick.poster || "",
          source: "anilist",
          contentType: "anime",
        };
    }

    if (!details?.title) {
      return { ok: false, reason: "no_identity", rootCause };
    }

    // Bulk anime matches often arrive with identity (and sometimes a poster
    // from the offline index) but without the full AniList polish yet.
    // Rather than blocking the add on a live AniList poster/detail fetch
    // here — which would compete with the match queue for the same AniList
    // rate limit — accept whatever poster we already have, even none, and
    // let the background enrichment queue (queueImportedItemEnrichment)
    // finish the card right after it's added.
    const enrichmentPending = Boolean(row.enrichmentPending) || !existingPoster;

    details = {
      ...details,
      poster: existingPoster || details.poster || "",
      posterPending: false,
      posterBroken: false,
      posterSource: canReuseImportPoster
        ? "import_preview"
        : details.posterSource || "pending_enrichment",
      anilistId: details.anilistId || pick.anilistId,
    };
    row.details = details;

    const suggested =
      details.mergedGenres ||
      WM?.suggestGenres(details.genres, STANDARD_GENRES, contentType) ||
      [];
    const genre =
      suggested[0] || WM?.defaultGenreForContentType?.(contentType) || "Drama";
    const item = buildItemFromSearchDetails(details, {
      contentType,
      genre,
      secondaryGenres: suggested.slice(1),
    });

    rootCause.finalItemPosterBeforeInsert = item.poster || "";
    rootCause.finalItemPosterBroken = Boolean(item.posterBroken);

    if (enrichmentPending || !item.poster) {
      item.enrichmentPending = true;
    }

    return { ok: true, item, details, rootCause };
  }

  async function addImportRowToWatchlist(row) {
    const IJ = window.WatchlistImportJob;
    if (row.status === IJ?.STATUS?.added) {
      return { ok: false, reason: "already_added" };
    }

    const WM = window.WatchlistMetadata;
    const contentType = row.contentType;

    if (row.franchiseMember) {
      return { ok: false, reason: "grouped_member" };
    }

    let details = null;
    let item = null;
    let rootCause = null;

    if (contentType === "anime") {
      const built = await buildAnimeWatchlistItemForAdd(row, { pipeline: "bulk-commit" });
      rootCause = built.rootCause;
      if (!built.ok) {
        return {
          ok: false,
          reason: built.reason,
          message: built.message || "Fetching anime poster",
          rootCause,
        };
      }
      details = built.details;
      item = built.item;
    } else {
      details = row.details;
      if ((!details?.title || details?.posterPending) && row.pick) {
        const resolved = await WM?.resolveDetailsForWatchlistAdd?.(row.pick, contentType, {
          searchQuery: row.title,
          pipeline: "bulk-commit",
        });
        if (resolved?.title) {
          details = resolved;
          row.details = details;
        }
      }
      if (!details?.title) return { ok: false, reason: "no_identity" };

      if (!details.mergedGenres?.length) {
        details = (await WM?.enrichDetailsGenres?.(details, {
          contentType,
          standardGenres: STANDARD_GENRES,
          debugLabel: row.title,
        })) || details;
        row.details = details;
      }

      const suggested =
        details.mergedGenres ||
        WM?.suggestGenres(details.genres, STANDARD_GENRES, contentType) ||
        [];
      const genre =
        suggested[0] || WM?.defaultGenreForContentType?.(contentType) || "Drama";
      item = buildItemFromSearchDetails(details, {
        contentType,
        genre,
        secondaryGenres: suggested.slice(1),
      });
    }

    if (!item?.title) return { ok: false, reason: "no_identity", rootCause };

    const anilistId = details.anilistId || row.pick?.anilistId;
    if (contentType === "anime" && anilistId) {
      const franchiseDup = findWatchlistFranchiseDuplicateForImport(row);
      if (franchiseDup) {
        return {
          ok: false,
          reason: "duplicate",
          message: franchiseDup.title
            ? `Already on your list as “${franchiseDup.title}”.`
            : "Already on your list.",
          rootCause,
        };
      }
      const grouped = await IJ?.isAnimeGroupedChild?.(anilistId);
      if (grouped?.parent) {
        return {
          ok: false,
          reason: "duplicate",
          message: grouped.parent.title
            ? `Already on your list as “${grouped.parent.title}”.`
            : "Already on your list.",
          rootCause,
        };
      }
    }

    if (findDuplicate(item, null)) return { ok: false, reason: "duplicate", rootCause };

    stampItemAddedAt(item);
    state.items.push(item);
    if (itemHasTrustedPoster(item)) bumpItemMutation(item.id);
    return { ok: true, itemId: item.id, rootCause, row };
  }

  async function handleBulkImportCommit(options = {}) {
    const silent = Boolean(options.silent);
    const listId = state.activeListId || window.WatchlistAuth?.getProfile();
    const IJ = window.WatchlistImportJob;
    if (!listId || !IJ?.commitReadyItems || bulkImportCommitBusy) return;

    const items = IJ.loadItems(listId);
    const eligibleCount = IJ.countCommitEligible(items);
    if (!eligibleCount) {
      if (!silent) {
        await window.WatchlistDialog.alert(t("bulk.verifyBeforeAdd"), {
          title: t("bulk.addVerified"),
        });
      }
      return;
    }

    setBulkCommitButtonLoading(true, { current: 0, total: eligibleCount }, { silent });

    // Auto-commits (silent) reuse the poster/details already captured during
    // matching in the vast majority of cases, so they rarely touch AniList at
    // all. Pausing the matching queue for every one of these small, frequent
    // commits was fragmenting the AniList bulk-search batching (smaller
    // batches → more gated requests → much slower overall matching). Only the
    // explicit manual "Add to watchlist" click still pauses the queue.
    const jobBefore = IJ.loadJob(listId);
    const resumeImportAfter =
      !silent &&
      jobBefore &&
      !jobBefore.paused &&
      jobBefore.status !== "cancelled" &&
      jobBefore.status !== "completed";
    if (resumeImportAfter) {
      IJ.pauseJob?.(listId);
    }

    try {
      const addedItemIds = [];
      const posterTraceCommits = [];
      const result = await IJ.commitReadyItems(
        listId,
        async (row) => {
          const addResult = await addImportRowToWatchlist(row);
          if (addResult?.ok && addResult.itemId) {
            addedItemIds.push(addResult.itemId);
            // Poster root-cause tracing is debug-only and builds large
            // console.table payloads — never collect it during silent
            // auto-commit (hundreds of rows → memory blowup).
            if (
              !silent &&
              addResult.rootCause &&
              addResult.row &&
              isPosterOverwriteDebugEnabled()
            ) {
              posterTraceCommits.push({
                row: addResult.row,
                rootCause: addResult.rootCause,
                itemId: addResult.itemId,
              });
            }
          }
          return addResult;
        },
        {
          onProgress: ({ current, total }) => {
            setBulkCommitButtonLoading(true, { current, total }, { silent });
          },
        }
      );

      if (result.blocked) {
        if (!silent) {
          const message =
            result.reason === "incomplete_accounting"
              ? t("bulk.importStatusIncomplete")
              : result.errors?.[0] || t("bulk.verifyBeforeAdd");
          await window.WatchlistDialog.alert(message, {
            title: t("bulk.addVerified"),
          });
        }
        return;
      }

      if (result.added > 0) {
        persistWatchlistLocalOnly();
        invalidateWatchlistTitleLookupCache();
        invalidateWatchlistFranchiseLookupCache();
        window.WatchlistSync?.cancelScheduledPush?.();
        for (const id of addedItemIds) {
          const prev = enrichmentUpsertTimers.get(id);
          if (prev) clearTimeout(prev);
          enrichmentUpsertTimers.delete(id);
        }
        for (const id of addedItemIds) {
          queueImportedItemEnrichment(id);
        }
        const syncMeta = listSyncMeta(listId);
        if (
          addedItemIds.length &&
          window.WatchlistSync?.pushRowsUpsert &&
          (!window.WatchlistLifecycle || window.WatchlistLifecycle.canWriteCloud())
        ) {
          await window.WatchlistSync.pushRowsUpsert(
            listId,
            state.data,
            state.watched,
            addedItemIds,
            syncMeta
          );
        }
    updateGenreOptions();
        // Never full-rebuild the main list while matching is still running —
        // painting hundreds of cards + poster hydration mid-import was a
        // primary Out-of-Memory cause. Cards appear after matching idles.
        if (silent) {
          if (!isBulkImportActivelyMatching()) {
            scheduleDeferredListRender();
          }
        } else {
    render();
        }

        if (posterTraceCommits.length) {
          const rootCauseRows = [];
          for (const entry of posterTraceCommits) {
            const item = state.items.find((row) => row.id === entry.itemId);
            const rowData = await logBulkPosterRootCause(entry.row, entry.rootCause, item, {
              rowSavedToSupabasePoster: item?.poster || "",
            });
            if (rowData) rootCauseRows.push(rowData);
          }
          if (rootCauseRows.length) {
            console.warn("[bulk-poster-root-cause]");
            console.table(rootCauseRows);
          }
        }
      }

      const job = IJ.loadJob(listId);
      const freshItems = IJ.loadItems(listId);
      setBulkCommitButtonLoading(false, {}, { silent });
      renderImportJobPreview(job, freshItems);

      if (!silent) {
    await window.WatchlistDialog.alert(
          t("bulk.commitResult", {
            added: result.added,
            alreadyPresent: result.alreadyPresent,
            grouped: result.grouped,
            failed: result.failed,
            stillReady: result.stillReady,
          }),
      { title: t("alert.bulkAddedTitle") }
    );
      }
    } catch (error) {
      console.warn("[bulk-import:commit]", error);
      setBulkCommitButtonLoading(false, {}, { silent });
      const job = IJ.loadJob(listId);
      renderImportJobPreview(job, IJ.loadItems(listId));
      if (!silent) {
        await window.WatchlistDialog.alert(t("bulk.commitFailed"), {
          title: t("bulk.addVerified"),
        });
      }
    } finally {
      if (resumeImportAfter) {
        IJ.resumeJob?.(listId);
      }
    }
  }

  // Auto-commit newly matched titles as soon as they're confidently identified,
  // so the user doesn't need an extra manual "Add to watchlist" click. Only
  // rows that genuinely need attention (failed/ambiguous) require a decision.
  let deferredListRenderTimer = null;
  function scheduleDeferredListRender() {
    if (deferredListRenderTimer) return;
    deferredListRenderTimer = window.setTimeout(() => {
      deferredListRenderTimer = null;
      render();
    }, 1200);
  }

  function scheduleBulkImportAutoCommit(listId, delayMs = 5000) {
    if (!listId) return;
    if (bulkImportAutoCommitTimer) window.clearTimeout(bulkImportAutoCommitTimer);
    bulkImportAutoCommitTimer = window.setTimeout(() => {
      bulkImportAutoCommitTimer = null;
      void runBulkImportAutoCommit(listId);
    }, delayMs);
  }

  async function runBulkImportAutoCommit(listId) {
    const IJ = window.WatchlistImportJob;
    if (!listId || !IJ?.commitReadyItems) return;
    if (bulkImportAutoCommitInFlight || bulkImportCommitBusy) return;
    if (state.activeListId !== listId) return;
    if (!els.bulkImportPreview || els.bulkImportPreview.hidden) return;
    if (bulkImportTypeEditId) return; // don't interrupt an in-progress manual type edit

    const beforeCount = IJ.countCommitEligible(IJ.loadItems(listId));
    if (!beforeCount) return;
    // Circuit breaker: if repeated auto-commit attempts make no progress at
    // all (e.g. an item stuck on some unexpected error), stop re-scheduling
    // ourselves instead of looping forever every few seconds — a stuck loop
    // like that previously caused runaway retries and a tab memory crash.
    if (bulkImportAutoCommitStallStreak >= 5) return;

    bulkImportAutoCommitInFlight = true;
    try {
      await handleBulkImportCommit({ silent: true });
    } catch (error) {
      console.warn("[bulk-import:auto-commit]", error);
    } finally {
      bulkImportAutoCommitInFlight = false;
    }

    // More titles may have finished matching while we were committing.
    const remaining = IJ.countCommitEligible(IJ.loadItems(listId));
    if (remaining >= beforeCount) {
      bulkImportAutoCommitStallStreak += 1;
      if (bulkImportAutoCommitStallStreak >= 5) {
        console.warn(
          "[bulk-import:auto-commit] no progress after repeated attempts — pausing auto-add; use the \"Add to watchlist\" button manually."
        );
        return;
      }
    } else {
      bulkImportAutoCommitStallStreak = 0;
    }

    if (remaining > 0) scheduleBulkImportAutoCommit(listId, 5000);
  }

  async function handleBulkImportEndJob() {
    const listId = state.activeListId || window.WatchlistAuth?.getProfile();
    const IJ = window.WatchlistImportJob;
    if (!listId || !IJ?.clearJob) return;

    const confirmed = await window.WatchlistDialog.confirm(t("bulk.endJobWarning"), {
      title: t("bulk.endJobTitle"),
      confirmLabel: t("bulk.endJobConfirm"),
      cancelLabel: t("btn.cancel"),
      danger: true,
    });
    if (!confirmed) return;

    if (bulkImportAutoCommitTimer) {
      window.clearTimeout(bulkImportAutoCommitTimer);
      bulkImportAutoCommitTimer = null;
    }
    bulkImportAutoCommitStallStreak = 0;
    IJ.pauseJob?.(listId);
    IJ.forceReleaseWorkerLock?.(listId);
    await IJ.clearJob(listId);
    window.WatchlistBulkTitles?.clearBulkImportDraft?.();

    bulkImportStatusFilter = "all";
    bulkImportSearchQuery = "";
    bulkImportExpandedRowId = null;
    bulkImportTypeEditId = null;

    if (els.bulkPasteInput) els.bulkPasteInput.value = "";
    setBulkPasteError("");
    hideBulkImportPreview();

    await window.WatchlistDialog.alert(t("bulk.endJobDone"), {
      title: t("bulk.endJobTitle"),
    });
  }

  async function startBulkImportFromText(raw) {
    setBulkPasteError("");
    const WT = window.WatchlistBulkTitles;
    const IJ = window.WatchlistImportJob;
    if (!WT?.parseBulkImport || !IJ?.createJobFromParse) {
      setBulkPasteError(t("bulk.readFailed"));
      return;
    }

    IJ._helpers.isOnList = isTitleOnWatchlist;
    IJ._helpers.getWatchlistAnime = getWatchlistAnimeItems;
    IJ._helpers.findWatchlistFranchiseDuplicate = findWatchlistFranchiseDuplicateForImport;

    const parsed = WT.parseBulkImport(raw, { isOnList: IJ._helpers.isOnList });

    if (!parsed?.ok) {
      setBulkPasteError(
        parsed.error ? parsed.error : t(parsed.errorKey || "bulk.readFailed")
      );
      return;
    }

    const threshold = WT.LARGE_IMPORT_THRESHOLD || 50;
    if (parsed.stats.total > threshold) {
      const confirmed = await window.WatchlistDialog.confirm(
        t("bulk.largeImportWarning", { count: parsed.stats.total }),
        {
          title: t("bulk.largeImportTitle"),
          confirmLabel: t("bulk.reviewImport"),
          cancelLabel: t("btn.cancel"),
        }
      );
      if (!confirmed) return;
    }

    const listId = state.activeListId || window.WatchlistAuth?.getProfile() || "";
    const existingJob = IJ.loadJob(listId);
    const existingItems = IJ.loadItems(listId);
    const hasProgress =
      existingJob &&
      existingItems &&
      Object.values(existingItems).some(
        (it) =>
          it.status === IJ.STATUS.added ||
          it.status === IJ.STATUS.ready_to_add ||
          it.status === IJ.STATUS.ready ||
          it.status === IJ.STATUS.failed ||
          it.status === IJ.STATUS.not_found ||
          it.status === IJ.STATUS.pending ||
          it.status === IJ.STATUS.processing
      );

    if (hasProgress && Object.keys(existingItems).length > 0) {
      const confirmed = await window.WatchlistDialog.confirm(
        t("bulk.replaceJobWarning", { count: Object.keys(existingItems).length }),
        {
          title: t("bulk.replaceJobTitle"),
          confirmLabel: t("bulk.replaceJobConfirm"),
          cancelLabel: t("btn.cancel"),
          danger: true,
        }
      );
      if (!confirmed) {
        IJ.healTransientFailedItems(existingItems);
        existingJob.stats = IJ.recomputeStats(existingItems);
        showBulkImportPreview(existingJob, existingItems);
        if (!existingJob.paused && existingJob.status !== "cancelled") {
          IJ.kickImportQueue?.(listId);
        }
        return;
      }
    }

    bulkImportAutoCommitStallStreak = 0;
    const { job, items } = IJ.createJobFromParse(listId, parsed);
    WT.saveBulkImportDraft(WT.buildDraft(listId, parsed));
    showBulkImportPreview(job, items);
  }

  async function handleBulkAdd() {
    await startBulkImportFromText(els.bulkPasteInput?.value || "");
  }

  async function handleBulkFileUpload(event) {
    const file = event.target?.files?.[0];
    if (!file) return;
    const name = String(file.name || "").toLowerCase();
    const allowedExt = name.endsWith(".txt") || name.endsWith(".tsv");
    const allowedType =
      !file.type || file.type === "text/plain" || file.type.includes("tab-separated");
    if (!allowedExt && !allowedType) {
      setBulkPasteError(t("bulk.fileWrongType"));
      if (els.bulkFileInput) els.bulkFileInput.value = "";
      return;
    }
    try {
      const text = await file.text();
      if (els.bulkPasteInput) els.bulkPasteInput.value = text;
      await startBulkImportFromText(text);
    } catch {
      setBulkPasteError(t("bulk.fileReadFailed"));
    } finally {
      if (els.bulkFileInput) els.bulkFileInput.value = "";
    }
  }

  function handleBulkImportBack() {
    hideBulkImportPreview();
    els.bulkPasteInput?.focus();
  }

  function setBulkImportFilter(filter) {
    if (filter === bulkImportStatusFilter) {
      bulkImportStatusFilter = "all";
    } else {
      bulkImportStatusFilter = filter || "all";
    }
    bulkImportExpandedRowId = null;
    const listId = state.activeListId;
    const IJ = window.WatchlistImportJob;
    if (listId && IJ?.loadJob) {
      renderImportJobPreview(IJ.loadJob(listId), IJ.loadItems(listId));
    }
  }

  async function handleBulkImportResolve() {
    const listId = state.activeListId;
    const IJ = window.WatchlistImportJob;
    if (!listId || !IJ?.resolveRemaining || bulkImportWorkerBusy) return;
    if (IJ.isWorkerActive?.()) {
      await window.WatchlistDialog.alert(t("bulk.workerBusy"), {
        title: t("bulk.resolveRemaining"),
      });
      return;
    }
    bulkImportWorkerBusy = true;
    setBulkActionButtonLoading(els.bulkImportResolve, true, "bulk.resolving");
    try {
      IJ.healTransientFailedItems(IJ.loadItems(listId));
      const count = IJ.resolveRemaining(listId);
      if (!count) {
        await window.WatchlistDialog.alert(t("bulk.resolveNothing"), {
          title: t("bulk.resolveRemaining"),
        });
      } else {
        const kick = IJ.kickImportQueue?.(listId);
        if (kick && !kick.started) {
          await window.WatchlistDialog.alert(t("bulk.workerBusy"), {
            title: t("bulk.resolveRemaining"),
          });
        }
      }
    } finally {
      bulkImportWorkerBusy = false;
      setBulkActionButtonLoading(els.bulkImportResolve, false);
    }
  }

  function handleBulkImportContinue() {
    const listId = state.activeListId;
    const IJ = window.WatchlistImportJob;
    if (!listId || !IJ || bulkImportWorkerBusy) return;

    // Unstick AniList pause / deadlocked worker so matching can resume.
    window.WatchlistMetadata?.clearAnilistRateLimitPause?.();
    IJ.forceReleaseWorkerLock?.();

    bulkImportWorkerBusy = true;
    setBulkActionButtonLoading(els.bulkImportContinue, true, "bulk.continuing");
    const kick = IJ.continueProcessing?.(listId) || IJ.kickImportQueue?.(listId);
    if (!kick?.started) {
      bulkImportWorkerBusy = false;
      setBulkActionButtonLoading(els.bulkImportContinue, false);
      void window.WatchlistDialog.alert(
        t(kick?.reason === "worker_busy" ? "bulk.workerBusy" : "bulk.continueFailed"),
        { title: t("bulk.continueProcessing") }
      );
      return;
    }
    const poll = setInterval(() => {
      if (!IJ.isWorkerActive?.()) {
        clearInterval(poll);
        bulkImportWorkerBusy = false;
        setBulkActionButtonLoading(els.bulkImportContinue, false);
        const job = IJ.loadJob(listId);
        renderImportJobPreview(job, IJ.loadItems(listId));
      }
    }, 500);
  }

  function wakeImportQueueIfNeeded() {
    const listId = state.activeListId;
    const IJ = window.WatchlistImportJob;
    if (!listId || !IJ?.kickImportQueue) return;
    if (!els.bulkImportPreview || els.bulkImportPreview.hidden) return;
    IJ.kickImportQueue(listId);
    syncBulkImportWakeLock(IJ.loadJob?.(listId));
  }

  // Bulk import (especially anime falling back to AniList) can take several
  // minutes of mostly-idle waiting between throttled requests. If the OS/screen
  // goes to sleep during that time, all JS timers and in-flight requests freeze,
  // which is what causes the "stops, restarts, stops again" behavior. Holding a
  // Screen Wake Lock while a job is actively processing keeps the screen (and
  // therefore the tab) awake so the import can run to completion uninterrupted.
  async function requestBulkImportWakeLock() {
    if (bulkImportWakeLock) return;
    if (!("wakeLock" in navigator) || document.visibilityState !== "visible") return;
    try {
      const lock = await navigator.wakeLock.request("screen");
      bulkImportWakeLock = lock;
      lock.addEventListener("release", () => {
        if (bulkImportWakeLock === lock) bulkImportWakeLock = null;
      });
    } catch {
      bulkImportWakeLock = null;
    }
  }

  function releaseBulkImportWakeLock() {
    const lock = bulkImportWakeLock;
    bulkImportWakeLock = null;
    if (lock) {
      lock.release().catch(() => {});
    }
  }

  function syncBulkImportWakeLock(job) {
    const IJ = window.WatchlistImportJob;
    const jobIsLive =
      Boolean(job) &&
      !job.paused &&
      job.status !== "cancelled" &&
      job.status !== "completed";
    const stillHasWork = jobIsLive || Boolean(IJ?.isWorkerActive?.());
    const previewOpen = Boolean(els.bulkImportPreview) && !els.bulkImportPreview.hidden;
    if (stillHasWork && previewOpen) {
      void requestBulkImportWakeLock();
    } else {
      releaseBulkImportWakeLock();
    }
  }

  async function handleBulkImportCopyUnresolved() {
    const listId = state.activeListId;
    const IJ = window.WatchlistImportJob;
    if (!listId || !IJ?.copyUnresolvedTsv) return;
    const items = IJ.loadItems(listId);
    try {
      const ok = await IJ.copyUnresolvedTsv(items, { statusFilter: "unresolved" });
      if (!ok) {
        await window.WatchlistDialog.alert(t("bulk.copyUnresolvedEmpty"), {
          title: t("bulk.copyUnresolvedTitle"),
        });
        return;
      }
      flashBulkImportCopyUnresolvedSuccess();
    } catch {
      await window.WatchlistDialog.alert(t("alert.bulkCopyFailed"), {
        title: t("bulk.copyUnresolvedTitle"),
      });
    }
  }

  function flashBulkImportCopyUnresolvedSuccess() {
    const btn = els.bulkImportCopyUnresolved;
    if (!btn) return;
    if (bulkImportCopyUnresolvedResetTimer) {
      clearTimeout(bulkImportCopyUnresolvedResetTimer);
      bulkImportCopyUnresolvedResetTimer = null;
    }
    btn.classList.add("is-copied");
    btn.textContent = t("bulk.copyUnresolvedCopied");
    btn.setAttribute("aria-live", "polite");
    bulkImportCopyUnresolvedResetTimer = setTimeout(() => {
      bulkImportCopyUnresolvedResetTimer = null;
      btn.classList.remove("is-copied");
      btn.textContent = t("bulk.copyUnresolved");
      btn.removeAttribute("aria-live");
    }, 2000);
  }

  function openBulkCorrectedTsvModal() {
    if (!els.bulkCorrectedTsvModal) return;
    if (els.bulkCorrectedTsvInput) els.bulkCorrectedTsvInput.value = "";
    els.bulkCorrectedTsvModal.hidden = false;
    updateBodyScrollLock();
    if (els.bulkCorrectedTsvPaste) {
      els.bulkCorrectedTsvPaste.hidden = !navigator.clipboard?.readText;
    }
    els.bulkCorrectedTsvInput?.focus();
  }

  function closeBulkCorrectedTsvModal() {
    if (!els.bulkCorrectedTsvModal) return;
    els.bulkCorrectedTsvModal.hidden = true;
    updateBodyScrollLock();
  }

  async function applyBulkCorrectedTsvText(raw) {
    const listId = state.activeListId;
    const IJ = window.WatchlistImportJob;
    if (!listId || !IJ?.applyCorrectedTsv) return;

    const result = IJ.applyCorrectedTsv(listId, raw);
    if (result.error) {
      await window.WatchlistDialog.alert(t("bulk.correctedImportFailed"), {
        title: t("bulk.correctedImportTitle"),
      });
      return;
    }
    closeBulkCorrectedTsvModal();
    const job = IJ.loadJob(listId);
    const items = IJ.loadItems(listId);
    renderImportJobPreview(job, items);
    await window.WatchlistDialog.alert(
      t("bulk.correctedImportDone", {
        updated: result.updated,
        skipped: result.skipped,
        ambiguous: result.ambiguous,
      }),
      { title: t("bulk.correctedImportTitle") }
    );
  }

  async function handleBulkImportCorrectedTsv(event) {
    const file = event.target?.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      await applyBulkCorrectedTsvText(text);
    } catch {
      await window.WatchlistDialog.alert(t("bulk.fileReadFailed"), {
        title: t("bulk.correctedImportTitle"),
      });
    } finally {
      if (els.bulkImportCorrectedTsv) els.bulkImportCorrectedTsv.value = "";
    }
  }

  async function handleBulkImportCorrectedTsvApply() {
    const text = els.bulkCorrectedTsvInput?.value || "";
    if (!text.trim()) {
      await window.WatchlistDialog.alert(t("bulk.correctedPasteEmpty"), {
        title: t("bulk.correctedImportTitle"),
      });
      return;
    }
    await applyBulkCorrectedTsvText(text);
  }

  async function handleBulkImportCorrectedTsvPaste() {
    if (!navigator.clipboard?.readText) return;
    try {
      const text = await navigator.clipboard.readText();
      if (els.bulkCorrectedTsvInput) els.bulkCorrectedTsvInput.value = text;
      els.bulkCorrectedTsvInput?.focus();
    } catch {
      await window.WatchlistDialog.alert(t("bulk.correctedPasteFailed"), {
        title: t("bulk.correctedImportTitle"),
      });
    }
  }

  function bindImportPreviewTypeInteractions() {
    if (!els.bulkImportPreview || els.bulkImportPreview.dataset.typeInteractionsBound === "true") {
      return;
    }
    els.bulkImportPreview.dataset.typeInteractionsBound = "true";

    const typeInteractionSelector =
      ".bulk-import-preview__cell-type, .bulk-import-preview__type-edit, [data-import-type-toggle], [data-import-apply-type], [data-import-cancel-type], [data-import-change-type]";

    els.bulkImportPreview.addEventListener(
      "mousedown",
      (event) => {
        if (event.target.closest(typeInteractionSelector)) {
          event.stopPropagation();
        }
      },
      true
    );

    els.bulkImportPreview.addEventListener("click", (event) => {
      if (els.bulkImportPreview.hidden) return;
      const IJ = window.WatchlistImportJob;
      const listId = state.activeListId;
      if (!IJ || !listId) return;

      if (event.target.closest(".bulk-import-preview__type-edit, [data-import-change-type], option")) {
        event.stopPropagation();
      }

      const cancelType = event.target.closest("[data-import-cancel-type]");
      if (cancelType) {
        event.stopPropagation();
        closeImportTypeEditor(cancelType.dataset.importCancelType);
        return;
      }

      const toggleType = event.target.closest("[data-import-type-toggle]");
      if (toggleType) {
        event.stopPropagation();
        openImportTypeEditor(toggleType.dataset.importTypeToggle);
        return;
      }

      const typeCell = event.target.closest("[data-import-type-cell]");
      if (
        typeCell &&
        !event.target.closest(".bulk-import-preview__type-edit") &&
        typeCell.querySelector("[data-import-type-toggle]")
      ) {
        event.stopPropagation();
        openImportTypeEditor(typeCell.dataset.importTypeCell);
        return;
      }

      const applyType = event.target.closest("[data-import-apply-type]");
      if (applyType) {
        event.stopPropagation();
        const itemId = applyType.dataset.importApplyType;
        const select = els.bulkImportTableBody?.querySelector(
          `[data-import-change-type="${CSS.escape(itemId)}"]`
        );
        const newType = select?.value;
        if (!newType || !IJ.changeItemType) return;
        bulkImportTypeEditId = null;
        bulkImportWorkerBusy = true;
        void IJ.changeItemType(listId, itemId, newType).then((res) => {
          bulkImportWorkerBusy = false;
          if (!res?.ok) {
            void window.WatchlistDialog.alert(t("bulk.changeTypeFailed"), {
              title: t("bulk.changeType"),
            });
          }
          renderImportJobPreview(IJ.loadJob(listId), IJ.loadItems(listId));
        });
        return;
      }

      const row = event.target.closest("[data-import-row]");
      if (!row) return;
      if (event.target.closest(typeInteractionSelector)) return;
      if (bulkImportTypeEditId) return;
      const id = row.dataset.importRow;
      bulkImportExpandedRowId = bulkImportExpandedRowId === id ? null : id;
      renderImportJobPreview(IJ.loadJob(listId), IJ.loadItems(listId));
    });
  }

  function bindImportJobUi() {
    const IJ = window.WatchlistImportJob;
    if (!IJ) return;

    IJ._helpers.isOnList = isTitleOnWatchlist;
    IJ._helpers.getWatchlistAnime = getWatchlistAnimeItems;
    IJ._helpers.findWatchlistFranchiseDuplicate = findWatchlistFranchiseDuplicateForImport;
    IJ._helpers.getWatchlistFranchiseLookup = getWatchlistFranchiseLookupForImport;

    bindImportPreviewTypeInteractions();

    if (els.bulkImportToolbar?.dataset.bound === "true") return;
    if (els.bulkImportToolbar) els.bulkImportToolbar.dataset.bound = "true";

    IJ.setChangeHandler(({ listId, job, items }) => {
      if (listId !== state.activeListId) return;
      if (!els.bulkImportPreview || els.bulkImportPreview.hidden) return;
      if (bulkImportWorkerBusy && !IJ.isWorkerActive?.()) {
        bulkImportWorkerBusy = false;
        setBulkActionButtonLoading(els.bulkImportContinue, false);
        setBulkActionButtonLoading(els.bulkImportResolve, false);
      }
      scheduleImportPreviewRenderThrottled(listId, job, items, {
        preserveTypeEditor: Boolean(bulkImportTypeEditId),
      });
      if (IJ.countCommitEligible?.(items)) {
        scheduleBulkImportAutoCommit(listId);
      }
      syncBulkImportWakeLock(job);
    });

    els.bulkImportSummary?.addEventListener("click", (event) => {
      const btn = event.target.closest("[data-import-filter]");
      if (!btn) return;
      setBulkImportFilter(btn.dataset.importFilter);
    });

    els.bulkImportSearch?.addEventListener("input", (event) => {
      bulkImportSearchQuery = event.target.value || "";
      const listId = state.activeListId;
      if (listId) {
        renderImportJobPreview(IJ.loadJob(listId), IJ.loadItems(listId));
      }
    });

    els.bulkImportSearchClear?.addEventListener("click", () => {
      bulkImportSearchQuery = "";
      if (els.bulkImportSearch) els.bulkImportSearch.value = "";
      const listId = state.activeListId;
      if (listId) {
        renderImportJobPreview(IJ.loadJob(listId), IJ.loadItems(listId));
      }
    });

    els.bulkImportResolve?.addEventListener("click", () => {
      void handleBulkImportResolve();
    });
    els.bulkImportContinue?.addEventListener("click", () => {
      handleBulkImportContinue();
    });
    els.bulkImportEndJob?.addEventListener("click", () => {
      void handleBulkImportEndJob();
    });

    if (!window.__bulkImportQueueWakeBound) {
      window.__bulkImportQueueWakeBound = true;
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") {
          wakeImportQueueIfNeeded();
        } else {
          releaseBulkImportWakeLock();
        }
      });
      window.addEventListener("focus", wakeImportQueueIfNeeded);
      window.addEventListener("online", wakeImportQueueIfNeeded);
    }

    els.bulkImportCopyUnresolved?.addEventListener("click", () => {
      void handleBulkImportCopyUnresolved();
    });
    els.bulkImportPasteCorrected?.addEventListener("click", openBulkCorrectedTsvModal);
    els.bulkCorrectedTsvApply?.addEventListener("click", () => {
      void handleBulkImportCorrectedTsvApply();
    });
    els.bulkCorrectedTsvPaste?.addEventListener("click", () => {
      void handleBulkImportCorrectedTsvPaste();
    });
    els.bulkCorrectedTsvModal?.addEventListener("click", (event) => {
      if (event.target.closest("[data-action='close-bulk-corrected']")) {
        closeBulkCorrectedTsvModal();
      }
    });

    els.bulkImportCorrectedTsv?.addEventListener("change", handleBulkImportCorrectedTsv);

    els.bulkFileInput?.addEventListener("change", handleBulkFileUpload);
  }

  function handleFormSubmit(event) {
    event.preventDefault();
    if (addSaveInFlight) return;

    const item = formToItem();

    if (!item.title?.trim()) return;
    if (!item.genre) {
      window.WatchlistDialog.alert(t("alert.genreRequired"), {
        title: t("alert.genreRequiredTitle"),
      });
      return;
    }

    // Summary/actors come from providers — never block save for missing metadata.

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
      const wasEdit = Boolean(state.editingId);
      saveItem(item);
      state.manualLinkMeta = null;
      closeModal();
      updateGenreOptions();
      render();
      queueItemBadgeEnrichment(item.id);
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

    const deletedId = state.editingId;
    closeModal();
    deleteAndRender(deletedId);
  }

  function setType(type) {
    const prevType = state.type;
    const nextType = type;

    // Move live DOM (with decoded posters) into a DocumentFragment instead of
    // serializing to HTML — innerHTML rebuild forces mobile to re-download images.
    if (
      prevType &&
      prevType !== nextType &&
      filtersAllowTypeViewCache() &&
      els.main?.querySelector(".card")
    ) {
      const frag = document.createDocumentFragment();
      while (els.main.firstChild) frag.appendChild(els.main.firstChild);
      typeViewDomCache.set(prevType, {
        frag,
        scrollY: window.scrollY || 0,
      });
    }

    state.type = nextType;
    els.typeTabs.forEach((tab) => {
      const active = tab.dataset.type === nextType;
      tab.classList.toggle("type-tab--active", active);
      tab.setAttribute("aria-selected", String(active));
      tab.tabIndex = active ? 0 : -1;
    });
    updateGenreOptions();
    updateRatingFilterOptions();

    if (filtersAllowTypeViewCache()) {
      const cached = typeViewDomCache.get(nextType);
      if (cached?.frag?.childNodes?.length) {
        els.main.replaceChildren();
        els.main.appendChild(cached.frag);
        typeViewDomCache.delete(nextType);
        applyCardLayout();
        bindPosterErrorHandlers();
        bindPosterLoadTracking();
        if (shouldHydratePosters()) {
          els.main.querySelectorAll(".card").forEach(observeCardPosterUpgrade);
        }
        updateStats();
        updateClearFiltersButton();
        updateFilterFieldHighlights();
        window.scrollTo(0, cached.scrollY || 0);
        return;
      }
    }

    render({ preserveTypeViewCache: true });
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
    const titleCount = countTitles(payload.watchlist);
    const currentCount = state.items.length;
    const currentListName = window.WatchlistAuth?.getListLabel() || "My list";

    if (currentCount > 0) {
      els.importShareModalText.textContent = t("import.summarySimpleWithCurrent", {
        listName,
        count: titleCount,
        currentName: currentListName,
      });
      if (els.importShareModalHint) {
        els.importShareModalHint.textContent = t("import.hint");
      }
    } else {
      els.importShareModalText.textContent = t("import.summarySimpleEmpty", {
        listName,
        count: titleCount,
      });
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
    return `${window.location.origin}/`;
  }

  function buildShareUrl(shareId) {
    const base = getShareBaseUrl();
    if (!base) return "";
    const url = new URL("/", base);
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

  function bindSearchClear(input, clearBtn, onClear) {
    if (!input || !clearBtn) return;
    const sync = () => {
      clearBtn.hidden = input.value.length === 0;
    };
    input.addEventListener("input", sync);
    clearBtn.addEventListener("click", (event) => {
      event.preventDefault();
      input.value = "";
      sync();
      onClear();
      input.focus();
    });
    sync();
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
      clearTimeout(listSearchDebounceTimer);
      listSearchDebounceTimer = setTimeout(() => {
        render();
      }, 180);
    });

    bindSearchClear(els.search, els.searchClear, () => {
      clearTimeout(listSearchDebounceTimer);
      state.search = "";
      render();
    });

    bindSearchClear(els.titleSearchInput, els.titleSearchClear, () => {
      clearTimeout(searchDebounceTimer);
      state.searchQuery = "";
      state.searchPage = 1;
      runTitleSearch();
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
      applyWatchedFilter(els.watchedFilter.value || "all");
    });

    els.stats?.addEventListener("click", (event) => {
      const chip = event.target.closest("[data-action='filter-watched']");
      if (!chip) return;
      applyWatchedFilter(chip.dataset.watchedFilter || "all");
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

      if (action === "open-credits") {
        await openCreditsModal();
        return;
      }

      if (action === "restore-cloud") {
        closeAccountMenu();
        const result = await restoreListFromCloud();
        if (!result.ok) {
          await window.WatchlistDialog.alert(t("sync.cloudRestoreFailed"), {
            title: t("sync.cloudRestoreTitle"),
          });
        }
        return;
      }

      if (action === "storage-diagnostics") {
        closeAccountMenu();
        await window.WatchlistStorageDiagnostics?.renderDiagnosticsModal?.();
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

    els.creditsModal?.addEventListener("click", (event) => {
      const action = event.target.closest("[data-action]")?.dataset.action;
      if (action === "close-credits-modal") closeCreditsModal();
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
      syncTitleSearchTypePills();
      state.searchPage = 1;
      runTitleSearch();
    });

    document.getElementById("titleSearchTypePills")?.addEventListener("click", (event) => {
      const pill = event.target.closest("[data-search-type]");
      if (!pill || !els.titleSearchType) return;
      els.titleSearchType.value = pill.dataset.searchType || "all";
      syncTitleSearchTypePills();
      state.searchPage = 1;
      runTitleSearch();
    });

    els.titleSearchMore?.addEventListener("click", () => {
      if (state.searchLoading) return;
      state.searchPage += 1;
      runTitleSearch({ append: true });
    });

    els.searchAddPanel?.addEventListener("click", async (event) => {
      if (openAddTitlePosterLightbox(event)) return;
      const addBtn = event.target.closest("[data-action='add-search-result']");
      if (addBtn) {
        await handleSearchResultDirectAdd(addBtn);
        return;
      }
      const pick = event.target.closest("[data-action='pick-search-result']");
      if (pick) {
        await handleSearchResultPick(pick);
      }
    });

    els.searchConfirmBack?.addEventListener("click", hideSearchConfirmStep);
    els.searchConfirmAdd?.addEventListener("click", handleSearchConfirmAdd);

    els.copyBulkTemplate?.addEventListener("click", copyBulkTemplate);
    els.bulkAddConfirm?.addEventListener("click", handleBulkAdd);
    els.bulkImportBack?.addEventListener("click", handleBulkImportBack);
    els.bulkImportConfirm?.addEventListener("click", () => {
      void handleBulkImportCommit();
    });
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
      if (event.target.closest("#ratingEpisodeAvgSuggest")) {
        applyRatingEpisodeAvgSuggest();
        return;
      }
      const action = event.target.closest("[data-action]")?.dataset.action;
      if (action === "close-rating-modal") {
        dismissRatingModal();
      }
      if (action === "rate-later") {
        dismissRatingModal();
      }
    });

    els.modal.addEventListener("click", (event) => {
      if (openAddTitlePosterLightbox(event)) return;
      if (event.target.closest("[data-action='close-modal']")) {
        closeModal();
      }
    });

    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      if (window.WatchlistTitleDetail?.isPosterLightboxOpen?.()) {
        window.WatchlistTitleDetail.closePosterLightbox();
        return;
      }
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
      if (!els.creditsModal?.hidden) {
        closeCreditsModal();
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
    window.addEventListener(
      "resize",
      () => {
        updateBodyScrollLock();
      },
      { passive: true }
    );

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
        closeAllCardMenus();
        const progress = itemProgressState(id);
        if (progress === "watched") {
          await markItemUnwatched(id);
        } else {
          await markItemWatched(id, { openRating: true });
        }
        return;
      }

      if (action === "quick-toggle-watched") {
        closeAllCardMenus();
        await quickToggleWatched(id);
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
        deleteAndRender(id);
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
    try {
    if (!window.WatchlistAuth?.isAuthenticated()) {
      const shareId = new URLSearchParams(window.location.search).get("share")?.trim();
      window.location.replace(
        shareId ? `/?share=${encodeURIComponent(shareId)}` : "/"
      );
      return;
    }

    window.WatchlistLifecycle?.reset?.();
    window.WatchlistImportJobStore?.purgeLegacyLocalStorage?.();
    window.WatchlistStorageDiagnostics?.maybeOpenFromQuery?.();

    updateHeaderTitle();

    state.watched = loadWatchedState();
    state.cardLayout = loadCardLayout();
    applyCardLayout();
    syncLayoutToggles();
    state.activeListId = window.WatchlistAuth.getProfile();
    const listId = state.activeListId;

    void window.WatchlistImportJobStore?.migrateLegacyLocalStorage?.(listId);
    // Don't hydrate a huge leftover import job during startup — it can freeze the page.
    // Import tab loads it on demand.

    let hasLocal = false;
    try {
    state.data = loadWatchlist();
    state.items = flattenWatchlist(state.data);
    state.data = itemsToNested(state.items);
      hasLocal = state.data && !window.WatchlistAuth.isWatchlistEmpty(state.data);
    } catch (loadError) {
      console.error("[app] local watchlist load failed:", loadError);
      state.data = emptyWatchlist();
      state.items = [];
    }

    if (!hasLocal) {
      hasLocal = await loadWatchlistCacheFirst(listId);
    }

    window.WatchlistLifecycle?.markLocalReady(state.items.length);

    const cloudConfigured = window.WatchlistSync?.isConfigured();

    if (cloudConfigured) {
      state.syncStatus = "pending";
      if (!hasLocal) {
        showLoadingSkeleton();
        window.WatchlistLifecycle?.showRestoreBanner(true);
        window.WatchlistLifecycle?.setPhase(window.WatchlistLifecycle.PHASE.loading_cloud);
        updateCloudRestoreBanner();
        updateStats();
        try {
          await withTimeout(cloudBootstrap(listId, false), INIT_CLOUD_SYNC_TIMEOUT_MS, "Initial cloud sync");
        } catch (error) {
          console.warn("[sync] initial cloud bootstrap failed:", error);
          window.WatchlistLifecycle?.setPhase(window.WatchlistLifecycle.PHASE.cloud_retrying);
          state.syncStatus = resolveSyncFailureStatus();
        }
      }
    }

    hasLocal = state.data && !window.WatchlistAuth.isWatchlistEmpty(state.data);

    const { data, watched } = storageKeys();
    try {
    localStorage.setItem(data, JSON.stringify(state.data));
    localStorage.setItem(watched, JSON.stringify(state.watched));
    } catch (err) {
      console.warn("[app] could not persist local snapshot:", err);
    }
    persistWatchlistCache(listId);

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
    purgeLegacyFilterPrefsStorage();
    updateHeaderTitle();
    window.WatchlistAuth?.registerList(window.WatchlistAuth.getProfile(), {
      accountId: window.WatchlistAuth.getAccountId(),
      name: window.WatchlistAuth.getListLabel(),
      description: window.WatchlistAuth.getListDescription(),
    });
    resetSessionFilters({ renderNow: false });
    bindEvents();
    updateBodyScrollLock();
    bindImportJobUi();
    bindOfflineSyncListeners();
    document.documentElement.classList.add("app-ready");
    window.WatchlistPullRefresh?.init?.();
    syncContentTypePicker(els.formTypePicker, els.formType, els.formType?.value || "movies");
    renderListSwitcher();
    if (els.ratingFilter?.value === "rt-best" || els.ratingFilter?.value === "rt-worst") {
      els.ratingFilter.value = "all";
      applyRatingFilter("all");
    }
    updateStats();
    updateAppBanners();
    // Yield so the shell paints before rendering hundreds of cards.
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    render();
    scheduleDeferredAnimeMaintenance();
    window.WatchlistLifecycle?.setPhase(window.WatchlistLifecycle.PHASE.synced);
    window.WatchlistLifecycle?.showRestoreBanner(false);
    updateCloudRestoreBanner();
    if (cloudConfigured && hasLocal) {
      void runBackgroundCloudSync();
    } else {
      scheduleMetadataBackfill();
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

    window.addEventListener("watchlist-lifecycle", () => {
      updateCloudRestoreBanner();
    });

    window.addEventListener("watchlist-sync-progress", (event) => {
      const label = event.detail?.label;
      if (!label || !els.stats) return;
      const syncChip = els.stats.querySelector(".header__stat-chip--sync");
      if (syncChip) syncChip.textContent = label;
    });

    const debugStorage =
      new URLSearchParams(window.location.search).get("debug") === "storage" ||
      localStorage.getItem("watchlist-debug-storage") === "1";
    const storageMenu = document.getElementById("storageDiagnosticsMenuItem");
    if (storageMenu && debugStorage) storageMenu.hidden = false;
    } catch (error) {
      console.error("[app] init failed:", error);
      state.syncStatus = resolveSyncFailureStatus();
      if (!state.data) {
        state.data = emptyWatchlist();
        state.items = [];
      }
    } finally {
      if (
        window.WatchlistAuth?.isAuthenticated() &&
        !document.documentElement.classList.contains("app-ready")
      ) {
        hideLoadingSkeleton();
        if (!state.data) {
          els.main.innerHTML = `
            <div class="empty-state">
              <p class="empty-state__title">${escapeHtml(t("error.loadWatchlistFailed"))}</p>
              <p>${escapeHtml(t("error.loadWatchlistHint"))}</p>
            </div>
          `;
        } else {
          purgeLegacyFilterPrefsStorage();
          updateHeaderTitle();
          bindEvents();
          updateBodyScrollLock();
          bindImportJobUi();
          bindOfflineSyncListeners();
          document.documentElement.classList.add("app-ready");
          resetSessionFilters({ renderNow: false });
          renderListSwitcher();
          updateStats();
          render();
        }
      }
    }
  }

  window.WatchlistApp = {
    init,
    renderExternalRatings,
    updateRatingModalActions,
    openRatingModal,
    quickToggleWatched,
    markItemUnwatched,
    markItemWatched,
    isCloudSavePending: () =>
      state.syncStatus === "pending" || Boolean(window.WatchlistSync?.isSyncing?.()),
    isLocalInitComplete: () => window.WatchlistLifecycle?.isLocalInitComplete?.() ?? true,
    // Exposed for title-detail.js
    findItem: (id) => state.items.find((i) => i.id === id) ?? null,
    isWatched: isItemWatched,
    getWatchEntry,
    progressState: itemProgressState,
    progressStateFromEntry: itemProgressStateFromEntry,
    parseRuntimeMinutes,
    closeAllMenus: closeAllCardMenus,
    deleteAndRender,
    // Exposed for title-seasons.js — save watch entry locally without full render
    saveWatchedEntry: (id, entry, options = {}) => {
      if (!id) return;
      commitWatchChange(
        id,
        () => {
          const emptyResult = entry == null || isWatchEntryEmpty(entry);
          if (emptyResult) {
            delete state.watched[id];
          } else {
            state.watched[id] = entry;
          }
        },
        { seasonNum: options.seasonNum ?? null }
      );
    },
    // Re-render a single card in-place (no full list rebuild)
    updateCardInPlace: (id) => {
      syncListCard(id);
    },
    patchItem: (id, fields) => {
      if (!id || !fields || typeof fields !== "object") return;
      const item = state.items.find((i) => i.id === id);
      if (!item) return;
      const safe = stripProtectedEnrichmentFields(fields, item);
      Object.assign(item, safe);
      preservePosterFieldsOnItem(item, { ...fields, __source: "patchItem" });
      // Keep nested data object in sync so saveData persists the patch
      const nested = state.data?.[item.contentType]?.[item.genre];
      if (Array.isArray(nested)) {
        const stored = nested.find((e) => e.title === item.title);
        if (stored) Object.assign(stored, fields);
      }
      saveData();
      syncListCard(id);
    },
    syncListCard,
    queueItemBadgeEnrichment,
    cardDisplayPoster,
    cardDisplayTitle,
    itemAnimePosterNeedsRepair,
    repairAnimePosterFromSeasons,
    repairAnimeGroupedDuplicates,
    runAnimeGroupingRepairNow,
    restoreWatchlistFromLocalCache,
    probeWatchlistCacheRecovery,
    diagnoseWatchlistIntegrity,
    debugAnimeGroupState,
    runImportAddedTypeAudit: (listId) => {
      try {
        localStorage.setItem("watchlist-debug-import-audit", "1");
      } catch {
        /* ignore */
      }
      return applyAddedImportTypeCorrections(
        listId || state.activeListId || window.WatchlistAuth?.getProfile()
      );
    },
    normalizeGenre,
    openAddTitleConfirm,
    quickAddFromDetails,
    getSearchConfirmBackKey,
    getSearchConfirmAddKey,
    isTitleOnList,
    getAnimeWatchlistAnilistIds,
    updateStats,
    refreshCardWatchState,
    canPullToRefresh,
    isPullToRefreshActive,
    pullToRefreshFromCloud,
    restoreListFromCloud,
    updateBodyScrollLock,
  };

  if (document.getElementById("mainContent")) {
    void init().catch((error) => {
      console.error("[app] init unhandled:", error);
    });
  }
})();
