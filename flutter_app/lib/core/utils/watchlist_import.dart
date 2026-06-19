import '../../models/share_snapshot_payload.dart';
import '../../models/watchlist_data.dart';
import '../../models/watchlist_item.dart';
import 'watchlist_parser.dart';

String itemKey(String contentType, String title) =>
    '$contentType::${title.trim().toLowerCase()}';

class ImportMergeResult {
  const ImportMergeResult({required this.added, required this.skipped});

  final int added;
  final int skipped;
}

ShareSnapshotPayload buildExportPayload({
  required String listName,
  String listDescription = '',
  required List<WatchlistItem> items,
  required Map<String, WatchEntry> watched,
}) {
  final nested = itemsToNested(items);
  final watchedJson = watchedMapToJson(watched);
  var ratedCount = 0;
  for (final entry in watched.values) {
    if (entry.rating != null) ratedCount++;
  }

  return ShareSnapshotPayload(
    listName: listName,
    listDescription: listDescription,
    watchlist: nested,
    watched: watchedJson,
    stats: {
      'titles': items.length,
      'watched': watched.length,
      'rated': ratedCount,
    },
  );
}

WatchlistData mergeWatchlists(WatchlistData current, WatchlistData imported) {
  final items = flattenWatchlist(current);
  final keys = items.map((i) => itemKey(i.contentType, i.title)).toSet();
  final now = DateTime.now().millisecondsSinceEpoch;

  for (final item in flattenWatchlist(imported)) {
    final key = itemKey(item.contentType, item.title);
    if (keys.contains(key)) continue;

    keys.add(key);
    items.add(
      WatchlistItem(
        id: makeItemId(item.contentType, item.genre, item.title),
        contentType: item.contentType,
        genre: item.genre,
        title: item.title,
        lead: item.lead,
        summary: item.summary,
        kind: item.kind,
        link: item.link,
        poster: item.poster,
        imdbRating: item.imdbRating,
        anilistRating: item.anilistRating,
        year: item.year,
        addedAt: item.addedAt ?? now,
        secondaryGenres: item.secondaryGenres,
      ),
    );
  }

  return itemsToNested(items);
}

ImportMergeResult mergeImportIntoCurrentList({
  required List<WatchlistItem> currentItems,
  required Map<String, WatchEntry> currentWatched,
  required ShareSnapshotPayload payload,
  bool includeWatched = false,
}) {
  final beforeCount = currentItems.length;
  final importItems = flattenWatchlist(payload.watchlist);

  var skipped = 0;
  final beforeKeys =
      currentItems.map((i) => itemKey(i.contentType, i.title)).toSet();
  for (final item in importItems) {
    if (beforeKeys.contains(itemKey(item.contentType, item.title))) {
      skipped++;
    }
  }

  final currentData = itemsToNested(currentItems);
  final mergedData = mergeWatchlists(currentData, payload.watchlist);
  final mergedItems = flattenWatchlist(mergedData);
  final watched = Map<String, WatchEntry>.from(currentWatched);

  if (includeWatched) {
    for (final item in importItems) {
      final raw = payload.watched[makeItemId(item.contentType, item.genre, item.title)] ??
          _findWatchedByTitleKey(payload.watched, item.contentType, item.title);
      if (raw == null) continue;
      watched[makeItemId(item.contentType, item.genre, item.title)] =
          WatchEntry.fromJson(raw);
    }
  }

  final added = mergedItems.length - beforeCount;
  return ImportMergeResult(
    added: added < 0 ? 0 : added,
    skipped: skipped,
  );
}

({List<WatchlistItem> items, Map<String, WatchEntry> watched, ImportMergeResult result})
    applyMergeImport({
  required List<WatchlistItem> currentItems,
  required Map<String, WatchEntry> currentWatched,
  required ShareSnapshotPayload payload,
  bool includeWatched = false,
}) {
  final merge = mergeImportIntoCurrentList(
    currentItems: currentItems,
    currentWatched: currentWatched,
    payload: payload,
    includeWatched: includeWatched,
  );

  final mergedData =
      mergeWatchlists(itemsToNested(currentItems), payload.watchlist);
  final items = flattenWatchlist(mergedData);
  var watched = Map<String, WatchEntry>.from(currentWatched);

  if (includeWatched) {
    for (final item in flattenWatchlist(payload.watchlist)) {
      final raw = payload.watched[makeItemId(item.contentType, item.genre, item.title)] ??
          _findWatchedByTitleKey(payload.watched, item.contentType, item.title);
      if (raw == null) continue;
      watched[makeItemId(item.contentType, item.genre, item.title)] =
          WatchEntry.fromJson(raw);
    }
  }

  return (items: items, watched: watched, result: merge);
}

({List<WatchlistItem> items, Map<String, WatchEntry> watched}) applyReplaceImport(
  ShareSnapshotPayload payload,
) {
  final items = applyImportReplace(payload);
  final watched = watchedFromImport(payload, items);
  return (items: items, watched: watched);
}

dynamic _findWatchedByTitleKey(
  Map<String, dynamic> watched,
  String contentType,
  String title,
) {
  final key = itemKey(contentType, title);
  for (final entry in watched.entries) {
    final parts = entry.key.split('::');
    if (parts.length >= 3) {
      final entryKey = itemKey(parts[0], parts.sublist(2).join('::'));
      if (entryKey == key) return entry.value;
    }
  }
  return null;
}

List<WatchlistItem> applyImportReplace(ShareSnapshotPayload payload) {
  return flattenWatchlist(payload.watchlist);
}

Map<String, WatchEntry> watchedFromImport(
  ShareSnapshotPayload payload,
  List<WatchlistItem> items,
) {
  final result = <String, WatchEntry>{};
  for (final item in items) {
    final raw = payload.watched[item.id] ??
        _findWatchedByTitleKey(payload.watched, item.contentType, item.title);
    if (raw == null) continue;
    result[item.id] = WatchEntry.fromJson(raw);
  }
  return result;
}
