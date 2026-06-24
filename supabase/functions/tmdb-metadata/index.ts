/**
 * tmdb-metadata — Supabase Edge Function for TMDB episode ratings.
 *
 * Proxies a small allowlisted subset of TMDB v3 calls so the browser never
 * needs a client-side TMDB API key for per-episode ratings.
 *
 * Allowed actions: resolve | seasonRatings | search | details | tvFetch
 *
 * Secret env vars:
 *   TMDB_API_KEY   (required)
 */

const TMDB_BASE = "https://api.themoviedb.org/3";
const ALLOWED_ACTIONS = new Set([
  "resolve",
  "seasonRatings",
  "search",
  "details",
  "tvFetch",
]);

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function s(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function n(v: unknown): number | null {
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}

function tmdbLanguage(locale: unknown): string {
  return s(locale).toLowerCase() === "ar" ? "ar-SA" : "en-US";
}

function hasArabicScript(text: string): boolean {
  return /[\u0600-\u06FF]/.test(text);
}

/** Title language follows the search query, not the app UI language. */
function titleLocaleFromQuery(query: unknown): "ar" | "en" {
  return hasArabicScript(s(query)) ? "ar" : "en";
}

function resolveTitleLocale(p: Record<string, unknown>): "ar" | "en" {
  const query = s(p.query).trim();
  if (query) return titleLocaleFromQuery(query);
  const locale = s(p.titleLocale || p.locale).toLowerCase();
  return locale === "ar" ? "ar" : "en";
}

function pickLocalizedTitle(
  lang: string,
  localizedTitle: string,
  originalTitle: string,
  originalLang: string,
): string {
  if (lang !== "ar-SA") return localizedTitle || originalTitle;
  if (hasArabicScript(localizedTitle)) return localizedTitle;
  if (hasArabicScript(originalTitle)) return originalTitle;
  if (originalLang === "ar" && originalTitle) return originalTitle;
  return localizedTitle || originalTitle;
}

function pickLocalizedText(localText: string, enText: string): string {
  const local = s(localText);
  const en = s(enText);
  return local || en;
}

function formatRuntimeLabel(minutes: number, lang: string): string {
  if (lang === "ar-SA") return `${minutes} دقيقة`;
  return `${minutes} min`;
}

/** TMDB translations / alternative titles — many Arabic films only have ar titles here. */
async function fetchArabicTitle(
  mediaType: string,
  tmdbId: number,
): Promise<string> {
  const trJson = await tmdbGet(`${mediaType}/${tmdbId}/translations`);
  const translations = Array.isArray(trJson?.translations)
    ? trJson.translations
    : [];
  for (const row of translations as Record<string, unknown>[]) {
    if (s(row.iso_639_1) !== "ar" && s(row.iso_3166_1) !== "SA") continue;
    const data = row.data as Record<string, unknown> | undefined;
    const title = s(data?.title || data?.name);
    if (hasArabicScript(title)) return title;
  }

  const altJson = await tmdbGet(`${mediaType}/${tmdbId}/alternative_titles`);
  const altRows = Array.isArray(altJson?.titles)
    ? altJson.titles
    : Array.isArray(altJson?.results)
      ? altJson.results
      : [];
  for (const row of altRows as Record<string, unknown>[]) {
    const title = s(row.title);
    if (hasArabicScript(title)) return title;
  }

  return "";
}

async function ensureArabicTitle(
  lang: string,
  mediaType: string,
  tmdbId: number,
  title: string,
): Promise<string> {
  if (lang !== "ar-SA" || hasArabicScript(title) || !tmdbId) return title;
  const ar = await fetchArabicTitle(mediaType, tmdbId);
  return ar || title;
}

function roundRating(v: number): number {
  return Math.round(v * 10) / 10;
}

async function tmdbGet(
  path: string,
  params: Record<string, string> = {},
): Promise<Record<string, unknown> | null> {
  const apiKey = Deno.env.get("TMDB_API_KEY");
  if (!apiKey) {
    console.error("[tmdb-metadata] TMDB_API_KEY secret is not set");
    throw new Error("TMDB_API_KEY is not configured");
  }

  const url = new URL(`${TMDB_BASE}/${path.replace(/^\//, "")}`);
  url.searchParams.set("api_key", apiKey);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  const resp = await fetch(url.toString(), {
    headers: { Accept: "application/json" },
  });
  if (resp.status === 429 || !resp.ok) return null;
  return (await resp.json()) as Record<string, unknown>;
}

/** IMDb series ID → TMDB TV show ID */
async function actionResolve(
  p: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const imdbId = s(p.imdbId);
  if (!/^tt\d{6,10}$/.test(imdbId)) return { error: "invalid_imdb_id" };

  const json = await tmdbGet(`find/${imdbId}`, { external_source: "imdb_id" });
  const tvResults = Array.isArray(json?.tv_results) ? json.tv_results : [];
  const first = tvResults[0] as Record<string, unknown> | undefined;
  const tmdbId = n(first?.id);
  if (!tmdbId) return { error: "not_found" };
  return { tmdbId };
}

/** Per-episode vote_average for one season */
async function actionSeasonRatings(
  p: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const tmdbId = n(p.tmdbId);
  const season = n(p.season);
  if (!tmdbId || tmdbId <= 0 || season == null || season < 0) {
    return { error: "missing_params" };
  }

  const lang = tmdbLanguage(p.locale);
  const json = await tmdbGet(`tv/${tmdbId}/season/${season}`, { language: lang });
  if (!json) return { error: "api_failure" };

  const rawEps = Array.isArray(json.episodes) ? json.episodes : [];
  const episodes = rawEps
    .map((ep) => {
      const row = ep as Record<string, unknown>;
      const episodeNumber = n(row.episode_number);
      const vote = n(row.vote_average);
      if (episodeNumber == null) return null;
      const rating =
        vote != null && vote > 0 ? roundRating(vote) : null;
      return {
        episodeNumber,
        rating,
        voteCount: n(row.vote_count) ?? 0,
      };
    })
    .filter(Boolean);

  return { tmdbId, season, episodes };
}

/** Full details for a single movie or TV show — used when no client-side TMDB key */
async function actionDetails(
  p: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const tmdbId = n(p.tmdbId);
  const mediaType = s(p.mediaType); // 'movie' | 'tv'
  if (!tmdbId || (mediaType !== "movie" && mediaType !== "tv")) {
    return { error: "missing_params" };
  }

  const lang = tmdbLanguage(resolveTitleLocale(p));
  const appendTo =
    mediaType === "tv"
      ? "credits,content_ratings,external_ids"
      : "credits,release_dates,external_ids";

  const json = await tmdbGet(`${mediaType}/${tmdbId}`, {
    language: lang,
    append_to_response: appendTo,
  });
  if (!json) return { error: "api_failure" };

  let enJson: Record<string, unknown> | null = null;
  if (lang === "ar-SA") {
    enJson = await tmdbGet(`${mediaType}/${tmdbId}`, {
      language: "en-US",
      append_to_response: appendTo,
    }) as Record<string, unknown> | null;
  }

  const localizedTitle = s(json.title || json.name);
  const originalTitle = s(json.original_title || json.original_name);
  const originalLang = s(json.original_language);
  let title = pickLocalizedTitle(
    lang,
    localizedTitle,
    originalTitle,
    originalLang,
  );
  let plot = s(json.overview);
  if (lang === "ar-SA" && enJson) {
    title = pickLocalizedText(
      title,
      s(enJson.title || enJson.name),
    );
    plot = pickLocalizedText(plot, s(enJson.overview));
  }
  title = await ensureArabicTitle(lang, mediaType, tmdbId, title);
  const date = s(json.release_date || json.first_air_date);
  const year = date.length >= 4 ? date.substring(0, 4) : "";
  const poster = s(json.poster_path);
  const vote = n(json.vote_average);
  const rating =
    vote != null && vote > 0 ? String(roundRating(vote)) : "";

  const actors = (Array.isArray((json.credits as Record<string, unknown>)?.cast)
    ? ((json.credits as Record<string, unknown>).cast as Record<string, unknown>[])
    : []
  )
    .slice(0, 6)
    .map((person) => s(person.name))
    .filter(Boolean);

  const genres = (Array.isArray(json.genres)
    ? (json.genres as Record<string, unknown>[])
    : []
  )
    .map((g) => s(g.name))
    .filter(Boolean);

  const externalIds = json.external_ids as Record<string, unknown> | undefined;
  const imdbId =
    s(externalIds?.imdb_id) || s(json.imdb_id) || null;

  // Age rating
  let ageRating = "";
  if (mediaType === "tv") {
    const ratings = (json.content_ratings as Record<string, unknown>)?.results;
    if (Array.isArray(ratings)) {
      const us = (ratings as Record<string, unknown>[]).find(
        (r) => s(r.iso_3166_1) === "US",
      );
      ageRating = us ? s(us.rating) : "";
    }
  } else {
    const releaseDates = (json.release_dates as Record<string, unknown>)?.results;
    if (Array.isArray(releaseDates)) {
      const us = (releaseDates as Record<string, unknown>[]).find(
        (r) => s(r.iso_3166_1) === "US",
      );
      if (us) {
        const dates = us.release_dates as Record<string, unknown>[];
        if (Array.isArray(dates)) {
          ageRating = s(dates[0]?.certification);
        }
      }
    }
  }

  // Runtime
  let runtime = "";
  if (mediaType === "tv") {
    const times = (Array.isArray(json.episode_run_time)
      ? (json.episode_run_time as number[])
      : []
    ).filter((t) => t > 0);
    if (times.length) {
      const avg = Math.round(times.reduce((a, b) => a + b, 0) / times.length);
      runtime = formatRuntimeLabel(avg, lang);
    }
  } else {
    const rt = n(json.runtime);
    if (rt && rt > 0) runtime = formatRuntimeLabel(rt, lang);
  }

  const seasonCount =
    mediaType === "tv" ? (n(json.number_of_seasons) ?? null) : null;
  const episodeCount =
    mediaType === "tv" ? (n(json.number_of_episodes) ?? null) : null;

  const link = imdbId
    ? `https://www.imdb.com/title/${imdbId}/`
    : `https://www.themoviedb.org/${mediaType}/${tmdbId}`;

  return {
    ok: true,
    details: {
      source: "tmdb",
      imdbId,
      tmdbType: mediaType,
      tmdbId,
      link,
      title,
      year,
      plot,
      poster: poster ? `https://image.tmdb.org/t/p/w500${poster}` : "",
      rating,
      actors,
      genres,
      mediaType: mediaType === "tv" ? "series" : "movie",
      omdbType: mediaType === "tv" ? "series" : "movie",
      ageRating,
      runtime,
      seasonCount,
      episodeCount,
    },
  };
}

/** Raw TMDB TV show or season JSON — used when no client-side TMDB key */
async function actionTvFetch(
  p: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const tmdbId = n(p.tmdbId);
  const season = n(p.season);
  if (!tmdbId || tmdbId <= 0) return { error: "missing_params" };

  const lang = tmdbLanguage(resolveTitleLocale(p));
  const path =
    season != null && season >= 0
      ? `tv/${tmdbId}/season/${season}`
      : `tv/${tmdbId}`;

  const json = await tmdbGet(path, { language: lang });
  if (!json) return { error: "api_failure" };
  return { ok: true, data: json };
}

/** Multi/movie/TV title text search — returns normalized result rows */
async function actionSearch(
  p: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const query = s(p.query).trim();
  if (query.length < 2) return { error: "query_too_short" };

  const type = s(p.type) || "multi"; // "multi" | "movie" | "tv"
  const page = Math.max(1, n(p.page) ?? 1);
  const titleLocale = titleLocaleFromQuery(query);
  const lang = tmdbLanguage(titleLocale);

  const endpoint =
    type === "movie"
      ? "search/movie"
      : type === "tv"
        ? "search/tv"
        : "search/multi";

  const json = await tmdbGet(endpoint, {
    query,
    page: String(page),
    language: lang,
    include_adult: "false",
  });

  if (!json) return { error: "api_failure" };

  const rawResults = Array.isArray(json.results) ? json.results : [];

  const results = rawResults
    .map((raw) => {
      const item = raw as Record<string, unknown>;
      // For multi-search, skip persons
      const mediaType =
        endpoint === "search/multi"
          ? s(item.media_type)
          : type === "movie"
            ? "movie"
            : "tv";
      if (mediaType === "person") return null;

      const isMovie = mediaType === "movie";

      // For Arabic locale, prefer the original title when the show's original
      // language is Arabic (e.g. Egyptian series stored with original_name in Arabic).
      const originalLang = s(item.original_language);
      const localizedTitle = s(item.title || item.name);
      const originalTitle = s(item.original_title || item.original_name);
      const title = pickLocalizedTitle(
        lang,
        localizedTitle,
        originalTitle,
        originalLang,
      );
      if (!title) return null;

      const date = s(item.release_date || item.first_air_date);
      const year = date.length >= 4 ? date.substring(0, 4) : "";
      const poster = s(item.poster_path);
      const tmdbId = n(item.id);
      if (!tmdbId) return null;

      return {
        source: "tmdb",
        tmdbType: isMovie ? "movie" : "tv",
        tmdbId,
        imdbId: null as string | null,
        anilistId: null as number | null,
        title,
        year,
        type: isMovie ? "movie" : "series",
        poster: poster ? `https://image.tmdb.org/t/p/w92${poster}` : "",
        resultKey: `tmdb:${isMovie ? "movie" : "tv"}:${tmdbId}`,
      };
    })
    .filter(Boolean) as Array<{
      source: string;
      tmdbType: string;
      tmdbId: number;
      imdbId: string | null;
      anilistId: number | null;
      title: string;
      year: string;
      type: string;
      poster: string;
      resultKey: string;
    }>;

  if (lang === "ar-SA") {
    await Promise.all(
      results.map(async (row) => {
        if (hasArabicScript(row.title)) return;
        const ar = await ensureArabicTitle(
          lang,
          row.tmdbType,
          row.tmdbId,
          row.title,
        );
        if (ar) row.title = ar;
      }),
    );
  }

  return {
    ok: true,
    results,
    total: n(json.total_results) ?? results.length,
    totalPages: n(json.total_pages) ?? 1,
    page,
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), {
      status: 405,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return new Response(JSON.stringify({ error: "invalid_json" }), {
      status: 400,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

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
      case "resolve":
        result = await actionResolve(body);
        break;
      case "seasonRatings":
        result = await actionSeasonRatings(body);
        break;
      case "details":
        result = await actionDetails(body);
        break;
      case "search":
        result = await actionSearch(body);
        break;
      case "tvFetch":
        result = await actionTvFetch(body);
        break;
      default:
        result = { error: "unsupported_action" };
    }

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  } catch (err: unknown) {
    const rawMsg = err instanceof Error ? err.message : String(err);
    const safeMsg = rawMsg.replace(/api_key[^,\s]*/gi, "[REDACTED]");
    console.error("[tmdb-metadata] handler error:", safeMsg);
    return new Response(JSON.stringify({ error: "internal_error" }), {
      status: 500,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});
