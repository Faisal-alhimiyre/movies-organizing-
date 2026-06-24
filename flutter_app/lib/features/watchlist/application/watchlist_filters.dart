import '../../../core/utils/watchlist_parser.dart';
import '../../../core/utils/title_meta_format.dart';
import '../../../models/watchlist_item.dart';

enum WatchedFilter { all, watched, unwatched, inProgress }

class WatchlistFilterState {
  const WatchlistFilterState({
    this.search = '',
    this.selectedGenres = const [],
    this.watchedFilter = WatchedFilter.all,
    this.sortSource = 'all',
    this.sortDirection = 'newest',
  });

  final String search;
  final List<String> selectedGenres;
  final WatchedFilter watchedFilter;

  /// Sort mode: all, added, release, imdb, anilist, personal
  final String sortSource;

  /// newest/oldest for date sorts; best/worst for rating sorts
  final String sortDirection;

  bool get hasActiveFilters =>
      search.trim().isNotEmpty ||
      selectedGenres.isNotEmpty ||
      watchedFilter != WatchedFilter.all ||
      sortSource != 'all';

  WatchlistFilterState copyWith({
    String? search,
    List<String>? selectedGenres,
    WatchedFilter? watchedFilter,
    String? sortSource,
    String? sortDirection,
  }) {
    return WatchlistFilterState(
      search: search ?? this.search,
      selectedGenres: selectedGenres ?? this.selectedGenres,
      watchedFilter: watchedFilter ?? this.watchedFilter,
      sortSource: sortSource ?? this.sortSource,
      sortDirection: sortDirection ?? this.sortDirection,
    );
  }
}

class RatingFilterParts {
  const RatingFilterParts({required this.source, required this.sort});

  final String source;
  final String sort;
}

RatingFilterParts ratingFilterPartsFromState(WatchlistFilterState filters) {
  if (filters.sortSource == 'all') {
    return const RatingFilterParts(source: 'all', sort: 'default');
  }
  return RatingFilterParts(
    source: filters.sortSource,
    sort: filters.sortDirection,
  );
}

bool isDateSortSource(String source) =>
    source == 'added' || source == 'release';

bool isRatingSortSource(String source) =>
    source == 'imdb' ||
    source == 'anilist' ||
    source == 'personal' ||
    source == 'age';

bool isToggleSortActive(WatchlistFilterState filters) =>
    filters.sortSource != 'all';

bool isReleaseSortActive(WatchlistFilterState filters) =>
    filters.sortSource == 'release';

bool isSortDescendingPreferred(WatchlistFilterState filters) {
  if (isDateSortSource(filters.sortSource)) {
    return filters.sortDirection != 'oldest';
  }
  if (isRatingSortSource(filters.sortSource)) {
    return filters.sortDirection != 'worst';
  }
  return true;
}

int? parseReleaseYear(dynamic value) {
  if (value == null) return null;
  final raw = value.toString().trim();
  if (raw.isEmpty || RegExp(r'^n/a$', caseSensitive: false).hasMatch(raw)) {
    return null;
  }
  final match = RegExp(r'\b(18[89]\d|19\d{2}|20\d{2})\b').firstMatch(raw);
  if (match == null) return null;
  final year = int.tryParse(match.group(1)!);
  return year;
}

bool matchesSearch(WatchlistItem item, String query) {
  final q = query.trim().toLowerCase();
  if (q.isEmpty) return true;

  final haystack = [
    item.title,
    item.lead,
  ].join(' ').toLowerCase();

  return haystack.contains(q);
}

List<String> itemGenres(WatchlistItem item) {
  return [item.genre, ...item.secondaryGenres];
}

bool itemHasGenre(WatchlistItem item, String genre) {
  return itemGenres(item).contains(genre);
}

bool itemMatchesGenreFilter(WatchlistItem item, List<String> selectedGenres) {
  if (selectedGenres.isEmpty) return true;
  return selectedGenres.any((genre) => itemHasGenre(item, genre));
}

bool itemMatchesAllSelectedGenres(
    WatchlistItem item, List<String> selectedGenres) {
  if (selectedGenres.isEmpty) return false;
  return selectedGenres.every((genre) => itemHasGenre(item, genre));
}

String filterDisplayGenre(WatchlistItem item, List<String> selectedGenres) {
  if (selectedGenres.isEmpty) return item.genre;

  final matching =
      selectedGenres.where((genre) => itemHasGenre(item, genre)).toList();
  if (matching.isEmpty) return item.genre;
  if (matching.contains(item.genre)) return item.genre;
  return matching.first;
}

double? parseScoreValue(String? raw) {
  if (raw == null || raw.isEmpty) return null;
  final num =
      double.tryParse(raw.replaceAll(',', '.').replaceAll('%', '').trim());
  return num != null && num.isFinite ? num : null;
}

double? itemImdbScore(WatchlistItem item) => parseScoreValue(item.imdbRating);

