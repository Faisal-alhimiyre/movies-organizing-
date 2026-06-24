import '../../models/watchlist_data.dart';
import 'watchlist_parser.dart';

class WatchlistConvertResult {
  const WatchlistConvertResult({
    required this.watchlist,
    required this.watched,
  });

  final WatchlistData watchlist;
  final Map<String, dynamic> watched;
}

int? parseAddedAtMs(dynamic value) {
  if (value == null) return null;
  if (value is int) return value;
  if (value is num && value.isFinite) return value.round();
  final raw = value.toString().trim();
  if (raw.isEmpty) return null;
  final asInt = int.tryParse(raw);
  if (asInt != null) return asInt;
  final parsed = DateTime.tryParse(raw);
  return parsed?.millisecondsSinceEpoch;
}

String resolveAddedAtIso(
  Map<String, dynamic> entry,
  String itemId,
  Map<String, dynamic> existingAddedAt,
) {
  final localMs = parseAddedAtMs(entry['addedAt']);
  if (localMs != null) {
    return DateTime.fromMillisecondsSinceEpoch(localMs, isUtc: true)
        .toIso8601String();
  }

  final remoteMs = parseAddedAtMs(existingAddedAt[itemId]);
  if (remoteMs != null) {
    return DateTime.fromMillisecondsSinceEpoch(remoteMs, isUtc: true)
        .toIso8601String();
  }

  return DateTime.now().toUtc().toIso8601String();
}

/// Mirrors `rowsToWatchlist` in `web-files/js/sync.js`.
WatchlistConvertResult rowsToWatchlist(List<Map<String, dynamic>> rows) {
  final movies = <String, List<dynamic>>{};
  final tvSeries = <String, List<dynamic>>{};
  final anime = <String, List<dynamic>>{};
  final watched = <String, dynamic>{};

  for (final row in rows) {
    final contentType = row['content_type']?.toString() ?? '';
    final genre = row['genre']?.toString() ?? '';
    final title = row['title']?.toString() ?? '';
    if (title.isEmpty) continue;

    final section = switch (contentType) {
      'movies' => movies,
      'tvSeries' => tvSeries,
      'anime' => anime,
      _ => null,
    };
    if (section == null) continue;

    section.putIfAbsent(genre, () => <dynamic>[]);

    final entry = <String, dynamic>{
      'title': title,
      'kind': row['kind']?.toString() ?? '',
      'summary': row['summary']?.toString() ?? '',
    };

    final lead = row['lead']?.toString() ?? '';
    if (lead.isNotEmpty) entry['lead'] = lead;

    final leads = row['leads'];
    if (leads is List && leads.isNotEmpty) {
      entry['leads'] = leads;
    }

    final link = row['link']?.toString() ?? '';
    if (link.isNotEmpty) entry['link'] = link;

    final secondaryGenres = row['secondary_genres'];
    if (secondaryGenres is List && secondaryGenres.isNotEmpty) {
      entry['secondaryGenres'] = secondaryGenres;
    }

    final poster = row['poster']?.toString() ?? '';
    if (poster.isNotEmpty) entry['poster'] = poster;

    final cardPoster = row['card_poster']?.toString() ?? '';
    if (cardPoster.isNotEmpty) entry['cardPoster'] = cardPoster;

    final selectedSeason = row['selected_season'];
    if (selectedSeason != null) {
      final n = selectedSeason is int
          ? selectedSeason
          : int.tryParse(selectedSeason.toString());
      if (n != null) entry['selectedSeason'] = n;
    }

    final selectedSeasonName = row['selected_season_name']?.toString() ?? '';
    if (selectedSeasonName.isNotEmpty) {
      entry['selectedSeasonName'] = selectedSeasonName;
    }

    if (row['no_specials'] == true) entry['noSpecials'] = true;

    final imdbRating = row['imdb_rating']?.toString() ?? '';
    if (imdbRating.isNotEmpty) entry['imdbRating'] = imdbRating;

    final anilistRating = row['anilist_rating']?.toString() ?? '';
    if (anilistRating.isNotEmpty) entry['anilistRating'] = anilistRating;

    final ageRating = row['age_rating']?.toString() ?? '';
    if (ageRating.isNotEmpty) entry['ageRating'] = ageRating;

    final runtime = row['runtime']?.toString() ?? '';
    if (runtime.isNotEmpty) entry['runtime'] = runtime;

    final seasonCount = row['season_count']?.toString() ?? '';
    if (seasonCount.isNotEmpty) entry['seasonCount'] = seasonCount;

    final episodeCount = row['episode_count']?.toString() ?? '';
    if (episodeCount.isNotEmpty) entry['episodeCount'] = episodeCount;

    final year = row['year']?.toString() ?? '';
    if (year.isNotEmpty) entry['year'] = year;

    final addedMs = parseAddedAtMs(row['added_at']);
    if (addedMs != null) entry['addedAt'] = addedMs;

    section[genre]!.add(entry);

    final itemId = row['item_id']?.toString() ?? '';
    if (itemId.isEmpty) continue;

    // Rows with granular progress but !watched are still tracked (in-progress).
    final isWatched = row['watched'] == true;
    final rawProgress = row['watch_progress'];
    final progressMap =
        rawProgress is Map && rawProgress.isNotEmpty ? rawProgress : null;
    final hasProgress = progressMap != null;

    if (isWatched || hasProgress) {
      final watchEntry = <String, dynamic>{};

      if (isWatched) {
        final ratingRaw = row['watch_rating'];
        if (ratingRaw != null && ratingRaw.toString().isNotEmpty) {
          final rating =
              double.tryParse(ratingRaw.toString().replaceAll(',', '.'));
          if (rating != null && rating.isFinite) {
            watchEntry['rating'] = rating;
          }
        }

        final note = row['watch_note']?.toString().trim() ?? '';
        if (note.isNotEmpty) watchEntry['note'] = note;
      }

      // Attach granular progress when present.
      if (progressMap != null) {
        watchEntry['progress'] = Map<String, dynamic>.from(progressMap);
      }

      watched[itemId] = watchEntry;
    }
  }

  return WatchlistConvertResult(
    watchlist: WatchlistData(
      movies: movies,
      tvSeries: tvSeries,
      anime: anime,
    ),
    watched: watched,
  );
}

