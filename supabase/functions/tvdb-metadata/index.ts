/**
 * tvdb-metadata — Supabase Edge Function for TheTVDB v4.
 *
 * Proxies approved TheTVDB v4 operations on behalf of the website client.
 * The API key and bearer token are never returned to the caller.
 *
 * Allowed actions:  resolve | series | seasons | episodes | episodeTotals
 *
 * Secret env vars read with Deno.env.get():
 *   TVDB_API_KEY   (required)
 *   TVDB_PIN       (optional subscriber PIN — leave empty if not needed)
 *   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY — series_metadata_cache
 */

import {
  isForceRefresh,
  readSeriesCache,
  writeSeriesCache,
  TTL_EPISODES_MS,
  TTL_RESOLVE_MS,
  TTL_SERIES_MS,
  withSeriesCache,
} from "../_shared/series-metadata-cache.ts";

const TVDB_BASE = "https://api4.thetvdb.com/v4";
const ALLOWED_ACTIONS = new Set([
  "resolve",
  "series",
  "seasons",
  "episodes",
  "episodeTotals",
  "allEpisodes",
  "relatedMovies",
]);

// CORS headers — required for browser fetch from the website
const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// ── Bearer token state (module-level; reused while the instance is alive) ─
// TVDB v4 tokens are valid for ~30 days. Refresh after 25 days to be safe.
let _token: string | null = null;
let _tokenAt = 0;
const TOKEN_TTL_MS = 25 * 24 * 60 * 60 * 1000;

async function acquireToken(forceRefresh = false): Promise<string> {
  if (!forceRefresh && _token && Date.now() - _tokenAt < TOKEN_TTL_MS) {
    return _token;
  }

  const apiKey = Deno.env.get("TVDB_API_KEY");
  if (!apiKey) {
    console.error("[tvdb-metadata] TVDB_API_KEY secret is not set");
    throw new Error("TVDB_API_KEY is not configured");
  }

  const pin = Deno.env.get("TVDB_PIN");
  const loginBody: Record<string, string> = { apikey: apiKey };
  if (pin) loginBody.pin = pin;

  const resp = await fetch(`${TVDB_BASE}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(loginBody),
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    // Log the TVDB error response for diagnostics — key value is never logged
    console.error(`[tvdb-metadata] login failed status=${resp.status} body=${body.slice(0, 200)}`);
    throw new Error(`TVDB authentication failed (${resp.status})`);
  }

  const json = await resp.json() as Record<string, unknown>;
  const tok = (json?.data as Record<string, unknown>)?.token as string | undefined;
  if (typeof tok !== "string" || !tok) {
    console.error("[tvdb-metadata] login succeeded but no token in response");
    throw new Error("TVDB returned no token");
  }

  _token = tok;
  _tokenAt = Date.now();
  return _token;
}

/**
 * Authenticated GET against TheTVDB v4.
 * Retries once after a 401 (force-refreshes the bearer token).
 */
async function tvdbGet(path: string, retried = false): Promise<unknown> {
  const token = await acquireToken();
  const resp = await fetch(`${TVDB_BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });

  if (resp.status === 401 && !retried) {
    _token = null; // force re-auth on next call
    return tvdbGet(path, true);
  }

  if (!resp.ok) {
    throw new Error(`TVDB responded ${resp.status} for path ${path}`);
  }

  return resp.json();
}

// ── Safe type coercions ───────────────────────────────────────────────────
function s(v: unknown): string { return typeof v === "string" ? v.trim() : ""; }
function n(v: unknown): number | null { const x = Number(v); return isFinite(x) ? x : null; }

/** TVDB marks feature films in season 0 with isMovie and/or linkedMovie.
 *  Note: `isMovie` is often the linked movie id (int64), not a 0/1 flag. */
function tvdbEpisodeMovieFlags(ep: Record<string, unknown>) {
  const linkedMovieId = n(ep.linkedMovie);
  const isMovieRaw = n(ep.isMovie);
  // True when API sends boolean true, 1, or any positive movie id.
  const flagged =
    ep.isMovie === true ||
    (isMovieRaw != null && isMovieRaw > 0) ||
    (linkedMovieId != null && linkedMovieId > 0);
  const resolvedLinked =
    linkedMovieId != null && linkedMovieId > 0
      ? linkedMovieId
      : isMovieRaw != null && isMovieRaw > 1
        ? isMovieRaw
        : null;
  return { isMovie: flagged, linkedMovieId: resolvedLinked };
}
function a(v: unknown): unknown[] { return Array.isArray(v) ? v : []; }

