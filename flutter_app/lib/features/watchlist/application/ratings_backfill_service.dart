import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/config/app_config.dart';
import '../../../core/config/environment.dart';
import '../../../models/metadata_detail.dart';
import '../../../models/watchlist_item.dart';
import '../../../repositories/metadata/metadata_service.dart';
import 'ratings_backfill.dart';
import 'year_backfill.dart';

class RatingsFetchResult {
  const RatingsFetchResult({this.imdbRating, this.anilistRating});

  final String? imdbRating;
  final String? anilistRating;
}

final ratingsBackfillServiceProvider = Provider<RatingsBackfillService>((ref) {
  return RatingsBackfillService(
    metadata: ref.watch(metadataServiceProvider),
    config: ref.watch(appConfigProvider),
  );
});

class RatingsBackfillService {
  RatingsBackfillService({
    required MetadataService metadata,
    required AppConfig config,
  })  : _metadata = metadata,
        _config = config;

  final MetadataService _metadata;
  final AppConfig _config;

  Future<RatingsFetchResult?> fetchImdbRatingForItem(WatchlistItem item) async {
    final imdbId = getImdbIdFromItem(item);
    if (imdbId == null) return null;
    if (!_config.hasOmdbKey && !_config.hasTmdbKey) return null;

    final meta = await _metadata.getMetadata(imdbId);
    final rating = meta?.rating.trim();
    if (rating == null || rating.isEmpty) return null;

    return RatingsFetchResult(imdbRating: rating);
  }

  Future<RatingsFetchResult?> fetchAnilistRatingForItem(
      WatchlistItem item) async {
    final target = getAnilistBackfillTarget(item);
    MetadataDetail? meta;

    if (target?.type == 'mal') {
      meta = await _metadata.fetchAnilistByMalId(target!.id);
    } else if (target?.type == 'anilist') {
      meta = await _metadata.fetchAnilistById(target!.id);
    } else if (item.contentType == 'anime' && item.title.trim().isNotEmpty) {
      final match = await _metadata.fetchAnilistMatchByTitle(
        item.title,
        item.year,
      );
      if (match?.anilistRating.isNotEmpty == true) {
        return RatingsFetchResult(anilistRating: match!.anilistRating);
      }
      return null;
    }

    final rating = meta?.anilistRating.trim();
    if (rating == null || rating.isEmpty) return null;
    return RatingsFetchResult(anilistRating: rating);
  }
}
