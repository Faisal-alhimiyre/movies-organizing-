/**
 * Shared anime title normalization + scoring for bulk import matching.
 * Used by: ETL (normalized_search_terms), edge function (anime-index-search).
 *
 * Identity data source: anime-offline-database by manami-project (ODbL 1.0 + DbCL 1.0)
 * Upstream repository is archived; pinned release 2026-27 (41,537 entries).
 */

export function normalizeImportTitle(title) {
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

export function collapseTitleSpaces(title) {
  return normalizeImportTitle(title).replace(/\s+/g, "");
}

export function normalizeSearchTerm(title) {
  const norm = normalizeImportTitle(title);
  if (!norm || norm.length < 2) return "";
  return norm;
}

export function buildNormalizedSearchTerms(mainTitle, synonyms = [], extra = []) {
  const out = new Set();
  const add = (t) => {
    const n = normalizeSearchTerm(t);
    if (n) out.add(n);
    const c = collapseTitleSpaces(t);
    if (c && c.length >= 2) out.add(c);
  };
  add(mainTitle);
  for (const s of synonyms || []) add(s);
  for (const e of extra || []) add(e);
  return [...out];
}

export function titleVariantScore(queryNorm, variantNorm) {
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

export function yearScore(expected, candidateYear) {
  if (expected == null || expected === "") return 0;
  const exp = parseInt(String(expected).trim(), 10);
  const y = parseInt(String(candidateYear || "").trim(), 10);
  if (!Number.isFinite(exp) || !Number.isFinite(y)) return -10;
  const diff = Math.abs(y - exp);
  if (diff === 0) return 30;
  if (diff === 1) return 10;
  if (diff <= 2) return 0;
  return -25;
}

export function candidateTitleVariants(row) {
  const raw = [];
  if (row.english_title) raw.push(row.english_title);
  if (row.romaji_title) raw.push(row.romaji_title);
  if (row.native_title) raw.push(row.native_title);
  if (row.canonical_title) raw.push(row.canonical_title);
  if (row.title) raw.push(row.title);
  for (const s of row.synonyms || []) raw.push(s);
  return [...new Set(raw.map(normalizeImportTitle).filter(Boolean))];
}

export function buildSearchPasses(title, passes = []) {
  const raw = String(title || "").trim();
  const out = [raw, ...passes.filter((p) => String(p).trim().length >= 2)];
  return [...new Set(out.map((p) => String(p).trim()).filter((p) => p.length >= 2))];
}

export function scoreIndexRow(row, query) {
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
  return {
    score: bestTitle + yearPart,
    titlePart: bestTitle,
    yearPart,
    reason: bestReason,
  };
}

export function autoPickScored(scored, query) {
  const ordered = [...scored].sort((a, b) => b.score - a.score);
  if (!ordered.length) return { pick: null, reason: "no_candidates" };
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

export function extractAnilistId(sources) {
  for (const url of sources || []) {
    const m = String(url).match(/anilist\.co\/anime\/(\d+)/i);
    if (m) return parseInt(m[1], 10);
  }
  return null;
}

export function extractMalId(sources) {
  for (const url of sources || []) {
    const m = String(url).match(/myanimelist\.net\/anime\/(\d+)/i);
    if (m) return parseInt(m[1], 10);
  }
  return null;
}

export function hasCjk(text) {
  return /[\u3040-\u9fff\u3400-\u4dbf]/.test(String(text || ""));
}

export function isMostlyAscii(text) {
  return /^[\x00-\x7f\s:'.+\-!?&0-9]*$/i.test(String(text || "").trim());
}

export function classifyTitleFields(mainTitle, synonyms = []) {
  let english = "";
  let romaji = "";
  let native = "";
  const all = [mainTitle, ...(synonyms || [])].filter(Boolean);

  if (isMostlyAscii(mainTitle) && !hasCjk(mainTitle)) english = mainTitle;
  else if (hasCjk(mainTitle)) native = mainTitle;
  else romaji = mainTitle;

  for (const syn of all) {
    if (!english && isMostlyAscii(syn) && !hasCjk(syn)) english = syn;
    if (!native && hasCjk(syn)) native = syn;
    if (!romaji && !hasCjk(syn) && !isMostlyAscii(syn)) romaji = syn;
  }

  if (!english && isMostlyAscii(mainTitle)) english = mainTitle;
  if (!romaji && !hasCjk(mainTitle) && !isMostlyAscii(mainTitle)) romaji = mainTitle;

  return { english, romaji, native };
}

export function mapOfflineRowToPick(row, scoreMeta = {}) {
  const anilistId = row.anilist_id || row.anilistId;
  return {
    source: "anilist",
    anilistId,
    title: row.english_title || row.canonical_title || row.title || "",
    titleEnglish: row.english_title || "",
    titleRomaji: row.romaji_title || "",
    titleNative: row.native_title || "",
    synonyms: row.synonyms || [],
    year: row.start_year ? String(row.start_year) : row.year ? String(row.year) : "",
    format: row.format || "",
    type: "anime",
    poster: row.picture_url || row.poster || "",
    offlineScore: scoreMeta.score || 0,
    offlineReason: scoreMeta.reason || "",
  };
}