const TVDB_ART = "https://artworks.thetvdb.com";

function imgUrl(v: unknown): string {
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return imgUrl(o.url ?? o.image ?? o.fileName ?? "");
  }
  const url = s(v);
  if (!url) return "";
  if (url.startsWith("https://")) return url;
  if (url.startsWith("http://")) return `https://${url.slice(7)}`;
  if (url.startsWith("//")) return `https:${url}`;
  if (url.startsWith("/")) return `${TVDB_ART}${url}`;
  return "";
}

/** Fill missing episode stills from per-episode records when the list omits artwork. */
async function enrichEpisodeStills(
  episodes: Array<{ tvdbEpId: number | null; still: string }>,
): Promise<void> {
  const missing = episodes.filter((ep) => !ep.still && ep.tvdbEpId);
  if (!missing.length) return;
  // Cap parallelism — 48 concurrent episode fetches saturates mobile season open.
  const STILL_CONCURRENCY = 8;
  const capped = missing.slice(0, 48);
  for (let i = 0; i < capped.length; i += STILL_CONCURRENCY) {
    const batch = capped.slice(i, i + STILL_CONCURRENCY);
    await Promise.all(
      batch.map(async (ep) => {
        try {
          const data = (await tvdbGet(`/episodes/${ep.tvdbEpId}`)) as {
            data?: { image?: unknown };
          };
          const url = imgUrl(data?.data?.image);
          if (url) ep.still = url;
        } catch {
          // leave empty — renderer shows placeholder
        }
      }),
    );
  }
}

/**
 * Season-0 list rows often omit isMovie / linkedMovie / runtime for feature
 * films. Pull extended episode records for specials that still look ambiguous.
 */
async function enrichSeason0MovieFlags(
  episodes: Array<{
    tvdbEpId: number | null;
    isMovie: boolean;
    linkedMovieId: number | null;
    runtimeMinutes: number | null;
    title: string;
    still: string;
  }>,
): Promise<void> {
  const needs = episodes.filter((ep) => {
    if (!ep.tvdbEpId) return false;
    if (ep.isMovie) return false;
    if (ep.linkedMovieId != null && ep.linkedMovieId > 0) return false;
    // Already long enough to count as a movie without a round-trip.
    if (ep.runtimeMinutes != null && ep.runtimeMinutes >= 80) return false;
    return true;
  });
  if (!needs.length) return;

  const CONCURRENCY = 8;
  const capped = needs.slice(0, 40);
  for (let i = 0; i < capped.length; i += CONCURRENCY) {
    const batch = capped.slice(i, i + CONCURRENCY);
    await Promise.all(
      batch.map(async (ep) => {
        try {
          const data = (await tvdbGet(`/episodes/${ep.tvdbEpId}`)) as {
            data?: Record<string, unknown>;
          };
          const row = data?.data;
          if (!row) return;
          const flags = tvdbEpisodeMovieFlags(row);
          if (flags.isMovie) ep.isMovie = true;
          if (flags.linkedMovieId != null) ep.linkedMovieId = flags.linkedMovieId;
          const runtime = n(row.runtime);
          if (runtime != null && (ep.runtimeMinutes == null || ep.runtimeMinutes <= 0)) {
            ep.runtimeMinutes = runtime;
          }
          if (!ep.still) {
            const url = imgUrl(row.image);
            if (url) ep.still = url;
          }
          const name = s(row.name);
          if (name && (!ep.title || /^episode\s*\d+$/i.test(ep.title))) {
            ep.title = name;
          }
        } catch {
          // keep list row as-is
        }
      }),
    );
  }
}

function isAired(dateStr: string | null): boolean {
  if (!dateStr) return false;
  const t = new Date(dateStr).getTime();
  return !isNaN(t) && t <= Date.now();
}

/** Map app locale (en | ar) to TheTVDB 3-letter language code. */
function tvdbLanguage(locale: unknown): string {
  const loc = s(locale).toLowerCase();
  if (loc === "ar") return "ara";
  return "eng";
}

const TVDB_PAGE_SIZE_HINT = 20;
const TVDB_EPISODE_ORDERS = new Set(["official", "absolute", "default", "dvd"]);

function normalizeEpisodeOrder(raw: unknown, fallback = "official"): string {
  const order = s(raw).toLowerCase();
  return TVDB_EPISODE_ORDERS.has(order) ? order : fallback;
}

/**
 * Paginate /series/{id}/episodes/{order}.
 * Anime long-runners (Naruto 220, Shippuden 500) use absolute order — one
 * continuous block numbered 1..N. Official aired order splits them into many
 * TV seasons (Shippuden S1 = 32 eps), which breaks AniList's single-season list.
 */
