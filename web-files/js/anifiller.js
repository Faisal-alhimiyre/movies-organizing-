/**
 * anifiller.js — Anime filler/canon labels from the AniFiller community dataset.
 * https://github.com/AniraTeam/AniFiller
 *
 * Exposed as window.WatchlistAniFiller
 */
(function () {
  "use strict";

  const DATA_URL = "data/anifiller.min.json";
  const BADGE_TYPES = new Set(["filler"]);
  const HIDE_TYPES = new Set(["filler"]);

  let _loadPromise = null;
  let _byAnilist = null;
  let _byMal = null;

  function buildIndex(shows) {
    const byAnilist = new Map();
    const byMal = new Map();

    for (const show of shows || []) {
      const mappings = show?.mappings || {};
      const anilistId = Number(mappings.anilist_id);
      const malId = Number(mappings.mal_id);
      const epMap = new Map();
      let hasBadge = false;
      let hasHideable = false;

      for (const ep of show.episodes || []) {
        const num = Number(ep.episode);
        const type = String(ep.type || "").trim();
        if (!Number.isFinite(num) || num <= 0 || !type) continue;
        epMap.set(num, type);
        if (BADGE_TYPES.has(type)) hasBadge = true;
        if (HIDE_TYPES.has(type)) hasHideable = true;
      }

      if (!epMap.size) continue;

      const entry = { epMap, hasBadge, hasHideable };
      if (Number.isFinite(anilistId) && anilistId > 0) byAnilist.set(anilistId, entry);
      if (Number.isFinite(malId) && malId > 0) byMal.set(malId, entry);
    }

    return { byAnilist, byMal };
  }

  function lookup(anilistId, malId) {
    if (!_byAnilist) return null;
    const al = Number(anilistId);
    if (Number.isFinite(al) && al > 0 && _byAnilist.has(al)) return _byAnilist.get(al);
    const mal = Number(malId);
    if (Number.isFinite(mal) && mal > 0 && _byMal.has(mal)) return _byMal.get(mal);
    return null;
  }

  async function ensureLoaded() {
    if (_byAnilist) return true;
    if (!_loadPromise) {
      _loadPromise = fetch(DATA_URL)
        .then((resp) => {
          if (!resp.ok) throw new Error(`AniFiller HTTP ${resp.status}`);
          return resp.json();
        })
        .then((data) => {
          const shows = Array.isArray(data) ? data : [];
          const index = buildIndex(shows);
          _byAnilist = index.byAnilist;
          _byMal = index.byMal;
          return true;
        })
        .catch((err) => {
          console.warn("[anifiller] load failed:", err?.message || err);
          _byAnilist = new Map();
          _byMal = new Map();
          return false;
        });
    }
    return _loadPromise;
  }

  function hasFillerUi(anilistId, malId) {
    const entry = lookup(anilistId, malId);
    return Boolean(entry?.hasBadge);
  }

  function hasHideableFiller(anilistId, malId) {
    const entry = lookup(anilistId, malId);
    return Boolean(entry?.hasHideable);
  }

  function enrichEpisodes(anilistId, malId, episodes) {
    const entry = lookup(anilistId, malId);
    if (!entry || !Array.isArray(episodes)) {
      return { episodes: episodes || [], hasFillerUi: false, hasHideable: false };
    }

    const enriched = episodes.map((ep) => {
      const kind = entry.epMap.get(Number(ep.episodeNumber));
      if (!kind || !BADGE_TYPES.has(kind)) return ep;
      return { ...ep, fillerKind: kind };
    });

    return {
      episodes: enriched,
      hasFillerUi: entry.hasBadge,
      hasHideable: entry.hasHideable,
    };
  }

  function shouldHideEpisode(ep, hideFiller) {
    if (!hideFiller || !ep?.fillerKind) return false;
    return HIDE_TYPES.has(ep.fillerKind);
  }

  function isBadgeKind(kind) {
    return BADGE_TYPES.has(kind);
  }

  window.WatchlistAniFiller = {
    ensureLoaded,
    hasFillerUi,
    hasHideableFiller,
    enrichEpisodes,
    shouldHideEpisode,
    isBadgeKind,
    _buildIndex: buildIndex,
  };
})();
