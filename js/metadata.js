(function () {
  "use strict";

  const CACHE_KEY = "watchlist-metadata-cache-v1";
  const memory = new Map();

  function getApiKey() {
    return window.WATCHLIST_CONFIG?.omdbApiKey?.trim() || "";
  }

  function extractImdbId(url) {
    if (!url) return null;
    const match = String(url).match(/tt\d{7,8}/i);
    return match ? match[0].toLowerCase() : null;
  }

  function readCache() {
    try {
      return JSON.parse(localStorage.getItem(CACHE_KEY) || "{}");
    } catch {
      return {};
    }
  }

  function writeCacheEntry(imdbId, data) {
    const cache = readCache();
    cache[imdbId] = { ...data, cachedAt: Date.now() };
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
    } catch {
      /* ignore quota errors */
    }
    memory.set(imdbId, data);
  }

  function normalizeOmdbPayload(imdbId, json) {
    if (!json || json.Response !== "True") return null;

    return {
      imdbId,
      poster: json.Poster && json.Poster !== "N/A" ? json.Poster : "",
      rating: json.imdbRating && json.imdbRating !== "N/A" ? json.imdbRating : "",
      year: json.Year && json.Year !== "N/A" ? json.Year : "",
      plot: json.Plot && json.Plot !== "N/A" ? json.Plot : "",
      title: json.Title && json.Title !== "N/A" ? json.Title : "",
      runtime: json.Runtime && json.Runtime !== "N/A" ? json.Runtime : "",
    };
  }

  async function fetchFromOmdb(imdbId) {
    const apiKey = getApiKey();
    if (!apiKey) return null;

    const response = await fetch(
      `https://www.omdbapi.com/?i=${encodeURIComponent(imdbId)}&apikey=${encodeURIComponent(apiKey)}`
    );
    if (!response.ok) return null;

    const json = await response.json();
    return normalizeOmdbPayload(imdbId, json);
  }

  async function getMetadata(linkOrId, options = {}) {
    const imdbId = String(linkOrId || "").startsWith("tt")
      ? linkOrId.toLowerCase()
      : extractImdbId(linkOrId);
    if (!imdbId) return null;

    if (!options.refresh && memory.has(imdbId)) {
      return memory.get(imdbId);
    }

    if (!options.refresh) {
      const cached = readCache()[imdbId];
      if (cached) {
        memory.set(imdbId, cached);
        return cached;
      }
    }

    const data = await fetchFromOmdb(imdbId);
    if (data) writeCacheEntry(imdbId, data);
    return data;
  }

  function hasApiKey() {
    return Boolean(getApiKey());
  }

  window.WatchlistMetadata = {
    extractImdbId,
    getMetadata,
    hasApiKey,
    getApiKey,
  };
})();
