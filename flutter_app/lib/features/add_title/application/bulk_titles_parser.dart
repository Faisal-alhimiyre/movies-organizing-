import 'dart:convert';

import '../../../core/utils/watchlist_parser.dart';
import '../../../models/watchlist_item.dart';

class BulkParsedEntry {
  const BulkParsedEntry({
    required this.contentType,
    required this.genre,
    required this.title,
    required this.kind,
    required this.lead,
    required this.summary,
    this.link,
    this.secondaryGenres = const [],
  });

  final String contentType;
  final String genre;
  final String title;
  final String kind;
  final String lead;
  final String summary;
  final String? link;
  final List<String> secondaryGenres;

  WatchlistItem toWatchlistItem({required int addedAt}) {
    return WatchlistItem(
      id: makeItemId(contentType, genre, title),
      contentType: contentType,
      genre: genre,
      title: title,
      lead: lead,
      summary: summary,
      kind: kind,
      link: link,
      addedAt: addedAt,
      secondaryGenres: secondaryGenres,
    );
  }
}

class BulkParseResult {
  const BulkParseResult({
    required this.ok,
    this.error,
    this.items = const [],
    this.errors = const [],
  });

  final bool ok;
  final String? error;
  final List<BulkParsedEntry> items;
  final List<String> errors;
}

const _typeAliases = {
  'movie': 'movies',
  'movies': 'movies',
  'film': 'movies',
  'tv': 'tvSeries',
  'tvseries': 'tvSeries',
  'tv series': 'tvSeries',
  'series': 'tvSeries',
  'anime': 'anime',
};

String buildBulkTemplate(List<String> genres) {
  final genreList = genres.join(', ');
  return '''You are helping fill a watchlist. Return ONLY a JSON array — no markdown, no explanation.

Rules:
- type: "movies" | "tvSeries" | "anime"
- genre: one main genre from: $genreList
- kind: for movies use "movie" or "film series"; for tvSeries/anime use "series"
- lead: lead actors, comma-separated (required)
- secondaryGenres: optional array of extra genres from the same list
- summary: one short sentence (required)
- link: plain URL only (https://www.imdb.com/...) — NOT markdown like [text](url). Use "" if unknown.

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
]''';
}

List<dynamic>? extractJsonArray(String raw) {
  final trimmed = raw.trim();
  if (trimmed.isEmpty) return null;

  try {
    final parsed = jsonDecode(trimmed);
    if (parsed is List) return parsed;
    if (parsed is Map) {
      for (final key in ['titles', 'items', 'watchlist']) {
        final value = parsed[key];
        if (value is List) return value;
      }
    }
  } catch (_) {}

  final fence = RegExp(
    r'```(?:json)?\s*([\s\S]*?)```',
    caseSensitive: false,
  ).firstMatch(trimmed);
  if (fence != null) {
    try {
      final parsed = jsonDecode(fence.group(1)!.trim());
      if (parsed is List) return parsed;
    } catch (_) {}
  }

  final start = trimmed.indexOf('[');
  final end = trimmed.lastIndexOf(']');
  if (start >= 0 && end > start) {
    try {
      final parsed = jsonDecode(trimmed.substring(start, end + 1));
      if (parsed is List) return parsed;
    } catch (_) {}
  }

  return null;
}

class JsonArrayExtractResult {
  const JsonArrayExtractResult({
    required this.rows,
    this.syntaxErrors = const [],
  });

  final List<dynamic> rows;
  final List<String> syntaxErrors;
}

bool _isJsonArraySeparator(int codeUnit) {
  final char = String.fromCharCode(codeUnit);
  return char == ',' || char.trim().isEmpty;
}

int _findJsonObjectEnd(String input, int start) {
  if (start >= input.length || input[start] != '{') return -1;

  var depth = 0;
  var inString = false;
  var escape = false;

  for (var i = start; i < input.length; i++) {
    final char = input[i];

    if (escape) {
      escape = false;
      continue;
    }

    if (inString) {
      if (char == r'\') {
        escape = true;
      } else if (char == '"') {
        inString = false;
      }
      continue;
    }

    if (char == '"') {
      inString = true;
      continue;
    }

    if (char == '{') {
      depth++;
      if (depth == 1) continue;
    } else if (char == '}') {
      depth--;
      if (depth == 0) return i;
    }
  }

  return -1;
}

