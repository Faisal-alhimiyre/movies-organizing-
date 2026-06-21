import '../../../core/config/app_config.dart';
import '../../../models/metadata_detail.dart';
import '../../../models/watchlist_item.dart';
import '../../../repositories/metadata/metadata_service.dart';
import 'year_backfill.dart';

const posterEnrichmentThrottle = Duration(milliseconds: 280);

bool hasValidPoster(WatchlistItem item) {
  final poster = item.poster?.trim();
  return poster != null && poster.startsWith('http');
}

bool itemNeedsPosterBackfill(WatchlistItem item) {
  if (hasValidPoster(item)) return false;
  return isSupportedMetadataLink(item.link);
}

bool posterBackfillNeedsMovieApiKeys(
    List<WatchlistItem> items, AppConfig config) {
  if (config.hasOmdbKey || config.hasTmdbKey) return false;

  return items.any((item) {
    if (hasValidPoster(item) || !itemNeedsPosterBackfill(item)) return false;
    return getImdbIdFromItem(item) != null;
  });
}

WatchlistItem applyPosterEnrichment(WatchlistItem item, MetadataDetail meta) {
  final poster = meta.poster.trim();
  final year = releaseYearFromMetadata(meta.year);

  return WatchlistItem(
    id: item.id,
    contentType: item.contentType,
    genre: item.genre,
    title: item.title,
    lead: item.lead,
    summary: item.summary,
    kind: item.kind,
    link: item.link,
    poster:
        poster.isNotEmpty && poster.startsWith('http') ? poster : item.poster,
    imdbRating:
        item.imdbRating ?? (meta.rating.isNotEmpty ? meta.rating : null),
    anilistRating: item.anilistRating ??
        (meta.anilistRating.isNotEmpty ? meta.anilistRating : null),
    ageRating: item.ageRating ??
        (meta.ageRating.isNotEmpty ? meta.ageRating : null),
    runtime:
        item.runtime ?? (meta.runtime.isNotEmpty ? meta.runtime : null),
    seasonCount: item.seasonCount ?? meta.seasonCount,
    episodeCount: item.episodeCount ?? meta.episodeCount,
    year: item.year ?? year,
    addedAt: item.addedAt,
    secondaryGenres: item.secondaryGenres,
  );
}

Future<WatchlistItem> enrichItemWithPoster(
  MetadataService metadata,
  WatchlistItem item, {
  AppConfig? config,
}) async {
  if (!itemNeedsPosterBackfill(item)) return item;

  final imdbId = getImdbIdFromItem(item);
  if (imdbId != null &&
      config != null &&
      !config.hasOmdbKey &&
      !config.hasTmdbKey) {
    return item;
  }

  try {
    MetadataDetail? meta;
    if (imdbId != null) {
      meta = await metadata.getMetadata(imdbId, requirePoster: true);
    } else {
      final link = item.link?.trim();
      if (link != null && link.isNotEmpty) {
        meta =
            await metadata.resolveMetadataFromLink(link, requirePoster: true);
      }
    }

    if (meta != null && meta.poster.trim().isNotEmpty) {
      return applyPosterEnrichment(item, meta);
    }
  } catch (_) {
    // Best-effort, same as web hydratePosters.
  }

  return item;
}

Future<List<WatchlistItem>> enrichItemsWithPosters(
  MetadataService metadata,
  List<WatchlistItem> items, {
  AppConfig? config,
  Duration throttle = posterEnrichmentThrottle,
}) async {
  if (items.isEmpty) return items;

  final enriched = <WatchlistItem>[];
  for (var index = 0; index < items.length; index++) {
    enriched.add(
        await enrichItemWithPoster(metadata, items[index], config: config));
    if (index < items.length - 1) {
      await Future<void>.delayed(throttle);
    }
  }
  return enriched;
}
