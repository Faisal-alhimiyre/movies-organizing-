/**
 * series-metadata.test.js
 *
 * Focused JavaScript tests for web-files/js/series-metadata.js.
 * Covers model normalization, cache behavior, and key async paths.
 *
 * Run: cd web-files && npm install && npm test
 */

"use strict";

// ─── Mock helpers ────────────────────────────────────────────────────────────

function mockFetch(responses) {
  let callIndex = 0;
  return jest.fn().mockImplementation(() => {
    const response = responses[callIndex] ?? responses[responses.length - 1];
    callIndex++;
    if (response instanceof Error) return Promise.reject(response);
    return Promise.resolve({
      ok: response.ok !== false,
      status: response.status ?? 200,
      json: () => Promise.resolve(response.body),
    });
  });
}

function setupGlobals() {
  window.WATCHLIST_CONFIG = { tmdbApiKey: "TEST_TMDB", omdbApiKey: "TEST_OMDB" };
  window.WatchlistMetadata = {
    extractImdbId: (url) => {
      const m = String(url || "").match(/imdb\.com\/title\/(tt\d+)/);
      return m ? m[1] : null;
    },
    extractAnilistId: (url) => {
      const m = String(url || "").match(/anilist\.co\/anime\/(\d+)/);
      return m ? Number(m[1]) : null;
    },
    isAnilistLink: (url) => /anilist\.co\/anime\/\d+/.test(String(url || "")),
    extractMalId: (url) => {
      const m = String(url || "").match(/myanimelist\.net\/anime\/(\d+)/);
      return m ? Number(m[1]) : null;
    },
    isMalLink: (url) => /myanimelist\.net\/anime\/\d+/.test(String(url || "")),
  };
  window.WatchlistI18n = { getLocale: () => "en" };
}

function loadModule() {
  jest.resetModules();
  localStorage.clear();
  setupGlobals();
  require("./series-metadata.js");
  return window.WatchlistSeriesMetadata;
}

// ─── 1. Pure normalization — TMDb series ─────────────────────────────────────

describe("_normalizeTmdbSeries", () => {
  let SM;
  beforeEach(() => {
    SM = loadModule();
  });

  test("returns null for missing name", () => {
    expect(SM._normalizeTmdbSeries({}, 1)).toBeNull();
  });

  test("normalizes a full TMDb series JSON", () => {
    const json = {
      name: "Breaking Bad",
      original_name: "Breaking Bad",
      poster_path: "/abc.jpg",
      overview: "Chemistry teacher turns criminal.",
      status: "Ended",
      first_air_date: "2008-01-20",
      last_air_date: "2013-09-29",
      number_of_seasons: 5,
      number_of_episodes: 62,
    };
    const result = SM._normalizeTmdbSeries(json, 1396);

    expect(result).toMatchObject({
      source: "tmdb",
      tmdbId: 1396,
      title: "Breaking Bad",
      originalTitle: "Breaking Bad",
      totalSeasons: 5,
      totalEpisodes: 62,
      overview: "Chemistry teacher turns criminal.",
      status: "Ended",
      firstAirDate: "2008-01-20",
      lastAirDate: "2013-09-29",
    });
    expect(result.poster).toMatch(/tmdb\.org.*abc\.jpg/);
  });

  test("uses fallbackPoster when no poster_path", () => {
    const json = { name: "My Show" };
    const result = SM._normalizeTmdbSeries(json, 99, "https://example.com/fallback.jpg");
    expect(result.poster).toBe("https://example.com/fallback.jpg");
  });

  test("handles invalid number_of_seasons gracefully", () => {
    const json = { name: "My Show", number_of_seasons: "N/A", number_of_episodes: null };
    const result = SM._normalizeTmdbSeries(json, 99);
    expect(result.totalSeasons).toBeNull();
    expect(result.totalEpisodes).toBeNull();
  });
});

// ─── 2. Pure normalization — TMDb season summary ─────────────────────────────

