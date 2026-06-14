(function () {
  "use strict";

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

  function buildTemplate(genres) {
    const genreList = (genres || []).join(", ");
    return `You are helping fill a watchlist. Return ONLY a JSON array — no markdown, no explanation.

Rules:
- type: "movies" | "tvSeries" | "anime"
- genre: one main genre from: ${genreList}
- kind: for movies use "movie" or "film series"; for tvSeries/anime use "series"
- lead: lead actors, comma-separated (required)
- secondaryGenres: optional array of extra genres from the same list
- summary: one short sentence (required)
- link: plain URL only (https://www.imdb.com/... or rottentomatoes.com) — NOT markdown like [text](url). Use "" if unknown.

Example entry:
{
  "type": "movies",
  "genre": "Action",
  "title": "Carry-On",
  "kind": "movie",
  "lead": "Taron Egerton",
  "secondaryGenres": [],
  "summary": "An airport security officer is forced to let a dangerous suitcase onto a plane.",
  "link": "https://www.imdb.com/title/tt21382296/"
}

Replace the example with one object per title the user gives you. Output the full JSON array only.

[
  {
    "type": "movies",
    "genre": "Action",
    "title": "TITLE HERE",
    "kind": "movie",
    "lead": "ACTOR NAMES",
    "secondaryGenres": [],
    "summary": "SUMMARY HERE",
    "link": ""
  }
]`;
  }

  function extractJsonArray(raw) {
    const trimmed = String(raw || "").trim();
    if (!trimmed) return null;

    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parsed;
      if (parsed && Array.isArray(parsed.titles)) return parsed.titles;
      if (parsed && Array.isArray(parsed.items)) return parsed.items;
      if (parsed && Array.isArray(parsed.watchlist)) return parsed.watchlist;
    } catch {
      /* fall through */
    }

    const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) {
      try {
        const parsed = JSON.parse(fence[1].trim());
        if (Array.isArray(parsed)) return parsed;
      } catch {
        /* fall through */
      }
    }

    const start = trimmed.indexOf("[");
    const end = trimmed.lastIndexOf("]");
    if (start >= 0 && end > start) {
      try {
        const parsed = JSON.parse(trimmed.slice(start, end + 1));
        if (Array.isArray(parsed)) return parsed;
      } catch {
        /* fall through */
      }
    }

    return null;
  }

  function sanitizeLinkRaw(value) {
    let raw = String(value || "").trim();
    if (!raw) return "";

    const markdown = raw.match(/\[([^\]]*)\]\(([^)]+)\)/);
    if (markdown) {
      raw = markdown[2].trim();
    }

    const angle = raw.match(/^<([^>]+)>$/);
    if (angle) {
      raw = angle[1].trim();
    }

    if (!/^https?:\/\//i.test(raw)) {
      const found = raw.match(/https?:\/\/[^\s\])"'<>]+/i);
      if (found) raw = found[0];
    }

    return raw.replace(/[.,;]+$/, "");
  }

  function formatBulkErrors(errors, { maxShown = 6 } = {}) {
    if (!errors?.length) return "No valid titles found.";

    const shown = errors.slice(0, maxShown);
    let message = shown.join("\n");
    const rest = errors.length - shown.length;
    if (rest > 0) {
      message += `\n…and ${rest} more error${rest === 1 ? "" : "s"}.`;
    }
    return message;
  }

  function normalizeContentType(value) {
    const key = String(value || "movies")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");
    return TYPE_ALIASES[key] || null;
  }

  function parseBulkPaste(raw, helpers) {
    const {
      normalizeGenre,
      resolveGenre,
      normalizeKind,
      parseLeads,
      normalizeLink,
      standardGenres = [],
    } = helpers;

    const matchGenre =
      resolveGenre ||
      ((raw) => {
        const trimmed = String(raw || "").trim();
        if (!trimmed) return null;
        const normalized = normalizeGenre(trimmed);
        return standardGenres.includes(normalized) ? normalized : null;
      });

    const rows = extractJsonArray(raw);
    if (!rows) {
      const trimmed = String(raw || "").trim();
      let hint = "Paste the JSON array your AI returned (starts with [ and ends with ]).";
      if (trimmed && !trimmed.startsWith("[")) {
        hint = "Expected a JSON array starting with [. Remove any text before the opening [.";
      } else if (trimmed.startsWith("[")) {
        hint =
          "Could not parse that JSON. Check for missing commas, extra commas, or unquoted text.";
      }
      return {
        ok: false,
        error: hint,
        items: [],
      };
    }

    if (!rows.length) {
      return { ok: false, error: "The list is empty.", items: [] };
    }

    const items = [];
    const errors = [];

    rows.forEach((row, index) => {
      const line = index + 1;
      if (!row || typeof row !== "object") {
        errors.push(`Row ${line}: not a valid entry.`);
        return;
      }

      const contentType = normalizeContentType(row.type || row.contentType);
      const title = String(row.title || "").trim();
      const genreRaw = String(row.genre || "").trim();
      const genre = genreRaw ? matchGenre(genreRaw) : null;
      const summary = String(row.summary || row.reminder || "").trim();
      const leads = parseLeads(row);
      const linkRaw = sanitizeLinkRaw(row.link);
      const link = linkRaw ? normalizeLink(linkRaw) : "";

      if (!contentType) {
        const typeRaw = String(row.type || row.contentType || "").trim() || "empty";
        errors.push(
          `Row ${line} (“${title || "untitled"}”): invalid type “${typeRaw}”. Use movies, tvSeries, or anime.`
        );
        return;
      }
      if (!title) {
        errors.push(`Row ${line}: missing title.`);
        return;
      }
      if (!genreRaw) {
        errors.push(`Row ${line} (“${title}”): missing genre.`);
        return;
      }
      if (!genre) {
        errors.push(
          `Row ${line} (“${title}”): unknown genre “${genreRaw}”. Pick one from the template list.`
        );
        return;
      }
      if (!leads.length) {
        errors.push(`Row ${line} (“${title}”): missing lead actor.`);
        return;
      }
      if (!summary) {
        errors.push(`Row ${line} (“${title}”): missing summary.`);
        return;
      }
      if (linkRaw && !link) {
        const original = String(row.link || "").trim();
        const looksMarkdown = /\[([^\]]*)\]\(([^)]+)\)/.test(original);
        errors.push(
          looksMarkdown
            ? `Row ${line} (“${title}”): link is markdown — use a plain URL like https://www.imdb.com/title/tt1234567/`
            : `Row ${line} (“${title}”): invalid link “${original}”. Use IMDb or Rotten Tomatoes.`
        );
        return;
      }

      let kind = row.kind;
      if (contentType !== "movies") {
        kind = "series";
      } else {
        kind = normalizeKind(kind || "movie", contentType);
      }

      const secondaryRaw = row.secondaryGenres || row.secondary_genres || [];
      const secondaryGenres = Array.isArray(secondaryRaw)
        ? secondaryRaw
            .map((g) => matchGenre(String(g).trim()))
            .filter((g) => g && g !== genre && standardGenres.includes(g))
        : [];

      items.push({
        contentType,
        genre,
        title,
        kind,
        leads,
        lead: leads.join(", "),
        summary,
        link,
        secondaryGenres,
      });
    });

    if (!items.length) {
      return {
        ok: false,
        error: formatBulkErrors(errors),
        items: [],
        errors,
      };
    }

    return { ok: true, items, errors };
  }

  window.WatchlistBulkTitles = {
    buildTemplate,
    parseBulkPaste,
    formatBulkErrors,
    sanitizeLinkRaw,
  };
})();