async function paginateSeriesEpisodes(
  seriesId: number,
  opts: {
    season?: number;
    lang?: string;
    maxPages?: number;
    order?: string;
  } = {},
): Promise<unknown[]> {
  const order = normalizeEpisodeOrder(opts.order, "official");
  const maxPages = opts.maxPages ?? 40;
  const wantSeason = opts.season != null && opts.season >= 0;
  const seasonParamWorks = order === "official" || order === "default";
  const useSeasonParam = wantSeason && seasonParamWorks;
  const allRaw: unknown[] = [];
  let page = 0;
  // Prefer translated episode lists when we are not using ?season= (which
  // returns untranslated names). Season 0 uses ?season=0 for reliability.
  let useLang = Boolean(opts.lang) && !useSeasonParam;

  while (page < maxPages) {
    let data: any;
    try {
      let path: string;
      if (useSeasonParam) {
        path = `/series/${seriesId}/episodes/${order}?season=${opts.season}&page=${page}`;
      } else if (useLang && opts.lang) {
        path = `/series/${seriesId}/episodes/${order}/${opts.lang}?page=${page}`;
      } else {
        path = `/series/${seriesId}/episodes/${order}?page=${page}`;
      }
      data = await tvdbGet(path);
    } catch (err: unknown) {
      if (useLang && page === 0) {
        useLang = false;
        continue;
      }
      throw err;
    }

    const eps: unknown[] = a(data?.data?.episodes);
    if (!eps.length) break;
    allRaw.push(...eps);

    const hasNext = Boolean(data?.links?.next);
    if (hasNext && page < maxPages - 1) {
      page++;
      continue;
    }
    if (useSeasonParam) break;
    if (eps.length >= 100 && page < maxPages - 1) {
      page++;
      continue;
    }
    if (eps.length >= TVDB_PAGE_SIZE_HINT && page < maxPages - 1) {
      page++;
      continue;
    }
    break;
  }

  return allRaw;
}

/** Fetch a translation record; returns null when unavailable. */
async function fetchTranslation(
  path: string,
): Promise<{ name: string; overview: string } | null> {
  try {
    const data = await tvdbGet(path) as any;
    const t = data?.data;
    if (!t) return null;
    const name = s(t.name);
    const overview = s(t.overview);
    if (!name && !overview) return null;
    return { name, overview };
  } catch {
    return null;
  }
}