double? itemPersonalScore(WatchlistItem item, Map<String, WatchEntry> watched) {
  final entry = watched[item.id];
  if (entry?.rating == null) return null;
  return entry!.rating;
}

double? itemAnilistSortScore(WatchlistItem item) {
  final raw = parseScoreValue(item.anilistRating);
  if (raw == null) return null;
  return raw > 10 ? raw : raw * 10;
}

double? ratingSortScore(
  WatchlistItem item,
  String source,
  Map<String, WatchEntry> watched,
) {
  switch (source) {
    case 'imdb':
      return itemImdbScore(item);
    case 'anilist':
      return itemAnilistSortScore(item);
    case 'personal':
      return itemPersonalScore(item, watched);
    case 'age':
      return ageRatingSortRank(item.ageRating)?.toDouble();
    default:
      return null;
  }
}

bool itemMatchesWatchedFilter(
  WatchlistItem item,
  WatchedFilter filter,
  Map<String, WatchEntry> watched,
) {
  return switch (filter) {
    WatchedFilter.all => true,
    WatchedFilter.unwatched => !isItemWatched(item.id, watched),
    WatchedFilter.watched => _isItemFullyWatched(item.id, watched),
    WatchedFilter.inProgress => _isItemInProgress(item.id, watched),
  };
}

bool _isItemFullyWatched(String id, Map<String, WatchEntry> watched) {
  final entry = watched[id];
  if (entry == null) return false;
  return entry.isFullyWatched;
}

bool _isItemInProgress(String id, Map<String, WatchEntry> watched) {
  final entry = watched[id];
  if (entry == null) return false;
  return entry.isInProgress;
}

bool itemMatchesRatingFilter(
  WatchlistItem item,
  RatingFilterParts rating,
  Map<String, WatchEntry> watched,
) {
  if (rating.source == 'all' ||
      rating.source == 'added' ||
      rating.source == 'release') {
    return true;
  }
  return ratingSortScore(item, rating.source, watched) != null;
}

List<WatchlistItem> filterWatchlistItems({
  required List<WatchlistItem> items,
  required Map<String, WatchEntry> watched,
  required WatchlistTypeFilter typeFilter,
  required WatchlistFilterState filters,
}) {
  final rating = ratingFilterPartsFromState(filters);
  final typeKey = typeFilter.contentTypeKey;

  return items.where((item) {
    if (typeKey != null && item.contentType != typeKey) return false;
    if (!itemMatchesGenreFilter(item, filters.selectedGenres)) return false;
    if (!matchesSearch(item, filters.search)) return false;
    if (!itemMatchesWatchedFilter(item, filters.watchedFilter, watched)) {
      return false;
    }
    if (!itemMatchesRatingFilter(item, rating, watched)) return false;
    return true;
  }).toList();
}

bool isRatingSortActive(RatingFilterParts rating) {
  return isRatingSortSource(rating.source);
}

bool isAddedSortActive(RatingFilterParts rating) => rating.source == 'added';

bool isReleaseSortActiveParts(RatingFilterParts rating) =>
    rating.source == 'release';

bool isFlatSortActive(RatingFilterParts rating, List<String> selectedGenres) {
  return rating.source != 'all' && selectedGenres.isEmpty;
}

List<WatchlistItem> sortItemsInGroup(
  List<WatchlistItem> items,
  RatingFilterParts rating,
  Map<String, WatchEntry> watched,
) {
  if (isAddedSortActive(rating)) {
    final newest = rating.sort != 'oldest';
    final sorted = [...items]..sort((a, b) {
        final aTime = a.addedAt ?? 0;
        final bTime = b.addedAt ?? 0;
        if (aTime != bTime) {
          return newest ? bTime.compareTo(aTime) : aTime.compareTo(bTime);
        }
        return a.title.toLowerCase().compareTo(b.title.toLowerCase());
      });
    return sorted;
  }

  if (isReleaseSortActiveParts(rating)) {
    final newest = rating.sort != 'oldest';
    final sorted = [...items]..sort((a, b) {
        final aYear = parseReleaseYear(a.year);
        final bYear = parseReleaseYear(b.year);
        if (aYear == null && bYear == null) {
          return a.title.toLowerCase().compareTo(b.title.toLowerCase());
        }
        if (aYear == null) return 1;
        if (bYear == null) return -1;
        if (aYear != bYear) {
          return newest ? bYear.compareTo(aYear) : aYear.compareTo(bYear);
        }
        return a.title.toLowerCase().compareTo(b.title.toLowerCase());
      });
    return sorted;
  }

  if (isRatingSortActive(rating)) {
    final best = rating.sort != 'worst';
    final sorted = [...items]..sort((a, b) {
        final aScore = ratingSortScore(a, rating.source, watched);
        final bScore = ratingSortScore(b, rating.source, watched);
        if (aScore == null && bScore == null) {
          return a.title.toLowerCase().compareTo(b.title.toLowerCase());
        }
        if (aScore == null) return 1;
        if (bScore == null) return -1;
        final diff = best ? bScore.compareTo(aScore) : aScore.compareTo(bScore);
        if (diff != 0) return diff;
        return a.title.toLowerCase().compareTo(b.title.toLowerCase());
      });
    return sorted;
  }

  const typeOrder = ['movies', 'tvSeries', 'anime'];
  final sorted = [...items]..sort((a, b) {
      final aW = watched.containsKey(a.id);
      final bW = watched.containsKey(b.id);
      if (aW != bW) return aW ? 1 : -1;

      final typeDiff =
          typeOrder.indexOf(a.contentType) - typeOrder.indexOf(b.contentType);
      if (typeDiff != 0) return typeDiff;

      return a.title.toLowerCase().compareTo(b.title.toLowerCase());
    });
  return sorted;
}

