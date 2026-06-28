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

  function hasTvdbBackend() {
    const cfg = window.WATCHLIST_CONFIG || {};
    return Boolean(
      window.WatchlistTvdb ||
        (cfg.supabaseUrl && cfg.supabaseAnonKey)
    );
  }

  async function callTvdbMetadata(payload) {
    const cfg = window.WATCHLIST_CONFIG || {};
    const base = String(cfg.supabaseUrl || "").replace(/\/$/, "");
    const key = cfg.supabaseAnonKey || "";
    if (!base || !key) return null;
    try {
      const resp = await fetch(`${base}/functions/v1/tvdb-metadata`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
          apikey: key,
        },
        body: JSON.stringify(payload),
      });
      if (!resp.ok) {
        console.warn("[series-metadata] tvdb-metadata HTTP", resp.status);
        return null;
      }
      return await resp.json();
    } catch (err) {
      console.warn("[series-metadata] tvdb-metadata failed:", err?.message || err);
      return null;
    }
  }

  async function fetchTvdbAbsoluteEpisodesDirect(tvdbId, locale, minWanted = 0) {
    void minWanted;
    const tvdbLocale = "en";
    const basePayload = {
      tvdbId: Number(tvdbId),
      locale: tvdbLocale,
      order: "absolute",
    };

    const attempts = [
      { action: "allEpisodes", ...basePayload },
      { action: "episodes", ...basePayload, all: true },
    ];

    for (const payload of attempts) {
      const result = await callTvdbMetadata(payload);
      if (result?.error) {
        console.warn("[series-metadata] TVDB bulk error:", result.error, payload.action);
        continue;
      }
      const eps = result?.episodes;
      if (!Array.isArray(eps) || !eps.length) continue;
      return eps
        .map((e) => ({ ...e, still: normalizeArtworkUrl(e.still) }))
        .sort((a, b) => a.episodeNumber - b.episodeNumber);
    }
    return [];
  }
  const ANILIST_API = "https://graphql.anilist.co";
  const _anilistInflight = new Map();
  let _anilistCooldownUntil = 0;
  const ANILIST_COOLDOWN_MS = 90_000;

  function isAnilistRateLimited() {
    return Date.now() < _anilistCooldownUntil;
  }

  function markAnilistRateLimited() {
    _anilistCooldownUntil = Date.now() + ANILIST_COOLDOWN_MS;
  }
  const TMDB_API_BASE = "https://api.themoviedb.org/3";

  // ─── TTLs (milliseconds) ──────────────────────────────────────
  const TTL_SERIES = 7 * 24 * 60 * 60 * 1000;        // 7 days
  const TTL_EPISODES = 24 * 60 * 60 * 1000;           // 24 hours
  const TTL_RESOLVE = 30 * 24 * 60 * 60 * 1000;       // 30 days
  const TTL_NEGATIVE = 2 * 60 * 60 * 1000;            // 2 hours
  const STALE_RATIO = 0.8;
  const FETCH_TIMEOUT_MS = 40000;
  const ANILIST_CHAIN_TIMEOUT_MS = 60000;
  const EPISODE_ENRICH_TIMEOUT_MS = 30000;

  function isBrowserOffline() {
    return typeof navigator !== "undefined" && navigator.onLine === false;
  }

  /** Distinguish real offline from transient API/network failures on mobile. */
  function failWithoutCache(debugMessage) {
    return {
      state: isBrowserOffline()
        ? ResultState.OFFLINE_NO_CACHE
        : ResultState.API_FAILURE,
      debugMessage,
    };
  }

  async function fetchWithTimeout(url, options = {}, timeoutMs = FETCH_TIMEOUT_MS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...options, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

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

  /** True when title embeds a different episode number (e.g. "Episode 13 - …" on ep 1). */
  function episodeTitleNumberMismatch(title, epNum) {
    const m = String(title || "").trim().match(/^episode\s*0*(\d+)/i);
    if (!m) return false;
    return Number(m[1]) !== Number(epNum);
  }

  function episodesHaveMisnumberedTitles(episodes) {
    if (!episodes?.length) return false;
    const sample = episodes.slice(0, Math.min(8, episodes.length));
    let hits = 0;
    for (const ep of sample) {
      if (episodeTitleNumberMismatch(ep.title, ep.episodeNumber)) hits++;
    }
    return hits >= 2;
  }

  function isLatinDominant(text) {
    const letters = String(text || "").match(/\p{L}/gu);
    if (!letters?.length) return false;
    const latin = letters.filter((c) => /[A-Za-z]/.test(c)).length;
    return latin / letters.length >= 0.55;
  }

  /** Strip redundant "Episode N" prefix — UI already shows episode number. */
  function cleanEpisodeDisplayTitle(title, epNum) {
    let text = String(title || "").trim();
    if (!text) return "";
    const num = Number(epNum);
    if (!Number.isFinite(num)) return text;
    const patterns = [
      new RegExp(`^episode\\s*0*${num}\\s*[-:–—|]\\s*`, "i"),
      new RegExp(`^episode\\s*0*${num}\\s+`, "i"),
      new RegExp(`^ep\\.?\\s*0*${num}\\s*[-:–—|]?\\s*`, "i"),
      new RegExp(`^0*${num}x\\d{2}\\s*[-:–—|]?\\s*`, "i"),
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

  function mergeAnimeEpisodeTitle(anilistTitle, tvdbTitle, epNum, locale, preferTvdb = false) {
    const al = cleanEpisodeDisplayTitle(anilistTitle, epNum);
    const tv = cleanEpisodeDisplayTitle(tvdbTitle, epNum);
    const alBad =
      episodeTitleNumberMismatch(anilistTitle, epNum) ||
      episodeTitleNumberMismatch(al, epNum);

    if (preferTvdb || alBad) {
      if (tv) return tv;
      if (tvdbTitle && !episodeTitleNumberMismatch(tvdbTitle, epNum)) {
        return cleanEpisodeDisplayTitle(tvdbTitle, epNum) || String(tvdbTitle).trim();
      }
    }

    if (locale === "ar") {
      return (
        pickLocalizedEpisodeText(tv, al, epNum) ||
        pickLocalizedEpisodeText(al, tv, epNum) ||
        `Episode ${epNum}`
      );
    }
    if (tv && isLatinDominant(tv) && (alBad || !al || !isLatinDominant(al))) return tv;
    if (al && isLatinDominant(al) && !alBad) return al;
    if (tv && isLatinDominant(tv)) return tv;
    // English UI: never show Japanese-only titles from AniList streaming data.
    if (locale !== "ar") return `Episode ${epNum}`;
    return al || tv || `Episode ${epNum}`;
  }

  function mergeAnimeEpisodeOverview(anilistOverview, tvdbOverview, locale) {
    const tv = String(tvdbOverview || "").trim();
    const al = String(anilistOverview || "").trim();
    let merged = "";
    if (locale === "ar") merged = pickLocalizedOverview(tv, al);
    else if (tv && isLatinDominant(tv)) merged = tv;
    else if (al && isLatinDominant(al)) merged = al;
    return cleanEpisodeOverviewText(merged);
  }

  function pickLatinEpisodeOverview(primary, english) {
    const en = String(english || "").trim();
    const primaryText = String(primary || "").trim();
    if (en && isLatinDominant(en)) return en;
    if (primaryText && isLatinDominant(primaryText)) return primaryText;
    return "";
  }

  function pickLocalizedEpisodeText(localText, enText, epNum) {
    const local = String(localText || "").trim();
    const en = String(enText || "").trim();
    if (local && !isGenericEpisodeTitle(local, epNum)) return local;
    if (en) return en;
    if (local) return local;
    return "";
  }

  function pickLocalizedOverview(localText, enText) {
    const local = String(localText || "").trim();
    const en = String(enText || "").trim();
    return local || en;
  }

  function mergeEpisodeLocaleResults(localResult, enResult) {
    if (!localResult?.episodes?.length) return enResult || localResult;
    if (!enResult?.episodes?.length) return localResult;
    const enByKey = new Map(
      enResult.episodes.map((ep) => [ep.progressKey || `${ep.seasonNumber}:${ep.episodeNumber}`, ep])
    );
    return {
      ...localResult,
      seasonOverview: cleanEpisodeOverviewText(
        pickLocalizedOverview(localResult.seasonOverview, enResult.seasonOverview)
      ),
      episodes: localResult.episodes.map((ep) => {
        const key = ep.progressKey || `${ep.seasonNumber}:${ep.episodeNumber}`;
        const enEp = enByKey.get(key);
        if (!enEp) return ep;
        const epNum = ep.episodeNumber;
        return {
          ...ep,
          title: pickLocalizedEpisodeText(ep.title, enEp.title, epNum)
            || `Episode ${epNum}`,
          overview: cleanEpisodeOverviewText(
            pickLocalizedOverview(ep.overview, enEp.overview)
          ),
        };
      }),
    };
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
  const _memoryLargeEpisodes = new Map();

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

    if (ct === "anime") {
      const animeRes = await resolveAnimeSeriesId(item);
      if (!animeRes.isNegative) return animeRes;
      // Legacy anime rows (IMDb-only link): fall through to TVDB/TMDb path below.
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

    // ── TMDb link (direct from search when no IMDb ID) ─────────
    const tmdbLink = WM?.extractTmdbId?.(link);
    if (tmdbLink?.mediaType === "tv" && tmdbLink.tmdbId) {
      return {
        source: "tmdb",
        tmdbId: tmdbLink.tmdbId,
        isNegative: false,
      };
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

  /**
   * Which AniList media ID to use for this app season.
   * Season 1 = your item's AniList link. Season 2+ = each cour's own ID on the season card.
   */
  function pickSeasonAnilistId(seasonSummary, resolution, seasonNumber) {
    const sn = Number(seasonNumber);
    const root = Number(resolution?.anilistId);
    const fromSummary = Number(seasonSummary?.anilistId);
    if (Number.isFinite(fromSummary) && fromSummary > 0) {
      // Cached season rows sometimes repeat the root ID — never use it for S2+.
      if (Number.isFinite(sn) && sn > 1 && Number.isFinite(root) && fromSummary === root) {
        return null;
      }
      return fromSummary;
    }
    if (!Number.isFinite(sn) || sn <= 1) {
      return Number.isFinite(root) && root > 0 ? root : null;
    }
    return null;
  }

  async function resolveAnimeSeriesId(item) {
    const WM = window.WatchlistMetadata;
    const link = item?.link || "";

    if (link) {
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
    }

    const imdbId = getImdbIdFromItem(item);
    if (imdbId) {
      const fromImdb = await resolveAnilistIdByImdb(imdbId, item);
      if (fromImdb) {
        return {
          source: "anilist",
          anilistId: fromImdb,
          imdbId,
          isNegative: false,
        };
      }
    }

    const title = String(item?.title || "").trim();
    if (title.length >= 2) {
      const fromTitle = await resolveAnilistIdByTitle(title, item?.year);
      if (fromTitle) {
        return {
          source: "anilist",
          anilistId: fromTitle,
          imdbId: imdbId || null,
          isNegative: false,
        };
      }
    }

    // No AniList match — allow IMDb → TVDB episode path (how the app worked before).
    if (imdbId) {
      return { source: "omdb", imdbId, isNegative: false };
    }

    return { source: "none", isNegative: true };
  }

  function getImdbIdFromItem(item) {
    const WM = window.WatchlistMetadata;
    return (
      WM?.extractImdbId?.(item?.imdbLink) ||
      WM?.extractImdbId?.(item?.link) ||
      null
    );
  }

  async function resolveAnilistIdByTitle(title, year) {
    const match = await window.WatchlistMetadata?.fetchAnilistMatchByTitle?.(
      title,
      year
    );
    return match?.anilistId ? Number(match.anilistId) : null;
  }

  async function resolveAnilistIdByImdb(imdbId, item) {
    const cacheKey = `metadata:v5:resolve:anilist:imdb:${imdbId}`;
    const cached = readCached(cacheKey, TTL_RESOLVE);
    if (cached?.anilistId) return cached.anilistId;

    const byTitle = await resolveAnilistIdByTitle(item?.title, item?.year);
    if (byTitle) {
      const linked = await resolveLinkedImdbId({ anilistId: byTitle });
      if (!linked || linked === imdbId) {
        writeSeriesCacheEntry(cacheKey, { anilistId: byTitle }, TTL_RESOLVE);
        return byTitle;
      }
    }
    return null;
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

    // Anime: AniList is canonical (episode totals, single season).
    if (resolution?.anilistId) {
      return fetchAnilistSeriesMetadata(resolution.anilistId, locale, fallbackPoster);
    }

    // ── TheTVDB — primary for live-action TV ─────────────────────────────
    if (window.WatchlistTvdb && (resolution?.imdbId || resolution?.tmdbId)) {
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
    return failWithoutCache(`TMDb tv/${tmdbId} failed`);
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
      overview: cleanEpisodeOverviewText(json.overview || ""),
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
      overview: cleanEpisodeOverviewText(json.overview || ""),
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
  const _anilistSeasonChainIds = new Map();
  const _rootTitleFingerprint = new Map();

  async function getAnilistRootTitleFingerprint(rootAnilistId) {
    const key = String(rootAnilistId);
    if (_rootTitleFingerprint.has(key)) return _rootTitleFingerprint.get(key);
    const result = await fetchAnilistEpisodes(rootAnilistId, 1, "");
    const titles = (result.episodes || [])
      .slice(0, 6)
      .map((e) => String(e.title || "").trim())
      .filter(Boolean);
    _rootTitleFingerprint.set(key, titles);
    return titles;
  }

  function episodesMatchRootTitles(episodes, rootTitles) {
    if (!rootTitles?.length || !episodes?.length) return false;
    const n = Math.min(5, episodes.length, rootTitles.length);
    let hits = 0;
    for (let i = 0; i < n; i++) {
      const epTitle = String(episodes[i]?.title || "").trim();
      if (epTitle && epTitle === rootTitles[i]) hits++;
    }
    return hits >= 3;
  }

  function episodesLackEnglishTitles(episodes, locale) {
    if (locale === "ar" || !episodes?.length) return false;
    const sample = episodes.slice(0, Math.min(8, episodes.length));
    const latin = sample.filter((ep) => isLatinDominant(ep.title)).length;
    return latin < Math.ceil(sample.length * 0.4);
  }

  function episodesLackAiredDates(episodes) {
    if (!episodes?.length) return false;
    const sample = episodes.slice(0, Math.min(8, episodes.length));
    const withDate = sample.filter((ep) => String(ep.airDate || "").trim()).length;
    return withDate < Math.ceil(sample.length * 0.35);
  }

  function episodesLackOverviews(episodes) {
    if (!episodes?.length) return false;
    const sample = episodes.slice(0, Math.min(8, episodes.length));
    const withOverview = sample.filter((ep) =>
      String(ep.overview || "").trim()
    ).length;
    return withOverview < Math.ceil(sample.length * 0.35);
  }

  function seasonsNeedChainRepair(seasons, rootAnilistId) {
    if (!Array.isArray(seasons) || seasons.length < 2) return false;
    const root = Number(rootAnilistId);
    return seasons.some((s) => {
      const sn = Number(s.seasonNumber);
      const aid = Number(s.anilistId);
      if (!Number.isFinite(sn) || sn <= 1) return false;
      return !Number.isFinite(aid) || (Number.isFinite(root) && aid === root);
    });
  }

  async function getAnilistSeasonChainIds(rootAnilistId) {
    const root = Number(rootAnilistId);
    if (!Number.isFinite(root)) return [];
    const memKey = String(root);
    if (_anilistSeasonChainIds.has(memKey)) {
      return _anilistSeasonChainIds.get(memKey);
    }
    const media = await fetchAnilistSeasonNode(root);
    if (!media) return [];
    const chain = await collectAnilistSeasonChain(media);
    const ids = chain.map((n) => Number(n.id)).filter(Number.isFinite);
    _anilistSeasonChainIds.set(memKey, ids);
    return ids;
  }

  function resolveSeasonAnilistIdSync(seasonSummary, resolution, seasonNumber) {
    const sn = Number(seasonNumber);
    const root = Number(resolution?.anilistId);
    if (seasonSummary?.anilistId) {
      const id = Number(seasonSummary.anilistId);
      if (
        Number.isFinite(sn) &&
        sn > 1 &&
        Number.isFinite(root) &&
        id === root
      ) {
        return null;
      }
      return id;
    }
    if (Number.isFinite(sn) && sn > 1) return null;
    return resolution?.anilistId ? Number(resolution.anilistId) : null;
  }

  async function resolveSeasonAnilistId(seasonSummary, resolution, seasonNumber) {
    const direct = resolveSeasonAnilistIdSync(
      seasonSummary,
      resolution,
      seasonNumber
    );
    if (direct) return direct;

    const root = Number(resolution?.anilistId);
    const sn = Number(seasonNumber);
    if (!Number.isFinite(root) || !Number.isFinite(sn) || sn < 1) return null;

    const ids = await getAnilistSeasonChainIds(root);
    return ids[sn - 1] || null;
  }

  function repairSeasonSummaryAnilistId(seasonSummary, seasonAnilistId) {
    const id = Number(seasonAnilistId);
    if (!seasonSummary || !Number.isFinite(id)) return;
    if (Number(seasonSummary.anilistId) !== id) {
      seasonSummary.anilistId = id;
    }
  }

  async function fetchSeasonEpisodes(
    resolution,
    seasonNumber,
    locale,
    fallbackPoster = "",
    seasonSummary = null,
    item = null,
    options = null
  ) {
    const onPartial = options?.onPartial;
    if (resolution?.isNegative) return { state: ResultState.INVALID_ID };
    const effectivePoster = seasonSummary?.poster || fallbackPoster;

    let seasonAnilistId = pickSeasonAnilistId(
      seasonSummary,
      resolution,
      seasonNumber
    );
    if (!seasonAnilistId && Number(seasonNumber) > 1 && resolution?.anilistId) {
      seasonAnilistId = await resolveSeasonAnilistId(
        seasonSummary,
        resolution,
        seasonNumber
      );
      repairSeasonSummaryAnilistId(seasonSummary, seasonAnilistId);
    }

    const emitPartial = (partial) => {
      if (typeof onPartial !== "function") return;
      const epCount = partial?.episodes?.length || 0;
      if (epCount <= 0) return;
      if (
        partial?.state === ResultState.OFFLINE_NO_CACHE ||
        partial?.state === ResultState.UNAVAILABLE
      ) {
        return;
      }
      try {
        onPartial(normalizeEpisodesToAppSeason({ ...partial }, seasonNumber));
      } catch (err) {
        console.warn("[series-metadata] onPartial failed:", err?.message || err);
      }
    };

    const enrichRatingsAndFiller = async (baseResult, seasonImdb) => {
      if (item?.contentType === "anime") {
        const [rated, filler] = await Promise.all([
          enrichEpisodeRatings(
            baseResult,
            resolution,
            seasonNumber,
            locale,
            effectivePoster,
            item,
            seasonSummary,
            seasonImdb
          ),
          enrichAniFillerEpisodes(baseResult, seasonAnilistId, item),
        ]);
        const fillerByNum = new Map(
          (filler?.episodes || []).map((ep) => [ep.episodeNumber, ep])
        );
        return {
          ...rated,
          episodes: (rated.episodes || []).map((ep) => {
            const f = fillerByNum.get(ep.episodeNumber);
            if (!f?.fillerKind) return ep;
            return { ...ep, fillerKind: f.fillerKind };
          }),
          fillerUiAvailable: filler.fillerUiAvailable,
          fillerHideAvailable: filler.fillerHideAvailable,
        };
      }
      return enrichEpisodeRatings(
        baseResult,
        resolution,
        seasonNumber,
        locale,
        effectivePoster,
        item,
        seasonSummary,
        seasonImdb
      );
    };

    let anilistEpisodesAttempted = false;
    if (seasonAnilistId) {
      anilistEpisodesAttempted = true;
      try {
        // Resolve IMDb in parallel — do not block the first episode paint on it.
        const seasonImdbPromise = resolveSeasonImdbForCour(
          seasonAnilistId,
          resolution,
          item,
          seasonSummary,
          seasonNumber
        );
        const anilistRaw = await fetchAnilistEpisodes(
          seasonAnilistId,
          seasonNumber,
          effectivePoster
        );
        let result = normalizeEpisodesToAppSeason(anilistRaw, seasonNumber);
        emitPartial(result);

        const seasonImdb = await seasonImdbPromise;

        const enrichJob = (async () => {
          let enriched = result;
          if (item?.contentType === "anime" || resolution?.anilistId) {
            enriched = await enrichAnilistEpisodesWithTvdb(
              enriched,
              resolution,
              seasonNumber,
              locale,
              effectivePoster,
              item,
              seasonSummary,
              seasonAnilistId,
              seasonImdb
            );
            enriched = normalizeEpisodesToAppSeason(enriched, seasonNumber);
            emitPartial(enriched);
          }
          const epCount = enriched?.episodes?.length || 0;
          if (
            epCount > 0 &&
            enriched?.state !== ResultState.OFFLINE_NO_CACHE &&
            enriched?.state !== ResultState.UNAVAILABLE
          ) {
            return enrichRatingsAndFiller(enriched, seasonImdb);
          }
          return enriched;
        })();

        const enriched = await Promise.race([
          enrichJob,
          new Promise((resolve) => setTimeout(() => resolve(null), EPISODE_ENRICH_TIMEOUT_MS)),
        ]);
        if (enriched) return enriched;
        if (result?.episodes?.length) return result;
      } catch (err) {
        console.warn(
          "[series-metadata] AniList episodes failed:",
          err?.message || err
        );
      }
    } else if (resolution?.anilistId && Number(seasonNumber) > 1) {
      console.warn(
        "[series-metadata] season",
        seasonNumber,
        "has no anilistId — trying TVDB"
      );
    }

    // ── TheTVDB — episode titles/stills (live-action + anime fallback) ───
    if (window.WatchlistTvdb) {
      try {
        const tvdbId = await resolveTvdbId(resolution);
        if (tvdbId) {
          const tvdbResult = await fetchTvdbSeasonEpisodes(
            tvdbId, seasonNumber, locale, effectivePoster
          );
          const epCount = (tvdbResult?.episodes || []).length;
          if (
            (tvdbResult?.state === ResultState.AVAILABLE ||
              tvdbResult?.state === ResultState.OFFLINE_WITH_CACHE) &&
            epCount > 0
          ) {
            const episodes = await preferTmdbEpisodeOverviews(
              tvdbResult.episodes,
              resolution,
              seasonNumber,
              locale,
              effectivePoster
            );
            return await enrichEpisodeRatings(
              { ...tvdbResult, episodes },
              resolution,
              seasonNumber,
              locale,
              effectivePoster,
              item,
              seasonSummary
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
        if (anilistEpisodesAttempted) {
          return { state: ResultState.UNAVAILABLE };
        }
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

  async function searchOmdbImdbByTitle(title, year = null) {
    const apiKey = getOmdbKey();
    const q = String(title || "").trim();
    if (!apiKey || q.length < 2) return null;

    const cacheKey = `metadata:v9:resolve:imdb:omdbsearch:${q.toLowerCase()}:${year || ""}`;
    const cached = readCached(cacheKey, TTL_RESOLVE);
    if (cached?.imdbId) return cached.imdbId;

    try {
      const url = new URL("https://www.omdbapi.com/");
      url.searchParams.set("s", q);
      url.searchParams.set("type", "series");
      url.searchParams.set("apikey", apiKey);

      const response = await fetch(url.toString());
      if (!response.ok) return null;
      const json = await response.json();
      if (json.Response !== "True") return null;

      const qLower = q.toLowerCase();
      const wantYear = year != null ? Number(year) : null;
      let best = null;
      let bestScore = -1;

      for (const hit of json.Search || []) {
        const imdbId = String(hit.imdbID || "").toLowerCase();
        if (!/^tt\d{7,10}$/.test(imdbId)) continue;

        const hitTitle = String(hit.Title || "").trim();
        const hitLower = hitTitle.toLowerCase();
        let score = 0;

        const qHasShippuden = /shippu?u?den/i.test(qLower);
        const hitHasShippuden = /shippu?u?den/i.test(hitLower);
        if (qHasShippuden && !hitHasShippuden) continue;
        if (!qHasShippuden && hitHasShippuden && qLower === "naruto") continue;

        if (hitLower === qLower) score += 100;
        else if (hitLower.startsWith(qLower) || qLower.startsWith(hitLower)) score += 40;
        else if (hitLower.includes(qLower) || qLower.includes(hitLower)) score += 15;

        if (wantYear != null && Number.isFinite(wantYear)) {
          const yearText = String(hit.Year || "");
          const startYear = parseInt(yearText.split(/[–\-]/)[0], 10);
          if (Number.isFinite(startYear) && Math.abs(startYear - wantYear) <= 1) {
            score += 50;
          } else if (yearText.includes(String(wantYear))) {
            score += 30;
          }
        }

        if (String(hit.Type || "").toLowerCase() === "series") score += 5;

        if (score > bestScore) {
          bestScore = score;
          best = imdbId;
        }
      }

      if (best && bestScore >= 15) {
        writeSeriesCacheEntry(cacheKey, { imdbId: best }, TTL_RESOLVE);
        return best;
      }
    } catch {
      /* OMDb search unavailable */
    }
    return null;
  }

  async function walkAnilistTvPrequelRoot(anilistId, maxHops = 12) {
    let currentId = Number(anilistId);
    if (!Number.isFinite(currentId)) return null;

    const seen = new Set();
    let rootMedia = null;

    for (let hop = 0; hop < maxHops; hop++) {
      if (seen.has(currentId)) break;
      seen.add(currentId);

      const data = await anilistQuery(
        `query ($id: Int) {
          Media(id: $id, type: ANIME) {
            id
            title { english romaji native }
            startDate { year month day }
            relations {
              edges {
                relationType
                node { id type format startDate { year month day } }
              }
            }
          }
        }`,
        { id: currentId }
      );
      const media = data?.Media;
      if (!media) break;
      rootMedia = media;

      const prequels = (media.relations?.edges || [])
        .filter((edge) => {
          if (String(edge?.relationType || "").toUpperCase() !== "PREQUEL") return false;
          const node = edge?.node;
          if (!node || node.type !== "ANIME") return false;
          const format = anilistSeasonFormat(node.format);
          return format === "TV" || format === "TV_SHORT" || format === "ONA";
        })
        .map((edge) => edge.node)
        .sort(
          (a, b) => anilistStartSortKey(a.startDate) - anilistStartSortKey(b.startDate)
        );

      if (!prequels.length) break;
      currentId = Number(prequels[0].id);
      if (!Number.isFinite(currentId)) break;
    }

    return rootMedia;
  }

  async function resolveSeasonImdbForCour(
    seasonAnilistId,
    resolution,
    item,
    seasonSummary,
    seasonNumber = null
  ) {
    const courId = Number(seasonAnilistId);
    if (!Number.isFinite(courId)) return null;

    const cacheKey = `metadata:v11:resolve:imdb:anilist:${courId}`;
    const cached = readCached(cacheKey, TTL_RESOLVE);
    if (cached?.imdbId) return cached.imdbId;

    const seasonMedia = buildSeasonMediaResolution(
      courId,
      resolution,
      resolution?.anilistId
    );
    const hintBlock = {
      title: seasonSummary?.name,
      year: seasonSummary?.airDate
        ? parseInt(String(seasonSummary.airDate).slice(0, 4), 10)
        : null,
      seasonScoped: !seasonMedia.isRootCour,
    };

    let imdb = await resolveLinkedImdbId(seasonMedia, item, hintBlock);
    if (!imdb && hintBlock.title) {
      imdb = await searchOmdbImdbByTitle(hintBlock.title, hintBlock.year);
    }

    // Franchise shows (OPM S2/S3): one IMDb/TVDB id, multiple TVDB seasons.
    // Skip for long-runners (Shippuden) which have their own IMDb/TVDB series.
    const appSn = Number(seasonNumber);
    const epCount = parsePositiveCount(seasonSummary?.episodeCount);
    const shortCour =
      epCount != null && epCount > 0 && epCount <= 36;
    if (
      !imdb &&
      !seasonMedia.isRootCour &&
      resolution?.imdbId &&
      shortCour &&
      Number.isFinite(appSn) &&
      appSn > 1
    ) {
      const franchiseImdb = resolution.imdbId;
      const franchiseTvdb = await resolveTvdbId({ imdbId: franchiseImdb });
      if (franchiseTvdb) {
        const probe = await fetchTvdbSeasonEpisodes(
          franchiseTvdb,
          appSn,
          "en",
          ""
        );
        if ((probe?.episodes?.length || 0) > 0) {
          imdb = franchiseImdb;
        }
      }
    }

    if (imdb) {
      writeSeriesCacheEntry(cacheKey, { imdbId: imdb }, TTL_RESOLVE);
    }
    return imdb || null;
  }

  async function resolveLinkedImdbId(resolution, item = null, hints = {}) {
    const seasonScoped = Boolean(hints.seasonScoped);
    const anilistId = resolution?.anilistId;

    if (resolution?.imdbId) return resolution.imdbId;

    // Sequel cours: resolve IMDb from *this* AniList media before the saved item link.
    if (seasonScoped && anilistId) {
      const fromCour = await resolveImdbFromAnilistMedia(Number(anilistId), hints, {
        allowFranchiseFallback: false,
      });
      if (fromCour) return fromCour;
    }

    const WM = window.WatchlistMetadata;
    const fromLink = WM?.extractImdbId?.(item?.link);
    if (fromLink) return fromLink;

    if (!anilistId) return null;

    return resolveImdbFromAnilistMedia(Number(anilistId), hints, {
      allowFranchiseFallback: !seasonScoped,
    });
  }

  async function resolveImdbFromAnilistMedia(anilistId, hints = {}, opts = {}) {
    const allowFranchiseFallback = opts.allowFranchiseFallback !== false;
    const WM = window.WatchlistMetadata;
    const cacheKey = `metadata:v11:resolve:imdb:anilist:${anilistId}`;
    const cached = readCached(cacheKey, TTL_RESOLVE);
    if (cached?.imdbId) return cached.imdbId;

    const titleHint = String(hints.title || "").trim();
    const yearHint = hints.year ?? null;
    if (titleHint.length >= 2) {
      const fromOmdbHint = await searchOmdbImdbByTitle(titleHint, yearHint);
      if (fromOmdbHint) {
        writeSeriesCacheEntry(cacheKey, { imdbId: fromOmdbHint }, TTL_RESOLVE);
        return fromOmdbHint;
      }
    }

    if (isAnilistRateLimited()) return null;

    try {
      const data = await anilistQuery(
        `query ($id: Int) {
          Media(id: $id, type: ANIME) {
            title { english romaji native }
            startDate { year }
            externalLinks { site url }
          }
        }`,
        { id: Number(anilistId) }
      );
      const media = data?.Media;
      if (!media) return null;

      for (const link of media.externalLinks || []) {
        const fromUrl = WM?.extractImdbId?.(link?.url);
        if (fromUrl) {
          writeSeriesCacheEntry(cacheKey, { imdbId: fromUrl }, TTL_RESOLVE);
          return fromUrl;
        }
      }

      const title =
        hints.title ||
        media.title?.english ||
        media.title?.romaji ||
        media.title?.native ||
        "";
      const year =
        hints.year ??
        media.startDate?.year ??
        null;

      const fromOmdb = await searchOmdbImdbByTitle(title, year);
      if (fromOmdb) {
        writeSeriesCacheEntry(cacheKey, { imdbId: fromOmdb }, TTL_RESOLVE);
        return fromOmdb;
      }

      if (!allowFranchiseFallback) return null;

      if (isAnilistRateLimited()) return null;

      const rootMedia = await walkAnilistTvPrequelRoot(Number(anilistId));
      if (rootMedia && Number(rootMedia.id) !== Number(anilistId)) {
        const rootTitle =
          rootMedia.title?.english ||
          rootMedia.title?.romaji ||
          rootMedia.title?.native ||
          "";
        const rootYear = rootMedia.startDate?.year ?? null;
        const franchiseImdb = await searchOmdbImdbByTitle(rootTitle, rootYear);
        if (franchiseImdb) {
          writeSeriesCacheEntry(cacheKey, { imdbId: franchiseImdb }, TTL_RESOLVE);
          return franchiseImdb;
        }
      }
    } catch {
      // no linked IMDb
    }
    return null;
  }

  function buildSeasonMediaResolution(seasonAnilistId, resolution, rootAnilistId) {
    const courId = Number(seasonAnilistId);
    const rootId = Number(rootAnilistId);
    const isRootCour =
      !Number.isFinite(courId) ||
      !Number.isFinite(rootId) ||
      courId === rootId;
    return {
      anilistId: Number.isFinite(courId) ? courId : rootId,
      imdbId: isRootCour ? resolution?.imdbId || null : null,
      isRootCour,
    };
  }

  function omdbSeasonForCour(appSeasonNumber, resolvedImdb, franchiseImdb) {
    const appSn = Number(appSeasonNumber);
    if (
      franchiseImdb &&
      resolvedImdb &&
      resolvedImdb !== franchiseImdb &&
      Number.isFinite(appSn) &&
      appSn > 1
    ) {
      return 1;
    }
    return appSn;
  }

  async function enrichEpisodesWithTmdbRatings(
    result,
    resolution,
    seasonNumber,
    locale,
    fallbackPoster = "",
    item = null,
    seasonSummary = null,
    preResolvedImdb = null
  ) {
    if (!result?.episodes?.length || !hasTmdbRatingsAccess()) return result;

    const needsRating = (result.episodes || []).some(episodeNeedsExternalRating);
    if (!needsRating) return result;

    let tmdbId = resolution?.tmdbId;
    if (!tmdbId) {
      const seasonAnilistId = pickSeasonAnilistId(
        seasonSummary,
        resolution,
        seasonNumber
      );
      const imdbId =
        preResolvedImdb ||
        (seasonAnilistId
          ? await resolveSeasonImdbForCour(
              seasonAnilistId,
              resolution,
              item,
              seasonSummary,
              seasonNumber
            )
          : null) ||
        (await resolveLinkedImdbId(resolution, item));
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
    item = null,
    seasonSummary = null,
    preResolvedImdb = null
  ) {
    // TMDB first — complete per-episode ratings. OMDb season bulk is often incomplete.
    let enriched = await enrichEpisodesWithTmdbRatings(
      result,
      resolution,
      seasonNumber,
      locale,
      fallbackPoster,
      item,
      seasonSummary,
      preResolvedImdb
    );
    enriched = await enrichEpisodesWithOmdbRatings(
      enriched,
      resolution,
      seasonNumber,
      item,
      seasonSummary,
      locale,
      preResolvedImdb
    );
    return enriched;
  }

  function tvdbEpisodeSeasonNumber(ep) {
    return Number(ep?.seasonNumber);
  }

  function filterTvdbEpisodesForSeason(raw, season) {
    const want = Number(season);
    if (!Array.isArray(raw) || !Number.isFinite(want)) return [];
    return raw
      .filter((e) => tvdbEpisodeSeasonNumber(e) === want)
      .map((e) => ({ ...e, still: normalizeArtworkUrl(e.still) }));
  }

  async function fetchTvdbEpisodesForSeasonDirect(tvdbId, season, locale) {
    const WTvdb = window.WatchlistTvdb;
    if (!WTvdb?.fetchEpisodes) return [];
    try {
      const raw = await WTvdb.fetchEpisodes(tvdbId, season, locale);
      if (!raw?.length) return [];
      // Edge already scoped this request to one season — trust it when the
      // season filter would otherwise drop every row (TVDB seasonNumber quirks).
      const filtered = filterTvdbEpisodesForSeason(raw, season);
      const eps = filtered.length ? filtered : raw;
      return eps.map((e) => ({
        ...e,
        still: normalizeArtworkUrl(e.still),
        seasonNumber: tvdbEpisodeSeasonNumber(e) || Number(season),
      }));
    } catch {
      return [];
    }
  }

  async function fetchTvdbAllEpisodesFlat(
    tvdbId,
    locale,
    fallbackPoster = "",
    expectedMin = 0
  ) {
    void fallbackPoster;
    const minWanted = Number(expectedMin) || 0;
    const memKey = `alleps:absolute:${tvdbId}:en`;
    const memCached = _memoryLargeEpisodes.get(memKey);
    if (memCached?.length) {
      const memOk =
        !minWanted || memCached.length >= Math.ceil(minWanted * 0.85);
      if (memOk) return memCached;
    }

    const cacheKey = `metadata:v10:alleps:absolute:${tvdbId}:en`;
    const cached = readCached(cacheKey, TTL_EPISODES);
    if (cached?.payload?.episodes) {
      const parsed = parseCachedEpisodesResult(cached, {
        isStale: isStale(cacheKey, TTL_EPISODES),
      });
      const cachedLen = parsed?.episodes?.length || 0;
      const cacheOk =
        cachedLen > 0 &&
        (!minWanted || cachedLen >= Math.ceil(minWanted * 0.85));
      if (cacheOk) return parsed.episodes;
    }

    let flat = await fetchTvdbAbsoluteEpisodesDirect(tvdbId, "en", minWanted);

    if (
      minWanted > 40 &&
      flat.length > 0 &&
      flat.length < Math.ceil(minWanted * 0.85) &&
      window.WatchlistTvdb?.fetchAllEpisodes
    ) {
      try {
        const raw = await window.WatchlistTvdb.fetchAllEpisodes(tvdbId, "en", {
          order: "absolute",
          expectedMin: 0,
        });
        if (raw?.length > flat.length) {
          flat = raw.map((e) => ({
            ...e,
            still: normalizeArtworkUrl(e.still),
          }));
        }
      } catch (err) {
        console.warn("[series-metadata] TVDB service retry failed:", err?.message || err);
      }
    } else if (!flat.length && window.WatchlistTvdb?.fetchAllEpisodes) {
      try {
        const raw = await window.WatchlistTvdb.fetchAllEpisodes(tvdbId, "en", {
          order: "absolute",
          expectedMin: 0,
        });
        if (raw?.length) {
          flat = raw.map((e) => ({
            ...e,
            still: normalizeArtworkUrl(e.still),
          }));
        }
      } catch (err) {
        console.warn("[series-metadata] TVDB service fallback failed:", err?.message || err);
      }
    }

    if (!flat.length) return [];

    flat = flat.slice().sort((a, b) => a.episodeNumber - b.episodeNumber);
    _memoryLargeEpisodes.set(memKey, flat);

    if (flat.length <= 80) {
      const result = { state: ResultState.AVAILABLE, episodes: flat };
      writeSeriesCacheEntry(
        cacheKey,
        { payload: episodesResultPayload(result), state: result.state },
        TTL_EPISODES
      );
    }
    return flat;
  }

  /** Grow an AniList stub list when TVDB absolute order has more episodes (e.g. One Piece). */
  function expandEpisodeListFromTvdbSkeleton(anilistEpisodes, tvdbEpisodes, seasonNumber) {
    const seasonNum = Number(seasonNumber) || 1;
    const priorByNum = new Map(
      (anilistEpisodes || []).map((ep) => [ep.episodeNumber, ep])
    );
    return (tvdbEpisodes || []).map((tvdbEp) => {
      const num = Number(tvdbEp.episodeNumber);
      const prior = priorByNum.get(num);
      return {
        source: prior?.source || "anilist",
        seasonNumber: seasonNum,
        episodeNumber: num,
        title:
          prior?.title ||
          tvdbEp.title ||
          (Number.isFinite(num) ? `Episode ${num}` : "Episode"),
        still: prior?.still || tvdbEp.still || "",
        overview: prior?.overview || "",
        runtimeMinutes: prior?.runtimeMinutes ?? tvdbEp.runtimeMinutes ?? null,
        airDate: prior?.airDate || tvdbEp.airDate || null,
        isAired: prior?.isAired ?? tvdbEp.isAired ?? true,
        progressKey: `${seasonNum}:${num}`,
      };
    });
  }

  async function resolveTvdbMegaEpisodeMin(tvdbId, locale, floor = 0) {
    const minFloor = Number(floor) || 0;
    if (!tvdbId || !window.WatchlistTvdb?.fetchEpisodeTotals) return minFloor;
    try {
      const totals = await window.WatchlistTvdb.fetchEpisodeTotals(tvdbId, locale);
      const total = parsePositiveCount(totals?.episodeTotal);
      if (total > minFloor) return total;
    } catch {
      // Totals are optional — absolute fetch still runs.
    }
    return minFloor;
  }

  /**
   * AniList often has episode totals but not per-episode art/titles (streaming list is partial).
   * Merge TVDB episode metadata into the AniList list when stubs dominate.
   */
  async function enrichAniFillerEpisodes(result, seasonAnilistId, item) {
    const AF = window.WatchlistAniFiller;
    if (!AF || !result?.episodes?.length || item?.contentType !== "anime") {
      return result;
    }

    await AF.ensureLoaded();
    const WM = window.WatchlistMetadata;
    const malId = WM?.extractMalId?.(item?.link) || item?.malId || null;
    const enriched = AF.enrichEpisodes(seasonAnilistId, malId, result.episodes);

    return {
      ...result,
      episodes: enriched.episodes,
      fillerUiAvailable: enriched.hasFillerUi,
      fillerHideAvailable: enriched.hasHideable,
    };
  }

  async function enrichAnilistEpisodesWithTvdb(
    result,
    resolution,
    seasonNumber,
    locale,
    fallbackPoster = "",
    item = null,
    seasonSummary = null,
    seasonAnilistIdHint = null,
    preResolvedImdb = null
  ) {
    if (!result?.episodes?.length || !hasTvdbBackend()) return result;

    const episodes = result.episodes;
    const longRunner = episodes.length > 40;
    const stubCount = episodes.filter((ep) => {
      const title = String(ep.title || "").trim();
      return !ep.still || /^Episode \d+$/i.test(title);
    }).length;

    const seasonAnilistId =
      Number(seasonAnilistIdHint) ||
      pickSeasonAnilistId(seasonSummary, resolution, seasonNumber);
    if (!seasonAnilistId) {
      console.warn("[series-metadata] TVDB enrich: no season anilistId");
      return result;
    }

    const rootAnilistId = resolution?.anilistId;
    const isSequelCour =
      rootAnilistId &&
      Number(seasonAnilistId) !== Number(rootAnilistId);

    let needsTvdbEnrich =
      longRunner || stubCount >= Math.ceil(episodes.length * 0.35);

    if (!needsTvdbEnrich && isSequelCour) {
      if (episodesHaveMisnumberedTitles(episodes)) {
        needsTvdbEnrich = true;
      } else if (rootAnilistId && !isAnilistRateLimited()) {
        const rootTitles = await getAnilistRootTitleFingerprint(rootAnilistId);
        if (episodesMatchRootTitles(episodes, rootTitles)) {
          needsTvdbEnrich = true;
        }
      }
    }

    if (
      !needsTvdbEnrich &&
      (episodesLackEnglishTitles(episodes, locale) ||
        episodesLackAiredDates(episodes) ||
        episodesLackOverviews(episodes))
    ) {
      needsTvdbEnrich = true;
    }

    if (!needsTvdbEnrich) return result;

    const linkedImdb =
      preResolvedImdb ||
      (await resolveSeasonImdbForCour(
        seasonAnilistId,
        resolution,
        item,
        seasonSummary,
        seasonNumber
      ));
    let tvdbId = linkedImdb
      ? await resolveTvdbId({ imdbId: linkedImdb })
      : null;
    if (!tvdbId) {
      console.warn(
        "[series-metadata] TVDB enrich: could not resolve tvdbId for anilist",
        seasonAnilistId,
        linkedImdb ? `(imdb ${linkedImdb})` : "(no imdb)"
      );
      return result;
    }

    writeSeriesCacheEntry(
      `metadata:v8:resolve:tvdb:anilist:${seasonAnilistId}`,
      { tvdbId },
      TTL_RESOLVE
    );

    let tvdbEpisodes = [];
    const tvdbSeasonNum = Number(seasonNumber) > 0 ? Number(seasonNumber) : 1;
    const tvdbLocale = locale === "ar" ? "ar" : "en";
    let tvdbExpectedMin = episodes.length;

    if (longRunner) {
      tvdbExpectedMin = await resolveTvdbMegaEpisodeMin(
        tvdbId,
        tvdbLocale,
        episodes.length
      );
    }

    if (longRunner) {
      tvdbEpisodes = await fetchTvdbAllEpisodesFlat(
        tvdbId,
        tvdbLocale,
        fallbackPoster,
        tvdbExpectedMin
      );
    } else {
      const tvdbResult = await fetchTvdbSeasonEpisodes(
        tvdbId,
        tvdbSeasonNum,
        tvdbLocale,
        fallbackPoster
      );
      tvdbEpisodes = tvdbResult?.episodes || [];
    }

    if (!tvdbEpisodes.length) {
      console.warn(
        "[series-metadata] TVDB enrich: no episodes for anilist",
        seasonAnilistId,
        "tvdb",
        tvdbId
      );
      return result;
    }

    let workingEpisodes = episodes;
    if (longRunner && tvdbEpisodes.length > workingEpisodes.length) {
      workingEpisodes = expandEpisodeListFromTvdbSkeleton(
        workingEpisodes,
        tvdbEpisodes,
        seasonNumber
      );
      console.info(
        "[series-metadata] TVDB mega-runner expand:",
        episodes.length,
        "→",
        workingEpisodes.length,
        "episodes (tvdb",
        tvdbId,
        ")"
      );
    }

    const expandedFromTvdb = workingEpisodes.length > episodes.length;
    if (
      longRunner &&
      !expandedFromTvdb &&
      workingEpisodes.length > 40 &&
      tvdbEpisodes.length < Math.ceil(workingEpisodes.length * 0.85)
    ) {
      console.warn(
        "[series-metadata] TVDB enrich: episode count mismatch for anilist",
        seasonAnilistId,
        "expected",
        workingEpisodes.length,
        "got",
        tvdbEpisodes.length,
        "tvdb",
        tvdbId,
        "imdb",
        linkedImdb
      );
      return result;
    }

    console.info(
      "[series-metadata] TVDB enrich:",
      tvdbEpisodes.length,
      "episodes for anilist",
      seasonAnilistId,
      "→ tvdb",
      tvdbId,
      longRunner ? "(absolute)" : `(season ${tvdbSeasonNum})`
    );

    tvdbEpisodes = tvdbEpisodes.slice(0, workingEpisodes.length);

    const tvdbByEpisodeNumber = new Map();
    for (const tvdbEp of tvdbEpisodes) {
      const num = Number(tvdbEp.episodeNumber);
      if (Number.isFinite(num) && num > 0) {
        tvdbByEpisodeNumber.set(num, tvdbEp);
      }
    }

    const merged = workingEpisodes.map((ep, idx) => {
      const tvdbEp =
        tvdbByEpisodeNumber.get(ep.episodeNumber) || tvdbEpisodes[idx];
      if (!tvdbEp) return ep;
      const title = mergeAnimeEpisodeTitle(
        ep.title,
        tvdbEp.title,
        ep.episodeNumber,
        locale,
        true
      );
      return {
        ...ep,
        title,
        still: tvdbEp.still || ep.still,
        overview: mergeAnimeEpisodeOverview(ep.overview, tvdbEp.overview, locale),
        airDate: tvdbEp.airDate || ep.airDate || null,
        runtimeMinutes: tvdbEp.runtimeMinutes ?? ep.runtimeMinutes ?? null,
        isAired: tvdbEp.isAired ?? ep.isAired,
      };
    });

    let finalEpisodes = merged;
    if (!longRunner) {
      finalEpisodes = await preferTmdbEpisodeOverviews(
        merged,
        { ...resolution, imdbId: linkedImdb || resolution?.imdbId },
        seasonNumber,
        locale,
        fallbackPoster
      );
    } else {
      finalEpisodes = merged.map((ep) => ({
        ...ep,
        overview: cleanEpisodeOverviewText(ep.overview),
      }));
    }

    return {
      ...result,
      episodes: finalEpisodes,
      state: ResultState.AVAILABLE,
    };
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
    item = null,
    seasonSummary = null,
    locale = "en",
    preResolvedImdb = null
  ) {
    if (!result?.episodes?.length) return result;

    let imdbId = preResolvedImdb;
    if (!imdbId) {
      const seasonAnilistId = pickSeasonAnilistId(
        seasonSummary,
        resolution,
        seasonNumber
      );
      imdbId = await resolveSeasonImdbForCour(
        seasonAnilistId,
        resolution,
        item,
        seasonSummary,
        seasonNumber
      );
    }
    if (!imdbId || !getOmdbKey()) return result;

    const omdbSeason = omdbSeasonForCour(
      seasonNumber,
      imdbId,
      resolution?.imdbId
    );
    const omdb = await fetchOmdbSeasonEpisodes(imdbId, omdbSeason);
    if (
      !omdb ||
      (omdb.state !== ResultState.AVAILABLE && omdb.state !== ResultState.OFFLINE_WITH_CACHE)
    ) {
      return result;
    }

    const byEpisode = new Map();
    for (const ep of omdb.episodes || []) {
      const num = Number(ep?.episodeNumber);
      if (!Number.isFinite(num)) continue;
      byEpisode.set(num, ep);
    }

    if (!byEpisode.size) return result;

    return {
      ...result,
      episodes: (result.episodes || []).map((ep) => {
        const num = Number(ep?.episodeNumber);
        const omdbEp = byEpisode.get(num);
        if (!omdbEp) return ep;

        let next = { ...ep };

        if (episodeNeedsExternalRating(ep)) {
          const omdbRating = Number(omdbEp.episodeRating);
          if (Number.isFinite(omdbRating) && omdbRating > 0 && omdbRating <= 10) {
            next.episodeRating = Math.round(omdbRating * 10) / 10;
            next.episodeRatingSource = "imdb";
          }
        }

        if (!next.airDate && omdbEp.airDate) {
          next.airDate = omdbEp.airDate;
          next.isAired = omdbEp.isAired ?? isAired(omdbEp.airDate);
        }

        if (
          locale !== "ar" &&
          omdbEp.title &&
          isLatinDominant(omdbEp.title) &&
          (!next.title || !isLatinDominant(next.title) || isGenericEpisodeTitle(next.title, num))
        ) {
          const cleaned = cleanEpisodeDisplayTitle(omdbEp.title, num);
          if (cleaned) next.title = cleaned;
        }

        return next;
      }),
    };
  }

  async function fetchTmdbSeasonEpisodes(tmdbId, season, locale, fallbackPoster = "") {
    const lang = tmdbLanguage(locale);
    // v7: merges localized episode text with English fallbacks per field
    const cacheKey = `metadata:v7:season:tmdb:${tmdbId}:${season}:${locale}`;
    const cached = readCached(cacheKey, TTL_EPISODES);
    if (cached?.payload) {
      return parseCachedEpisodesResult(cached, { isStale: isStale(cacheKey, TTL_EPISODES) });
    }

    const json = await fetchTmdb(`tv/${tmdbId}/season/${season}`, { language: lang });
    if (json) {
      let result = normalizeTmdbSeasonEpisodes(json, tmdbId, season, fallbackPoster);
      if (locale !== "en") {
        const enJson = await fetchTmdb(`tv/${tmdbId}/season/${season}`, { language: "en-US" });
        if (enJson) {
          const enResult = normalizeTmdbSeasonEpisodes(enJson, tmdbId, season, fallbackPoster);
          result = mergeEpisodeLocaleResults(result, enResult);
        }
      }
      writeSeriesCacheEntry(cacheKey, { payload: episodesResultPayload(result), state: result.state }, TTL_EPISODES);
      return result;
    }

    if (locale !== "en") {
      const enKey = `metadata:v7:season:tmdb:${tmdbId}:${season}:en`;
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
    return failWithoutCache(`TMDb season ${season} failed`);
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
      seasonOverview: cleanEpisodeOverviewText(json.overview || ""),
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
      overview: cleanEpisodeOverviewText(json.overview || ""),
      runtimeMinutes: json.runtime || null,
      airDate,
      isAired: isAired(airDate),
      progressKey: `${json.season_number ?? 0}:${json.episode_number}`,
      episodeRating,
      episodeRatingSource: episodeRating != null ? "tmdb" : null,
    };
  }

  // ─── AniList series ───────────────────────────────────────────

  const ANILIST_SEQUEL_TYPES = new Set(["SEQUEL"]);
  const ANILIST_SEASON_FORMAT_PRIORITY = {
    TV: 0,
    TV_SHORT: 1,
    ONA: 2,
    OVA: 3,
  };
  const ANILIST_SEASON_NODE_FIELDS = `
    id
    type
    format
    episodes
    title { english romaji native }
    coverImage { large }
    description(asHtml: false)
    startDate { year month day }
  `;

  function anilistSeasonFormat(format) {
    return String(format || "").toUpperCase();
  }

  function anilistSeasonFormatPriority(format) {
    const key = anilistSeasonFormat(format);
    return Object.prototype.hasOwnProperty.call(ANILIST_SEASON_FORMAT_PRIORITY, key)
      ? ANILIST_SEASON_FORMAT_PRIORITY[key]
      : 50;
  }

  function isAnilistSeasonRelation(edge) {
    if (!edge?.node || edge.node.type !== "ANIME") return false;
    if (!ANILIST_SEQUEL_TYPES.has(String(edge.relationType || "").toUpperCase())) {
      return false;
    }
    const format = anilistSeasonFormat(edge.node.format);
    if (format === "MOVIE" || format === "MUSIC" || format === "SPECIAL") return false;
    return true;
  }

  function pickBestAnilistSequel(edges) {
    const candidates = (edges || [])
      .filter(isAnilistSeasonRelation)
      .map((edge) => edge.node)
      .filter(Boolean)
      .sort((a, b) => {
        const formatCmp =
          anilistSeasonFormatPriority(a.format) -
          anilistSeasonFormatPriority(b.format);
        if (formatCmp !== 0) return formatCmp;
        return anilistStartSortKey(a.startDate) - anilistStartSortKey(b.startDate);
      });
    return candidates[0] || null;
  }

  async function fetchAnilistSeasonNode(anilistId) {
    const data = await anilistQuery(
      `query ($id: Int) {
        Media(id: $id, type: ANIME) {
          ${ANILIST_SEASON_NODE_FIELDS}
          relations {
            edges {
              relationType
              node { ${ANILIST_SEASON_NODE_FIELDS} }
            }
          }
        }
      }`,
      { id: anilistId }
    );
    return data?.Media || null;
  }

  /**
   * AniList lists later cours as SEQUEL-of-SEQUEL (e.g. Demon Slayer → Mugen Train →
   * Entertainment District). Walk the main TV sequel chain instead of only direct sequels.
   */
  async function collectAnilistSeasonChain(rootMedia, maxSeasons = 30) {
    const chain = [];
    const seen = new Set();
    let current = rootMedia;

    while (current && chain.length < maxSeasons) {
      const currentId = Number(current.id);
      if (!Number.isFinite(currentId) || seen.has(currentId)) break;
      seen.add(currentId);
      chain.push(current);

      const nextStub = pickBestAnilistSequel(current.relations?.edges);
      if (!nextStub?.id || seen.has(Number(nextStub.id))) break;

      const expanded = await fetchAnilistSeasonNode(Number(nextStub.id));
      if (!expanded) break;

      const nextEpisodeCount = parsePositiveCount(expanded.episodes);
      if (nextEpisodeCount == null || nextEpisodeCount <= 0) break;

      current = expanded;
    }

    return chain;
  }

  function anilistStartSortKey(date) {
    if (!date) return 0;
    const y = Number(date.year) || 0;
    const m = Number(date.month) || 0;
    const d = Number(date.day) || 0;
    return y * 10000 + m * 100 + d;
  }

  function buildAnilistSeasonSummary(node, seasonNumber, fallbackPoster = "") {
    const title =
      node.title?.english || node.title?.romaji || node.title?.native || "";
    const poster = node.coverImage?.large || fallbackPoster || "";
    const episodeCount = parsePositiveCount(node.episodes);
    return {
      source: "anilist",
      anilistId: node.id,
      seasonNumber,
      name: title || `Season ${seasonNumber}`,
      poster,
      episodeCount,
      overview: stripHtml(node.description || ""),
      airDate: anilistDateStr(node.startDate),
      isSpecials: false,
      isSynthetic: true,
    };
  }

  /**
   * Movies linked to the franchise (AniList relations, format MOVIE only).
   */
  function collectAnilistRelatedMoviesFromSources(sources, chainIds) {
    const seen = new Set();
    const movies = [];

    for (const media of sources || []) {
      for (const edge of media.relations?.edges || []) {
        const node = edge?.node;
        if (!node || node.type !== "ANIME") continue;
        const id = Number(node.id);
        if (!Number.isFinite(id) || chainIds.has(id) || seen.has(id)) continue;
        if (anilistSeasonFormat(node.format) !== "MOVIE") continue;
        if (String(edge.relationType || "").toUpperCase() === "CHARACTER") continue;
        seen.add(id);
        movies.push({ node, relationType: String(edge.relationType || "").toUpperCase() });
      }
    }

    movies.sort(
      (a, b) =>
        anilistStartSortKey(a.node.startDate) - anilistStartSortKey(b.node.startDate)
    );
    return movies;
  }

  function normalizeAnilistRelatedMovie(node) {
    const title =
      node.title?.english || node.title?.romaji || node.title?.native || "";
    const duration = parsePositiveCount(node.duration);
    return {
      source: "anilist",
      anilistId: Number(node.id),
      title,
      poster: node.coverImage?.large || "",
      year: node.startDate?.year ? String(node.startDate.year) : "",
      overview: stripHtml(node.description || ""),
      runtimeMinutes: duration,
      score: node.averageScore != null ? Number(node.averageScore) : null,
      pick: { anilistId: Number(node.id), source: "anilist" },
    };
  }

  async function fetchAnilistRelatedMovies(anilistId, locale) {
    const cacheKey = `metadata:v2:related:movies:anilist:${anilistId}:${locale}`;
    const cached = readCached(cacheKey, TTL_SERIES);
    if (cached?.movies) {
      return {
        state: cached.movies.length ? ResultState.AVAILABLE : ResultState.NO_SEASONS,
        movies: cached.movies,
        isStale: isStale(cacheKey, TTL_SERIES),
      };
    }

    const data = await anilistQuery(
      `query ($id: Int) {
        Media(id: $id, type: ANIME) {
          id
          format
          ${ANILIST_SEASON_NODE_FIELDS}
          relations {
            edges {
              relationType
              node { ${ANILIST_SEASON_NODE_FIELDS} }
            }
          }
        }
      }`,
      { id: anilistId }
    );

    const media = data?.Media;
    if (!media) {
      const stale = readCacheStale(cacheKey);
      if (stale?.movies) {
        return {
          state: ResultState.OFFLINE_WITH_CACHE,
          movies: stale.movies,
          isStale: true,
        };
      }
      return { state: ResultState.OFFLINE_NO_CACHE, movies: [] };
    }

    const seasonChain = await collectAnilistSeasonChain(media);
    const chainIds = new Set(
      seasonChain.map((n) => Number(n.id)).filter(Number.isFinite)
    );
    const sources = [media];
    for (const node of seasonChain) {
      const id = Number(node.id);
      if (id !== Number(media.id)) {
        const expanded = await fetchAnilistSeasonNode(id);
        if (expanded) sources.push(expanded);
      }
    }

    const related = collectAnilistRelatedMoviesFromSources(sources, chainIds);
    const movies = related.map((entry) => normalizeAnilistRelatedMovie(entry.node));

    writeSeriesCacheEntry(cacheKey, { movies }, TTL_SERIES);
    return {
      state: movies.length ? ResultState.AVAILABLE : ResultState.NO_SEASONS,
      movies,
    };
  }

  const TV_SPECIAL_NON_MOVIE_TITLE =
    /\b(story\s+so\s+far|recap|making\s+of|behind\s+the\s+scenes|featurette|trailer|preview|deleted\s+scenes?|clip\s+show|retrospective|look\s+back|highlights?)\b/i;

  /** Recaps, making-ofs, etc. — stay in Specials only, not the Movies tab. */
  function isTvSpecialNonMovie(episode) {
    const title = String(episode?.title || "").trim();
    if (!title) return false;
    if (TV_SPECIAL_NON_MOVIE_TITLE.test(title)) return true;
    if (/^the\s+making\b/i.test(title)) return true;
    return false;
  }

  /**
   * TV feature films in season 0: TVDB isMovie/linkedMovie when present,
   * else long runtime (80+ min) excluding obvious non-movie specials.
   */
  function isMovieLikeTvSpecial(episode) {
    if (episode?.isMovie === true || episode?.isMovie === 1) return true;
    const linked = Number(episode?.linkedMovieId);
    if (Number.isFinite(linked) && linked > 0) return true;
    if (isTvSpecialNonMovie(episode)) return false;
    const runtime = Number(episode?.runtimeMinutes);
    return Number.isFinite(runtime) && runtime >= 80;
  }

  function normalizeTvdbRelatedMovie(episode) {
    const title = String(episode?.title || "").trim();
    const year = episode?.airDate ? String(episode.airDate).slice(0, 4) : "";
    return {
      source: "tvdb",
      title,
      poster: episode?.still || "",
      year,
      overview: cleanEpisodeOverviewText(episode?.overview || ""),
      runtimeMinutes: episode?.runtimeMinutes ?? null,
      pick: {
        source: "tvdb",
        title,
        year,
        tvdbId: episode?.seriesTvdbId,
        seasonNumber: episode?.seasonNumber,
        episodeNumber: episode?.episodeNumber,
      },
    };
  }

  async function fetchTvdbRelatedMovies(tvdbId, locale) {
    const cacheKey = `metadata:v4:related:movies:tvdb:${tvdbId}:${locale}`;
    const cached = readCached(cacheKey, TTL_SERIES);
    if (cached?.movies) {
      return {
        state: cached.movies.length ? ResultState.AVAILABLE : ResultState.NO_SEASONS,
        movies: cached.movies,
        isStale: isStale(cacheKey, TTL_SERIES),
      };
    }

    const WTvdb = window.WatchlistTvdb;
    if (!WTvdb) return { state: ResultState.UNAVAILABLE, movies: [] };

    try {
      const episodes = await WTvdb.fetchEpisodes(tvdbId, 0, locale);
      const movies = (episodes || [])
        .filter(isMovieLikeTvSpecial)
        .map(normalizeTvdbRelatedMovie)
        .filter((m) => m.title);

      writeSeriesCacheEntry(cacheKey, { movies }, TTL_SERIES);
      return {
        state: movies.length ? ResultState.AVAILABLE : ResultState.NO_SEASONS,
        movies,
      };
    } catch {
      const stale = readCacheStale(cacheKey);
      if (stale?.movies) {
        return {
          state: ResultState.OFFLINE_WITH_CACHE,
          movies: stale.movies,
          isStale: true,
        };
      }
      return { state: ResultState.UNAVAILABLE, movies: [] };
    }
  }

  /**
   * Standalone movies related to a TV series or anime (not season-carousel entries).
   */
  async function fetchRelatedMovies(resolution, item, locale = "en") {
    if (!resolution || resolution.isNegative) {
      return { state: ResultState.INVALID_ID, movies: [] };
    }

    let anilistId = resolution.anilistId ? Number(resolution.anilistId) : null;
    if (!anilistId && item?.contentType === "anime") {
      const WM = window.WatchlistMetadata;
      anilistId = Number(WM?.extractAnilistId?.(item?.link)) || null;
      if (!anilistId) {
        const resolved = await resolveAnimeSeriesId(item);
        anilistId = resolved?.anilistId ? Number(resolved.anilistId) : null;
      }
    }

    if (anilistId) {
      return fetchAnilistRelatedMovies(anilistId, locale);
    }

    if (window.WatchlistTvdb) {
      const tvdbId = await resolveTvdbId(resolution);
      if (tvdbId) {
        return fetchTvdbRelatedMovies(tvdbId, locale);
      }
    }

    return { state: ResultState.NO_SEASONS, movies: [] };
  }

  function cachedSeriesFallback(cacheKey, preferFresh = null) {
    const fresh = preferFresh?.payload ? preferFresh : readCached(cacheKey, TTL_SERIES);
    if (fresh?.payload?.seasons?.length) {
      return parseCachedSeriesResult(fresh, {
        isStale: true,
        forceState: ResultState.OFFLINE_WITH_CACHE,
      });
    }
    const stale = readCacheStale(cacheKey);
    if (stale?.payload?.seasons?.length) {
      return parseCachedSeriesResult(stale, {
        isStale: true,
        forceState: ResultState.OFFLINE_WITH_CACHE,
      });
    }
    return null;
  }

  async function fetchAnilistSeriesMetadata(anilistId, locale, fallbackPoster = "") {
    const cacheKey = `metadata:v13:series:anilist:${anilistId}:${locale}`;
    const cached = readCached(cacheKey, TTL_SERIES);
    if (cached?.payload) {
      if (!seasonsNeedChainRepair(cached.payload.seasons, anilistId)) {
        return parseCachedSeriesResult(cached, { isStale: isStale(cacheKey, TTL_SERIES) });
      }
    }

    const data = await anilistQuery(
      `query ($id: Int) {
        Media(id: $id, type: ANIME) {
          id
          format
          title { english romaji native }
          episodes
          coverImage { large }
          description
          startDate { year month day }
          endDate { year month day }
          status
          streamingEpisodes { title thumbnail }
          relations {
            edges {
              relationType
              node {
                id
                type
                format
                episodes
                title { english romaji native }
                coverImage { large }
                description(asHtml: false)
                startDate { year month day }
              }
            }
          }
        }
      }`,
      { id: anilistId }
    );

    const media = data?.Media;
    if (!media) {
      const fallback = cachedSeriesFallback(cacheKey, cached);
      if (fallback) return fallback;
      return failWithoutCache("AniList series metadata failed");
    }

    const title =
      media.title?.english || media.title?.romaji || media.title?.native || "";
    const posterUrl = media.coverImage?.large || fallbackPoster || "";
    const streamingCount = (media.streamingEpisodes || []).length;

    let seasonChain;
    try {
      seasonChain = await Promise.race([
        collectAnilistSeasonChain(media),
        new Promise((_, reject) => {
          setTimeout(() => reject(new Error("anilist-chain-timeout")), ANILIST_CHAIN_TIMEOUT_MS);
        }),
      ]);
    } catch (err) {
      console.warn(
        "[series-metadata] AniList season chain failed:",
        err?.message || err
      );
      const fallback = cachedSeriesFallback(cacheKey, cached);
      if (fallback) return fallback;
      seasonChain = [media];
    }
    const seasons = seasonChain.map((node, idx) =>
      buildAnilistSeasonSummary(node, idx + 1, posterUrl)
    );

    const totalEpisodes = regularEpisodeTotalFromSeasons(seasons);
    const episodeCount = parsePositiveCount(media.episodes);

    const series = {
      source: "anilist",
      anilistId,
      title,
      totalEpisodes: totalEpisodes || episodeCount,
      totalSeasons: seasons.length,
      poster: posterUrl,
      overview: stripHtml(media.description || ""),
      status: media.status || null,
      firstAirDate: anilistDateStr(media.startDate),
      lastAirDate: anilistDateStr(media.endDate),
    };

    const hasEpDetails = streamingCount > 0 || episodeCount != null;
    const result = {
      state: hasEpDetails ? ResultState.AVAILABLE : ResultState.EPISODE_DETAILS_UNAVAILABLE,
      series,
      seasons,
    };

    writeSeriesCacheEntry(cacheKey, { payload: seriesResultPayload(result), state: result.state }, TTL_SERIES);
    return result;
  }

  // ─── AniList episodes ─────────────────────────────────────────

  function buildAnilistEpisodeList(episodeCount, streamingEps = [], appSeasonNumber = 1) {
    const seasonNum = Number(appSeasonNumber) || 1;
    const streaming = streamingEps || [];
    const rawEps = Array.from({ length: episodeCount }, (_, i) => {
      const stream = streaming[i];
      const epNum = i + 1;
      return {
        source: "anilist",
        seasonNumber: seasonNum,
        episodeNumber: epNum,
        title: stream?.title || `Episode ${epNum}`,
        still: stream?.thumbnail || "",
        overview: "",
        runtimeMinutes: null,
        airDate: null,
        isAired: true,
        progressKey: `${seasonNum}:${epNum}`,
      };
    });
    const nonEmpty = rawEps.filter((e) => e.still);
    const uniqueUrls = new Set(nonEmpty.map((e) => e.still));
    const allSame = nonEmpty.length >= 2 && uniqueUrls.size === 1;
    return allSame ? rawEps.map((e) => ({ ...e, still: "" })) : rawEps;
  }

  function normalizeEpisodesToAppSeason(result, appSeasonNumber) {
    if (!result?.episodes?.length) return result;
    const seasonNum = Number(appSeasonNumber);
    if (!Number.isFinite(seasonNum) || seasonNum < 0) return result;
    return {
      ...result,
      episodes: result.episodes.map((ep) => ({
        ...ep,
        seasonNumber: seasonNum,
        progressKey: `${seasonNum}:${ep.episodeNumber}`,
      })),
    };
  }

  async function fetchAnilistEpisodes(anilistId, seasonNumber, fallbackPoster = "") {
    const appSeasonNumber = Number(seasonNumber) || 1;
    void fallbackPoster;

    const cacheKey = `metadata:v14:episodes:anilist:${anilistId}:${appSeasonNumber}`;
    const cached = readCached(cacheKey, TTL_EPISODES);
    if (cached?.payload) {
      return parseCachedEpisodesResult(cached, {
        isStale: isStale(cacheKey, TTL_EPISODES),
      });
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
        return parseCachedEpisodesResult(stale, {
          isStale: true,
          forceState: ResultState.OFFLINE_WITH_CACHE,
        });
      }
      return failWithoutCache(`AniList episodes ${anilistId} failed`);
    }

    const episodeCount = parsePositiveCount(media.episodes);
    const streamingEps = media.streamingEpisodes || [];

    let episodes;
    let state;

    if (episodeCount != null && episodeCount > 0) {
      episodes = buildAnilistEpisodeList(episodeCount, streamingEps, appSeasonNumber);
      state =
        streamingEps.length > 0
          ? ResultState.PARTIALLY_AVAILABLE
          : ResultState.EPISODE_DETAILS_UNAVAILABLE;
    } else if (streamingEps.length > 0) {
      episodes = buildAnilistEpisodeList(streamingEps.length, streamingEps, appSeasonNumber);
      state = ResultState.PARTIALLY_AVAILABLE;
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
    if (key) {
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

    if (path.startsWith("tv/") && window.WatchlistTmdb?.fetchTv) {
      const match = path.match(/^tv\/(\d+)(?:\/season\/(\d+))?$/);
      if (match) {
        const tmdbId = Number(match[1]);
        const season = match[2] != null ? Number(match[2]) : null;
        const locale = String(params.language || "").startsWith("ar") ? "ar" : "en";
        return await window.WatchlistTmdb.fetchTv(tmdbId, { season, locale });
      }
    }

    return null;
  }

  async function anilistQuery(query, variables) {
    if (isAnilistRateLimited()) return null;

    const key = JSON.stringify({ query, variables });
    if (_anilistInflight.has(key)) {
      return _anilistInflight.get(key);
    }

    const run = (async () => {
      try {
        const res = await fetchWithTimeout(ANILIST_API, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ query, variables }),
        });
        if (res.status === 429) {
          markAnilistRateLimited();
          console.warn("[series-metadata] AniList rate limited — pausing requests");
          return null;
        }
        const json = await res.json().catch(() => null);
        if (!res.ok || (json?.errors && json.errors.length > 0)) return null;
        return json?.data ?? null;
      } catch (err) {
        if (err?.name === "AbortError") {
          console.warn("[series-metadata] AniList request timed out");
        }
        return null;
      } finally {
        _anilistInflight.delete(key);
      }
    })();

    _anilistInflight.set(key, run);
    return run;
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

  /** Drop TVDB metadata footnotes (special-episode lists, source tags, notes). */
  function episodeOverviewLooksBoilerplate(text) {
    const t = String(text || "").trim();
    if (!t) return true;
    if (/\bincludes?\s+(?:the\s+following\s+)?special\s+episodes?\b/i.test(t)) {
      return true;
    }
    if (/\(Source:\s*[^)]+\)/i.test(t)) return true;
    if (/\bnote\s*:\s*/i.test(t) && t.length < 280) return true;
    if (/^[-•*–]\s*.+\(Episode\s+\d+\)\s*$/im.test(t)) return true;
    return false;
  }

  function cleanEpisodeOverviewText(overview) {
    let text = stripHtml(overview).replace(/\r\n/g, "\n").trim();
    if (!text) return "";

    // One Piece-style footnote + everything after it (asterisk optional).
    text = text
      .replace(
        /\s*(?:\*+\s*)?(?:this\s+)?includes?\s+(?:the\s+following\s+)?special\s+episodes?\s*:?[\s\S]*$/i,
        ""
      )
      .trim();

    // Trailing crossover / special-episode bullet lists (newline or inline).
    text = text
      .replace(
        /(?:\n\s*[-•*–]\s*[^\n]*\(Episode\s+\d+\)\s*)+$/gi,
        ""
      )
      .trim();
    text = text
      .replace(
        /\s+[-–]\s+[^-\n]+?\(Episode\s+\d+\)(?:\s+[-–]\s+[^-\n]+?\(Episode\s+\d+\))*\s*$/gi,
        ""
      )
      .trim();

    // OPM-style source attribution and broadcast notes at the end.
    text = text
      .replace(/\s*\(Source:\s*[^)]+\)\s*$/gi, "")
      .trim();
    text = text
      .replace(/\s*note\s*:\s*[^\n]+(?:\n[^\n]+)*$/gi, "")
      .trim();

    const lines = text.split(/\n/).map((line) => line.trim()).filter(Boolean);
    if (
      lines.length > 0 &&
      lines.every(
        (line) =>
          /^[-•*–]\s*.+\(Episode\s+\d+\)\s*$/i.test(line) ||
          /^\(Source:/i.test(line) ||
          /^note\s*:/i.test(line) ||
          /^\*+\s*includes?\b/i.test(line)
      )
    ) {
      return "";
    }

    if (episodeOverviewLooksBoilerplate(text)) {
      return "";
    }

    return text.replace(/\n{3,}/g, "\n\n").trim();
  }

  function episodeOverviewNeedsTmdbFallback(overview) {
    const cleaned = cleanEpisodeOverviewText(overview);
    return !cleaned || episodeOverviewLooksBoilerplate(cleaned);
  }

  async function preferTmdbEpisodeOverviews(
    episodes,
    resolution,
    seasonNumber,
    locale,
    fallbackPoster = "",
    franchiseImdb = null
  ) {
    const cleanedEps = episodes.map((ep) => ({
      ...ep,
      overview: cleanEpisodeOverviewText(ep.overview),
    }));

    const needsFallback = cleanedEps.some((ep) =>
      episodeOverviewNeedsTmdbFallback(ep.overview)
    );
    if (!needsFallback) return cleanedEps;

    let tmdbId = resolution?.tmdbId;
    if (!tmdbId) {
      const imdbId =
        resolution?.imdbId ||
        (await resolveLinkedImdbId(resolution));
      if (imdbId) tmdbId = await resolveTmdbIdByImdb(imdbId);
    }
    if (!tmdbId) return cleanedEps;

    const tmdbSeason = Number(seasonNumber) > 0 ? Number(seasonNumber) : 1;
    const tmdbResult = await fetchTmdbSeasonEpisodes(
      tmdbId,
      tmdbSeason,
      locale,
      fallbackPoster
    );
    const tmdbByNum = new Map(
      (tmdbResult?.episodes || []).map((ep) => [ep.episodeNumber, ep])
    );
    if (!tmdbByNum.size) return cleanedEps;

    return cleanedEps.map((ep) => {
      if (!episodeOverviewNeedsTmdbFallback(ep.overview)) return ep;

      const tmdbEp = tmdbByNum.get(ep.episodeNumber);
      let tmdbOverview = cleanEpisodeOverviewText(tmdbEp?.overview);
      if (
        !tmdbOverview ||
        episodeOverviewLooksBoilerplate(tmdbOverview) ||
        (locale !== "ar" && !isLatinDominant(tmdbOverview))
      ) {
        return ep;
      }
      return { ...ep, overview: tmdbOverview };
    });
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
  const CACHE_EVICT_VERSION = "v28";
  (function evictObsoleteEpisodeCache() {
    try {
      const flagKey = `watchlist-series-cache-evict-${CACHE_EVICT_VERSION}`;
      if (localStorage.getItem(flagKey)) return;

      const cache = readSeriesCache();
      let changed = false;
      const dropPrefixes = [
        "metadata:v5:episodes:anilist:",
        "metadata:v8:series:anilist:",
        "metadata:v9:series:anilist:",
        "metadata:v10:series:anilist:",
        "metadata:v11:series:anilist:",
        "metadata:v12:series:anilist:",
        "metadata:v12:episodes:anilist:",
        "metadata:v13:episodes:anilist:",
        "metadata:v16:season:tvdb:",
        "metadata:v17:season:tvdb:",
        "metadata:v18:season:tvdb:",
        "metadata:v19:season:tvdb:",
        "metadata:v20:season:tvdb:",
        "metadata:v8:series:tvdb:",
        "metadata:v22:season:tvdb:",
        "metadata:v23:season:tvdb:",
        "metadata:v9:resolve:imdb:anilist:",
        "metadata:v11:resolve:imdb:anilist:",
        "metadata:v7:resolve:tvdb:anilist:",
      ];
      Object.keys(cache).forEach((k) => {
        if (dropPrefixes.some((p) => k.startsWith(p))) {
          delete cache[k];
          _memory.delete(k);
          changed = true;
          return;
        }
        if (k.includes(":alleps:") && !k.startsWith("metadata:v10:alleps:")) {
          delete cache[k];
          _memory.delete(k);
          changed = true;
        }
      });
      if (changed) localStorage.setItem(SERIES_CACHE_KEY, JSON.stringify(cache));
      _memoryLargeEpisodes.clear();
      _anilistSeasonChainIds.clear();
      _rootTitleFingerprint.clear();
      localStorage.setItem(flagKey, "1");
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
  async function resolveTvdbIdViaEdge(opts) {
    if (window.WatchlistTvdb?.resolveId) {
      try {
        const result = await window.WatchlistTvdb.resolveId(opts);
        if (result?.tvdbId) return Number(result.tvdbId);
      } catch { /* try direct */ }
    }
    const direct = await callTvdbMetadata({ action: "resolve", ...opts });
    return direct?.tvdbId ? Number(direct.tvdbId) : null;
  }

  async function resolveTvdbId(resolution) {
    if (!hasTvdbBackend()) return null;

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
        const tvdbId = await resolveTvdbIdViaEdge({ imdbId });
        if (tvdbId) {
          writeSeriesCacheEntry(cacheKey, { tvdbId }, TTL_RESOLVE);
          return tvdbId;
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
        const tvdbId = await resolveTvdbIdViaEdge({ tmdbId });
        if (tvdbId) {
          writeSeriesCacheEntry(cacheKey, { tvdbId }, TTL_RESOLVE);
          return tvdbId;
        }
      } catch { /* fall through */ }
      writeNegativeCache(negKey, TTL_NEGATIVE);
    }

    // ── Cached IMDb for this AniList media only (no live AniList call here) ─
    const anilistId = resolution?.anilistId;
    if (anilistId) {
      const cacheKey = `metadata:v8:resolve:tvdb:anilist:${anilistId}`;
      const cached = readCached(cacheKey, TTL_RESOLVE);
      if (cached?.tvdbId) return cached.tvdbId;

      const imdbCached = readCached(
        `metadata:v11:resolve:imdb:anilist:${anilistId}`,
        TTL_RESOLVE
      );
      if (imdbCached?.imdbId) {
        const tvdbId = await resolveTvdbId({ imdbId: imdbCached.imdbId });
        if (tvdbId) {
          writeSeriesCacheEntry(cacheKey, { tvdbId }, TTL_RESOLVE);
          return tvdbId;
        }
      }
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
    const cacheKey = `metadata:v11:series:tvdb:${tvdbId}:${locale}`;
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
        overview: cleanEpisodeOverviewText(s.overview || ""),
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

      const specialsSeason = seasons.find((s) => s.seasonNumber === 0);
      if (specialsSeason && specialsSeason.episodeCount == null) {
        try {
          const s0eps = await WTvdb.fetchEpisodes(tvdbId, 0, locale);
          const specialsOnly = (s0eps || []).filter((ep) => !isMovieLikeTvSpecial(ep));
          const aired = specialsOnly.filter((ep) => ep.isAired !== false).length;
          if (aired > 0) specialsSeason.episodeCount = aired;
        } catch {
          // Specials count unavailable — carousel may still load episodes on demand.
        }
      }

      const series = {
        source: "tvdb",
        tvdbId,
        imdbId: seriesData.imdbId || null,
        title: seriesData.title || "",
        overview: cleanEpisodeOverviewText(seriesData.overview || ""),
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
    // v22: English summaries via official lang episode list (not season=? untranslated rows)
    const cacheKey = `metadata:v24:season:tvdb:${tvdbId}:${season}:${locale}`;
    const cached = readCached(cacheKey, TTL_EPISODES);
    if (cached?.payload) {
      return parseCachedEpisodesResult(cached, { isStale: isStale(cacheKey, TTL_EPISODES) });
    }

    const WTvdb = window.WatchlistTvdb;
    if (!WTvdb) return { state: ResultState.UNAVAILABLE };

    try {
      let raw = null;
      if (locale === "en" && WTvdb.fetchAllEpisodes) {
        const allOfficial = await WTvdb.fetchAllEpisodes(tvdbId, "en", {
          order: "official",
        });
        raw = filterTvdbEpisodesForSeason(allOfficial || [], season);
      }
      if (!raw?.length) {
        raw = await WTvdb.fetchEpisodes(tvdbId, season, locale);
      }

      let enRaw = null;
      if (locale === "ar") {
        enRaw = await WTvdb.fetchEpisodes(tvdbId, season, "en");
      } else if (locale === "en" && raw?.length) {
        const sample = raw.slice(0, Math.min(4, raw.length));
        const latinOverviews = sample.filter((ep) =>
          isLatinDominant(ep.overview)
        ).length;
        if (
          latinOverviews < Math.ceil(sample.length * 0.35) &&
          WTvdb.fetchAllEpisodes
        ) {
          const allOfficial = await WTvdb.fetchAllEpisodes(tvdbId, "en", {
            order: "official",
          });
          enRaw = filterTvdbEpisodesForSeason(allOfficial || [], season);
        }
      }

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
      const filtered = filterTvdbEpisodesForSeason(raw, season);
      if (!filtered.length) return { state: ResultState.UNAVAILABLE };

      // Duplicate-image guard: only clear when every still is the season poster.
      const seasonPosterUrl = normalizeArtworkUrl(fallbackPoster);
      const nonEmpty = filtered.filter((e) => e.still);
      const uniqueUrls = new Set(nonEmpty.map((e) => e.still));
      const isPosterDup = nonEmpty.length >= 2
        && uniqueUrls.size === 1
        && seasonPosterUrl
        && uniqueUrls.has(seasonPosterUrl);
      let episodes = isPosterDup
        ? filtered.map((e) => ({ ...e, still: "" }))
        : filtered;

      if (locale === "ar" && enRaw?.length) {
        const enFiltered = filterTvdbEpisodesForSeason(enRaw, season);
        const enByKey = new Map(
          enFiltered.map((ep) => [ep.progressKey || `${ep.seasonNumber}:${ep.episodeNumber}`, ep])
        );
        episodes = episodes.map((ep) => {
          const key = ep.progressKey || `${ep.seasonNumber}:${ep.episodeNumber}`;
          const enEp = enByKey.get(key);
          if (!enEp) return ep;
          const epNum = ep.episodeNumber;
          return {
            ...ep,
            title: pickLocalizedEpisodeText(ep.title, enEp.title, epNum)
              || `Episode ${epNum}`,
            overview: cleanEpisodeOverviewText(
              pickLocalizedOverview(ep.overview, enEp.overview)
            ),
          };
        });
      } else if (locale === "en" && enRaw?.length) {
        const enByKey = new Map(
          enRaw.map((ep) => [ep.progressKey || `${ep.seasonNumber}:${ep.episodeNumber}`, ep])
        );
        episodes = episodes.map((ep) => {
          const key = ep.progressKey || `${ep.seasonNumber}:${ep.episodeNumber}`;
          const enEp = enByKey.get(key);
          if (!enEp) return ep;
          const epNum = ep.episodeNumber;
          const overview = pickLatinEpisodeOverview(ep.overview, enEp.overview);
          return {
            ...ep,
            title: pickLocalizedEpisodeText(ep.title, enEp.title, epNum)
              || ep.title,
            overview: cleanEpisodeOverviewText(overview || ""),
          };
        });
      }

      episodes = episodes.map((ep) => ({
        ...ep,
        overview: cleanEpisodeOverviewText(ep.overview),
      }));

      // Feature films live in the Movies tab — not the Specials episode list.
      if (Number(season) === 0) {
        episodes = episodes.filter((ep) => !isMovieLikeTvSpecial(ep));
        if (!episodes.length) return { state: ResultState.UNAVAILABLE };
      }

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

  /** Sum regular-season episode counts (excludes specials and related movies). */
  function regularEpisodeTotalFromSeasons(seasons) {
    let total = 0;
    for (const season of seasons || []) {
      if (!season || season.seasonNumber <= 0 || season.isSpecials || season.isRelated) {
        continue;
      }
      const count = parsePositiveCount(season.episodeCount);
      if (count > 0) total += count;
    }
    return total > 0 ? total : null;
  }

  /**
   * Resolve season + episode totals from series providers (TVDB-first).
   * Avoids stale AniList title metadata (e.g. 1 season / 220 eps for Naruto).
   */
  async function fetchAnimeSeriesCounts(item, locale = "en") {
    const WM = window.WatchlistMetadata;
    let anilistId = WM?.extractAnilistId?.(item?.link) || null;
    if (!anilistId) {
      const resolution = await resolveAnimeSeriesId(item);
      anilistId = resolution?.anilistId || null;
    }
    if (!anilistId) return null;

    const result = await fetchAnilistSeriesMetadata(
      anilistId,
      locale,
      item?.poster || ""
    );
    const seasons = (result?.seasons || []).filter(
      (s) => s.seasonNumber > 0 && !s.isSpecials && !s.isRelated
    );
    const seasonCount = seasons.length > 0 ? seasons.length : 1;
    let total = regularEpisodeTotalFromSeasons(result?.seasons);
    if (!total && WM?.fetchAnilistById) {
      const titleMeta = await WM.fetchAnilistById(anilistId);
      total = parsePositiveCount(titleMeta?.episodeCount);
    }
    if (!total) {
      total = parsePositiveCount(result?.series?.totalEpisodes);
    }
    if (total > 0) return { seasonCount, episodeCount: total };
    return null;
  }

  async function fetchTitleSeriesCounts(item, locale = "en") {
    const ct = item?.contentType;
    if (ct !== "tvSeries" && ct !== "anime") return null;

    if (ct === "anime") {
      return fetchAnimeSeriesCounts(item, locale);
    }

    const resolution = await resolveSeriesId(item);
    if (!resolution || resolution.isNegative) return null;

    if (resolution.anilistId) {
      const result = await fetchAnilistSeriesMetadata(
        resolution.anilistId,
        locale,
        item?.poster || ""
      );
      const total = result?.series?.totalEpisodes;
      if (total > 0) {
        return { seasonCount: 1, episodeCount: total };
      }
      return null;
    }

    if (window.WatchlistTvdb) {
      try {
        const tvdbId = await resolveTvdbId(resolution);
        if (tvdbId) {
          const tvdbResult = await fetchTvdbSeriesMetadata(
            tvdbId,
            locale,
            item?.poster || ""
          );
          const seasons = tvdbResult?.seasons || [];
          const regular = seasons.filter((s) => s.seasonNumber > 0 && !s.isSpecials);
          const episodeCount = regularEpisodeTotalFromSeasons(seasons);
          const seasonCount = regular.length;
          if (seasonCount > 0 || episodeCount) {
            return {
              seasonCount: seasonCount > 0 ? seasonCount : null,
              episodeCount: episodeCount || null,
            };
          }

          const totals = await window.WatchlistTvdb.fetchEpisodeTotals(tvdbId, locale);
          if (totals?.episodeTotal > 0 || totals?.seasonTotal > 0) {
            return {
              seasonCount: totals.seasonTotal > 0 ? totals.seasonTotal : null,
              episodeCount: totals.episodeTotal > 0 ? totals.episodeTotal : null,
            };
          }
        }
      } catch {
        // fall through
      }
    }

    if (resolution.tmdbId) {
      const result = await fetchTmdbSeriesMetadata(
        resolution.tmdbId,
        locale,
        item?.poster || ""
      );
      const regular = (result?.seasons || []).filter(
        (s) => s.seasonNumber > 0 && !s.isSpecials
      );
      const episodeCount = regularEpisodeTotalFromSeasons(result?.seasons);
      if (regular.length > 0 || episodeCount) {
        return {
          seasonCount: regular.length > 0 ? regular.length : null,
          episodeCount: episodeCount || null,
        };
      }
    }

    if (resolution.anilistId) {
      const result = await fetchAnilistSeriesMetadata(
        resolution.anilistId,
        locale,
        item?.poster || ""
      );
      const regular = (result?.seasons || []).filter((s) => s.seasonNumber > 0);
      const episodeCount = regularEpisodeTotalFromSeasons(result?.seasons)
        || parsePositiveCount(result?.series?.totalEpisodes);
      if (regular.length > 0 || episodeCount) {
        return {
          seasonCount: regular.length > 0 ? regular.length : null,
          episodeCount: episodeCount || null,
        };
      }
    }

    return null;
  }

  /**
   * Resolve total regular episode count for a TV/anime title.
   * Tries TVDB/TMDB/AniList series providers before title-level AniList cache.
   */
  async function fetchTitleEpisodeTotal(item, locale = "en") {
    if (item?.contentType === "anime") {
      const counts = await fetchTitleSeriesCounts(item, locale);
      return counts?.episodeCount > 0 ? counts.episodeCount : null;
    }

    const fromSeries = await fetchTitleSeriesCounts(item, locale);
    if (fromSeries?.episodeCount > 0) return fromSeries.episodeCount;

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

    return null;
  }

  /**
   * Fetch badge fields (age, runtime, seasons, episodes) for a title.
   * Used on add and login backfill.
   */
  async function fetchTitleBadgeMeta(item, locale = "en") {
    const patches = {};
    const ct = item?.contentType;
    const WM = window.WatchlistMetadata;
    const imdbId = getImdbIdFromItem(item);

    let meta = null;
    if (imdbId) meta = await WM.getMetadata(imdbId);
    else if (item?.link && WM?.isSupportedLink?.(item.link)) {
      meta = await WM.resolveMetadataFromLink(item.link);
    }

    if (meta) {
      if (meta.ageRating) patches.ageRating = meta.ageRating;
      if (meta.runtime) patches.runtime = meta.runtime;
      if (ct !== "tvSeries" && ct !== "anime") {
        if (meta.seasonCount) patches.seasonCount = meta.seasonCount;
        if (meta.episodeCount) patches.episodeCount = meta.episodeCount;
      }
    }

    if (imdbId && !item?.imdbRating) {
      const rating = meta?.rating || (await WM.getMetadata(imdbId))?.rating;
      if (rating) patches.imdbRating = rating;
    }

    if (ct === "tvSeries" || ct === "anime") {
      const counts = await fetchTitleSeriesCounts(item, locale);
      if (ct === "anime") {
        if (counts?.episodeCount > 0) patches.episodeCount = counts.episodeCount;
        if (counts?.seasonCount > 0) {
          patches.seasonCount = counts.seasonCount;
        } else {
          patches.seasonCount = 1;
        }

        const anilistId =
          WM?.extractAnilistId?.(item?.link) ||
          (await resolveSeriesId(item))?.anilistId ||
          null;
        if (anilistId) {
          const anilist = await WM.fetchAnilistById(anilistId);
          if (anilist?.genres?.length) patches.sourceGenres = anilist.genres;
        }
      } else {
        if (counts?.seasonCount > 0) patches.seasonCount = counts.seasonCount;
        if (counts?.episodeCount > 0) {
          patches.episodeCount = counts.episodeCount;
        } else {
          const total = await fetchTitleEpisodeTotal(item, locale);
          if (total > 0) patches.episodeCount = total;
        }
      }
    }

    return Object.keys(patches).length ? patches : null;
  }

  // ─── Expose public API ────────────────────────────────────────

  window.WatchlistSeriesMetadata = {
    ResultState,
    resolveSeriesId,
    fetchSeriesMetadata,
    fetchSeasonEpisodes,
    fetchRelatedMovies,
    fetchTitleEpisodeTotal,
    fetchTitleBadgeMeta,
    fetchTitleSeriesCounts,
    resolveLinkedImdbId,
    regularEpisodeTotalFromSeasons,
    clearItemResolutionCache,
    cleanEpisodeOverview: cleanEpisodeOverviewText,
    pickSeasonAnilistId,
    isTvSpecialLinkedMovie: isMovieLikeTvSpecial,
    // Normalization functions exposed for testing
    _normalizeTmdbSeries: normalizeTmdbSeries,
    _normalizeTmdbSeasonSummary: normalizeTmdbSeasonSummary,
    _normalizeTmdbEpisode: normalizeTmdbEpisode,
    _normalizeOmdbSeason: normalizeOmdbSeason,
    _isAired: isAired,
    _parsePositiveCount: parsePositiveCount,
    _anilistDateStr: anilistDateStr,
    _stripHtml: stripHtml,
    _cleanEpisodeOverview: cleanEpisodeOverviewText,
    _expandEpisodeListFromTvdbSkeleton: expandEpisodeListFromTvdbSkeleton,
    _episodeOverviewLooksBoilerplate: episodeOverviewLooksBoilerplate,
    _collectAnilistRelatedMoviesFromSources: collectAnilistRelatedMoviesFromSources,
    _isMovieLikeTvSpecial: isMovieLikeTvSpecial,
    _isTvSpecialNonMovie: isTvSpecialNonMovie,
    // TheTVDB provider functions exposed for testing
    _resolveTvdbId: resolveTvdbId,
    _fetchTvdbSeriesMetadata: fetchTvdbSeriesMetadata,
    _fetchTvdbSeasonEpisodes: fetchTvdbSeasonEpisodes,
  };
})();