/** Look up a TVDB series ID via GET /search/remoteid/{remoteId}. */
async function resolveSeriesByRemoteId(
  remoteId: string,
): Promise<{ tvdbId: number; title: string } | null> {
  try {
    const data = await tvdbGet(
      `/search/remoteid/${encodeURIComponent(remoteId)}`,
    ) as any;
    const items: unknown[] = a(data?.data);
    for (const item of items) {
      const series = (item as any)?.series;
      const tvdbId = n(series?.id);
      if (tvdbId) {
        return { tvdbId, title: s(series?.name) };
      }
    }
    return null;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[tvdb-metadata] remoteid lookup failed for ${remoteId}: ${msg}`);
    return null;
  }
}

// ── Action: resolve ───────────────────────────────────────────────────────
/**
 * Resolve a TheTVDB series ID from an IMDb ID, TMDb ID, or direct TVDB ID.
 * Only exact remote-ID lookups — no loose title matching.
 */
async function actionResolve(
  p: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  // Direct TVDB ID — validate it exists
  if (p.tvdbId != null) {
    const id = n(p.tvdbId);
    if (!id || id <= 0 || !Number.isInteger(id)) return { error: "invalid_tvdb_id" };
    const data = await tvdbGet(`/series/${id}`) as Record<string, unknown>;
    const series = (data as any)?.data;
    if (!series) return { error: "not_found" };
    const remote: unknown[] = a(series.remoteIds);
    const imdbEntry = remote.find((r: any) => r?.sourceName === "IMDB") as any;
    return {
      tvdbId: id,
      matchSource: "direct",
      confidence: "certain",
      imdbId: s(imdbEntry?.id) || null,
    };
  }

  // IMDb ID — GET /search/remoteid/tt1234567
  if (p.imdbId) {
    const imdbId = s(p.imdbId);
    if (!/^tt\d{6,10}$/.test(imdbId)) return { error: "invalid_imdb_id" };

    const hit = await resolveSeriesByRemoteId(imdbId);
    if (!hit) return { error: "not_found" };
    return {
      tvdbId: hit.tvdbId,
      matchSource: "imdb",
      confidence: "high",
      title: hit.title,
    };
  }

  // TMDb ID — try several remote-id spellings TVDB has used over time.
  if (p.tmdbId) {
    const tmdbId = n(p.tmdbId);
    if (!tmdbId || tmdbId <= 0 || !Number.isInteger(tmdbId)) {
      return { error: "invalid_tmdb_id" };
    }
    const candidates = [
      String(tmdbId),
      `TheMovieDB.com-${tmdbId}`,
      `themoviedb-${tmdbId}`,
    ];
    for (const remote of candidates) {
      const hit = await resolveSeriesByRemoteId(remote);
      if (hit) {
        return {
          tvdbId: hit.tvdbId,
          matchSource: "tmdb",
          confidence: "medium",
          title: hit.title,
        };
      }
    }
    return { error: "not_found" };
  }

  return { error: "no_identifier_provided" };
}

// ── Action: series ────────────────────────────────────────────────────────
async function actionSeries(
  p: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const id = n(p.tvdbId);
  if (!id || id <= 0 || !Number.isInteger(id)) return { error: "invalid_tvdb_id" };
  const lang = tvdbLanguage(p.locale);

  const data = await tvdbGet(`/series/${id}/extended`) as any;
  const series = data?.data;
  if (!series) return { error: "not_found" };

  const remoteIds: unknown[] = a(series.remoteIds);
  const imdbEntry = remoteIds.find((r: any) => r?.sourceName === "IMDB") as any;

  let title = s(series.name);
  let overview = s(series.overview);
  const translation = await fetchTranslation(`/series/${id}/translations/${lang}`);
  if (translation) {
    if (translation.name) title = translation.name;
    if (translation.overview) overview = translation.overview;
  }

  return {
    source: "tvdb",
    tvdbId: id,
    imdbId: s(imdbEntry?.id) || null,
    title,
    overview,
    status: s((series.status as any)?.name),
    poster: imgUrl(series.image),
    firstAired: s(series.firstAired) || null,
  };
}

// ── Action: seasons ───────────────────────────────────────────────────────
async function actionSeasons(
  p: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const id = n(p.tvdbId);
  if (!id || id <= 0 || !Number.isInteger(id)) return { error: "invalid_tvdb_id" };
  const lang = tvdbLanguage(p.locale);

  const data = await tvdbGet(`/series/${id}/extended`) as any;
  const series = data?.data;
  if (!series) return { error: "not_found" };

  const rawSeasons: unknown[] = a(series.seasons);

  const officialSeasons = rawSeasons
    .filter((season: any) => season?.type?.type === "official")
    .map((season: any) => {
      const num = n(season.number) ?? 0;
      return {
        source: "tvdb",
        seasonNumber: num,
        tvdbSeasonId: n(season.id),
        name: s(season.name) || (num === 0 ? "Specials" : `Season ${num}`),
        poster: imgUrl(season.image),
        overview: s(season.overview),
        airDate: s(season.firstAired) || null,
        isSpecials: num === 0,
        episodeCount: null as number | null,
      };
    })
    .sort((a, b) => a.seasonNumber - b.seasonNumber);

  // Apply per-season translations (parallel — typically a small list).
  await Promise.all(
    officialSeasons.map(async (season) => {
      if (!season.tvdbSeasonId) return;
      const tr = await fetchTranslation(
        `/seasons/${season.tvdbSeasonId}/translations/${lang}`,
      );
      if (!tr) return;
      if (tr.name) season.name = tr.name;
      if (tr.overview) season.overview = tr.overview;
    }),
  );

  return { source: "tvdb", tvdbId: id, seasons: officialSeasons };
}

// ── Action: episodes ──────────────────────────────────────────────────────
/**
 * Return normalized episodes for one season in the default ordering.
 * Paginates automatically (TVDB default page size: 500 episodes).
 */
async function actionEpisodes(
  p: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const id = n(p.tvdbId);
  const allSeasons = p.all === true || p.allSeasons === true;
  const season = n(p.season);
  if (!id || id <= 0 || !Number.isInteger(id)) return { error: "invalid_tvdb_id" };
  if (!allSeasons && (season == null || season < 0)) return { error: "invalid_season" };
  const lang = tvdbLanguage(p.locale);
  const order = normalizeEpisodeOrder(p.order, "official");

  let allEps: unknown[];
  if (allSeasons) {
    allEps = await paginateSeriesEpisodes(id, { lang, maxPages: 80, order });
  } else if (season === 0) {
    // Prefer ?season=0 (feature films / linked movies). Some TVDB responses
    // return an empty page for season=0 — fall back to the full lang list.
    allEps = await paginateSeriesEpisodes(id, {
      season: 0,
      maxPages: 5,
      order,
    });
    if (!allEps.length) {
      allEps = await paginateSeriesEpisodes(id, {
        lang,
        maxPages: 20,
        order,
      });
    }
  } else {
    allEps = await paginateSeriesEpisodes(id, {
      lang,
      maxPages: 10,
      order,
    });
  }

  const seasonFiltered = allSeasons
    ? allEps
    : allEps.filter((ep: any) => {
      const sn = n(ep.seasonNumber);
      if (sn === season) return true;
      // Linked-movie specials sometimes omit seasonNumber.
      if (season === 0 && sn == null) return true;
      return false;
    });

  const episodes = seasonFiltered
    .map((ep: any) => {
      const epNum = n(ep.number);
      const seasonNum = n(ep.seasonNumber) ?? season;
      if (epNum == null) return null;
      if (allSeasons && order !== "absolute" && (seasonNum == null || seasonNum <= 0)) {
        return null;
      }
      const airDate = s(ep.aired) || null;
      const movieFlags = tvdbEpisodeMovieFlags(ep);
      return {
        source: "tvdb",
        tvdbEpId: n(ep.id),
        seriesTvdbId: id,
        seasonNumber: seasonNum,
        episodeNumber: epNum,
        title: s(ep.name) || `Episode ${epNum}`,
        overview: s(ep.overview),
        // episode-specific artwork — empty string when missing so the
        // renderer shows the neutral placeholder instead of a broken image
        still: imgUrl(ep.image),
        runtimeMinutes: n(ep.runtime),
        airDate,
        isAired: isAired(airDate),
        isMovie: movieFlags.isMovie,
        linkedMovieId: movieFlags.linkedMovieId,
        progressKey: `${seasonNum}:${epNum}`,
      };
    })
    .filter(Boolean)
    .sort((a: any, b: any) => {
      if (order === "absolute") {
        return a.episodeNumber - b.episodeNumber;
      }
      if (allSeasons && a.seasonNumber !== b.seasonNumber) {
        return a.seasonNumber - b.seasonNumber;
      }
      return a.episodeNumber - b.episodeNumber;
    });

  if (!allSeasons || !shouldSkipBulkStillEnrichment(episodes.length)) {
    await enrichEpisodeStills(episodes as Array<{ tvdbEpId: number | null; still: string }>);
  }
  if (!allSeasons && season === 0) {
    await enrichSeason0MovieFlags(
      episodes as Array<{
        tvdbEpId: number | null;
        isMovie: boolean;
        linkedMovieId: number | null;
        runtimeMinutes: number | null;
        title: string;
        still: string;
      }>,
    );
  }

  return { source: "tvdb", tvdbId: id, season, episodes };
}

function shouldSkipBulkStillEnrichment(count: number): boolean {
  // Per-episode still fetches for 200–500 eps can exceed edge CPU limits in the browser.
  return count > 100;
}

// ── Action: episodeTotals ─────────────────────────────────────────────────
/**
 * Count regular (non-specials) episodes across all official seasons.
 * Paginates the series-wide official episode list — one series of calls,
 * not one call per season.
 */
async function actionEpisodeTotals(
  p: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const id = n(p.tvdbId);
  if (!id || id <= 0 || !Number.isInteger(id)) return { error: "invalid_tvdb_id" };
  const lang = tvdbLanguage(p.locale);

  const seasonCounts: Record<string, number> = {};
  const allRaw = await paginateSeriesEpisodes(id, { lang, maxPages: 80, order: "official" });
  for (const raw of allRaw) {
    const ep = raw as Record<string, unknown>;
    const sn = n(ep.seasonNumber);
    const epNum = n(ep.number);
    if (sn == null || sn <= 0 || epNum == null) continue;
    const key = String(sn);
    seasonCounts[key] = (seasonCounts[key] || 0) + 1;
  }

  let episodeTotal = 0;
  for (const count of Object.values(seasonCounts)) {
    episodeTotal += count;
  }

  return { source: "tvdb", tvdbId: id, episodeTotal, seasonCounts };
}

// ── Action: allEpisodes ───────────────────────────────────────────────────
/**
 * Return all episodes in one continuous list (absolute order by default).
 * Matches AniList's single-season anime model (Naruto 220, Shippuden 500).
 */
async function actionAllEpisodes(
  p: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const id = n(p.tvdbId);
  if (!id || id <= 0 || !Number.isInteger(id)) return { error: "invalid_tvdb_id" };
  const lang = tvdbLanguage(p.locale);
  const order = normalizeEpisodeOrder(p.order, "absolute");

  const allRaw = await paginateSeriesEpisodes(id, { lang, maxPages: 80, order });

  const episodes = allRaw
    .map((raw) => {
      const ep = raw as Record<string, unknown>;
      const seasonNum = n(ep.seasonNumber);
      const epNum = n(ep.number);
      if (epNum == null) return null;
      if (order !== "absolute" && (seasonNum == null || seasonNum <= 0)) return null;
      const airDate = s(ep.aired) || null;
      const movieFlags = tvdbEpisodeMovieFlags(ep);
      return {
        source: "tvdb",
        tvdbEpId: n(ep.id),
        seriesTvdbId: id,
        seasonNumber: seasonNum,
        episodeNumber: epNum,
        title: s(ep.name) || `Episode ${epNum}`,
        overview: s(ep.overview),
        still: imgUrl(ep.image),
        runtimeMinutes: n(ep.runtime),
        airDate,
        isAired: isAired(airDate),
        isMovie: movieFlags.isMovie,
        linkedMovieId: movieFlags.linkedMovieId,
        progressKey: `${seasonNum}:${epNum}`,
      };
    })
    .filter(Boolean)
    .sort((a: any, b: any) => {
      if (order === "absolute") {
        return a.episodeNumber - b.episodeNumber;
      }
      if (a.seasonNumber !== b.seasonNumber) {
        return a.seasonNumber - b.seasonNumber;
      }
      return a.episodeNumber - b.episodeNumber;
    });

  if (!shouldSkipBulkStillEnrichment(episodes.length)) {
    await enrichEpisodeStills(
      episodes as Array<{ tvdbEpId: number | null; still: string }>,
    );
  }

  return { source: "tvdb", tvdbId: id, order, episodes };
}

const TV_SPECIAL_NON_MOVIE_TITLE =
  /\b(story\s+so\s+far|recap|making\s+of|behind\s+the\s+scenes|featurette|trailer|preview|deleted\s+scenes?|clip\s+show|retrospective|look\s+back|highlights?)\b/i;

function isTvSpecialNonMovieTitle(title: string): boolean {
  const t = s(title);
  if (!t) return false;
  if (TV_SPECIAL_NON_MOVIE_TITLE.test(t)) return true;
  if (/^the\s+making\b/i.test(t)) return true;
  return false;
}

function isMovieLikeTvSpecialRow(ep: {
  isMovie?: boolean;
  linkedMovieId?: number | null;
  runtimeMinutes?: number | null;
  title?: string;
}): boolean {
  if (ep.isMovie === true) return true;
  const linked = n(ep.linkedMovieId);
  if (linked != null && linked > 0) return true;
  if (isTvSpecialNonMovieTitle(ep.title || "")) return false;
  const runtime = n(ep.runtimeMinutes);
  return runtime != null && runtime >= 80;
}

function pickMovieAgeRating(ratings: unknown): string {
  const list = a(ratings) as Array<Record<string, unknown>>;
  if (!list.length) return "";
  const prefer = new Set(["usa", "us", "gbr", "gb", "can", "ca", "aus", "au"]);
  for (const row of list) {
    const country = s(row.country).toLowerCase();
    const name = s(row.name) || s(row.fullName);
    if (name && prefer.has(country)) return name;
  }
  for (const row of list) {
    const name = s(row.name) || s(row.fullName);
    if (name) return name;
  }
  return "";
}

function pickMovieImdbId(remoteIds: unknown): string | null {
  for (const raw of a(remoteIds)) {
    const row = raw as Record<string, unknown>;
    const source = s(row.sourceName).toLowerCase();
    const id = s(row.id);
    if ((source === "imdb" || source === "imdb.com") && /^tt\d{6,10}$/i.test(id)) {
      return id.toLowerCase();
    }
  }
  return null;
}

/**
 * Fill poster / genres / age rating / IMDb from the linked TVDB movie record.
 * Related-movie lists are tiny (usually 1–2), so a few /movies/{id}/extended
 * calls stay cheap and avoid episode screencaps as “posters”.
 */
async function enrichRelatedMovieCards(
  movies: Array<Record<string, unknown>>,
): Promise<void> {
  const needs = movies.filter((m) => {
    const linked = n(m.linkedMovieId);
    return linked != null && linked > 0;
  });
  if (!needs.length) return;

  const CONCURRENCY = 4;
  for (let i = 0; i < needs.length; i += CONCURRENCY) {
    const batch = needs.slice(i, i + CONCURRENCY);
    await Promise.all(
      batch.map(async (movie) => {
        const linked = n(movie.linkedMovieId);
        if (!linked) return;
        try {
          const data = (await tvdbGet(`/movies/${linked}/extended`)) as {
            data?: Record<string, unknown>;
          };
          const row = data?.data;
          if (!row) return;

          const poster = imgUrl(row.image);
          if (poster) movie.poster = poster;

          const genres = a(row.genres)
            .map((g) => s((g as Record<string, unknown>)?.name))
            .filter(Boolean)
            .slice(0, 6);
          if (genres.length) movie.genres = genres;

          const age = pickMovieAgeRating(row.contentRatings);
          if (age) movie.ageRating = age;

          const imdbId = pickMovieImdbId(row.remoteIds);
          if (imdbId) movie.imdbId = imdbId;

          const name = s(row.name);
          if (name) movie.title = name;

          const overview = s(row.overview);
          if (overview) movie.overview = overview;

          const runtime = n(row.runtime);
          if (runtime != null && runtime > 0) movie.runtimeMinutes = runtime;

          const release = row.first_release as Record<string, unknown> | undefined;
          const releaseDate = s(release?.date);
          if (releaseDate.length >= 4) {
            movie.year = releaseDate.slice(0, 4);
            movie.airDate = releaseDate;
          }
        } catch {
          // keep episode-derived fields
        }
      }),
    );
  }
}

/**
 * Feature films linked to a series (season 0 / specials).
 * Runs season-0 fetch + movie-flag enrichment, then returns only movie rows.
 */
async function actionRelatedMovies(
  p: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const id = n(p.tvdbId);
  if (!id || id <= 0 || !Number.isInteger(id)) return { error: "invalid_tvdb_id" };

  const seasonResult = await actionEpisodes({
    ...p,
    tvdbId: id,
    season: 0,
    all: false,
    allSeasons: false,
  });
  if (seasonResult.error) return seasonResult;

  const episodes = Array.isArray(seasonResult.episodes)
    ? (seasonResult.episodes as Array<Record<string, unknown>>)
    : [];
  const movies = episodes
    .filter((ep) =>
      isMovieLikeTvSpecialRow({
        isMovie: ep.isMovie === true,
        linkedMovieId: n(ep.linkedMovieId),
        runtimeMinutes: n(ep.runtimeMinutes),
        title: s(ep.title),
      })
    )
    .map((ep) => ({
      source: "tvdb",
      tvdbEpId: n(ep.tvdbEpId),
      seriesTvdbId: id,
      seasonNumber: n(ep.seasonNumber) ?? 0,
      episodeNumber: n(ep.episodeNumber),
      title: s(ep.title),
      overview: s(ep.overview),
      // Prefer linked-movie poster after enrichment; still is a last-resort fallback.
      still: s(ep.still),
      poster: "",
      runtimeMinutes: n(ep.runtimeMinutes),
      airDate: ep.airDate ?? null,
      isMovie: true,
      linkedMovieId: n(ep.linkedMovieId),
      year: s(ep.airDate).slice(0, 4),
      genres: [] as string[],
      ageRating: "",
      imdbId: null as string | null,
      contentType: "movies",
    }))
    .filter((m) => m.title);

  await enrichRelatedMovieCards(movies);

  for (const movie of movies) {
    if (!s(movie.poster) && s(movie.still)) movie.poster = s(movie.still);
  }

  return { source: "tvdb", tvdbId: id, movies };
}

// ── Request handler ───────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), {
      status: 405,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  // Parse request body
  let body: Record<string, unknown>;
  try {
    body = await req.json() as Record<string, unknown>;
  } catch {
    return new Response(JSON.stringify({ error: "invalid_json" }), {
      status: 400,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  // Validate action against allowlist — rejects arbitrary proxy requests
  const action = s(body?.action);
  if (!ALLOWED_ACTIONS.has(action)) {
    return new Response(JSON.stringify({ error: "unsupported_action" }), {
      status: 400,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  try {
    const forceRefresh = isForceRefresh(body);
    const locale = s(body.locale) || "en";
    const lang = tvdbLanguage(locale);
    let result: unknown;

    switch (action) {
      case "resolve": {
        const tvdbId = n(body.tvdbId);
        const imdbId = s(body.imdbId);
        const tmdbId = n(body.tmdbId);
        const resolveKey = tvdbId
          ? `tvdb:v1:resolve:id:${tvdbId}`
          : imdbId
            ? `tvdb:v1:resolve:imdb:${imdbId}`
            : tmdbId
              ? `tvdb:v1:resolve:tmdb:${tmdbId}`
              : "";
        result = resolveKey
          ? await withSeriesCache({
              cacheKey: resolveKey,
              provider: "tvdb",
              kind: "resolve",
              locale: "en",
              ttlMs: TTL_RESOLVE_MS,
              forceRefresh,
              compute: () => actionResolve(body),
            })
          : await actionResolve(body);
        break;
      }
      case "series": {
        const id = n(body.tvdbId);
        result = id
          ? await withSeriesCache({
              cacheKey: `tvdb:v1:series:${id}:${lang}`,
              provider: "tvdb",
              kind: "series",
              locale: lang,
              ttlMs: TTL_SERIES_MS,
              forceRefresh,
              compute: () => actionSeries(body),
            })
          : await actionSeries(body);
        break;
      }
      case "seasons": {
        const id = n(body.tvdbId);
        result = id
          ? await withSeriesCache({
              cacheKey: `tvdb:v1:seasons:${id}:${lang}`,
              provider: "tvdb",
              kind: "seasons",
              locale: lang,
              ttlMs: TTL_SERIES_MS,
              forceRefresh,
              compute: () => actionSeasons(body),
            })
          : await actionSeasons(body);
        break;
      }
      case "episodes": {
        const id = n(body.tvdbId);
        const season = n(body.season);
        const allSeasons = body.all === true || body.allSeasons === true;
        const order = normalizeEpisodeOrder(body.order, "official");
        const cacheKey = id
          ? allSeasons
            ? `tvdb:v3:episodes-all:${id}:${lang}:${order}`
            : `tvdb:v4:episodes:${id}:${season ?? "x"}:${lang}:${order}`
          : "";
        result = cacheKey
          ? await withSeriesCache({
              cacheKey,
              provider: "tvdb",
              kind: allSeasons ? "episodes_all" : "episodes",
              locale: lang,
              ttlMs: TTL_EPISODES_MS,
              forceRefresh,
              compute: () => actionEpisodes(body),
            })
          : await actionEpisodes(body);
        break;
      }
      case "relatedMovies": {
        const id = n(body.tvdbId);
        if (!id) {
          result = await actionRelatedMovies(body);
          break;
        }
        const relatedKey = `tvdb:v3:relatedMovies:${id}:${lang}`;
        if (!forceRefresh) {
          const hit = await readSeriesCache(relatedKey);
          if (hit && Array.isArray(hit.movies) && hit.movies.length > 0) {
            result = hit;
            break;
          }
        }
        // Never cache/serve empty related lists — recompute when no positive hit.
        const fresh = await actionRelatedMovies(body);
        if (
          fresh &&
          !fresh.error &&
          Array.isArray(fresh.movies) &&
          fresh.movies.length > 0
        ) {
          await writeSeriesCache({
            cacheKey: relatedKey,
            provider: "tvdb",
            kind: "relatedMovies",
            locale: lang,
            payload: fresh,
            ttlMs: TTL_SERIES_MS,
          });
        }
        result = fresh;
        break;
      }
      case "episodeTotals": {
        const id = n(body.tvdbId);
        result = id
          ? await withSeriesCache({
              cacheKey: `tvdb:v1:episodeTotals:${id}:${lang}`,
              provider: "tvdb",
              kind: "episodeTotals",
              locale: lang,
              ttlMs: TTL_SERIES_MS,
              forceRefresh,
              compute: () => actionEpisodeTotals(body),
            })
          : await actionEpisodeTotals(body);
        break;
      }
      case "allEpisodes": {
        const id = n(body.tvdbId);
        const order = normalizeEpisodeOrder(body.order, "absolute");
        result = id
          ? await withSeriesCache({
              cacheKey: `tvdb:v1:allEpisodes:${id}:${lang}:${order}`,
              provider: "tvdb",
              kind: "allEpisodes",
              locale: lang,
              ttlMs: TTL_EPISODES_MS,
              forceRefresh,
              compute: () => actionAllEpisodes(body),
            })
          : await actionAllEpisodes(body);
        break;
      }
      default:
        result = { error: "unsupported_action" };
    }

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  } catch (err: unknown) {
    // Sanitize the error message before logging — never include key/token/pin values
    const rawMsg = err instanceof Error ? err.message : String(err);
    const safeMsg = rawMsg.replace(/apikey[^,\s]*/gi, "[REDACTED]");
    console.error("[tvdb-metadata] handler error:", safeMsg);

    return new Response(JSON.stringify({ error: "internal_error" }), {
      status: 500,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});
