import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/config/app_config.dart';
import '../../../core/config/environment.dart';
import 'year_backfill.dart';
import '../../../models/watchlist_item.dart';
import '../../../repositories/metadata/metadata_service.dart';
import 'watchlist_filters.dart';

class YearFetchResult {
  const YearFetchResult({this.year, this.anilistRating});

  final int? year;
  final String? anilistRating;
}

final yearBackfillServiceProvider = Provider<YearBackfillService>((ref) {
  return YearBackfillService(
    metadata: ref.watch(metadataServiceProvider),
    config: ref.watch(appConfigProvider),
  );
});

class YearBackfillService {
  YearBackfillService({
    required MetadataService metadata,
    required AppConfig config,
  })  : _metadata = metadata,
        _config = config;

  final MetadataService _metadata;
  final AppConfig _config;

  Future<YearFetchResult?> fetchYearForItem(WatchlistItem item) async {
    final imdbId = getImdbIdFromItem(item);
    if (imdbId != null && (_config.hasOmdbKey || _config.hasTmdbKey)) {
      final meta = await _metadata.getMetadata(imdbId);
      final year = releaseYearFromMetadata(meta?.year);
      if (year != null) {
        return YearFetchResult(
          year: year,
          anilistRating:
              meta!.anilistRating.isNotEmpty ? meta.anilistRating : null,
        );
      }
    }

    final link = item.link?.trim();
    if (link != null && link.isNotEmpty && isSupportedMetadataLink(link)) {
      final meta = await _metadata.resolveMetadataFromLink(link);
      final year = releaseYearFromMetadata(meta?.year);
      if (year != null) {
        return YearFetchResult(
          year: year,
          anilistRating:
              meta!.anilistRating.isNotEmpty ? meta.anilistRating : null,
        );
      }
    }

    if (item.contentType == 'anime') {
      final target = getAnilistBackfillTarget(item);
      if (target?.type == 'anilist') {
        final meta = await _metadata.fetchAnilistById(target!.id);
        final year = releaseYearFromMetadata(meta?.year);
        if (year != null) {
          return YearFetchResult(
            year: year,
            anilistRating:
                meta!.anilistRating.isNotEmpty ? meta.anilistRating : null,
          );
        }
      }
      if (target?.type == 'mal') {
        final meta = await _metadata.fetchAnilistByMalId(target!.id);
        final year = releaseYearFromMetadata(meta?.year);
        if (year != null) {
          return YearFetchResult(
            year: year,
            anilistRating:
                meta!.anilistRating.isNotEmpty ? meta.anilistRating : null,
          );
        }
      }
      if (item.title.trim().isNotEmpty) {
        final match = await _metadata.fetchAnilistMatchByTitle(
          item.title,
          item.year,
        );
        final year = releaseYearFromMetadata(match?.year);
        if (year != null) {
          return YearFetchResult(
            year: year,
            anilistRating:
                match!.anilistRating.isNotEmpty ? match.anilistRating : null,
          );
        }
      }
    }

    return null;
  }
}
