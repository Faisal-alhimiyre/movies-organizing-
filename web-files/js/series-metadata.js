/**
 * series-metadata.js — Series, season, and episode metadata fetching.
 *
 * Parallel to flutter_app/lib/repositories/metadata/series_metadata_service.dart
 *
 * Depends on:
 *   - window.WATCHLIST_CONFIG  (tmdbApiKey, omdbApiKey)
 *   - window.WatchlistTmdb     (optional — server-proxied TMDB ratings)
 *   - window.WatchlistMetadata (extractImdbId, extractAnilistId, extractMalId,
 *                               isAnilistLink, isMalLink)
 *
 * Exposed as window.WatchlistSeriesMetadata
 *
 * Cache keys (all stored inside a separate localStorage object so as not to
 * contaminate the existing title-level metadata cache):
 *
 *   metadata:v5:resolve:imdb:<imdbId>                 30 days
 *   metadata:v5:resolve:negative:imdb:<imdbId>         2 hours  (negative)
 *   metadata:v5:resolve:mal:<malId>                   30 days
 *   metadata:v7:resolve:tvdb:imdb:<imdbId>            30 days   (TheTVDB)
 *   metadata:v7:resolve:tvdb:tmdb:<tmdbId>            30 days   (TheTVDB)
 *   metadata:v7:resolve:tvdb:negative:imdb:<imdbId>    2 hours  (negative)
 *   metadata:v7:resolve:tvdb:negative:tmdb:<tmdbId>    2 hours  (negative)
 *   metadata:v5:series:tmdb:<id>:<locale>              7 days
 *   metadata:v5:series:anilist:<id>:<locale>           7 days
 *   metadata:v5:seasons:tmdb:<id>:<locale>             7 days   (alias, same entry)
 *   metadata:v6:season:tmdb:<id>:<n>:<locale>         24 hours  (v6 fixes episode stills)
 *   metadata:v7:season:omdb:<imdbId>:<n>              24 hours  (v7 rejects zero ratings)
 *   metadata:v8:season:ratings:tmdb:<id>:<n>:<locale>  24 hours  (TMDB episode ratings)
 *   metadata:v5:episodes:anilist:<id>                 24 hours
 *   metadata:v8:series:tvdb:<id>:<locale>              7 days   (TheTVDB + locale)
 *   metadata:v12:season:tvdb:<id>:<n>:<locale>         24 hours  (episode still fix)
 */
