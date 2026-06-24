import '../../models/watchlist_data.dart';
import '../../models/watchlist_item.dart';
import 'title_meta_format.dart';

const standardGenres = [
  'Action',
  'Adventure',
  'Animation',
  'Comedy',
  'Crime',
  'Documentary',
  'Drama',
  'Family',
  'Fantasy',
  'Historical',
  'Horror',
  'Mystery',
  'Romance',
  'Science Fiction',
  'Sports',
  'Thriller',
  'War',
  'Western',
];

String makeItemId(String contentType, String genre, String title) {
  return '$contentType::$genre::$title';
}

String normalizeGenre(String genre) {
  final trimmed = genre.trim();
  if (standardGenres.contains(trimmed)) return trimmed;
  final caseMatch = standardGenres.firstWhere(
    (g) => g.toLowerCase() == trimmed.toLowerCase(),
    orElse: () => trimmed,
  );
  return caseMatch;
}

List<WatchlistItem> flattenWatchlist(WatchlistData data) {
  final items = <WatchlistItem>[];
  final sections = {
    'movies': data.movies,
    'tvSeries': data.tvSeries,
    'anime': data.anime,
  };

  for (final entry in sections.entries) {
    final contentType = entry.key;
    for (final genreEntry in entry.value.entries) {
      final genre = normalizeGenre(genreEntry.key);
      for (final raw in genreEntry.value) {
        if (raw is! Map) continue;
        final map = Map<String, dynamic>.from(raw);
        final title = map['title']?.toString().trim() ?? '';
        if (title.isEmpty) continue;

        final leads = _parseLeads(map);
        items.add(
          WatchlistItem(
            id: makeItemId(contentType, genre, title),
            contentType: contentType,
            genre: genre,
            title: title,
            lead: leads.join(', '),
            summary: _parseSummary(map),
            kind: map['kind']?.toString() ?? '',
            link: map['link']?.toString(),
            poster: map['poster']?.toString(),
            cardPoster: _parseOptionalString(map['cardPoster']),
            selectedSeason: _parseOptionalInt(map['selectedSeason']),
            selectedSeasonName: _parseOptionalString(map['selectedSeasonName']),
            noSpecials: map['noSpecials'] == true,
            imdbRating: map['imdbRating']?.toString(),
            anilistRating: map['anilistRating']?.toString(),
            ageRating: map['ageRating']?.toString(),
            runtime: map['runtime']?.toString(),
            seasonCount: parsePositiveCount(map['seasonCount']),
            episodeCount: parsePositiveCount(map['episodeCount']),
            year: _parseYear(map['year']),
            addedAt: _parseAddedAtMs(map['addedAt']),
            secondaryGenres:
                _parseSecondaryGenres(genre, map['secondaryGenres']),
          ),
        );
      }
    }
  }

  _backfillAddedAt(items);
  return items;
}

List<String> _parseLeads(Map<String, dynamic> map) {
  final leadsRaw = map['leads'];
  if (leadsRaw is List) {
    return leadsRaw
        .map((e) => e.toString().trim())
        .where((e) => e.isNotEmpty)
        .toList();
  }
  final lead = map['lead']?.toString().trim() ?? '';
  if (lead.isEmpty) return [];
  return lead
      .split(',')
      .map((e) => e.trim())
      .where((e) => e.isNotEmpty)
      .toList();
}

String _parseSummary(Map<String, dynamic> map) {
  return map['summary']?.toString().trim() ??
      map['note']?.toString().trim() ??
      '';
}

int? _parseYear(dynamic raw) {
  if (raw is int) return raw;
  if (raw is num) return raw.toInt();
  return int.tryParse(raw?.toString() ?? '');
}

String? _parseOptionalString(dynamic raw) {
  if (raw == null) return null;
  final s = raw.toString().trim();
  return s.isEmpty ? null : s;
}

int? _parseOptionalInt(dynamic raw) {
  if (raw == null) return null;
  if (raw is int) return raw;
  if (raw is num) return raw.toInt();
  return int.tryParse(raw.toString());
}