String? _extractJsonArrayInner(String raw) {
  final trimmed = raw.trim();
  if (trimmed.isEmpty) return null;

  final fence = RegExp(
    r'```(?:json)?\s*([\s\S]*?)```',
    caseSensitive: false,
  ).firstMatch(trimmed);
  final source = fence != null ? fence.group(1)!.trim() : trimmed;

  final start = source.indexOf('[');
  final end = source.lastIndexOf(']');
  if (start < 0 || end <= start) return null;
  return source.substring(start + 1, end);
}

JsonArrayExtractResult _extractJsonObjectsLenient(String inner) {
  final rows = <dynamic>[];
  final syntaxErrors = <String>[];
  var index = 0;
  var rowNum = 0;

  while (index < inner.length) {
    while (index < inner.length && _isJsonArraySeparator(inner.codeUnitAt(index))) {
      index++;
    }
    if (index >= inner.length) break;

    if (inner[index] != '{') {
      final nextObject = inner.indexOf('{', index);
      if (nextObject == -1) break;
      index = nextObject;
    }

    rowNum++;
    final end = _findJsonObjectEnd(inner, index);
    if (end == -1) {
      syntaxErrors.add(
        'Row $rowNum: unclosed JSON object — check braces and quotes.',
      );
      break;
    }

    final slice = inner.substring(index, end + 1);
    try {
      rows.add(jsonDecode(slice));
    } catch (_) {
      syntaxErrors.add(
        'Row $rowNum: invalid JSON — check commas, quotes, and braces.',
      );
    }

    index = end + 1;
  }

  return JsonArrayExtractResult(rows: rows, syntaxErrors: syntaxErrors);
}

JsonArrayExtractResult extractJsonArrayWithFallback(String raw) {
  final rows = extractJsonArray(raw);
  if (rows != null) {
    return JsonArrayExtractResult(rows: rows);
  }

  final inner = _extractJsonArrayInner(raw);
  if (inner == null) {
    return const JsonArrayExtractResult(rows: []);
  }

  return _extractJsonObjectsLenient(inner);
}

String sanitizeBulkLinkRaw(String value) {
  var raw = value.trim();
  if (raw.isEmpty) return '';

  final markdown = RegExp(r'\[([^\]]*)\]\(([^)]+)\)').firstMatch(raw);
  if (markdown != null) {
    raw = markdown.group(2)!.trim();
  }

  final angle = RegExp(r'^<([^>]+)>$').firstMatch(raw);
  if (angle != null) {
    raw = angle.group(1)!.trim();
  }

  if (!RegExp(r'^https?://', caseSensitive: false).hasMatch(raw)) {
    final found = RegExp(
      r'https?://[^\s\])"<>]+',
      caseSensitive: false,
    ).firstMatch(raw);
    if (found != null) raw = found.group(0)!;
  }

  return raw.replaceAll(RegExp(r'[.,;]+$'), '');
}

String? normalizeBulkLink(String url) {
  final trimmed = url.trim();
  if (trimmed.isEmpty) return null;

  try {
    final href = RegExp(r'^https?://', caseSensitive: false).hasMatch(trimmed)
        ? trimmed
        : 'https://$trimmed';
    final parsed = Uri.parse(href);
    if (parsed.scheme != 'http' && parsed.scheme != 'https') return null;
    return parsed.toString();
  } catch (_) {
    return null;
  }
}

String formatBulkErrors(List<String> errors, {int maxShown = 6}) {
  if (errors.isEmpty) return 'No valid titles found.';

  final shown = errors.take(maxShown).join('\n');
  final rest = errors.length - maxShown;
  if (rest <= 0) return shown;
  return '$shown\n…and $rest more error${rest == 1 ? '' : 's'}.';
}

String? resolveBulkGenre(String raw) {
  final trimmed = raw.trim();
  if (trimmed.isEmpty) return null;
  if (standardGenres.contains(trimmed)) return trimmed;
  for (final genre in standardGenres) {
    if (genre.toLowerCase() == trimmed.toLowerCase()) return genre;
  }
  return null;
}

String? normalizeBulkContentType(dynamic value) {
  final key =
      value?.toString().trim().toLowerCase().replaceAll(RegExp(r'\s+'), ' ');
  if (key == null || key.isEmpty) return null;
  return _typeAliases[key];
}

List<String> parseBulkLeads(Map<String, dynamic> row) {
  final leadsRaw = row['leads'];
  if (leadsRaw is List && leadsRaw.isNotEmpty) {
    return leadsRaw
        .map((e) => e.toString().trim())
        .where((e) => e.isNotEmpty)
        .toList();
  }
  final lead = row['lead']?.toString().trim() ?? '';
  if (lead.isEmpty) return [];
  return lead
      .split(RegExp(r',\s*'))
      .map((e) => e.trim())
      .where((e) => e.isNotEmpty)
      .toList();
}

