import 'package:flutter_test/flutter_test.dart';
import 'package:our_movie_nights/core/utils/watchlist_sync_converter.dart';
import 'package:our_movie_nights/models/watchlist_data.dart';

void main() {
  group('rowsToWatchlist', () {
    test('rebuilds nested watchlist and watched map from Supabase rows', () {
      final result = rowsToWatchlist([
        {
          'list_id': 'lst_test',
          'item_id': 'movies::Action::Carry-On',
          'content_type': 'movies',
          'genre': 'Action',
          'title': 'Carry-On',
          'kind': 'movie',
          'lead': 'Taron Egerton',
          'summary': 'A tense airport thriller.',
          'added_at': '2024-06-01T12:00:00.000Z',
          'watched': true,
          'watch_rating': 8.5,
          'watch_note': 'Great watch',
        },
      ]);

      expect(result.watchlist.movies['Action'], hasLength(1));
      final entry = result.watchlist.movies['Action']!.first as Map;
      expect(entry['title'], 'Carry-On');
      expect(entry['addedAt'], DateTime.parse('2024-06-01T12:00:00.000Z').millisecondsSinceEpoch);
      expect(
        result.watched['movies::Action::Carry-On'],
        {'rating': 8.5, 'note': 'Great watch'},
      );
    });

    test('ignores empty watch_progress placeholder rows', () {
      final result = rowsToWatchlist([
        {
          'list_id': 'lst_test',
          'item_id': 'tvSeries::Drama::Show A',
          'content_type': 'tvSeries',
          'genre': 'Drama',
          'title': 'Show A',
          'kind': 'series',
          'watched': false,
          'watch_progress': {'version': 1, 'episodes': <String>[]},
        },
        {
          'list_id': 'lst_test',
          'item_id': 'tvSeries::Drama::Show B',
          'content_type': 'tvSeries',
          'genre': 'Drama',
          'title': 'Show B',
          'kind': 'series',
          'watched': false,
          'watch_progress': {
            'version': 1,
            'episodes': ['1:1', '1:2'],
          },
        },
      ]);

      expect(result.watched.containsKey('tvSeries::Drama::Show A'), isFalse);
      expect(
        result.watched['tvSeries::Drama::Show B'],
        {
          'progress': {
            'version': 1,
            'episodes': ['1:1', '1:2'],
          },
        },
      );
    });
  });

  group('watchlistToRows', () {
    test('uses local addedAt when present', () {
      final addedAt = DateTime.utc(2024, 5, 10).millisecondsSinceEpoch;
      final rows = watchlistToRows(
        'lst_test',
        WatchlistData(
          movies: {
            'Action': [
              {'title': 'Alpha', 'addedAt': addedAt},
            ],
          },
        ),
        const {},
      );

      expect(rows, hasLength(1));
      expect(
        parseAddedAtMs(rows.first['added_at']),
        addedAt,
      );
    });

    test('preserves remote added_at when local entry has none', () {
      final remoteAt = DateTime.utc(2023, 1, 15).toIso8601String();
      final rows = watchlistToRows(
        'lst_test',
        WatchlistData(
          movies: {
            'Action': [
              {'title': 'Alpha'},
            ],
          },
        ),
        const {},
        existingAddedAt: {
          'movies::Action::Alpha': remoteAt,
        },
      );

      expect(parseAddedAtMs(rows.first['added_at']),
          DateTime.parse(remoteAt).millisecondsSinceEpoch);
    });

    test('always sends empty card_poster, selected_season_name, and false no_specials', () {
      final rows = watchlistToRows(
        'lst_test',
        WatchlistData(
          movies: {
            'Action': [
              {'title': 'No Poster'},
            ],
          },
        ),
        const {},
      );

      expect(rows.first['card_poster'], '');
      expect(rows.first['selected_season_name'], '');
      expect(rows.first['no_specials'], false);
    });
  });
}