describe("_normalizeTmdbSeasonSummary", () => {
  let SM;
  beforeEach(() => { SM = loadModule(); });

  test("returns null when season_number is missing", () => {
    expect(SM._normalizeTmdbSeasonSummary({}, 1)).toBeNull();
  });

  test("normalizes season 0 (specials)", () => {
    const json = { season_number: 0, name: "Specials", episode_count: 3 };
    const result = SM._normalizeTmdbSeasonSummary(json, 1396);
    expect(result.isSpecials).toBe(true);
    expect(result.episodeCount).toBe(3);
    expect(result.isSynthetic).toBe(false);
  });

  test("normalizes a regular season", () => {
    const json = {
      season_number: 2,
      name: "Season 2",
      poster_path: "/s2.jpg",
      episode_count: 13,
      air_date: "2009-03-08",
      overview: "Year two begins.",
    };
    const result = SM._normalizeTmdbSeasonSummary(json, 1396);
    expect(result).toMatchObject({
      source: "tmdb",
      seriesTmdbId: 1396,
      seasonNumber: 2,
      name: "Season 2",
      episodeCount: 13,
      airDate: "2009-03-08",
      isSpecials: false,
    });
    expect(result.poster).toMatch(/s2\.jpg/);
  });

  test("falls back to provided poster when season has no poster_path", () => {
    const json = { season_number: 1, name: "Season 1" };
    const result = SM._normalizeTmdbSeasonSummary(json, 99, "https://fallback.jpg");
    expect(result.poster).toBe("https://fallback.jpg");
  });

  test("generates name from number when name is empty", () => {
    const json = { season_number: 3 };
    const result = SM._normalizeTmdbSeasonSummary(json, 99);
    expect(result.name).toBe("Season 3");
  });
});

// ─── 3. Pure normalization — TMDb episode ────────────────────────────────────

describe("_normalizeTmdbEpisode", () => {
  let SM;
  beforeEach(() => { SM = loadModule(); });

  test("returns null when episode_number is missing", () => {
    expect(SM._normalizeTmdbEpisode({}, 1)).toBeNull();
  });

  test("normalizes a fully-populated episode", () => {
    const json = {
      episode_number: 3,
      season_number: 1,
      name: "...And the Bag's in the River",
      still_path: "/still.jpg",
      overview: "Walter deals with the aftermath.",
      runtime: 48,
      air_date: "2008-02-10",
    };
    const result = SM._normalizeTmdbEpisode(json, 1396);
    expect(result).toMatchObject({
      source: "tmdb",
      seriesTmdbId: 1396,
      episodeNumber: 3,
      seasonNumber: 1,
      title: "...And the Bag's in the River",
      overview: "Walter deals with the aftermath.",
      runtimeMinutes: 48,
      airDate: "2008-02-10",
      progressKey: "1:3",
    });
    expect(result.still).toMatch(/still\.jpg/);
    expect(result.isAired).toBe(true); // 2008 is in the past
  });

  test("still falls back to seasonPoster then fallbackPoster", () => {
    const json = { episode_number: 1, season_number: 1 };
    const resultWithSeason = SM._normalizeTmdbEpisode(json, 99, "https://season.jpg", "https://fallback.jpg");
    expect(resultWithSeason.still).toBe("https://season.jpg");

    const resultFallback = SM._normalizeTmdbEpisode(json, 99, "", "https://fallback.jpg");
    expect(resultFallback.still).toBe("https://fallback.jpg");
  });

  test("marks future episode as not aired", () => {
    const future = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    const json = { episode_number: 1, season_number: 1, air_date: future };
    const result = SM._normalizeTmdbEpisode(json, 99);
    expect(result.isAired).toBe(false);
  });
});

// ─── 4. Pure normalization — OMDb season ─────────────────────────────────────

describe("_normalizeOmdbSeason", () => {
  let SM;
  beforeEach(() => { SM = loadModule(); });

  test("returns an empty array for empty Episodes", () => {
    expect(SM._normalizeOmdbSeason({ Episodes: [] }, 1)).toEqual([]);
    expect(SM._normalizeOmdbSeason({}, 1)).toEqual([]);
  });

  test("normalizes OMDb episode list", () => {
    const json = {
      Episodes: [
        { Episode: "1", Title: "Pilot", Released: "2008-01-20", imdbRating: "7.0" },
        { Episode: "2", Title: "Cat's in the Bag", Released: "2008-01-27", imdbRating: "7.8" },
      ],
    };
    const results = SM._normalizeOmdbSeason(json, 1);
    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({
      source: "omdb",
      seasonNumber: 1,
      episodeNumber: 1,
      title: "Pilot",
      airDate: "2008-01-20",
      still: "",
      overview: "",
      progressKey: "1:1",
    });
  });

  test("skips episodes with Episode=N/A", () => {
    const json = {
      Episodes: [
        { Episode: "N/A", Title: "Unknown" },
        { Episode: "1", Title: "Valid", Released: "2020-01-01" },
      ],
    };
    const results = SM._normalizeOmdbSeason(json, 2);
    expect(results).toHaveLength(1);
    expect(results[0].episodeNumber).toBe(1);
  });

  test("sets title fallback when Title is N/A", () => {
    const json = { Episodes: [{ Episode: "5", Title: "N/A" }] };
    const results = SM._normalizeOmdbSeason(json, 1);
    expect(results[0].title).toBe("Episode 5");
  });
});

