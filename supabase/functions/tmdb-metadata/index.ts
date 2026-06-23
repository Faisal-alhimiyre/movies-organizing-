/**
 * tmdb-metadata — Supabase Edge Function for TMDB episode ratings.
 *
 * Proxies a small allowlisted subset of TMDB v3 calls so the browser never
 * needs a client-side TMDB API key for per-episode ratings.
 *
 * Allowed actions: resolve | seasonRatings
 *
 * Secret env vars:
 *   TMDB_API_KEY   (required)
 */

const TMDB_BASE = "https://api.themoviedb.org/3";
const ALLOWED_ACTIONS = new Set(["resolve", "seasonRatings"]);

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