/// Mirrors `watchlistToRows` in `web-files/js/sync.js`.
List<Map<String, dynamic>> watchlistToRows(
  String listId,
  WatchlistData watchlist,
  Map<String, dynamic> watched, {
  Map<String, dynamic> existingAddedAt = const {},
}) {
  final rows = <Map<String, dynamic>>[];
  final now = DateTime.now().toUtc().toIso8601String();
  final sections = {
    'movies': watchlist.movies,
    'tvSeries': watchlist.tvSeries,
    'anime': watchlist.anime,
  };

  for (final section in sections.entries) {
    final contentType = section.key;
    for (final genreEntry in section.value.entries) {
      final genre = genreEntry.key;
      for (final raw in genreEntry.value) {
        if (raw is! Map) continue;
        final map = Map<String, dynamic>.from(raw);
        final title = map['title']?.toString().trim() ?? '';
        if (title.isEmpty) continue;

        final leads = _parseLeadsForRow(map);
        final itemId = makeItemId(contentType, genre, title);
        final watchMeta = _watchMetaForRow(watched[itemId]);

        final row = <String, dynamic>{
          'list_id': listId,
          'item_id': itemId,
          'content_type': contentType,
          'genre': genre,
          'title': title,
          'kind': normalizeKind(
            map['kind']?.toString() ?? '',
            contentType,
          ),
          'lead': map['lead']?.toString() ?? leads.join(', '),
          'leads': leads,
          'summary': map['summary']?.toString() ?? '',
          'link': map['link']?.toString() ?? '',
          'secondary_genres': map['secondaryGenres'] is List
              ? map['secondaryGenres']
              : <String>[],
          'poster': map['poster']?.toString() ?? '',
          'imdb_rating': map['imdbRating']?.toString() ?? '',
          'anilist_rating': map['anilistRating']?.toString() ?? '',
          'age_rating': map['ageRating']?.toString() ?? '',
          'runtime': map['runtime']?.toString() ?? '',
          'season_count': map['seasonCount']?.toString() ?? '',
          'episode_count': map['episodeCount']?.toString() ?? '',
          'year': map['year']?.toString() ?? '',
          'watched': watchMeta.watched,
          'watch_rating': watchMeta.rating,
          'watch_note': watchMeta.note,
          'watch_progress': watchMeta.progress ??
              <String, dynamic>{'version': 1, 'episodes': <String>[]},
          'added_at': resolveAddedAtIso(map, itemId, existingAddedAt),
          'updated_at': now,
        };

        final cardPoster = map['cardPoster']?.toString() ?? '';
        if (cardPoster.isNotEmpty) row['card_poster'] = cardPoster;

        final selectedSeason = map['selectedSeason'];
        if (selectedSeason != null) row['selected_season'] = selectedSeason;

        final selectedSeasonName = map['selectedSeasonName']?.toString() ?? '';
        if (selectedSeasonName.isNotEmpty) {
          row['selected_season_name'] = selectedSeasonName;
        }

        if (map['noSpecials'] == true) row['no_specials'] = true;

        rows.add(row);
      }
    }
  }

  return rows;
}

List<String> _parseLeadsForRow(Map<String, dynamic> map) {
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

({bool watched, Object? rating, String note, Map<String, dynamic>? progress})
    _watchMetaForRow(dynamic raw) {
  if (raw == null) return (watched: false, rating: null, note: '', progress: null);
  // Legacy format: bare `true` → fully watched (no episode tracking).
  if (raw == true) return (watched: true, rating: null, note: '', progress: null);
  if (raw is! Map) return (watched: false, rating: null, note: '', progress: null);

  final map = Map<String, dynamic>.from(raw);
  final ratingRaw = map['rating'];
  Object? rating;
  if (ratingRaw != null && ratingRaw.toString().isNotEmpty) {
    final parsed = double.tryParse(ratingRaw.toString().replaceAll(',', '.'));
    if (parsed != null && parsed.isFinite) rating = parsed;
  }

  Map<String, dynamic>? progress;
  final rawProg = map['progress'];
  if (rawProg is Map && rawProg.isNotEmpty) {
    progress = Map<String, dynamic>.from(rawProg);
  }

  // `watched` DB column is TRUE only when the title is *fully* watched:
  //  - Legacy-complete: no `progress` key → fully watched.
  //  - Granular: `progress.completed == true` → fully watched.
  //  - In-progress (has episodes but not complete) → watched: false.
  final isLegacyComplete = progress == null;
  final isCompleted = progress != null && progress['completed'] == true;
  final isFullyWatched = isLegacyComplete || isCompleted;

  return (
    watched: isFullyWatched,
    rating: rating,
    note: map['note']?.toString().trim() ?? '',
    progress: progress,
  );
}