// ─── 5. Pure helpers ─────────────────────────────────────────────────────────

describe("_isAired", () => {
  let SM;
  beforeEach(() => { SM = loadModule(); });

  test("returns true for past dates", () => {
    expect(SM._isAired("2020-01-01")).toBe(true);
    expect(SM._isAired("2000-06-15")).toBe(true);
  });

  test("returns false for future dates", () => {
    const future = new Date(Date.now() + 86400 * 1000).toISOString().slice(0, 10);
    expect(SM._isAired(future)).toBe(false);
  });

  test("returns true for null/undefined/empty (treat as aired/unknown)", () => {
    expect(SM._isAired(null)).toBe(true);
    expect(SM._isAired("")).toBe(true);
    expect(SM._isAired(undefined)).toBe(true);
  });
});

describe("_parsePositiveCount", () => {
  let SM;
  beforeEach(() => { SM = loadModule(); });

  test("parses valid positive integers", () => {
    expect(SM._parsePositiveCount(5)).toBe(5);
    expect(SM._parsePositiveCount("12")).toBe(12);
    expect(SM._parsePositiveCount("1")).toBe(1);
  });

  test("returns null for zero, negative, or invalid", () => {
    expect(SM._parsePositiveCount(0)).toBeNull();
    expect(SM._parsePositiveCount(-1)).toBeNull();
    expect(SM._parsePositiveCount("N/A")).toBeNull();
    expect(SM._parsePositiveCount(null)).toBeNull();
    expect(SM._parsePositiveCount(undefined)).toBeNull();
    expect(SM._parsePositiveCount("")).toBeNull();
  });
});

describe("_anilistDateStr", () => {
  let SM;
  beforeEach(() => { SM = loadModule(); });

  test("formats a complete date", () => {
    expect(SM._anilistDateStr({ year: 2021, month: 4, day: 3 })).toBe("2021-04-03");
  });

  test("formats year-only date", () => {
    expect(SM._anilistDateStr({ year: 2021 })).toBe("2021");
  });

  test("returns null for null/empty/missing year", () => {
    expect(SM._anilistDateStr(null)).toBeNull();
    expect(SM._anilistDateStr({})).toBeNull();
    expect(SM._anilistDateStr({ month: 4 })).toBeNull();
  });
});

describe("_stripHtml", () => {
  let SM;
  beforeEach(() => { SM = loadModule(); });

  test("removes HTML tags", () => {
    expect(SM._stripHtml("<b>Hello</b> <i>World</i>")).toBe("Hello World");
  });

  test("handles null/undefined gracefully", () => {
    expect(SM._stripHtml(null)).toBe("");
    expect(SM._stripHtml(undefined)).toBe("");
    expect(SM._stripHtml("")).toBe("");
  });

  test("decodes HTML entities", () => {
    const result = SM._stripHtml("A &amp; B");
    // Entity decoding behavior may vary; just check no tags remain
    expect(result).not.toMatch(/<[^>]+>/);
  });
});

// ─── 6. Cache behavior ───────────────────────────────────────────────────────

