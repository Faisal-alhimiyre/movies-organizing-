import '../../models/watchlist_item.dart';
import '../../repositories/metadata/metadata_service.dart';

/// IMDb id from [item.imdbLink] or an IMDb-shaped [item.link].
String? getImdbIdFromItem(WatchlistItem item) {
  final imdbLink = item.imdbLink?.trim();
  if (imdbLink != null && imdbLink.isNotEmpty) {
    return MetadataService.extractImdbId(imdbLink);
  }
  final link = item.link?.trim();
  if (link == null || link.isEmpty) return null;
  return MetadataService.extractImdbId(link);
}

/// AniList id from [item.link] (or MAL cross-ref is handled elsewhere).
int? getAnilistIdFromItem(WatchlistItem item) {
  final link = item.link?.trim();
  if (link == null || link.isEmpty) return null;
  return MetadataService.parseAnilistId(link);
}

String? imdbUrlForItem(WatchlistItem item) {
  final imdbLink = item.imdbLink?.trim();
  if (imdbLink != null && imdbLink.isNotEmpty) {
    return _normalizeExternalUrl(imdbLink, 'imdb.com');
  }
  return _imdbUrlFromLink(item.link);
}

String? anilistUrlForItem(WatchlistItem item) {
  final fromLink = _anilistUrlFromLink(item.link);
  if (fromLink != null) return fromLink;
  final id = getAnilistIdFromItem(item);
  if (id != null) return 'https://anilist.co/anime/$id/';
  return null;
}

String? _imdbUrlFromLink(String? link) {
  final raw = link?.trim();
  if (raw == null || raw.isEmpty) return null;
  if (raw.contains('imdb.com')) {
    return _normalizeExternalUrl(raw, 'imdb.com');
  }
  final imdbId = MetadataService.extractImdbId(raw);
  if (imdbId != null) return 'https://www.imdb.com/title/$imdbId/';
  return null;
}

String? _anilistUrlFromLink(String? link) {
  final raw = link?.trim();
  if (raw == null || raw.isEmpty) return null;
  if (raw.contains('anilist.co')) {
    return _normalizeExternalUrl(raw, 'anilist.co');
  }
  return null;
}

String? _normalizeExternalUrl(String raw, String hostMarker) {
  if (!raw.contains(hostMarker)) return null;
  if (raw.contains('://')) return raw;
  return 'https://$raw';
}

/// Builds a normalized IMDb URL when [imdbId] is known.
String imdbUrlFromId(String imdbId) =>
    'https://www.imdb.com/title/$imdbId/';