(function () {
  "use strict";

  // ─── Storage key ─────────────────────────────────────────────
  const SERIES_CACHE_KEY = "watchlist-series-cache-v5";

  // ─── API base URLs / constants ────────────────────────────────
  const TMDB_IMAGE = "https://image.tmdb.org/t/p/w500";
  const TVDB_ART = "https://artworks.thetvdb.com";

  function normalizeArtworkUrl(url) {
    const s = String(url || "").trim();
    if (!s) return "";
    if (s.startsWith("https://")) return s;
    if (s.startsWith("//")) return `https:${s}`;
    if (s.startsWith("/")) return `${TVDB_ART}${s}`;
    return "";
  }
  const ANILIST_API = "https://graphql.anilist.co";
  const TMDB_API_BASE = "https://api.themoviedb.org/3";

  // ─── TTLs (milliseconds) ──────────────────────────────────────
  const TTL_SERIES = 7 * 24 * 60 * 60 * 1000;        // 7 days
  const TTL_EPISODES = 24 * 60 * 60 * 1000;           // 24 hours
  const TTL_RESOLVE = 30 * 24 * 60 * 60 * 1000;       // 30 days
  const TTL_NEGATIVE = 2 * 60 * 60 * 1000;            // 2 hours
  const STALE_RATIO = 0.8;

  // ─── Result state enum ────────────────────────────────────────
  const ResultState = Object.freeze({
    LOADING: "loading",
    AVAILABLE: "available",
    PARTIALLY_AVAILABLE: "partiallyAvailable",
    UNAVAILABLE: "unavailable",
    OFFLINE_WITH_CACHE: "offlineWithCache",
    OFFLINE_NO_CACHE: "offlineNoCache",
    INVALID_ID: "invalidId",
    API_FAILURE: "apiFailure",
    RATE_LIMITED: "rateLimited",
    NO_SEASONS: "noSeasons",
    EPISODE_DETAILS_UNAVAILABLE: "episodeDetailsUnavailable",
  });

  // ─── Locale helpers ───────────────────────────────────────────

  function tmdbLanguage(locale) {
    return locale === "ar" ? "ar-SA" : "en-US";
  }

  function getLocale() {
    return window.WatchlistI18n?.getLang?.() || "en";
  }

  // ─── Key helpers ──────────────────────────────────────────────

  function getTmdbKey() {
    return window.WATCHLIST_CONFIG?.tmdbApiKey?.trim() || "";
  }

  function getOmdbKey() {
    return window.WATCHLIST_CONFIG?.omdbApiKey?.trim() || "";
  }

  // ─── Cache (isolated localStorage key) ───────────────────────

  const _memory = new Map();

  function readSeriesCache() {
    try {
      return JSON.parse(localStorage.getItem(SERIES_CACHE_KEY) || "{}");
    } catch {
      return {};
    }
  }

  function writeSeriesCacheEntry(key, data, ttlMs) {
    const entry = { ...data, cachedAt: Date.now(), ttlMs };
    const cache = readSeriesCache();
    cache[key] = entry;
    try {
      localStorage.setItem(SERIES_CACHE_KEY, JSON.stringify(cache));
    } catch {
      /* quota — ignore */
    }
    _memory.set(key, entry);
  }

  /**
   * Returns the cache entry for [key] only when it is within [ttlMs].
   * Returns null when absent or expired.
   */
  function readCached(key, ttlMs) {
    let entry = _memory.get(key);
    if (!entry) {
      entry = readSeriesCache()[key];
      if (entry) _memory.set(key, entry);
    }
    if (!entry) return null;
    const age = Date.now() - (entry.cachedAt || 0);
    if (age > ttlMs) return null;
    return entry;
  }

  /**
   * Returns the cache entry regardless of age (for offline stale fallback).
   */
  function readCacheStale(key) {
    let entry = _memory.get(key);
    if (!entry) {
      entry = readSeriesCache()[key];
      if (entry) _memory.set(key, entry);
    }
    return entry || null;
  }

  function isStale(key, ttlMs) {
    const entry = _memory.get(key) || readSeriesCache()[key];
    if (!entry) return false;
    const age = Date.now() - (entry.cachedAt || 0);
    return age > ttlMs * STALE_RATIO;
  }

  function writeNegativeCache(key, ttlMs) {
    writeSeriesCacheEntry(key, { negative: true }, ttlMs);
  }

  function isNegativeCacheValid(key) {
    const entry = _memory.get(key) || readSeriesCache()[key];
    if (!entry || !entry.negative) return false;
    const age = Date.now() - (entry.cachedAt || 0);
    const ttl = entry.ttlMs || TTL_NEGATIVE;
    return age < ttl;
  }

  // ─── ID resolution ────────────────────────────────────────────

  /**
   * Resolves the best external series identity from a watchlist item.
   *
   * Returns an object:
   * {
   *   source: 'tmdb' | 'anilist' | 'omdb' | 'none',
   *   tmdbId: number | null,
   *   imdbId: string | null,
   *   anilistId: number | null,
   *   isNegative: boolean,
   * }
   */
  async function resolveSeriesId(item) {
    const ct = item?.contentType;
    if (ct !== "tvSeries" && ct !== "anime") {
      return { source: "none", isNegative: true };
    }
    const link = item?.link || "";
    if (!link) return { source: "none", isNegative: true };

    const WM = window.WatchlistMetadata;

    // ── IMDb → TMDb ────────────────────────────────────────────
    const imdbId = WM?.extractImdbId(link);
    if (imdbId) {
      // Fast path: cached successful TMDb ID
      const resolveKey = `metadata:v5:resolve:imdb:${imdbId}`;
      const cachedRes = readCached(resolveKey, TTL_RESOLVE);
      if (cachedRes?.tmdbId) {
        return { source: "tmdb", tmdbId: cachedRes.tmdbId, imdbId, isNegative: false };
      }

      // Check whether TMDb resolution previously failed (2-hour negative cache).
      // We cache only the TMDb failure — OMDb can still be tried independently.
      const negKey = `metadata:v5:resolve:negative:imdb:${imdbId}`;
      const tmdbPreviouslyFailed = isNegativeCacheValid(negKey);

      if (!tmdbPreviouslyFailed) {
        // Try existing title-level metadata (written by metadata.js)
        const existingMeta = await WM?.getMetadata?.(imdbId);
        if (existingMeta?.tmdbId) {
          writeSeriesCacheEntry(resolveKey, { tmdbId: existingMeta.tmdbId, imdbId }, TTL_RESOLVE);
          return { source: "tmdb", tmdbId: existingMeta.tmdbId, imdbId, isNegative: false };
        }

        const tmdbId = await resolveTmdbIdByImdb(imdbId);
        if (tmdbId) {
          writeSeriesCacheEntry(resolveKey, { tmdbId, imdbId }, TTL_RESOLVE);
          return { source: "tmdb", tmdbId, imdbId, isNegative: false };
        }

        // TMDb unavailable — cache this fact so we skip it next time
        writeNegativeCache(negKey, TTL_NEGATIVE);
      }

      // TMDb not available — fall back to OMDb if key is configured
      if (getOmdbKey()) {
        return { source: "omdb", imdbId, isNegative: false };
      }

      // Nothing usable
      return { source: "none", isNegative: true };
    }

    // ── AniList ────────────────────────────────────────────────
    const anilistId = WM?.extractAnilistId?.(link);
    if (anilistId) {
      const linkedImdb = await resolveLinkedImdbId({ anilistId: Number(anilistId) });
      return {
        source: "anilist",
        anilistId: Number(anilistId),
        imdbId: linkedImdb || null,
        isNegative: false,
      };
    }

    // ── MAL → AniList ──────────────────────────────────────────
    const malId = WM?.extractMalId?.(link);
    if (malId) {
      const malKey = `metadata:v5:resolve:mal:${malId}`;
      const malCached = readCached(malKey, TTL_RESOLVE);
      if (malCached?.anilistId) {
        return { source: "anilist", anilistId: malCached.anilistId, isNegative: false };
      }
      const alId = await resolveMalToAnilist(Number(malId));
      if (alId) {
        writeSeriesCacheEntry(malKey, { anilistId: alId }, TTL_RESOLVE);
        return { source: "anilist", anilistId: alId, isNegative: false };
      }
    }

    return { source: "none", isNegative: true };
  }

  async function resolveTmdbIdByImdb(imdbId) {
    if (getTmdbKey()) {
      try {
        const res = await fetchTmdb(`find/${imdbId}`, { external_source: "imdb_id" });
        const tvResults = res?.tv_results || [];
        if (tvResults.length > 0) return tvResults[0].id;
      } catch {
        // fall through to proxy
      }
    }
    if (window.WatchlistTmdb?.resolveByImdb) {
      return await window.WatchlistTmdb.resolveByImdb(imdbId);
    }
    return null;
  }

  async function resolveMalToAnilist(malId) {
    const data = await anilistQuery(
      `query ($malId: Int) { Media(idMal: $malId, type: ANIME) { id } }`,
      { malId }
    );
    return data?.Media?.id || null;
  }

  // ─── Series metadata (series summary + season list) ──────────

  /**
   * Fetches the series summary and season list.
   *
   * @param {object} resolution  Result of resolveSeriesId()
   * @param {string} locale      'en' | 'ar'
   * @param {string} [fallbackPoster]
   * @returns {Promise<SeriesMetadataResult>}
   */
  async function fetchSeriesMetadata(resolution, locale, fallbackPoster = "") {
    if (resolution?.isNegative) {
      return { state: ResultState.INVALID_ID };
    }

    // ── TheTVDB — primary provider for TV series and anime ───────────────
    // Attempted when a known external ID (IMDb or TMDb) is available.
    // On any failure the existing providers are used as fallback.
    if (window.WatchlistTvdb && (resolution?.imdbId || resolution?.tmdbId || resolution?.anilistId)) {
      try {
        const tvdbId = await resolveTvdbId(resolution);
        if (tvdbId) {
          const tvdbResult = await fetchTvdbSeriesMetadata(tvdbId, locale, fallbackPoster);
          if (
            tvdbResult?.state === ResultState.AVAILABLE ||
            tvdbResult?.state === ResultState.PARTIALLY_AVAILABLE ||
            tvdbResult?.state === ResultState.OFFLINE_WITH_CACHE
          ) {
            return tvdbResult;
          }
        }
      } catch {
        // TheTVDB unavailable — fall through to existing providers
      }
    }

    // ── Existing fallback providers ──────────────────────────────────────
    switch (resolution?.source) {
      case "tmdb":
        return fetchTmdbSeriesMetadata(resolution.tmdbId, locale, fallbackPoster);
      case "anilist":
        return fetchAnilistSeriesMetadata(resolution.anilistId, locale, fallbackPoster);
      case "omdb":
        return fetchOmdbSeriesMetadata(resolution.imdbId, fallbackPoster);
      default:
        return { state: ResultState.UNAVAILABLE };
    }
  }

  async function fetchTmdbSeriesMetadata(tmdbId, locale, fallbackPoster) {
    const lang = tmdbLanguage(locale);
    const cacheKey = `metadata:v5:series:tmdb:${tmdbId}:${locale}`;
    const cached = readCached(cacheKey, TTL_SERIES);
    if (cached?.payload) {
      return parseCachedSeriesResult(cached, { isStale: isStale(cacheKey, TTL_SERIES) });
    }

    const json = await fetchTmdb(`tv/${tmdbId}`, { language: lang });
    if (json) {
      const result = normalizeTmdbSeriesResult(json, tmdbId, fallbackPoster);
      if (result) {
        writeSeriesCacheEntry(cacheKey, { payload: seriesResultPayload(result), state: result.state }, TTL_SERIES);
        return result;
      }
    }

    // Fallback to English.
    if (locale !== "en") {
      const enKey = `metadata:v5:series:tmdb:${tmdbId}:en`;
      const enCached = readCached(enKey, TTL_SERIES);
      if (enCached?.payload) return parseCachedSeriesResult(enCached, { isStale: true });
      const enJson = await fetchTmdb(`tv/${tmdbId}`, { language: "en-US" });
      if (enJson) {
        const enResult = normalizeTmdbSeriesResult(enJson, tmdbId, fallbackPoster);
        if (enResult) {
          writeSeriesCacheEntry(enKey, { payload: seriesResultPayload(enResult), state: enResult.state }, TTL_SERIES);
          return enResult;
        }
      }
    }

    const stale = readCacheStale(cacheKey);
    if (stale?.payload) {
      return parseCachedSeriesResult(stale, { isStale: true, forceState: ResultState.OFFLINE_WITH_CACHE });
    }
    return { state: ResultState.OFFLINE_NO_CACHE, debugMessage: `TMDb tv/${tmdbId} failed` };
  }

  function normalizeTmdbSeriesResult(json, tmdbId, fallbackPoster) {
    const series = normalizeTmdbSeries(json, tmdbId, fallbackPoster);
    if (!series) return null;
    const seasons = normalizeTmdbSeasonList(json, tmdbId, series.poster);
    return {
      state: seasons.length === 0 ? ResultState.NO_SEASONS : ResultState.AVAILABLE,
      series,
      seasons,
    };
  }

  function normalizeTmdbSeries(json, tmdbId, fallbackPoster = "") {
    const name = json.name || json.original_name;
    if (!name) return null;
    const posterPath = json.poster_path;
    const poster = posterPath ? `${TMDB_IMAGE}${posterPath}` : fallbackPoster;
    return {
      source: "tmdb",
      tmdbId,
      title: name,
      originalTitle: json.original_name || null,
      totalSeasons: parsePositiveCount(json.number_of_seasons),
      totalEpisodes: parsePositiveCount(json.number_of_episodes),
      poster,
      overview: json.overview || "",
      status: json.status || null,
      firstAirDate: json.first_air_date || null,
      lastAirDate: json.last_air_date || null,
    };
  }

  function normalizeTmdbSeasonList(json, tmdbId, fallbackPoster = "") {
    return (json.seasons || [])
      .map((s) => normalizeTmdbSeasonSummary(s, tmdbId, fallbackPoster))
      .filter(Boolean);
  }

  function normalizeTmdbSeasonSummary(json, tmdbId, fallbackPoster = "") {
    if (json.season_number == null) return null;
    const num = json.season_number;
    const posterPath = json.poster_path;
    const poster = posterPath ? `${TMDB_IMAGE}${posterPath}` : fallbackPoster;
    return {
      source: "tmdb",
      seriesTmdbId: tmdbId,
      seasonNumber: num,
      name: json.name || `Season ${num}`,
      poster,
      episodeCount: parsePositiveCount(json.episode_count),
      overview: json.overview || "",
      airDate: json.air_date || null,
      isSpecials: num === 0,
      isSynthetic: false,
    };
  }

  // ─── TMDb season episodes ─────────────────────────────────────

  /**
   * Fetches episodes for a single season.
   *
   * @param {object} resolution   Result of resolveSeriesId()
   * @param {number} seasonNumber
   * @param {string} locale
   * @param {string} [fallbackPoster]
   * @param {object} [seasonSummary]  SeasonSummary, used for poster fallback
   */
  async function fetchSeasonEpisodes(
    resolution,
    seasonNumber,
    locale,
    fallbackPoster = "",
    seasonSummary = null,
    item = null
  ) {
    if (resolution?.isNegative) return { state: ResultState.INVALID_ID };
    const effectivePoster = seasonSummary?.poster || fallbackPoster;

    // ── TheTVDB — primary for episode-specific artwork ───────────────────
    if (window.WatchlistTvdb) {
      try {
        const tvdbId = await resolveTvdbId(resolution);
        if (tvdbId) {
          const tvdbResult = await fetchTvdbSeasonEpisodes(
            tvdbId, seasonNumber, locale, effectivePoster
          );
          if (
            tvdbResult?.state === ResultState.AVAILABLE ||
            tvdbResult?.state === ResultState.OFFLINE_WITH_CACHE
          ) {
            return await enrichEpisodeRatings(
              tvdbResult,
              resolution,
              seasonNumber,
              locale,
              effectivePoster,
              item
            );
          }
        }
      } catch (err) {
        console.warn("[series-metadata] TVDB episodes failed:", err?.message || err);
      }
    }

    // ── Existing fallback providers ──────────────────────────────────────
    switch (resolution?.source) {
      case "tmdb":
        return await enrichEpisodeRatings(
          await fetchTmdbSeasonEpisodes(resolution.tmdbId, seasonNumber, locale, effectivePoster),
          resolution,
          seasonNumber,
          locale,
          effectivePoster,
          item
        );
      case "anilist":
        return await enrichEpisodeRatings(
          await fetchAnilistEpisodes(resolution.anilistId, seasonNumber, effectivePoster),
          resolution,
          seasonNumber,
          locale,
          effectivePoster,
          item
        );
      case "omdb":
        return fetchOmdbSeasonEpisodes(resolution.imdbId, seasonNumber);
      default:
        return { state: ResultState.UNAVAILABLE };
    }
  }

  async function resolveLinkedImdbId(resolution, item = null) {
    if (resolution?.imdbId) return resolution.imdbId;

    const WM = window.WatchlistMetadata;
    const fromLink = WM?.extractImdbId?.(item?.link);
    if (fromLink) return fromLink;

    const anilistId = resolution?.anilistId;
    if (!anilistId) return null;

    const cacheKey = `metadata:v7:resolve:imdb:anilist:${anilistId}`;
    const cached = readCached(cacheKey, TTL_RESOLVE);
    if (cached?.imdbId) return cached.imdbId;

    try {
      const data = await anilistQuery(
        `query ($id: Int) {
          Media(id: $id, type: ANIME) {
            externalLinks { site url }
          }
        }`,
        { id: Number(anilistId) }
      );
      const WM = window.WatchlistMetadata;
      for (const link of data?.Media?.externalLinks || []) {
        if (!/^imdb$/i.test(String(link?.site || ""))) continue;
        const linkedImdb = WM?.extractImdbId?.(link?.url);
        if (linkedImdb) {
          writeSeriesCacheEntry(cacheKey, { imdbId: linkedImdb }, TTL_RESOLVE);
          return linkedImdb;
        }
      }
    } catch {
      // no linked IMDb
    }
    return null;
  }

  async function enrichEpisodesWithTmdbRatings(
    result,
    resolution,
    seasonNumber,
    locale,
    fallbackPoster = ""
  ) {
    if (!result?.episodes?.length || !hasTmdbRatingsAccess()) return result;

    const needsRating = (result.episodes || []).some(episodeNeedsExternalRating);
    if (!needsRating) return result;

    let tmdbId = resolution?.tmdbId;
    if (!tmdbId) {
      const imdbId = await resolveLinkedImdbId(resolution);
      if (imdbId) tmdbId = await resolveTmdbIdByImdb(imdbId);
    }
    if (!tmdbId) return result;

    const byEpisode = await fetchEpisodeRatingMap(tmdbId, seasonNumber, locale);
    if (!byEpisode?.size) return result;

    return {
      ...result,
      episodes: (result.episodes || []).map((ep) => {
        if (!episodeNeedsExternalRating(ep)) return ep;
        const num = Number(ep?.episodeNumber);
        const tmdbRating = byEpisode.get(num);
        if (tmdbRating == null) return ep;
        return {
          ...ep,
          episodeRating: tmdbRating,
          episodeRatingSource: "tmdb",
        };
      }),
    };
  }

  async function enrichEpisodeRatings(
    result,
    resolution,
    seasonNumber,
    locale,
    fallbackPoster = "",
    item = null
  ) {
    // TMDB first — complete per-episode ratings. OMDb season bulk is often incomplete.
    let enriched = await enrichEpisodesWithTmdbRatings(
      result,
      resolution,
      seasonNumber,
      locale,
      fallbackPoster
    );
    enriched = await enrichEpisodesWithOmdbRatings(
      enriched,
      resolution,
      seasonNumber,
      item
    );
    return enriched;
  }

  function buildTmdbRatingMap(rawEpisodes) {
    const byEpisode = new Map();
    for (const ep of rawEpisodes || []) {
      const num = Number(ep?.episode_number ?? ep?.episodeNumber);
      const vote = Number(ep?.vote_average ?? ep?.rating);
      if (!Number.isFinite(num) || !Number.isFinite(vote) || vote <= 0) continue;
      byEpisode.set(num, Math.round(vote * 10) / 10);
    }
    return byEpisode;
  }

  function ratingMapFromCacheObject(obj) {
    if (!obj || typeof obj !== "object") return null;
    const map = new Map();
    for (const [k, v] of Object.entries(obj)) {
      const num = Number(k);
      const rating = Number(v);
      if (Number.isFinite(num) && Number.isFinite(rating) && rating > 0) {
        map.set(num, rating);
      }
    }
    return map.size ? map : null;
  }

  async function fetchEpisodeRatingMap(tmdbId, seasonNumber, locale) {
    const cacheKey = `metadata:v8:season:ratings:tmdb:${tmdbId}:${seasonNumber}:${locale}`;
    const cached = readCached(cacheKey, TTL_EPISODES);
    const fromCache = ratingMapFromCacheObject(cached?.byEpisode);
    if (fromCache) return fromCache;

    let byEpisode = null;

    if (getTmdbKey()) {
      const json = await fetchTmdb(`tv/${tmdbId}/season/${seasonNumber}`, {
        language: tmdbLanguage(locale),
      });
      if (json?.episodes?.length) {
        byEpisode = buildTmdbRatingMap(json.episodes);
      }
      if (!byEpisode?.size && locale !== "en") {
        const enJson = await fetchTmdb(`tv/${tmdbId}/season/${seasonNumber}`, {
          language: "en-US",
        });
        if (enJson?.episodes?.length) {
          byEpisode = buildTmdbRatingMap(enJson.episodes);
        }
      }
    } else if (window.WatchlistTmdb?.fetchSeasonRatings) {
      let rows = await window.WatchlistTmdb.fetchSeasonRatings(
        tmdbId,
        seasonNumber,
        locale
      );
      if (!rows?.length && locale !== "en") {
        rows = await window.WatchlistTmdb.fetchSeasonRatings(
          tmdbId,
          seasonNumber,
          "en"
        );
      }
      if (rows?.length) {
        byEpisode = buildTmdbRatingMap(rows);
      }
    }

    if (!byEpisode?.size) return null;

    writeSeriesCacheEntry(
      cacheKey,
      { byEpisode: Object.fromEntries(byEpisode) },
      TTL_EPISODES
    );
    return byEpisode;
  }

  function hasTmdbRatingsAccess() {
    return Boolean(getTmdbKey() || window.WatchlistTmdb?.fetchSeasonRatings);
  }

  async function enrichEpisodesWithOmdbRatings(
    result,
    resolution,
    seasonNumber,
    item = null
  ) {
    if (!result?.episodes?.length) return result;
    const imdbId = await resolveLinkedImdbId(resolution, item);
    if (!imdbId || !getOmdbKey()) return result;
    const omdb = await fetchOmdbSeasonEpisodes(imdbId, seasonNumber);
    if (
      !omdb ||
      (omdb.state !== ResultState.AVAILABLE && omdb.state !== ResultState.OFFLINE_WITH_CACHE)
    ) {
      return result;
    }

    const byEpisode = new Map();
    for (const ep of omdb.episodes || []) {
      const num = Number(ep?.episodeNumber);
      const rating = Number(ep?.episodeRating);
      if (!Number.isFinite(num) || !Number.isFinite(rating)) continue;
      if (rating <= 0 || rating > 10) continue;
      byEpisode.set(num, Math.round(rating * 10) / 10);
    }

    if (!byEpisode.size) return result;

    return {
      ...result,
      episodes: (result.episodes || []).map((ep) => {
        if (!episodeNeedsExternalRating(ep)) return ep;
        const num = Number(ep?.episodeNumber);
        const omdbRating = byEpisode.get(num);
        if (omdbRating != null) {
          return { ...ep, episodeRating: omdbRating, episodeRatingSource: "imdb" };
        }
        return ep;
      }),
    };
  }

  async function fetchTmdbSeasonEpisodes(tmdbId, season, locale, fallbackPoster = "") {
    const lang = tmdbLanguage(locale);
    // v6 cache key: invalidates old entries that stored repeated poster stills
    const cacheKey = `metadata:v6:season:tmdb:${tmdbId}:${season}:${locale}`;
    const cached = readCached(cacheKey, TTL_EPISODES);
    if (cached?.payload) {
      return parseCachedEpisodesResult(cached, { isStale: isStale(cacheKey, TTL_EPISODES) });
    }

    const json = await fetchTmdb(`tv/${tmdbId}/season/${season}`, { language: lang });
    if (json) {
      const result = normalizeTmdbSeasonEpisodes(json, tmdbId, season, fallbackPoster);
      writeSeriesCacheEntry(cacheKey, { payload: episodesResultPayload(result), state: result.state }, TTL_EPISODES);
      return result;
    }

    if (locale !== "en") {
      const enKey = `metadata:v6:season:tmdb:${tmdbId}:${season}:en`;
      const enCached = readCached(enKey, TTL_EPISODES);
      if (enCached?.payload) return parseCachedEpisodesResult(enCached, { isStale: true });
      const enJson = await fetchTmdb(`tv/${tmdbId}/season/${season}`, { language: "en-US" });
      if (enJson) {
        const enResult = normalizeTmdbSeasonEpisodes(enJson, tmdbId, season, fallbackPoster);
        writeSeriesCacheEntry(enKey, { payload: episodesResultPayload(enResult), state: enResult.state }, TTL_EPISODES);
        return enResult;
      }
    }

    const stale = readCacheStale(cacheKey);
    if (stale?.payload) {
      return parseCachedEpisodesResult(stale, { isStale: true, forceState: ResultState.OFFLINE_WITH_CACHE });
    }
    return { state: ResultState.OFFLINE_NO_CACHE };
  }

  function normalizeTmdbSeasonEpisodes(json, tmdbId, season, fallbackPoster = "") {
    const posterPath = json.poster_path;
    const seasonPoster = posterPath ? `${TMDB_IMAGE}${posterPath}` : fallbackPoster;
    const rawEps = json.episodes || [];
    const episodes = rawEps
      .map((ep) => normalizeTmdbEpisode(ep, tmdbId, seasonPoster, fallbackPoster))
      .filter(Boolean);
    return {
      state: episodes.length === 0 ? ResultState.NO_SEASONS : ResultState.AVAILABLE,
      episodes,
      seasonPoster,
      seasonOverview: json.overview || "",
    };
  }

  function normalizeTmdbEpisode(json, tmdbId, seasonPoster = "", fallbackPoster = "") {
    if (json.episode_number == null) return null;
    const stillPath = json.still_path;
    // Use the real episode still when available; leave empty so the episode row
    // renderer can display a neutral placeholder instead of repeating the poster.
    const still = stillPath ? `${TMDB_IMAGE}${stillPath}` : "";
    const airDate = json.air_date || null;
    const tmdbVote = Number(json.vote_average);
    const episodeRating =
      Number.isFinite(tmdbVote) && tmdbVote > 0
        ? Math.round(tmdbVote * 10) / 10
        : null;
    return {
      source: "tmdb",
      seriesTmdbId: tmdbId,
      seasonNumber: json.season_number ?? 0,
      episodeNumber: json.episode_number,
      title: json.name || `Episode ${json.episode_number}`,
      still,
      overview: json.overview || "",
      runtimeMinutes: json.runtime || null,
      airDate,
      isAired: isAired(airDate),
      progressKey: `${json.season_number ?? 0}:${json.episode_number}`,
      episodeRating,
      episodeRatingSource: episodeRating != null ? "tmdb" : null,
    };
  }

  // ─── AniList series ───────────────────────────────────────────

  async function fetchAnilistSeriesMetadata(anilistId, locale, fallbackPoster = "") {
    const cacheKey = `metadata:v5:series:anilist:${anilistId}:${locale}`;
    const cached = readCached(cacheKey, TTL_SERIES);
    if (cached?.payload) {
      return parseCachedSeriesResult(cached, { isStale: isStale(cacheKey, TTL_SERIES) });
    }

    const data = await anilistQuery(
      `query ($id: Int) {
        Media(id: $id, type: ANIME) {
          id
          title { english romaji native }
          episodes
          coverImage { large }
          description
          startDate { year month day }
          endDate { year month day }
          status
          streamingEpisodes { title thumbnail }
        }
      }`,
      { id: anilistId }
    );

    const media = data?.Media;
    if (!media) {
      const stale = readCacheStale(cacheKey);
      if (stale?.payload) {
        return parseCachedSeriesResult(stale, { isStale: true, forceState: ResultState.OFFLINE_WITH_CACHE });
      }
      return { state: ResultState.OFFLINE_NO_CACHE };
    }

    const title =
      media.title?.english || media.title?.romaji || media.title?.native || "";
    const posterUrl = media.coverImage?.large || fallbackPoster || "";
    const episodeCount = parsePositiveCount(media.episodes);
    const streamingCount = (media.streamingEpisodes || []).length;

    const series = {
      source: "anilist",
      anilistId,
      title,
      totalEpisodes: episodeCount,
      totalSeasons: 1,
      poster: posterUrl,
      overview: stripHtml(media.description || ""),
      status: media.status || null,
      firstAirDate: anilistDateStr(media.startDate),
      lastAirDate: anilistDateStr(media.endDate),
    };

    const season = {
      source: "anilist",
      seasonNumber: 1,
      name: "Season 1",
      poster: posterUrl,
      episodeCount,
      overview: series.overview,
      airDate: series.firstAirDate,
      isSpecials: false,
      isSynthetic: true,
    };

    const hasEpDetails = streamingCount > 0 || episodeCount != null;
    const result = {
      state: hasEpDetails ? ResultState.AVAILABLE : ResultState.EPISODE_DETAILS_UNAVAILABLE,
      series,
      seasons: [season],
    };

    writeSeriesCacheEntry(cacheKey, { payload: seriesResultPayload(result), state: result.state }, TTL_SERIES);
    return result;
  }

  // ─── AniList episodes ─────────────────────────────────────────

  async function fetchAnilistEpisodes(anilistId, seasonNumber, fallbackPoster = "") {
    if (seasonNumber !== 1) {
      return { state: ResultState.UNAVAILABLE };
    }

    // v6 key: invalidates old entries that stored the series poster as episode still
    const cacheKey = `metadata:v6:episodes:anilist:${anilistId}`;
    const cached = readCached(cacheKey, TTL_EPISODES);
    if (cached?.payload) {
      return parseCachedEpisodesResult(cached, { isStale: isStale(cacheKey, TTL_EPISODES) });
    }

    const data = await anilistQuery(
      `query ($id: Int) {
        Media(id: $id, type: ANIME) {
          id
          episodes
          coverImage { large }
          streamingEpisodes { title thumbnail }
        }
      }`,
      { id: anilistId }
    );

    const media = data?.Media;
    if (!media) {
      const stale = readCacheStale(cacheKey);
      if (stale?.payload) {
        return parseCachedEpisodesResult(stale, { isStale: true, forceState: ResultState.OFFLINE_WITH_CACHE });
      }
      return { state: ResultState.OFFLINE_NO_CACHE };
    }

    const episodeCount = parsePositiveCount(media.episodes);
    const streamingEps = media.streamingEpisodes || [];
    const poster = media.coverImage?.large || fallbackPoster || "";

    let episodes;
    let state;

    if (streamingEps.length > 0) {
      // streamingEpisodes is incomplete and unordered — treat as best-effort.
      // Never fall back to the series poster: if a thumbnail is missing the
      // renderer will show the neutral placeholder instead.
      const rawEps = streamingEps.map((ep, i) => ({
        source: "anilist",
        seasonNumber: 1,
        episodeNumber: i + 1,
        title: ep.title || `Episode ${i + 1}`,
        still: ep.thumbnail || "",
        overview: "",
        runtimeMinutes: null,
        airDate: null,
        isAired: true,
        progressKey: `1:${i + 1}`,
      }));
      // Duplicate-thumbnail guard: if every non-empty thumbnail is the same URL
      // (common with promotional art served by some streaming platforms) clear
      // them all so the neutral placeholder shows instead.
      const nonEmpty = rawEps.filter((e) => e.still);
      const uniqueUrls = new Set(nonEmpty.map((e) => e.still));
      const allSame = nonEmpty.length >= 2 && uniqueUrls.size === 1;
      episodes = allSame ? rawEps.map((e) => ({ ...e, still: "" })) : rawEps;
      state = ResultState.PARTIALLY_AVAILABLE;
    } else if (episodeCount != null) {
      // No streaming episode detail — show placeholder for every episode
      episodes = Array.from({ length: episodeCount }, (_, i) => ({
        source: "anilist",
        seasonNumber: 1,
        episodeNumber: i + 1,
        title: `Episode ${i + 1}`,
        still: "",
        overview: "",
        runtimeMinutes: null,
        airDate: null,
        isAired: true,
        progressKey: `1:${i + 1}`,
      }));
      state = ResultState.EPISODE_DETAILS_UNAVAILABLE;
    } else {
      return { state: ResultState.EPISODE_DETAILS_UNAVAILABLE };
    }

    const result = { state, episodes };
    writeSeriesCacheEntry(cacheKey, { payload: episodesResultPayload(result), state }, TTL_EPISODES);
    return result;
  }

  // ─── OMDb series ──────────────────────────────────────────────

  async function fetchOmdbSeriesMetadata(imdbId, fallbackPoster = "") {
    // Attempt to read existing title-level metadata from the main cache.
    const WM = window.WatchlistMetadata;
    const existingMeta = WM?.getMetadata ? await WM.getMetadata(imdbId) : null;

    const title = existingMeta?.title || "";
    const totalSeasons = parsePositiveCount(existingMeta?.seasonCount);
    const poster = existingMeta?.poster || fallbackPoster || "";
    const overview = existingMeta?.plot || "";

    const series = {
      source: "omdb",
      imdbId,
      title,
      totalSeasons,
      poster,
      overview,
    };

    if (!totalSeasons || totalSeasons <= 0) {
      return { state: ResultState.NO_SEASONS, series, seasons: [] };
    }

    const seasons = Array.from({ length: totalSeasons }, (_, i) => ({
      source: "omdb",
      seasonNumber: i + 1,
      name: `Season ${i + 1}`,
      poster,
      episodeCount: null,
      overview: "",
      airDate: null,
      isSpecials: false,
      isSynthetic: true,
    }));

    return { state: ResultState.PARTIALLY_AVAILABLE, series, seasons };
  }

  // ─── OMDb season episodes ─────────────────────────────────────

  async function fetchOmdbSeasonEpisodes(imdbId, season) {
    const cacheKey = `metadata:v7:season:omdb:${imdbId}:${season}`;
    const cached = readCached(cacheKey, TTL_EPISODES);
    if (cached?.payload) {
      return parseCachedEpisodesResult(cached, { isStale: isStale(cacheKey, TTL_EPISODES) });
    }

    const apiKey = getOmdbKey();
    if (!apiKey) return { state: ResultState.UNAVAILABLE, debugMessage: "No OMDb key" };

    try {
      const url = new URL("https://www.omdbapi.com/");
      url.searchParams.set("i", imdbId);
      url.searchParams.set("Season", String(season));
      url.searchParams.set("apikey", apiKey);

      const response = await fetch(url.toString());
      if (response.status === 429) return { state: ResultState.RATE_LIMITED };
      if (!response.ok) return { state: ResultState.API_FAILURE, debugMessage: `status ${response.status}` };

      const json = await response.json();
      if (json.Response !== "True") {
        return { state: ResultState.UNAVAILABLE, debugMessage: json.Error };
      }

      const episodes = normalizeOmdbSeason(json, season);
      const result = { state: ResultState.AVAILABLE, episodes };
      writeSeriesCacheEntry(cacheKey, { payload: episodesResultPayload(result), state: result.state }, TTL_EPISODES);
      return result;
    } catch (err) {
      const stale = readCacheStale(cacheKey);
      if (stale?.payload) {
        return parseCachedEpisodesResult(stale, { isStale: true, forceState: ResultState.OFFLINE_WITH_CACHE });
      }
      return { state: ResultState.OFFLINE_NO_CACHE, debugMessage: String(err) };
    }
  }

  function normalizeOmdbSeason(json, season) {
    return (json.Episodes || [])
      .map((ep) => {
        const epNum = parsePositiveCount(ep.Episode);
        if (!epNum) return null;
        const released = na(ep.Released);
        const episodeRating = parseOmdbRating(ep.imdbRating);
        return {
          source: "omdb",
          seasonNumber: season,
          episodeNumber: epNum,
          title: na(ep.Title) || `Episode ${epNum}`,
          still: "",        // OMDb never provides stills
          overview: "",     // OMDb never provides per-episode summaries
          runtimeMinutes: null,
          airDate: released || null,
          isAired: released ? isAired(released) : true,
          progressKey: `${season}:${epNum}`,
          episodeRating,
          episodeRatingSource: episodeRating != null ? "imdb" : null,
        };
      })
      .filter(Boolean);
  }

  function parseOmdbRating(raw) {
    const s = String(raw || "").trim();
    if (!s || /^n\/a$/i.test(s)) return null;
    const n = Number(s.replace(",", "."));
    if (!Number.isFinite(n) || n <= 0 || n > 10) return null;
    return Math.round(n * 10) / 10;
  }

  function episodeNeedsExternalRating(ep) {
    const n = Number(ep?.episodeRating);
    return !Number.isFinite(n) || n <= 0;
  }

  // ─── HTTP helpers ─────────────────────────────────────────────

  async function fetchTmdb(path, params = {}) {
    const key = getTmdbKey();
    if (!key) return null;
    try {
      const url = new URL(`${TMDB_API_BASE}/${path}`);
      Object.entries({ ...params, api_key: key }).forEach(([k, v]) =>
        url.searchParams.set(k, String(v))
      );
      const res = await fetch(url.toString());
      if (res.status === 429 || !res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  }

  async function anilistQuery(query, variables) {
    try {
      const res = await fetch(ANILIST_API, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ query, variables }),
      });
      const json = await res.json();
      if (!res.ok || (json.errors && json.errors.length > 0)) return null;
      return json.data;
    } catch {
      return null;
    }
  }

  // ─── Cache result helpers ─────────────────────────────────────

  function seriesResultPayload(result) {
    return {
      ...(result.series ? { series: result.series } : {}),
      ...(result.seasons ? { seasons: result.seasons } : {}),
    };
  }

  function episodesResultPayload(result) {
    if (!result?.episodes) return {};
    return {
      episodes: result.episodes,
      ...(result.seasonPoster ? { seasonPoster: result.seasonPoster } : {}),
      ...(result.seasonOverview ? { seasonOverview: result.seasonOverview } : {}),
    };
  }

  function parseCachedSeriesResult(cached, { isStale = false, forceState = null } = {}) {
    const payload = cached?.payload;
    if (!payload) return { state: ResultState.UNAVAILABLE };
    const stateStr = forceState || cached.state || ResultState.AVAILABLE;
    return {
      state: stateStr,
      series: payload.series || null,
      seasons: payload.seasons || null,
      isStale,
    };
  }

  function parseCachedEpisodesResult(cached, { isStale = false, forceState = null } = {}) {
    const payload = cached?.payload;
    if (!payload) return { state: ResultState.UNAVAILABLE };
    const stateStr = forceState || cached.state || ResultState.AVAILABLE;
    const episodes = (payload.episodes || []).map((ep) => ({
      ...ep,
      still: normalizeArtworkUrl(ep.still),
    }));
    return {
      state: stateStr,
      episodes,
      seasonPoster: payload.seasonPoster || null,
      seasonOverview: payload.seasonOverview || null,
      isStale,
    };
  }

  // ─── Utilities ────────────────────────────────────────────────

  function parsePositiveCount(value) {
    if (value == null) return null;
    const n = typeof value === "number" ? value : parseInt(String(value).replace(/,/g, ""), 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  function isAired(airDate) {
    if (!airDate) return true;
    try {
      return new Date(airDate) < new Date();
    } catch {
      return true;
    }
  }

  function anilistDateStr(dateObj) {
    if (!dateObj || dateObj.year == null) return null;
    const y = dateObj.year;
    const m = dateObj.month;
    const d = dateObj.day;
    if (m == null) return `${y}`;
    if (d == null) return `${y}-${String(m).padStart(2, "0")}`;
    return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }

  function stripHtml(html) {
    return String(html || "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .trim();
  }

  function na(value) {
    const text = String(value || "");
    return text === "N/A" ? "" : text;
  }

  // ─── Cache clearing (for retry) ──────────────────────────────

  /**
   * Clears the negative IMDb→TMDb resolution cache for an item.
   * Called by title-seasons.js when the user taps Retry so the next
   * resolveSeriesId() attempt is not blocked by a stale failure.
   */
  function clearItemResolutionCache(item) {
    const WM = window.WatchlistMetadata;
    const link = item?.link || "";
    const imdbId = WM?.extractImdbId?.(link);
    if (!imdbId) return;
    const negKey = `metadata:v5:resolve:negative:imdb:${imdbId}`;
    _memory.delete(negKey);
    try {
      const cache = readSeriesCache();
      if (cache[negKey]) {
        delete cache[negKey];
        localStorage.setItem(SERIES_CACHE_KEY, JSON.stringify(cache));
      }
    } catch { /* ignore */ }
  }

  // ─── One-time cache eviction ──────────────────────────────────
  // Purge old v5 AniList episode entries that stored the series poster as
  // episode stills. Runs once at module load; harmless if keys are absent.
  (function evictObsoleteEpisodeCache() {
    try {
      const cache = readSeriesCache();
      let changed = false;
      Object.keys(cache).forEach((k) => {
        if (k.startsWith("metadata:v5:episodes:anilist:")) {
          delete cache[k];
          _memory.delete(k);
          changed = true;
        }
      });
      if (changed) localStorage.setItem(SERIES_CACHE_KEY, JSON.stringify(cache));
    } catch { /* storage unavailable — skip */ }
  })();

  // ─── TheTVDB provider ─────────────────────────────────────────

  /**
   * Resolve a TheTVDB series ID from the existing resolution object.
   * Uses the v7 cache tier (separate from the existing v5 TMDb resolution).
   * Returns the numeric tvdbId, or null on miss/failure.
   *
   * @param {{ imdbId?: string, tmdbId?: number }} resolution
   * @returns {Promise<number|null>}
   */
  async function resolveTvdbId(resolution) {
    const WTvdb = window.WatchlistTvdb;
    if (!WTvdb) return null;

    const imdbId = resolution?.imdbId;
    const tmdbId = resolution?.tmdbId;

    // ── Primary: IMDb → TVDB via Edge Function (no TMDb key required) ───
    if (imdbId) {
      const cacheKey = `metadata:v7:resolve:tvdb:imdb:${imdbId}`;
      const cached = readCached(cacheKey, TTL_RESOLVE);
      if (cached?.tvdbId) return cached.tvdbId;

      const negKey = `metadata:v7:resolve:tvdb:negative:imdb:${imdbId}`;
      if (isNegativeCacheValid(negKey)) return null;

      try {
        const result = await WTvdb.resolveId({ imdbId });
        if (result?.tvdbId) {
          writeSeriesCacheEntry(cacheKey, { tvdbId: result.tvdbId }, TTL_RESOLVE);
          return result.tvdbId;
        }
      } catch { /* fall through */ }
      writeNegativeCache(negKey, TTL_NEGATIVE);
    }

    // ── Optional: TMDb external_ids when a TMDb key is configured ───────
    if (tmdbId && getTmdbKey()) {
      const cacheKey = `metadata:v7:resolve:tvdb:tmdb:${tmdbId}`;
      const cached = readCached(cacheKey, TTL_RESOLVE);
      if (cached?.tvdbId) return cached.tvdbId;

      const negKey = `metadata:v7:resolve:tvdb:negative:tmdb:${tmdbId}`;
      if (isNegativeCacheValid(negKey)) return null;

      try {
        const json = await fetchTmdb(`tv/${tmdbId}/external_ids`, {});
        if (json?.tvdb_id) {
          const tvdbId = Number(json.tvdb_id);
          if (tvdbId > 0) {
            writeSeriesCacheEntry(cacheKey, { tvdbId }, TTL_RESOLVE);
            return tvdbId;
          }
        }
      } catch { /* fall through */ }

      // TMDb external_ids missing — try Edge Function with TMDb remote id
      try {
        const result = await WTvdb.resolveId({ tmdbId });
        if (result?.tvdbId) {
          writeSeriesCacheEntry(cacheKey, { tvdbId: result.tvdbId }, TTL_RESOLVE);
          return result.tvdbId;
        }
      } catch { /* fall through */ }
      writeNegativeCache(negKey, TTL_NEGATIVE);
    }

    // ── AniList → IMDb external link → TVDB ─────────────────────────────
    const anilistId = resolution?.anilistId;
    if (anilistId) {
      const cacheKey = `metadata:v7:resolve:tvdb:anilist:${anilistId}`;
      const cached = readCached(cacheKey, TTL_RESOLVE);
      if (cached?.tvdbId) return cached.tvdbId;

      try {
        const data = await anilistQuery(
          `query ($id: Int) {
            Media(id: $id, type: ANIME) {
              externalLinks { site url }
            }
          }`,
          { id: Number(anilistId) }
        );
        const WM = window.WatchlistMetadata;
        const links = data?.Media?.externalLinks || [];
        for (const link of links) {
          if (!/^imdb$/i.test(String(link?.site || ""))) continue;
          const linkedImdb = WM?.extractImdbId?.(link?.url);
          if (!linkedImdb) continue;
          const tvdbId = await resolveTvdbId({ imdbId: linkedImdb });
          if (tvdbId) {
            writeSeriesCacheEntry(cacheKey, { tvdbId }, TTL_RESOLVE);
            return tvdbId;
          }
        }
      } catch { /* fall through */ }
    }

    return null;
  }

  /**
   * Fetch series and season metadata from TheTVDB.
   * Makes two parallel Edge Function calls: series info + season list.
   *
   * @param {number} tvdbId
   * @param {string} locale
   * @param {string} fallbackPoster
   * @returns {Promise<SeriesMetadataResult>}
   */
  async function fetchTvdbSeriesMetadata(tvdbId, locale, fallbackPoster = "") {
    const cacheKey = `metadata:v8:series:tvdb:${tvdbId}:${locale}`;
    const cached = readCached(cacheKey, TTL_SERIES);
    if (cached?.payload) {
      return parseCachedSeriesResult(cached, { isStale: isStale(cacheKey, TTL_SERIES) });
    }

    const WTvdb = window.WatchlistTvdb;
    if (!WTvdb) return { state: ResultState.UNAVAILABLE };

    try {
      const [seriesData, seasonsData] = await Promise.all([
        WTvdb.fetchSeries(tvdbId, locale),
        WTvdb.fetchSeasons(tvdbId, locale),
      ]);

      if (!seriesData) {
        const stale = readCacheStale(cacheKey);
        if (stale?.payload) {
          return parseCachedSeriesResult(stale, {
            isStale: true,
            forceState: ResultState.OFFLINE_WITH_CACHE,
          });
        }
        return { state: ResultState.OFFLINE_NO_CACHE };
      }

      const poster = seriesData.poster || fallbackPoster || "";
      const rawSeasons = seasonsData || [];

      const seasons = rawSeasons.map((s) => ({
        source: "tvdb",
        seasonNumber: s.seasonNumber,
        tvdbSeasonId: s.tvdbSeasonId,
        name: s.name,
        poster: s.poster || poster,
        episodeCount: null,
        overview: s.overview || "",
        airDate: s.airDate || null,
        isSpecials: s.isSpecials || false,
      }));

      let episodeTotal = null;
      try {
        const totals = await WTvdb.fetchEpisodeTotals(tvdbId, locale);
        if (totals?.seasonCounts) {
          for (const season of seasons) {
            if (season.seasonNumber <= 0) continue;
            const count = parsePositiveCount(totals.seasonCounts[String(season.seasonNumber)]);
            if (count > 0) season.episodeCount = count;
          }
        }
        if (totals?.episodeTotal > 0) episodeTotal = totals.episodeTotal;
      } catch {
        // Episode counts unavailable — seasons still render without totals.
      }

      const series = {
        source: "tvdb",
        tvdbId,
        imdbId: seriesData.imdbId || null,
        title: seriesData.title || "",
        overview: seriesData.overview || "",
        poster,
        status: seriesData.status || null,
        firstAirDate: seriesData.firstAired || null,
        totalSeasons: rawSeasons.filter((s) => !s.isSpecials).length,
        totalEpisodes: episodeTotal,
      };

      const result = {
        state: seasons.length > 0 ? ResultState.AVAILABLE : ResultState.NO_SEASONS,
        series,
        seasons,
      };

      writeSeriesCacheEntry(
        cacheKey,
        { payload: seriesResultPayload(result), state: result.state },
        TTL_SERIES
      );
      return result;

    } catch {
      const stale = readCacheStale(cacheKey);
      if (stale?.payload) {
        return parseCachedSeriesResult(stale, {
          isStale: true,
          forceState: ResultState.OFFLINE_WITH_CACHE,
        });
      }
      return { state: ResultState.UNAVAILABLE };
    }
  }

  /**
   * Fetch episode details for one season from TheTVDB.
   * Applies duplicate-image detection: if every episode in a season has the
   * exact same still URL the images are treated as non-unique and cleared.
   *
   * @param {number} tvdbId
   * @param {number} season
   * @param {string} locale
   * @param {string} fallbackPoster
   * @returns {Promise<EpisodesResult>}
   */
  async function fetchTvdbSeasonEpisodes(tvdbId, season, locale, fallbackPoster = "") {
    // Use locale-keyed cache so locale switches still work correctly
    const cacheKey = `metadata:v12:season:tvdb:${tvdbId}:${season}:${locale}`;
    const cached = readCached(cacheKey, TTL_EPISODES);
    if (cached?.payload) {
      return parseCachedEpisodesResult(cached, { isStale: isStale(cacheKey, TTL_EPISODES) });
    }

    const WTvdb = window.WatchlistTvdb;
    if (!WTvdb) return { state: ResultState.UNAVAILABLE };

    try {
      const raw = await WTvdb.fetchEpisodes(tvdbId, season, locale);

      if (!raw) {
        const stale = readCacheStale(cacheKey);
        if (stale?.payload) {
          return parseCachedEpisodesResult(stale, {
            isStale: true,
            forceState: ResultState.OFFLINE_WITH_CACHE,
          });
        }
        return { state: ResultState.OFFLINE_NO_CACHE };
      }

      if (!raw.length) return { state: ResultState.UNAVAILABLE };

      // Keep only episodes for the requested season (TVDB lang path may return all).
      const filtered = raw
        .filter((e) => e.seasonNumber === season)
        .map((e) => ({ ...e, still: normalizeArtworkUrl(e.still) }));

      // Duplicate-image guard: only clear when every still is the season poster.
      const seasonPosterUrl = normalizeArtworkUrl(fallbackPoster);
      const nonEmpty = filtered.filter((e) => e.still);
      const uniqueUrls = new Set(nonEmpty.map((e) => e.still));
      const isPosterDup = nonEmpty.length >= 2
        && uniqueUrls.size === 1
        && seasonPosterUrl
        && uniqueUrls.has(seasonPosterUrl);
      const episodes = isPosterDup
        ? filtered.map((e) => ({ ...e, still: "" }))
        : filtered;

      const result = { state: ResultState.AVAILABLE, episodes };
      writeSeriesCacheEntry(
        cacheKey,
        { payload: episodesResultPayload(result), state: result.state },
        TTL_EPISODES
      );
      return result;

    } catch {
      const stale = readCacheStale(cacheKey);
      if (stale?.payload) {
        return parseCachedEpisodesResult(stale, {
          isStale: true,
          forceState: ResultState.OFFLINE_WITH_CACHE,
        });
      }
      return { state: ResultState.UNAVAILABLE };
    }
  }

  // ─── Title badge helpers (episode totals, metadata) ─────────────

  /** Sum regular-season episode counts (excludes specials). */
  function regularEpisodeTotalFromSeasons(seasons) {
    let total = 0;
    for (const season of seasons || []) {
      if (!season || season.seasonNumber <= 0 || season.isSpecials) continue;
      const count = parsePositiveCount(season.episodeCount);
      if (count > 0) total += count;
    }
    return total > 0 ? total : null;
  }

  /**
   * Resolve total regular episode count for a TV/anime title.
   * Tries cached title metadata first, then TVDB/TMDB/AniList providers.
   */
  async function fetchTitleEpisodeTotal(item, locale = "en") {
    const ct = item?.contentType;
    if (ct !== "tvSeries" && ct !== "anime") return null;

    const WM = window.WatchlistMetadata;
    const imdbId = WM?.extractImdbId?.(item?.link);

    if (WM) {
      let meta = null;
      if (imdbId) meta = await WM.getMetadata(imdbId);
      else if (item?.link && WM.isSupportedLink?.(item.link)) {
        meta = await WM.resolveMetadataFromLink(item.link);
      }
      const fromMeta = parsePositiveCount(meta?.episodeCount);
      if (fromMeta > 0) return fromMeta;
    }

    const resolution = await resolveSeriesId(item);
    if (!resolution || resolution.isNegative) return null;

    if (window.WatchlistTvdb) {
      try {
        const tvdbId = await resolveTvdbId(resolution);
        if (tvdbId) {
          const totals = await window.WatchlistTvdb.fetchEpisodeTotals(tvdbId, locale);
          if (totals?.episodeTotal > 0) return totals.episodeTotal;
        }
      } catch {
        // fall through to other providers
      }
    }

    if (resolution.tmdbId) {
      const result = await fetchTmdbSeriesMetadata(
        resolution.tmdbId,
        locale,
        item?.poster || ""
      );
      const fromSeasons = regularEpisodeTotalFromSeasons(result?.seasons);
      if (fromSeasons) return fromSeasons;
      const fromSeries = parsePositiveCount(result?.series?.totalEpisodes);
      if (fromSeries > 0) return fromSeries;
    }

    if (resolution.anilistId) {
      const result = await fetchAnilistSeriesMetadata(
        resolution.anilistId,
        locale,
        item?.poster || ""
      );
      const fromSeasons = regularEpisodeTotalFromSeasons(result?.seasons);
      if (fromSeasons) return fromSeasons;
      const fromSeries = parsePositiveCount(result?.series?.totalEpisodes);
      if (fromSeries > 0) return fromSeries;
    }

    return null;
  }

  /**
   * Fetch badge fields (age, runtime, seasons, episodes) for a title.
   * Used on add and login backfill.
   */
  async function fetchTitleBadgeMeta(item, locale = "en") {
    const patches = {};
    const WM = window.WatchlistMetadata;
    const imdbId = WM?.extractImdbId?.(item?.link);

    let meta = null;
    if (imdbId) meta = await WM.getMetadata(imdbId);
    else if (item?.link && WM?.isSupportedLink?.(item.link)) {
      meta = await WM.resolveMetadataFromLink(item.link);
    }

    if (meta) {
      if (meta.ageRating) patches.ageRating = meta.ageRating;
      if (meta.runtime) patches.runtime = meta.runtime;
      if (meta.seasonCount) patches.seasonCount = meta.seasonCount;
      if (meta.episodeCount) patches.episodeCount = meta.episodeCount;
    }

    const ct = item?.contentType;
    if ((ct === "tvSeries" || ct === "anime") && !patches.episodeCount) {
      const total = await fetchTitleEpisodeTotal(item, locale);
      if (total > 0) patches.episodeCount = total;
    }

    return Object.keys(patches).length ? patches : null;
  }

  // ─── Expose public API ────────────────────────────────────────

  window.WatchlistSeriesMetadata = {
    ResultState,
    resolveSeriesId,
    fetchSeriesMetadata,
    fetchSeasonEpisodes,
    fetchTitleEpisodeTotal,
    fetchTitleBadgeMeta,
    regularEpisodeTotalFromSeasons,
    clearItemResolutionCache,
    // Normalization functions exposed for testing
    _normalizeTmdbSeries: normalizeTmdbSeries,
    _normalizeTmdbSeasonSummary: normalizeTmdbSeasonSummary,
    _normalizeTmdbEpisode: normalizeTmdbEpisode,
    _normalizeOmdbSeason: normalizeOmdbSeason,
    _isAired: isAired,
    _parsePositiveCount: parsePositiveCount,
    _anilistDateStr: anilistDateStr,
    _stripHtml: stripHtml,
    // TheTVDB provider functions exposed for testing
    _resolveTvdbId: resolveTvdbId,
    _fetchTvdbSeriesMetadata: fetchTvdbSeriesMetadata,
    _fetchTvdbSeasonEpisodes: fetchTvdbSeasonEpisodes,
  };
})();
