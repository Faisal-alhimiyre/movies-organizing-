import 'package:flutter_test/flutter_test.dart';
import 'package:our_movie_nights/core/utils/watchlist_parser.dart';
import 'package:our_movie_nights/models/watchlist_data.dart';
import 'package:our_movie_nights/models/watchlist_item.dart';

void main() {
  group('flattenWatchlist', () {
    test('matches web makeId format', () {
      final data = WatchlistData(
        movies: {
          'Action': [
            {
              'title': 'Carry-On',
              'lead': 'Taron Egerton',
              'kind': 'movie',
            },
          ],
        },
      );

      final items = flattenWatchlist(data);
      expect(items, hasLength(1));
      expect(items.first.id, 'movies::Action::Carry-On');
      expect(items.first.contentType, 'movies');
      expect(items.first.genre, 'Action');
      expect(items.first.lead, 'Taron Egerton');
    });

    test('groups by genre when type is all', () {
      final data = WatchlistData(
        movies: {
          'Comedy': [
            {'title': 'A'},
          ],
        },
        tvSeries: {
          'Comedy': [
            {'title': 'B'},
          ],
        },
      );

      final items = flattenWatchlist(data);
      final groups = groupItems(
        items,
        type: WatchlistTypeFilter.all,
        isWatched: (_) => false,
      );

      expect(groups, hasLength(1));
      expect(groups.first.genre, 'Comedy');
      expect(groups.first.items, hasLength(2));
    });
  });
}
