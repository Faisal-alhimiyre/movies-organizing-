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
      year: 2020,
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
      year: 2015,
    ),
    const WatchlistItem(
      id: 'movies::Drama::Gamma',
      contentType: 'movies',
      genre: 'Drama',
      title: 'Gamma',
      lead: 'Actor Three',
      summary: 'No year.',
      addedAt: 150,
    ),
  ];

  test('matchesSearch finds title and lead text only', () {
    expect(matchesSearch(sampleItems[0], 'alpha'), isTrue);
    expect(matchesSearch(sampleItems[0], 'actor one'), isTrue);
    expect(matchesSearch(sampleItems[0], 'missing'), isFalse);
    expect(matchesSearch(sampleItems[0], 'hero'), isFalse);
    expect(matchesSearch(sampleItems[0], 'saves'), isFalse);
  });

  test('parseReleaseYear extracts year from varied formats', () {
    expect(parseReleaseYear(2020), 2020);
    expect(parseReleaseYear('2019-05-01'), 2019);
    expect(parseReleaseYear('N/A'), isNull);
    expect(parseReleaseYear(null), isNull);
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
      filters: const WatchlistFilterState(
        sortSource: 'imdb',
        sortDirection: 'best',
      ),
    );

    expect(groups, hasLength(1));
    expect(groups.first.isFlatSorted, isTrue);
    expect(groups.first.items.first.title, 'Alpha');
  });

  test('buildFilteredGroups sorts by release date newest first', () {
    final groups = buildFilteredGroups(
      items: sampleItems,
      watched: const {},
      typeFilter: WatchlistTypeFilter.all,
      filters: const WatchlistFilterState(
        sortSource: 'release',
        sortDirection: 'newest',
      ),
    );

    expect(groups.first.items.map((i) => i.title).toList(),
        ['Alpha', 'Beta', 'Gamma']);
  });

  test('buildFilteredGroups sorts by release date oldest first', () {
    final groups = buildFilteredGroups(
      items: sampleItems,
      watched: const {},
      typeFilter: WatchlistTypeFilter.all,
      filters: const WatchlistFilterState(
        sortSource: 'release',
        sortDirection: 'oldest',
      ),
    );

    expect(groups.first.items.map((i) => i.title).toList(),
        ['Beta', 'Alpha', 'Gamma']);
  });

  test('buildFilteredGroups sorts by age rating most mature first', () {
    final items = [
      const WatchlistItem(
        id: 'movies::Action::Kids',
        contentType: 'movies',
        genre: 'Action',
        title: 'Kids',
        lead: 'Actor',
        summary: 'Family fun.',
        ageRating: 'G',
      ),
      const WatchlistItem(
        id: 'movies::Action::Teen',
        contentType: 'movies',
        genre: 'Action',
        title: 'Teen',
        lead: 'Actor',
        summary: 'Teen drama.',
        ageRating: 'PG-13',
      ),
      const WatchlistItem(
        id: 'movies::Action::Adult',
        contentType: 'movies',
        genre: 'Action',
        title: 'Adult',
        lead: 'Actor',
        summary: 'Mature themes.',
        ageRating: 'NC-17',
      ),
    ];

    final groups = buildFilteredGroups(
      items: items,
      watched: const {},
      typeFilter: WatchlistTypeFilter.all,
      filters: const WatchlistFilterState(
        sortSource: 'age',
        sortDirection: 'best',
      ),
    );

    expect(groups.first.items.map((i) => i.title).toList(),
        ['Adult', 'Teen', 'Kids']);
  });

  test('buildFilteredGroups sorts by age rating least mature first', () {
    final items = [
      const WatchlistItem(
        id: 'movies::Action::Kids',
        contentType: 'movies',
        genre: 'Action',
        title: 'Kids',
        lead: 'Actor',
        summary: 'Family fun.',
        ageRating: 'G',
      ),
      const WatchlistItem(
        id: 'movies::Action::Adult',
        contentType: 'movies',
        genre: 'Action',
        title: 'Adult',
        lead: 'Actor',
        summary: 'Mature themes.',
        ageRating: 'NC-17',
      ),
    ];

    final groups = buildFilteredGroups(
      items: items,
      watched: const {},
      typeFilter: WatchlistTypeFilter.all,
      filters: const WatchlistFilterState(
        sortSource: 'age',
        sortDirection: 'worst',
      ),
    );

    expect(groups.first.items.map((i) => i.title).toList(), ['Kids', 'Adult']);
  });
}
