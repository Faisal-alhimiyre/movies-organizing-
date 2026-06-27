import '../../../core/config/app_config.dart';
import '../../../models/metadata_detail.dart';
import '../../../models/watchlist_item.dart';
import 'year_backfill.dart';

bool hasStoredAgeRating(WatchlistItem item) {
  final age = item.ageRating?.trim();
  return age != null && age.isNotEmpty;
}

bool itemHasTitleMeta(WatchlistItem item) {
  if (hasStoredAgeRating(item)) return true;
  final runtime = item.runtime?.trim();
  if (runtime != null && runtime.isNotEmpty) return true;
  if (item.seasonCount != null && item.seasonCount! > 0) return true;
  if (item.episodeCount != null && item.episodeCount! > 0) return true;
  return false;
}

/// Stale counts for non-anime only — anime uses AniList (1 season / N eps is normal).
bool itemNeedsSeriesBadgeRefresh(WatchlistItem item) {
  if (item.contentType == 'anime') return false;
  if (item.contentType != 'tvSeries') {
    return false;
  }
  if (!isSupportedMetadataLink(item.link)) return false;
  final seasons = item.seasonCount;
  final episodes = item.episodeCount;
  if ((seasons == null || seasons <= 0) && (episodes ?? 0) > 0) return true;
  return false;
}

bool itemNeedsEpisodeRuntime(WatchlistItem item) {
  if (item.contentType == 'movies') return false;
  final runtime = item.runtime?.trim();
  if (runtime != null && runtime.isNotEmpty) return false;
  return isSupportedMetadataLink(item.link);
}

bool itemNeedsTitleMetaBackfill(WatchlistItem item) {
  if (itemNeedsSeriesBadgeRefresh(item)) return true;
  if (!isSupportedMetadataLink(item.link)) return false;
  if (!itemHasTitleMeta(item)) return true;
  return itemNeedsEpisodeRuntime(item);
}

WatchlistItem mergeTitleMetaFromDetail(
  WatchlistItem item,
  MetadataDetail meta, {
  int? seasonCount,
  int? episodeCount,
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
    imdbLink: item.imdbLink,
    poster: item.poster,
    imdbRating: item.imdbRating ??
        (meta.rating.isNotEmpty ? meta.rating : null),
    anilistRating: item.anilistRating ??
        (meta.anilistRating.isNotEmpty ? meta.anilistRating : null),
    ageRating: item.ageRating ??
        (meta.ageRating.isNotEmpty ? meta.ageRating : null),
    runtime:
        item.runtime ?? (meta.runtime.isNotEmpty ? meta.runtime : null),
    seasonCount: seasonCount ?? item.seasonCount ?? meta.seasonCount,
    episodeCount: episodeCount ?? item.episodeCount ?? meta.episodeCount,
    year: item.year,
    addedAt: item.addedAt,
    secondaryGenres: item.secondaryGenres,
  );
}

String? ageSortEmptyHintKey({
  required List<WatchlistItem> items,
  required bool backfillRunning,
  required AppConfig config,
}) {
  if (backfillRunning) return 'empty.ageRatingLoading';
  if (yearBackfillNeedsMovieApiKeys(items, config)) {
    final needsMovie = items.any(
      (item) => !hasStoredAgeRating(item) && getImdbIdFromItem(item) != null,
    );
    if (needsMovie) return 'empty.yearsNeedConfig';
  }
  if (items.isNotEmpty && !items.any(hasStoredAgeRating)) {
    return 'empty.ageRatingMissing';
  }
  return null;
}