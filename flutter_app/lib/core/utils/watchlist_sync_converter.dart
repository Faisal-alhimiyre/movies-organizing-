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

    final altTitle = row['alt_title']?.toString() ?? '';
    if (altTitle.isNotEmpty) entry['altTitle'] = altTitle;

    final secondaryGenres = row['secondary_genres'];
    if (secondaryGenres is List && secondaryGenres.isNotEmpty) {
      entry['secondaryGenres'] = secondaryGenres;
    }

    final poster = row['poster']?.toString() ?? '';
    if (poster.isNotEmpty) entry['poster'] = poster;

    final imdbRating = row['imdb_rating']?.toString() ?? '';
    if (imdbRating.isNotEmpty) entry['imdbRating'] = imdbRating;

    final anilistRating = row['anilist_rating']?.toString() ?? '';
    if (anilistRating.isNotEmpty) entry['anilistRating'] = anilistRating;

    final year = row['year']?.toString() ?? '';
    if (year.isNotEmpty) entry['year'] = year;

    section[genre]!.add(entry);

    if (row['watched'] == true) {
      final itemId = row['item_id']?.toString() ?? '';
      if (itemId.isEmpty) continue;

      final watchEntry = <String, dynamic>{};
      final ratingRaw = row['watch_rating'];
      if (ratingRaw != null && ratingRaw.toString().isNotEmpty) {
        final rating = double.tryParse(ratingRaw.toString().replaceAll(',', '.'));
        if (rating != null && rating.isFinite) {
          watchEntry['rating'] = rating;
        }
      }

      final note = row['watch_note']?.toString().trim() ?? '';
      if (note.isNotEmpty) watchEntry['note'] = note;

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
  Map<String, dynamic> watched,
) {
  final rows = <Map<String, dynamic>>[];
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

        rows.add({
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
          'alt_title': map['altTitle']?.toString() ?? '',
          'secondary_genres': map['secondaryGenres'] is List
              ? map['secondaryGenres']
              : <String>[],
          'poster': map['poster']?.toString() ?? '',
          'imdb_rating': map['imdbRating']?.toString() ?? '',
          'anilist_rating': map['anilistRating']?.toString() ?? '',
          'year': map['year']?.toString() ?? '',
          'watched': watchMeta.watched,
          'watch_rating': watchMeta.rating,
          'watch_note': watchMeta.note,
          'updated_at': DateTime.now().toUtc().toIso8601String(),
        });
      }
    }
  }

  return rows;
}

List<String> _parseLeadsForRow(Map<String, dynamic> map) {
  final leadsRaw = map['leads'];
  if (leadsRaw is List) {
    return leadsRaw.map((e) => e.toString().trim()).where((e) => e.isNotEmpty).toList();
  }
  final lead = map['lead']?.toString().trim() ?? '';
  if (lead.isEmpty) return [];
  return lead.split(',').map((e) => e.trim()).where((e) => e.isNotEmpty).toList();
}

({bool watched, Object? rating, String note}) _watchMetaForRow(dynamic raw) {
  if (raw == null) return (watched: false, rating: null, note: '');
  if (raw == true) return (watched: true, rating: null, note: '');
  if (raw is! Map) return (watched: false, rating: null, note: '');

  final map = Map<String, dynamic>.from(raw);
  final ratingRaw = map['rating'];
  Object? rating;
  if (ratingRaw != null && ratingRaw.toString().isNotEmpty) {
    final parsed = double.tryParse(ratingRaw.toString().replaceAll(',', '.'));
    if (parsed != null && parsed.isFinite) rating = parsed;
  }

  return (
    watched: true,
    rating: rating,
    note: map['note']?.toString().trim() ?? '',
  );
}