List<GenreGroup> buildFilteredGroups({
  required List<WatchlistItem> items,
  required Map<String, WatchEntry> watched,
  required WatchlistTypeFilter typeFilter,
  required WatchlistFilterState filters,
}) {
  final filtered = filterWatchlistItems(
    items: items,
    watched: watched,
    typeFilter: typeFilter,
    filters: filters,
  );

  final rating = ratingFilterPartsFromState(filters);
  final mergeByGenreOnly = typeFilter == WatchlistTypeFilter.all;
  final selectedGenres = filters.selectedGenres;

  if (isFlatSortActive(rating, selectedGenres)) {
    return [
      GenreGroup(
        genre: '',
        items: sortItemsInGroup(filtered, rating, watched),
        isFlatSorted: true,
      ),
    ];
  }

  final groups = <GenreGroup>[];
  final showAllMatchSection = selectedGenres.length > 1;

  final allMatchItems = showAllMatchSection
      ? filtered
          .where((item) => itemMatchesAllSelectedGenres(item, selectedGenres))
          .toList()
      : <WatchlistItem>[];
  final reservedIds = allMatchItems.map((i) => i.id).toSet();
  final remainingItems =
      filtered.where((item) => !reservedIds.contains(item.id)).toList();

  if (showAllMatchSection && allMatchItems.isNotEmpty) {
    groups.add(
      GenreGroup(
        genre: selectedGenres.join(' · '),
        items: sortItemsInGroup(allMatchItems, rating, watched),
        isAllMatch: true,
      ),
    );
  }

  final byKey = <String, GenreGroup>{};
  final useFilterGrouping = selectedGenres.isNotEmpty;

  for (final item in remainingItems) {
    final sectionGenre = useFilterGrouping
        ? filterDisplayGenre(item, selectedGenres)
        : item.genre;
    final key =
        mergeByGenreOnly ? sectionGenre : '${item.contentType}|||$sectionGenre';

    byKey.putIfAbsent(
      key,
      () => GenreGroup(
        genre: sectionGenre,
        contentType: mergeByGenreOnly ? null : item.contentType,
        items: [],
      ),
    );

    final group = byKey[key]!;
    byKey[key] = GenreGroup(
      genre: group.genre,
      contentType: group.contentType,
      items: [...group.items, item],
      isAllMatch: group.isAllMatch,
      isFlatSorted: group.isFlatSorted,
    );
  }

  final sortedGroups = byKey.values.map((group) {
    return GenreGroup(
      genre: group.genre,
      contentType: group.contentType,
      items: sortItemsInGroup(group.items, rating, watched),
      isAllMatch: group.isAllMatch,
      isFlatSorted: group.isFlatSorted,
    );
  }).toList();

  sortedGroups.sort((a, b) {
    if (mergeByGenreOnly) {
      return standardGenres.indexOf(a.genre) - standardGenres.indexOf(b.genre);
    }
    const typeOrder = ['movies', 'tvSeries', 'anime'];
    final typeDiff = typeOrder.indexOf(a.contentType ?? '') -
        typeOrder.indexOf(b.contentType ?? '');
    if (typeDiff != 0) return typeDiff;
    return standardGenres.indexOf(a.genre) - standardGenres.indexOf(b.genre);
  });

  if (useFilterGrouping && selectedGenres.length > 1) {
    sortedGroups.sort((a, b) {
      final aIndex = selectedGenres.indexOf(a.genre);
      final bIndex = selectedGenres.indexOf(b.genre);
      if (aIndex >= 0 && bIndex >= 0) return aIndex.compareTo(bIndex);
      if (aIndex >= 0) return -1;
      if (bIndex >= 0) return 1;
      return 0;
    });
  }

  return [...groups, ...sortedGroups];
}

List<String> availableGenresFromItems(List<WatchlistItem> items) {
  final genres = <String>{};
  for (final item in items) {
    genres.add(item.genre);
    genres.addAll(item.secondaryGenres);
  }

  final ordered = standardGenres.where(genres.contains).toList();
  final extras = genres.where((g) => !standardGenres.contains(g)).toList()
    ..sort();
  return [...ordered, ...extras];
}

const sortFilterOptions = [
  'all',
  'added',
  'release',
  'age',
  'imdb',
  'anilist',
  'personal',
];
