import 'package:flutter_test/flutter_test.dart';
import 'package:our_movie_nights/features/watchlist/application/watchlist_filters.dart';
import 'package:our_movie_nights/models/watchlist_item.dart';

void main() {
  final sampleItems = [
    const WatchlistItem(
      id: 'movies::Action::Alpha',
      contentType: 'movies',
      genre: 'Action',
      title: 'Alpha',
      lead: 'Actor One',
      summary: 'A hero saves the day.',
      imdbRating: '8.0',
      addedAt: 100,
    ),
    const WatchlistItem(
      id: 'movies::Comedy::Beta',
      contentType: 'movies',
      genre: 'Comedy',
      title: 'Beta',
      lead: 'Actor Two',
      summary: 'A funny night.',
      imdbRating: '6.5',
      addedAt: 200,
    ),
  ];

  test('matchesSearch finds title and lead text only', () {
    expect(matchesSearch(sampleItems[0], 'alpha'), isTrue);
    expect(matchesSearch(sampleItems[0], 'actor one'), isTrue);
    expect(matchesSearch(sampleItems[0], 'missing'), isFalse);
    expect(matchesSearch(sampleItems[0], 'hero'), isFalse);
    expect(matchesSearch(sampleItems[0], 'saves'), isFalse);
  });

  test('filterWatchlistItems respects watched filter', () {
    final watched = {
      'movies::Action::Alpha': const WatchEntry(rating: 9),
    };

    final watchedOnly = filterWatchlistItems(
      items: sampleItems,
      watched: watched,
      typeFilter: WatchlistTypeFilter.all,
      filters: const WatchlistFilterState(watchedFilter: WatchedFilter.watched),
    );

    expect(watchedOnly, hasLength(1));
    expect(watchedOnly.first.title, 'Alpha');
  });

  test('buildFilteredGroups sorts by imdb best', () {
    final groups = buildFilteredGroups(
      items: sampleItems,
      watched: const {},
      typeFilter: WatchlistTypeFilter.all,
      filters: const WatchlistFilterState(ratingFilterValue: 'imdb-best'),
    );

    expect(groups, hasLength(1));
    expect(groups.first.isFlatSorted, isTrue);
    expect(groups.first.items.first.title, 'Alpha');
  });
}