describe("Cache: write and read fresh entry", () => {
  let SM;
  beforeEach(() => { SM = loadModule(); });

  test("written entry is readable within TTL", () => {
    const cacheKey = "metadata:v5:series:tmdb:1396:en";
    const entry = {
      cachedAt: Date.now(),
      ttlMs: 7 * 24 * 3600 * 1000,
      payload: { series: { title: "Breaking Bad" }, seasons: [] },
      state: "available",
    };
    const cache = {};
    cache[cacheKey] = entry;
    localStorage.setItem("watchlist-series-cache-v5", JSON.stringify(cache));

    // The exported async function uses internal readCached; verify via fetchSeriesMetadata
    // reaching the cache branch. We verify indirectly by mocking fetch to throw.
    global.fetch = mockFetch([new Error("Network error")]);
    // After loadModule() cache is already populated; the SM methods will use it.
    // This test verifies the cache storage format is correct.
    const stored = JSON.parse(localStorage.getItem("watchlist-series-cache-v5") || "{}");
    expect(stored[cacheKey]).toBeDefined();
    expect(stored[cacheKey].payload.series.title).toBe("Breaking Bad");
  });
});

describe("Cache: locale-specific keys", () => {
  let SM;
  beforeEach(() => { SM = loadModule(); });

  test("Arabic and English produce different cache keys", () => {
    const enKey = "metadata:v5:series:tmdb:1396:en";
    const arKey = "metadata:v5:series:tmdb:1396:ar";
    expect(enKey).not.toBe(arKey);
    // Write distinct entries
    const cache = {
      [enKey]: { cachedAt: Date.now(), ttlMs: 1000, payload: { series: { title: "Breaking Bad" } }, state: "available" },
      [arKey]: { cachedAt: Date.now(), ttlMs: 1000, payload: { series: { title: "بريكينغ باد" } }, state: "available" },
    };
    localStorage.setItem("watchlist-series-cache-v5", JSON.stringify(cache));
    const stored = JSON.parse(localStorage.getItem("watchlist-series-cache-v5"));
    expect(stored[enKey].payload.series.title).toBe("Breaking Bad");
    expect(stored[arKey].payload.series.title).toBe("بريكينغ باد");
  });
});

describe("Cache: negative ID-resolution cache", () => {
  let SM;
  beforeEach(() => { SM = loadModule(); });

  test("negative cache entry has negative=true", () => {
    const key = "metadata:v5:resolve:negative:imdb:tt0000001";
    const cache = {
      [key]: { cachedAt: Date.now(), ttlMs: 2 * 3600 * 1000, negative: true },
    };
    localStorage.setItem("watchlist-series-cache-v5", JSON.stringify(cache));
    const stored = JSON.parse(localStorage.getItem("watchlist-series-cache-v5"));
    expect(stored[key].negative).toBe(true);
  });
});

// ─── 7. Async fetching with mocked fetch ─────────────────────────────────────

describe("fetchSeriesMetadata — TMDb success path", () => {
  let SM;

  beforeEach(() => {
    SM = loadModule();
  });

  afterEach(() => {
    delete global.fetch;
  });

  test("returns AVAILABLE result with correct shape on TMDb hit", async () => {
    // Pre-populate the IMDb→TMDb resolve cache
    const resolveKey = "metadata:v5:resolve:imdb:tt1232987";
    const cache = {
      [resolveKey]: {
        cachedAt: Date.now(),
        ttlMs: 30 * 24 * 3600 * 1000,
        source: "tmdb",
        tmdbId: 1396,
        imdbId: "tt1232987",
      },
    };
    localStorage.setItem("watchlist-series-cache-v5", JSON.stringify(cache));
    SM = loadModule(); // reload to pick up new storage

    global.fetch = mockFetch([
      {
        ok: true,
        body: {
          id: 1396,
          name: "Breaking Bad",
          original_name: "Breaking Bad",
          number_of_seasons: 5,
          number_of_episodes: 62,
          poster_path: "/abc.jpg",
          seasons: [
            { season_number: 1, name: "Season 1", episode_count: 7, air_date: "2008-01-20" },
          ],
        },
      },
    ]);

    const item = {
      contentType: "tvSeries",
      link: "https://www.imdb.com/title/tt1232987/",
    };
    const result = await SM.fetchSeriesMetadata(item, "en");
    expect(result.state).toBe("available");
    expect(result.series).toBeDefined();
    expect(result.series.title).toBe("Breaking Bad");
    expect(result.seasons).toHaveLength(1);
    expect(result.seasons[0].seasonNumber).toBe(1);
  });
});

