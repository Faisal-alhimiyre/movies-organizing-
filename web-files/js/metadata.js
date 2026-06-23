(function () {
  "use strict";

  const CACHE_KEY = "watchlist-metadata-cache-v4";
  const ANILIST_API = "https://graphql.anilist.co";
  const TMDB_IMAGE = "https://image.tmdb.org/t/p/w500";
  const TMDB_IMAGE_SM = "https://image.tmdb.org/t/p/w92";

  const memory = new Map();

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

  function readCache() {
    try {
      return JSON.parse(localStorage.getItem(CACHE_KEY) || "{}");
    } catch {
      return {};
    }
  }

  function writeCacheEntry(cacheKey, data) {
    const cache = readCache();
    cache[cacheKey] = { ...data, cachedAt: Date.now() };
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
    } catch {
      /* ignore quota errors */
    }
    memory.set(cacheKey, data);
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
    const alias = GENRE_ALIASES[lower];
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

  function isAnimatedContent(genres) {
    return parseGenreList(genres).some((genre) => {
      const lower = genre.toLowerCase();
      return lower === "animation" || lower === "anime";
    });
  }

  function inferContentType(mediaType, genres = []) {
    const type = String(mediaType || "").toLowerCase();
    const animated = isAnimatedContent(genres);

    if (type === "anime" || type === "animation") return "anime";
    if (type === "series" || type === "episode" || type === "tv") {
      return animated ? "anime" : "tvSeries";
    }
    if (type === "movie" || type === "game") {
      return animated ? "anime" : "movies";
    }
    if (animated) return "anime";
    return "movies";
  }

  function defaultLinkForDetails(details) {
    if (details?.link) return details.link;
    if (details?.imdbId) return `https://www.imdb.com/title/${details.imdbId}/`;
    if (details?.anilistId) return `https://anilist.co/anime/${details.anilistId}/`;
    return "";
  }

  function buildDetailPayload(base) {
    const genres = parseGenreList(base.genres);
    return {
      source: base.source || "omdb",
      imdbId: base.imdbId || null,
      anilistId: base.anilistId || null,
      tmdbType: base.tmdbType || null,
      tmdbId: base.tmdbId || null,
      link: base.link || defaultLinkForDetails(base),
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
    return value ? `${value} min` : "";
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
    if (minutes) return `~${minutes} min/ep`;
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
      if (runtime) badges.push({ kind: "duration", label: runtime });
    } else if (type === "tvSeries") {
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
      if (seasonCount) {
        badges.push({
          kind: "seasons",
          label: _seasonsBadgeLabel(seasonCount),
        });
      } else if (episodeCount) {
        badges.push({
          kind: "seasons",
          label: `${episodeCount} ${episodeCount === 1 ? "episode" : "episodes"}`,
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

  function applyTitleMetaFromDetails(details, target) {
    if (!details || !target) return;
    if (details.ageRating) target.ageRating = details.ageRating;
    if (details.runtime) target.runtime = details.runtime;
    if (details.seasonCount) target.seasonCount = details.seasonCount;
    if (details.episodeCount) target.episodeCount = details.episodeCount;
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

  function mergeSearchResults(lists) {
    const merged = [];
    const seen = new Set();

    for (const list of lists) {
      for (const result of list || []) {
        if (!result?.title) continue;
        const key = result.resultKey || resultDedupeKey(result);
        if (seen.has(key)) continue;
        seen.add(key);
        merged.push({ ...result, resultKey: key });
      }
    }

    return merged;
  }

  async function anilistQuery(query, variables) {
    try {
      const response = await fetch(ANILIST_API, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ query, variables }),
      });
      const json = await response.json();
      if (!response.ok || json.errors?.length) {
        console.warn("[anilist] query failed:", json.errors || response.status);
        return null;
      }
      return json.data;
    } catch (error) {
      console.warn("[anilist] request failed:", error);
      return null;
    }
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

    return buildDetailPayload({
      source: "anilist",
      anilistId: media.id,
      link: `https://anilist.co/anime/${media.id}/`,
      title,
      year: media.startDate?.year ? String(media.startDate.year) : "",
      plot: stripHtml(media.description),
      poster: media.coverImage?.large || "",
      anilistRating:
        media.averageScore != null ? String(media.averageScore) : "",
      actors: leads,
      genres: media.genres || [],
      mediaType,
      omdbType: mediaType,
      ageRating: media.isAdult ? "18+" : "",
      runtime: media.duration ? formatRuntimeMinutes(media.duration) : "",
      episodeCount: parsePositiveInt(media.episodes),
    });
  }

  async function fetchAnilistById(anilistId) {
    const cacheKey = `anilist:${anilistId}`;
    const cached = ensureAnilistRating(readCached(cacheKey));
    if (cached) return cached;

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
          coverImage { large }
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
          coverImage { large }
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
            coverImage { large }
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
        poster: media.coverImage?.large || "",
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

    const title = item.title || item.name || "";
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
      imdbId: item.imdb_id || null,
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
      ageRating: pickTmdbAgeRating(item, mediaType),
      runtime: pickTmdbRuntime(item, mediaType),
      seasonCount:
        mediaType === "tv" ? parsePositiveInt(item.number_of_seasons) : null,
      episodeCount:
        mediaType === "tv" ? parsePositiveInt(item.number_of_episodes) : null,
    });
  }

  async function fetchTmdbDetails(mediaType, tmdbId) {
    const cacheKey = `tmdb:${mediaType}:${tmdbId}`;
    const cached = readCached(cacheKey);
    if (cached) return cached;

    const json = await fetchTmdb(`${mediaType}/${tmdbId}`, {
      append_to_response:
        mediaType === "tv" ? "credits,content_ratings" : "credits,release_dates",
    });
    const payload = normalizeTmdbDetail(json, mediaType);
    if (payload) writeCacheEntry(cacheKey, payload);
    return payload;
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
    const results = [];

    if (type === "all" || type === "movie") {
      const movies = await fetchTmdb("search/movie", { query, page });
      for (const item of movies?.results || []) {
        results.push({
          source: "tmdb",
          tmdbType: "movie",
          tmdbId: item.id,
          imdbId: null,
          anilistId: null,
          title: item.title || "",
          year: (item.release_date || "").slice(0, 4),
          type: "movie",
          poster: item.poster_path ? `${TMDB_IMAGE_SM}${item.poster_path}` : "",
        });
      }
    }

    if (type === "all" || type === "series") {
      const shows = await fetchTmdb("search/tv", { query, page });
      for (const item of shows?.results || []) {
        results.push({
          source: "tmdb",
          tmdbType: "tv",
          tmdbId: item.id,
          imdbId: null,
          anilistId: null,
          title: item.name || "",
          year: (item.first_air_date || "").slice(0, 4),
          type: "series",
          poster: item.poster_path ? `${TMDB_IMAGE_SM}${item.poster_path}` : "",
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

  async function getDetailsForPick(pick) {
    if (!pick) return null;

    if (pick.anilistId) {
      return fetchAnilistById(pick.anilistId);
    }

    if (pick.tmdbType && pick.tmdbId) {
      return fetchTmdbDetails(pick.tmdbType, pick.tmdbId);
    }

    if (pick.imdbId) {
      return getMetadata(pick.imdbId);
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

    if (type === "anime") {
      tasks.push(searchAnilist(q, page));
    } else {
      if (hasOmdbKey()) {
        tasks.push(searchOmdb(q, { type, page }));
      }

      if (hasTmdbKey()) {
        const tmdbType =
          type === "series" ? "series" : type === "movie" ? "movie" : "all";
        tasks.push(searchTmdb(q, tmdbType, page));
      }

      if (type === "all") {
        tasks.push(searchAnilist(q, page));
      }
    }

    const lists = await Promise.all(tasks);
    const results = mergeSearchResults(lists);

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

  window.WatchlistMetadata = {
    extractImdbId,
    extractAnilistId,
    extractMalId,
    getMetadata,
    getDetailsForPick,
    fetchAnilistById,
    fetchAnilistByMalId,
    fetchAnilistByTitleMatch,
    fetchAnilistMatchByTitle,
    fetchAnilistScoreByTitle,
    searchTitles,
    suggestGenres,
    inferContentType,
    resolveMetadataFromLink,
    defaultLinkForDetails,
    formatTitleMetaParts,
    formatAgeRatingDisplay,
    ageRatingSortRank,
    buildTitleMetaBadges,
    applyTitleMetaFromDetails,
    isAnilistLink,
    isMalLink,
    isSupportedLink,
    hasApiKey,
    hasOmdbKey,
    hasTmdbKey,
    hasSearchConfigured,
    getApiKey: getOmdbKey,
  };
})();
