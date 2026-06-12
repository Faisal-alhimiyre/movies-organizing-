(function () {
  "use strict";

  const TYPE_META = {
    movies: { label: "Movies", short: "Movie", className: "movies" },
    tvSeries: { label: "TV Series", short: "TV", className: "tvSeries" },
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

  const state = {
    type: "all",
    selectedGenres: [],
    search: "",
    watchedOnly: false,
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
  };

  const els = {
    main: document.getElementById("mainContent"),
    loading: document.getElementById("loading"),
    stats: document.getElementById("stats"),
    search: document.getElementById("searchInput"),
    genre: document.getElementById("genreSelect"),
    genreFilterChips: document.getElementById("genreFilterChips"),
    watchedOnly: document.getElementById("watchedOnly"),
    exportBtn: document.getElementById("exportBtn"),
    importBtn: document.getElementById("importBtn"),
    importInput: document.getElementById("importInput"),
    backupModal: document.getElementById("backupModal"),
    backupModalTitle: document.getElementById("backupModalTitle"),
    backupModalExport: document.getElementById("backupModalExport"),
    backupModalImport: document.getElementById("backupModalImport"),
    backupExportConfirm: document.getElementById("backupExportConfirm"),
    backupImportConfirm: document.getElementById("backupImportConfirm"),
    layoutToggles: document.getElementById("layoutToggles"),
    linkPreviewPopover: document.getElementById("linkPreviewPopover"),
    linkPreviewPopoverInner: document.getElementById("linkPreviewPopoverInner"),
    app: document.getElementById("app"),
    addBtn: document.getElementById("addBtn"),
    typeTabs: document.querySelectorAll(".type-tab"),
    modal: document.getElementById("itemModal"),
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

  function saveWatched() {
    const { watched } = storageKeys();
    localStorage.setItem(watched, JSON.stringify(state.watched));
  }

  function saveData() {
    const { data } = storageKeys();
    state.data = itemsToNested(state.items);
    localStorage.setItem(data, JSON.stringify(state.data));
  }

  function normalizeGenre(genre) {
    if (STANDARD_GENRES.includes(genre)) return genre;
    return LEGACY_GENRE_MAP[genre] || "Drama";
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
      if (wasWatched) migrated[item.id] = true;
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
        kind: item.kind,
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
    const bundled = window.WATCHLIST
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
    return loadJson(watched, {});
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
        kind: item.kind,
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

  function getKindBadge(item) {
    if (item.contentType === "anime") {
      return { label: "Anime", className: "anime" };
    }
    if (item.kind === "franchise") {
      return { label: "Film series", className: "franchise" };
    }
    if (item.contentType === "movies") {
      return { label: "Movie", className: "movie" };
    }
    return { label: "Series", className: "series" };
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

  function itemMatchesGenreFilter(item) {
    if (!state.selectedGenres.length) return true;
    const genres = itemGenres(item);
    return state.selectedGenres.some((genre) => genres.includes(genre));
  }

  function getFilteredItems() {
    const query = state.search.trim().toLowerCase();

    return state.items.filter((item) => {
      if (state.type !== "all" && item.contentType !== state.type) return false;
      if (!itemMatchesGenreFilter(item)) return false;
      if (!matchesSearch(item, query)) return false;
      if (state.watchedOnly && !state.watched[item.id]) return false;
      return true;
    });
  }

  function sortItemsInGroup(items) {
    const typeOrder = ["movies", "tvSeries", "anime"];

    return [...items].sort((a, b) => {
      const aWatched = Boolean(state.watched[a.id]);
      const bWatched = Boolean(state.watched[b.id]);
      if (aWatched !== bWatched) return aWatched ? 1 : -1;

      const typeDiff =
        typeOrder.indexOf(a.contentType) - typeOrder.indexOf(b.contentType);
      if (typeDiff !== 0) return typeDiff;

      return a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
    });
  }

  function groupItems(items) {
    const groups = new Map();
    const mergeByGenreOnly = state.type === "all";

    for (const item of items) {
      const key = mergeByGenreOnly ? item.genre : `${item.contentType}|||${item.genre}`;
      if (!groups.has(key)) {
        groups.set(key, {
          contentType: mergeByGenreOnly ? null : item.contentType,
          genre: item.genre,
          items: [],
        });
      }
      groups.get(key).items.push(item);
    }

    const typeOrder = ["movies", "tvSeries", "anime"];
    return [...groups.values()]
      .map((group) => ({
        ...group,
        items: sortItemsInGroup(group.items),
      }))
      .sort((a, b) => {
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

  function updateStats() {
    const total = state.items.length;
    const watchedCount = state.items.filter((i) => state.watched[i.id]).length;

    const byType = {
      movies: state.items.filter((i) => i.contentType === "movies").length,
      tvSeries: state.items.filter((i) => i.contentType === "tvSeries").length,
      anime: state.items.filter((i) => i.contentType === "anime").length,
    };

    els.stats.textContent = `${total} total · ${watchedCount} watched`;

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
    const badge = getKindBadge(item);
    const isWatched = Boolean(state.watched[item.id]);
    const altTitle = item.altTitle
      ? `<span class="card__alt">${escapeHtml(item.altTitle)}</span>`
      : "";
    const secondaryBadges = (item.secondaryGenres || [])
      .map(
        (genre) =>
          `<span class="badge badge--genre-secondary">${escapeHtml(genre)}</span>`
      )
      .join("");

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
        <span class="badge badge--${badge.className}">${escapeHtml(badge.label)}</span>
        ${secondaryBadges}
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

    return `
      <article class="card${linkedClass}${isWatched ? " card--watched" : ""}" data-id="${escapeHtml(item.id)}"${linkAttr}${imdbAttr}>
        ${posterBlock}
        ${bodyStart}
        ${bodyHeader}
        <p class="card__lead">${escapeHtml((item.leads || parseLeads(item)).join(", "))}</p>
        <p class="card__summary">${escapeHtml(item.summary || parseSummary(item))}</p>
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
          <p>Add titles, or import a backup from another device.</p>
          <div class="empty-state__actions">
            <button type="button" class="btn btn--primary empty-state__btn" data-action="add">
              Add title
            </button>
            <button type="button" class="btn btn--ghost empty-state__btn" data-action="import">
              Import backup
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
        const sectionId = group.contentType
          ? `${group.contentType}-${group.genre}`
          : group.genre;
        const typeBadge = meta
          ? `<span class="genre-section__type genre-section__type--${meta.className}">${escapeHtml(meta.short)}</span>`
          : "";

        return `
          <section class="genre-section" id="${escapeHtml(sectionId.replace(/\W+/g, "-"))}">
            <header class="genre-section__header">
              ${typeBadge}
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
        <option value="franchise">Film series</option>
      `;
    } else {
      els.formKind.value = "series";
    }
  }

  function openModal(mode, item) {
    state.editingId = mode === "edit" ? item.id : null;
    els.modalTitle.textContent = mode === "edit" ? "Edit title" : "Add title";
    els.deleteBtn.hidden = mode !== "edit";

    els.form.reset();
    populateFormGenreSelect();

    if (item) {
      const kind = item.kind || (item.contentType === "movies" ? "movie" : "series");
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
    els.formTitle.focus();
  }

  function closeModal() {
    els.modal.hidden = true;
    updateBodyScrollLock();
    state.editingId = null;
    state.formSecondary = [];
    state.formLeads = [];
    els.form.reset();
  }

  function updateBodyScrollLock() {
    const anyOpen = !els.modal.hidden || !els.backupModal?.hidden;
    document.body.style.overflow = anyOpen ? "hidden" : "";
  }

  function openBackupModal(mode) {
    if (!els.backupModal) return;

    const isExport = mode === "export";
    els.backupModalTitle.textContent = isExport ? "Export list" : "Import list";
    els.backupModalExport.hidden = !isExport;
    els.backupModalImport.hidden = isExport;
    els.backupModal.hidden = false;
    updateBodyScrollLock();
    (isExport ? els.backupExportConfirm : els.backupImportConfirm)?.focus();
  }

  function closeBackupModal() {
    if (!els.backupModal) return;
    els.backupModal.hidden = true;
    updateBodyScrollLock();
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

  function handleFormSubmit(event) {
    event.preventDefault();

    const item = formToItem();

    if (!item.genre || !item.title || !item.leads.length || !item.summary) {
      if (!item.leads.length) {
        alert("Add at least one lead actor.");
      }
      return;
    }

    if (els.formLink.value.trim() && !item.link) {
      alert("Enter a valid link (IMDb or Rotten Tomatoes URL).");
      return;
    }

    const duplicate = findDuplicate(item, state.editingId);
    if (duplicate) {
      alert("A title with this name already exists in this type.");
      return;
    }

    saveItem(item);
    updateGenreOptions();
    closeModal();
    render();
  }

  function handleDelete() {
    if (!state.editingId) return;

    const item = state.items.find((i) => i.id === state.editingId);
    const name = item ? item.title : "this title";

    if (!confirm(`Delete "${name}" from your watchlist?`)) return;

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

  function importBackup(file) {
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const payload = JSON.parse(reader.result);
        if (!payload?.watchlist) {
          throw new Error("Invalid backup");
        }

        state.data = payload.watchlist;
        state.watched = payload.watched || {};
        state.items = flattenWatchlist(state.data);
        state.data = itemsToNested(state.items);
        window.WatchlistAuth?.clearEmptyListFlag();
        saveData();
        saveWatched();
        updateGenreOptions();
        render();
        closeBackupModal();
      } catch {
        alert("Could not read that backup file. Use a file exported from this app.");
      }
    };
    reader.readAsText(file);
  }

  function exportBackup() {
    const payload = {
      exportedAt: new Date().toISOString(),
      watchlist: state.data,
      watched: state.watched,
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    const profile = window.WatchlistAuth?.getProfile() || "list";
    link.download = `watchlist-${profile}-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
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

    els.watchedOnly.addEventListener("change", () => {
      state.watchedOnly = els.watchedOnly.checked;
      render();
    });

    els.exportBtn?.addEventListener("click", () => openBackupModal("export"));
    els.importBtn?.addEventListener("click", () => openBackupModal("import"));
    els.backupExportConfirm?.addEventListener("click", () => {
      exportBackup();
      closeBackupModal();
    });
    els.backupImportConfirm?.addEventListener("click", () => {
      els.importInput?.click();
    });
    els.importInput?.addEventListener("change", () => {
      const file = els.importInput.files?.[0];
      importBackup(file);
      els.importInput.value = "";
    });
    els.backupModal?.addEventListener("click", (event) => {
      if (event.target.closest("[data-action='close-backup-modal']")) {
        closeBackupModal();
      }
    });
    els.layoutToggles?.addEventListener("click", (event) => {
      const toggle = event.target.closest("[data-layout]");
      if (!toggle) return;
      setCardLayout(toggle.dataset.layout);
    });
    els.addBtn.addEventListener("click", () => openModal("add"));

    document.getElementById("signOutBtn")?.addEventListener("click", () => {
      window.WatchlistAuth?.signOut();
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
    els.deleteBtn.addEventListener("click", handleDelete);

    els.modal.addEventListener("click", (event) => {
      if (event.target.closest("[data-action='close-modal']")) {
        closeModal();
      }
    });

    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      if (!els.backupModal?.hidden) {
        closeBackupModal();
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

    els.main.addEventListener("click", (event) => {
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
        if (state.watched[id]) {
          delete state.watched[id];
        } else {
          state.watched[id] = true;
        }
        saveWatched();
        render();
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
        if (!confirm(`Delete "${name}" from your watchlist?`)) return;
        deleteItem(id);
        updateGenreOptions();
        render();
        return;
      }

      if (action === "add") {
        openModal("add");
        return;
      }

      if (action === "import") {
        openBackupModal("import");
      }
    });
  }

  function init() {
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
    saveData();

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
    updateGenreOptions();
    bindEvents();
    render();
  }

  window.WatchlistApp = { init };

  if (document.getElementById("mainContent")) {
    init();
  }
})();
