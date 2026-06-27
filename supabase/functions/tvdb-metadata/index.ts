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
 */

const TVDB_BASE = "https://api4.thetvdb.com/v4";
const ALLOWED_ACTIONS = new Set([
  "resolve",
  "series",
  "seasons",
  "episodes",
  "episodeTotals",
  "allEpisodes",
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
  console.log("[tvdb-metadata] login attempt, key length:", apiKey.length);

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
  await Promise.all(
    missing.slice(0, 48).map(async (ep) => {
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
  const wantSeason = opts.season != null && opts.season > 0;
  const seasonParamWorks = order === "official" || order === "default";
  const useSeasonParam = wantSeason && seasonParamWorks;
  const allRaw: unknown[] = [];
  let page = 0;
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
    if (hasNext) {
      page++;
      continue;
    }
    if (useSeasonParam) break;
    if (eps.length >= 100) {
      page++;
      continue;
    }
    if (eps.length >= TVDB_PAGE_SIZE_HINT) {
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

  // TMDb ID — remote source name on TVDB is "TheMovieDB.com"
  if (p.tmdbId) {
    const tmdbId = n(p.tmdbId);
    if (!tmdbId || tmdbId <= 0 || !Number.isInteger(tmdbId)) {
      return { error: "invalid_tmdb_id" };
    }
    const hit = await resolveSeriesByRemoteId(`TheMovieDB.com-${tmdbId}`);
    if (!hit) return { error: "not_found" };
    return {
      tvdbId: hit.tvdbId,
      matchSource: "tmdb",
      confidence: "medium",
      title: hit.title,
    };
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

  const allEps = allSeasons
    ? await paginateSeriesEpisodes(id, { lang, maxPages: 40, order })
    : await paginateSeriesEpisodes(id, {
      // ?season= queries return untranslated episode text; use the lang
      // episode list and filter locally so English/Arabic overviews resolve.
      lang,
      maxPages: 10,
      order,
    });

  const seasonFiltered = allSeasons
    ? allEps
    : allEps.filter((ep: any) => {
      const sn = n(ep.seasonNumber);
      return sn == null || sn === season;
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
  const allEps = await paginateSeriesEpisodes(id, { lang, maxPages: 40, order: "official" });
  for (const raw of allEps) {
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

  const allRaw = await paginateSeriesEpisodes(id, { lang, maxPages: 40, order });

  const episodes = allRaw
    .map((raw) => {
      const ep = raw as Record<string, unknown>;
      const seasonNum = n(ep.seasonNumber);
      const epNum = n(ep.number);
      if (epNum == null) return null;
      if (order !== "absolute" && (seasonNum == null || seasonNum <= 0)) return null;
      const airDate = s(ep.aired) || null;
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
    let result: unknown;
    switch (action) {
      case "resolve":  result = await actionResolve(body);  break;
      case "series":   result = await actionSeries(body);   break;
      case "seasons":  result = await actionSeasons(body);  break;
      case "episodes": result = await actionEpisodes(body); break;
      case "episodeTotals": result = await actionEpisodeTotals(body); break;
      case "allEpisodes": result = await actionAllEpisodes(body); break;
      default:         result = { error: "unsupported_action" };
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
