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
  let _activeTab = "seasons"; // "seasons" | "specials" | "movies"
  let _specialsAvailable = false;
  let _moviesResult = null;
  let _moviesLoading = false;
  let _selectedSeason = null;  // currently selected season number (int)
  let _episodesResult = null;  // { state, episodes, seasonNum }
  let _carouselEl     = null;  // .tds-carousel DOM element
  let _spoilerPosters = false; // hide episode stills behind season poster
  let _hideEpisodeRatings = false;
  let _hideFiller = false;
  let _fillerUiAvailable = false;
  let _activeEpisodeKey = null;
  let _episodeModalEditing = false;
  let _episodeModalEl = null;
  let _episodeListRender = null;
  let _episodeListGeneration = 0;
  let _episodesLoading = false;
  let _episodesPartialPainted = false;
  let _pendingSpecialsCheck = false;
  let _renderedSeasonNum = null;
  let _seasonEpisodeToken = 0;
  let _dragStartX     = 0;
  let _isDragging     = false;
  let _scrollToSeasonsObserver = null;

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
    let entry = newEntry;
    if (_episodesResult?.episodes?.length && _episodesResult?.seasonNum != null) {
      entry = rememberSeasonTotals(entry, _episodesResult.seasonNum, _episodesResult.episodes);
    }
    const annotated = annotateCompletion(entry);
    _callbacks?.saveWatchedEntry?.(annotated);
    _callbacks?.updateCardInPlace?.();
  }

  /** Persist per-season aired episode totals so reopening can derive watched state. */
  function rememberSeasonTotals(entry, seasonNum, episodes) {
    // Write directly to entry.progress (raw) — getProgress() returns a parsed copy
    // that doesn't write back, so mutations via it are silently lost.
    if (!entry || typeof entry !== "object" || !entry.progress || typeof entry.progress !== "object") return entry;
    if (!Array.isArray(episodes)) return entry;
    const rawProg = entry.progress;
    const seasonEps = episodes.filter((ep) => ep.seasonNumber === seasonNum);
    const airedCount = seasonEps.filter((ep) => ep.isAired !== false).length;
    if (!airedCount) return entry;
    if (!rawProg.seasonTotals) rawProg.seasonTotals = {};
    rawProg.seasonTotals[String(seasonNum)] = airedCount;
    if (seasonNum > 0) {
      const season = getSeasonByNum(seasonNum);
      if (season) season.episodeCount = airedCount;
    }
    return entry;
  }

  function seasonEpisodeTotal(season, entry) {
    const num = season.seasonNumber;
    const fromMeta = season.episodeCount ?? 0;
    if (fromMeta > 0) return fromMeta;
    const fromProgress = P()?.getProgress(entry)?.seasonTotals?.[String(num)];
    if (fromProgress > 0) return fromProgress;
    const airedEps = airedEpsForSeason(num);
    if (airedEps !== null) return airedEps.length;
    return 0;
  }

  function seasonMarkLabel(ws) {
    return ws === "watched"
      ? t("progress.unmarkSeasonWatched")
      : t("progress.markSeasonWatched");
  }

  function hydrateSeasonTotalsFromEntry() {
    const entry = getEntry();
    // Read seasonTotals directly from the raw progress object — parseProgressObject
    // used by getProgress() would silently strip the field.
    const rawProg = entry?.progress && typeof entry.progress === "object" ? entry.progress : null;
    const totals = rawProg?.seasonTotals;
    if (!totals || !_seriesResult?.seasons) return;

    // Detect corrupted totals from the TVDB lang-endpoint bug (every season
    // stored with the same series-wide episode count).
    const counts = _seriesResult.seasons
      .map((s) => totals[String(s.seasonNumber)])
      .filter((c) => c > 0);
    if (counts.length > 1 && new Set(counts).size === 1) {
      if (rawProg.seasonTotals) {
        delete rawProg.seasonTotals;
        _callbacks?.saveWatchedEntry?.(entry);
      }
      return;
    }

    for (const season of _seriesResult.seasons) {
      const count = totals[String(season.seasonNumber)];
      if (count > 0) season.episodeCount = count;
    }
  }

  function regularEpisodeTotalFromSeasons() {
    return window.WatchlistSeriesMetadata?.regularEpisodeTotalFromSeasons?.(
      _seriesResult?.seasons || []
    ) ?? null;
  }

  function persistRegularEpisodeTotal() {
    if (!_item?.id) return;
    const regular = (_seriesResult?.seasons || []).filter(isMainSeason);
    const seasonCount = regular.length;
    const total = regularEpisodeTotalFromSeasons();
    const patches = {};
    const isAnime = _item?.contentType === "anime";
    const anilistTotal = parseInt(
      String(_seriesResult?.series?.totalEpisodes || "").trim(),
      10
    );
    const multiSeasonAnime =
      isAnime && regular.length > 1;

    if (multiSeasonAnime) {
      patches.seasonCount = regular.length;
      if (total > 0) patches.episodeCount = total;
    } else if (isAnime && Number.isFinite(anilistTotal) && anilistTotal > 0) {
      patches.seasonCount = 1;
      patches.episodeCount = anilistTotal;
    } else {
      if (seasonCount > 0) patches.seasonCount = seasonCount;
      if (total > 0) patches.episodeCount = total;
    }
    if (!Object.keys(patches).length) return;

    let changed = false;
    for (const [key, value] of Object.entries(patches)) {
      if (Number(_item[key]) === value) continue;
      _item[key] = value;
      changed = true;
    }
    if (changed) {
      window.WatchlistApp?.patchItem?.(_item.id, patches);
    }
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
    // Must read/write from rawProg (entry.progress directly) — getProgress() returns
    // a parsed copy; any mutation on it is silently discarded.
    const rawProg = entry?.progress && typeof entry.progress === "object" ? entry.progress : null;
    if (!rawProg) return entry; // legacy-complete — no annotation needed

    const prog = P()?.getProgress(entry); // use parsed copy for reading episodes array
    if (!prog) return entry;

    const regularSeasons = (_seriesResult?.seasons || []).filter(isMainSeason);
    if (!regularSeasons.length) return entry;

    let allDone = true;
    let canDetermine = false; // true when at least one season has verifiable data
    for (const season of regularSeasons) {
      const sNum = season.seasonNumber;
      // For the currently-loaded season use exact aired keys
      if (_episodesResult?.seasonNum === sNum && _episodesResult?.episodes) {
        const airedKeys = (_episodesResult.episodes || [])
          .filter((ep) => ep.isAired !== false)
          .map((ep) => P()?.episodeKey(ep.seasonNumber, ep.episodeNumber))
          .filter(Boolean);
        if (airedKeys.length === 0) continue;
        canDetermine = true;
        const allInEntry = airedKeys.every((k) => prog.episodes.includes(k));
        if (!allInEntry) { allDone = false; break; }
      } else {
        // Season not loaded — use stored total or metadata episode count
        const count = seasonEpisodeTotal(season, entry);
        if (count === 0) continue; // unknown — skip but don't count as verified
        canDetermine = true;
        const watchedInSeason = prog.episodes.filter((k) => k.startsWith(`${sNum}:`)).length;
        if (watchedInSeason < count) { allDone = false; break; }
      }
    }

    // Only update the completed flag when we have enough data to decide.
    // If no season has verifiable data, preserve the existing flag so that
    // marking/unmarking specials alone never strips "completed" from a fully-watched title.
    if (!canDetermine) return entry;

    if (allDone) {
      rawProg.completed = true;  // write to raw — not to the parsed copy
    } else {
      delete rawProg.completed;
    }
    return entry;
  }

  // ─── Season helpers ────────────────────────────────────────────────────────

  function isTvOrAnime(item) {
    return item?.contentType === "tvSeries" || item?.contentType === "anime";
  }

  /** Regular TV cours — not specials (S0) or linked movies/OVAs. */
  function isMainSeason(season) {
    return Boolean(
      season &&
      season.seasonNumber > 0 &&
      !season.isSpecials
    );
  }

  /** Drop TV feature films from the Specials episode list (they live in Movies tab). */
  function filterSpecialsEpisodes(seasonNum, episodes) {
    if (seasonNum !== 0) return episodes || [];
    const isMovie = window.WatchlistSeriesMetadata?.isTvSpecialLinkedMovie;
    if (!isMovie) return episodes || [];
    return (episodes || []).filter((ep) => !isMovie(ep));
  }

  /** Collect aired episode keys for a given season from loaded episodes. */
  function airedEpisodeKeysForSeason(seasonNum) {
    if (_episodesResult?.seasonNum !== seasonNum || !_episodesResult?.episodes) return [];
    return (_episodesResult.episodes || [])
      .filter((ep) => ep.isAired !== false)
      .map((ep) => P()?.episodeKey(ep.seasonNumber, ep.episodeNumber))
      .filter(Boolean);
  }

  /** Aired episode keys from episode 1 through epNum (inclusive) in the loaded season. */
  function airedEpisodeKeysUpTo(seasonNum, epNum) {
    if (_episodesResult?.seasonNum !== seasonNum || !_episodesResult?.episodes) return [];
    return (_episodesResult.episodes || [])
      .filter((ep) => ep.isAired !== false && ep.episodeNumber <= epNum)
      .map((ep) => P()?.episodeKey(ep.seasonNumber, ep.episodeNumber))
      .filter(Boolean);
  }

  /** True when marking epNum watched would skip earlier unwatched aired episodes. */
  function hasUnwatchedPriorEpisodes(entry, seasonNum, epNum) {
    if (_episodesResult?.seasonNum !== seasonNum || !_episodesResult?.episodes) return false;
    return (_episodesResult.episodes || []).some((ep) => {
      if (ep.isAired === false || ep.episodeNumber >= epNum) return false;
      return !(P()?.isEpisodeWatched(entry, seasonNum, ep.episodeNumber) ?? false);
    });
  }

  /** True when any earlier regular season is not fully watched. */
  function hasUnwatchedPriorSeasons(entry, seasonNum) {
    return (_seriesResult?.seasons || []).some((season) => {
      const num = season.seasonNumber;
      if (num <= 0 || num >= seasonNum) return false;
      return seasonWatchState(entry, season) !== "watched";
    });
  }

  function shouldPromptGapFill(entry, seasonNum, epNum) {
    return (
      hasUnwatchedPriorEpisodes(entry, seasonNum, epNum) ||
      hasUnwatchedPriorSeasons(entry, seasonNum)
    );
  }

  function maxEpisodeNumberFromKeys(keys) {
    let max = 0;
    for (const key of keys || []) {
      const n = parseInt(String(key).split(":")[1], 10);
      if (Number.isFinite(n) && n > max) max = n;
    }
    return max;
  }

  async function promptGapFillKeys(entry, seasonNum, epNum) {
    if (!shouldPromptGapFill(entry, seasonNum, epNum) || !window.WatchlistDialog?.confirm) {
      return null;
    }
    const markAll = await window.WatchlistDialog.confirm(
      t("seasons.gapPromptMessage"),
      {
        title: t("seasons.gapPromptTitle"),
        confirmLabel: t("seasons.gapMarkAll"),
        cancelLabel: t("seasons.gapNo") || "No",
      }
    );
    if (!markAll) return null;
    return gapFillWatchKeys(entry, seasonNum, epNum);
  }

  /** Episode keys for prior seasons (full) plus current season through epNum. */
  function gapFillWatchKeys(entry, seasonNum, epNum) {
    const keys = [];
    for (const season of _seriesResult?.seasons || []) {
      const sNum = season.seasonNumber;
      if (sNum <= 0 || sNum > seasonNum) continue;
      if (sNum === seasonNum) {
        keys.push(...airedEpisodeKeysUpTo(seasonNum, epNum));
        continue;
      }
      if (_episodesResult?.seasonNum === sNum && _episodesResult?.episodes) {
        keys.push(...airedEpisodeKeysForSeason(sNum));
      } else {
        const count = seasonEpisodeTotal(season, entry);
        for (let i = 1; i <= count; i++) keys.push(`${sNum}:${i}`);
      }
    }
    return [...new Set(keys)];
  }

  function refreshEpisodeWatchUi(seasonNum) {
    if (_episodesResult?.seasonNum === seasonNum && _episodesResult?.episodes) {
      const freshEntry = getEntry();
      (_episodesResult.episodes || []).forEach((ep) => {
        updateEpisodeRowStateFromEntry(freshEntry, ep.seasonNumber, ep.episodeNumber, ep);
      });
    }
    (_seriesResult?.seasons || []).forEach((s) => refreshSeasonCard(s.seasonNumber));
    updateSeasonInfoProgress(seasonNum);
    _callbacks?.updateHeaderWatchState?.();
    _callbacks?.updateDetailActions?.();
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
    const airedEps = airedEpsForSeason(num);
    if (airedEps !== null) {
      const watched = P()?.watchedCountForSeason(entry, num, airedEps) ?? 0;
      const airedTotal = airedEps.length;
      return { watched, total: airedTotal, hasDetail: true };
    }

    const total = seasonEpisodeTotal(season, entry);

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
    const total = seasonEpisodeTotal(season, entry);
    if (total > 0 && watchedCount >= total) return "watched";
    return "partial";
  }

  function getSeasonByNum(seasonNum) {
    return (_seriesResult?.seasons || []).find((s) => s.seasonNumber === seasonNum) || null;
  }

  function seasonDisplayName(season) {
    if (!season) return "";
    const num = season.seasonNumber;
    if (season.isSpecials) return t("seasons.specials");
    if (season.isRelated && season.name) return season.name;
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
      const cleaned =
        window.WatchlistSeriesMetadata?.cleanEpisodeOverview?.(result.seasonOverview) ??
        result.seasonOverview;
      season.overview = cleaned || "";
      changed = true;
    }
    if (Array.isArray(result.episodes) && result.episodes.length > 0) {
      const seasonEps = result.episodes.filter((ep) => ep.seasonNumber === seasonNum);
      const airedCount = seasonEps.filter((ep) => ep.isAired !== false).length;
      const metaFloor = parseInt(String(season.episodeCount || "").trim(), 10);
      const seriesFloor =
        _item?.contentType === "anime" && seasonNum === 1
          ? parseInt(String(_seriesResult?.series?.totalEpisodes || "").trim(), 10)
          : null;
      const floor = Number.isFinite(metaFloor) && metaFloor > 0
        ? metaFloor
        : Number.isFinite(seriesFloor) && seriesFloor > 0
          ? seriesFloor
          : 0;
      const nextCount = Math.max(airedCount, floor);
      if (nextCount > 0 && season.episodeCount !== nextCount) {
        season.episodeCount = nextCount;
        changed = true;
      }
    }

    if (changed) {
      persistRegularEpisodeTotal();
      refreshSeasonCard(seasonNum);
      if (_selectedSeason === seasonNum) {
        notifySeasonPresentation(seasonNum, { progressOnly: true });
      }
    }
  }

  // ─── Initial season selection ─────────────────────────────────────────────

  function pickInitialSeason(seasons) {
    if (!seasons || seasons.length === 0) return null;

    const saved = _item?.lastSelectedSeason;
    if (saved != null && seasons.some((s) => s.seasonNumber === saved)) {
      return saved;
    }

    const regular = seasons.filter(isMainSeason);
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
    void window.WatchlistAniFiller?.ensureLoaded?.();
    bindSlotEvents();
    loadSeriesMetadata();
  }

  function detach() {
    closeEpisodeModal();
    unmountEpisodeModal();
    _token      = null;  // invalidate pending requests
    _slot       = null;
    _item       = null;
    _callbacks  = null;
    _resolution     = null;
    _seriesResult   = null;
    _selectedSeason = null;
    _activeTab      = "seasons";
    _specialsAvailable = false;
    _moviesResult   = null;
    _moviesLoading  = false;
    _episodesResult = null;
    _carouselEl     = null;
    _spoilerPosters = false;
    _hideEpisodeRatings = false;
    _hideFiller = false;
    _fillerUiAvailable = false;
    _activeEpisodeKey = null;
    _episodeListRender = null;
    _episodeListGeneration = 0;
    _episodesLoading = false;
    _episodesPartialPainted = false;
    _pendingSpecialsCheck = false;
    _renderedSeasonNum = null;
    _seasonEpisodeToken = 0;
    _isDragging     = false;
    disconnectScrollToSeasons();
  }

  // ─── Scroll-to-seasons FAB ────────────────────────────────────────────────

  function getDetailScrollEl() {
    return document.getElementById("tdScroll");
  }

  function disconnectScrollToSeasons() {
    _scrollToSeasonsObserver?.disconnect();
    _scrollToSeasonsObserver = null;
    const btn = getP("scroll-to-seasons");
    if (btn) btn.hidden = true;
  }

  function pickScrollWatchTarget() {
    const jump = getP("episode-jump");
    if (jump && !jump.hidden) return jump;
    const spoiler = getP("spoiler-row");
    if (spoiler && !spoiler.hidden) return spoiler;
    return getP("episodes-section")?.querySelector(".tds-episodes-header") || null;
  }

  function updateScrollToSeasonsButton(entry) {
    const btn = getP("scroll-to-seasons");
    const episodesSec = getP("episodes-section");
    if (!btn || !episodesSec || episodesSec.hidden) {
      btn?.setAttribute("hidden", "");
      return;
    }
    if (!getP("episode-modal")?.hidden) {
      btn.hidden = true;
      return;
    }
    if (_activeTab === "movies" || !_episodesResult?.episodes?.length) {
      btn.hidden = true;
      return;
    }

    const scrollEl = getDetailScrollEl();
    if (!scrollEl || !entry) {
      btn.hidden = true;
      return;
    }

    const rootRect = scrollEl.getBoundingClientRect();
    const show = !entry.isIntersecting && entry.boundingClientRect.bottom < rootRect.top;
    btn.hidden = !show;
  }

  function syncScrollToSeasonsWatcher() {
    disconnectScrollToSeasons();

    const scrollEl = getDetailScrollEl();
    const episodesSec = getP("episodes-section");
    const target = pickScrollWatchTarget();
    if (!scrollEl || !episodesSec || episodesSec.hidden || !target) return;
    if (_activeTab === "movies" || !_episodesResult?.episodes?.length) return;

    _scrollToSeasonsObserver = new IntersectionObserver(
      (entries) => updateScrollToSeasonsButton(entries[0]),
      { root: scrollEl, threshold: 0 }
    );
    _scrollToSeasonsObserver.observe(target);

    const btn = getP("scroll-to-seasons");
    if (btn) {
      btn.setAttribute("aria-label", t("seasons.scrollToControls"));
      btn.setAttribute("title", t("seasons.scrollToControls"));
    }
  }

  function scrollToSeasonsControls() {
    const scrollEl = getDetailScrollEl();
    if (!scrollEl || !_slot) return;

    let target = _slot.querySelector(".tds-series-tabs");
    if (_activeTab === "specials") {
      const specials = getP("specials-section");
      if (specials && !specials.hidden) target = specials;
    } else {
      const seasons = getP("seasons-section");
      if (seasons && !seasons.hidden) target = seasons;
    }
    if (!target) return;

    const scrollRect = scrollEl.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const top = scrollEl.scrollTop + (targetRect.top - scrollRect.top) - 4;
    scrollEl.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
  }

  // ─── Root HTML scaffold ───────────────────────────────────────────────────

  function buildRootHtml() {
    return `
      <div class="tds-root" aria-live="polite">
        <div class="tds-series-tabs" role="tablist" aria-label="${esc(t("detail.seriesTabsLabel"))}">
          <button type="button" class="tds-series-tab tds-series-tab--active" role="tab"
            id="tdsTabSeasons" aria-selected="true" aria-controls="tdsPanelSeasons"
            data-tds-tab="seasons">${esc(t("detail.tabSeasons"))}</button>
          <button type="button" class="tds-series-tab" role="tab"
            id="tdsTabSpecials" aria-selected="false" aria-controls="tdsPanelSpecials"
            data-tds-tab="specials">${esc(t("detail.tabSpecials"))}</button>
          <button type="button" class="tds-series-tab" role="tab"
            id="tdsTabMovies" aria-selected="false" aria-controls="tdsPanelMovies"
            data-tds-tab="movies">${esc(t("detail.tabMovies"))}</button>
        </div>
        <div class="tds-tab-panel" id="tdsPanelSeasons" role="tabpanel" aria-labelledby="tdsTabSeasons" data-tds-panel="seasons">
        <div class="tds-loading-section" data-tds-part="seasons-loading">
          <span class="tds-spinner" role="status" aria-label="${esc(t("seasons.loading"))}"></span>
          <span>${esc(t("seasons.loading"))}</span>
        </div>
        <div class="tds-error-section" data-tds-part="seasons-error" hidden></div>
        <div class="tds-stale-banner" data-tds-part="stale-banner" hidden></div>
        <div class="tds-seasons-section" data-tds-part="seasons-section" hidden>
          <div class="tds-carousel-wrap">
            <button class="tds-nav-btn tds-nav-btn--prev" data-tds-action="prev-season" hidden
              aria-label="${esc(t("seasons.prevSeason"))}">
              ${chevronSvg("left")}
            </button>
            <div class="tds-carousel" role="listbox"
              aria-label="${esc(t("seasons.sectionTitle"))}"
              tabindex="0"></div>
            <button class="tds-nav-btn tds-nav-btn--next" data-tds-action="next-season" hidden
              aria-label="${esc(t("seasons.nextSeason"))}">
              ${chevronSvg("right")}
            </button>
          </div>
          <div class="tds-season-actions" data-tds-part="season-actions" hidden>
            <button type="button" class="tds-season-mark-btn" data-tds-action="mark-season" data-tds-season=""></button>
            <p class="tds-season-actions__avg" data-tds-part="season-avg" hidden></p>
          </div>
        </div>
        </div>
        <div class="tds-tab-panel" id="tdsPanelSpecials" role="tabpanel" aria-labelledby="tdsTabSpecials" data-tds-panel="specials" hidden>
          <p class="tds-specials-empty" data-tds-part="specials-empty">${esc(t("detail.relatedSpecialsEmpty"))}</p>
          <div class="tds-specials-section" data-tds-part="specials-section" hidden>
            <div class="tds-carousel-wrap tds-carousel-wrap--single">
              <div class="tds-carousel" data-tds-part="specials-carousel" role="listbox"
                aria-label="${esc(t("seasons.specials"))}" tabindex="0"></div>
            </div>
            <div class="tds-season-actions" data-tds-part="specials-actions" hidden>
              <button type="button" class="tds-season-mark-btn" data-tds-action="mark-season" data-tds-season="0"></button>
              <p class="tds-season-actions__avg" data-tds-part="specials-avg" hidden></p>
            </div>
          </div>
        </div>
        <div class="tds-tab-panel" id="tdsPanelMovies" role="tabpanel" aria-labelledby="tdsTabMovies" data-tds-panel="movies" hidden>
          <div class="tds-movies-loading" data-tds-part="movies-loading">
            <span class="tds-spinner" role="status" aria-label="${esc(t("detail.relatedMoviesLoading"))}"></span>
            <span>${esc(t("detail.relatedMoviesLoading"))}</span>
          </div>
          <p class="tds-movies-empty" data-tds-part="movies-empty" hidden>${esc(t("detail.relatedMoviesEmpty"))}</p>
          <div class="tds-movies-list" data-tds-part="movies-list" hidden role="list"></div>
        </div>
        <div class="tds-episodes-section" data-tds-part="episodes-section" hidden>
          <div class="tds-episodes-header">
            <h3 class="tds-episodes-title" data-tds-label="episodes-title"></h3>
          </div>
          <div class="tds-spoiler-row" data-tds-part="spoiler-row" hidden>
            <button type="button" class="tds-spoiler-toggle" role="switch"
              aria-checked="false" data-tds-action="toggle-spoiler">
              <span class="tds-spoiler-toggle__label">${esc(t("seasons.spoilerMode"))}</span>
              <span class="tds-spoiler-toggle__track" aria-hidden="true">
                <span class="tds-spoiler-toggle__thumb"></span>
              </span>
            </button>
            <button type="button" class="tds-spoiler-toggle" role="switch"
              aria-checked="false" data-tds-action="toggle-hide-ratings">
              <span class="tds-spoiler-toggle__label">${esc(t("seasons.hideEpisodeRatings"))}</span>
              <span class="tds-spoiler-toggle__track" aria-hidden="true">
                <span class="tds-spoiler-toggle__thumb"></span>
              </span>
            </button>
            <button type="button" class="tds-spoiler-toggle" role="switch"
              aria-checked="false" data-tds-action="toggle-hide-filler" hidden>
              <span class="tds-spoiler-toggle__label">${esc(t("seasons.hideFiller"))}</span>
              <span class="tds-spoiler-toggle__track" aria-hidden="true">
                <span class="tds-spoiler-toggle__thumb"></span>
              </span>
            </button>
          </div>
          <div class="tds-episode-jump" data-tds-part="episode-jump" hidden>
            <label class="tds-episode-jump__label" for="tdsEpisodeJumpInput">${esc(t("seasons.jumpToEpisode"))}</label>
            <div class="tds-episode-jump__field">
              <input id="tdsEpisodeJumpInput" class="tds-episode-jump__input form-input"
                data-tds-part="episode-jump-input"
                type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="off"
                placeholder="${esc(t("seasons.jumpToEpisodePlaceholder"))}"
                aria-label="${esc(t("seasons.jumpToEpisode"))}" />
              <button type="button" class="tds-episode-jump__go" data-tds-action="jump-episode"
                aria-label="${esc(t("seasons.jumpToEpisodeGo"))}">↵</button>
            </div>
            <p class="tds-episode-jump__hint" data-tds-part="episode-jump-hint" hidden></p>
          </div>
          <div class="tds-episodes-status" data-tds-part="episodes-status" hidden></div>
          <div class="tds-episode-list" role="list" aria-live="polite"></div>
        </div>
        <button type="button" class="tds-scroll-to-seasons" data-tds-part="scroll-to-seasons"
          data-tds-action="scroll-to-seasons" hidden
          aria-label="${esc(t("seasons.scrollToControls"))}"
          title="${esc(t("seasons.scrollToControls"))}">
          ${chevronSvg("up")}
        </button>
        <div class="tds-episode-modal" data-tds-part="episode-modal" hidden>
          <div class="tds-episode-modal__backdrop" data-tds-action="close-episode-modal"></div>
          <div class="tds-episode-modal__panel" role="dialog" aria-modal="true" aria-labelledby="tdsEpisodeModalTitle">
            <button type="button" class="tds-episode-modal__close" data-tds-action="close-episode-modal" aria-label="${esc(t("btn.close"))}">✕</button>
            <div class="tds-episode-modal__media" data-tds-part="episode-modal-media"></div>
            <h4 class="tds-episode-modal__title" id="tdsEpisodeModalTitle" data-tds-part="episode-modal-title"></h4>
            <p class="tds-episode-modal__meta" data-tds-part="episode-modal-meta"></p>
            <p class="tds-episode-modal__overview" data-tds-part="episode-modal-overview" hidden></p>
            <div class="tds-episode-modal__ratings">
              <span class="tds-rating-chip tds-rating-chip--source" data-tds-part="episode-modal-source" hidden></span>
              <span class="tds-rating-chip tds-rating-chip--user" data-tds-part="episode-modal-user" hidden></span>
            </div>
            <div class="tds-episode-modal__form">
              <label class="tds-episode-modal__label" data-tds-part="episode-modal-label" for="tdsEpisodeRatingInput">${esc(t("seasons.yourEpisodeRating"))}</label>
              <input id="tdsEpisodeRatingInput" data-tds-part="episode-modal-input" type="number" min="0" max="10" step="0.1" placeholder="8.5" />
              <div class="tds-episode-modal__actions">
                <button type="button" class="tds-modal-btn tds-modal-btn--ghost" data-tds-action="close-episode-modal">${esc(t("btn.cancel"))}</button>
                <button type="button" class="tds-modal-btn" data-tds-action="save-episode-rating">${esc(t("btn.save"))}</button>
              </div>
            </div>
          </div>
        </div>
      </div>`;
  }

  function chevronSvg(dir) {
    const points = dir === "left"
      ? "15 18 9 12 15 6"
      : dir === "up"
        ? "18 15 12 9 6 15"
        : "9 18 15 12 9 6";
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="${points}"></polyline></svg>`;
  }

  function checkSvg(checked) {
    if (checked) {
      return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
    }
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"></circle></svg>`;
  }

  // ─── Related movies tab ───────────────────────────────────────────────────

  async function loadRelatedMovies(tok) {
    const meta = window.WatchlistSeriesMetadata;
    if (!meta?.fetchRelatedMovies || !_item || !_resolution) return;
    if (!isValid(tok)) return;

    _moviesLoading = true;
    renderMoviesPanel();

    try {
      const result = await meta.fetchRelatedMovies(_resolution, _item, getLocale());
      if (!isValid(tok)) return;
      _moviesResult = result;
    } catch {
      if (!isValid(tok)) return;
      _moviesResult = { movies: [] };
    } finally {
      if (!isValid(tok)) return;
      _moviesLoading = false;
      renderMoviesPanel();
    }
  }

  function getRegularSeasons() {
    return (_seriesResult?.seasons || []).filter(isMainSeason);
  }

  function getSpecialsSeason() {
    return (_seriesResult?.seasons || []).find(
      (s) => s.seasonNumber === 0 || s.isSpecials
    ) || null;
  }

  function updateSpecialsPanelState() {
    const emptyEl = getP("specials-empty");
    const sectionEl = getP("specials-section");
    const showContent = _specialsAvailable && !_item?.noSpecials;

    if (emptyEl) emptyEl.hidden = showContent;
    if (sectionEl) sectionEl.hidden = !showContent;
    if (showContent) renderSpecialsCarousel();
    syncEpisodesPanelForActiveTab();
  }

  function hideEpisodesSection() {
    const sec = getP("episodes-section");
    if (sec) {
      sec.hidden = true;
      sec.classList.remove("tds-episodes-section--ready");
    }
    _episodesLoading = false;
    disconnectScrollToSeasons();
    closeEpisodeModal();
    const listEl = _slot?.querySelector(".tds-episode-list");
    if (listEl) listEl.innerHTML = "";
    const statusEl = getP("episodes-status");
    if (statusEl) {
      statusEl.hidden = true;
      statusEl.innerHTML = "";
    }
  }

  /** Keep episode list aligned with the active tab (e.g. hide when Specials is empty). */
  function syncEpisodesPanelForActiveTab() {
    if (_activeTab === "movies") {
      hideEpisodesSection();
      return;
    }
    if (_activeTab === "specials" && (!_specialsAvailable || _item?.noSpecials)) {
      hideEpisodesSection();
    }
  }

  function renderSpecialsCarousel() {
    const carouselEl = getP("specials-carousel");
    if (!carouselEl) return;
    const specials = getSpecialsSeason();
    if (!specials || !_specialsAvailable || _item?.noSpecials) {
      carouselEl.innerHTML = "";
      return;
    }
    carouselEl.innerHTML = seasonCardHtml(specials);
    const card = carouselEl.querySelector(".tds-season-card");
    if (card) {
      card.classList.add("tds-season-card--selected");
      card.setAttribute("aria-selected", "true");
      card.setAttribute("tabindex", "0");
    }
  }

  function setSpecialsAvailable(available) {
    _specialsAvailable = Boolean(available);
    updateSpecialsPanelState();
  }

  function switchSeriesTab(tab) {
    const allowed = ["seasons", "specials", "movies"];
    const next = allowed.includes(tab) ? tab : "seasons";
    if (_activeTab === next) return;
    _activeTab = next;

    const panels = _slot?.querySelectorAll("[data-tds-panel]") || [];
    panels.forEach((panel) => {
      panel.toggleAttribute("hidden", panel.dataset.tdsPanel !== next);
    });

    const tabs = _slot?.querySelectorAll("[data-tds-tab]") || [];
    tabs.forEach((btn) => {
      const active = btn.dataset.tdsTab === next;
      btn.classList.toggle("tds-series-tab--active", active);
      btn.setAttribute("aria-selected", active ? "true" : "false");
    });

    const episodesSec = getP("episodes-section");
    if (next === "movies") {
      episodesSec?.setAttribute("hidden", "");
      disconnectScrollToSeasons();
      closeEpisodeModal();
      _callbacks?.resetHeaderSeasonPresentation?.();
    }

    if (next === "specials") {
      _callbacks?.resetHeaderSeasonPresentation?.();
      if (_specialsAvailable && getSpecialsSeason()) {
        selectSeason(0, { animate: false, skipTabSwitch: true });
      } else {
        hideEpisodesSection();
      }
    } else if (next === "seasons") {
      const target = _selectedSeason > 0
        ? _selectedSeason
        : pickInitialSeason(getRegularSeasons());
      if (target != null) {
        selectSeason(target, { animate: false, skipTabSwitch: true });
      }
    }

    tabs.forEach((btn) => {
      if (btn.dataset.tdsTab === next) btn.focus();
    });
  }

  function relatedMovieMetaLine(movie) {
    const parts = [];
    if (movie.year) parts.push(movie.year);
    if (movie.runtimeMinutes) {
      parts.push(t("seasons.epRuntime", { n: movie.runtimeMinutes }));
    }
    if (movie.score != null && Number.isFinite(movie.score)) {
      parts.push(`${movie.score}%`);
    }
    return parts.join(" · ");
  }

  function relatedMovieCardHtml(movie, index) {
    const onList = window.WatchlistApp?.isTitleOnList?.({
      title: movie.title,
      anilistId: movie.anilistId,
      year: movie.year,
    });
    const poster = movie.poster || getItemPoster() || "";
    const meta = relatedMovieMetaLine(movie);
    const overview = String(movie.overview || "").trim();
    const snippet = overview.length > 140 ? `${overview.slice(0, 137)}…` : overview;

    return `<button type="button" class="tds-movie-card" role="listitem"
      data-tds-action="open-related-movie" data-tds-movie-index="${index}"
      ${onList ? ' data-tds-on-list="true"' : ""}
      aria-label="${esc(movie.title)}">
      <div class="tds-movie-card__poster-wrap">
        ${poster
          ? `<img class="tds-movie-card__poster" src="${esc(poster)}" alt="" loading="lazy" />`
          : `<div class="tds-movie-card__poster tds-movie-card__poster--empty" aria-hidden="true">🎬</div>`}
      </div>
      <div class="tds-movie-card__body">
        <p class="tds-movie-card__title">${esc(movie.title)}</p>
        ${meta ? `<p class="tds-movie-card__meta">${esc(meta)}</p>` : ""}
        ${snippet ? `<p class="tds-movie-card__summary">${esc(snippet)}</p>` : ""}
        <p class="tds-movie-card__cta">${esc(onList ? t("detail.relatedMovieOnList") : t("detail.relatedMovieAdd"))}</p>
      </div>
    </button>`;
  }

  function renderMoviesPanel() {
    if (!_slot) return;
    const loadingEl = getP("movies-loading");
    const emptyEl = getP("movies-empty");
    const listEl = getP("movies-list");
    const movies = _moviesResult?.movies || [];

    if (loadingEl) loadingEl.hidden = !_moviesLoading;
    if (_moviesLoading) {
      emptyEl?.setAttribute("hidden", "");
      listEl?.setAttribute("hidden", "");
      return;
    }

    if (!movies.length) {
      emptyEl?.removeAttribute("hidden");
      listEl?.setAttribute("hidden", "");
      if (listEl) listEl.innerHTML = "";
      return;
    }

    emptyEl?.setAttribute("hidden", "");
    listEl?.removeAttribute("hidden");
    if (listEl) {
      listEl.innerHTML = movies.map((m, i) => relatedMovieCardHtml(m, i)).join("");
    }
  }

  async function openRelatedMovie(index) {
    const movie = _moviesResult?.movies?.[Number(index)];
    if (!movie?.title) return;

    const WM = window.WatchlistMetadata;
    const App = window.WatchlistApp;
    if (!WM || !App?.openAddTitleConfirm) return;

    let details = null;
    if (movie.anilistId) {
      details = await WM.fetchAnilistById(movie.anilistId);
    } else if (movie.pick) {
      details = await WM.getDetailsForPick(movie.pick, { preferAnime: _item?.contentType === "anime" });
    }

    if (!details?.title) {
      details = {
        title: movie.title,
        plot: movie.overview || "",
        poster: movie.poster || "",
        year: movie.year || "",
        contentType: _item?.contentType === "anime" ? "anime" : "movies",
        mediaType: _item?.contentType === "anime" ? "anime" : "movie",
        omdbType: _item?.contentType === "anime" ? "anime" : "movie",
        genres: _item?.genre ? [_item.genre] : [],
      };
    }

    if (_item?.contentType === "anime") {
      details = await WM.ensureAnimeDetails(details, { forceAnime: true });
    }

    const defaultContentType = _item?.contentType === "anime" ? "anime" : "movies";
    await App.openAddTitleConfirm(details, { defaultContentType });
  }

  // ─── Metadata loading ─────────────────────────────────────────────────────

  /** Legacy anime rows may store IMDb as primary link — resolve AniList before seasons load. */
  async function ensureAnimeItemLink() {
    if (_item?.contentType !== "anime") return;
    const WM = window.WatchlistMetadata;
    const link = String(_item?.link || "").trim();
    if (WM?.extractAnilistId?.(link) || WM?.extractMalId?.(link)) return;

    const match = await WM?.fetchAnilistMatchByTitle?.(_item.title, _item.year);
    if (!match?.anilistId) return;

    const anilistLink = `https://anilist.co/anime/${match.anilistId}/`;
    const patches = { link: anilistLink, anilistId: match.anilistId };
    const imdbId = WM?.extractImdbId?.(link);
    if (imdbId && !_item.imdbLink) {
      patches.imdbLink = link.startsWith("http")
        ? link
        : `https://www.imdb.com/title/${imdbId}/`;
    }
    _item = { ..._item, ...patches };
    if (_item.id) window.WatchlistApp?.patchItem?.(_item.id, patches);
  }

  async function loadSeriesMetadata() {
    const tok = _token;
    const meta = window.WatchlistSeriesMetadata;
    if (!meta || !_item) return;

    const SERIES_LOAD_TIMEOUT_MS = 90000;

    // Log configuration status for debugging (never logs key values)
    if (!window.__tdsConfigLogged) {
      window.__tdsConfigLogged = true;
      const WM = window.WatchlistMetadata;
      console.info(
        "[title-seasons] API config —",
        "TMDb:", WM?.hasTmdbKey?.() ? "yes" : "no",
        "| OMDb:", WM?.hasOmdbKey?.() ? "yes" : "no",
        "| AniList: yes (public)",
        "| TVDB:", (window.WATCHLIST_CONFIG?.supabaseUrl && window.WatchlistTvdb) ? "yes" : "no",
      );
    }

    const loadWithTimeout = () =>
      Promise.race([
        (async () => {
          await ensureAnimeItemLink();
          const resolution = await meta.resolveSeriesId(_item);
          if (!isValid(tok)) return null;

          _resolution = resolution;
          const WM = window.WatchlistMetadata;
          const linkImdb =
            WM?.extractImdbId?.(_item?.imdbLink) ||
            WM?.extractImdbId?.(_item?.link);
          if (linkImdb && !_resolution.imdbId) {
            _resolution = { ..._resolution, imdbId: linkImdb };
          }

          void loadRelatedMovies(tok);

          const locale = getLocale();
          const poster = getItemPoster();
          return meta.fetchSeriesMetadata(_resolution, locale, poster);
        })(),
        new Promise((_, reject) => {
          setTimeout(() => reject(new Error("series-metadata-timeout")), SERIES_LOAD_TIMEOUT_MS);
        }),
      ]);

    let result;
    try {
      result = await loadWithTimeout();
    } catch (err) {
      if (!isValid(tok)) return;
      console.warn("[title-seasons] series metadata load failed:", err?.message || err);
      const RS = meta.ResultState;
      const stale = _seriesResult?.seasons?.length
        ? { ..._seriesResult, state: RS.OFFLINE_WITH_CACHE, isStale: true }
        : null;
      if (stale) {
        _seriesResult = stale;
        renderSeasonsSection(stale);
        showStale(t("seasons.staleWarning"));
      } else {
        showError(
          err?.message === "series-metadata-timeout"
            ? t("seasons.error")
            : (navigator.onLine === false ? t("seasons.offlineNoCache") : t("seasons.error")),
          "retry-series"
        );
      }
      return;
    }

    if (!isValid(tok)) return;

    const seriesImdb = result?.series?.imdbId;
    if (seriesImdb && !_resolution.imdbId) {
      _resolution = { ..._resolution, imdbId: seriesImdb };
    }

    if (result?.seasons?.length) {
      const cleanOverview = meta.cleanEpisodeOverview;
      if (cleanOverview) {
        result.seasons = result.seasons.map((season) => ({
          ...season,
          overview: cleanOverview(season.overview) || "",
        }));
      }
    }

    _seriesResult = result;
    persistRegularEpisodeTotal();
    const RS = meta.ResultState;

    switch (result?.state) {
      case RS.AVAILABLE:
      case RS.PARTIALLY_AVAILABLE:
      case RS.EPISODE_DETAILS_UNAVAILABLE:
        renderSeasonsSection(result);
        if (result.isStale) showStale(t("seasons.staleWarning"));
        break;

      case RS.OFFLINE_WITH_CACHE:
        renderSeasonsSection(result);
        showStale(t("seasons.offline"));
        break;

      case RS.OFFLINE_NO_CACHE:
        showError(t("seasons.offlineNoCache"), "retry-series");
        break;

      case RS.API_FAILURE:
        if (result?.seasons?.length) {
          renderSeasonsSection(result);
          showStale(t("seasons.staleWarning"));
        } else {
          showError(t("seasons.error"), "retry-series");
        }
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
      default:
        showError(t("seasons.error"), "retry-series");
        break;
    }
  }

  async function loadEpisodes(seasonNum, { loadTok = null } = {}) {
    const tok = _token;
    const meta = window.WatchlistSeriesMetadata;
    if (!meta || !_item || !_resolution) return;

    showEpisodesLoading();
    _episodesPartialPainted = false;

    const locale = getLocale();
    const poster = getItemPoster();
    const seasonSummary = (_seriesResult?.seasons || []).find(
      (s) => s.seasonNumber === seasonNum
    ) || null;

    try {
      const result = await meta.fetchSeasonEpisodes(
        _resolution,
        seasonNum,
        locale,
        poster,
        seasonSummary,
        _item,
        {
          onPartial: (partial) => {
            if (!isValid(tok)) return;
            if (loadTok != null && loadTok !== _seasonEpisodeToken) return;
            if (_selectedSeason !== seasonNum) return;
            applyEpisodesPayload(seasonNum, partial, { partial: true, loadTok });
          },
        }
      );
      if (!isValid(tok)) return;
      if (loadTok != null && loadTok !== _seasonEpisodeToken) return;
      if (_selectedSeason !== seasonNum) return;

      if (!result) {
        showEpisodesStatus(t("seasons.episodesError"), "retry-episodes");
        return;
      }

      applyEpisodesPayload(seasonNum, result, { partial: false, loadTok });
    } catch (err) {
      if (!isValid(tok)) return;
      if (loadTok != null && loadTok !== _seasonEpisodeToken) return;
      if (_selectedSeason !== seasonNum) return;
      console.warn("[title-seasons] episode load failed:", err?.message || err);
      showEpisodesStatus(t("seasons.episodesError"), "retry-episodes");
    } finally {
      if (
        isValid(tok) &&
        _selectedSeason === seasonNum &&
        (loadTok == null || loadTok === _seasonEpisodeToken) &&
        _episodesLoading &&
        !_episodesPartialPainted &&
        !_episodesResult?.episodes?.length
      ) {
        showEpisodesStatus(t("seasons.episodesError"), "retry-episodes");
      }
      runPendingSpecialsCheck();
    }
  }

  function applyEpisodesPayload(seasonNum, result, { partial = false, loadTok = null } = {}) {
    const meta = window.WatchlistSeriesMetadata;
    if (!meta || !result) return;
    if (loadTok != null && loadTok !== _seasonEpisodeToken) return;
    if (_selectedSeason !== seasonNum) return;

    const displayEps = filterSpecialsEpisodes(seasonNum, result?.episodes);
    const displayResult =
      displayEps !== result?.episodes
        ? { ...result, episodes: displayEps }
        : result;

    const seasonSummary = (_seriesResult?.seasons || []).find(
      (s) => s.seasonNumber === seasonNum
    ) || null;
    if (
      displayEps.length > 0 &&
      meta.episodesPlausibleForSeason &&
      !meta.episodesPlausibleForSeason(displayEps, seasonSummary, seasonNum, {
        seasonAnilistId: Number(seasonSummary?.anilistId),
        rootAnilistId: Number(_resolution?.anilistId),
      })
    ) {
      if (partial) return;
      showEpisodesStatus(t("seasons.episodesError"), "retry-episodes");
      return;
    }

    const prevCount = _episodesResult?.episodes?.length || 0;
    _episodesResult = {
      ...displayResult,
      seasonNum,
      episodes: displayEps.map((ep) => ({
        ...ep,
        seasonNumber: seasonNum,
        progressKey: `${seasonNum}:${ep.episodeNumber}`,
      })),
    };
    _fillerUiAvailable = Boolean(displayResult?.fillerUiAvailable);
    const RS = meta.ResultState;

    if (!partial) {
      patchSeasonFromEpisodeResult(seasonNum, displayResult);
    }

    switch (displayResult?.state) {
      case RS.AVAILABLE:
      case RS.OFFLINE_WITH_CACHE:
      case RS.PARTIALLY_AVAILABLE:
      case RS.EPISODE_DETAILS_UNAVAILABLE: {
        const eps = displayEps;
        if (eps.length > 0) {
          if (seasonNum === 0) {
            const airedCount = eps.filter((ep) => ep.isAired !== false).length;
            if (airedCount === 0) {
              if (!partial) removeSpecialsFromCarousel();
              return;
            }
          }
          if (partial) {
            _episodesPartialPainted = true;
            renderEpisodeList(seasonNum, eps);
            return;
          }
          if (
            _episodesPartialPainted &&
            eps.length === prevCount &&
            seasonNum === _selectedSeason &&
            seasonNum === _renderedSeasonNum &&
            _episodesResult?.seasonNum === seasonNum
          ) {
            patchEpisodeRowsEnrichment(seasonNum, eps);
          } else {
            renderEpisodeList(seasonNum, eps);
          }
          _episodesPartialPainted = false;
          if (result.state === RS.OFFLINE_WITH_CACHE) {
            showEpisodesStatus(t("seasons.offline"), null, { keepList: true });
          } else if (displayResult.state === RS.EPISODE_DETAILS_UNAVAILABLE) {
            showEpisodesStatus(t("seasons.episodesUnavailable"), null, { keepList: true });
          }
          refreshSeasonCard(seasonNum);
          if (!partial) reannotateExistingEntry();
          return;
        }
        if (partial) return;
        if (seasonNum === 0) { removeSpecialsFromCarousel(); return; }
        if (displayResult.state === RS.EPISODE_DETAILS_UNAVAILABLE) {
          showEpisodesStatus(t("seasons.episodesUnavailable"), null);
          return;
        }
        showEpisodesStatus(t("seasons.episodesError"), "retry-episodes");
        return;
      }

      case RS.OFFLINE_NO_CACHE:
        if (partial) return;
        if (seasonNum === 0) { removeSpecialsFromCarousel(); return; }
        showEpisodesStatus(
          navigator.onLine === false ? t("seasons.offlineNoCache") : t("seasons.episodesError"),
          "retry-episodes"
        );
        return;

      case RS.API_FAILURE:
        if (partial) return;
        if (seasonNum === 0) { removeSpecialsFromCarousel(); return; }
        showEpisodesStatus(t("seasons.episodesError"), "retry-episodes");
        return;

      case RS.EPISODE_DETAILS_UNAVAILABLE:
        if (partial) return;
        if (seasonNum === 0) { removeSpecialsFromCarousel(); return; }
        showEpisodesStatus(t("seasons.episodesUnavailable"), null);
        return;

      case RS.RATE_LIMITED:
        if (partial) return;
        showEpisodesStatus(t("seasons.rateLimited"), "retry-episodes");
        return;

      case null:
      case undefined:
        if (partial) return;
        if (seasonNum === 0) { removeSpecialsFromCarousel(); return; }
        showEpisodesStatus(t("seasons.episodesUnavailable"), null);
        return;

      default:
        if (partial) return;
        if (seasonNum === 0) { removeSpecialsFromCarousel(); return; }
        showEpisodesStatus(t("seasons.episodesError"), "retry-episodes");
        return;
    }
  }

  function runPendingSpecialsCheck() {
    if (!_pendingSpecialsCheck) return;
    _pendingSpecialsCheck = false;
    void silentlyCheckSpecials();
  }

  /** Remove specials from metadata and hide the Specials tab when season 0 is empty. */
  function removeSpecialsFromCarousel() {
    if (!_seriesResult?.seasons) return;
    _seriesResult.seasons = _seriesResult.seasons.filter((s) => s.seasonNumber !== 0);
    setSpecialsAvailable(false);
    persistRegularEpisodeTotal();
    if (_item?.id) {
      window.WatchlistApp?.patchItem?.(_item.id, { noSpecials: true });
    }
    if (_activeTab === "specials") {
      switchSeriesTab("seasons");
    }
  }

  // ─── Rendering: seasons section ───────────────────────────────────────────

  function renderSeasonsSection(result) {
    if (!_slot) return;
    const allSeasons = result?.seasons || [];
    const regularSeasons = allSeasons.filter(isMainSeason);
    const specialsSeason = allSeasons.find((s) => s.seasonNumber === 0);

    if (specialsSeason && !_item?.noSpecials && specialsSeason.episodeCount !== 0) {
      setSpecialsAvailable(true);
    } else if (_item?.noSpecials || specialsSeason?.episodeCount === 0) {
      setSpecialsAvailable(false);
    } else if (specialsSeason) {
      setSpecialsAvailable(true);
    } else {
      setSpecialsAvailable(false);
    }

    if (!regularSeasons.length) {
      showError(t("seasons.noSeasons"), null);
      return;
    }

    getP("seasons-loading")?.setAttribute("hidden", "");
    getP("seasons-error")?.setAttribute("hidden", "");
    getP("seasons-section")?.removeAttribute("hidden");

    const carouselEl = _slot.querySelector(".tds-carousel");
    if (carouselEl) carouselEl.setAttribute("aria-label", t("seasons.sectionTitle"));

    hydrateSeasonTotalsFromEntry();
    persistRegularEpisodeTotal();

    renderCarousel(regularSeasons);

    if (specialsSeason && specialsSeason.episodeCount == null) {
      _pendingSpecialsCheck = true;
    }

    const saved = _item?.lastSelectedSeason;
    if (saved === 0 && _specialsAvailable && getSpecialsSeason()) {
      switchSeriesTab("specials");
    } else {
      const initial = pickInitialSeason(regularSeasons);
      if (initial !== null) selectSeason(initial, { animate: false });
    }
  }

  /** Fetch Season 0 episodes in the background; remove the carousel card if empty/error. */
  async function silentlyCheckSpecials() {
    const tok = _token;
    const meta = window.WatchlistSeriesMetadata;
    if (!meta || !_item || !_resolution) return;
    const locale = getLocale();
    const poster = getItemPoster();
    const seasonSummary = (_seriesResult?.seasons || []).find((s) => s.seasonNumber === 0) || null;
    try {
      const result = await meta.fetchSeasonEpisodes(
        _resolution, 0, locale, poster, seasonSummary, _item
      );
      if (!isValid(tok)) return; // panel was closed while fetching
      const RS = meta.ResultState;
      const hasEpisodes =
        result?.state === RS.AVAILABLE || result?.state === RS.OFFLINE_WITH_CACHE
          ? filterSpecialsEpisodes(0, result.episodes || []).filter((ep) => ep.isAired !== false).length > 0
          : false;
      if (!hasEpisodes) {
        removeSpecialsFromCarousel();
      } else {
        setSpecialsAvailable(true);
        patchSeasonFromEpisodeResult(0, {
          ...result,
          episodes: filterSpecialsEpisodes(0, result.episodes || []),
        });
      }
    } catch (_) {
      // Network error — leave the card; removeSpecialsFromCarousel will run if they tap it
    }
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

    const markLabel = seasonMarkLabel(ws);

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

  function selectSeason(seasonNum, { animate = true, skipTabSwitch = false } = {}) {
    if (_selectedSeason === seasonNum && animate && _episodesResult?.seasonNum === seasonNum) {
      return;
    }
    closeEpisodeModal();
    resetEpisodeJumpInput();
    _seasonEpisodeToken += 1;
    const loadTok = _seasonEpisodeToken;
    _selectedSeason = seasonNum;

    if (!skipTabSwitch) {
      if (seasonNum === 0 && _activeTab !== "specials") {
        switchSeriesTab("specials");
        return;
      }
      if (seasonNum > 0 && _activeTab !== "seasons") {
        switchSeriesTab("seasons");
        return;
      }
    }

    if (seasonNum > 0) {
      updateCarouselSelection(seasonNum);
      scrollToSeasonCard(seasonNum, animate);
    }
    notifySeasonPresentation(seasonNum);

    cancelEpisodeListRender();
    _episodesPartialPainted = false;
    _renderedSeasonNum = null;
    _episodesResult = { seasonNum, episodes: [] };
    showEpisodesLoading();
    updateEpisodesTitle();

    void loadEpisodes(seasonNum, { loadTok });
    updateNavButtons(getRegularSeasons());
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
    // scrollIntoView with inline:'center' handles both LTR and RTL scroll containers
    card.scrollIntoView({
      inline: "center",
      block: "nearest",
      behavior: animate ? "smooth" : "instant",
    });
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

  // ─── Header season summary (via title-detail callback) ───────────────────

  function buildSeasonPresentation(season) {
    const entry = getEntry();
    const ws = seasonWatchState(entry, season);
    const prog = seasonProgressFromEntry(entry, season);
    const name = seasonDisplayName(season);
    const year = season.airDate ? season.airDate.slice(0, 4) : "";
    return {
      season,
      ws,
      prog,
      name,
      year,
      markLabel: seasonMarkLabel(ws),
    };
  }

  function persistSeasonPoster(season) {
    if (!_item || !season || season.seasonNumber === 0) return;
    const poster = season.poster || getItemPoster() || "";
    const seasonNum = season.seasonNumber;
    const seasonName = seasonDisplayName(season);
    const changed =
      (poster && _item.cardPoster !== poster) ||
      _item.lastSelectedSeason !== seasonNum ||
      _item.cardSeasonName !== seasonName;
    if (poster) _item.cardPoster = poster;
    _item.lastSelectedSeason = seasonNum;
    _item.cardSeasonName = seasonName;
    if (changed) {
      const patch = {
        lastSelectedSeason: seasonNum,
        cardSeasonName: seasonName,
      };
      if (poster) patch.cardPoster = poster;
      window.WatchlistApp?.patchItem?.(_item.id, patch);
      _callbacks?.updateCardInPlace?.();
    }
  }

  function notifySeasonPresentation(seasonNum, { progressOnly = false, persistPoster = true } = {}) {
    const season = getSeasonByNum(seasonNum);
    if (!season) return;

    if (seasonNum === 0) {
      if (!progressOnly) renderSpecialsCarousel();
      updateSeasonActions(seasonNum);
      return;
    }

    if (!progressOnly) {
      if (persistPoster) persistSeasonPoster(season);
      _callbacks?.onSeasonSelected?.(buildSeasonPresentation(season));
    }
    updateSeasonActions(seasonNum);
  }

  function updateSeasonActions(seasonNum) {
    const isSpecials = seasonNum === 0;
    const actionsEl = getP(isSpecials ? "specials-actions" : "season-actions");
    const otherEl = getP(isSpecials ? "season-actions" : "specials-actions");
    if (otherEl) otherEl.hidden = true;

    if (!actionsEl) return;
    const season = getSeasonByNum(seasonNum);
    if (!season) {
      actionsEl.hidden = true;
      return;
    }

    const entry = getEntry();
    const ws = seasonWatchState(entry, season);

    const avgPart = isSpecials ? "specials-avg" : "season-avg";
    const avgEl = actionsEl.querySelector(`[data-tds-part='${avgPart}']`);
    const markBtn = actionsEl.querySelector("[data-tds-action='mark-season']");
    if (markBtn) {
      markBtn.textContent = seasonMarkLabel(ws);
      markBtn.dataset.tdsSeason = String(seasonNum);
      markBtn.classList.toggle("tds-season-mark-btn--complete", ws === "watched");
    }
    if (avgEl) {
      const seasonEpisodes = (_episodesResult?.seasonNum === seasonNum && Array.isArray(_episodesResult?.episodes))
        ? _episodesResult.episodes
        : [];
      const sourceAvg = seasonAverageExternalRating(seasonEpisodes);
      const avgSource = episodeExternalRatingSource(seasonEpisodes);
      avgEl.textContent = sourceAvg != null
        ? (avgSource === "imdb"
            ? t("seasons.seasonAvgOmdb", { rating: formatRatingValue(sourceAvg) })
            : t("seasons.seasonAvgSource", { rating: formatRatingValue(sourceAvg) }))
        : "";
      avgEl.classList.toggle("tds-season-avg-badge", sourceAvg != null);
      avgEl.hidden = sourceAvg == null;
    }
    actionsEl.hidden = _activeTab !== (isSpecials ? "specials" : "seasons");
  }

  function updateSeasonInfoProgress(seasonNum) {
    updateSeasonActions(seasonNum);
  }

  // ─── Rendering: episode list ───────────────────────────────────────────────

  function cancelEpisodeListRender() {
    _episodeListGeneration += 1;
    _episodeListRender = null;
  }

  function setEpisodesSectionReady(ready) {
    const sec = getP("episodes-section");
    if (sec) sec.classList.toggle("tds-episodes-section--ready", ready);
  }

  function showEpisodesLoading() {
    const sec = getP("episodes-section");
    const statusEl = getP("episodes-status");
    const listEl = _slot?.querySelector(".tds-episode-list");
    if (!sec) return;

    cancelEpisodeListRender();
    _episodesPartialPainted = false;
    _episodesLoading = true;
    setEpisodesSectionReady(false);

    if (statusEl) {
      statusEl.innerHTML = `<span class="tds-spinner" role="status" aria-label="${esc(t("seasons.episodesLoading"))}"></span>${esc(t("seasons.episodesLoading"))}`;
      statusEl.hidden = false;
    }
    if (listEl) listEl.innerHTML = "";
    sec.hidden = false;

    updateEpisodesTitle();
    syncScrollToSeasonsWatcher();
  }

  function showEpisodesStatus(msg, retryAction, { keepList = false } = {}) {
    _episodesLoading = false;
    if (!keepList) setEpisodesSectionReady(false);
    const sec = getP("episodes-section");
    if (sec) sec.hidden = false;
    const statusEl = getP("episodes-status");
    const listEl   = _slot?.querySelector(".tds-episode-list");
    if (statusEl) {
      statusEl.innerHTML = `<span>${esc(msg)}</span>`
        + (retryAction
          ? ` <button class="tds-retry-btn" data-tds-action="${esc(retryAction)}">${esc(t("seasons.retry"))}</button>`
          : "");
      statusEl.hidden = false;
    }
    if (listEl && !keepList) listEl.innerHTML = "";
    if (!keepList) updateEpisodesTitle();
  }

  function episodesForDisplay(episodes) {
    const list = episodes || [];
    const AF = window.WatchlistAniFiller;
    if (!_hideFiller || !AF) return list;
    return list.filter((ep) => !AF.shouldHideEpisode(ep, true));
  }

  function fillerBadgeHtml(fillerKind) {
    const AF = window.WatchlistAniFiller;
    if (!AF?.isBadgeKind?.(fillerKind)) return "";
    return `<span class="tds-ep-filler-badge tds-ep-filler-badge--filler">${esc(t("seasons.fillerBadge"))}</span>`;
  }

  function renderEpisodeList(seasonNum, episodes) {
    const listEl   = _slot?.querySelector(".tds-episode-list");
    const statusEl = getP("episodes-status");
    const sec = getP("episodes-section");
    if (sec) sec.hidden = false;
    if (!listEl) return;

    cancelEpisodeListRender();
    const generation = _episodeListGeneration;
    _renderedSeasonNum = seasonNum;

    _episodesLoading = false;

    if (statusEl) statusEl.hidden = true;

    const scopedEps = episodesForDisplay(episodes || []).map((ep) => ({
      ...ep,
      seasonNumber: seasonNum,
      progressKey: `${seasonNum}:${ep.episodeNumber}`,
    }));

    if (!scopedEps.length) {
      listEl.innerHTML = `<div class="tds-episodes-status">${esc(t("seasons.emptySeason"))}</div>`;
      updateEpisodesTitle();
      setEpisodesSectionReady(true);
      disconnectScrollToSeasons();
      return;
    }

    // Paint header, toggles, and jump bar before episode rows (avoids list-first flash).
    updateEpisodesTitle();
    updateSeasonActions(seasonNum);

    const entry = getEntry();
    const BATCH = 40;

    _episodeListRender = {
      seasonNum,
      scopedEps,
      index: 0,
      entry,
      listEl,
      batch: BATCH,
      generation,
    };

    const appendBatchSlice = (startIndex) => {
      if (generation !== _episodeListGeneration) return startIndex;
      const slice = scopedEps.slice(startIndex, startIndex + BATCH);
      listEl.insertAdjacentHTML(
        "beforeend",
        slice.map((ep) => episodeRowHtml(ep, entry)).join("")
      );
      return startIndex + slice.length;
    };

    listEl.innerHTML = "";
    let index = appendBatchSlice(0);
    if (_episodeListRender?.generation === generation) {
      _episodeListRender.index = index;
    }
    setEpisodesSectionReady(true);
    syncScrollToSeasonsWatcher();

    if (index >= scopedEps.length) return;

    const appendRemainingBatches = () => {
      if (generation !== _episodeListGeneration) return;
      const ctx = _episodeListRender;
      if (!ctx || ctx.generation !== generation || ctx.seasonNum !== seasonNum) return;
      index = appendBatchSlice(index);
      if (generation !== _episodeListGeneration) return;
      if (_episodeListRender?.generation === generation) {
        _episodeListRender.index = index;
      }
      if (index < scopedEps.length) {
        requestAnimationFrame(appendRemainingBatches);
      } else {
        updateSeasonActions(seasonNum);
      }
    };

    requestAnimationFrame(appendRemainingBatches);
  }

  /** Update episode rows in place after background enrichment (ratings, stills, filler). */
  function patchEpisodeRowsEnrichment(seasonNum, episodes) {
    const entry = getEntry();
    const scopedEps = episodesForDisplay(episodes || []).map((ep) => ({
      ...ep,
      seasonNumber: seasonNum,
      progressKey: `${seasonNum}:${ep.episodeNumber}`,
    }));

    scopedEps.forEach((ep) => {
      const row = findEpisodeRowEl(seasonNum, ep.episodeNumber);
      if (!row) return;

      const displayTitle = cleanEpisodeDisplayTitle(ep.title, ep.episodeNumber);
      const titleEl = row.querySelector(".tds-ep-title");
      if (titleEl) {
        if (displayTitle) titleEl.textContent = displayTitle;
      } else if (displayTitle) {
        const header = row.querySelector(".tds-ep-header");
        const numEl = header?.querySelector(".tds-ep-num");
        if (header && numEl) {
          const h4 = document.createElement("h4");
          h4.className = "tds-ep-title";
          h4.textContent = displayTitle;
          numEl.insertAdjacentElement("afterend", h4);
        }
      }

      const seasonPoster = getSeasonPoster(seasonNum);
      const still = (_spoilerPosters && seasonPoster) ? seasonPoster : (ep.still || "");
      const stillWrap = row.querySelector(".tds-ep-still-wrap");
      if (stillWrap) {
        let img = stillWrap.querySelector(".tds-ep-still");
        const placeholder = stillWrap.querySelector(".tds-ep-still-placeholder");
        if (still) {
          if (!img) {
            img = document.createElement("img");
            img.className = "tds-ep-still";
            img.alt = "";
            img.loading = "lazy";
            img.onerror = function onStillError() {
              this.classList.add("tds-img--broken");
              this.hidden = true;
              if (this.nextElementSibling) this.nextElementSibling.hidden = false;
            };
            stillWrap.insertBefore(img, placeholder);
          }
          if (img.getAttribute("src") !== still) img.setAttribute("src", still);
          img.hidden = false;
          if (placeholder) placeholder.hidden = true;
        }
      }

      const header = row.querySelector(".tds-ep-header");
      if (header) {
        const existingBadge = header.querySelector(".tds-ep-filler-badge");
        const badgeHtml = fillerBadgeHtml(ep.fillerKind);
        if (badgeHtml) {
          if (existingBadge) {
            existingBadge.outerHTML = badgeHtml;
          } else {
            const titleNode = header.querySelector(".tds-ep-title") || header.querySelector(".tds-ep-num");
            titleNode?.insertAdjacentHTML("afterend", badgeHtml);
          }
        } else if (existingBadge) {
          existingBadge.remove();
        }

        const sourceRating = episodeExternalRating(ep);
        let ratingEl = header.querySelector(".tds-ep-source-rating");
        if (sourceRating != null) {
          const ratingHtml =
            `<span class="tds-ep-source-rating" title="${esc(t("seasons.episodeRatingSource", { rating: formatRatingValue(sourceRating) }))}">`
            + `${esc(formatRatingValue(sourceRating))}<span class="tds-ep-source-rating__max">/10</span></span>`;
          if (ratingEl) {
            ratingEl.outerHTML = ratingHtml;
          } else {
            header.insertAdjacentHTML("beforeend", ratingHtml);
          }
        } else if (ratingEl) {
          ratingEl.remove();
        }
      }

      const overviewText = episodeOverviewForDisplay(ep.overview);
      let overviewEl = row.querySelector(".tds-ep-overview");
      if (overviewText) {
        if (overviewEl) {
          overviewEl.textContent = overviewText;
        } else {
          const content = row.querySelector(".tds-ep-content");
          const metaEl = content?.querySelector(".tds-ep-meta");
          const p = document.createElement("p");
          p.className = "tds-ep-overview";
          p.textContent = overviewText;
          if (metaEl) content.insertBefore(p, metaEl);
          else content?.appendChild(p);
        }
      } else if (overviewEl) {
        overviewEl.remove();
      }

      const metaParts = [];
      if (ep.runtimeMinutes) metaParts.push(t("seasons.epRuntime", { n: ep.runtimeMinutes }));
      if (ep.airDate) metaParts.push(t("seasons.epAiredOn", { date: ep.airDate.slice(0, 10) }));
      const metaEl = row.querySelector(".tds-ep-meta");
      if (metaParts.length) {
        const metaText = metaParts.join(" · ");
        if (metaEl) {
          metaEl.textContent = metaText;
        } else {
          const content = row.querySelector(".tds-ep-content");
          const p = document.createElement("p");
          p.className = "tds-ep-meta";
          p.textContent = metaText;
          content?.appendChild(p);
        }
      }

      updateEpisodeRowStateFromEntry(entry, seasonNum, ep.episodeNumber, ep);
    });

    updateSpoilerRow();
    updateSeasonActions(seasonNum);
    syncScrollToSeasonsWatcher();
  }

  function findEpisodeRowEl(seasonNum, epNum) {
    const epKey = `${seasonNum}:${epNum}`;
    return _slot?.querySelector(
      `.tds-episode[data-tds-episode="${CSS.escape(epKey)}"]`
    );
  }

  /** Render batched episode rows up to targetEpNum so jump/scroll can reach them. */
  function ensureEpisodeRowInDom(seasonNum, epNum) {
    let row = findEpisodeRowEl(seasonNum, epNum);
    if (row) return row;

    const ctx = _episodeListRender;
    if (!ctx || ctx.seasonNum !== seasonNum) return null;

    const generation = ctx.generation;
    const targetIdx = ctx.scopedEps.findIndex((ep) => ep.episodeNumber === epNum);
    if (targetIdx < 0) return null;

    while (
      ctx.index <= targetIdx &&
      ctx.index < ctx.scopedEps.length &&
      generation === _episodeListGeneration &&
      _episodeListRender === ctx
    ) {
      const slice = ctx.scopedEps.slice(ctx.index, ctx.index + ctx.batch);
      ctx.listEl.insertAdjacentHTML(
        "beforeend",
        slice.map((ep) => episodeRowHtml(ep, ctx.entry)).join("")
      );
      ctx.index += ctx.batch;
    }

    if (ctx.index >= ctx.scopedEps.length) {
      updateSeasonActions(seasonNum);
    }

    return findEpisodeRowEl(seasonNum, epNum);
  }

  function sanitizeEpisodeJumpInput(value) {
    return String(value || "").replace(/\D/g, "");
  }

  function showEpisodeJumpHint(message) {
    const hint = getP("episode-jump-hint");
    if (!hint) return;
    if (message) {
      hint.textContent = message;
      hint.hidden = false;
    } else {
      hint.textContent = "";
      hint.hidden = true;
    }
  }

  function jumpToEpisodeNumber(rawValue) {
    const epNum = parseInt(sanitizeEpisodeJumpInput(rawValue), 10);
    if (!Number.isFinite(epNum) || epNum <= 0) return;

    const seasonNum = _selectedSeason;
    if (seasonNum == null) return;

    const episodes = _episodesResult?.episodes || [];
    const exists = episodes.some((ep) => ep.episodeNumber === epNum);
    if (!exists) {
      showEpisodeJumpHint(t("seasons.jumpToEpisodeMissing", { n: epNum }));
      return;
    }

    showEpisodeJumpHint("");
    const row = ensureEpisodeRowInDom(seasonNum, epNum);
    if (!row) return;

    row.scrollIntoView({ behavior: "smooth", block: "center" });
    row.classList.add("tds-episode--jump-highlight");
    window.setTimeout(() => row.classList.remove("tds-episode--jump-highlight"), 2200);
  }

  function resetEpisodeJumpInput() {
    const input = getP("episode-jump-input");
    if (input) input.value = "";
    showEpisodeJumpHint("");
  }

  function onEpisodeJumpInput(event) {
    const input = event.target;
    if (!input) return;
    const digits = sanitizeEpisodeJumpInput(input.value);
    if (input.value !== digits) input.value = digits;
    if (digits) showEpisodeJumpHint("");
  }

  function onEpisodeJumpKeydown(event) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    jumpToEpisodeNumber(event.target?.value);
  }

  function formatRatingValue(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) return "";
    return num % 1 === 0 ? String(num) : num.toFixed(1);
  }

  function episodeExternalRating(ep) {
    const source = String(ep?.episodeRatingSource || "");
    // IMDb/OMDb ratings (preferred) and TMDB vote_average as fallback.
    if (source !== "imdb" && source !== "tmdb") return null;
    const num = Number(ep?.episodeRating);
    if (!Number.isFinite(num) || num <= 0 || num > 10) return null;
    return Math.round(num * 10) / 10;
  }

  function episodeExternalRatingSource(episodes) {
    for (const ep of episodes || []) {
      if (episodeExternalRating(ep) == null) continue;
      const source = String(ep?.episodeRatingSource || "");
      if (source === "imdb" || source === "tmdb") return source;
    }
    return null;
  }

  function episodeUserRating(entry, seasonNum, epNum) {
    const num = Number(P()?.getEpisodeRating?.(entry, seasonNum, epNum));
    if (!Number.isFinite(num) || num <= 0 || num > 10) return null;
    return Math.round(num * 10) / 10;
  }

  function seasonAverageExternalRating(episodes) {
    const vals = (episodes || [])
      .filter((ep) => ep.isAired !== false)
      .map((ep) => episodeExternalRating(ep))
      .filter((v) => v != null);
    if (!vals.length) return null;
    return vals.reduce((sum, n) => sum + n, 0) / vals.length;
  }

  function seasonAverageUserRating(entry, episodes) {
    const vals = (episodes || [])
      .filter((ep) => ep.isAired !== false)
      .map((ep) => episodeUserRating(entry, ep.seasonNumber, ep.episodeNumber))
      .filter((v) => v != null);
    if (!vals.length) return null;
    return vals.reduce((sum, n) => sum + n, 0) / vals.length;
  }

  function isLatinDominant(text) {
    const letters = String(text || "").match(/\p{L}/gu);
    if (!letters?.length) return false;
    const latin = letters.filter((c) => /[A-Za-z]/.test(c)).length;
    return latin / letters.length >= 0.55;
  }

  function episodeOverviewForDisplay(overview) {
    const cleaned =
      window.WatchlistSeriesMetadata?.cleanEpisodeOverview?.(overview) ??
      String(overview || "").trim();
    const text = String(cleaned || "").trim();
    if (!text) return "";
    const lang = getLocale();
    if (lang === "ar") return text;
    return isLatinDominant(text) ? text : "";
  }

  function isGenericEpisodeTitle(title, epNum) {
    const text = String(title || "").trim();
    if (!text) return true;
    if (/^episode\s*0*\d+$/i.test(text)) return true;
    if (/^ep\.?\s*0*\d+$/i.test(text)) return true;
    const num = Number(epNum);
    if (Number.isFinite(num) && new RegExp(`^الحلقة\\s*${num}$`, "u").test(text)) {
      return true;
    }
    return false;
  }

  function cleanEpisodeDisplayTitle(title, epNum) {
    let text = String(title || "").trim();
    if (!text) return "";
    const num = Number(epNum);
    if (!Number.isFinite(num)) return text;
    const patterns = [
      new RegExp(`^episode\\s*0*${num}\\s*[-:–—|]\\s*`, "i"),
      new RegExp(`^episode\\s*0*${num}\\s+`, "i"),
      new RegExp(`^ep\\.?\\s*0*${num}\\s*[-:–—|]?\\s*`, "i"),
    ];
    for (const pattern of patterns) {
      text = text.replace(pattern, "").trim();
    }
    const wrongNum = text.match(/^episode\s*0*(\d+)\s*[-:–—|]\s*/i);
    if (wrongNum && Number(wrongNum[1]) !== num) {
      text = text.replace(/^episode\s*0*\d+\s*[-:–—|]\s*/i, "").trim();
    }
    if (isGenericEpisodeTitle(text, epNum)) return "";
    return text;
  }

  function episodeRowHtml(ep, entry) {
    const seasonNum = ep.seasonNumber;
    const epNum     = ep.episodeNumber;
    const watched   = P()?.isEpisodeWatched(entry, seasonNum, epNum) ?? false;
    const displayTitle = cleanEpisodeDisplayTitle(ep.title, epNum);

    const metaParts = [];
    if (ep.runtimeMinutes) metaParts.push(t("seasons.epRuntime", { n: ep.runtimeMinutes }));
    if (ep.airDate) metaParts.push(t("seasons.epAiredOn", { date: ep.airDate.slice(0, 10) }));

    const checkLabel = watched
      ? t("seasons.episodeUnwatch", { title: displayTitle || t("seasons.episodeNum", { n: epNum }) })
      : t("seasons.episodeWatched", { title: displayTitle || t("seasons.episodeNum", { n: epNum }) });
    const sourceRating = episodeExternalRating(ep);
    const yourRating = episodeUserRating(entry, seasonNum, epNum);

    // Only use the episode's own unique still — never fall back to season/title
    // poster, which would make every episode without a still show the same image.
    const seasonPoster = getSeasonPoster(seasonNum);
    const still = (_spoilerPosters && seasonPoster)
      ? seasonPoster
      : (ep.still || "");
    const overviewText = episodeOverviewForDisplay(ep.overview);

    return `<div class="tds-episode${watched ? " tds-episode--watched" : ""}"
      role="listitem"
      data-tds-episode="${esc(`${seasonNum}:${epNum}`)}"
      data-tds-action="open-episode">
      <div class="tds-ep-still-wrap">
        ${still
          ? `<img class="tds-ep-still" src="${esc(still)}" alt=""
               loading="lazy"
               onerror="this.classList.add('tds-img--broken');this.hidden=true;this.nextElementSibling.hidden=false;" />`
          : ""}
        <div class="tds-ep-still-placeholder"${still ? ' hidden' : ''} aria-hidden="true" title="${esc(t("seasons.emptyStill"))}"></div>
      </div>
      <div class="tds-ep-content">
        <div class="tds-ep-header">
          <span class="tds-ep-num">${esc(t("seasons.episodeNum", { n: epNum }))}</span>
          ${displayTitle ? `<h4 class="tds-ep-title">${esc(displayTitle)}</h4>` : ""}
          ${fillerBadgeHtml(ep.fillerKind)}
          ${sourceRating != null
            ? `<span class="tds-ep-source-rating" title="${esc(t("seasons.episodeRatingSource", { rating: formatRatingValue(sourceRating) }))}">${esc(formatRatingValue(sourceRating))}<span class="tds-ep-source-rating__max">/10</span></span>`
            : ""}
        </div>
        ${overviewText ? `<p class="tds-ep-overview">${esc(overviewText)}</p>` : ""}
        ${metaParts.length ? `<p class="tds-ep-meta">${esc(metaParts.join(" · "))}</p>` : ""}
        <div class="tds-ep-ratings"${yourRating != null ? "" : " hidden"}>
          ${yourRating != null ? `<span class="tds-rating-chip tds-rating-chip--user">${esc(t("seasons.episodeRatingYours", { rating: formatRatingValue(yourRating) }))}</span>` : ""}
        </div>
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
    updateSpoilerRow();
    updateEpisodeJumpRow();
    syncScrollToSeasonsWatcher();
  }

  function updateEpisodeJumpRow() {
    const jumpRow = getP("episode-jump");
    if (!jumpRow) return;
    const sec = getP("episodes-section");
    const hasEpisodes = !_episodesLoading && Boolean(_episodesResult?.episodes?.length);
    const show = sec && !sec.hidden && hasEpisodes && _selectedSeason > 0;
    jumpRow.hidden = !show;

    const label = jumpRow.querySelector(".tds-episode-jump__label");
    if (label) label.textContent = t("seasons.jumpToEpisode");

    const input = getP("episode-jump-input");
    if (input) {
      input.placeholder = t("seasons.jumpToEpisodePlaceholder");
      input.setAttribute("aria-label", t("seasons.jumpToEpisode"));
    }

    const goBtn = jumpRow.querySelector("[data-tds-action='jump-episode']");
    if (goBtn) goBtn.setAttribute("aria-label", t("seasons.jumpToEpisodeGo"));
  }

  function updateSpoilerRow() {
    const row = getP("spoiler-row");
    if (!row) return;
    const sec = getP("episodes-section");
    const hasEpisodes = !_episodesLoading && Boolean(_episodesResult?.episodes?.length);
    const show = sec && !sec.hidden && hasEpisodes && _selectedSeason > 0;
    row.hidden = !show;

    const spoilerBtn = row.querySelector("[data-tds-action='toggle-spoiler']");
    const spoilerLabel = spoilerBtn?.querySelector(".tds-spoiler-toggle__label");
    if (spoilerLabel) spoilerLabel.textContent = t("seasons.spoilerMode");
    if (spoilerBtn) {
      spoilerBtn.setAttribute("aria-checked", String(_spoilerPosters));
      spoilerBtn.classList.toggle("tds-spoiler-toggle--on", _spoilerPosters);
    }

    const ratingsBtn = row.querySelector("[data-tds-action='toggle-hide-ratings']");
    const ratingsLabel = ratingsBtn?.querySelector(".tds-spoiler-toggle__label");
    if (ratingsLabel) ratingsLabel.textContent = t("seasons.hideEpisodeRatings");
    if (ratingsBtn) {
      ratingsBtn.setAttribute("aria-checked", String(_hideEpisodeRatings));
      ratingsBtn.classList.toggle("tds-spoiler-toggle--on", _hideEpisodeRatings);
    }

    const fillerBtn = row.querySelector("[data-tds-action='toggle-hide-filler']");
    const fillerLabel = fillerBtn?.querySelector(".tds-spoiler-toggle__label");
    const showFillerToggle =
      _item?.contentType === "anime" && _fillerUiAvailable && _selectedSeason > 0;
    if (fillerBtn) fillerBtn.hidden = !showFillerToggle;
    if (fillerLabel) fillerLabel.textContent = t("seasons.hideFiller");
    if (fillerBtn) {
      fillerBtn.setAttribute("aria-checked", String(_hideFiller));
      fillerBtn.classList.toggle("tds-spoiler-toggle--on", _hideFiller);
    }

    if (sec) {
      sec.classList.toggle("tds-hide-source-ratings", _hideEpisodeRatings);
    }
  }

  function refreshEpisodeListDisplay() {
    if (_selectedSeason == null || !_episodesResult?.episodes?.length) return;
    renderEpisodeList(_selectedSeason, _episodesResult.episodes);
  }

  function findEpisodeByKey(epKey) {
    if (!epKey || !_episodesResult?.episodes?.length) return null;
    return _episodesResult.episodes.find((ep) => `${ep.seasonNumber}:${ep.episodeNumber}` === epKey) || null;
  }

  function openEpisodeModal(epKey) {
    const modal = getP("episode-modal");
    const ep = findEpisodeByKey(epKey);
    if (!modal || !ep) return;
    _activeEpisodeKey = epKey;
    const entry = getEntry();
    const sourceRating = episodeExternalRating(ep);
    const yourRating = episodeUserRating(entry, ep.seasonNumber, ep.episodeNumber);

    const media = getP("episode-modal-media");
    const titleEl = getP("episode-modal-title");
    const metaEl = getP("episode-modal-meta");
    const overviewEl = getP("episode-modal-overview");
    const sourceEl = getP("episode-modal-source");
    const userEl = getP("episode-modal-user");
    const labelEl = getP("episode-modal-label");
    const inputEl = getP("episode-modal-input");
    const saveBtn = _episodeModalEl?.querySelector("[data-tds-action='save-episode-rating']");

    if (media) {
      media.innerHTML = ep.still
        ? `<img class="tds-episode-modal__still" src="${esc(ep.still)}" alt="" />`
        : `<div class="tds-episode-modal__still-placeholder" aria-hidden="true"></div>`;
    }
    if (titleEl) {
      const displayTitle = cleanEpisodeDisplayTitle(ep.title, ep.episodeNumber)
        || t("seasons.episodeNum", { n: ep.episodeNumber });
      titleEl.textContent = `${t("seasons.episodeNum", { n: ep.episodeNumber })} · ${displayTitle}`;
    }
    if (metaEl) {
      const meta = [];
      if (ep.runtimeMinutes) meta.push(t("seasons.epRuntime", { n: ep.runtimeMinutes }));
      if (ep.airDate) meta.push(t("seasons.epAiredOn", { date: ep.airDate.slice(0, 10) }));
      metaEl.textContent = meta.join(" · ");
    }
    if (overviewEl) {
      const overviewText = episodeOverviewForDisplay(ep.overview);
      if (overviewText) {
        overviewEl.textContent = overviewText;
        overviewEl.hidden = false;
      } else {
        overviewEl.hidden = true;
      }
    }
    if (sourceEl) {
      if (sourceRating != null) {
        sourceEl.textContent = t("seasons.episodeRatingSource", { rating: formatRatingValue(sourceRating) });
        sourceEl.hidden = false;
      } else {
        sourceEl.hidden = true;
      }
    }
    if (userEl) {
      if (yourRating != null) {
        userEl.textContent = t("seasons.episodeRatingYours", { rating: formatRatingValue(yourRating) });
        userEl.hidden = false;
      } else {
        userEl.hidden = true;
      }
    }
    if (labelEl) labelEl.hidden = (yourRating != null && !_episodeModalEditing);
    if (inputEl) {
      inputEl.hidden = (yourRating != null && !_episodeModalEditing);
      inputEl.value = yourRating != null ? String(yourRating) : "";
    }
    if (saveBtn) {
      saveBtn.textContent =
        (yourRating != null && !_episodeModalEditing)
          ? t("seasons.editEpisodeRating")
          : t("btn.save");
    }

    modal.hidden = false;
    const scrollBtn = getP("scroll-to-seasons");
    if (scrollBtn) scrollBtn.hidden = true;
    if (inputEl && !inputEl.hidden) {
      inputEl.focus();
      requestAnimationFrame(() => {
        modal.querySelector(".tds-episode-modal__panel")?.scrollIntoView({
          block: "center",
          behavior: "smooth",
        });
      });
    }
  }

  function closeEpisodeModal() {
    const modal = getP("episode-modal");
    if (!modal) return;
    modal.hidden = true;
    _activeEpisodeKey = null;
    _episodeModalEditing = false;
    syncScrollToSeasonsWatcher();
  }

  function saveEpisodeRatingFromModal({ clear = false } = {}) {
    if (!_activeEpisodeKey) return;
    const ep = findEpisodeByKey(_activeEpisodeKey);
    if (!ep) return;
    const inputEl = getP("episode-modal-input");
    const entered = clear ? "" : String(inputEl?.value || "").trim();
    const parsed = entered === "" ? null : Number(entered.replace(",", "."));
    if (parsed != null && (!Number.isFinite(parsed) || parsed < 0 || parsed > 10)) return;

    const [sStr, eStr] = _activeEpisodeKey.split(":");
    const seasonNum = Number(sStr);
    const epNum = Number(eStr);
    if (!Number.isFinite(seasonNum) || !Number.isFinite(epNum)) return;

    let entry = getEntry();
    const existingRating = episodeUserRating(entry, seasonNum, epNum);
    if (!clear && existingRating != null && !_episodeModalEditing) {
      _episodeModalEditing = true;
      openEpisodeModal(_activeEpisodeKey);
      return;
    }

    const airedKeys = airedEpisodeKeysForSeason(seasonNum);
    const epKey = P()?.episodeKey(seasonNum, epNum);
    const hasGranular = Boolean(P()?.getProgress(entry));
    if (!hasGranular) {
      // Legacy-complete title: start granular progress for this episode only.
      entry = P()?.markEpisodeWatched(entry, seasonNum, epNum, epKey ? [epKey] : airedKeys);
    } else if (!(P()?.isEpisodeWatched(entry, seasonNum, epNum) ?? false)) {
      entry = P()?.markEpisodeWatched(entry, seasonNum, epNum, airedKeys);
    }
    const normalized = (parsed != null && parsed > 0) ? parsed : null;
    entry = (clear || normalized == null)
      ? P()?.clearEpisodeRating?.(entry, seasonNum, epNum)
      : P()?.setEpisodeRating?.(entry, seasonNum, epNum, normalized);

    saveEntry(entry);
    updateEpisodeRowState(seasonNum, epNum);
    refreshSeasonCard(seasonNum);
    updateSeasonInfoProgress(seasonNum);
    _callbacks?.updateHeaderWatchState?.();
    _callbacks?.updateDetailActions?.();
    _episodeModalEditing = false;
    openEpisodeModal(_activeEpisodeKey);
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
    const rootEl = seasonNum === 0 ? getP("specials-carousel") : _carouselEl;
    if (!rootEl) return;
    const card = rootEl.querySelector(`[data-tds-season="${seasonNum}"]`);
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
      const markLabel = seasonMarkLabel(ws);
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
    const yourRating = episodeUserRating(entry, seasonNum, epNum);

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

    const ratingsWrap = row.querySelector(".tds-ep-ratings");
    if (ratingsWrap) {
      ratingsWrap.innerHTML = yourRating != null
        ? `<span class="tds-rating-chip tds-rating-chip--user">${esc(t("seasons.episodeRatingYours", { rating: formatRatingValue(yourRating) }))}</span>`
        : "";
      ratingsWrap.hidden = yourRating == null;
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
    const yourRating = episodeUserRating(entry, seasonNum, epNum);
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

    const ratingsWrap = row.querySelector(".tds-ep-ratings");
    if (ratingsWrap) {
      ratingsWrap.innerHTML = yourRating != null
        ? `<span class="tds-rating-chip tds-rating-chip--user">${esc(t("seasons.episodeRatingYours", { rating: formatRatingValue(yourRating) }))}</span>`
        : "";
      ratingsWrap.hidden = yourRating == null;
    }
  }

  // ─── Action: toggle single episode ────────────────────────────────────────

  async function handleToggleEpisode(epKey) {
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
    } else if (shouldPromptGapFill(entry, seasonNum, epNum)) {
      const keys = await promptGapFillKeys(entry, seasonNum, epNum);
      if (keys) {
        newEntry = P()?.markSeasonWatched(entry, keys);
      } else {
        newEntry = P()?.markEpisodeWatched(entry, seasonNum, epNum, allAired);
      }
    } else {
      newEntry = P()?.markEpisodeWatched(entry, seasonNum, epNum, allAired);
    }

    saveEntry(newEntry);
    refreshEpisodeWatchUi(seasonNum);
  }

  // ─── Action: mark / unmark whole season ───────────────────────────────────

  /**
   * Expand a legacy-complete entry into a granular one containing episode keys
   * for all known regular seasons (season > 0).
   * - For the currently-loaded season: use real aired episode keys.
   * - For other seasons: use synthetic keys derived from stored episode counts.
   * Specials (season 0) are never included in the expansion.
   */
  function expandLegacyToGranular(entry) {
    const seasons = _seriesResult?.seasons || [];
    const allKeys = [];
    for (const s of seasons) {
      const sNum = s.seasonNumber;
      if (sNum === 0) continue; // never expand specials
      if (_episodesResult?.seasonNum === sNum && _episodesResult?.episodes) {
        const keys = (_episodesResult.episodes || [])
          .filter((ep) => ep.isAired !== false)
          .map((ep) => P()?.episodeKey(ep.seasonNumber, ep.episodeNumber))
          .filter(Boolean);
        allKeys.push(...keys);
      } else {
        const count = seasonEpisodeTotal(s, entry);
        for (let i = 1; i <= count; i++) allKeys.push(`${sNum}:${i}`);
      }
    }
    return P()?.markAllWatched(entry, allKeys) || entry;
  }

  async function handleMarkSeason(seasonNum) {
    const seasons = _seriesResult?.seasons || [];
    const season  = seasons.find((s) => s.seasonNumber === seasonNum);
    if (!season) return;

    // Ensure episode list is loaded so we know which aired episodes to mark.
    if (_episodesResult?.seasonNum !== seasonNum || !_episodesResult?.episodes?.length) {
      if (_selectedSeason !== seasonNum) {
        _selectedSeason = seasonNum;
        updateCarouselSelection(seasonNum);
        notifySeasonPresentation(seasonNum);
      }
      await loadEpisodes(seasonNum);
    }

    let entry = getEntry();

    // If the entry is legacy-complete, expand it to granular BEFORE any season
    // operation. Without this, marking specials or unmarking a season on a
    // legacy-complete entry would replace the entire episodes list with only
    // the current season's keys, losing all other seasons' watched state.
    if (P()?.isLegacyComplete(entry)) {
      entry = expandLegacyToGranular(entry);
    }

    const ws       = seasonWatchState(entry, season);
    const airedKeys = airedEpisodeKeysForSeason(seasonNum);
    const wasWatched = ws === "watched";

    let newEntry;
    if (wasWatched) {
      newEntry = P()?.unmarkSeasonWatched(entry, seasonNum, airedKeys);
    } else {
      if (!airedKeys.length) return;
      const maxEp = maxEpisodeNumberFromKeys(airedKeys);
      const gapKeys = await promptGapFillKeys(entry, seasonNum, maxEp);
      newEntry = P()?.markSeasonWatched(entry, gapKeys || airedKeys);
    }

    saveEntry(newEntry);
    refreshEpisodeWatchUi(seasonNum);

    if (!wasWatched) {
      const seasons = getRegularSeasons();
      const next = seasons.find((s) => s.seasonNumber > seasonNum);
      if (next) selectSeason(next.seasonNumber);
    }
  }

  // ─── Callback: title-level watched changed (from detail actions bar) ──────

  function onTitleWatchedChanged() {
    // Title was binary-watched or unwatched from the detail header action.
    // Re-read all episode/season states from the (now updated) entry.
    refreshAllEpisodeRows();
    const seasons = _seriesResult?.seasons || [];
    seasons.forEach((s) => refreshSeasonCard(s.seasonNumber));
    renderSpecialsCarousel();
    if (_selectedSeason != null) {
      notifySeasonPresentation(_selectedSeason, { persistPoster: false });
    }
    // Don't call updateHeaderWatchState here — title-detail.js already did it.
  }

  // ─── Callback: external refresh (edit/move — detail sections were patched) ─

  function onExternalRefresh() {
    // Re-read watch entry in case it was modified externally; update display
    refreshAllEpisodeRows();
    const seasons = _seriesResult?.seasons || [];
    seasons.forEach((s) => refreshSeasonCard(s.seasonNumber));
    renderSpecialsCarousel();
    if (_selectedSeason != null) {
      notifySeasonPresentation(_selectedSeason, { persistPoster: false });
    }
  }

  // ─── Language change ──────────────────────────────────────────────────────

  function onLangChange() {
    if (!_slot || !_seriesResult) return;
    const seasons = _seriesResult?.seasons || [];
    const saved   = _selectedSeason;

    // Re-render carousel labels (in-place, no scroll reset)
    seasons.forEach((s) => refreshSeasonCard(s.seasonNumber));
    renderSpecialsCarousel();
    updateNavButtonLabels();
    if (saved != null) notifySeasonPresentation(saved, { persistPoster: false });
    updateEpisodesTitle();

    // Re-render episode list labels if loaded
    if (_episodesResult?.episodes) {
      refreshAllEpisodeRows();
    }
    if (_activeEpisodeKey) {
      openEpisodeModal(_activeEpisodeKey);
    }

    const scrollBtn = getP("scroll-to-seasons");
    if (scrollBtn) {
      scrollBtn.setAttribute("aria-label", t("seasons.scrollToControls"));
      scrollBtn.setAttribute("title", t("seasons.scrollToControls"));
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
    _slot.querySelectorAll("[data-tds-tab]").forEach((tabBtn) => {
      tabBtn.addEventListener("click", () => switchSeriesTab(tabBtn.dataset.tdsTab));
    });
    const jumpInput = getP("episode-jump-input");
    jumpInput?.addEventListener("input", onEpisodeJumpInput);
    jumpInput?.addEventListener("keydown", onEpisodeJumpKeydown);
    mountEpisodeModal();
  }

  function mountEpisodeModal() {
    unmountEpisodeModal();
    const modal = _slot?.querySelector("[data-tds-part='episode-modal']");
    if (!modal) return;
    _episodeModalEl = modal;
    document.body.appendChild(_episodeModalEl);
    _episodeModalEl.addEventListener("click", onSlotClick);
    _episodeModalEl.addEventListener("keydown", onEpisodeModalKeydown);
  }

  function unmountEpisodeModal() {
    if (!_episodeModalEl) return;
    _episodeModalEl.removeEventListener("click", onSlotClick);
    _episodeModalEl.removeEventListener("keydown", onEpisodeModalKeydown);
    if (_episodeModalEl.parentElement === document.body) {
      _episodeModalEl.remove();
    }
    _episodeModalEl = null;
  }

  function onEpisodeModalKeydown(event) {
    if (event.key === "Escape" && _episodeModalEl && !_episodeModalEl.hidden) {
      event.preventDefault();
      closeEpisodeModal();
    }
  }

  function onSlotClick(event) {
    const target = event.target.closest("[data-tds-action]");
    if (!target) return;

    const action = target.dataset.tdsAction;
    event.stopPropagation();

    switch (action) {
      case "open-related-movie": {
        void openRelatedMovie(target.dataset.tdsMovieIndex);
        break;
      }
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
      case "open-episode": {
        if (target.classList.contains("tds-episode")) {
          openEpisodeModal(target.dataset.tdsEpisode);
        }
        break;
      }
      case "close-episode-modal": {
        closeEpisodeModal();
        break;
      }
      case "save-episode-rating": {
        saveEpisodeRatingFromModal();
        break;
      }
      case "toggle-spoiler": {
        _spoilerPosters = !_spoilerPosters;
        updateSpoilerRow();
        refreshEpisodeListDisplay();
        break;
      }
      case "toggle-hide-ratings": {
        _hideEpisodeRatings = !_hideEpisodeRatings;
        updateSpoilerRow();
        break;
      }
      case "toggle-hide-filler": {
        _hideFiller = !_hideFiller;
        updateSpoilerRow();
        refreshEpisodeListDisplay();
        break;
      }
      case "jump-episode": {
        const input = getP("episode-jump-input");
        jumpToEpisodeNumber(input?.value);
        break;
      }
      case "scroll-to-seasons": {
        scrollToSeasonsControls();
        break;
      }
      case "prev-season": {
        const seasons = getRegularSeasons();
        const prev    = seasons.filter((s) => s.seasonNumber < _selectedSeason).pop();
        if (prev) selectSeason(prev.seasonNumber);
        break;
      }
      case "next-season": {
        const seasons = getRegularSeasons();
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
    if (event.key === "Escape" && !getP("episode-modal")?.hidden) {
      event.preventDefault();
      closeEpisodeModal();
      return;
    }
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
    // Mobile: when scroll-snap settles on a new card, load that season's episodes
    let scrollSyncTimer = null;
    _carouselEl.addEventListener(
      "scroll",
      () => {
        clearTimeout(scrollSyncTimer);
        scrollSyncTimer = setTimeout(syncCarouselSelectionFromScroll, 150);
      },
      { passive: true }
    );
  }

  function syncCarouselSelectionFromScroll() {
    if (!_carouselEl || _isDragging) return;
    const cards = [..._carouselEl.querySelectorAll(".tds-season-card")];
    if (!cards.length) return;

    const carouselRect = _carouselEl.getBoundingClientRect();
    const center = carouselRect.left + carouselRect.width / 2;
    let bestCard = null;
    let bestDist = Infinity;

    for (const card of cards) {
      const rect = card.getBoundingClientRect();
      const cardCenter = rect.left + rect.width / 2;
      const dist = Math.abs(cardCenter - center);
      if (dist < bestDist) {
        bestDist = dist;
        bestCard = card;
      }
    }

    if (!bestCard) return;
    const num = parseInt(bestCard.dataset.tdsSeason, 10);
    if (Number.isFinite(num) && num !== _selectedSeason) {
      selectSeason(num);
    }
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
    const roots = [];
    if (_episodeModalEl) roots.push(_episodeModalEl);
    if (_slot) roots.push(_slot);
    for (const root of roots) {
      if (root.dataset?.tdsPart === part) return root;
      const el = root.querySelector(`[data-tds-part="${part}"]`);
      if (el) return el;
    }
    return null;
  }

  // ─── Public API ───────────────────────────────────────────────────────────

  window.WatchlistSeasons = {
    attach,
    detach,
    onLangChange,
    onTitleWatchedChanged,
    onExternalRefresh,
    markSeason: handleMarkSeason,
    getSelectedSeason: () => _selectedSeason,
  };
})();