BulkParseResult parseBulkPaste(String raw) {
  final extracted = extractJsonArrayWithFallback(raw);
  final rows = extracted.rows;
  final errors = [...extracted.syntaxErrors];

  if (rows.isEmpty && errors.isEmpty) {
    final trimmed = raw.trim();
    var hint =
        'Paste the JSON array your AI returned (starts with [ and ends with ]).';
    if (trimmed.isNotEmpty && !trimmed.contains('[')) {
      hint =
          'Expected a JSON array starting with [. Remove any text before the opening [.';
    } else if (trimmed.contains('[')) {
      hint =
          'Could not parse that JSON. Check for missing commas, extra commas, or unquoted text.';
    }
    return BulkParseResult(ok: false, error: hint);
  }

  if (rows.isEmpty) {
    return BulkParseResult(
      ok: false,
      error: formatBulkErrors(errors),
      errors: errors,
    );
  }

  final items = <BulkParsedEntry>[];

  for (var index = 0; index < rows.length; index++) {
    final line = index + 1;
    final row = rows[index];
    if (row is! Map) {
      errors.add('Row $line: not a valid entry.');
      continue;
    }
    final map = Map<String, dynamic>.from(row);

    final contentType =
        normalizeBulkContentType(map['type'] ?? map['contentType']);
    final title = map['title']?.toString().trim() ?? '';
    final genreRaw = map['genre']?.toString().trim() ?? '';
    final genre = genreRaw.isEmpty ? null : resolveBulkGenre(genreRaw);
    final summary =
        (map['summary'] ?? map['reminder'])?.toString().trim() ?? '';
    final leads = parseBulkLeads(map);
    final linkRaw = sanitizeBulkLinkRaw(map['link']?.toString() ?? '');
    final link = linkRaw.isEmpty ? null : normalizeBulkLink(linkRaw);

    if (contentType == null) {
      final typeRaw =
          (map['type'] ?? map['contentType'])?.toString().trim() ?? 'empty';
      errors.add(
        'Row $line (“${title.isEmpty ? 'untitled' : title}”): invalid type “$typeRaw”. Use movies, tvSeries, or anime.',
      );
      continue;
    }
    if (title.isEmpty) {
      errors.add('Row $line: missing title.');
      continue;
    }
    if (genreRaw.isEmpty) {
      errors.add('Row $line (“$title”): missing genre.');
      continue;
    }
    if (genre == null) {
      errors.add(
        'Row $line (“$title”): unknown genre “$genreRaw”. Pick one from the template list.',
      );
      continue;
    }
    if (leads.isEmpty) {
      errors.add('Row $line (“$title”): missing lead actor.');
      continue;
    }
    if (summary.isEmpty) {
      errors.add('Row $line (“$title”): missing summary.');
      continue;
    }
    if (linkRaw.isNotEmpty && link == null) {
      final original = map['link']?.toString().trim() ?? '';
      final looksMarkdown =
          RegExp(r'\[([^\]]*)\]\(([^)]+)\)').hasMatch(original);
      errors.add(
        looksMarkdown
            ? 'Row $line (“$title”): link is markdown — use a plain URL like https://www.imdb.com/title/tt1234567/'
            : 'Row $line (“$title”): invalid link “$original”. Use IMDb.',
      );
      continue;
    }

    final kind = contentType == 'movies'
        ? normalizeKind(map['kind']?.toString() ?? 'movie', contentType)
        : 'series';

    final secondaryRaw = map['secondaryGenres'] ?? map['secondary_genres'];
    final secondaryGenres = secondaryRaw is List
        ? secondaryRaw
            .map((g) => resolveBulkGenre(g.toString()))
            .whereType<String>()
            .where((g) => g != genre && standardGenres.contains(g))
            .toList()
        : <String>[];

    items.add(
      BulkParsedEntry(
        contentType: contentType,
        genre: genre,
        title: title,
        kind: kind,
        lead: leads.join(', '),
        summary: summary,
        link: link,
        secondaryGenres: secondaryGenres,
      ),
    );
  }

  if (items.isEmpty) {
    return BulkParseResult(
      ok: false,
      error: formatBulkErrors(errors),
      errors: errors,
    );
  }

  return BulkParseResult(ok: true, items: items, errors: errors);
}
