import 'dart:ui';

import '../../../core/utils/title_meta_format.dart';
import '../../../models/metadata_detail.dart';
import '../../../models/watchlist_item.dart';
import '../../../repositories/metadata/metadata_service.dart';
import 'title_meta_backfill.dart';

bool itemHasLinkPreview(WatchlistItem item) {
  final link = item.link?.trim() ?? '';
  return link.isNotEmpty;
}

bool itemHasLocalPreviewData(WatchlistItem item) {
  final poster = item.poster?.trim() ?? '';
  return poster.startsWith('http') && item.summary.trim().isNotEmpty;
}

MetadataDetail previewDetailsFromItem(WatchlistItem item) {
  return MetadataDetail(
    source: 'local',
    title: item.title,
    poster: item.poster ?? '',
    rating: item.imdbRating ?? '',
    anilistRating: item.anilistRating ?? '',
    year: item.year?.toString() ?? '',
    plot: item.summary,
    contentType: item.contentType,
    ageRating: item.ageRating ?? '',
    runtime: item.runtime ?? '',
    seasonCount: item.seasonCount,
    episodeCount: item.episodeCount,
  );
}

MetadataDetail mergePreviewWithRemote(WatchlistItem item, MetadataDetail remote) {
  final merged = mergeTitleMetaFromDetail(item, remote);
  return MetadataDetail(
    source: remote.source,
    title: remote.title.isNotEmpty ? remote.title : merged.title,
    imdbId: remote.imdbId,
    anilistId: remote.anilistId,
    tmdbType: remote.tmdbType,
    tmdbId: remote.tmdbId,
    link: remote.link.isNotEmpty ? remote.link : (merged.link ?? ''),
    poster: remote.poster.isNotEmpty ? remote.poster : (merged.poster ?? ''),
    rating: remote.rating.isNotEmpty ? remote.rating : (merged.imdbRating ?? ''),
    anilistRating: remote.anilistRating.isNotEmpty
        ? remote.anilistRating
        : (merged.anilistRating ?? ''),
    year: remote.year.isNotEmpty ? remote.year : (merged.year?.toString() ?? ''),
    plot: remote.plot.isNotEmpty ? remote.plot : merged.summary,
    runtime: remote.runtime.isNotEmpty ? remote.runtime : (merged.runtime ?? ''),
    ageRating:
        remote.ageRating.isNotEmpty ? remote.ageRating : (merged.ageRating ?? ''),
    seasonCount: remote.seasonCount ?? merged.seasonCount,
    episodeCount: remote.episodeCount ?? merged.episodeCount,
    actors: remote.actors,
    genres: remote.genres,
    director: remote.director,
    contentType:
        remote.contentType.isNotEmpty ? remote.contentType : merged.contentType,
  );
}

Future<MetadataDetail?> fetchLinkPreviewMeta(
  WatchlistItem item,
  MetadataService metadata,
) async {
  if (!itemHasLinkPreview(item)) return null;

  final link = item.link!.trim();

  Future<MetadataDetail?> fetchRemote({bool forceRefresh = false}) async {
    final imdbId = MetadataService.extractImdbId(link);
    if (imdbId != null) {
      final remote = await metadata.getMetadata(
        imdbId,
        forceRefresh: forceRefresh,
      );
      if (remote != null) return remote;
    }
    if (MetadataService.isSupportedLink(link)) {
      return metadata.resolveMetadataFromLink(
        link,
        forceRefresh: forceRefresh,
      );
    }
    return null;
  }

  if (itemNeedsTitleMetaBackfill(item)) {
    final remote = await fetchRemote(forceRefresh: true);
    if (remote != null) return mergePreviewWithRemote(item, remote);
  }

  if (itemHasLocalPreviewData(item)) {
    return previewDetailsFromItem(item);
  }

  final remote = await fetchRemote();
  if (remote != null) return remote;
  return previewDetailsFromItem(item);
}

List<String> linkPreviewMetaParts(MetadataDetail details, WatchlistItem item) {
  final year =
      details.year.isNotEmpty ? details.year : (item.year?.toString() ?? '');
  final imdb =
      details.rating.isNotEmpty ? details.rating : (item.imdbRating ?? '');
  final anilist = details.anilistRating.isNotEmpty
      ? details.anilistRating
      : (item.anilistRating ?? '');
  final titleMeta = titleMetaPartsFromDetail(
    MetadataDetail(
      source: details.source,
      title: details.title,
      contentType: details.contentType.isNotEmpty
          ? details.contentType
          : item.contentType,
      ageRating: details.ageRating.isNotEmpty
          ? details.ageRating
          : (item.ageRating ?? ''),
      runtime:
          details.runtime.isNotEmpty ? details.runtime : (item.runtime ?? ''),
      seasonCount: details.seasonCount ?? item.seasonCount,
      episodeCount: details.episodeCount ?? item.episodeCount,
    ),
  );

  return [
    if (year.isNotEmpty) year,
    ...titleMeta,
    if (imdb.isNotEmpty) 'IMDb $imdb',
    if (anilist.isNotEmpty) 'AniList $anilist',
  ];
}

Offset computeLinkPreviewPosition({
  required Rect anchor,
  required Size screenSize,
  double popoverWidth = 320,
  double estimatedHeight = 180,
}) {
  final width = popoverWidth.clamp(0, screenSize.width - 32);
  var left = anchor.left + anchor.width / 2 - width / 2;
  left = left.clamp(16, screenSize.width - width - 16);

  var top = anchor.bottom + 10;
  if (top + estimatedHeight > screenSize.height - 16) {
    top = (anchor.top - estimatedHeight - 10).clamp(16, screenSize.height);
  }

  return Offset(left, top);
}
