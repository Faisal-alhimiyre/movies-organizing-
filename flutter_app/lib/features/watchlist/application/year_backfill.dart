import '../../../core/config/app_config.dart';
import '../../../models/watchlist_item.dart';
import '../../../repositories/metadata/metadata_service.dart';
import 'watchlist_filters.dart';

bool hasValidReleaseYear(WatchlistItem item) =>
    parseReleaseYear(item.year) != null;

int? releaseYearFromMetadata(String? raw) => parseReleaseYear(raw);

String? getImdbIdFromItem(WatchlistItem item) {
  if (item.link == null || item.link!.trim().isEmpty) return null;
  return MetadataService.extractImdbId(item.link!);
}

class AnilistBackfillTarget {
  const AnilistBackfillTarget({required this.type, required this.id});

  final String type;
  final int id;
}

AnilistBackfillTarget? getAnilistBackfillTarget(WatchlistItem item) {
  final link = item.link?.trim();
  if (link == null || link.isEmpty) return null;

  final anilistId = MetadataService.parseAnilistId(link);
  if (anilistId != null) {
    return AnilistBackfillTarget(type: 'anilist', id: anilistId);
  }

  final malId = MetadataService.parseMalId(link);
  if (malId != null) {
    return AnilistBackfillTarget(type: 'mal', id: malId);
  }

  return null;
}

bool isSupportedMetadataLink(String? link) {
  final value = link?.trim();
  if (value == null || value.isEmpty) return false;
  return MetadataService.extractImdbId(value) != null ||
      MetadataService.parseAnilistId(value) != null ||
      MetadataService.parseMalId(value) != null;
}

bool itemNeedsYearBackfill(WatchlistItem item) {
  if (hasValidReleaseYear(item)) return false;
  if (getImdbIdFromItem(item) != null) return true;
  if (item.contentType == 'anime' && item.title.trim().isNotEmpty) return true;
  if (getAnilistBackfillTarget(item) != null) return true;
  if (isSupportedMetadataLink(item.link)) return true;
  return false;
}

bool yearBackfillNeedsMovieApiKeys(
    List<WatchlistItem> items, AppConfig config) {
  if (config.hasOmdbKey || config.hasTmdbKey) return false;

  return items.any((item) {
    if (hasValidReleaseYear(item) || !itemNeedsYearBackfill(item)) return false;
    if (getImdbIdFromItem(item) != null) return true;
    if (item.contentType != 'anime' && isSupportedMetadataLink(item.link)) {
      return true;
    }
    return false;
  });
}

WatchlistItem applyYearBackfillResult(
  WatchlistItem item, {
  required int? year,
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
    imdbRating: item.imdbRating,
    anilistRating: item.anilistRating ??
        (anilistRating != null && anilistRating.isNotEmpty
            ? anilistRating
            : null),
    year: year ?? item.year,
    addedAt: item.addedAt,
    secondaryGenres: item.secondaryGenres,
  );
}

String? releaseSortEmptyHintKey({
  required List<WatchlistItem> items,
  required bool backfillRunning,
  required AppConfig config,
}) {
  if (backfillRunning) return 'empty.releaseYearLoading';
  if (yearBackfillNeedsMovieApiKeys(items, config)) {
    return 'empty.yearsNeedConfig';
  }
  if (items.isNotEmpty && !items.any(hasValidReleaseYear)) {
    return 'empty.releaseYearMissing';
  }
  return null;
}
