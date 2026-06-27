import '../../models/metadata_detail.dart';
import '../../core/utils/watchlist_parser.dart';

const _genreAliases = {
  'sci-fi': 'Science Fiction',
  'science fiction': 'Science Fiction',
  'film-noir': 'Crime',
  'film noir': 'Crime',
  'musical': 'Family',
  'biography': 'Historical',
  'history': 'Historical',
  'sport': 'Sports',
  'reality-tv': 'Documentary',
  'talk-show': 'Documentary',
  'news': 'Documentary',
  'game-show': 'Family',
  'psychological': 'Thriller',
  'supernatural': 'Fantasy',
  'thriller': 'Thriller',
  'mystery': 'Mystery',
  'romance': 'Romance',
  'horror': 'Horror',
  'mecha': 'Science Fiction',
  'music': 'Family',
  // TMDB Arabic (ar-SA) genre labels
  'دراما': 'Drama',
  'جريمة': 'Crime',
  'عائلي': 'Family',
  'كوميديا': 'Comedy',
  'رعب': 'Horror',
  'غموض': 'Mystery',
  'رومانسي': 'Romance',
  'رومانسية': 'Romance',
  'أكشن': 'Action',
  'اكشن': 'Action',
  'مغامرة': 'Adventure',
  'وثائقي': 'Documentary',
  'فانتازيا': 'Fantasy',
  'خيال': 'Fantasy',
  'خيال علمي': 'Science Fiction',
  'إثارة': 'Thriller',
  'اثارة': 'Thriller',
  'حرب': 'War',
  'رياضة': 'Sports',
  'تاريخي': 'Historical',
  'غربي': 'Western',
};

const _anilistGenreMap = {
  'Psychological': 'Thriller',
  'Supernatural': 'Fantasy',
  'Suspense': 'Thriller',
  'Ecchi': null,
  'Hentai': null,
};

const animeGenreFallback = 'Action';

String? mapGenreToStandard(String rawGenre) {
  final trimmed = rawGenre.trim();
  if (trimmed.isEmpty) return null;

  final lower = trimmed.toLowerCase();
  final alias = _genreAliases[lower] ?? _genreAliases[trimmed];
  if (alias != null && standardGenres.contains(alias)) return alias;

  for (final genre in standardGenres) {
    if (genre.toLowerCase() == lower) return genre;
  }

  for (final genre in standardGenres) {
    final gLower = genre.toLowerCase();
    if (lower.contains(gLower) || gLower.contains(lower)) return genre;
  }

  return null;
}

String? mapAnilistGenre(String genre) {
  if (_anilistGenreMap.containsKey(genre) && _anilistGenreMap[genre] == null) {
    return null;
  }
  final mapped = _anilistGenreMap[genre];
  if (mapped != null) return mapped;
  return mapGenreToStandard(genre);
}

List<String> parseGenreList(dynamic raw) {
  if (raw is List) {
    return raw
        .map((e) => e.toString().trim())
        .where((e) => e.isNotEmpty)
        .toList();
  }
  if (raw is String) {
    return raw
        .split(',')
        .map((e) => e.trim())
        .where((e) => e.isNotEmpty)
        .toList();
  }
  return const [];
}

List<String> suggestGenres(
  List<String> rawGenres,
  String contentType,
) {
  final mapped = <String>[];
  for (final raw in rawGenres) {
    final genre = mapAnilistGenre(raw) ?? mapGenreToStandard(raw);
    if (genre != null && !mapped.contains(genre)) mapped.add(genre);
  }

  if (contentType != 'anime') return mapped;

  final withoutAnimation =
      mapped.where((g) => g.toLowerCase() != 'animation').toList();
  if (withoutAnimation.isNotEmpty) return withoutAnimation;
  if (mapped.isNotEmpty) return mapped;
  return [animeGenreFallback];
}

/// When genre mapping fails, avoid Action (standardGenres[0]) for live-action TV.
String defaultGenreForContentType(String contentType) {
  if (contentType == 'anime') return animeGenreFallback;
  return 'Drama';
}

bool _isAnimatedContent(List<String> genres) {
  return genres.any((genre) {
    final lower = genre.toLowerCase();
    return lower == 'animation' || lower == 'anime';
  });
}

/// Mirrors `metadata.js` → `inferContentType`.
String inferContentType(String mediaType, List<String> genres) {
  final type = mediaType.toLowerCase();
  final animated = _isAnimatedContent(genres);

  if (type == 'anime' || type == 'animation') return 'anime';
  if (type == 'series' || type == 'episode' || type == 'tv') {
    return animated ? 'anime' : 'tvSeries';
  }
  if (type == 'movie' || type == 'game') {
    return animated ? 'anime' : 'movies';
  }
  if (animated) return 'anime';
  return 'movies';
}

String defaultLinkForDetails(MetadataDetail details) {
  if (details.imdbId != null && details.imdbId!.isNotEmpty) {
    return 'https://www.imdb.com/title/${details.imdbId}/';
  }
  if (details.anilistId != null) {
    return 'https://anilist.co/anime/${details.anilistId}/';
  }
  final existing = details.link.trim();
  if (existing.isNotEmpty) return existing;
  // TMDB fallback when TMDB has no IMDb mapping (common for some Arabic titles)
  if (details.tmdbType != null && details.tmdbId != null) {
    return 'https://www.themoviedb.org/${details.tmdbType}/${details.tmdbId}';
  }
  return '';
}
