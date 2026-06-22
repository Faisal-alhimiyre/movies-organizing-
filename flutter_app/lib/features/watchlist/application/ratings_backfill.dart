import '../../../core/config/app_config.dart';
import '../../../models/watchlist_item.dart';
import 'watchlist_filters.dart';
import 'year_backfill.dart';

bool hasStoredImdbRating(WatchlistItem item) {
  final rating = item.imdbRating?.trim();
  return rating != null && rating.isNotEmpty;
}

bool hasStoredAnilistRating(WatchlistItem item) {
  final rating = item.anilistRating?.trim();
  return rating != null && rating.isNotEmpty;
}

bool itemNeedsImdbBackfill(WatchlistItem item) {
  return getImdbIdFromItem(item) != null && !hasStoredImdbRating(item);
}

bool itemNeedsAnilistBackfill(WatchlistItem item) {
  if (item.contentType != 'anime' || hasStoredAnilistRating(item)) return false;
  if (getAnilistBackfillTarget(item) != null) return true;
  return item.title.trim().isNotEmpty;
}

bool ratingsBackfillNeedsMovieApiKeys(
    List<WatchlistItem> items, AppConfig config) {
  if (config.hasOmdbKey || config.hasTmdbKey) return false;
  return items.any(itemNeedsImdbBackfill);
}

WatchlistItem applyRatingsBackfillResult(
  WatchlistItem item, {
  String? imdbRating,
  String? anilistRating,
}) {
  return WatchlistItem(
    id: item.id,
    contentType: item.contentType,
    genre: item.genre,
    title: item.title,
    lead: item.lead,
    summary: item.summary,
    kind: item.kind,
    link: item.link,
    poster: item.poster,
    imdbRating: item.imdbRating ??
        (imdbRating != null && imdbRating.isNotEmpty ? imdbRating : null),
    anilistRating: item.anilistRating ??
        (anilistRating != null && anilistRating.isNotEmpty
            ? anilistRating
            : null),
    ageRating: item.ageRating,
    runtime: item.runtime,
    seasonCount: item.seasonCount,
    episodeCount: item.episodeCount,
    year: item.year,
    addedAt: item.addedAt,
    secondaryGenres: item.secondaryGenres,
  );
}

String? ratingSortEmptyHintKey({
  required List<WatchlistItem> items,
  required String sortSource,
  required bool ratingsBackfillRunning,
  required AppConfig config,
}) {
  if (sortSource == 'personal' || sortSource == 'all') return null;

  if (sortSource == 'release') return null;

  if (ratingsBackfillRunning) {
    return sortSource == 'anilist'
        ? 'empty.anilistRatingLoading'
        : 'empty.ratingLoading';
  }

  if (sortSource == 'anilist') {
    final hasAnime = items.any(
      (item) => item.contentType == 'anime' && item.title.trim().isNotEmpty,
    );
    if (!hasAnime) return null;
  } else if (sortSource == 'imdb') {
    final withLink = items.any((item) => getImdbIdFromItem(item) != null);
    if (!withLink) return null;
    if (ratingsBackfillNeedsMovieApiKeys(items, config)) {
      return 'empty.ratingNeedConfig';
    }
  }

  final hasScores = items.any((item) {
    if (sortSource == 'imdb') return itemImdbScore(item) != null;
    if (sortSource == 'anilist') return itemAnilistSortScore(item) != null;
    return false;
  });

  if (!hasScores) {
    return sortSource == 'anilist'
        ? 'empty.anilistRatingMissing'
        : 'empty.ratingMissing';
  }

  return null;
}

bool isImdbSortActive(WatchlistFilterState filters) =>
    filters.sortSource == 'imdb';

bool isAgeSortActive(WatchlistFilterState filters) =>
    filters.sortSource == 'age';

bool isAnilistSortActive(WatchlistFilterState filters) =>
    filters.sortSource == 'anilist';
