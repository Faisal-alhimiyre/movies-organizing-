/**
 * title-seasons.js — Seasons, episodes, and granular watch-progress controller.
 *
 * Stage D. Populates #tdSeasonsSlot inside the title-detail surface.
 *
 * Responsibilities:
 *   - Fetch and render series metadata (series summary + season list)
 *   - Render horizontal season carousel
 *   - Render selected-season info panel
 *   - Lazy-fetch and render episode list for selected season only
 *   - Handle individual episode watched toggles
 *   - Handle whole-season mark / unmark
 *   - Respond to title-level watched toggle (onTitleWatchedChanged)
 *   - Handle language changes without resetting carousel position
 *   - Protect against stale async responses with request tokens
 *   - All UI updates are targeted (no full detail rebuild)
 *
 * Update flow (no full detail rebuild):
 *   Episode toggle  → updateEpisodeRowState() + updateSeasonCard() +
 *                     updateSeasonInfoProgress() + callbacks.updateHeaderWatchState()
 *   Season toggle   → updateSeasonCard() + updateSeasonInfoProgress() +
 *                     all episode rows + callbacks.updateHeaderWatchState()
 *   Title toggle    → all episode rows + all season cards + header
 *   Lang change     → re-render labels only, preserve selection + scroll
 *
 * Progress persistence:
 *   - Saved locally via callbacks.saveWatchedEntry() (Stage A WatchlistProgress format)
 *   - Cloud sync is Stage E
 *
 * Depends on:
 *   - window.WatchlistSeriesMetadata (fetchSeriesMetadata, fetchSeasonEpisodes, ResultState)
 *   - window.WatchlistProgress       (all progress helpers)
 *   - window.WatchlistApp            (getWatchEntry — via callback)
 *   - window.WatchlistI18n           (t)
 *
 * Exposed as window.WatchlistSeasons
 */
