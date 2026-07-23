(function () {
  "use strict";

  const CACHE_KEY = "watchlist-metadata-cache-v5";
  const ANILIST_API = "https://graphql.anilist.co";
  const TMDB_IMAGE = "https://image.tmdb.org/t/p/w500";
  const TMDB_IMAGE_SM = "https://image.tmdb.org/t/p/w92";
  const TMDB_LOW_RES = /\/t\/p\/w(92|154|185|342)\//;

  function upgradeTmdbPosterUrl(url) {
    if (!url || typeof url !== "string") return url || "";
    if (!url.includes("image.tmdb.org")) return url;
    return url.replace(/\/t\/p\/w\d+\//, "/t/p/w500/");
  }

  function pickAnilistCoverUrl(coverImage) {
    if (!coverImage) return "";
    if (typeof coverImage === "string") return coverImage.trim();
    return (
      coverImage.extraLarge ||
      coverImage.large ||
      coverImage.medium ||
      ""
    ).trim();
  }

  const BULK_ADD_TRACE_TITLE_NEEDLES = [
    "fairy tail",
    "tokyo ghoul",
    "ushio and tora",
    "no game, no life",
    "love through a prism",
  ];

  function isBulkAddTraceTitle(title) {
    const hay = String(title || "").toLowerCase();
    return BULK_ADD_TRACE_TITLE_NEEDLES.some((needle) => hay.includes(needle));
  }

  function isAddPipelineDebugEnabled() {
    try {
      return localStorage.getItem("watchlist-debug-add") === "1";
    } catch {
      return false;
    }
  }

  function logBulkVsSearchBuild(label, payload = {}) {
    if (!isAddPipelineDebugEnabled() && !isBulkAddTraceTitle(payload.title)) return;
    console.warn("[bulk-vs-search-build]", { label, ...payload });
  }

  function probePosterImageUrl(url, timeoutMs = 8000) {
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
        clearTimeout(timer);
        img.onload = null;
        img.onerror = null;
        img.src = "";
        resolve(ok);
      };
      const timer = setTimeout(() => finish(false), timeoutMs);
      img.onload = () => finish(true);
      img.onerror = () => finish(false);
      img.src = trimmed;
    });
  }

  function collectRawAnilistCoverUrls(details = {}) {
    return [
      details.poster,
      details.coverImageExtraLarge,
      details.coverImageLarge,
      details.coverImageMedium,
      details.coverImage?.extraLarge,
      details.coverImage?.large,
      details.coverImage?.medium,
    ]
      .map((url) => String(url || "").trim())
      .filter(isRawAnilistPosterUrl)
      .filter((url, index, list) => list.indexOf(url) === index);
  }

  async function verifyAnimePosterForSave(details) {
    if (!details) return { ok: false, reason: "no_details", verified: false };
    const candidates = collectRawAnilistCoverUrls(details);
    if (!candidates.length) {
      return { ok: false, reason: "no_poster_url", verified: false, poster: "" };
    }
    for (const url of candidates) {
      if (await probePosterImageUrl(url)) {
        details.poster = url;
        details.posterBroken = false;
        details.posterVerified = true;
        return { ok: true, reason: "image_probe_ok", verified: true, poster: url };
      }
    }
    return {
      ok: false,
      reason: "image_probe_failed",
      verified: false,
      poster: details.poster || candidates[0] || "",
    };
  }

  function anilistCacheHasUsablePoster(cached) {
    if (!cached) return false;
    if (isRawAnilistPosterUrl(cached.poster)) return true;
    return collectRawAnilistCoverUrls(cached).length > 0;
  }

  function patchAnilistProviderCache(anilistId, patch) {
    const id = Number(anilistId);
    if (!Number.isFinite(id) || !patch) return null;
    const key = `anilist:${id}`;
    const existing = readCached(key) || {};
    const merged = {
      ...existing,
      ...patch,
      source: "anilist",
      anilistId: id,
    };
    if (patch.coverImageExtraLarge || patch.coverImageLarge || patch.coverImageMedium) {
      attachAnilistCoverFields(merged, {
        extraLarge: patch.coverImageExtraLarge,
        large: patch.coverImageLarge,
        medium: patch.coverImageMedium,
      });
    }
    if (!merged.link) merged.link = `https://anilist.co/anime/${id}/`;
    writeCacheEntry(key, merged);
    return merged;
  }

  function logAnimeCoverFetch(payload = {}) {
    const shouldLog =
      payload.reason === "provider_cache_missing_poster" ||
      isBulkAddTraceTitle(payload.title) ||
      isAddPipelineDebugEnabled();
    if (!shouldLog) return;
    console.warn("[anime-cover-fetch]", payload);
  }

  function isRawAnilistPosterUrl(url) {
    const trimmed = String(url || "").trim();
    if (!trimmed) return false;
    if (!trimmed.includes("anilist")) return false;
    return /^https?:\/\//i.test(trimmed);
  }

  function applyRawAnilistPosterToDetails(details, posterUrl, source = "anilist") {
    if (!details || !isRawAnilistPosterUrl(posterUrl)) return details;
    const prev = details.poster || "";
    details.poster = String(posterUrl).trim();
    details.posterBroken = false;
    details.posterSource = source;
    if (prev && prev !== details.poster && isAddPipelineDebugEnabled()) {
      console.warn("[bulk-vs-search-build] poster replaced", {
        title: details.title,
        previous: prev,
        next: details.poster,
        source,
      });
    }
    return details;
  }

  /**
   * AniList GraphQL names (extraLarge / large / medium) map to CDN folders
   * (large / medium / small). There is no /extraLarge/ folder on the CDN.
   */
  function upgradeAnilistPosterUrl(url) {
    if (!url || typeof url !== "string") return url || "";
    if (!url.includes("anilist")) return url;
    return url
      .replace(/\/extraLarge\//, "/large/")
      .replace(/\/small\//, "/large/")
      .replace(/\/medium\//, "/large/");
  }

  function isLowResPosterUrl(url) {
    if (!url || typeof url !== "string") return false;
    if (TMDB_LOW_RES.test(url)) return true;
    if (url.includes("anilist") && /\/small\//.test(url)) return true;
    if (url.includes("anilist") && /\/medium\//.test(url)) return true;
    return false;
  }

  function upgradePosterForStorage(url, details = {}) {
    if (!url) return "";
    if (details.source === "anilist" || details.anilistId || String(url).includes("anilist")) {
      return upgradeAnilistPosterUrl(url);
    }
    return upgradeTmdbPosterUrl(url);
  }

  const GENRE_ALIASES = {
    "sci-fi": "Science Fiction",
    "science fiction": "Science Fiction",
    "film-noir": "Crime",
    "film noir": "Crime",
    "musical": "Family",
    biography: "Historical",
    history: "Historical",
    sport: "Sports",
    "reality-tv": "Documentary",
    "talk-show": "Documentary",
    news: "Documentary",
    "game-show": "Family",
    psychological: "Thriller",
    supernatural: "Fantasy",
    thriller: "Thriller",
    mystery: "Mystery",
    romance: "Romance",
    horror: "Horror",
    mecha: "Science Fiction",
    music: "Family",
    // TMDB Arabic (ar-SA) genre labels
    دراما: "Drama",
    جريمة: "Crime",
    عائلي: "Family",
    كوميديا: "Comedy",
    رعب: "Horror",
    غموض: "Mystery",
    رومانسي: "Romance",
    رومانسية: "Romance",
    أكشن: "Action",
    اكشن: "Action",
    مغامرة: "Adventure",
    وثائقي: "Documentary",
    فانتازيا: "Fantasy",
    خيال: "Fantasy",
    "خيال علمي": "Science Fiction",
    إثارة: "Thriller",
    اثارة: "Thriller",
    حرب: "War",
    رياضة: "Sports",
    تاريخي: "Historical",
    غربي: "Western",
  };

  const ANILIST_GENRE_MAP = {
    Psychological: "Thriller",
    Supernatural: "Fantasy",
    Suspense: "Thriller",
    Ecchi: null,
    Hentai: null,
  };

  function getOmdbKey() {
    return window.WATCHLIST_CONFIG?.omdbApiKey?.trim() || "";
  }

  function getTmdbKey() {
    return window.WATCHLIST_CONFIG?.tmdbApiKey?.trim() || "";
  }

  function hasOmdbKey() {
    return Boolean(getOmdbKey());
  }

  function hasTmdbKey() {
    return Boolean(getTmdbKey());
  }

  function hasApiKey() {
    return hasOmdbKey();
  }

  function hasSearchConfigured() {
    return hasOmdbKey() || hasTmdbKey() || true;
  }

  function extractImdbId(url) {
    if (!url) return null;
    const match = String(url).match(/tt\d{7,8}/i);
    return match ? match[0].toLowerCase() : null;
  }

  /** Parses themoviedb.org/tv/{id} or /movie/{id} from search-pick links. */
  function extractTmdbId(url) {
    try {
      const uri = new URL(String(url || "").trim());
      const host = uri.hostname.replace(/^www\./i, "");
      if (!host.includes("themoviedb.org")) return null;
      const parts = uri.pathname.split("/").filter(Boolean);
      if (parts.length < 2) return null;
      const mediaType = parts[0];
      if (mediaType !== "tv" && mediaType !== "movie") return null;
      const tmdbId = Number(parts[1]);
      if (!Number.isFinite(tmdbId) || tmdbId <= 0) return null;
      return { mediaType, tmdbId };
    } catch {
      return null;
    }
  }

  function extractAnilistId(url) {
    const parsed = parseAnilistLink(url);
    return parsed?.anilistId ? String(parsed.anilistId) : null;
  }

  function isAnilistLink(url) {
    try {
      const host = new URL(url).hostname.replace(/^www\./i, "");
      return host === "anilist.co";
    } catch {
      return false;
    }
  }

  function isMalLink(url) {
    try {
      const host = new URL(url).hostname.replace(/^www\./i, "");
      return host === "myanimelist.net";
    } catch {
      return false;
    }
  }

  function isSupportedLink(url) {
    const value = String(url || "").trim();
    if (!value) return false;
    return Boolean(
      extractImdbId(value) || isAnilistLink(value) || isMalLink(value)
    );
  }

  function parseAnilistLink(url) {
    try {
      if (!isAnilistLink(url)) return null;
      const parts = new URL(url).pathname.split("/").filter(Boolean);
      if (parts[0] === "anime" && parts[1]) {
        return { anilistId: Number(parts[1]), kind: "anime" };
      }
      return null;
    } catch {
      return null;
    }
  }

  function parseMalLink(url) {
    try {
      if (!isMalLink(url)) return null;
      const parts = new URL(url).pathname.split("/").filter(Boolean);
      if (parts[0] === "anime" && parts[1]) {
        return { malId: Number(parts[1]) };
      }
      return null;
    } catch {
      return null;
    }
  }

  function extractMalId(url) {
    const parsed = parseMalLink(url);
    return parsed?.malId ? String(parsed.malId) : null;
  }

  function normalizeTitleKey(title) {
    return String(title)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  function stripHtml(text) {
    return String(text || "")
      .replace(/<[^>]+>/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  const memory = new Map();
  const MEMORY_CACHE_MAX = 400;
  let diskCacheDirty = false;
  let diskCacheTimer = null;
  let diskCacheSnapshot = null;

  function readCache() {
    if (diskCacheSnapshot) return diskCacheSnapshot;
    try {
      diskCacheSnapshot = JSON.parse(localStorage.getItem(CACHE_KEY) || "{}");
    } catch {
      diskCacheSnapshot = {};
    }
    return diskCacheSnapshot;
  }

  function flushDiskCacheSoon() {
    if (diskCacheTimer) return;
    diskCacheTimer = setTimeout(() => {
      diskCacheTimer = null;
      if (!diskCacheDirty || !diskCacheSnapshot) return;
      diskCacheDirty = false;
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify(diskCacheSnapshot));
    } catch {
      /* ignore quota errors */
    }
    }, 5000);
  }

  function writeCacheEntry(cacheKey, data) {
    const slim = {
      title: data.title || "",
      year: data.year || "",
      anilistId: data.anilistId || null,
      tmdbId: data.tmdbId || null,
      imdbId: data.imdbId || null,
      poster: data.poster || "",
      source: data.source || "",
      genres: Array.isArray(data.genres) ? data.genres.slice(0, 8) : [],
      anilistRating: data.anilistRating || "",
      imdbRating: data.imdbRating || "",
      ageRating: data.ageRating || "",
      episodeCount: data.episodeCount || null,
      seasonCount: data.seasonCount || null,
      runtime: data.runtime || "",
      cachedAt: Date.now(),
    };
    const cache = readCache();
    cache[cacheKey] = slim;
    diskCacheDirty = true;
    flushDiskCacheSoon();
    memory.set(cacheKey, slim);
    if (memory.size > MEMORY_CACHE_MAX) {
      const oldest = memory.keys().next().value;
      memory.delete(oldest);
    }
  }

  function readCached(cacheKey) {
    if (memory.has(cacheKey)) return memory.get(cacheKey);
    const cached = readCache()[cacheKey];
    if (cached) {
      memory.set(cacheKey, cached);
      return cached;
    }
    return null;
  }

  function ensureAnilistRating(payload) {
    if (!payload || payload.anilistRating) return payload;
    if (payload.source !== "anilist" && !payload.anilistId) return payload;

    const raw = Number(String(payload.rating || "").replace(",", "."));
    if (!Number.isFinite(raw)) return payload;

    payload.anilistRating = raw <= 10 ? String(Math.round(raw * 10)) : String(Math.round(raw));
    return payload;
  }

  function parseActorList(value) {
    if (!value || value === "N/A") return [];
    return String(value)
      .split(",")
      .map((name) => name.trim())
      .filter(Boolean);
  }

  function parseGenreList(value) {
    if (!value || value === "N/A") return [];
    if (Array.isArray(value)) return value.map((g) => String(g).trim()).filter(Boolean);
    return String(value)
      .split(",")
      .map((genre) => genre.trim())
      .filter(Boolean);
  }

  function mapGenreToStandard(rawGenre, standardGenres = []) {
    const trimmed = String(rawGenre || "").trim();
    if (!trimmed) return null;

    const lower = trimmed.toLowerCase();
    const alias = GENRE_ALIASES[lower] || GENRE_ALIASES[trimmed];
    if (alias && standardGenres.includes(alias)) return alias;

    const exact = standardGenres.find((genre) => genre.toLowerCase() === lower);
    if (exact) return exact;

    const partial = standardGenres.find(
      (genre) =>
        lower.includes(genre.toLowerCase()) ||
        genre.toLowerCase().includes(lower)
    );
    if (partial) return partial;

    return null;
  }

  /** When genre mapping fails, avoid Action (STANDARD_GENRES[0]) for live-action TV. */
  function defaultGenreForContentType(contentType = "") {
    const type = normalizeSuggestContentType(contentType);
    if (type === "anime") return ANIME_GENRE_FALLBACK;
    return "Drama";
  }

  function mapAnilistGenre(genre, standardGenres) {
    if (ANILIST_GENRE_MAP[genre] === null) return null;
    if (ANILIST_GENRE_MAP[genre]) return ANILIST_GENRE_MAP[genre];
    return mapGenreToStandard(genre, standardGenres);
  }

  const ANIME_GENRE_FALLBACK = "Action";

  function normalizeSuggestContentType(contentType) {
    const value = String(contentType || "").trim();
    return value === "anime" || value === "movies" || value === "tvSeries" ? value : "";
  }

  function suggestGenres(rawGenres, standardGenres = [], contentType = "") {
    const type = normalizeSuggestContentType(contentType);
    const mapped = [];
    for (const raw of parseGenreList(rawGenres)) {
      const genre =
        mapAnilistGenre(raw, standardGenres) ||
        mapGenreToStandard(raw, standardGenres);
      if (genre && !mapped.includes(genre)) mapped.push(genre);
    }

    if (type !== "anime") return mapped;

    const withoutAnimation = mapped.filter(
      (genre) => genre.toLowerCase() !== "animation"
    );
    if (withoutAnimation.length) return withoutAnimation;
    return mapped.length ? mapped : [ANIME_GENRE_FALLBACK];
  }

  const TMDB_KEYWORD_GENRE_HINTS = {
    gangster: "Crime",
    mafia: "Crime",
    heist: "Crime",
    detective: "Crime",
    murder: "Crime",
    organized: "Crime",
    "organized crime": "Crime",
    superhero: "Action",
    "super hero": "Action",
    "superhero team": "Action",
    batman: "Action",
    "dc comics": "Action",
    villain: "Thriller",
    psychological: "Thriller",
    dystopia: "Science Fiction",
    "post-apocalyptic": "Science Fiction",
    vampire: "Horror",
    zombie: "Horror",
    serial: "Thriller",
    "serial killer": "Thriller",
    western: "Western",
    war: "War",
    sports: "Sports",
    sport: "Sports",
    musical: "Family",
    biography: "Historical",
    historical: "Historical",
  };

  let genreMergeDebugWesternLogged = false;

  function mapKeywordToGenre(keyword, standardGenres = []) {
    const raw = String(keyword?.name || keyword || "").trim();
    if (!raw) return null;
    const lower = raw.toLowerCase();
    const hinted = TMDB_KEYWORD_GENRE_HINTS[lower];
    if (hinted && standardGenres.includes(hinted)) return hinted;
    return mapGenreToStandard(raw, standardGenres);
  }

  function mergeProviderGenreSources(sources = {}, standardGenres = [], contentType = "") {
    const raw = [];
    const seen = new Set();
    const pushRaw = (value) => {
      for (const genre of parseGenreList(value)) {
        const key = genre.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        raw.push(genre);
      }
    };

    pushRaw(sources.existing);
    pushRaw(sources.tmdb);
    pushRaw(sources.omdb);
    for (const keyword of sources.keywords || []) {
      const mapped = mapKeywordToGenre(keyword, standardGenres);
      if (mapped) pushRaw(mapped);
      else pushRaw(keyword?.name || keyword);
    }

    const suggested = suggestGenres(raw, standardGenres, contentType);
    return { raw, suggested };
  }

  function applyMergedGenresToItem(item, mergeResult, contentType = "") {
    if (!item || !mergeResult?.suggested?.length) return false;

    const { raw, suggested } = mergeResult;
    const type = contentType || item.contentType || "";
    const current = [item.genre, ...(item.secondaryGenres || [])].filter(Boolean);
    let changed = false;

    if (raw.length) {
      const prev = JSON.stringify(item.sourceGenres || []);
      const next = JSON.stringify(raw);
      if (prev !== next) {
        item.sourceGenres = raw;
        changed = true;
      }
    }

    if (current.length > suggested.length && current.length >= 2) {
      const extras = suggested.filter((g) => g !== item.genre && !current.includes(g));
      if (extras.length) {
        item.secondaryGenres = [...(item.secondaryGenres || []), ...extras].filter(
          (g, i, arr) => arr.indexOf(g) === i
        );
        changed = true;
      }
      return changed;
    }

    const primary = suggested[0];
    const secondaries = suggested.slice(1);
    if (primary && (!item.genre || item.genre === "Drama" || current.length <= 1)) {
      if (item.genre !== primary) {
        item.genre = primary;
        changed = true;
      }
      const nextSecondary = secondaries.filter((g) => g !== primary);
      const prevSec = JSON.stringify(item.secondaryGenres || []);
      const nextSec = JSON.stringify(nextSecondary);
      if (prevSec !== nextSec) {
        item.secondaryGenres = nextSecondary;
        changed = true;
      }
    } else if (secondaries.length) {
      const extras = secondaries.filter((g) => g !== item.genre && !current.includes(g));
      if (extras.length) {
        item.secondaryGenres = [...(item.secondaryGenres || []), ...extras].filter(
          (g, i, arr) => arr.indexOf(g) === i
        );
        changed = true;
      }
    }

    return changed;
  }

  async function fetchTmdbKeywords(mediaType, tmdbId) {
    const id = parseInt(String(tmdbId || "").trim(), 10);
    if (!Number.isFinite(id) || id <= 0) return [];
    const type = mediaType === "tv" ? "tv" : "movie";
    const cacheKey = `tmdb-keywords:${type}:${id}`;
    const cached = readCached(cacheKey);
    if (cached?.keywords) return cached.keywords;

    const json = await fetchTmdb(`${type}/${id}/keywords`);
    const keywords =
      type === "tv"
        ? json?.results || []
        : json?.keywords || [];
    if (Array.isArray(keywords) && keywords.length) {
      writeCacheEntry(cacheKey, { keywords });
    }
    return Array.isArray(keywords) ? keywords : [];
  }

  async function enrichDetailsGenres(details, options = {}) {
    if (!details) return details;
    const contentType =
      options.contentType ||
      details.contentType ||
      inferContentType(details.mediaType || details.omdbType, details.genres || []);
    if (contentType === "anime") return details;

    const standardGenres = options.standardGenres || [];
    const sources = {
      existing: details.genres || [],
      tmdb: details.genres || [],
      omdb: [],
      keywords: details.tmdbKeywords || [],
    };

    if (details.imdbId && hasOmdbKey()) {
      const omdb = await getMetadata(details.imdbId);
      if (omdb?.genres?.length) sources.omdb = omdb.genres;
    }

    if (details.tmdbId && details.tmdbType && !sources.keywords.length) {
      sources.keywords = await fetchTmdbKeywords(details.tmdbType, details.tmdbId);
    }

    const merged = mergeProviderGenreSources(sources, standardGenres, contentType);
    details.genres = merged.raw;
    details.mergedGenres = merged.suggested;

    const debug =
      options.debugLabel &&
      (contentType === "tvSeries" || contentType === "movies") &&
      !genreMergeDebugWesternLogged;
    if (debug) {
      genreMergeDebugWesternLogged = true;
      console.warn("[metadata:genre-merge]", {
        title: options.debugLabel,
        contentType,
        tmdbGenres: sources.tmdb,
        omdbGenres: sources.omdb,
        tmdbKeywords: (sources.keywords || []).map((k) => k?.name || k).slice(0, 12),
        finalMerged: merged.suggested,
        skippedOmdb: !details.imdbId || !hasOmdbKey(),
        skippedKeywords: !details.tmdbId,
      });
    }

    return details;
  }

  async function mergeAndApplyItemGenres(item, details, options = {}) {
    if (!item || !details) return false;
    const contentType = options.contentType || item.contentType || "";
    if (contentType === "anime") return false;

    const enriched = await enrichDetailsGenres(details, {
      contentType,
      standardGenres: options.standardGenres || [],
      debugLabel: options.debugLabel || item.title,
    });
    const mergeResult = {
      raw: enriched.genres || [],
      suggested:
        enriched.mergedGenres ||
        suggestGenres(enriched.genres, options.standardGenres || [], contentType),
    };
    return applyMergedGenresToItem(item, mergeResult, contentType);
  }

  function tmdbOriginCountries(item) {
    const raw = item?.origin_country || item?.originCountry || [];
    return Array.isArray(raw) ? raw.map((c) => String(c).toUpperCase()) : [];
  }

  function isJapaneseTmdbProduction(item) {
    if (!item) return false;
    const countries = tmdbOriginCountries(item);
    if (countries.includes("JP")) return true;
    const lang = String(item.original_language || item.originalLanguage || "").toLowerCase();
    return lang === "ja";
  }

  function isLikelyAnimeSearchResult(result) {
    if (!result) return false;
    if (result.source === "anilist" || result.anilistId) return true;
    if (String(result.type || "").toLowerCase() === "anime") return true;
    if (isJapaneseTmdbProduction(result)) return true;
    if (isAnimatedContent(result.genres)) return true;
    if (Array.isArray(result.genreIds) && result.genreIds.includes(16)) return true;
    const lang = String(
      result.originalLanguage || result.original_language || ""
    ).toLowerCase();
    if (lang === "ja") return true;
    if (result.title) {
      const cached = lookupCachedAnilistMatch(result.title, { year: result.year });
      if (cached?.pick?.anilistId) return true;
    }
    return false;
  }

  function displayTypeForSearchResult(result) {
    if (!result) return "";
    if (result.displayType) return result.displayType;
    if (isLikelyAnimeSearchResult(result)) return "anime";
    const raw = String(result.type || "").toLowerCase();
    if (raw === "movie") return "movie";
    if (result.tmdbType === "tv" || raw === "series") return "series";
    return raw || "series";
  }

  function pickPreferredSearchResult(existing, candidate) {
    const existingAnilist = existing.source === "anilist";
    const candidateAnilist = candidate.source === "anilist";
    const existingWestTv =
      existing.source === "tmdb" &&
      existing.tmdbType === "tv" &&
      !isJapaneseTmdbProduction(existing);
    const candidateWestTv =
      candidate.source === "tmdb" &&
      candidate.tmdbType === "tv" &&
      !isJapaneseTmdbProduction(candidate);
    const existingJpTv =
      existing.source === "tmdb" &&
      existing.tmdbType === "tv" &&
      isJapaneseTmdbProduction(existing);
    const candidateJpTv =
      candidate.source === "tmdb" &&
      candidate.tmdbType === "tv" &&
      isJapaneseTmdbProduction(candidate);

    if (existingAnilist && candidateWestTv) return candidate;
    if (candidateAnilist && existingWestTv) return existing;
    if (existingAnilist && candidateJpTv) return existing;
    if (candidateAnilist && existingJpTv) return candidate;
    if (existingAnilist || candidateAnilist) {
      return existingAnilist ? existing : candidate;
    }
    return existing;
  }

  function isAnimatedContent(genres) {
    return parseGenreList(genres).some((genre) => {
      const lower = genre.toLowerCase();
      return lower === "animation" || lower === "anime";
    });
  }

  function inferContentType(mediaType, genres = []) {
    const type = String(mediaType || "").toLowerCase();
    if (type === "anime") return "anime";
    if (type === "series" || type === "episode" || type === "tv") return "tvSeries";
    if (type === "movie" || type === "game") return "movies";
    return "movies";
  }

  function defaultLinkForDetails(details, contentType = "") {
    const ct =
      contentType ||
      (details?.contentType ? String(details.contentType) : "") ||
      inferContentType(details?.mediaType || details?.omdbType, details?.genres || []);
    if (ct === "anime" && details?.anilistId) {
      return `https://anilist.co/anime/${details.anilistId}/`;
    }
    if (details?.anilistId && !details?.imdbId) {
      return `https://anilist.co/anime/${details.anilistId}/`;
    }
    if (details?.imdbId) {
      return `https://www.imdb.com/title/${details.imdbId}/`;
    }
    const existing = String(details?.link || "").trim();
    if (existing) return existing;
    // TMDB fallback when TMDB has no IMDb mapping (common for some Arabic titles)
    if (details?.tmdbType && details?.tmdbId) {
      return `https://www.themoviedb.org/${details.tmdbType}/${details.tmdbId}`;
    }
    return "";
  }

  function pickTmdbImdbId(item) {
    if (!item) return null;
    const direct = item.imdb_id;
    if (direct) return String(direct).toLowerCase();
    const ext = item.external_ids?.imdb_id;
    if (ext) return String(ext).toLowerCase();
    return null;
  }

  function buildDetailPayload(base) {
    const genres = parseGenreList(base.genres);
    return {
      source: base.source || "omdb",
      imdbId: base.imdbId || null,
      anilistId: base.anilistId || null,
      tmdbType: base.tmdbType || null,
      tmdbId: base.tmdbId || null,
      link: defaultLinkForDetails(base),
      poster: base.poster || "",
      rating: base.rating || "",
      anilistRating: base.anilistRating || "",
      year: base.year || "",
      plot: base.plot || "",
      title: base.title || "",
      runtime: base.runtime || "",
      ageRating: base.ageRating || "",
      seasonCount: base.seasonCount || null,
      episodeCount: base.episodeCount || null,
      actors: base.actors || [],
      genres,
      director: base.director || "",
      omdbType: base.omdbType || base.mediaType || "",
      contentType: inferContentType(base.mediaType || base.omdbType, genres),
    };
  }

  function parsePositiveInt(value) {
    const parsed = parseInt(String(value || "").trim(), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }

  function formatRuntimeMinutes(minutes) {
    const value = parsePositiveInt(minutes);
    if (!value) return "";
    const i18n = window.WatchlistI18n;
    const lang =
      i18n?.getLang?.() ||
      (document.documentElement.lang?.startsWith("ar") ? "ar" : "en");
    if (lang === "ar") return `${value} دقيقة`;
    const localized = i18n?.t?.("seasons.epRuntime", { n: value });
    if (localized && localized !== "seasons.epRuntime") return localized;
    return `${value} min`;
  }

  function localizeRuntimeLabel(runtime) {
    const trimmed = String(runtime || "").trim();
    if (!trimmed) return "";
    const direct = parsePositiveInt(trimmed);
    if (direct) return formatRuntimeMinutes(direct);
    const match = trimmed.match(
      /(\d+)\s*(?:min(?:ute)?s?|mins?|m\b|د(?:قي)?(?:قة?|قائق)?)/iu
    );
    if (match) return formatRuntimeMinutes(match[1]);
    return trimmed;
  }

  function detectQueryTitleLocale(query) {
    return /[\u0600-\u06FF]/.test(String(query || "")) ? "ar" : "en";
  }

  function pickTmdbDisplayTitle(item, titleLocale = "en") {
    if (!item) return "";
    const localizedTitle = String(item.title || item.name || "").trim();
    const originalTitle = String(
      item.original_title || item.original_name || ""
    ).trim();
    const originalLang = String(item.original_language || "").trim();
    if (titleLocale === "ar") {
      if (/[\u0600-\u06FF]/.test(localizedTitle)) return localizedTitle;
      if (/[\u0600-\u06FF]/.test(originalTitle)) return originalTitle;
      if (originalLang === "ar" && originalTitle) return originalTitle;
      return localizedTitle || originalTitle;
    }
    if (localizedTitle && !/[\u0600-\u06FF]/.test(localizedTitle)) {
      return localizedTitle;
    }
    if (originalTitle && !/[\u0600-\u06FF]/.test(originalTitle)) {
      return originalTitle;
    }
    return localizedTitle || originalTitle;
  }

  function pickTmdbAgeRating(item, mediaType) {
    if (!item) return "";
    if (mediaType === "tv") {
      const us = (item.content_ratings?.results || []).find(
        (entry) => entry.iso_3166_1 === "US"
      );
      const rating = us?.rating;
      return rating && rating !== "N/A" ? String(rating) : "";
    }

    const us = (item.release_dates?.results || []).find(
      (entry) => entry.iso_3166_1 === "US"
    );
    const certification = (us?.release_dates || [])
      .map((entry) => entry.certification)
      .find((value) => value && value !== "N/A");
    return certification ? String(certification) : "";
  }

  function pickTmdbRuntime(item, mediaType) {
    if (!item) return "";
    if (mediaType === "tv") {
      const times = (item.episode_run_time || [])
        .map((value) => parsePositiveInt(value))
        .filter(Boolean);
      if (!times.length) return "";
      const avg = Math.round(times.reduce((sum, value) => sum + value, 0) / times.length);
      return formatRuntimeMinutes(avg);
    }
    return item.runtime ? formatRuntimeMinutes(item.runtime) : "";
  }

  function formatEpisodeDurationLabel(runtime) {
    const trimmed = String(runtime || "").trim();
    if (!trimmed) return "";
    if (/\/ep/i.test(trimmed)) {
      return trimmed.startsWith("~") ? trimmed : `~${trimmed}`;
    }
    const match = trimmed.match(/(\d+)/);
    const minutes = match ? parsePositiveInt(match[1]) : null;
    if (minutes) {
      const i18n = window.WatchlistI18n;
      const lang = i18n?.getLang?.() || "en";
      if (lang === "ar") return `~${minutes} دقيقة/ح`;
      return `~${minutes} min/ep`;
    }
    return `~${trimmed}/ep`;
  }

  function normalizeAgeRatingKey(raw) {
    return String(raw || "")
      .trim()
      .toUpperCase()
      .replace(/\s+/g, " ");
  }

  const AGE_RATING_I18N_KEYS = {
    G: "ageRating.allAges",
    "TV-G": "ageRating.allAges",
    TVG: "ageRating.allAges",
    "TV-Y": "ageRating.kids",
    TVY: "ageRating.kids",
    "TV-Y7": "ageRating.ages7",
    "TV-Y7-FV": "ageRating.ages7",
    TVY7: "ageRating.ages7",
    TVY7FV: "ageRating.ages7",
    PG: "ageRating.parentalGuidance",
    "TV-PG": "ageRating.parentalGuidance",
    TVPG: "ageRating.parentalGuidance",
    "PG-13": "ageRating.ages13",
    PG13: "ageRating.ages13",
    "TV-14": "ageRating.ages14",
    TV14: "ageRating.ages14",
    R: "ageRating.ages17",
    "TV-MA": "ageRating.ages17",
    TVMA: "ageRating.ages17",
    "NC-17": "ageRating.adultsOnly",
    NC17: "ageRating.adultsOnly",
    "18+": "ageRating.adultsOnly",
    18: "ageRating.adultsOnly",
    NR: "ageRating.unrated",
    UNRATED: "ageRating.unrated",
    "NOT RATED": "ageRating.unrated",
    NOTRATED: "ageRating.unrated",
  };

  const AGE_RATING_FALLBACK_EN = {
    "ageRating.allAges": "All ages",
    "ageRating.kids": "Kids",
    "ageRating.ages7": "Ages 7+",
    "ageRating.parentalGuidance": "Parental guidance",
    "ageRating.ages13": "Ages 13+",
    "ageRating.ages14": "Ages 14+",
    "ageRating.ages17": "Ages 17+",
    "ageRating.adultsOnly": "Adults only",
    "ageRating.unrated": "Unrated",
  };

  const AGE_RATING_SORT_RANK = {
    allAges: 10,
    kids: 20,
    ages7: 30,
    unrated: 35,
    parentalGuidance: 40,
    ages13: 50,
    ages14: 60,
    ages17: 70,
    adultsOnly: 80,
  };

  function ageRatingCategory(raw) {
    const trimmed = String(raw || "").trim();
    if (!trimmed) return null;

    const key = normalizeAgeRatingKey(trimmed);
    const compact = key.replace(/[-\s]/g, "");
    const i18nKey = AGE_RATING_I18N_KEYS[key] || AGE_RATING_I18N_KEYS[compact];
    if (!i18nKey) return null;
    return i18nKey.replace("ageRating.", "");
  }

  function ageRatingSortRank(raw) {
    const trimmed = String(raw || "").trim();
    if (!trimmed) return null;

    const category = ageRatingCategory(trimmed);
    if (category && AGE_RATING_SORT_RANK[category] != null) {
      return AGE_RATING_SORT_RANK[category];
    }
    return 55;
  }

  function formatAgeRatingDisplay(raw) {
    const trimmed = String(raw || "").trim();
    if (!trimmed) return "";

    const key = normalizeAgeRatingKey(trimmed);
    const compact = key.replace(/[-\s]/g, "");
    const i18nKey = AGE_RATING_I18N_KEYS[key] || AGE_RATING_I18N_KEYS[compact];
    if (i18nKey) {
      const translated = window.WatchlistI18n?.t?.(i18nKey);
      if (translated && translated !== i18nKey) return translated;
      return AGE_RATING_FALLBACK_EN[i18nKey] || trimmed;
    }
    return trimmed;
  }

  function _seasonsBadgeLabel(count) {
    const lang = window.WatchlistI18n?.getLang?.() || "en";
    if (lang === "ar") {
      return `${count} مواسم`;
    }
    return `${count} ${count === 1 ? "season" : "seasons"}`;
  }

  function _episodesBadgeLabel(count) {
    const i18n = window.WatchlistI18n;
    const one = i18n?.t?.("seasons.episodeCountOne");
    const many = i18n?.t?.("seasons.episodeCount", { n: count });
    if (count === 1 && one && one !== "seasons.episodeCountOne") return one;
    if (many && many !== "seasons.episodeCount") return many;
    return `${count} ${count === 1 ? "episode" : "episodes"}`;
  }

  function buildTitleMetaBadges(meta = {}, contentType = "") {
    const badges = [];
    const type = meta.contentType || contentType || "";
    const ageRating = meta.ageRating || "";
    const runtime = meta.runtime || "";
    const seasonCount = parsePositiveInt(meta.seasonCount);
    const episodeCount = parsePositiveInt(meta.episodeCount);
    const episodeDuration = formatEpisodeDurationLabel(runtime);

    if (ageRating) {
      badges.push({
        kind: "age",
        label: formatAgeRatingDisplay(ageRating),
        title: ageRating,
      });
    }

    if (type === "movies") {
      if (runtime) badges.push({ kind: "duration", label: localizeRuntimeLabel(runtime) });
    } else if (type === "tvSeries") {
      if (episodeCount) {
        badges.push({
          kind: "episodes",
          label: _episodesBadgeLabel(episodeCount),
        });
      }
      if (seasonCount) {
        badges.push({
          kind: "seasons",
          label: _seasonsBadgeLabel(seasonCount),
        });
      }
      if (episodeDuration) {
        badges.push({ kind: "duration", label: episodeDuration });
      }
    } else if (type === "anime") {
      const isMovie =
        String(meta.mediaType || meta.omdbType || "").toLowerCase() === "movie";
      if (episodeCount) {
        badges.push({
          kind: "episodes",
          label: _episodesBadgeLabel(episodeCount),
        });
      }
      if (!isMovie) {
        badges.push({
          kind: "seasons",
          label: _seasonsBadgeLabel(seasonCount || 1),
        });
      }
      if (episodeDuration) {
        badges.push({ kind: "duration", label: episodeDuration });
      }
    }

    return badges;
  }

  function formatTitleMetaParts(meta = {}, contentType = "") {
    return buildTitleMetaBadges(meta, contentType).map((badge) => badge.label);
  }

  function applyTitleMetaFromDetails(details, target, contentType = "") {
    if (!details || !target) return;
    const ct = contentType || target.contentType || "";
    if (details.ageRating) target.ageRating = details.ageRating;
    if (details.runtime) target.runtime = details.runtime;
    if (ct === "anime") {
      const fromAnilist =
        details.source === "anilist" ||
        details.anilistId ||
        String(details.link || "").includes("anilist.co");
      if (fromAnilist && details.episodeCount) {
        target.episodeCount = details.episodeCount;
      }
      if (details.seasonCount) {
        target.seasonCount = details.seasonCount;
      } else if (details.mediaType !== "movie" && details.omdbType !== "movie") {
        target.seasonCount = 1;
      }
      return;
    }
    if (details.seasonCount) target.seasonCount = details.seasonCount;
    if (details.episodeCount) target.episodeCount = details.episodeCount;
  }

  function extractLeadCast(details, limit = 5) {
    if (!details) return [];
    let names = [];
    if (Array.isArray(details.actors) && details.actors.length) {
      names = details.actors.map((name) => String(name || "").trim()).filter(Boolean);
    } else if (details.director) {
      names = [String(details.director).trim()].filter(Boolean);
    }
    return [...new Set(names)].slice(0, limit);
  }

  async function enrichLeadCastForItem(item, details = null) {
    if (!item) {
      return { names: [], source: "", provider: "", providerId: null, reason: "no_item" };
    }

    const ct = item.contentType;
    const limit = ct === "anime" ? 4 : 5;

    if (details?.actors?.length) {
      const names = extractLeadCast(details, limit);
      if (names.length) {
        return {
          names,
          source: details.source || "details",
          provider: details.source || "details",
          providerId: details.anilistId || details.tmdbId || details.imdbId || null,
        };
      }
    }

    if (ct === "anime") {
      const anilistId = item.anilistId || details?.anilistId;
      if (anilistId) {
        const full = await fetchAnilistById(anilistId);
        const names = extractLeadCast(full, limit);
        if (names.length) {
          return { names, source: "anilist", provider: "AniList", providerId: anilistId };
        }
        return {
          names: [],
          source: "",
          provider: "AniList",
          providerId: anilistId,
          reason: "anime_voice_cast_unavailable",
        };
      }
      return { names: [], source: "", provider: "", providerId: null, reason: "anime_cast_optional" };
    }

    const tmdbId = item.tmdbId || details?.tmdbId;
    if (tmdbId) {
      const mediaType = ct === "movies" ? "movie" : "tv";
      const tmdb = await fetchTmdbDetails(mediaType, tmdbId);
      const names = extractLeadCast(tmdb, limit);
      if (names.length) {
        return {
          names,
          source: "tmdb_credits",
          provider: "TMDb",
          providerId: `tmdb:${mediaType}:${tmdbId}`,
        };
      }
    }

    const imdbId = item.imdbId || details?.imdbId;
    if (imdbId) {
      const omdb = await getMetadata(imdbId);
      const names = extractLeadCast(omdb, limit);
      if (names.length) {
        return {
          names,
          source: "omdb_actors",
          provider: "OMDb",
          providerId: imdbId,
        };
      }
      if (tmdbId) {
        return {
          names: [],
          source: "",
          provider: "TMDb",
          providerId: `tmdb:${ct === "movies" ? "movie" : "tv"}:${tmdbId}`,
          reason: "tmdb_and_omdb_cast_empty",
        };
      }
      return { names: [], source: "", provider: "OMDb", providerId: imdbId, reason: "omdb_cast_empty" };
    }

    if (tmdbId) {
      return {
        names: [],
        source: "",
        provider: "TMDb",
        providerId: `tmdb:${ct === "movies" ? "movie" : "tv"}:${tmdbId}`,
        reason: "tmdb_credits_empty",
      };
    }

    return { names: [], source: "", provider: "", providerId: null, reason: "no_provider_id" };
  }

  function cachedHasTitleMeta(payload) {
    if (!payload) return false;
    if (payload.ageRating) return true;
    if (payload.runtime) return true;
    if (parsePositiveInt(payload.seasonCount)) return true;
    if (parsePositiveInt(payload.episodeCount)) return true;
    return false;
  }

  function pickBestSearchMatch(results, query) {
    if (!results?.length) return null;
    const key = normalizeTitleKey(query);
    if (!key) return results[0];

    let best = results[0];
    let bestScore = -1;

    for (const result of results) {
      const titleKey = normalizeTitleKey(result.title);
      let score = 0;
      if (titleKey === key) score = 100;
      else if (titleKey.includes(key) || key.includes(titleKey)) score = 50;
      else {
        const words = key.split(" ").filter((word) => word.length > 2);
        score = words.filter((word) => titleKey.includes(word)).length * 10;
      }
      if (score > bestScore) {
        bestScore = score;
        best = result;
      }
    }

    return best;
  }

  function resultDedupeKey(result) {
    return `${normalizeTitleKey(result.title)}::${result.year || ""}`;
  }

  function resultProviderIdentityKey(result) {
    if (result.anilistId) return `anilist:${result.anilistId}`;
    if (result.tmdbId) {
      return `tmdb:${result.tmdbType || "tv"}:${result.tmdbId}`;
    }
    if (result.imdbId) return `imdb:${String(result.imdbId).toLowerCase()}`;
    return `title:${resultDedupeKey(result)}`;
  }

  /**
   * Keep AniList and TMDb as separate search rows — never merge anime into TMDb TV.
   */
  function mergeSearchResults(lists) {
    const byProvider = new Map();

    for (const list of lists) {
      for (const result of list || []) {
        if (!result?.title) continue;
        const key = resultProviderIdentityKey(result);
        if (byProvider.has(key)) continue;
        byProvider.set(key, {
          ...result,
          resultKey: result.resultKey || key,
        });
      }
    }

    return [...byProvider.values()];
  }

  function resolveContentTypeForWatchlistAdd(pick, details, options = {}) {
    const filter = String(options.searchTypeFilter || options.contentType || "").toLowerCase();
    if (filter === "anime") return "anime";
    if (options.contentType === "anime") return "anime";
    if (pick?.displayType === "anime") return "anime";
    if (pick?.anilistId || pick?.source === "anilist") return "anime";
    if (details?.anilistId && !details?.tmdbId) return "anime";
    if (details?.contentType === "anime" || details?.mediaType === "anime") return "anime";
    if (pick?.title || details?.title) {
      const cached = lookupCachedAnilistMatch(pick?.title || details?.title, {
        year: pick?.year ?? details?.year,
      });
      if (cached?.pick?.anilistId) return "anime";
    }
    if (pick && isLikelyAnimeSearchResult(pick)) return "anime";
    if (pick?.tmdbType === "movie" || details?.tmdbType === "movie") return "movies";
    if (
      pick?.tmdbType === "tv" ||
      details?.tmdbType === "tv" ||
      details?.mediaType === "series"
    ) {
      return "tvSeries";
    }
    if (details?.contentType) return details.contentType;
    return "movies";
  }

  function attachAnilistCoverFields(payload, coverImage) {
    if (!payload || !coverImage) return payload;
    payload.coverImageExtraLarge = String(coverImage.extraLarge || "").trim();
    payload.coverImageLarge = String(coverImage.large || "").trim();
    payload.coverImageMedium = String(coverImage.medium || "").trim();
    return payload;
  }

  async function fetchAnilistCoverOnly(anilistId, options = {}) {
    const id = Number(anilistId);
    if (!Number.isFinite(id)) return { payload: null, fetchMeta: { ran: false } };
    const cacheKey = `anilist:cover:${id}`;
    const forceLive = options.forceLive === true || options.bypassCache === true;
    if (!forceLive) {
      const cached = readCached(cacheKey);
      if (cached?.poster && isRawAnilistPosterUrl(cached.poster)) {
        return { payload: cached, fetchMeta: { ran: false, source: "cover_cache" } };
      }
    }

    const query = `query ($id: Int) {
        Media(id: $id, type: ANIME) {
          id
          title { english romaji native }
          startDate { year }
          coverImage { extraLarge large medium }
        }
      }`;
    const meta = await anilistQueryDetailed(query, { id });
    const fetchMeta = {
      ran: true,
      operation: "Media.coverImage",
      httpStatus: meta.httpStatus ?? null,
      ok: Boolean(meta.ok),
      rateLimited: Boolean(meta.rateLimited),
      requestUrl: ANILIST_API,
      requestBody: { query: "Media(id).coverImage", variables: { id } },
    };
    if (!meta.ok) {
      logAnimeCoverFetch({
        title: options.title || "",
        anilistId: id,
        reason: options.reason || "cover_fetch",
        error: meta.errors || meta.httpStatus || meta.message,
        ...fetchMeta,
      });
      return { payload: null, fetchMeta };
    }
    const media = meta.data?.Media;
    const logBase = {
      title: options.title || "",
      anilistId: id,
      reason: options.reason || "cover_fetch",
      coverImageExtraLarge: "",
      coverImageLarge: "",
      coverImageMedium: "",
      selectedPoster: "",
      cacheUpdated: false,
    };
    if (!media) {
      logAnimeCoverFetch({ ...logBase, error: "anilist_query_empty", ...fetchMeta });
      return { payload: null, fetchMeta };
    }
    const poster = pickAnilistCoverUrl(media.coverImage);
    const title =
      media.title?.english || media.title?.romaji || media.title?.native || "";
    const payload = attachAnilistCoverFields(
      {
        source: "anilist",
        anilistId: Number(media.id),
        poster,
        title,
        year: media.startDate?.year ? String(media.startDate.year) : "",
        contentType: "anime",
      },
      media.coverImage
    );
    logAnimeCoverFetch({
      ...logBase,
      title: title || logBase.title,
      coverImageExtraLarge: payload.coverImageExtraLarge || "",
      coverImageLarge: payload.coverImageLarge || "",
      coverImageMedium: payload.coverImageMedium || "",
      selectedPoster: poster || "",
      cacheUpdated: Boolean(poster),
      ...fetchMeta,
    });
    if (!poster) return { payload: null, fetchMeta };
    writeCacheEntry(cacheKey, payload);
    patchAnilistProviderCache(id, payload);
    return { payload, fetchMeta };
  }

  function inspectAnilistProviderCache(anilistId) {
    const id = Number(anilistId);
    const key = `anilist:${id}`;
    const cached = readCached(key) || {};
    return {
      providerCacheKey: key,
      providerCachePoster: cached.poster || "",
      coverImageExtraLarge: cached.coverImageExtraLarge || "",
      coverImageLarge: cached.coverImageLarge || "",
      coverImageMedium: cached.coverImageMedium || "",
      hasUsablePoster: anilistCacheHasUsablePoster(cached),
    };
  }

  async function selectLoadableAnilistPoster(coverPayload, options = {}) {
    if (!coverPayload) return { poster: "", field: "", probeResults: [] };
    const candidates = [
      { field: "extraLarge", url: coverPayload.coverImageExtraLarge },
      { field: "large", url: coverPayload.coverImageLarge },
      { field: "medium", url: coverPayload.coverImageMedium },
      { field: "poster", url: coverPayload.poster },
    ].filter((entry) => isRawAnilistPosterUrl(entry.url));
    const probeResults = [];
    for (const entry of candidates) {
      const loaded = options.skipProbe
        ? true
        : await probePosterImageUrl(entry.url, options.probeTimeoutMs || 8000);
      probeResults.push({ field: entry.field, url: entry.url, loaded });
      if (loaded) {
        return { poster: entry.url, field: entry.field, probeResults };
      }
    }
    return { poster: "", field: "", probeResults };
  }

  async function resolveAnimePosterForBulkCommit(pick, options = {}) {
    const anilistId = Number(pick?.anilistId);
    const title = options.title || pick?.title || "";
    const cacheBefore = inspectAnilistProviderCache(anilistId);
    const rootCause = {
      title,
      importedType: options.importedType || "anime",
      resolvedAnilistId: anilistId,
      providerCacheKey: cacheBefore.providerCacheKey,
      providerCachePosterBefore: cacheBefore.providerCachePoster,
      providerCacheCoverExtraLargeBefore: cacheBefore.coverImageExtraLarge,
      providerCacheCoverLargeBefore: cacheBefore.coverImageLarge,
      providerCacheCoverMediumBefore: cacheBefore.coverImageMedium,
      liveCoverFetchRan: false,
      liveAnilistOperation: "",
      liveAnilistRequestUrl: "",
      liveAnilistResponseStatus: null,
      rawCoverImageExtraLarge: "",
      rawCoverImageLarge: "",
      rawCoverImageMedium: "",
      selectedPosterBeforeFinalBuild: "",
      builderFunction: "buildItemFromSearchDetails",
      failingStage: "",
    };

    const { payload: cover, fetchMeta } = await fetchAnilistCoverOnly(anilistId, {
      title,
      reason: "bulk_commit_cover",
    });
    let resolvedCover = cover;
    let resolvedMeta = fetchMeta;
    if (!cover?.poster && !fetchMeta?.rateLimited) {
      const live = await fetchAnilistCoverOnly(anilistId, {
        forceLive: true,
        bypassCache: true,
        title,
        reason: "bulk_commit_cover_retry",
      });
      if (live.payload?.poster) {
        resolvedCover = live.payload;
        resolvedMeta = live.fetchMeta;
      } else if (live.fetchMeta?.rateLimited) {
        resolvedMeta = live.fetchMeta;
      }
    }
    rootCause.liveCoverFetchRan = Boolean(resolvedMeta?.ran);
    rootCause.liveAnilistOperation = resolvedMeta?.operation || "";
    rootCause.liveAnilistRequestUrl = resolvedMeta?.requestUrl || ANILIST_API;
    rootCause.liveAnilistResponseStatus = resolvedMeta?.httpStatus ?? null;
    if (resolvedCover) {
      rootCause.rawCoverImageExtraLarge = resolvedCover.coverImageExtraLarge || "";
      rootCause.rawCoverImageLarge = resolvedCover.coverImageLarge || "";
      rootCause.rawCoverImageMedium = resolvedCover.coverImageMedium || "";
    }

    const picked = await selectLoadableAnilistPoster(resolvedCover, {
      skipProbe: Boolean(resolvedCover?.poster && !resolvedMeta?.ran),
    });
    rootCause.posterProbeResults = picked.probeResults;
    rootCause.selectedPosterBeforeFinalBuild = picked.poster || "";
    if (!picked.poster) {
      if (!resolvedMeta?.ran) rootCause.failingStage = "A";
      else if (!resolvedCover) rootCause.failingStage = "B";
      else rootCause.failingStage = "G";
    }

    return { cover: resolvedCover, picked, rootCause, fetchMeta: resolvedMeta };
  }

  async function ensureAnimePosterOnDetails(details, options = {}) {
    if (!details) return null;
    const anilistId = Number(
      options.pick?.anilistId || details.anilistId || options.anilistId
    );
    if (!Number.isFinite(anilistId)) return details;

    details.anilistId = anilistId;
    details.source = details.source || "anilist";
    details.contentType = details.contentType || "anime";

    const full = readCached(`anilist:${anilistId}`);
    if (full) {
      attachAnilistCoverFields(details, {
        extraLarge: full.coverImageExtraLarge,
        large: full.coverImageLarge,
        medium: full.coverImageMedium,
      });
    }

    if (isRawAnilistPosterUrl(full?.poster)) {
      applyRawAnilistPosterToDetails(details, full.poster, "provider_cache");
      details.posterPending = false;
      return details;
    }

    const coverFromCacheFields = pickAnilistCoverUrl({
      extraLarge: full?.coverImageExtraLarge,
      large: full?.coverImageLarge,
      medium: full?.coverImageMedium,
    });
    if (isRawAnilistPosterUrl(coverFromCacheFields)) {
      applyRawAnilistPosterToDetails(details, coverFromCacheFields, "provider_cache");
      patchAnilistProviderCache(anilistId, { poster: coverFromCacheFields });
      details.posterPending = false;
      return details;
    }

    const incompleteCache = Boolean(full && !anilistCacheHasUsablePoster(full));
    const bypassCache =
      options.bypassCache === true ||
      options.forceLive === true ||
      incompleteCache;

    if (options.allowCoverFetch !== false) {
      const { payload: cover } = await fetchAnilistCoverOnly(anilistId, {
        forceLive: bypassCache,
        bypassCache,
        title: details.title || options.pick?.title || "",
        reason: incompleteCache
          ? "provider_cache_missing_poster"
          : options.reason || "poster_missing",
      });
      if (cover?.poster) {
        const picked = await selectLoadableAnilistPoster(cover, { skipProbe: false });
        const posterUrl = picked.poster || cover.poster;
        attachAnilistCoverFields(details, {
          extraLarge: cover.coverImageExtraLarge,
          large: cover.coverImageLarge,
          medium: cover.coverImageMedium,
        });
        applyRawAnilistPosterToDetails(details, posterUrl, "anilist_cover_fetch");
        if (!details.title && cover.title) details.title = cover.title;
        if (!details.year && cover.year) details.year = cover.year;
        details.posterPending = false;
        details.posterBroken = false;
        logAnimeCoverFetch({
          title: details.title || options.pick?.title || "",
          anilistId,
          reason: incompleteCache
            ? "provider_cache_missing_poster"
            : "poster_missing",
          coverImageExtraLarge: cover.coverImageExtraLarge || "",
          coverImageLarge: cover.coverImageLarge || "",
          coverImageMedium: cover.coverImageMedium || "",
          selectedPoster: posterUrl,
          cacheUpdated: true,
          importItemMovedToReady: Boolean(options.markReady),
        });
        return details;
      }
    }

    if (isRawAnilistPosterUrl(details.poster) && details.posterSource) {
      details.posterBroken = false;
      details.posterPending = false;
      return details;
    }

    if (!details.poster && options.required) {
      details.posterPending = true;
      details.posterBroken = false;
    } else if (details.poster) {
      details.posterBroken = false;
      details.posterPending = false;
    }

    return details;
  }

  async function resolveAnimeDetailsForWatchlistAdd(pick, options = {}) {
    const trace = options.trace || {};
    trace.awaitedFetchAnilistById = false;
    trace.awaitedEnsureAnimeDetails = false;
    trace.awaitedFetchAnilistCoverOnly = false;

    const anilistId = Number(pick?.anilistId);
    if (!Number.isFinite(anilistId)) {
      return { details: null, trace };
    }

    trace.awaitedFetchAnilistById = true;
    let details = await fetchAnilistById(anilistId, {
      forceLive: options.bypassCache === true || options.forceLive === true,
    });
    if (details) {
      trace.coverImageExtraLarge = details.coverImageExtraLarge || "";
      trace.coverImageLarge = details.coverImageLarge || "";
      trace.coverImageMedium = details.coverImageMedium || "";
    }

    if (!details?.poster) {
      trace.awaitedFetchAnilistCoverOnly = true;
      const { payload: cover } = await fetchAnilistCoverOnly(anilistId, {
        forceLive: true,
        bypassCache: options.bypassCache === true || options.forceLive === true,
        title: pick?.title || details?.title || "",
        reason: "resolve_anime_details",
      });
      if (cover) {
        details = { ...(details || {}), ...cover };
        trace.coverImageExtraLarge = cover.coverImageExtraLarge || "";
        trace.coverImageLarge = cover.coverImageLarge || "";
        trace.coverImageMedium = cover.coverImageMedium || "";
      }
    }

    if (details?.title) {
      trace.awaitedEnsureAnimeDetails = true;
      details = await ensureAnimeDetails(details, {
        pick,
        preferAnime: true,
        forceAnime: true,
      });
      trace.coverImageExtraLarge = details.coverImageExtraLarge || trace.coverImageExtraLarge || "";
      trace.coverImageLarge = details.coverImageLarge || trace.coverImageLarge || "";
      trace.coverImageMedium = details.coverImageMedium || trace.coverImageMedium || "";
    }

    if (details) {
      details = await ensureAnimePosterOnDetails(details, {
        pick,
        required: options.posterRequired === true,
        allowCoverFetch: options.allowCoverFetch !== false,
        bypassCache: options.bypassCache === true || options.forceLive === true,
        forceLive: options.bypassCache === true || options.forceLive === true,
      });
    }

    return { details, trace };
  }

  async function resolveDetailsForWatchlistAdd(pick, contentType, options = {}) {
    if (!pick) return null;
    const resolvedType = resolveContentTypeForWatchlistAdd(pick, null, {
      ...options,
      contentType,
    });
    const preferAnime = resolvedType === "anime";
    let details = null;
    const trace = options.trace || null;

    if (preferAnime && pick.anilistId) {
      if (trace) trace.awaitedResolveDetailsForWatchlistAdd = true;
      const animeResolved = await resolveAnimeDetailsForWatchlistAdd(pick, options);
      details = animeResolved.details;
      if (trace) Object.assign(trace, animeResolved.trace);
    } else {
      details = await getDetailsForPick(pick, {
        searchQuery: options.searchQuery || pick.title || "",
        preferAnime,
      });
      if (!details?.title && preferAnime && pick.title) {
        const match = await fetchAnilistMatchByTitle(pick.title, pick.year);
        if (match?.anilistId) {
          details = await fetchAnilistById(match.anilistId);
        }
      }
      if (preferAnime && details?.title) {
        if (trace) trace.awaitedEnsureAnimeDetails = true;
        details = await ensureAnimeDetails(details, {
          pick,
          preferAnime: true,
          forceAnime: true,
        });
      }
      if (preferAnime && details) {
        details = await ensureAnimePosterOnDetails(details, {
          pick,
          required: options.posterRequired === true,
          allowCoverFetch: options.allowCoverFetch !== false,
        });
        details.contentType = "anime";
        if (details.poster) details.posterBroken = false;
      } else if (details?.poster) {
        details.poster = upgradePosterForStorage(details.poster, details);
        details.posterBroken = false;
      }
    }

    if (preferAnime && details) {
      details.contentType = "anime";
      if (!details.poster && options.posterRequired) {
        details = await ensureAnimePosterOnDetails(details, {
          pick,
          required: true,
          bypassCache: true,
          forceLive: true,
          reason: "poster_required_final",
        });
      }
      if (options.verifyPoster === true && details.poster) {
        const verified = await verifyAnimePosterForSave(details);
        if (!verified.ok && options.posterRequired) {
          const { payload: refetched } = await fetchAnilistCoverOnly(
            details.anilistId || pick?.anilistId,
            {
              forceLive: true,
              bypassCache: true,
              title: details.title || pick?.title,
              reason: "image_probe_retry",
            }
          );
          if (refetched?.poster) {
            const picked = await selectLoadableAnilistPoster(refetched);
            const posterUrl = picked.poster || refetched.poster;
            applyRawAnilistPosterToDetails(
              details,
              posterUrl,
              "anilist_cover_fetch"
            );
            attachAnilistCoverFields(details, {
              extraLarge: refetched.coverImageExtraLarge,
              large: refetched.coverImageLarge,
              medium: refetched.coverImageMedium,
            });
            details.posterPending = false;
          } else {
            details.posterPending = true;
            details.poster = "";
          }
        }
        if (trace) {
          trace.posterVerified = Boolean(verified.verified || details.poster);
          trace.posterVerifyReason = verified.reason;
        }
      } else if (details.poster) {
        details.posterPending = false;
        details.posterBroken = false;
      }
    }

    logBulkVsSearchBuild(options.pipeline || "resolve", {
      title: details?.title || pick?.title || "",
      type: resolvedType,
      provider: details?.source || pick?.source || "",
      anilistId: details?.anilistId || pick?.anilistId || null,
      link: details?.link || pick?.link || "",
      poster: details?.poster || "",
      posterBroken: Boolean(details?.posterBroken),
      posterPending: Boolean(details?.posterPending),
      posterSource: details?.posterSource || "",
      detailsSource: details?.source || "",
      coverImageExtraLarge: details?.coverImageExtraLarge || "",
      coverImageLarge: details?.coverImageLarge || "",
      coverImageMedium: details?.coverImageMedium || "",
    });
    return details;
  }

  async function anilistQueryDetailed(query, variables) {
    return runAnilistBulkScheduled(async () => {
    try {
      await waitForAnilistGate();
      const response = await fetch(ANILIST_API, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ query, variables }),
      });
      const retryAfter = response.headers.get("Retry-After");
      const rateLimitReset = parseAnilistRateLimitReset(response);
      let json;
      try {
        json = await response.json();
      } catch {
        json = {};
      }
      const rateLimited = response.status === 429;
      const transient =
        rateLimited ||
        response.status >= 500 ||
        response.status === 408;
      if (rateLimited) {
        noteAnilistRateLimit(retryAfter, rateLimitReset);
        return {
          ok: false,
          transient: true,
          rateLimited: true,
          httpStatus: 429,
          retryAfter,
          rateLimitReset,
          errors: json.errors || [],
        };
      }
      if (transient) {
        return {
          ok: false,
          transient: true,
          httpStatus: response.status,
          errors: json.errors || [],
        };
      }
      if (!response.ok || json.errors?.length) {
        return {
          ok: false,
          transient: false,
          httpStatus: response.status,
          errors: json.errors || [],
        };
      }
      return { ok: true, data: json.data, httpStatus: response.status };
    } catch (error) {
      // Network/CORS failures are not rate limits — don't pause AniList for 90s.
      return {
        ok: false,
        transient: true,
        networkError: true,
        message: String(error?.message || error),
      };
    }
    });
  }

  async function anilistQuery(query, variables) {
    const meta = await anilistQueryDetailed(query, variables);
    if (!meta.ok) {
      console.warn("[anilist] query failed:", meta.errors || meta.httpStatus || meta.message);
      return null;
    }
    return meta.data;
  }

  let anilistBulkChain = Promise.resolve();
  let anilistBulkLastAt = 0;
  const ANILIST_BULK_GAP_MS = 1200;
  let anilistGlobalPauseUntil = 0;

  function parseAnilistRateLimitReset(response) {
    if (!response?.headers) return 0;
    const raw = response.headers.get("X-RateLimit-Reset");
    if (!raw) return 0;
    const n = parseInt(String(raw), 10);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return n > 1e12 ? n : n * 1000;
  }

  function noteAnilistRateLimit(retryAfterHeader, resetMs) {
    const now = Date.now();
    let until = now + 30000;
    if (retryAfterHeader) {
      const sec = parseInt(String(retryAfterHeader), 10);
      if (sec > 0) until = Math.max(until, now + Math.min(sec, 90) * 1000);
    }
    if (resetMs > now) until = Math.max(until, Math.min(resetMs, now + 90000));
    // Never stack pauses beyond 90s from now — avoids multi-minute freezes.
    anilistGlobalPauseUntil = Math.min(
      Math.max(anilistGlobalPauseUntil, until),
      now + 90000
    );
  }

  function clearAnilistRateLimitPause() {
    anilistGlobalPauseUntil = 0;
    // Break a deadlocked schedule chain so new AniList calls can run again.
    anilistBulkChain = Promise.resolve();
    anilistBulkLastAt = 0;
  }

  async function waitForAnilistGate() {
    const now = Date.now();
    if (anilistGlobalPauseUntil > now) {
      await sleepMs(Math.min(anilistGlobalPauseUntil - now, 90000));
    }
  }

  function getAnilistQueueStatus() {
    const now = Date.now();
    if (anilistGlobalPauseUntil > now) {
      return { paused: true, resumeAt: anilistGlobalPauseUntil };
    }
    return { paused: false, resumeAt: 0 };
  }

  function normalizeTitleForCacheLookup(text) {
    return String(text || "")
      .toLowerCase()
      .replace(/[''`]/g, "")
      .replace(/[^\w\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function lookupCachedAnilistMatch(title, options = {}) {
    const passes = (options.searchPasses || [String(title || "").trim()]).filter(Boolean);
    // Only scan the in-memory Map (capped). Never JSON.parse the entire
    // localStorage cache and walk every key per title — that was O(cache×titles).
    for (const pass of passes) {
      const norm = normalizeTitleForCacheLookup(pass);
      if (!norm) continue;
      for (const [key, entry] of memory.entries()) {
        if (!key.startsWith("anilist:") || !entry?.anilistId) continue;
        const variants = [
          entry.title,
          entry.titleEnglish,
          entry.titleRomaji,
          entry.titleNative,
        ].filter(Boolean);
        for (const variant of variants) {
          if (normalizeTitleForCacheLookup(variant) === norm) {
            return {
              pick: {
                source: "anilist",
                anilistId: entry.anilistId,
                title: entry.title || variant,
                titleEnglish: entry.titleEnglish,
                titleRomaji: entry.titleRomaji,
                poster: entry.poster,
                year: entry.year,
                genres: entry.genres || [],
              },
              details: entry,
            };
          }
        }
      }
    }
    return null;
  }

  async function invokeAnimeIndexSearch(body) {
    const sb = window.WatchlistAuth?.getSupabase?.();
    if (!sb?.functions?.invoke) return null;
    try {
      const { data, error } = await sb.functions.invoke("anime-index-search", { body });
      if (error) {
        console.warn("[anime-index-search]", error.message || error);
        return null;
      }
      return data;
    } catch (err) {
      console.warn("[anime-index-search]", err);
      return null;
    }
  }

  // --- title_provider_cache -------------------------------------------
  // Shared, app-owned cache of AniList details we've already collected for
  // a title (poster + genres/age/episodes/duration), keyed by
  // `provider`/`provider_id` (e.g. "anilist"/12345). Separate from the
  // licensed manami `anime_title_index` dump — see
  // docs/ANIME-DATA-LICENSE.md — so it's safe to write our own live AniList
  // fields here. Checking this before a live AniList call lets a bulk
  // import (or a different user's import later) skip AniList entirely for
  // titles someone has already resolved. Every function here fails open —
  // a missing table/policy or a network hiccup just means "no cache hit",
  // never a broken import.
  const TITLE_PROVIDER_CACHE_TABLE = "title_provider_cache";

  function titleProviderCacheRowToHit(row) {
    if (!row) return null;
    const payload = row.payload && typeof row.payload === "object" ? row.payload : {};
    return {
      title: row.display_title || payload.title || "",
      poster: row.poster || payload.poster || "",
      year: row.year || payload.year || "",
      genres: Array.isArray(payload.genres) ? payload.genres : [],
      ageRating: payload.ageRating || "",
      episodeCount: payload.episodeCount || null,
      seasonCount: payload.seasonCount || null,
      runtime: payload.runtime || "",
      imdbRating: payload.imdbRating || "",
    };
  }

  /** One query for a whole bulk-import batch instead of one per title. */
  async function fetchTitleProviderCacheBatch(provider, providerIds) {
    const ids = [
      ...new Set((providerIds || []).map((id) => String(id).trim()).filter(Boolean)),
    ];
    if (!ids.length) return null;
    const sb = window.WatchlistAuth?.getSupabase?.();
    if (!sb?.from) return null;
    try {
      const { data, error } = await sb
        .from(TITLE_PROVIDER_CACHE_TABLE)
        .select("provider_id, display_title, poster, year, payload")
        .eq("provider", provider)
        .in("provider_id", ids);
      if (error || !data) return null;
      const map = new Map();
      for (const row of data) {
        const hit = titleProviderCacheRowToHit(row);
        if (hit) map.set(String(row.provider_id), hit);
      }
      return map;
    } catch (err) {
      console.warn("[title-provider-cache] batch read failed:", err);
      return null;
    }
  }

  async function fetchTitleProviderCacheEntry(provider, providerId) {
    const id = String(providerId || "").trim();
    if (!id) return null;
    const sb = window.WatchlistAuth?.getSupabase?.();
    if (!sb?.from) return null;
    try {
      const { data, error } = await sb
        .from(TITLE_PROVIDER_CACHE_TABLE)
        .select("provider_id, display_title, poster, year, payload")
        .eq("provider", provider)
        .eq("provider_id", id)
        .maybeSingle();
      if (error || !data) return null;
      return titleProviderCacheRowToHit(data);
    } catch (err) {
      console.warn("[title-provider-cache] read failed:", err);
      return null;
    }
  }

  /** Fire-and-forget: save whatever we've collected so far so the next
   * lookup (this import or a future one) gets a richer hit. Safe to call
   * more than once for the same title as more fields arrive — later calls
   * simply overwrite with a fuller snapshot. */
  async function upsertTitleProviderCacheEntry(provider, providerId, snapshot) {
    const id = String(providerId || "").trim();
    if (!id || !snapshot?.title) return false;
    const sb = window.WatchlistAuth?.getSupabase?.();
    if (!sb?.from) return false;
    try {
      const { error } = await sb.from(TITLE_PROVIDER_CACHE_TABLE).upsert(
        {
          provider,
          provider_id: id,
          canonical_title: normalizeTitleForCacheLookup(snapshot.title),
          display_title: snapshot.title,
          year: String(snapshot.year || ""),
          content_type: snapshot.contentType || "anime",
          poster: snapshot.poster || "",
          payload: {
            title: snapshot.title,
            poster: snapshot.poster || "",
            year: snapshot.year || "",
            genres: snapshot.genres || [],
            ageRating: snapshot.ageRating || "",
            episodeCount: snapshot.episodeCount || null,
            seasonCount: snapshot.seasonCount || null,
            runtime: snapshot.runtime || "",
            imdbRating: snapshot.imdbRating || "",
          },
          updated_at: new Date().toISOString(),
        },
        { onConflict: "provider,provider_id" }
      );
      if (error) {
        console.warn("[title-provider-cache] upsert failed:", error.message || error);
        return false;
      }
      return true;
    } catch (err) {
      console.warn("[title-provider-cache] upsert failed:", err);
      return false;
    }
  }

  const offlineSearchCache = new Map();
  const OFFLINE_SEARCH_CACHE_MAX = 800;

  function offlineSearchCacheKey(title, options = {}) {
    const norm = normalizeTitleForCacheLookup(title);
    const year = options.year ?? "";
    const passes = (options.searchPasses || []).slice(0, 4).join("|");
    return `${norm}::${year}::${passes}`;
  }

  function rememberOfflineSearch(key, value) {
    if (offlineSearchCache.size >= OFFLINE_SEARCH_CACHE_MAX) {
      const first = offlineSearchCache.keys().next().value;
      offlineSearchCache.delete(first);
    }
    offlineSearchCache.set(key, value);
  }

  function mapOfflineIndexHit(hit) {
    if (!hit?.anilist_id && !hit?.anilistId) return null;
    const anilistId = hit.anilist_id || hit.anilistId;
    return {
      source: "anilist",
      anilistId,
      format: hit.format || "",
      title:
        hit.english_title ||
        hit.canonical_title ||
        hit.titleEnglish ||
        hit.titleRomaji ||
        hit.title ||
        "",
      titleEnglish: hit.english_title || hit.titleEnglish || "",
      titleRomaji: hit.romaji_title || hit.titleRomaji || "",
      titleNative: hit.native_title || hit.titleNative || "",
      synonyms: hit.synonyms || [],
      year: hit.start_year ? String(hit.start_year) : hit.year ? String(hit.year) : "",
      type: "anime",
      poster: String(hit.poster || hit.picture_url || "").trim(),
      offlineScore: hit.score ?? hit.offlineScore ?? null,
      offlineReason: hit.matchReason || hit.offlineReason || "",
      resultKey: `anilist:${anilistId}`,
    };
  }

  function mapOfflineSearchResponse(data) {
    if (!data?.ok) return { ok: false, results: [], pick: null };
    const results = (data.results || data.candidates || [])
      .map(mapOfflineIndexHit)
      .filter(Boolean);
    const rawPick = data.pick ? mapOfflineIndexHit(data.pick) : null;
    const pick = rawPick?.anilistId ? rawPick : null;
    return {
      ok: true,
      results,
      pick,
      autoReason: data.autoReason || pick?.offlineReason || "",
      needsAnilistFallback: Boolean(data.autoReason === "low_confidence" || (rawPick && !rawPick.anilistId)),
    };
  }

  async function searchAnimeOfflineIndex(title, options = {}) {
    const cacheKey = offlineSearchCacheKey(title, options);
    if (offlineSearchCache.has(cacheKey)) {
      return offlineSearchCache.get(cacheKey);
    }
    const data = await invokeAnimeIndexSearch({
      action: "search",
      title: String(title || "").trim(),
      year: options.year ?? null,
      passes: options.searchPasses || [],
      limit: 15,
    });
    const mapped = mapOfflineSearchResponse(data);
    rememberOfflineSearch(cacheKey, mapped);
    return mapped;
  }

  async function searchAnimeOfflineBatch(requests) {
    const out = new Map();
    const list = (requests || []).filter((r) => r?.id);
    if (!list.length) return out;

    const pending = [];
    for (const req of list) {
      const cacheKey = offlineSearchCacheKey(req.title, {
        year: req.year,
        searchPasses: req.searchPasses,
      });
      if (offlineSearchCache.has(cacheKey)) {
        out.set(req.id, offlineSearchCache.get(cacheKey));
      } else {
        pending.push(req);
      }
    }

    if (pending.length) {
      const data = await invokeAnimeIndexSearch({
        action: "batchSearch",
        requests: pending.map((req) => ({
          id: req.id,
          title: req.title,
          year: req.year ?? null,
          passes: req.searchPasses || [],
        })),
        limit: 15,
      });

      for (const req of pending) {
        const block = data?.resultsById?.[req.id];
        const mapped = mapOfflineSearchResponse(block || { ok: false });
        const cacheKey = offlineSearchCacheKey(req.title, {
          year: req.year,
          searchPasses: req.searchPasses,
        });
        rememberOfflineSearch(cacheKey, mapped);
        out.set(req.id, mapped);
      }
    }

    for (const req of list) {
      if (!out.has(req.id)) {
        out.set(req.id, { ok: false, results: [], pick: null });
      }
    }
    return out;
  }

  async function fetchAnimeIndexMeta() {
    return invokeAnimeIndexSearch({ action: "meta" });
  }

  function sleepMs(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function runAnilistBulkScheduled(fn) {
    const run = async () => {
      const wait = Math.max(0, ANILIST_BULK_GAP_MS - (Date.now() - anilistBulkLastAt));
      if (wait) await sleepMs(wait);
      anilistBulkLastAt = Date.now();
      return fn();
    };
    const scheduled = anilistBulkChain.then(run, run);
    anilistBulkChain = scheduled.catch(() => {});
    return scheduled;
  }

  const ANILIST_BULK_SEARCH_QUERY = `query ($search: String, $page: Int) {
    Page(page: $page, perPage: 15) {
      media(search: $search, type: ANIME, sort: SEARCH_MATCH) {
        id
        format
        title { romaji english native }
        synonyms
        genres
        startDate { year }
        coverImage { extraLarge large medium }
        averageScore
      }
    }
  }`;

  function mapAnilistBulkSearchMedia(media) {
    const format = String(media.format || "").toUpperCase();
    const titleEnglish = media.title?.english || "";
    const titleRomaji = media.title?.romaji || "";
    const titleNative = media.title?.native || "";
    const displayTitle = titleEnglish || titleRomaji || titleNative || "";
    return {
      source: "anilist",
      anilistId: media.id,
      format,
      title: displayTitle,
      titleEnglish,
      titleRomaji,
      titleNative,
      synonyms: media.synonyms || [],
      genres: media.genres || [],
      year: media.startDate?.year ? String(media.startDate.year) : "",
      type: "anime",
      poster: pickAnilistCoverUrl(media.coverImage) || "",
      averageScore: media.averageScore ?? null,
      anilistRating: media.averageScore != null ? String(media.averageScore) : "",
      resultKey: `anilist:${media.id}`,
    };
  }

  function getCachedDetailsForPick(pick) {
    if (!pick) return null;
    if (pick.anilistId) {
      const cached = ensureAnilistRating(readCached(`anilist:${pick.anilistId}`));
      if (cached?.title) return cached;
    }
    if (pick.imdbId) {
      const cached = readCached(`omdb:${pick.imdbId}`);
      if (cached?.title) return cached;
    }
    if (pick.tmdbId && pick.tmdbType) {
      const cached = readCached(`tmdb:${pick.tmdbType}:${pick.tmdbId}`);
      if (cached?.title) return cached;
    }
    return null;
  }

  function buildLightweightDetailsFromSearchResult(pick, contentType) {
    if (!pick) return null;

    const cached = getCachedDetailsForPick(pick);
    if (cached?.title) {
      const out = { ...cached, enrichmentDeferred: !cached.plot };
      if (out.poster && (pick.anilistId || pick.source === "anilist" || out.anilistId)) {
        out.poster = String(out.poster).trim();
      } else if (out.poster) {
        out.poster = upgradePosterForStorage(out.poster, out);
      }
      return out;
    }

    if (pick.anilistId || pick.source === "anilist") {
      const title =
        pick.title ||
        pick.titleEnglish ||
        pick.titleRomaji ||
        pick.titleNative ||
        "";
      return buildDetailPayload({
        source: "anilist",
        anilistId: pick.anilistId,
        title,
        year: pick.year || "",
        poster: String(pick.poster || "").trim(),
        anilistRating:
          pick.anilistRating ||
          (pick.averageScore != null ? String(pick.averageScore) : ""),
        genres: pick.genres || [],
        plot: "",
        mediaType: "anime",
        omdbType: "anime",
        contentType: "anime",
        seasonCount: 1,
      });
    }

    if (pick.tmdbId) {
      const isTv = pick.tmdbType === "tv" || pick.type === "series";
      return buildDetailPayload({
        source: "tmdb",
        tmdbId: pick.tmdbId,
        tmdbType: pick.tmdbType || (isTv ? "tv" : "movie"),
        imdbId: pick.imdbId || null,
        title: pick.title || "",
        year: pick.year || "",
        poster: upgradePosterForStorage(pick.poster || "", { source: "tmdb", tmdbId: pick.tmdbId }),
        rating: pick.rating || "",
        genres: pick.genres || [],
        plot: "",
        mediaType: isTv ? "series" : "movie",
        omdbType: isTv ? "series" : "movie",
        contentType: contentType || (isTv ? "tvSeries" : "movies"),
      });
    }

    if (pick.imdbId) {
      return buildDetailPayload({
        source: "omdb",
        imdbId: pick.imdbId,
        title: pick.title || "",
        year: pick.year || "",
        poster: pick.poster || "",
        rating: pick.rating || "",
        genres: pick.genres || [],
        plot: "",
        mediaType: pick.type === "series" ? "series" : "movie",
        omdbType: pick.type === "series" ? "series" : "movie",
        contentType:
          contentType ||
          (pick.type === "series" ? "tvSeries" : "movies"),
      });
    }

    return null;
  }

  function getLightweightDetailsForPick(pick, options = {}) {
    const contentType = options.contentType || inferContentType(pick.type, pick.genres);
    const details = buildLightweightDetailsFromSearchResult(pick, contentType);
    if (!details?.title) return null;
    details.enrichmentDeferred = !details.plot;
    return details;
  }

  function cacheResolvedPreview(pick, details) {
    if (!pick || !details?.title) return;
    if (pick.anilistId) {
      const key = `anilist:${pick.anilistId}`;
      const existing = readCached(key) || {};
      const merged = {
        ...existing,
        ...details,
        anilistId: pick.anilistId,
      };
      if (!isRawAnilistPosterUrl(details?.poster) && isRawAnilistPosterUrl(existing?.poster)) {
        merged.poster = existing.poster;
      }
      if (
        !isRawAnilistPosterUrl(details?.cardPoster) &&
        isRawAnilistPosterUrl(existing?.cardPoster || existing?.poster)
      ) {
        merged.cardPoster = existing.cardPoster || existing.poster;
      }
      if (!details?.coverImageExtraLarge && existing?.coverImageExtraLarge) {
        merged.coverImageExtraLarge = existing.coverImageExtraLarge;
      }
      if (!details?.coverImageLarge && existing?.coverImageLarge) {
        merged.coverImageLarge = existing.coverImageLarge;
      }
      if (!details?.coverImageMedium && existing?.coverImageMedium) {
        merged.coverImageMedium = existing.coverImageMedium;
      }
      writeCacheEntry(key, merged);
      return;
    }
    if (pick.imdbId) {
      const key = `omdb:${pick.imdbId}`;
      const existing = readCached(key) || {};
      writeCacheEntry(key, { ...existing, ...details, imdbId: pick.imdbId });
      return;
    }
    if (pick.tmdbId && pick.tmdbType) {
      const key = `tmdb:${pick.tmdbType}:${pick.tmdbId}`;
      const existing = readCached(key) || {};
      writeCacheEntry(key, {
        ...existing,
        ...details,
        tmdbId: pick.tmdbId,
        tmdbType: pick.tmdbType,
      });
    }
  }

  async function searchAnilistBulkBatch(requests, options = {}) {
    const batchSize = Math.min(5, Math.max(1, Number(options.batchSize) || 5));
    const out = new Map();
    const list = (requests || []).filter((r) => r?.id);
    if (!list.length) return out;

    for (let offset = 0; offset < list.length; offset += batchSize) {
      const chunk = list.slice(offset, offset + batchSize);
      const varDecl = [];
      const varUse = [];
      const body = [];

      chunk.forEach((req, idx) => {
        const term = String(
          req.searchTerm || req.searchPasses?.[0] || req.title || ""
        ).trim();
        const vName = `search${idx}`;
        varDecl.push(`$${vName}: String`);
        varUse.push(`${vName}: $${vName}`);
        body.push(
          `s${idx}: Page(page: 1, perPage: 15) {
            media(search: $${vName}, type: ANIME, sort: SEARCH_MATCH) {
              id
              format
              title { romaji english native }
              synonyms
              genres
              startDate { year }
              coverImage { extraLarge large medium }
              averageScore
            }
          }`
        );
        req._batchTerm = term;
      });

      const query = `query BatchAnilistSearch(${varDecl.join(", ")}) { ${body.join("\n")} }`;
      const variables = {};
      chunk.forEach((req, idx) => {
        variables[`search${idx}`] = req._batchTerm;
      });

      const meta = await anilistQueryDetailed(query, variables);

      if (meta.transient) {
        for (const req of chunk) {
          out.set(req.id, {
            ok: false,
            transient: true,
            rateLimited: Boolean(meta.rateLimited),
            retryAfter: meta.retryAfter,
            httpStatus: meta.httpStatus,
            errors: meta.errors,
            results: [],
          });
        }
        continue;
      }

      chunk.forEach((req, idx) => {
        const mediaList = meta.data?.[`s${idx}`]?.media || [];
        const results = [];
        const seen = new Set();
        for (const media of mediaList) {
          const mapped = mapAnilistBulkSearchMedia(media);
          if (!seen.has(mapped.anilistId)) {
            seen.add(mapped.anilistId);
            results.push(mapped);
          }
        }
        out.set(req.id, {
          ok: true,
          transient: false,
          results,
          httpStatus: meta.httpStatus,
        });
      });
      // Don't retain the full GraphQL batch payload after mapping results.
    }

    return out;
  }

  async function searchAnilistForBulkImport(title, options = {}) {
    const passes = (options.searchPasses || [String(title || "").trim()]).filter(
      (p) => String(p).trim().length >= 2
    );
    const byId = new Map();
    let lastMeta = null;

    for (const searchTerm of passes) {
      const meta = await anilistQueryDetailed(ANILIST_BULK_SEARCH_QUERY, {
        search: searchTerm,
        page: 1,
      });
      lastMeta = meta;

      if (meta.transient) {
        return {
          ok: false,
          transient: true,
          rateLimited: Boolean(meta.rateLimited),
          retryAfter: meta.retryAfter,
          httpStatus: meta.httpStatus,
          errors: meta.errors,
          searchTerm,
          results: [],
        };
      }
      if (!meta.ok) continue;

      for (const media of meta.data?.Page?.media || []) {
        const mapped = mapAnilistBulkSearchMedia(media);
        if (!byId.has(mapped.anilistId)) byId.set(mapped.anilistId, mapped);
      }
    }

    return {
      ok: true,
      transient: false,
      results: [...byId.values()],
      meta: lastMeta,
    };
  }

  function normalizeAnilistMedia(media) {
    if (!media) return null;

    const title =
      media.title?.english ||
      media.title?.romaji ||
      media.title?.native ||
      "";
    const leads = [];
    for (const node of media.characters?.nodes || []) {
      const va = node.voiceActors?.[0]?.name?.full;
      if (va) leads.push(va);
      else if (node.name?.full) leads.push(node.name.full);
      if (leads.length >= 4) break;
    }

    const format = String(media.format || "").toUpperCase();
    const mediaType =
      format === "MOVIE" || format === "ONE_SHOT" ? "movie" : "anime";
    const isAnimeSeries = mediaType === "anime";

    const payload = buildDetailPayload({
      source: "anilist",
      anilistId: media.id,
      link: `https://anilist.co/anime/${media.id}/`,
      title,
      year: media.startDate?.year ? String(media.startDate.year) : "",
      plot: stripHtml(media.description),
      poster: pickAnilistCoverUrl(media.coverImage) || "",
      anilistRating:
        media.averageScore != null ? String(media.averageScore) : "",
      actors: leads,
      genres: media.genres || [],
      mediaType,
      omdbType: mediaType,
      contentType: mediaType === "movie" ? "movies" : "anime",
      ageRating: media.isAdult ? "18+" : "",
      runtime: media.duration ? formatRuntimeMinutes(media.duration) : "",
      episodeCount: parsePositiveInt(media.episodes),
      seasonCount: isAnimeSeries ? 1 : null,
    });
    return attachAnilistCoverFields(payload, media.coverImage);
  }

  /**
   * For anime, use AniList metadata (poster, seasons via sequels, episode total).
   * Replaces TMDB/IMDb picks when searching or confirming as anime.
   */
  async function ensureAnimeDetails(details, options = {}) {
    if (!details?.title) return details;
    const force =
      options.forceAnime === true ||
      options.preferAnime === true ||
      details.contentType === "anime" ||
      details.mediaType === "anime";

    if (!force && !options.pick?.anilistId && !details.anilistId) {
      return details;
    }

    let anilistId =
      options.pick?.anilistId || details.anilistId || null;

    if (!anilistId) {
      const match = await fetchAnilistMatchByTitle(details.title, details.year);
      anilistId = match?.anilistId || null;
    }

    if (!anilistId) {
      return {
        ...details,
        contentType: "anime",
        seasonCount: details.seasonCount || 1,
      };
    }

    const anilist = await fetchAnilistById(anilistId);
    if (!anilist) return details;

    let imdbId = details.imdbId || null;
    if (!imdbId && window.WatchlistSeriesMetadata?.resolveLinkedImdbId) {
      imdbId = await window.WatchlistSeriesMetadata.resolveLinkedImdbId({
        anilistId: Number(anilistId),
      });
    }

    let imdbRating = details.rating || details.imdbRating || "";
    if (imdbId && !imdbRating && hasOmdbKey()) {
      const omdb = await getMetadata(imdbId);
      if (omdb?.rating) imdbRating = omdb.rating;
    }

    const isMovie =
      anilist.mediaType === "movie" ||
      String(anilist.omdbType || "").toLowerCase() === "movie";

    let seasonCount = isMovie ? null : 1;
    let episodeCount = anilist.episodeCount || details.episodeCount || null;
    if (!isMovie && window.WatchlistSeriesMetadata?.fetchTitleSeriesCounts) {
      const locale = window.WatchlistI18n?.getLang?.() || "en";
      const counts = await window.WatchlistSeriesMetadata.fetchTitleSeriesCounts(
        {
          contentType: "anime",
          link: `https://anilist.co/anime/${anilistId}/`,
          poster: anilist.poster || details.poster || "",
        },
        locale
      );
      if (counts?.seasonCount > 0) seasonCount = counts.seasonCount;
      if (counts?.episodeCount > 0) episodeCount = counts.episodeCount;
    }

    return {
      ...anilist,
      imdbId,
      rating: imdbRating,
      contentType: isMovie ? "movies" : "anime",
      seasonCount,
      episodeCount,
      title: details.title || anilist.title,
      plot: anilist.plot || details.plot,
    };
  }

  async function fetchAnilistById(anilistId, options = {}) {
    const cacheKey = `anilist:${anilistId}`;
    const cached = ensureAnilistRating(readCached(cacheKey));
    const forceLive = options.forceLive === true || options.bypassCache === true;
    if (cached && anilistCacheHasUsablePoster(cached) && !forceLive) {
      return cached;
    }

    const data = await anilistQuery(
      `query ($id: Int) {
        Media(id: $id, type: ANIME) {
          id
          format
          title { romaji english native }
          description(asHtml: false)
          genres
          averageScore
          startDate { year }
          coverImage { extraLarge large medium }
          episodes
          duration
          isAdult
          characters(perPage: 6, role: MAIN) {
            nodes {
              name { full }
            }
          }
        }
      }`,
      { id: Number(anilistId) }
    );

    const payload = ensureAnilistRating(normalizeAnilistMedia(data?.Media));
    if (payload) writeCacheEntry(cacheKey, payload);
    return payload;
  }

  async function fetchAnilistByMalId(malId) {
    const cacheKey = `mal:${malId}`;
    const cached = ensureAnilistRating(readCached(cacheKey));
    if (cached) return cached;

    const data = await anilistQuery(
      `query ($malId: Int) {
        Media(idMal: $malId, type: ANIME) {
          id
          format
          title { romaji english native }
          description(asHtml: false)
          genres
          averageScore
          startDate { year }
          coverImage { extraLarge large medium }
          episodes
          duration
          isAdult
          characters(perPage: 6, role: MAIN) {
            nodes {
              name { full }
            }
          }
        }
      }`,
      { malId: Number(malId) }
    );

    const payload = ensureAnilistRating(normalizeAnilistMedia(data?.Media));
    if (payload) writeCacheEntry(cacheKey, payload);
    return payload;
  }

  async function fetchAnilistMatchByTitle(title, year) {
    const query = String(title || "").trim();
    if (query.length < 2) return null;

    const data = await anilistQuery(
      `query ($search: String) {
        Page(page: 1, perPage: 8) {
          media(search: $search, type: ANIME, sort: SEARCH_MATCH) {
            id
            title { english romaji }
            averageScore
            startDate { year }
          }
        }
      }`,
      { search: query }
    );

    const media = data?.Page?.media || [];
    if (!media.length) return null;

    const results = media.map((entry) => ({
      anilistId: entry.id,
      title: entry.title?.english || entry.title?.romaji || "",
      year: entry.startDate?.year ? String(entry.startDate.year) : "",
      averageScore: entry.averageScore,
    }));

    let match = pickBestSearchMatch(results, query);
    const yearStr = year ? String(year).trim() : "";
    if (yearStr) {
      const yearMatch = results.find((entry) => entry.year === yearStr);
      if (yearMatch) match = yearMatch;
    }

    if (!match) return null;
    return {
      source: "anilist",
      anilistId: match.anilistId,
      year: match.year || "",
      anilistRating:
        match.averageScore == null ? "" : String(match.averageScore),
    };
  }

  async function fetchAnilistByTitleMatch(title, year) {
    const match = await fetchAnilistMatchByTitle(title, year);
    if (!match) return null;
    return {
      source: "anilist",
      anilistRating: match.anilistRating || "",
      year: match.year || "",
    };
  }

  async function fetchAnilistScoreByTitle(title, year) {
    const match = await fetchAnilistMatchByTitle(title, year);
    if (!match?.anilistRating) return null;
    return match.anilistRating;
  }

  async function searchAnilist(query, page = 1) {
    const data = await anilistQuery(
      `query ($search: String, $page: Int) {
        Page(page: $page, perPage: 10) {
          media(search: $search, type: ANIME, sort: SEARCH_MATCH) {
            id
            format
            title { romaji english }
            startDate { year }
            coverImage { extraLarge large medium }
          }
        }
      }`,
      { search: query, page }
    );

    return (data?.Page?.media || []).map((media) => {
      const format = String(media.format || "").toUpperCase();
      const isFilm = format === "MOVIE" || format === "ONE_SHOT";
      return {
        source: "anilist",
        anilistId: media.id,
        imdbId: null,
        tmdbType: null,
        tmdbId: null,
        title: media.title?.english || media.title?.romaji || "",
        year: media.startDate?.year ? String(media.startDate.year) : "",
        type: isFilm ? "anime" : "anime",
        poster: pickAnilistCoverUrl(media.coverImage) || "",
        resultKey: `anilist:${media.id}`,
      };
    });
  }

  async function fetchTmdb(path, params = {}) {
    const apiKey = getTmdbKey();
    if (!apiKey) return null;

    const search = new URLSearchParams({ ...params, api_key: apiKey });
    const response = await fetch(`https://api.themoviedb.org/3/${path}?${search}`);
    if (!response.ok) return null;
    return response.json();
  }

  function normalizeTmdbDetail(item, mediaType) {
    if (!item) return null;

    const title = pickTmdbDisplayTitle(item);
    const year = (item.release_date || item.first_air_date || "").slice(0, 4);
    const genres = (item.genres || []).map((g) => g.name);
    const actors = (item.credits?.cast || [])
      .slice(0, 6)
      .map((person) => person.name)
      .filter(Boolean);
    const rating =
      item.vote_average != null && Number.isFinite(Number(item.vote_average))
        ? Number(item.vote_average).toFixed(1)
        : "";

    return buildDetailPayload({
      source: "tmdb",
      imdbId: pickTmdbImdbId(item),
      tmdbType: mediaType,
      tmdbId: item.id,
      title,
      year,
      plot: item.overview || "",
      poster: item.poster_path ? `${TMDB_IMAGE}${item.poster_path}` : "",
      rating,
      actors,
      genres,
      mediaType: mediaType === "tv" ? "series" : "movie",
      omdbType: mediaType === "tv" ? "series" : "movie",
      originCountry: tmdbOriginCountries(item),
      originalLanguage: item.original_language || "",
      ageRating: pickTmdbAgeRating(item, mediaType),
      runtime: pickTmdbRuntime(item, mediaType),
      seasonCount:
        mediaType === "tv" ? parsePositiveInt(item.number_of_seasons) : null,
      episodeCount:
        mediaType === "tv" ? parsePositiveInt(item.number_of_episodes) : null,
    });
  }

  function mergeDetailLocales(localPayload, enPayload) {
    if (!localPayload || !enPayload) return localPayload || enPayload;
    const pickTitle = (local, en) => {
      const l = String(local || "").trim();
      const e = String(en || "").trim();
      if (/[\u0600-\u06FF]/.test(l)) return l;
      return l || e;
    };
    const pickText = (local, en) => {
      const l = String(local || "").trim();
      const e = String(en || "").trim();
      return l || e;
    };
    return {
      ...localPayload,
      title: pickTitle(localPayload.title, enPayload.title),
      plot: pickText(localPayload.plot, enPayload.plot),
      runtime: localizeRuntimeLabel(
        pickText(localPayload.runtime, enPayload.runtime) ||
          localPayload.runtime ||
          enPayload.runtime
      ),
      genres:
        enPayload?.genres?.length > 0 ? enPayload.genres : localPayload.genres,
    };
  }

  async function fetchTmdbDetails(mediaType, tmdbId, titleLocale = "en") {
    const locale = titleLocale === "ar" ? "ar" : "en";
    const lang = locale === "ar" ? "ar-SA" : "en-US";
    const cacheKey = `tmdb:${mediaType}:${tmdbId}:${locale}`;
    const cached = readCached(cacheKey);
    if (cached) return cached;

    // Try direct API first (fast, only works if client has a TMDB key)
    const json = await fetchTmdb(`${mediaType}/${tmdbId}`, {
      language: lang,
      append_to_response:
        mediaType === "tv"
          ? "credits,content_ratings,external_ids"
          : "credits,release_dates,external_ids",
    });

    if (json) {
      let payload = normalizeTmdbDetail(json, mediaType);
      if (locale === "ar") {
        const enJson = await fetchTmdb(`${mediaType}/${tmdbId}`, {
          language: "en-US",
          append_to_response:
            mediaType === "tv"
              ? "credits,content_ratings,external_ids"
              : "credits,release_dates,external_ids",
        });
        if (enJson) {
          const enPayload = normalizeTmdbDetail(enJson, mediaType);
          payload = mergeDetailLocales(payload, enPayload);
        }
      }
      if (payload) writeCacheEntry(cacheKey, payload);
      return payload;
    }

    // Fallback: use edge function when no client-side TMDB key
    if (window.WatchlistTmdb?.isAvailable()) {
      const details = await window.WatchlistTmdb.getDetails(mediaType, tmdbId, locale);
      if (details?.title) {
        const payload = buildDetailPayload({
          ...details,
          source: details.source || "tmdb",
          tmdbType: details.tmdbType || mediaType,
          tmdbId: details.tmdbId || tmdbId,
        });
        writeCacheEntry(cacheKey, payload);
        return payload;
      }
    }

    return null;
  }

  async function fetchTmdbByImdbId(imdbId) {
    const cacheKey = `imdb-tmdb:${imdbId}`;
    const cached = readCached(cacheKey);
    if (cached) return cached;

    const json = await fetchTmdb(`find/${imdbId}`, { external_source: "imdb_id" });
    if (!json) return null;

    const movie = json.movie_results?.[0];
    if (movie) {
      const payload = await fetchTmdbDetails("movie", movie.id);
      if (payload) {
        payload.imdbId = imdbId;
        writeCacheEntry(cacheKey, payload);
      }
      return payload;
    }

    const show = json.tv_results?.[0];
    if (show) {
      const payload = await fetchTmdbDetails("tv", show.id);
      if (payload) {
        payload.imdbId = imdbId;
        writeCacheEntry(cacheKey, payload);
      }
      return payload;
    }

    return null;
  }

  async function searchTmdb(query, type, page = 1) {
    const titleLocale = detectQueryTitleLocale(query);
    const lang = titleLocale === "ar" ? "ar-SA" : "en-US";
    const results = [];

    if (type === "all" || type === "movie") {
      const movies = await fetchTmdb("search/movie", { query, page, language: lang });
      for (const item of movies?.results || []) {
        results.push({
          source: "tmdb",
          tmdbType: "movie",
          tmdbId: item.id,
          imdbId: null,
          anilistId: null,
          title: pickTmdbDisplayTitle(item, titleLocale),
          year: (item.release_date || "").slice(0, 4),
          type: "movie",
          poster: item.poster_path ? `${TMDB_IMAGE}${item.poster_path}` : "",
        });
      }
    }

    if (type === "all" || type === "series") {
      const shows = await fetchTmdb("search/tv", { query, page, language: lang });
      for (const item of shows?.results || []) {
        results.push({
          source: "tmdb",
          tmdbType: "tv",
          tmdbId: item.id,
          imdbId: null,
          anilistId: null,
          title: pickTmdbDisplayTitle(item, titleLocale),
          year: (item.first_air_date || "").slice(0, 4),
          type: "series",
          originCountry: tmdbOriginCountries(item),
          originalLanguage: item.original_language || "",
          genreIds: Array.isArray(item.genre_ids)
            ? item.genre_ids.map(Number).filter(Number.isFinite)
            : [],
          poster: item.poster_path ? `${TMDB_IMAGE}${item.poster_path}` : "",
          resultKey: `tmdb:tv:${item.id}`,
        });
      }
    }

    return results;
  }

  function normalizeOmdbSearchResult(item) {
    if (!item?.imdbID) return null;
    return {
      source: "omdb",
      imdbId: String(item.imdbID).toLowerCase(),
      anilistId: null,
      tmdbType: null,
      tmdbId: null,
      title: item.Title || "",
      year: item.Year || "",
      type: item.Type || "",
      poster: item.Poster && item.Poster !== "N/A" ? item.Poster : "",
    };
  }

  function normalizeFullPayload(imdbId, json) {
    if (!json || json.Response !== "True") return null;

    const actors = parseActorList(json.Actors);
    const genres = parseGenreList(json.Genre);
    const director = json.Director && json.Director !== "N/A" ? json.Director : "";

    return buildDetailPayload({
      source: "omdb",
      imdbId,
      title: json.Title && json.Title !== "N/A" ? json.Title : "",
      year: json.Year && json.Year !== "N/A" ? json.Year : "",
      plot: json.Plot && json.Plot !== "N/A" ? json.Plot : "",
      poster: json.Poster && json.Poster !== "N/A" ? json.Poster : "",
      rating: json.imdbRating && json.imdbRating !== "N/A" ? json.imdbRating : "",
      runtime: json.Runtime && json.Runtime !== "N/A" ? json.Runtime : "",
      ageRating: json.Rated && json.Rated !== "N/A" ? json.Rated : "",
      seasonCount:
        json.Type === "series" ? parsePositiveInt(json.totalSeasons) : null,
      actors,
      genres,
      director,
      omdbType: json.Type && json.Type !== "N/A" ? json.Type : "",
      mediaType: json.Type && json.Type !== "N/A" ? json.Type : "",
    });
  }

  async function fetchFromOmdb(imdbId) {
    const apiKey = getOmdbKey();
    if (!apiKey) return null;

    const response = await fetch(
      `https://www.omdbapi.com/?i=${encodeURIComponent(imdbId)}&plot=short&apikey=${encodeURIComponent(apiKey)}`
    );
    if (!response.ok) return null;

    const json = await response.json();
    return normalizeFullPayload(imdbId, json);
  }

  async function getMetadata(linkOrId, options = {}) {
    const imdbId = String(linkOrId || "").startsWith("tt")
      ? linkOrId.toLowerCase()
      : extractImdbId(linkOrId);
    if (!imdbId) return null;

    const cacheKey = `omdb:${imdbId}`;
    if (!options.refresh) {
      const cached = readCached(cacheKey);
      if (cached && cachedHasTitleMeta(cached)) return cached;
    }

    let data = await fetchFromOmdb(imdbId);
    if (!data && hasTmdbKey()) {
      data = await fetchTmdbByImdbId(imdbId);
    }
    if (data) writeCacheEntry(cacheKey, data);
    return data;
  }

  async function resolveAnimeFromJapaneseTmdb(tmdbDetails, pick = {}) {
    if (!tmdbDetails?.title) return null;
    if (pick.tmdbType !== "tv" && tmdbDetails.tmdbType !== "tv") return null;
    if (!isJapaneseTmdbProduction(tmdbDetails)) return null;

    const match = await fetchAnilistMatchByTitle(
      tmdbDetails.title,
      tmdbDetails.year || pick.year
    );
    if (!match?.anilistId) return null;

    const anilist = await fetchAnilistById(match.anilistId);
    return anilist || null;
  }

  async function getDetailsForPick(pick, options = {}) {
    if (!pick) return null;

    const titleLocale = detectQueryTitleLocale(options.searchQuery || "");
    const preferAnime = options.preferAnime === true;

      if (pick.anilistId) {
        return fetchAnilistById(pick.anilistId);
      }

      if (preferAnime && pick.title) {
        const match = await fetchAnilistMatchByTitle(pick.title, pick.year);
        if (match?.anilistId) {
          return fetchAnilistById(match.anilistId);
      }
    }

    if (pick.tmdbType && pick.tmdbId) {
      const tmdb = await fetchTmdbDetails(pick.tmdbType, pick.tmdbId, titleLocale);
      if (!tmdb) return null;
      if (preferAnime) {
        return ensureAnimeDetails(tmdb, { pick, preferAnime: true, forceAnime: true });
      }
      return tmdb;
    }

    if (pick.imdbId) {
      const meta = await getMetadata(pick.imdbId);
      if (preferAnime && meta) {
        return ensureAnimeDetails(meta, { pick, preferAnime: true, forceAnime: true });
      }
      return meta;
    }

    return null;
  }

  async function searchOmdb(query, options = {}) {
    const apiKey = getOmdbKey();
    if (!apiKey) return [];

    const page = Math.max(1, Number(options.page) || 1);
    const params = new URLSearchParams({
      s: query,
      apikey: apiKey,
      page: String(page),
    });

    const type = options.type;
    if (type && type !== "all") {
      params.set("type", type);
    }

    const response = await fetch(`https://www.omdbapi.com/?${params}`);
    if (!response.ok) return [];

    const json = await response.json();
    if (json.Response !== "True") return [];

    return (json.Search || []).map(normalizeOmdbSearchResult).filter(Boolean);
  }

  /**
   * IMDb suggestion search (proxied via the edge function).
   * IMDb matches alternate titles (AKAs) and fuzzy spellings the way its own
   * search box does — this is what lets "seven" find Se7en and English anime
   * titles find their romaji IMDb entries. TMDB's plain text search misses
   * many of these.
   */
  const imdbSuggestCache = new Map();
  const IMDB_SUGGEST_CACHE_MAX = 60;

  async function searchImdbSuggestions(query, type) {
    if (typeof window.WatchlistTmdb?.imdbSuggest !== "function") return [];
    if (!window.WatchlistTmdb.isAvailable()) return [];
    const q = String(query || "").trim();
    if (q.length < 2 || detectQueryTitleLocale(q) === "ar") return [];

    const cacheKey = q.toLowerCase();
    let all = imdbSuggestCache.get(cacheKey);
    if (!all) {
      const res = await window.WatchlistTmdb.imdbSuggest(q);
      if (!res?.ok) return [];
      all = res.results || [];
      imdbSuggestCache.set(cacheKey, all);
      if (imdbSuggestCache.size > IMDB_SUGGEST_CACHE_MAX) {
        imdbSuggestCache.delete(imdbSuggestCache.keys().next().value);
      }
    }
    if (type === "movie") return all.filter((r) => r.type === "movie");
    if (type === "series") return all.filter((r) => r.type === "series");
    return all;
  }

  /**
   * Search via the TMDB edge function if Supabase is configured.
   * Falls back to direct API calls when not available.
   */
  async function searchViaTmdbEdge(query, type, page) {
    if (typeof window.WatchlistTmdb?.search !== "function") return null;
    if (!window.WatchlistTmdb.isAvailable()) return null;

    const tmdbType =
      type === "series" ? "tv" : type === "movie" ? "movie" : "multi";
    const titleLocale = detectQueryTitleLocale(query);

    const result = await window.WatchlistTmdb.search(query, tmdbType, page, titleLocale);
    if (!result?.ok) return null;
    return result.results || [];
  }

  async function searchTitles(query, options = {}) {
    const q = String(query || "").trim();
    if (q.length < 2) {
      return { ok: true, results: [], total: 0 };
    }

    if (!hasSearchConfigured()) {
      return { ok: false, error: "Search is not configured." };
    }

    const page = Math.max(1, Number(options.page) || 1);
    const type = options.type || "all";
    const tasks = [];

    // Kick off IMDb suggestions in parallel — merged in at the end so AKA
    // matches TMDB misses (e.g. "seven" → Se7en) still show up.
    const imdbSuggestPromise =
      type !== "anime" && page === 1
        ? searchImdbSuggestions(q, type).catch(() => [])
        : Promise.resolve([]);

    if (type === "anime") {
      tasks.push(searchAnilist(q, page));
    } else {
      // Prefer edge function search: supports Arabic, partial matches, no key exposure
      const edgeResults = await searchViaTmdbEdge(q, type, page);
      if (edgeResults !== null) {
        tasks.push(Promise.resolve(edgeResults));
      } else {
        // Fall back to direct API calls when edge is unavailable
        if (hasOmdbKey()) {
          tasks.push(searchOmdb(q, { type, page }));
        }
        if (hasTmdbKey()) {
          const tmdbType =
            type === "series" ? "series" : type === "movie" ? "movie" : "all";
          tasks.push(searchTmdb(q, tmdbType, page));
        }
      }

      if ((type === "all" || type === "series") && !options.skipAnilistCrossCheck) {
        tasks.push(searchAnilist(q, page));
      }
    }

    const lists = await Promise.all(tasks);
    let results = mergeSearchResults(lists);

    // Surface IMDb suggestion hits we don't already have (dedupe by
    // normalized title + year). Novel entries go first: when IMDb finds
    // something TMDB completely missed, it's almost always the exact title
    // the user was typing.
    const imdbSuggestions = await imdbSuggestPromise;
    if (imdbSuggestions.length) {
      const seen = new Set(results.map((r) => resultDedupeKey(r)));
      const novel = imdbSuggestions.filter((r) => !seen.has(resultDedupeKey(r)));
      if (novel.length) {
        results = mergeSearchResults([novel, results]);
      }
    }

    if (type === "all" || type === "series" || type === "anime") {
      try {
        const offline = await searchAnimeOfflineIndex(q, {});
        if (offline?.pick?.anilistId) {
          results = mergeSearchResults([results, [offline.pick]]);
        } else if (offline?.results?.length) {
          results = mergeSearchResults([results, offline.results.slice(0, 6)]);
        }
      } catch (error) {
        console.warn("[search] offline anime index append failed:", error);
      }
    }

    results = results.map((entry) => ({
      ...entry,
      displayType: displayTypeForSearchResult(entry),
    }));

    return {
      ok: true,
      results,
      total: results.length,
      page,
      message: results.length ? "" : "No matches found. Try another spelling.",
    };
  }

  async function resolveMetadataFromLink(url) {
    const value = String(url || "").trim();
    if (!value) return null;

    const imdbId = extractImdbId(value);
    if (imdbId) {
      const data = await getMetadata(imdbId);
      if (data) return data;
    }

    const anilist = parseAnilistLink(value);
    if (anilist?.anilistId) {
      return fetchAnilistById(anilist.anilistId);
    }

    const mal = parseMalLink(value);
    if (mal?.malId) {
      return fetchAnilistByMalId(mal.malId);
    }

    return null;
  }

  function preferLocalizedTitle(searchTitle, detailsTitle, searchQuery = "") {
    const titleLocale = detectQueryTitleLocale(searchQuery);
    const a = String(searchTitle || "").trim();
    const b = String(detailsTitle || "").trim();
    if (titleLocale === "ar") {
      if (/[\u0600-\u06FF]/.test(a)) return a;
      if (/[\u0600-\u06FF]/.test(b)) return b;
      return a || b;
    }
    if (b && !/[\u0600-\u06FF]/.test(b)) return b;
    if (a && !/[\u0600-\u06FF]/.test(a)) return a;
    return b || a;
  }

  window.WatchlistMetadata = {
    extractImdbId,
    extractTmdbId,
    extractAnilistId,
    extractMalId,
    getMetadata,
    fetchTmdbDetails,
    getDetailsForPick,
    resolveDetailsForWatchlistAdd,
    resolveAnimeDetailsForWatchlistAdd,
    resolveContentTypeForWatchlistAdd,
    ensureAnimePosterOnDetails,
    fetchAnilistCoverOnly,
    inspectAnilistProviderCache,
    selectLoadableAnilistPoster,
    resolveAnimePosterForBulkCommit,
    patchAnilistProviderCache,
    logAnimeCoverFetch,
    verifyAnimePosterForSave,
    probePosterImageUrl,
    isBulkAddTraceTitle,
    logBulkVsSearchBuild,
    getCachedDetailsForPick,
    getLightweightDetailsForPick,
    buildLightweightDetailsFromSearchResult,
    cacheResolvedPreview,
    fetchAnilistById,
    fetchAnilistByMalId,
    fetchAnilistByTitleMatch,
    fetchAnilistMatchByTitle,
    fetchAnilistScoreByTitle,
    searchTitles,
    searchAnilistForBulkImport,
    searchAnilistBulkBatch,
    searchAnimeOfflineIndex,
    searchAnimeOfflineBatch,
    lookupCachedAnilistMatch,
    fetchTitleProviderCacheBatch,
    fetchTitleProviderCacheEntry,
    upsertTitleProviderCacheEntry,
    getAnilistQueueStatus,
    clearAnilistRateLimitPause,
    noteAnilistRateLimit,
    fetchAnimeIndexMeta,
    anilistQueryDetailed,
    suggestGenres,
    mergeProviderGenreSources,
    applyMergedGenresToItem,
    enrichDetailsGenres,
    mergeAndApplyItemGenres,
    fetchTmdbKeywords,
    extractLeadCast,
    enrichLeadCastForItem,
    defaultGenreForContentType,
    inferContentType,
    displayTypeForSearchResult,
    isLikelyAnimeSearchResult,
    resultProviderIdentityKey,
    isJapaneseTmdbProduction,
    isJapaneseTmdbProduction,
    resolveMetadataFromLink,
    defaultLinkForDetails,
    formatTitleMetaParts,
    formatAgeRatingDisplay,
    ageRatingSortRank,
    buildTitleMetaBadges,
    ensureAnimeDetails,
    applyTitleMetaFromDetails,
    isAnilistLink,
    isMalLink,
    isSupportedLink,
    hasApiKey,
    hasOmdbKey,
    hasTmdbKey,
    hasSearchConfigured,
    preferLocalizedTitle,
    getApiKey: getOmdbKey,
    upgradeTmdbPosterUrl,
    upgradeAnilistPosterUrl,
    upgradePosterForStorage,
    isLowResPosterUrl,
    pickAnilistCoverUrl,
  };
})();
