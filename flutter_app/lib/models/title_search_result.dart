/// Lightweight search hit — mirrors `metadata.js` search result objects.
class TitleSearchResult {
  const TitleSearchResult({
    required this.source,
    required this.title,
    this.imdbId,
    this.anilistId,
    this.tmdbType,
    this.tmdbId,
    this.year = '',
    this.type = '',
    this.poster = '',
    this.resultKey = '',
  });

  final String source;
  final String title;
  final String? imdbId;
  final int? anilistId;
  final String? tmdbType;
  final int? tmdbId;
  final String year;
  final String type;
  final String poster;
  final String resultKey;

  bool get hasLookupId =>
      imdbId != null || anilistId != null || (tmdbType != null && tmdbId != null);

  String dedupeKey() {
    if (resultKey.isNotEmpty) return resultKey;
    return '${_normalizeTitleKey(title)}::${year.trim()}';
  }

  static String _normalizeTitleKey(String title) {
    return title
        .toLowerCase()
        .replaceAll(RegExp(r'[^a-z0-9]+'), ' ')
        .trim();
  }
}

class TitleSearchResponse {
  const TitleSearchResponse({
    required this.ok,
    this.results = const [],
    this.error,
    this.message,
  });

  final bool ok;
  final List<TitleSearchResult> results;
  final String? error;
  final String? message;
}
