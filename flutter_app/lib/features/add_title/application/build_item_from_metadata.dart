import '../../../models/metadata_detail.dart';
import '../../../models/watchlist_item.dart';
import '../../../repositories/metadata/genre_mapper.dart';
import '../../../core/utils/watchlist_parser.dart';

WatchlistItem buildItemFromMetadata({
  required MetadataDetail details,
  required String contentType,
  required String genre,
  List<String>? secondaryGenres,
}) {
  final normalizedGenre = normalizeGenre(genre);
  final suggested = suggestGenres(details.genres, contentType);
  final secondary = normalizeSecondaryGenres(
    normalizedGenre,
    secondaryGenres ?? suggested.where((g) => g != normalizedGenre).toList(),
  );

  final leads = details.actors.isNotEmpty
      ? details.actors
      : details.director.isNotEmpty
          ? [details.director]
          : <String>[];

  String? imdbRating;
  String? anilistRating;
  if (details.anilistRating.isNotEmpty ||
      details.source == 'anilist' ||
      details.anilistId != null) {
    if (details.anilistRating.isNotEmpty) {
      anilistRating = details.anilistRating;
    } else if (details.rating.isNotEmpty) {
      final score = double.tryParse(details.rating.replaceAll(',', '.'));
      if (score != null) {
        anilistRating =
            score <= 10 ? '${(score * 10).round()}' : '${score.round()}';
      }
    }
  } else if (details.rating.isNotEmpty) {
    imdbRating = details.rating;
  }

  int? year;
  final yearRaw = details.year.trim();
  if (yearRaw.length >= 4) {
    year = int.tryParse(yearRaw.substring(0, 4));
  }

  return WatchlistItem(
    id: makeItemId(contentType, normalizedGenre, details.title.trim()),
    contentType: contentType,
    genre: normalizedGenre,
    title: details.title.trim(),
    lead: leads.join(', '),
    summary: details.plot,
    kind: contentType == 'movies' ? 'movie' : 'series',
    link: defaultLinkForDetails(details),
    poster: details.poster.isNotEmpty ? details.poster : null,
    imdbRating: imdbRating,
    anilistRating: anilistRating,
    year: year,
    addedAt: DateTime.now().millisecondsSinceEpoch,
    secondaryGenres: secondary,
  );
}

List<String> normalizeSecondaryGenres(String primary, List<String> raw) {
  final seen = <String>{primary};
  final result = <String>[];
  for (final genre in raw) {
    final normalized = normalizeGenre(genre);
    if (seen.add(normalized)) result.add(normalized);
  }
  return result;
}