int? _parseAddedAtMs(dynamic raw) {
  if (raw == null) return null;
  if (raw is int) return raw;
  if (raw is num && raw.isFinite) return raw.round();
  final text = raw.toString().trim();
  if (text.isEmpty) return null;
  final asInt = int.tryParse(text);
  if (asInt != null && asInt > 10000) return asInt;
  final parsed = DateTime.tryParse(text);
  return parsed?.millisecondsSinceEpoch;
}

List<String> _parseSecondaryGenres(String primary, dynamic raw) {
  if (raw is! List) return [];
  return raw
      .map((e) => normalizeGenre(e.toString()))
      .where((g) => g.isNotEmpty && g != primary)
      .toList();
}

void _backfillAddedAt(List<WatchlistItem> items) {
  final now = DateTime.now().millisecondsSinceEpoch;
  for (var i = 0; i < items.length; i++) {
    if (items[i].addedAt != null) continue;
    final item = items[i];
    items[i] = WatchlistItem(
      id: item.id,
      contentType: item.contentType,
      genre: item.genre,
      title: item.title,
      lead: item.lead,
      summary: item.summary,
      kind: item.kind,
      link: item.link,
      poster: item.poster,
      cardPoster: item.cardPoster,
      selectedSeason: item.selectedSeason,
      selectedSeasonName: item.selectedSeasonName,
      noSpecials: item.noSpecials,
      imdbRating: item.imdbRating,
      anilistRating: item.anilistRating,
      ageRating: item.ageRating,
      runtime: item.runtime,
      seasonCount: item.seasonCount,
      episodeCount: item.episodeCount,
      year: item.year,
      addedAt: now - (items.length - i) * 1000,
      secondaryGenres: item.secondaryGenres,
    );
  }
}

List<WatchlistItem> filterByType(
  List<WatchlistItem> items,
  WatchlistTypeFilter type,
) {
  final key = type.contentTypeKey;
  if (key == null) return items;
  return items.where((i) => i.contentType == key).toList();
}

List<GenreGroup> groupItems(
  List<WatchlistItem> items, {
  required WatchlistTypeFilter type,
  required bool Function(String id) isWatched,
}) {
  final mergeByGenreOnly = type == WatchlistTypeFilter.all;
  final byKey = <String, GenreGroup>{};

  for (final item in items) {
    final key =
        mergeByGenreOnly ? item.genre : '${item.contentType}|||${item.genre}';
    byKey.putIfAbsent(
      key,
      () => GenreGroup(
        genre: item.genre,
        contentType: mergeByGenreOnly ? null : item.contentType,
        items: [],
      ),
    );
    final group = byKey[key]!;
    byKey[key] = GenreGroup(
      genre: group.genre,
      contentType: group.contentType,
      items: [...group.items, item],
    );
  }

  const typeOrder = ['movies', 'tvSeries', 'anime'];
  final groups = byKey.values.map((group) {
    final sorted = [...group.items]..sort((a, b) {
        final aW = isWatched(a.id);
        final bW = isWatched(b.id);
        if (aW != bW) return aW ? 1 : -1;
        final typeDiff =
            typeOrder.indexOf(a.contentType) - typeOrder.indexOf(b.contentType);
        if (typeDiff != 0) return typeDiff;
        return a.title.toLowerCase().compareTo(b.title.toLowerCase());
      });
    return GenreGroup(
      genre: group.genre,
      contentType: group.contentType,
      items: sorted,
    );
  }).toList();

  groups.sort((a, b) {
    if (mergeByGenreOnly) {
      return standardGenres.indexOf(a.genre) - standardGenres.indexOf(b.genre);
    }
    final typeDiff = typeOrder.indexOf(a.contentType ?? '') -
        typeOrder.indexOf(b.contentType ?? '');
    if (typeDiff != 0) return typeDiff;
    return standardGenres.indexOf(a.genre) - standardGenres.indexOf(b.genre);
  });

  return groups;
}

