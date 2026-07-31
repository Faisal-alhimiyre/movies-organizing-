/**
 * Shared series/season/episode catalog cache for Edge Functions.
 * Table: public.series_metadata_cache (see migrate-series-metadata-cache.sql)
 */
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

export const SERIES_CACHE_TABLE = "series_metadata_cache";

export const TTL_SERIES_MS = 7 * 24 * 60 * 60 * 1000;
export const TTL_EPISODES_MS = 24 * 60 * 60 * 1000;
export const TTL_RESOLVE_MS = 30 * 24 * 60 * 60 * 1000;
export const TTL_RATINGS_MS = 24 * 60 * 60 * 1000;

let _client: SupabaseClient | null = null;

export function getServiceSupabase(): SupabaseClient | null {
  if (_client) return _client;
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!url || !key) return null;
  _client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return _client;
}

export function isForceRefresh(body: Record<string, unknown>): boolean {
  return body?.forceRefresh === true || body?.bypassCache === true;
}

export async function readSeriesCache(
  cacheKey: string,
): Promise<Record<string, unknown> | null> {
  const sb = getServiceSupabase();
  if (!sb || !cacheKey) return null;
  try {
    const { data, error } = await sb
      .from(SERIES_CACHE_TABLE)
      .select("payload, expires_at")
      .eq("cache_key", cacheKey)
      .maybeSingle();
    if (error || !data) return null;
    const expiresAt = data.expires_at ? Date.parse(String(data.expires_at)) : 0;
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return null;
    const payload = data.payload;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return null;
    }
    return payload as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function writeSeriesCache(opts: {
  cacheKey: string;
  provider: "tmdb" | "tvdb" | "anilist" | "omdb";
  kind: string;
  locale?: string;
  payload: Record<string, unknown>;
  ttlMs: number;
}): Promise<void> {
  const sb = getServiceSupabase();
  if (!sb || !opts.cacheKey || !opts.payload) return;
  // Never persist error envelopes.
  if (opts.payload.error) return;

  const now = new Date();
  const expires = new Date(now.getTime() + Math.max(60_000, opts.ttlMs));
  try {
    await sb.from(SERIES_CACHE_TABLE).upsert(
      {
        cache_key: opts.cacheKey,
        provider: opts.provider,
        kind: opts.kind,
        locale: opts.locale || "en",
        payload: opts.payload,
        fetched_at: now.toISOString(),
        expires_at: expires.toISOString(),
        updated_at: now.toISOString(),
      },
      { onConflict: "cache_key" },
    );
  } catch {
    // Fail open — upstream result still returned to the caller.
  }
}

/** Cache-aside helper: return cached payload or compute, store, and return. */
export async function withSeriesCache<T extends Record<string, unknown>>(opts: {
  cacheKey: string;
  provider: "tmdb" | "tvdb" | "anilist" | "omdb";
  kind: string;
  locale?: string;
  ttlMs: number;
  forceRefresh?: boolean;
  compute: () => Promise<T>;
}): Promise<T> {
  if (!opts.forceRefresh) {
    const hit = await readSeriesCache(opts.cacheKey);
    if (hit) return hit as T;
  }
  const fresh = await opts.compute();
  if (fresh && !fresh.error) {
    await writeSeriesCache({
      cacheKey: opts.cacheKey,
      provider: opts.provider,
      kind: opts.kind,
      locale: opts.locale,
      payload: fresh,
      ttlMs: opts.ttlMs,
    });
  }
  return fresh;
}
