import 'package:flutter_test/flutter_test.dart';
import 'package:our_movie_nights/core/utils/watchlist_sync_converter.dart';

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
          'watched': true,
          'watch_rating': 8.5,
          'watch_note': 'Great watch',
        },
      ]);

      expect(result.watchlist.movies['Action'], hasLength(1));
      expect(result.watchlist.movies['Action']!.first['title'], 'Carry-On');
      expect(
        result.watched['movies::Action::Carry-On'],
        {'rating': 8.5, 'note': 'Great watch'},
      );
    });
  });
}
