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
  final alias = _genreAliases[lower];
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
  if (details.link.isNotEmpty) return details.link;
  if (details.imdbId != null && details.imdbId!.isNotEmpty) {
    return 'https://www.imdb.com/title/${details.imdbId}/';
  }
  if (details.anilistId != null) {
    return 'https://anilist.co/anime/${details.anilistId}/';
  }
  return '';
}
