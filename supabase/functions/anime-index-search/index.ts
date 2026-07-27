/**
 * anime-index-search — server-side offline anime identity lookup.
 * Self-contained single file for Supabase Dashboard paste deploy.
 *
 * Function name: anime-index-search
 * Data: anime_title_index (ODbL derivative)
 * Source: manami-project/anime-offline-database — ARCHIVED, pinned release 2026-27
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

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

type IndexRow = Record<string, unknown>;

function normalizeImportTitle(title: string): string {
  return String(title || "")
    .trim()
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[''`´]/g, "'")
    .replace(/[＆&]/g, " and ")
    .replace(/\band\b/g, " and ")
    .replace(/[：:]/g, ":")
    .replace(/[-–—]/g, " ")
    .replace(/[^\p{L}\p{N}\s:'.]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function collapseTitleSpaces(title: string): string {
  return normalizeImportTitle(title).replace(/\s+/g, "");
}

function titleVariantScore(queryNorm: string, variantNorm: string) {
  if (!queryNorm || !variantNorm) return { score: 0, reason: "" };
  if (queryNorm === variantNorm) return { score: 130, reason: "exact_normalized" };

  const qCollapsed = collapseTitleSpaces(queryNorm);
  const vCollapsed = collapseTitleSpaces(variantNorm);
  if (qCollapsed && qCollapsed === vCollapsed) {
    return { score: 128, reason: "collapsed_exact" };
  }

  if (
    variantNorm.startsWith(queryNorm + ":") ||
    variantNorm.startsWith(queryNorm + " -") ||
    (variantNorm.startsWith(queryNorm + " ") && variantNorm.length > queryNorm.length + 2)
  ) {
    return { score: 122, reason: "root_subtitle" };
  }

  if (
    qCollapsed &&
    vCollapsed &&
    (vCollapsed.startsWith(qCollapsed + ":") ||
      (vCollapsed.startsWith(qCollapsed) && vCollapsed.length > qCollapsed.length + 2))
  ) {
    return { score: 120, reason: "root_subtitle_collapsed" };
  }

  if (/^\d+(\.\d+)?$/.test(queryNorm)) {
    if (
      variantNorm.startsWith(queryNorm + ":") ||
      variantNorm.startsWith(queryNorm + " ")
    ) {
      return { score: 125, reason: "numeric_prefix" };
    }
    if (vCollapsed.startsWith(qCollapsed + ":") || vCollapsed === qCollapsed) {
      return { score: 125, reason: "numeric_prefix" };
    }
  }

  const qWords = queryNorm.split(" ").filter(Boolean);
  const vWords = variantNorm.split(" ").filter(Boolean);
  const vSet = new Set(vWords);
  let hits = 0;
  for (const w of qWords) {
    if (w.length > 1 && vSet.has(w)) hits += 1;
  }
  const minLen = Math.min(qWords.length, vWords.length);
  if (minLen >= 2 && hits === qWords.length && hits === vWords.length) {
    return { score: 125, reason: "word_exact" };
  }
  if (
    hits >= Math.max(2, Math.ceil(qWords.length * 0.85)) &&
    hits >= Math.ceil(vWords.length * 0.85)
  ) {
    return { score: 112, reason: "strong_words" };
  }
  return { score: Math.min(85, hits * 16), reason: "partial" };
}

function yearScore(expected: unknown, candidateYear: unknown): number {
  if (expected == null || expected === "") return 0;
  const exp = parseInt(String(expected).trim(), 10);
  const y = parseInt(String(candidateYear ?? "").trim(), 10);
  if (!Number.isFinite(exp) || !Number.isFinite(y)) return -10;
  const diff = Math.abs(y - exp);
  if (diff === 0) return 30;
  if (diff === 1) return 10;
  if (diff <= 2) return 0;
  return -25;
}

function candidateTitleVariants(row: Record<string, unknown>): string[] {
  const raw: string[] = [];
  const push = (v: unknown) => {
    if (typeof v === "string" && v.trim()) raw.push(v);
  };
  push(row.english_title);
  push(row.romaji_title);
  push(row.native_title);
  push(row.canonical_title);
  if (Array.isArray(row.synonyms)) {
    for (const syn of row.synonyms) push(syn);
  }
  return [...new Set(raw.map(normalizeImportTitle).filter(Boolean))];
}

function buildSearchPasses(title: string, passes: unknown): string[] {
  const raw = String(title || "").trim();
  const out = [raw];
  if (Array.isArray(passes)) {
    for (const p of passes) {
      const pass = String(p || "").trim();
      if (pass.length >= 2) out.push(pass);
    }
  }
  return [...new Set(out.filter((p) => p.length >= 2))];
}

function normalizeSearchTerm(title: string): string {
  const norm = normalizeImportTitle(title);
  return norm.length >= 2 ? norm : "";
}

function searchTermsFromQuery(title: string, passes: unknown): string[] {
  const out = new Set<string>();
  for (const p of buildSearchPasses(title, passes)) {
    const norm = normalizeSearchTerm(p);
    if (norm) out.add(norm);
    const collapsed = collapseTitleSpaces(p);
    if (collapsed.length >= 2) out.add(collapsed);
  }
  return [...out];
}

function scoreIndexRow(row: Record<string, unknown>, query: {
  title: string;
  passes?: unknown;
  year?: unknown;
}) {
  const queryPasses = buildSearchPasses(query.title, query.passes).map(normalizeImportTitle);
  const variants = candidateTitleVariants(row);
  let bestTitle = 0;
  let bestReason = "";
  for (const q of queryPasses) {
    for (const v of variants) {
      const { score, reason } = titleVariantScore(q, v);
      if (score > bestTitle) {
        bestTitle = score;
        bestReason = reason;
      }
    }
  }
  const yearPart = yearScore(query.year, row.start_year);
  return { score: bestTitle + yearPart, titlePart: bestTitle, yearPart, reason: bestReason };
}

function autoPickScored(
  scored: Array<{ row: Record<string, unknown>; score: number; titlePart: number; yearPart: number; reason: string }>,
  query: { year?: unknown }
) {
  const ordered = [...scored].sort((a, b) => b.score - a.score);
  if (!ordered.length) return { pick: null, reason: "no_candidates", score: 0 };
  const top = ordered[0];
  const second = ordered[1];
  const gap = second ? top.score - second.score : top.score;
  const matchReason = top.reason || "";

  const rootMatch =
    matchReason === "root_subtitle" ||
    matchReason === "root_subtitle_collapsed" ||
    matchReason === "collapsed_exact" ||
    matchReason === "numeric_prefix";

  if (rootMatch) {
    if (query.year == null || query.year === "") {
      if (top.titlePart >= 115 && gap >= 6) {
        return { pick: top.row, reason: matchReason, score: top.score };
      }
    } else if (top.yearPart >= 25) {
      return { pick: top.row, reason: "root_year_match", score: top.score };
    } else if (top.yearPart >= 10 && gap >= 12) {
      return { pick: top.row, reason: "root_year_close", score: top.score };
    }
  }

  if (top.titlePart >= 130) {
    return { pick: top.row, reason: "exact_title", score: top.score };
  }
  if (top.score >= 95 && gap >= 8) {
    return { pick: top.row, reason: "high_confidence", score: top.score };
  }
  if (top.score >= 95 && !second) {
    return { pick: top.row, reason: "single_candidate", score: top.score };
  }
  return { pick: null, reason: "low_confidence", score: top.score };
}

function mapRowToCandidate(
  row: Record<string, unknown>,
  meta: { score: number; reason: string; titlePart?: number; yearPart?: number }
) {
  const anilistId = row.anilist_id as number | null;
  return {
    anilist_id: anilistId,
    anilistId,
    canonical_title: row.canonical_title,
    english_title: row.english_title,
    romaji_title: row.romaji_title,
    native_title: row.native_title,
    synonyms: row.synonyms || [],
    start_year: row.start_year,
    year: row.start_year != null ? String(row.start_year) : "",
    format: row.format,
    picture_url: row.picture_url,
    poster: row.picture_url || "",
    score: meta.score,
    matchReason: meta.reason,
    titlePart: meta.titlePart ?? 0,
    yearPart: meta.yearPart ?? 0,
    source: "offline_index",
  };
}

async function fetchCandidates(
  supabase: ReturnType<typeof createClient>,
  terms: string[],
  year: number | null,
  limit: number
): Promise<IndexRow[]> {
  if (!terms.length) return [];

  let query = supabase
    .from("anime_title_index")
    .select(
      "anilist_id, canonical_title, english_title, romaji_title, native_title, synonyms, start_year, format, picture_url"
    )
    .overlaps("normalized_search_terms", terms)
    .limit(Math.min(50, limit * 3));

  if (year != null) {
    query = query.or(`start_year.eq.${year},start_year.is.null`);
  }

  const { data, error } = await query;
  if (error) {
    console.warn("[anime-index-search] overlap query:", error.message);
  }
  if (data?.length) return data as IndexRow[];

  const probe = terms[0];
  if (probe.length >= 3) {
    const { data: fuzzy, error: fuzzyErr } = await supabase
      .from("anime_title_index")
      .select(
        "anilist_id, canonical_title, english_title, romaji_title, native_title, synonyms, start_year, format, picture_url"
      )
      .or(`english_title.ilike.%${probe}%,canonical_title.ilike.%${probe}%`)
      .limit(Math.min(40, limit * 2));
    if (!fuzzyErr && fuzzy?.length) return fuzzy as IndexRow[];
  }

  return [];
}

function rankCandidates(rows: IndexRow[], query: {
  title: string;
  passes?: unknown;
  year?: unknown;
}, limit: number) {
  const scored = rows
    .map((row) => {
      const meta = scoreIndexRow(row, query);
      return { row, ...meta };
    })
    .filter((entry) => entry.score >= 70)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  const verifiable = scored.filter((entry) => entry.row.anilist_id != null);
  const auto = autoPickScored(verifiable, query);
  const candidates = scored.map((entry) =>
    mapRowToCandidate(entry.row, {
      score: entry.score,
      reason: entry.reason,
      titlePart: entry.titlePart,
      yearPart: entry.yearPart,
    })
  );

  return {
    candidates,
    pick: auto.pick ? mapRowToCandidate(auto.pick, { score: auto.score, reason: auto.reason }) : null,
    autoReason: auto.reason,
  };
}

async function searchOne(
  supabase: ReturnType<typeof createClient>,
  query: { title: string; passes?: unknown; year?: unknown },
  limit: number
) {
  const terms = searchTermsFromQuery(query.title, query.passes);
  const year = n(query.year);
  const rows = await fetchCandidates(supabase, terms, year, limit);
  return rankCandidates(rows, query, limit);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, error: "POST required" }), {
      status: 405,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ ok: false, error: "Invalid JSON" }), {
      status: 400,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const supabase = createClient(url, key);
  const action = s(body.action);

  if (action === "meta") {
    const { data } = await supabase
      .from("anime_dataset_meta")
      .select(
        "active_version, upstream_release, upstream_last_update, downloaded_at, accepted_rows, checksum_sha256"
      )
      .eq("id", 1)
      .maybeSingle();
    return new Response(JSON.stringify({ ok: true, meta: data || null }), {
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  if (action === "search") {
    const title = s(body.title);
    const limit = Math.min(15, Math.max(1, n(body.limit) ?? 10));
    const result = await searchOne(
      supabase,
      { title, passes: body.passes, year: body.year },
      limit
    );
    return new Response(
      JSON.stringify({
        ok: true,
        ...result,
        results: result.candidates,
      }),
      { headers: { ...CORS, "Content-Type": "application/json" } }
    );
  }

  if (action === "batchSearch") {
    const rawRequests = Array.isArray(body.requests) ? body.requests : [];
    // Hard cap — unbounded batches amplify latency for every client.
    const requests = rawRequests.slice(0, 40);
    const limit = Math.min(15, Math.max(1, n(body.limit) ?? 10));
    const resultsById: Record<string, unknown> = {};

    for (const reqItem of requests) {
      const rec = reqItem as Record<string, unknown>;
      const id = s(rec.id);
      if (!id) continue;
      const title = s(rec.title);
      const ranked = await searchOne(
        supabase,
        { title, passes: rec.passes, year: rec.year },
        limit
      );
      resultsById[id] = {
        ok: true,
        ...ranked,
        results: ranked.candidates,
      };
    }

    return new Response(JSON.stringify({ ok: true, resultsById }), {
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ ok: false, error: "Unknown action" }), {
    status: 400,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
});