Map<String, WatchEntry> parseWatchedMap(dynamic raw) {
  if (raw is! Map) return {};
  final result = <String, WatchEntry>{};
  for (final entry in raw.entries) {
    final watch = WatchEntry.fromJson(entry.value);
    result[entry.key.toString()] = watch;
  }
  return result;
}

bool isItemWatched(String id, Map<String, WatchEntry> watched) {
  return watched.containsKey(id);
}

/// Mirrors `itemsToNested` in `web-files/js/app.js`.
WatchlistData itemsToNested(List<WatchlistItem> items) {
  final movies = <String, List<dynamic>>{};
  final tvSeries = <String, List<dynamic>>{};
  final anime = <String, List<dynamic>>{};

  for (final item in items) {
    final section = switch (item.contentType) {
      'movies' => movies,
      'tvSeries' => tvSeries,
      'anime' => anime,
      _ => null,
    };
    if (section == null) continue;

    section.putIfAbsent(item.genre, () => <dynamic>[]);

    final leads = item.lead
        .split(',')
        .map((e) => e.trim())
        .where((e) => e.isNotEmpty)
        .toList();

    final entry = <String, dynamic>{
      'title': item.title,
      'lead': leads.join(', '),
      'leads': leads,
      'summary': item.summary,
      'kind': normalizeKind(item.kind, item.contentType),
    };

    if (item.link != null && item.link!.isNotEmpty) entry['link'] = item.link;
    if (item.poster != null && item.poster!.isNotEmpty) {
      entry['poster'] = item.poster;
    }
    if (item.cardPoster != null && item.cardPoster!.isNotEmpty) {
      entry['cardPoster'] = item.cardPoster;
    }
    if (item.selectedSeason != null) {
      entry['selectedSeason'] = item.selectedSeason;
    }
    if (item.selectedSeasonName != null && item.selectedSeasonName!.isNotEmpty) {
      entry['selectedSeasonName'] = item.selectedSeasonName;
    }
    if (item.noSpecials == true) entry['noSpecials'] = true;
    if (item.imdbRating != null && item.imdbRating!.isNotEmpty) {
      entry['imdbRating'] = item.imdbRating;
    }
    if (item.anilistRating != null && item.anilistRating!.isNotEmpty) {
      entry['anilistRating'] = item.anilistRating;
    }
    if (item.ageRating != null && item.ageRating!.isNotEmpty) {
      entry['ageRating'] = item.ageRating;
    }
    if (item.runtime != null && item.runtime!.isNotEmpty) {
      entry['runtime'] = item.runtime;
    }
    if (item.seasonCount != null) entry['seasonCount'] = item.seasonCount;
    if (item.episodeCount != null) entry['episodeCount'] = item.episodeCount;
    if (item.year != null) entry['year'] = item.year;
    if (item.addedAt != null) entry['addedAt'] = item.addedAt;
    if (item.secondaryGenres.isNotEmpty) {
      entry['secondaryGenres'] = item.secondaryGenres;
    }

    section[item.genre]!.add(entry);
  }

  return WatchlistData(movies: movies, tvSeries: tvSeries, anime: anime);
}

String normalizeKind(String kind, String contentType) {
  if (kind == 'franchise') return 'film series';
  if (contentType != 'movies') return 'series';
  return kind == 'film series' ? 'film series' : 'movie';
}

WatchlistItem? findDuplicateTitle(
  List<WatchlistItem> items,
  WatchlistItem candidate, {
  String? excludeId,
}) {
  for (final item in items) {
    if (excludeId != null && item.id == excludeId) continue;
    if (item.contentType == candidate.contentType &&
        item.title.toLowerCase() == candidate.title.toLowerCase()) {
      return item;
    }
  }
  return null;
}

Map<String, dynamic> watchedMapToJson(Map<String, WatchEntry> watched) {
  final result = <String, dynamic>{};
  for (final entry in watched.entries) {
    result[entry.key] = entry.value.toJson();
  }
  return result;
}
