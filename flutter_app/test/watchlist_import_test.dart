import 'dart:convert';

import 'package:our_movie_nights/core/utils/watchlist_import.dart';
import 'package:our_movie_nights/models/share_snapshot_payload.dart';
import 'package:our_movie_nights/models/watchlist_data.dart';
import 'package:our_movie_nights/models/watchlist_item.dart';
import 'package:our_movie_nights/core/utils/watchlist_parser.dart';
import 'package:flutter_test/flutter_test.dart';

WatchlistItem _item(String type, String genre, String title) => WatchlistItem(
      id: makeItemId(type, genre, title),
      contentType: type,
      genre: genre,
      title: title,
    );

ShareSnapshotPayload _payload({
  required WatchlistData watchlist,
  Map<String, dynamic> watched = const {},
}) =>
    ShareSnapshotPayload(
      listName: 'Shared',
      watchlist: watchlist,
      watched: watched,
    );

void main() {
  group('mergeWatchlists', () {
    test('adds non-duplicate titles', () {
      final current = itemsToNested([
        _item('movies', 'Action', 'Alpha'),
      ]);
      final imported = itemsToNested([
        _item('movies', 'Drama', 'Beta'),
        _item('movies', 'Action', 'Alpha'),
      ]);

      final merged = mergeWatchlists(current, imported);
      final titles = flattenWatchlist(merged).map((i) => i.title).toList();

      expect(titles, ['Alpha', 'Beta']);
    });
  });

  group('applyMergeImport', () {
    test('counts added and skipped duplicates', () {
      final current = [
        _item('movies', 'Action', 'Alpha'),
      ];
      final payload = _payload(
        watchlist: itemsToNested([
          _item('movies', 'Action', 'Alpha'),
          _item('movies', 'Drama', 'Beta'),
        ]),
      );

      final result = applyMergeImport(
        currentItems: current,
        currentWatched: const {},
        payload: payload,
      );

      expect(result.result.added, 1);
      expect(result.result.skipped, 1);
      expect(result.items.map((i) => i.title), ['Alpha', 'Beta']);
    });

    test('includes watched entries when requested', () {
      final current = [_item('movies', 'Action', 'Alpha')];
      final beta = _item('movies', 'Drama', 'Beta');
      final payload = _payload(
        watchlist: itemsToNested([beta]),
        watched: {
          beta.id: {'rating': 8.5, 'note': 'Great'},
        },
      );

      final result = applyMergeImport(
        currentItems: current,
        currentWatched: const {},
        payload: payload,
        includeWatched: true,
      );

      expect(result.watched[beta.id]?.rating, 8.5);
      expect(result.watched[beta.id]?.note, 'Great');
    });
  });

  group('buildExportPayload', () {
    test('includes stats', () {
      final item = _item('movies', 'Action', 'Alpha');
      final payload = buildExportPayload(
        listName: 'My list',
        items: [item],
        watched: {
          item.id: const WatchEntry(rating: 7),
        },
      );

      expect(payload.listName, 'My list');
      expect(payload.titleCount, 1);
      expect(payload.stats['titles'], 1);
      expect(payload.stats['watched'], 1);
      expect(payload.stats['rated'], 1);
    });
  });

  group('parseImportPayload', () {
    test('accepts valid export json', () {
      final item = _item('movies', 'Action', 'Alpha');
      final export = buildExportPayload(
        listName: 'Backup',
        items: [item],
        watched: const {},
      );

      final parsed = parseImportPayload(jsonEncode(export.toJson()));
      expect(parsed, isNotNull);
      expect(parsed!.listName, 'Backup');
      expect(parsed.titleCount, 1);
    });

    test('rejects empty watchlist', () {
      final parsed = parseImportPayload(
        '{"listName":"Empty","watchlist":{"movies":{},"tvSeries":{},"anime":{}}}',
      );
      expect(parsed, isNull);
    });
  });

  group('uniqueImportedListName', () {
    test('deduplicates against existing names', () {
      expect(
        uniqueImportedListName('Shared', ['Shared', 'Other']),
        'Shared (2)',
      );
    });
  });
}