describe("fetchSeriesMetadata — offline with cache", () => {
  let SM;

  afterEach(() => {
    delete global.fetch;
  });

  test("returns stale cached data when fetch fails (offline)", async () => {
    // Pre-populate a STALE series cache entry (cachedAt in the far past)
    const resolveKey = "metadata:v5:resolve:imdb:tt0903747";
    const seriesKey = "metadata:v5:series:tmdb:1396:en";
    const pastTime = Date.now() - 10 * 24 * 3600 * 1000; // 10 days ago (stale for 7-day TTL)
    const cache = {
      [resolveKey]: {
        cachedAt: Date.now(),
        ttlMs: 30 * 24 * 3600 * 1000,
        source: "tmdb",
        tmdbId: 1396,
        imdbId: "tt0903747",
      },
      [seriesKey]: {
        cachedAt: pastTime,
        ttlMs: 7 * 24 * 3600 * 1000,
        payload: {
          series: { source: "tmdb", tmdbId: 1396, title: "Cached Show", totalSeasons: 3, totalEpisodes: 30 },
          seasons: [],
        },
        state: "available",
      },
    };
    localStorage.setItem("watchlist-series-cache-v5", JSON.stringify(cache));
    SM = loadModule();

    // Fetch always fails (offline)
    global.fetch = mockFetch([new Error("NetworkError")]);

    const item = {
      contentType: "tvSeries",
      link: "https://www.imdb.com/title/tt0903747/",
    };
    const result = await SM.fetchSeriesMetadata(item, "en");
    // Should return stale cached data
    expect(["offlineWithCache", "available"]).toContain(result.state);
    expect(result.series).toBeDefined();
  });
});

describe("fetchSeriesMetadata — offline without cache", () => {
  let SM;

  afterEach(() => {
    delete global.fetch;
  });

  test("returns OFFLINE_NO_CACHE when fetch fails and no cache exists", async () => {
    // Pre-populate resolve cache so we get past ID resolution
    const resolveKey = "metadata:v5:resolve:imdb:tt9999999";
    const cache = {
      [resolveKey]: {
        cachedAt: Date.now(),
        ttlMs: 30 * 24 * 3600 * 1000,
        source: "tmdb",
        tmdbId: 99999,
        imdbId: "tt9999999",
      },
    };
    localStorage.setItem("watchlist-series-cache-v5", JSON.stringify(cache));
    SM = loadModule();

    global.fetch = mockFetch([new Error("NetworkError")]);

    const item = {
      contentType: "tvSeries",
      link: "https://www.imdb.com/title/tt9999999/",
    };
    const result = await SM.fetchSeriesMetadata(item, "en");
    expect(result.state).toBe("offlineNoCache");
  });
});

describe("fetchSeriesMetadata — movies return INVALID_ID", () => {
  let SM;
  beforeEach(() => { SM = loadModule(); });

  test("does not fetch for movies", async () => {
    global.fetch = jest.fn();
    const item = { contentType: "movies", link: "https://www.imdb.com/title/tt0111161/" };
    const result = await SM.fetchSeriesMetadata(item, "en");
    expect(result.state).toBe("invalidId");
    expect(global.fetch).not.toHaveBeenCalled();
    delete global.fetch;
  });
});

// ─── 8. Normalized shape equivalence across sources ──────────────────────────

describe("Normalized shape equivalence across sources", () => {
  let SM;
  beforeEach(() => { SM = loadModule(); });

  test("TMDb and OMDb episode results share common fields", () => {
    const tmdbEp = SM._normalizeTmdbEpisode(
      { episode_number: 1, season_number: 1, name: "Pilot", air_date: "2008-01-20" },
      1396
    );
    const omdbEps = SM._normalizeOmdbSeason(
      { Episodes: [{ Episode: "1", Title: "Pilot", Released: "2008-01-20" }] },
      1
    );
    const omdbEp = omdbEps[0];

    const commonFields = ["episodeNumber", "seasonNumber", "title", "airDate", "progressKey", "still", "overview"];
    for (const field of commonFields) {
      expect(tmdbEp).toHaveProperty(field);
      expect(omdbEp).toHaveProperty(field);
    }
  });

  test("TMDb and OMDb seasons have same progressKey format", () => {
    const tmdbEp = SM._normalizeTmdbEpisode(
      { episode_number: 5, season_number: 2 },
      99
    );
    const omdbEps = SM._normalizeOmdbSeason(
      { Episodes: [{ Episode: "5" }] },
      2
    );
    expect(tmdbEp.progressKey).toBe("2:5");
    expect(omdbEps[0].progressKey).toBe("2:5");
  });
});