(function () {
  "use strict";

  // ─── Per-open state ──────────────────────────────────────────────────────
  let _slot       = null;  // #tdSeasonsSlot DOM element
  let _item       = null;  // current watchlist item
  let _callbacks  = null;  // { getWatchEntry, saveWatchedEntry, updateCardInPlace,
                            //   updateHeaderWatchState, updateDetailActions }
  let _token      = null;  // Symbol — changes on detach / new open
  let _resolution     = null;  // cached result of resolveSeriesId(_item)
  let _seriesResult   = null;  // last fetchSeriesMetadata result
  let _selectedSeason = null;  // currently selected season number (int)
  let _episodesResult = null;  // { state, episodes, seasonNum }
  let _carouselEl     = null;  // .tds-carousel DOM element
  let _dragStartX     = 0;
  let _isDragging     = false;

  // ─── i18n shorthand ──────────────────────────────────────────────────────
  function t(key, vars) {
    const i18n = window.WatchlistI18n;
    if (!i18n) {
      // i18n not available yet — will be on next call after page fully loads
      return key;
    }
    const result = i18n.t(key, vars);
    if (result === key && typeof key === "string" && key.includes(".")) {
      // Translation key returned unchanged — log once per key for diagnostics
      if (!t._warned) t._warned = new Set();
      if (!t._warned.has(key)) {
        t._warned.add(key);
        console.warn("[title-seasons] Missing translation key:", key);
      }
    }
    return result;
  }

  // ─── Locale / poster helpers ──────────────────────────────────────────────
  function getLocale() {
    return window.WatchlistI18n?.getLang?.() || "en";
  }

  function getItemPoster() {
    return _item?.poster || _item?.posterUrl || _item?.posterPath || "";
  }

  // ─── HTML escape ──────────────────────────────────────────────────────────
  function esc(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  // ─── Token guard ──────────────────────────────────────────────────────────
  function isValid(tok) { return tok === _token; }

  // ─── Progress helpers (shorthand) ─────────────────────────────────────────
  const P = () => window.WatchlistProgress;

  function getEntry() {
    return _callbacks?.getWatchEntry?.() ?? null;
  }

  function saveEntry(newEntry) {
    _callbacks?.saveWatchedEntry?.(annotateCompletion(newEntry));
    _callbacks?.updateCardInPlace?.();
  }

  /**
   * After episode data loads for a season, re-check whether an existing
   * granular entry should be marked completed. Saves and refreshes the card
   * if the `completed` flag changed. This corrects entries that were saved
   * before the `completed` annotation existed (e.g., fully-watched shows that
   * were tracked episode-by-episode in a previous session).
   */
  function reannotateExistingEntry() {
    const entry = getEntry();
    if (!entry || !P()?.getProgress(entry)) return; // no granular progress to re-check
    const before = entry.progress?.completed;
    const annotated = annotateCompletion(entry); // mutates in-place (entry is same ref)
    const after = annotated.progress?.completed;
    if (before !== after) {
      // Completion flag changed — persist and update card badge
      _callbacks?.saveWatchedEntry?.(annotated);
      _callbacks?.updateCardInPlace?.();
    }
  }

  /**
   * Sets or clears `progress.completed` based on whether all required aired
   * episodes across every regular season are now watched.
   *
   * For the currently-loaded season, uses exact aired episode data.
   * For unloaded seasons, uses `season.episodeCount` as an approximation.
   * This lets `itemProgressState` in app.js correctly return "watched" for
   * fully-granular-watched shows without needing episode counts there.
   */
  function annotateCompletion(entry) {
    const prog = P()?.getProgress(entry);
    if (!prog) return entry; // legacy-complete — no annotation needed

    const regularSeasons = (_seriesResult?.seasons || []).filter((s) => s.seasonNumber > 0);
    if (!regularSeasons.length) return entry;

    let allDone = true;
    for (const season of regularSeasons) {
      const sNum = season.seasonNumber;
      // For the currently-loaded season use exact aired keys
      if (_episodesResult?.seasonNum === sNum && _episodesResult?.episodes) {
        const airedKeys = (_episodesResult.episodes || [])
          .filter((ep) => ep.isAired !== false)
          .map((ep) => P()?.episodeKey(ep.seasonNumber, ep.episodeNumber))
          .filter(Boolean);
        if (airedKeys.length === 0) continue; // no aired eps in this season yet
        const allInEntry = airedKeys.every((k) => prog.episodes.includes(k));
        if (!allInEntry) { allDone = false; break; }
      } else {
        // Season not loaded — use episodeCount as an upper-bound approximation
        const count = season.episodeCount ?? 0;
        if (count === 0) continue;
        const watchedInSeason = prog.episodes.filter((k) => k.startsWith(`${sNum}:`)).length;
        if (watchedInSeason < count) { allDone = false; break; }
      }
    }

    // Write or clear the completed flag in-place (progress was already cloned by _buildEntry)
    if (allDone) {
      prog.completed = true;
    } else {
      delete prog.completed;
    }
    return entry;
  }

  // ─── Season helpers ────────────────────────────────────────────────────────

  function isTvOrAnime(item) {
    return item?.contentType === "tvSeries" || item?.contentType === "anime";
  }

  /** Collect aired episode keys for a given season from loaded episodes. */
  function airedEpisodeKeysForSeason(seasonNum) {
    if (_episodesResult?.seasonNum !== seasonNum || !_episodesResult?.episodes) return [];
    return (_episodesResult.episodes || [])
      .filter((ep) => ep.isAired !== false)
      .map((ep) => P()?.episodeKey(ep.seasonNumber, ep.episodeNumber))
      .filter(Boolean);
  }

  /** Collect aired episode objects for a season (for watched-count purposes). */
  function airedEpsForSeason(seasonNum) {
    if (_episodesResult?.seasonNum !== seasonNum || !_episodesResult?.episodes) return null;
    return (_episodesResult.episodes || [])
      .filter((ep) => ep.isAired !== false)
      .map((ep) => ({ seasonNumber: ep.seasonNumber, episodeNumber: ep.episodeNumber }));
  }

  /** Count watched / total for a season using progress keys from local watched entry. */
  function seasonProgressFromEntry(entry, season) {
    const num   = season.seasonNumber;
    const total = season.episodeCount ?? 0;

    const airedEps = airedEpsForSeason(num);
    if (airedEps !== null) {
      const watched = P()?.watchedCountForSeason(entry, num, airedEps) ?? 0;
      const airedTotal = airedEps.length;
      return { watched, total: airedTotal, hasDetail: true };
    }

    // Episode list not loaded yet — never assume watched without a real entry.
    if (!entry) {
      return { watched: 0, total, hasDetail: false };
    }

    if (P()?.isLegacyComplete?.(entry)) {
      return { watched: total, total, hasDetail: false };
    }

    const prog = P()?.getProgress(entry);
    if (!prog) {
      return { watched: 0, total, hasDetail: false };
    }
    const watched = (prog.episodes || [])
      .filter((k) => k.startsWith(`${num}:`)).length;
    return { watched, total, hasDetail: false };
  }

  /** Derive whether a season is "watched" (complete), "partial", or "unwatched". */
  function seasonWatchState(entry, season) {
    const num      = season.seasonNumber;
    const airedEps = airedEpsForSeason(num);

    if (airedEps !== null) {
      if (P()?.isSeasonFullyWatched(entry, num, airedEps)) return "watched";
      if (P()?.isSeasonPartiallyWatched(entry, num, airedEps)) return "partial";
      return "unwatched";
    }

    // Episode details not yet loaded — only legacy-complete shows as watched.
    if (!entry) return "unwatched";
    if (P()?.isLegacyComplete?.(entry)) return "watched";

    const prog = P()?.getProgress(entry);
    if (!prog) return "unwatched";
    const watchedCount = (prog.episodes || []).filter((k) => k.startsWith(`${num}:`)).length;
    if (!watchedCount) return "unwatched";
    if ((season.episodeCount ?? 0) > 0 && watchedCount >= (season.episodeCount ?? 0)) return "watched";
    return "partial";
  }

  function getSeasonByNum(seasonNum) {
    return (_seriesResult?.seasons || []).find((s) => s.seasonNumber === seasonNum) || null;
  }

  function seasonDisplayName(season) {
    if (!season) return "";
    const num = season.seasonNumber;
    if (season.isSpecials) return t("seasons.specials");
    if (season.name && !/^Season \d+$/i.test(season.name)) return season.name;
    return t("seasons.seasonNum", { n: num });
  }

  function getSeasonPoster(seasonNum) {
    const season = getSeasonByNum(seasonNum);
    return season?.poster || getItemPoster() || "";
  }

  /** Merge season poster/overview from a season-detail fetch into cached series result. */
  function patchSeasonFromEpisodeResult(seasonNum, result) {
    if (!_seriesResult?.seasons || !result) return;
    const idx = _seriesResult.seasons.findIndex((s) => s.seasonNumber === seasonNum);
    if (idx < 0) return;

    const season = _seriesResult.seasons[idx];
    let changed = false;

    if (result.seasonPoster && result.seasonPoster !== season.poster) {
      season.poster = result.seasonPoster;
      changed = true;
    }
    if (result.seasonOverview && !season.overview) {
      season.overview = result.seasonOverview;
      changed = true;
    }

    if (changed) {
      refreshSeasonCard(seasonNum);
      if (_selectedSeason === seasonNum) {
        renderSeasonInfo(seasonNum);
        _callbacks?.onSeasonSelected?.(season);
      }
    }
  }

  // ─── Initial season selection ─────────────────────────────────────────────

  function pickInitialSeason(seasons) {
    if (!seasons || seasons.length === 0) return null;

    const regular = seasons.filter((s) => s.seasonNumber > 0);
    const entry   = getEntry();
    const prog    = P()?.getProgress(entry);

    // 1. Season with the most recently watched episode (highest season number with any progress)
    if (prog && prog.episodes.length > 0) {
      const seasonNums = prog.episodes
        .map((k) => parseInt(k.split(":")[0], 10))
        .filter(Number.isFinite);
      if (seasonNums.length > 0) {
        const maxSeason = Math.max(...seasonNums);
        if (seasons.some((s) => s.seasonNumber === maxSeason)) return maxSeason;
      }
    }

    // 2. First regular season with episodes
    const firstRegular = regular.find((s) => (s.episodeCount ?? 0) > 0) || regular[0];
    if (firstRegular) return firstRegular.seasonNumber;

    // 3. Any available season
    return seasons[0].seasonNumber;
  }

  // ─── attach / detach ─────────────────────────────────────────────────────

  function attach(slotEl, item, callbacks) {
    detach();
    _slot      = slotEl;
    _item      = item;
    _callbacks = callbacks;
    _token     = Symbol();

    if (!isTvOrAnime(item)) {
      // Movies and film-series never show the seasons section
      if (_slot) _slot.hidden = true;
      return;
    }

    _slot.hidden = false;
    _slot.innerHTML = buildRootHtml();
    _carouselEl = _slot.querySelector(".tds-carousel");
    bindSlotEvents();
    loadSeriesMetadata();
  }

  function detach() {
    _token      = null;  // invalidate pending requests
    _slot       = null;
    _item       = null;
    _callbacks  = null;
    _resolution     = null;
    _seriesResult   = null;
    _selectedSeason = null;
    _episodesResult = null;
    _carouselEl     = null;
    _isDragging     = false;
  }

  // ─── Root HTML scaffold ───────────────────────────────────────────────────

  function buildRootHtml() {
    return `
      <div class="tds-root" aria-live="polite">
        <div class="tds-loading-section" data-tds-part="seasons-loading">
          <span class="tds-spinner" role="status" aria-label="${esc(t("seasons.loading"))}"></span>
          <span>${esc(t("seasons.loading"))}</span>
        </div>
        <div class="tds-error-section" data-tds-part="seasons-error" hidden></div>
        <div class="tds-stale-banner" data-tds-part="stale-banner" hidden></div>
        <div class="tds-seasons-section" data-tds-part="seasons-section" hidden>
          <div class="tds-section-header">
            <h3 class="tds-section-title" data-tds-label="seasons-title"></h3>
          </div>
          <div class="tds-carousel-wrap">
            <button class="tds-nav-btn tds-nav-btn--prev" data-tds-action="prev-season" hidden
              aria-label="${esc(t("seasons.prevSeason"))}">
              ${chevronSvg("left")}
            </button>
            <div class="tds-carousel" role="listbox"
              aria-label="${esc(t("seasons.loading"))}"
              tabindex="0" dir="ltr"></div>
            <button class="tds-nav-btn tds-nav-btn--next" data-tds-action="next-season" hidden
              aria-label="${esc(t("seasons.nextSeason"))}">
              ${chevronSvg("right")}
            </button>
          </div>
          <div class="tds-season-info" data-tds-part="season-info" hidden></div>
        </div>
        <div class="tds-episodes-section" data-tds-part="episodes-section" hidden>
          <div class="tds-episodes-header">
            <h3 class="tds-episodes-title" data-tds-label="episodes-title"></h3>
          </div>
          <div class="tds-episodes-status" data-tds-part="episodes-status" hidden></div>
          <div class="tds-episode-list" role="list" aria-live="polite"></div>
        </div>
      </div>`;
  }

  function chevronSvg(dir) {
    // Always render left/right chevrons; JS handles RTL semantics
    const d = dir === "left"
      ? "M15 18l-6-6 6-6"
      : "M9 18l6-6-6-6";
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="${d === "M15 18l-6-6 6-6" ? "15 18 9 12 15 6" : "9 18 15 12 9 6"}"></polyline></svg>`;
  }

  function checkSvg(checked) {
    if (checked) {
      return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
    }
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"></circle></svg>`;
  }

  // ─── Metadata loading ─────────────────────────────────────────────────────

  async function loadSeriesMetadata() {
    const tok = _token;
    const meta = window.WatchlistSeriesMetadata;
    if (!meta || !_item) return;

    // Log configuration status for debugging (never logs key values)
    if (!window.__tdsConfigLogged) {
      window.__tdsConfigLogged = true;
      const WM = window.WatchlistMetadata;
      console.info(
        "[title-seasons] API config —",
        "TMDb:", WM?.hasTmdbKey?.() ? "yes" : "no",
        "| OMDb:", WM?.hasOmdbKey?.() ? "yes" : "no",
        "| AniList: yes (public)"
      );
    }

    // Resolve the series identity (IMDb → TMDb/OMDb, AniList, MAL → AniList)
    const resolution = await meta.resolveSeriesId(_item);
    if (!isValid(tok)) return;

    _resolution = resolution;

    const locale = getLocale();
    const poster = getItemPoster();
    const result = await meta.fetchSeriesMetadata(resolution, locale, poster);
    if (!isValid(tok)) return;

    _seriesResult = result;
    const RS = meta.ResultState;

    switch (result?.state) {
      case RS.AVAILABLE:
      case RS.PARTIALLY_AVAILABLE:
        renderSeasonsSection(result);
        // Only surface the stale banner when the data is genuinely stale (TTL
        // expired and network refresh failed). PARTIALLY_AVAILABLE on its own
        // means "AniList could only provide partial series data" which is normal
        // and should not alarm the user on every cache hit.
        if (result.isStale) showStale(t("seasons.staleWarning"));
        break;

      case RS.OFFLINE_WITH_CACHE:
        renderSeasonsSection(result);
        showStale(t("seasons.offline"));
        break;

      case RS.OFFLINE_NO_CACHE:
        showError(t("seasons.offlineNoCache"), "retry-series");
        break;

      case RS.RATE_LIMITED:
        showError(t("seasons.rateLimited"), "retry-series");
        break;

      case RS.INVALID_ID:
        showError(t("seasons.invalidId"), null);
        break;

      case RS.NO_SEASONS:
        showError(t("seasons.noSeasons"), null);
        break;

      case RS.UNAVAILABLE:
      case RS.API_FAILURE:
      default:
        showError(t("seasons.error"), "retry-series");
        break;
    }
  }

  async function loadEpisodes(seasonNum) {
    const tok = _token;
    const meta = window.WatchlistSeriesMetadata;
    if (!meta || !_item || !_resolution) return;

    showEpisodesLoading();

    const locale = getLocale();
    const poster = getItemPoster();
    // Find the season summary for poster fallback
    const seasonSummary = (_seriesResult?.seasons || []).find(
      (s) => s.seasonNumber === seasonNum
    ) || null;
    const result = await meta.fetchSeasonEpisodes(
      _resolution, seasonNum, locale, poster, seasonSummary
    );
    if (!isValid(tok) || _selectedSeason !== seasonNum) return;

    _episodesResult = { ...result, seasonNum };
    const RS = meta.ResultState;

    patchSeasonFromEpisodeResult(seasonNum, result);

    switch (result?.state) {
      case RS.AVAILABLE:
      case RS.OFFLINE_WITH_CACHE:
        renderEpisodeList(seasonNum, result.episodes || []);
        if (result.state === RS.OFFLINE_WITH_CACHE) showEpisodesStatus(t("seasons.offline"), null);
        // Refresh season card and re-annotate completion now that we have episode data
        refreshSeasonCard(seasonNum);
        reannotateExistingEntry();
        break;

      case RS.OFFLINE_NO_CACHE:
        showEpisodesStatus(t("seasons.offlineNoCache"), "retry-episodes");
        break;

      case RS.EPISODE_DETAILS_UNAVAILABLE:
        showEpisodesStatus(t("seasons.episodesUnavailable"), null);
        break;

      case RS.RATE_LIMITED:
        showEpisodesStatus(t("seasons.rateLimited"), "retry-episodes");
        break;

      case null:
      case undefined:
        // No episode data available yet (e.g. series loaded from OMDb)
        showEpisodesStatus(t("seasons.episodesUnavailable"), null);
        break;

      default:
        showEpisodesStatus(t("seasons.episodesError"), "retry-episodes");
        break;
    }
  }

  // ─── Rendering: seasons section ───────────────────────────────────────────

  function renderSeasonsSection(result) {
    if (!_slot) return;
    const seasons = result?.seasons || [];
    if (!seasons.length) {
      showError(t("seasons.noSeasons"), null);
      return;
    }

    // Hide loading, show sections
    getP("seasons-loading")?.setAttribute("hidden", "");
    getP("seasons-error")?.setAttribute("hidden", "");
    getP("seasons-section")?.removeAttribute("hidden");

    // Update carousel label
    const carouselEl = _slot.querySelector(".tds-carousel");
    if (carouselEl) carouselEl.setAttribute("aria-label", t("seasons.sectionTitle"));

    // Update section title
    const titleEl = _slot.querySelector("[data-tds-label='seasons-title']");
    if (titleEl) titleEl.textContent = t("seasons.sectionTitle");

    // Render season cards
    renderCarousel(seasons);

    // Select initial season
    const initial = pickInitialSeason(seasons);
    if (initial !== null) selectSeason(initial, { animate: false });
  }

  function renderCarousel(seasons) {
    if (!_carouselEl) return;
    _carouselEl.innerHTML = seasons.map((s) => seasonCardHtml(s)).join("");
    updateNavButtons(seasons);
    bindCarouselEvents();
  }

  function seasonCardHtml(season) {
    const entry = getEntry();
    const num   = season.seasonNumber;
    const ws    = seasonWatchState(entry, season);
    const prog  = seasonProgressFromEntry(entry, season);

    const name = seasonDisplayName(season);

    const countStr = season.episodeCount != null
      ? (season.episodeCount === 1
          ? t("seasons.episodeCountOne")
          : t("seasons.episodeCount", { n: season.episodeCount }))
      : "";

    const progStr  = prog.total > 0
      ? t("seasons.watchedProgress", { watched: prog.watched, total: prog.total })
      : "";

    const barPct = prog.total > 0 ? Math.round(prog.watched / prog.total * 100) : 0;

    const markLabel = ws === "watched"
      ? t("seasons.unmarkSeason", { name })
      : t("seasons.markSeasonWatched", { name });

    const poster = season.poster || getItemPoster() || "";
    const altTxt = esc(name);

    return `<div class="tds-season-card tds-season-card--${esc(ws)}"
      role="option"
      aria-selected="false"
      tabindex="-1"
      data-tds-season="${num}"
      data-tds-action="select-season">
      <div class="tds-season-poster-wrap">
        ${poster
          ? `<img class="tds-season-poster" src="${esc(poster)}" alt="${altTxt}"
               data-fallback="${esc(getItemPoster())}"
               onerror="this.classList.add('tds-img--broken');var fb=this.dataset.fallback;if(fb&&this.src!==fb){this.src=fb;}else{this.nextElementSibling.hidden=false;}" />`
          : ""}
        <div class="tds-season-poster-placeholder"${poster ? ' hidden' : ''} aria-hidden="true">📺</div>
        <button class="tds-season-mark-overlay"
          data-tds-action="mark-season"
          data-tds-season="${num}"
          aria-label="${esc(markLabel)}"
          title="${esc(markLabel)}">
          ${checkSvg(ws === "watched")}
        </button>
      </div>
      <div class="tds-season-meta">
        <p class="tds-season-name">${esc(name)}</p>
        ${countStr ? `<p class="tds-season-count">${esc(countStr)}</p>` : ""}
        ${progStr  ? `<p class="tds-season-progress-text">${esc(progStr)}</p>` : ""}
        <div class="tds-mini-progress" aria-hidden="true">
          <div class="tds-mini-progress-fill" style="width:${barPct}%"></div>
        </div>
      </div>
    </div>`;
  }

  // ─── Season selection ──────────────────────────────────────────────────────

  function selectSeason(seasonNum, { animate = true } = {}) {
    if (_selectedSeason === seasonNum && animate) return;
    _selectedSeason = seasonNum;

    updateCarouselSelection(seasonNum);
    scrollToSeasonCard(seasonNum, animate);
    renderSeasonInfo(seasonNum);
    loadEpisodes(seasonNum);
    updateNavButtons(_seriesResult?.seasons || []);

    const season = getSeasonByNum(seasonNum);
    if (season) _callbacks?.onSeasonSelected?.(season);
  }

  function updateCarouselSelection(selectedNum) {
    if (!_carouselEl) return;
    const cards = [..._carouselEl.querySelectorAll(".tds-season-card")];
    cards.forEach((card) => {
      const num = parseInt(card.dataset.tdsSeason, 10);
      const isSelected = num === selectedNum;
      const isAdjacent = Math.abs(num - selectedNum) === 1;
      card.classList.toggle("tds-season-card--selected", isSelected);
      card.classList.toggle("tds-season-card--adjacent", !isSelected && isAdjacent);
      card.setAttribute("aria-selected", String(isSelected));
      card.setAttribute("tabindex", isSelected ? "0" : "-1");
    });
  }

  function scrollToSeasonCard(seasonNum, animate = true) {
    if (!_carouselEl) return;
    const card = _carouselEl.querySelector(`[data-tds-season="${seasonNum}"]`);
    if (!card) return;

    const carouselRect = _carouselEl.getBoundingClientRect();
    const cardRect     = card.getBoundingClientRect();
    const scrollLeft   = _carouselEl.scrollLeft
      + (cardRect.left - carouselRect.left)
      - (carouselRect.width / 2 - cardRect.width / 2);

    if (animate) {
      _carouselEl.scrollTo({ left: scrollLeft, behavior: "smooth" });
    } else {
      _carouselEl.scrollLeft = scrollLeft;
    }
  }

  function updateNavButtons(seasons) {
    if (!_slot) return;
    const prevBtn = _slot.querySelector("[data-tds-action='prev-season']");
    const nextBtn = _slot.querySelector("[data-tds-action='next-season']");
    if (!prevBtn || !nextBtn) return;

    const hasPrev = seasons.some((s) => s.seasonNumber < _selectedSeason);
    const hasNext = seasons.some((s) => s.seasonNumber > _selectedSeason);

    if (seasons.length > 1) {
      prevBtn.hidden = false;
      nextBtn.hidden = false;
      prevBtn.disabled = !hasPrev;
      nextBtn.disabled = !hasNext;
    } else {
      prevBtn.hidden = true;
      nextBtn.hidden = true;
    }
  }

  // ─── Selected season info ──────────────────────────────────────────────────

  function renderSeasonInfo(seasonNum) {
    if (!_slot) return;
    const infoEl = getP("season-info");
    if (!infoEl) return;
    const seasons = _seriesResult?.seasons || [];
    const season  = seasons.find((s) => s.seasonNumber === seasonNum);
    if (!season) { infoEl.hidden = true; return; }

    const entry = getEntry();
    const ws    = seasonWatchState(entry, season);
    const prog  = seasonProgressFromEntry(entry, season);

    const name = seasonDisplayName(season);

    const year = season.airDate ? season.airDate.slice(0, 4) : "";
    const metaParts = [
      year,
      season.episodeCount != null
        ? (season.episodeCount === 1
            ? t("seasons.episodeCountOne")
            : t("seasons.episodeCount", { n: season.episodeCount }))
        : null,
    ].filter(Boolean);

    const progStr = prog.total > 0
      ? t("seasons.watchedProgress", { watched: prog.watched, total: prog.total })
      : "";

    const markLabel = ws === "watched"
      ? t("seasons.unmarkSeason", { name })
      : t("seasons.markSeasonWatched", { name });

    const overviewHtml = season.overview
      ? `<p class="tds-season-info-overview" data-tds-part="season-overview">${esc(season.overview)}</p>
         <button class="tds-overview-toggle" data-tds-action="toggle-overview" aria-expanded="false">
           ${t("seasons.loading").replace("…", "▾")}
         </button>`
      : "";

    infoEl.innerHTML = `
      <p class="tds-season-info-name">${esc(name)}</p>
      ${metaParts.length ? `<p class="tds-season-info-meta">${esc(metaParts.join(" · "))}</p>` : ""}
      ${overviewHtml}
      <div class="tds-season-info-row">
        ${progStr ? `<span class="tds-season-info-progress">${esc(progStr)}</span>` : ""}
        <button class="tds-season-mark-btn${ws === "watched" ? " tds-season-mark-btn--complete" : ""}"
          data-tds-action="mark-season-info"
          data-tds-season="${seasonNum}"
          aria-label="${esc(markLabel)}">${esc(ws === "watched" ? t("seasons.unmarkSeason", { name }) : t("seasons.markSeasonWatched", { name }))}</button>
      </div>`;
    infoEl.hidden = false;
  }

  function updateSeasonInfoProgress(seasonNum) {
    if (!_slot) return;
    const infoEl = getP("season-info");
    if (!infoEl || infoEl.hidden) return;
    const seasons = _seriesResult?.seasons || [];
    const season  = seasons.find((s) => s.seasonNumber === seasonNum);
    if (!season) return;

    const entry = getEntry();
    const ws    = seasonWatchState(entry, season);
    const prog  = seasonProgressFromEntry(entry, season);
    const name  = seasonDisplayName(season);

    const progRow = infoEl.querySelector(".tds-season-info-row");
    if (progRow) {
      const progStr = prog.total > 0
        ? t("seasons.watchedProgress", { watched: prog.watched, total: prog.total })
        : "";
      const markLabel = ws === "watched"
        ? t("seasons.unmarkSeason", { name })
        : t("seasons.markSeasonWatched", { name });
      progRow.innerHTML = `
        ${progStr ? `<span class="tds-season-info-progress">${esc(progStr)}</span>` : ""}
        <button class="tds-season-mark-btn${ws === "watched" ? " tds-season-mark-btn--complete" : ""}"
          data-tds-action="mark-season-info"
          data-tds-season="${seasonNum}"
          aria-label="${esc(markLabel)}">${esc(ws === "watched" ? t("seasons.unmarkSeason", { name }) : t("seasons.markSeasonWatched", { name }))}</button>`;
    }
  }

  // ─── Rendering: episode list ───────────────────────────────────────────────

  function showEpisodesLoading() {
    const sec = getP("episodes-section");
    const statusEl = getP("episodes-status");
    const listEl = _slot?.querySelector(".tds-episode-list");
    if (!sec) return;

    if (statusEl) {
      statusEl.innerHTML = `<span class="tds-spinner" role="status" aria-label="${esc(t("seasons.episodesLoading"))}"></span>${esc(t("seasons.episodesLoading"))}`;
      statusEl.hidden = false;
    }
    if (listEl) listEl.innerHTML = "";
    sec.hidden = false;

    updateEpisodesTitle();
  }

  function showEpisodesStatus(msg, retryAction) {
    const statusEl = getP("episodes-status");
    const listEl   = _slot?.querySelector(".tds-episode-list");
    if (statusEl) {
      statusEl.innerHTML = `<span>${esc(msg)}</span>`
        + (retryAction
          ? ` <button class="tds-retry-btn" data-tds-action="${esc(retryAction)}">${esc(t("seasons.retry"))}</button>`
          : "");
      statusEl.hidden = false;
    }
    if (listEl) listEl.innerHTML = "";
  }

  function renderEpisodeList(seasonNum, episodes) {
    const listEl   = _slot?.querySelector(".tds-episode-list");
    const statusEl = getP("episodes-status");
    if (!listEl) return;

    if (statusEl) statusEl.hidden = true;

    if (!episodes.length) {
      listEl.innerHTML = `<div class="tds-episodes-status">${esc(t("seasons.emptySeason"))}</div>`;
      return;
    }

    const entry = getEntry();
    listEl.innerHTML = episodes.map((ep) => episodeRowHtml(ep, entry)).join("");
    updateEpisodesTitle();
  }

  function episodeRowHtml(ep, entry) {
    const seasonNum = ep.seasonNumber;
    const epNum     = ep.episodeNumber;
    const watched   = P()?.isEpisodeWatched(entry, seasonNum, epNum) ?? false;
    const isPlaceholder = !ep.title || /^episode \d+$/i.test(ep.title);
    const title = ep.title || t("seasons.episodeNum", { n: epNum });

    const metaParts = [];
    if (ep.runtimeMinutes) metaParts.push(t("seasons.epRuntime", { n: ep.runtimeMinutes }));
    if (ep.airDate) metaParts.push(t("seasons.epAiredOn", { date: ep.airDate.slice(0, 10) }));

    const checkLabel = watched
      ? t("seasons.episodeUnwatch", { title })
      : t("seasons.episodeWatched", { title });

    const titlePoster = getItemPoster();
    const seasonPoster = getSeasonPoster(seasonNum);
    const still = ep.still || seasonPoster || titlePoster || "";

    return `<div class="tds-episode${watched ? " tds-episode--watched" : ""}"
      role="listitem"
      data-tds-episode="${esc(`${seasonNum}:${epNum}`)}">
      <div class="tds-ep-still-wrap">
        ${still
          ? `<img class="tds-ep-still" src="${esc(still)}" alt=""
               data-fallback="${esc(seasonPoster || titlePoster)}"
               loading="lazy"
               onerror="this.classList.add('tds-img--broken');var fb=this.dataset.fallback;if(fb&&this.src!==fb){this.src=fb;}else{this.nextElementSibling.hidden=false;}" />`
          : ""}
        <div class="tds-ep-still-placeholder"${still ? ' hidden' : ''} aria-hidden="true" title="${esc(t("seasons.emptyStill"))}">🎞</div>
      </div>
      <div class="tds-ep-content">
        <div class="tds-ep-header">
          <span class="tds-ep-num">E${esc(String(epNum))}</span>
          <h4 class="tds-ep-title${isPlaceholder ? " tds-ep-title--placeholder" : ""}">${esc(title)}</h4>
        </div>
        ${ep.overview ? `<p class="tds-ep-overview">${esc(ep.overview)}</p>` : ""}
        ${metaParts.length ? `<p class="tds-ep-meta">${esc(metaParts.join(" · "))}</p>` : ""}
      </div>
      <button class="tds-ep-check${watched ? " tds-ep-check--watched" : ""}"
        role="checkbox"
        aria-checked="${String(watched)}"
        data-tds-action="toggle-ep"
        data-tds-episode="${esc(`${seasonNum}:${epNum}`)}"
        aria-label="${esc(checkLabel)}">
        ${checkSvg(watched)}
      </button>
    </div>`;
  }

  function updateEpisodesTitle() {
    const titleEl = _slot?.querySelector("[data-tds-label='episodes-title']");
    if (!titleEl) return;
    const season = _selectedSeason != null ? getSeasonByNum(_selectedSeason) : null;
    if (season) {
      titleEl.textContent = `${t("seasons.episodesTitle")} — ${seasonDisplayName(season)}`;
    } else {
      titleEl.textContent = t("seasons.episodesTitle");
    }
  }

  // ─── Error / loading states ───────────────────────────────────────────────

  function showError(msg, retryAction, subtitle) {
    if (!_slot) return;
    getP("seasons-loading")?.setAttribute("hidden", "");
    getP("seasons-section")?.setAttribute("hidden", "");
    const errEl = getP("seasons-error");
    if (!errEl) return;
    errEl.innerHTML =
      `<span class="tds-error-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
          stroke-linecap="round" stroke-linejoin="round" width="20" height="20">
          <circle cx="12" cy="12" r="10"></circle>
          <line x1="12" y1="8" x2="12" y2="12"></line>
          <line x1="12" y1="16" x2="12.01" y2="16"></line>
        </svg>
      </span>`
      + `<div class="tds-error-body">`
      + `<p class="tds-error-msg">${esc(msg)}</p>`
      + (subtitle ? `<p class="tds-error-sub">${esc(subtitle)}</p>` : "")
      + (retryAction
        ? `<button class="tds-retry-btn" data-tds-action="${esc(retryAction)}">`
          + `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
              stroke-linecap="round" stroke-linejoin="round" width="14" height="14"
              aria-hidden="true">`
          + `<polyline points="23 4 23 10 17 10"></polyline>`
          + `<path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>`
          + `</svg>`
          + esc(t("seasons.retry"))
          + `</button>`
        : "")
      + `</div>`;
    errEl.hidden = false;
    // Announce to screen readers
    errEl.setAttribute("role", "alert");
  }

  function showStale(msg) {
    const bannerEl = getP("stale-banner");
    if (!bannerEl) return;
    bannerEl.textContent = msg;
    bannerEl.hidden = false;
  }

  // ─── Targeted update: individual season card ──────────────────────────────

  function refreshSeasonCard(seasonNum) {
    if (!_carouselEl) return;
    const card = _carouselEl.querySelector(`[data-tds-season="${seasonNum}"]`);
    if (!card) return;
    const seasons = _seriesResult?.seasons || [];
    const season  = seasons.find((s) => s.seasonNumber === seasonNum);
    if (!season) return;

    const entry = getEntry();
    const ws    = seasonWatchState(entry, season);
    const prog  = seasonProgressFromEntry(entry, season);
    const name  = seasonDisplayName(season);

    // Update watched-state classes
    card.className = card.className
      .replace(/tds-season-card--(watched|partial|unwatched)/g, "")
      .trim() + ` tds-season-card--${ws}`;

    // Update progress text
    const progEl = card.querySelector(".tds-season-progress-text");
    if (progEl) {
      progEl.textContent = prog.total > 0
        ? t("seasons.watchedProgress", { watched: prog.watched, total: prog.total })
        : "";
    }

    // Update mini progress bar
    const fillEl = card.querySelector(".tds-mini-progress-fill");
    if (fillEl) {
      const pct = prog.total > 0 ? Math.round(prog.watched / prog.total * 100) : 0;
      fillEl.style.width = `${pct}%`;
    }

    // Update mark button
    const markBtn = card.querySelector(".tds-season-mark-overlay");
    if (markBtn) {
      const markLabel = ws === "watched"
        ? t("seasons.unmarkSeason", { name })
        : t("seasons.markSeasonWatched", { name });
      markBtn.setAttribute("aria-label", markLabel);
      markBtn.title = markLabel;
      markBtn.innerHTML = checkSvg(ws === "watched");
    }
  }

  // ─── Targeted update: individual episode row ──────────────────────────────

  function updateEpisodeRowState(seasonNum, epNum) {
    if (!_slot) return;
    const row = _slot.querySelector(`[data-tds-episode="${seasonNum}:${epNum}"]`);
    if (!row) return;

    const entry   = getEntry();
    const watched = P()?.isEpisodeWatched(entry, seasonNum, epNum) ?? false;
    const ep      = (_episodesResult?.episodes || []).find(
      (e) => e.seasonNumber === seasonNum && e.episodeNumber === epNum
    );
    const title = ep?.title || t("seasons.episodeNum", { n: epNum });

    row.classList.toggle("tds-episode--watched", watched);

    const titleEl = row.querySelector(".tds-ep-title");
    if (titleEl) titleEl.classList.toggle("tds-ep-title--placeholder", !ep?.title);

    const checkBtn = row.querySelector(".tds-ep-check");
    if (checkBtn) {
      checkBtn.classList.toggle("tds-ep-check--watched", watched);
      checkBtn.setAttribute("aria-checked", String(watched));
      const label = watched
        ? t("seasons.episodeUnwatch", { title })
        : t("seasons.episodeWatched", { title });
      checkBtn.setAttribute("aria-label", label);
      checkBtn.innerHTML = checkSvg(watched);
    }
  }

  function refreshAllEpisodeRows() {
    if (!_episodesResult?.episodes || !_slot) return;
    const entry = getEntry();
    (_episodesResult.episodes || []).forEach((ep) => {
      updateEpisodeRowStateFromEntry(entry, ep.seasonNumber, ep.episodeNumber, ep);
    });
  }

  function updateEpisodeRowStateFromEntry(entry, seasonNum, epNum, ep) {
    const row = _slot?.querySelector(`[data-tds-episode="${seasonNum}:${epNum}"]`);
    if (!row) return;
    const watched = P()?.isEpisodeWatched(entry, seasonNum, epNum) ?? false;
    const title = ep?.title || t("seasons.episodeNum", { n: epNum });
    row.classList.toggle("tds-episode--watched", watched);
    const checkBtn = row.querySelector(".tds-ep-check");
    if (checkBtn) {
      checkBtn.classList.toggle("tds-ep-check--watched", watched);
      checkBtn.setAttribute("aria-checked", String(watched));
      const label = watched
        ? t("seasons.episodeUnwatch", { title })
        : t("seasons.episodeWatched", { title });
      checkBtn.setAttribute("aria-label", label);
      checkBtn.innerHTML = checkSvg(watched);
    }
  }

  // ─── Action: toggle single episode ────────────────────────────────────────

  function handleToggleEpisode(epKey) {
    const [sStr, eStr] = epKey.split(":");
    const seasonNum    = parseInt(sStr, 10);
    const epNum        = parseInt(eStr, 10);
    if (!Number.isFinite(seasonNum) || !Number.isFinite(epNum)) return;

    const entry    = getEntry();
    const watched  = P()?.isEpisodeWatched(entry, seasonNum, epNum) ?? false;
    const allAired = airedEpisodeKeysForSeason(seasonNum);

    let newEntry;
    if (watched) {
      newEntry = P()?.unmarkEpisodeWatched(entry, seasonNum, epNum, allAired);
    } else {
      newEntry = P()?.markEpisodeWatched(entry, seasonNum, epNum, allAired);
    }

    // Save locally (no network request, no full re-render)
    saveEntry(newEntry);

    // 1. Update this episode row
    updateEpisodeRowState(seasonNum, epNum);
    // 2. Update season card in carousel
    refreshSeasonCard(seasonNum);
    // 3. Update selected-season info
    updateSeasonInfoProgress(seasonNum);
    // 4. Update main detail header watch state
    _callbacks?.updateHeaderWatchState?.();
    // 5. Update detail actions (watched button label may change)
    _callbacks?.updateDetailActions?.();
  }

  // ─── Action: mark / unmark whole season ───────────────────────────────────

  function handleMarkSeason(seasonNum) {
    const seasons = _seriesResult?.seasons || [];
    const season  = seasons.find((s) => s.seasonNumber === seasonNum);
    if (!season) return;

    const entry    = getEntry();
    const ws       = seasonWatchState(entry, season);
    const airedKeys = airedEpisodeKeysForSeason(seasonNum);

    let newEntry;
    if (ws === "watched") {
      // Unmark all episodes in this season
      const allAired = airedEpisodeKeysForSeason(seasonNum);
      newEntry = P()?.unmarkSeasonWatched(entry, seasonNum, allAired);
    } else {
      // Mark all aired episodes in this season
      newEntry = P()?.markSeasonWatched(entry, airedKeys);
    }

    saveEntry(newEntry);

    // Update all episode rows for this season
    if (_episodesResult?.seasonNum === seasonNum && _episodesResult?.episodes) {
      const freshEntry = _callbacks?.getWatchEntry?.() ?? null;
      (_episodesResult.episodes || []).forEach((ep) => {
        updateEpisodeRowStateFromEntry(freshEntry, ep.seasonNumber, ep.episodeNumber, ep);
      });
    }
    refreshSeasonCard(seasonNum);
    updateSeasonInfoProgress(seasonNum);
    _callbacks?.updateDetailActions?.();
  }

  // ─── Callback: title-level watched changed (from detail actions bar) ──────

  function onTitleWatchedChanged() {
    // Title was binary-watched or unwatched from the detail header action.
    // Re-read all episode/season states from the (now updated) entry.
    refreshAllEpisodeRows();
    const seasons = _seriesResult?.seasons || [];
    seasons.forEach((s) => refreshSeasonCard(s.seasonNumber));
    updateSeasonInfoProgress(_selectedSeason);
    // Don't call updateHeaderWatchState here — title-detail.js already did it.
  }

  // ─── Callback: external refresh (edit/move — detail sections were patched) ─

  function onExternalRefresh() {
    // Re-read watch entry in case it was modified externally; update display
    refreshAllEpisodeRows();
    const seasons = _seriesResult?.seasons || [];
    seasons.forEach((s) => refreshSeasonCard(s.seasonNumber));
    updateSeasonInfoProgress(_selectedSeason);
  }

  // ─── Language change ──────────────────────────────────────────────────────

  function onLangChange() {
    if (!_slot || !_seriesResult) return;
    const seasons = _seriesResult?.seasons || [];
    const saved   = _selectedSeason;

    // Re-render carousel labels (in-place, no scroll reset)
    seasons.forEach((s) => refreshSeasonCard(s.seasonNumber));
    updateNavButtonLabels();
    updateSeasonInfoProgress(saved);
    updateEpisodesTitle();

    const season = saved != null ? getSeasonByNum(saved) : null;
    if (season) _callbacks?.onSeasonSelected?.(season);

    // Re-render episode list labels if loaded
    if (_episodesResult?.episodes) {
      refreshAllEpisodeRows();
    }
  }

  function updateNavButtonLabels() {
    if (!_slot) return;
    const prevBtn = _slot.querySelector("[data-tds-action='prev-season']");
    const nextBtn = _slot.querySelector("[data-tds-action='next-season']");
    if (prevBtn) prevBtn.setAttribute("aria-label", t("seasons.prevSeason"));
    if (nextBtn) nextBtn.setAttribute("aria-label", t("seasons.nextSeason"));
  }

  // ─── Event binding ────────────────────────────────────────────────────────

  function bindSlotEvents() {
    if (!_slot) return;
    _slot.addEventListener("click", onSlotClick);
    _slot.addEventListener("keydown", onSlotKeydown);
  }

  function onSlotClick(event) {
    const target = event.target.closest("[data-tds-action]");
    if (!target) return;

    const action = target.dataset.tdsAction;
    event.stopPropagation();

    switch (action) {
      case "select-season": {
        const num = parseInt(target.dataset.tdsSeason, 10);
        if (Number.isFinite(num) && num !== _selectedSeason) selectSeason(num);
        break;
      }
      case "mark-season":
      case "mark-season-info": {
        const num = parseInt(target.dataset.tdsSeason, 10);
        if (Number.isFinite(num)) handleMarkSeason(num);
        break;
      }
      case "toggle-ep": {
        handleToggleEpisode(target.dataset.tdsEpisode);
        break;
      }
      case "prev-season": {
        const seasons = _seriesResult?.seasons || [];
        const prev    = seasons.filter((s) => s.seasonNumber < _selectedSeason).pop();
        if (prev) selectSeason(prev.seasonNumber);
        break;
      }
      case "next-season": {
        const seasons = _seriesResult?.seasons || [];
        const next    = seasons.find((s) => s.seasonNumber > _selectedSeason);
        if (next) selectSeason(next.seasonNumber);
        break;
      }
      case "retry-series": {
        // Clear cached resolution so resolveSeriesId runs fresh (clears negative cache too)
        _resolution = null;
        // Also attempt to clear any negative cache entries stored in series-metadata
        window.WatchlistSeriesMetadata?.clearItemResolutionCache?.(_item);
        getP("seasons-error")?.setAttribute("hidden", "");
        getP("seasons-loading")?.removeAttribute("hidden");
        loadSeriesMetadata();
        break;
      }
      case "retry-episodes": {
        if (_selectedSeason != null) loadEpisodes(_selectedSeason);
        break;
      }
      case "toggle-overview": {
        const overviewEl = getP("season-overview");
        if (!overviewEl) break;
        const expanded = overviewEl.classList.toggle("tds-season-info-overview--expanded");
        target.setAttribute("aria-expanded", String(expanded));
        break;
      }
    }
  }

  function onSlotKeydown(event) {
    // Carousel keyboard navigation (Left/Right arrows when carousel or a card is focused)
    const activeEl = document.activeElement;
    const inCarousel = _carouselEl?.contains(activeEl);
    if (!inCarousel) return;

    // Treat ArrowLeft as "previous season" and ArrowRight as "next season"
    // regardless of page RTL direction (seasons are always chronological L→R).
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      const seasons = _seriesResult?.seasons || [];
      if (event.key === "ArrowLeft") {
        const prev = [...seasons].reverse().find((s) => s.seasonNumber < _selectedSeason);
        if (prev) selectSeason(prev.seasonNumber);
      } else {
        const next = seasons.find((s) => s.seasonNumber > _selectedSeason);
        if (next) selectSeason(next.seasonNumber);
      }
    }
  }

  function bindCarouselEvents() {
    if (!_carouselEl) return;
    // Mouse drag
    _carouselEl.addEventListener("mousedown", onDragStart);
    _carouselEl.addEventListener("mousemove", onDragMove);
    _carouselEl.addEventListener("mouseup", onDragEnd);
    _carouselEl.addEventListener("mouseleave", onDragEnd);
    // Horizontal mouse wheel
    _carouselEl.addEventListener("wheel", onCarouselWheel, { passive: false });
  }

  function onDragStart(event) {
    _isDragging  = true;
    _dragStartX  = event.clientX + _carouselEl.scrollLeft;
    _carouselEl.classList.add("tds-carousel--grabbing");
  }

  function onDragMove(event) {
    if (!_isDragging) return;
    event.preventDefault();
    _carouselEl.scrollLeft = _dragStartX - event.clientX;
  }

  function onDragEnd() {
    if (!_isDragging) return;
    _isDragging = false;
    _carouselEl.classList.remove("tds-carousel--grabbing");
    // Snap to nearest season by click (scroll-snap handles it natively)
  }

  function onCarouselWheel(event) {
    if (Math.abs(event.deltaX) < Math.abs(event.deltaY)) {
      // Vertical wheel → scroll carousel horizontally
      event.preventDefault();
      _carouselEl.scrollLeft += event.deltaY;
    }
  }

  // ─── Utility ──────────────────────────────────────────────────────────────

  function getP(part) {
    return _slot?.querySelector(`[data-tds-part="${part}"]`) ?? null;
  }

  // ─── Public API ───────────────────────────────────────────────────────────

  window.WatchlistSeasons = {
    attach,
    detach,
    onLangChange,
    onTitleWatchedChanged,
    onExternalRefresh,
    getSelectedSeason: () => _selectedSeason,
  };
})();
