(function () {
  "use strict";

  const BULK_IMPORT_DRAFT_KEY = "bulk_import_draft_v1";
  const LARGE_IMPORT_THRESHOLD = 50;
  const DRAFT_VERSION = 2;

  const TYPE_ALIASES = {
    movie: "movies",
    movies: "movies",
    film: "movies",
    tv: "tvSeries",
    tvseries: "tvSeries",
    "tv series": "tvSeries",
    series: "tvSeries",
    anime: "anime",
  };

  const ROW_STATUS = {
    invalid: "invalid",
    duplicate_list: "duplicate_list",
    duplicate_import: "duplicate_import",
    pending_verification: "pending_verification",
  };

  function buildTemplate() {
    return `Return TSV only. No JSON, no markdown, no code fence, no explanation, no numbering, and no extra text.

Columns, separated by real tab characters:

Title	Year	Type

Allowed Type values only:

movies
tvSeries
anime

Type definitions (use the original media type, not genre):

* movies = standalone movie or film series
* tvSeries = live-action TV series or Western animated TV series
* anime = Japanese anime series or Japanese anime movie

Examples:

* Black Clover → anime
* Code Geass → anime
* Avatar: The Last Airbender → tvSeries
* Invincible → tvSeries
* The Dark Knight → movies
* Breaking Bad → tvSeries

Important:

* Do not classify every animated title as anime.
* Japanese anime movies remain anime (not movies).
* Western animation (Disney, Pixar, DreamWorks, US cartoons) remains tvSeries or movies.
* Use the original release year when known.
* Leave Year blank only when uncertain.
* Never invent a year.
* Type is required for every row.
* Output one row for every title the user provides.
* Preserve sequels, remakes, spin-offs, and related titles as separate rows.
* Do not include provider links, IDs, genres, actors, summaries, posters, ratings, or other metadata.
* Preserve meaningful numbers in titles.
* Do not remove parts of titles such as:

  * 11.22.63
  * 2.5 Dimensional Seduction
  * 86
  * 3 Body Problem
* Do not merge Naruto and Naruto: Shippuden.
* Do not omit a title because its year is unknown.

Example:

Title	Year	Type
The Godfather	1972	movies
The Dark Knight	2008	movies
Breaking Bad	2008	tvSeries
Avatar: The Last Airbender	2005	tvSeries
Invincible	2021	tvSeries
Black Clover	2017	anime
Code Geass	2006	anime
Summertime Rendering	2022	anime
86	2021	anime
Seraph of the End	2015	anime`;
  }

  function normalizeBulkJsonInput(raw) {
    return String(raw || "")
      .replace(/\u201C/g, '"')
      .replace(/\u201D/g, '"')
      .replace(/\u201E/g, '"')
      .replace(/\u00AB/g, '"')
      .replace(/\u00BB/g, '"');
  }

  function bulkJsonHasCurlyQuotes(raw) {
    return /[\u201C\u201D\u201E\u00AB\u00BB]/.test(String(raw || ""));
  }

  function normalizeContentType(value) {
    const key = String(value || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");
    return TYPE_ALIASES[key] || null;
  }

  function normalizeTitle(value) {
    return String(value || "")
      .trim()
      .replace(/^["']+|["']+$/g, "")
      .replace(/\s+/g, " ");
  }

  function normalizeYear(value) {
    if (value == null) return null;
    const raw = String(value).trim();
    if (!raw || /^null$/i.test(raw) || raw === "—" || raw === "-") return null;
    const n = parseInt(raw, 10);
    if (!Number.isFinite(n) || n < 1880 || n > 2100) return null;
    return n;
  }

  function stripListNumbering(line) {
    let s = String(line || "").trim();
    if (!s) return "";
    s = s.replace(/^[\u2022\u25AA\u25CF\u2013\u2014\-*•]+\s*/, "");
    // Only strip clear list prefixes (digit + . ) : or dash + whitespace).
    s = s.replace(/^\d+[\.\):]\s+/, "");
    s = s.replace(/^\d+\s*[-–]\s+/, "");
    s = s.replace(/^["']+|["']+$/g, "");
    return s.trim();
  }

  function cleanInputLine(line) {
    return stripListNumbering(line);
  }

  function splitPlainLines(raw) {
    return String(raw || "")
      .split(/\r?\n/)
      .map(cleanInputLine)
      .filter(Boolean);
  }

  function splitTsvRawLines(raw) {
    return String(raw || "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  }

  function looksLikeJsonInput(raw) {
    const trimmed = String(raw || "").trim();
    if (!trimmed) return false;
    if (/^```(?:json)?\s*/i.test(trimmed)) return true;
    if (trimmed.startsWith("[") || trimmed.startsWith("{")) return true;
    return false;
  }

  function looksLikeTsvInput(raw) {
    const lines = splitTsvRawLines(raw).slice(0, 5);
    if (!lines.length) return false;
    const tabLines = lines.filter((line) => line.includes("\t"));
    return tabLines.length >= Math.max(1, Math.ceil(lines.length * 0.5));
  }

  function parseStrictJsonArray(raw) {
    const normalized = normalizeBulkJsonInput(raw);
    const trimmed = normalized.trim();
    if (!trimmed) {
      return { ok: false, errorKey: "bulk.jsonEmpty" };
    }

    const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const source = fence ? fence[1].trim() : trimmed;

    const start = source.indexOf("[");
    const end = source.lastIndexOf("]");
    if (start < 0 || end <= start) {
      return {
        ok: false,
        errorKey: bulkJsonHasCurlyQuotes(raw)
          ? "bulk.jsonCurlyQuotes"
          : "bulk.jsonTruncated",
      };
    }

    const slice = source.slice(start, end + 1);
    try {
      const parsed = JSON.parse(slice);
      if (!Array.isArray(parsed)) {
        return { ok: false, errorKey: "bulk.jsonNotArray" };
      }
      return { ok: true, rows: parsed, format: "json" };
    } catch {
      return {
        ok: false,
        errorKey: bulkJsonHasCurlyQuotes(raw)
          ? "bulk.jsonCurlyQuotes"
          : "bulk.jsonInvalid",
      };
    }
  }

  function splitDelimitedLine(line, delimiter) {
    const parts = [];
    let current = "";
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        inQuotes = !inQuotes;
        continue;
      }
      if (!inQuotes && char === delimiter) {
        parts.push(current.trim());
        current = "";
        continue;
      }
      current += char;
    }
    parts.push(current.trim());
    return parts.map((part) => part.replace(/^"|"$/g, "").trim());
  }

  function isHeaderRow(parts) {
    if (parts.length < 2) return false;
    const joined = parts.join(" ").toLowerCase();
    return /title/.test(parts[0].toLowerCase()) && /type|year|provider/.test(joined);
  }

  function parseTsvRowParts(parts) {
    const title = parts[0];
    let year = null;
    let type = "";
    let providerUrl = "";
    if (parts.length >= 4) {
      year = parts[1];
      type = parts[2];
      providerUrl = parts[3];
    } else if (parts.length === 3) {
      const maybeYear = normalizeYear(parts[1]);
      if (maybeYear != null || !parts[1]) {
        year = parts[1];
        type = parts[2];
      } else {
        type = parts[1];
        providerUrl = parts[2];
      }
    } else if (parts.length === 2) {
      type = parts[1];
    }
    return { title, year, type, providerUrl };
  }

  function parseTsvLines(raw) {
    const lines = splitTsvRawLines(raw);
    const rows = [];
    for (const line of lines) {
      if (!line.includes("\t")) continue;
      const parts = line.split("\t").map((p) => p.trim());
      if (parts.length < 2) continue;
      if (!rows.length && isHeaderRow(parts)) continue;
      const parsed = parseTsvRowParts(parts);
      rows.push({
        ...parsed,
        importedTitle: parsed.title,
      });
    }
    return rows.length ? { ok: true, rows, format: "tsv" } : { ok: false };
  }

  function parsePipeLines(raw) {
    const lines = splitPlainLines(raw);
    const rows = [];
    for (const line of lines) {
      if (!line.includes("|")) continue;
      const parts = line.split("|").map((part) => part.trim());
      if (parts.length < 2) continue;
      if (parts.length === 2) {
        rows.push({ title: parts[0], year: null, type: parts[1] });
      } else {
        rows.push({ title: parts[0], year: parts[1], type: parts[2] });
      }
    }
    return rows.length ? { ok: true, rows, format: "pipe" } : { ok: false };
  }

  function parseCsvLines(raw) {
    const lines = splitPlainLines(raw);
    const rows = [];
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index];
      if (!line.includes(",")) continue;
      const parts = splitDelimitedLine(line, ",");
      if (parts.length < 2) continue;
      if (!rows.length && isHeaderRow(parts)) continue;
      if (parts.length === 2) {
        rows.push({ title: parts[0], year: null, type: parts[1] });
      } else {
        rows.push({ title: parts[0], year: parts[1], type: parts[2] });
      }
    }
    return rows.length ? { ok: true, rows, format: "csv" } : { ok: false };
  }

  function normalizeRawRow(row, lineNum) {
    if (!row || typeof row !== "object") {
      return { ok: false, error: `Row ${lineNum}: not a valid entry.` };
    }

    const title = normalizeTitle(row.title);
    const importedTitle = normalizeTitle(row.importedTitle || row.title);
    const contentType = normalizeContentType(row.type || row.contentType);
    const year = normalizeYear(row.year);
    const providerUrl = String(row.providerUrl || row.providerurl || "").trim();

    if (!title) {
      return { ok: false, error: `Row ${lineNum}: missing title.` };
    }
    if (!contentType) {
      const typeRaw = String(row.type || row.contentType || "").trim() || "empty";
      return {
        ok: false,
        error: `Row ${lineNum} (“${title}”): invalid type “${typeRaw}”. Use movies, tvSeries, or anime.`,
      };
    }

    return {
      ok: true,
      row: { title, importedTitle, year, contentType, providerUrl },
    };
  }

  function rowIdentityKey(contentType, title, year) {
    const base = `${contentType}::${normalizeTitle(title).toLowerCase()}`;
    return year != null ? `${base}::${year}` : base;
  }

  function classifyRows(normalizedRows, { isOnList } = {}) {
    const seenImport = new Set();
    const rows = [];
    const stats = {
      total: normalizedRows.length,
      valid: 0,
      duplicates: 0,
      invalid: 0,
      pending: 0,
    };

    normalizedRows.forEach((entry, index) => {
      const line = index + 1;
      if (!entry.ok) {
        rows.push({
          line,
          title: "",
          year: null,
          contentType: "",
          status: ROW_STATUS.invalid,
          error: entry.error,
        });
        stats.invalid += 1;
        return;
      }

      const { title, importedTitle, year, contentType, providerUrl } = entry.row;
      const key = rowIdentityKey(contentType, title, year);
      let status = ROW_STATUS.pending_verification;

      if (typeof isOnList === "function" && isOnList(contentType, title)) {
        status = ROW_STATUS.duplicate_list;
      } else if (seenImport.has(key)) {
        status = ROW_STATUS.duplicate_import;
      } else {
        seenImport.add(key);
      }

      stats.valid += 1;
      if (
        status === ROW_STATUS.duplicate_list ||
        status === ROW_STATUS.duplicate_import
      ) {
        stats.duplicates += 1;
      }
      if (status === ROW_STATUS.pending_verification) {
        stats.pending += 1;
      }
      if (status === ROW_STATUS.invalid) {
        stats.invalid += 1;
      }

      rows.push({
        line,
        title,
        importedTitle: importedTitle || title,
        year,
        contentType,
        providerUrl: providerUrl || "",
        status,
        error: "",
      });
    });

    return { rows, stats };
  }

  function parseBulkImport(raw, helpers = {}) {
    const trimmed = String(raw || "").trim();
    if (!trimmed) {
      return {
        ok: false,
        errorKey: "bulk.pasteEmpty",
        rows: [],
        stats: null,
      };
    }

    let extracted;
    if (looksLikeJsonInput(trimmed)) {
      extracted = parseStrictJsonArray(trimmed);
      if (!extracted.ok) {
        return {
          ok: false,
          errorKey: extracted.errorKey,
          rows: [],
          stats: null,
        };
      }
    } else if (looksLikeTsvInput(trimmed)) {
      extracted = parseTsvLines(trimmed);
      if (!extracted.ok) {
        return { ok: false, errorKey: "bulk.unrecognizedFormat", rows: [], stats: null };
      }
    } else {
      extracted = parsePipeLines(trimmed);
      if (!extracted.ok) {
        extracted = parseCsvLines(trimmed);
      }
      if (!extracted.ok) {
        extracted = parseTsvLines(trimmed);
      }
      if (!extracted.ok) {
        return {
          ok: false,
          errorKey: "bulk.unrecognizedFormat",
          rows: [],
          stats: null,
        };
      }
    }

    const normalized = [];
    const syntaxErrors = [];
    extracted.rows.forEach((row, index) => {
      const line = index + 1;
      const result = normalizeRawRow(row, line);
      if (result.ok) {
        normalized.push(result);
      } else {
        normalized.push({ ok: false, error: result.error });
        syntaxErrors.push(result.error);
      }
    });

    if (!normalized.length) {
      return {
        ok: false,
        errorKey: "bulk.noneParsed",
        error: syntaxErrors.join("\n"),
        rows: [],
        stats: null,
      };
    }

    const classified = classifyRows(normalized, helpers);
    return {
      ok: true,
      format: extracted.format,
      rows: classified.rows,
      stats: classified.stats,
      errors: syntaxErrors,
    };
  }

  function buildDraft(listId, parsed) {
    return {
      version: DRAFT_VERSION,
      listId: listId || "",
      createdAt: Date.now(),
      format: parsed.format || "",
      rows: parsed.rows,
      stats: parsed.stats,
    };
  }

  function readDraftStore() {
    try {
      const raw = localStorage.getItem(BULK_IMPORT_DRAFT_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  function saveBulkImportDraft(draft) {
    if (!draft) return;
    localStorage.setItem(BULK_IMPORT_DRAFT_KEY, JSON.stringify(draft));
  }

  function loadBulkImportDraft(listId) {
    const draft = readDraftStore();
    if (!draft) return null;
    if (listId && draft.listId && draft.listId !== listId) return null;
    return draft;
  }

  function clearBulkImportDraft() {
    localStorage.removeItem(BULK_IMPORT_DRAFT_KEY);
  }

  function formatBulkErrors(errors, { maxShown = 6 } = {}) {
    if (!errors?.length) return "";
    const shown = errors.slice(0, maxShown);
    let message = shown.join("\n");
    const rest = errors.length - shown.length;
    if (rest > 0) {
      message += `\n…and ${rest} more error${rest === 1 ? "" : "s"}.`;
    }
    return message;
  }

  window.WatchlistBulkTitles = {
    BULK_IMPORT_DRAFT_KEY,
    LARGE_IMPORT_THRESHOLD,
    ROW_STATUS,
    buildTemplate,
    parseBulkImport,
    buildDraft,
    saveBulkImportDraft,
    loadBulkImportDraft,
    clearBulkImportDraft,
    formatBulkErrors,
    looksLikeJsonInput,
    normalizeContentType,
    normalizeTitle,
    normalizeYear,
    cleanInputLine,
  };
})();
