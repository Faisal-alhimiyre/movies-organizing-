import 'package:flutter_test/flutter_test.dart';
import 'package:our_movie_nights/core/utils/watchlist_parser.dart';
import 'package:our_movie_nights/models/watchlist_item.dart';

void main() {
  group('itemsToNested', () {
    test('round-trips flat items through nested structure', () {
      final items = [
        WatchlistItem(
          id: 'movies::Action::Carry-On',
          contentType: 'movies',
          genre: 'Action',
          title: 'Carry-On',
          lead: 'Taron Egerton',
          summary: 'Airport thriller.',
          kind: 'movie',
        ),
      ];

      final nested = itemsToNested(items);
      final flat = flattenWatchlist(nested);

      expect(flat, hasLength(1));
      expect(flat.first.title, 'Carry-On');
      expect(flat.first.genre, 'Action');
    });
  });

  group('findDuplicateTitle', () {
    test('detects same type and title', () {
      final items = [
        const WatchlistItem(
          id: 'movies::Action::A',
          contentType: 'movies',
          genre: 'Action',
          title: 'Same',
        ),
      ];
      final candidate = const WatchlistItem(
        id: 'movies::Comedy::Same',
        contentType: 'movies',
        genre: 'Comedy',
        title: 'same',
      );

      expect(findDuplicateTitle(items, candidate), isNotNull);
    });
  });
}
