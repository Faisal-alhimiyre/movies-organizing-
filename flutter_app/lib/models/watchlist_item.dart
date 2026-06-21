/// Flattened title from nested watchlist JSON (`web-files/js/app.js` → `flattenWatchlist`).
class WatchlistItem {
  const WatchlistItem({
    required this.id,
    required this.contentType,
    required this.genre,
    required this.title,
    this.lead = '',
    this.summary = '',
    this.kind = '',
    this.link,
    this.poster,
    this.imdbRating,
    this.anilistRating,
    this.ageRating,
    this.runtime,
    this.seasonCount,
    this.episodeCount,
    this.year,
    this.addedAt,
    this.secondaryGenres = const [],
  });

  final String id;
  final String contentType;
  final String genre;
  final String title;
  final String lead;
  final String summary;
  final String kind;
  final String? link;
  final String? poster;
  final String? imdbRating;
  final String? anilistRating;
  final String? ageRating;
  final String? runtime;
  final int? seasonCount;
  final int? episodeCount;
  final int? year;
  final int? addedAt;
  final List<String> secondaryGenres;

  Map<String, dynamic> toJson() => {
        'title': title,
        if (lead.isNotEmpty) 'lead': lead,
        if (summary.isNotEmpty) 'summary': summary,
        if (kind.isNotEmpty) 'kind': kind,
        if (link != null) 'link': link,
        if (poster != null) 'poster': poster,
        if (imdbRating != null) 'imdbRating': imdbRating,
        if (anilistRating != null) 'anilistRating': anilistRating,
        if (ageRating != null && ageRating!.isNotEmpty) 'ageRating': ageRating,
        if (runtime != null && runtime!.isNotEmpty) 'runtime': runtime,
        if (seasonCount != null) 'seasonCount': seasonCount,
        if (episodeCount != null) 'episodeCount': episodeCount,
        if (year != null) 'year': year,
        if (addedAt != null) 'addedAt': addedAt,
        if (secondaryGenres.isNotEmpty) 'secondaryGenres': secondaryGenres,
      };
}

/// Watched / rating entry (`watchlist-watched-v1-{listId}`).
class WatchEntry {
  const WatchEntry({this.rating, this.note});

  final double? rating;
  final String? note;

  bool get isWatched => true;

  factory WatchEntry.fromJson(dynamic raw) {
    if (raw == null) return const WatchEntry();
    if (raw == true) return const WatchEntry();
    if (raw is! Map) return const WatchEntry();

    final map = Map<String, dynamic>.from(raw);
    double? rating;
    final ratingRaw = map['rating'];
    if (ratingRaw != null) {
      final num = double.tryParse(ratingRaw.toString().replaceAll(',', '.'));
      if (num != null && num >= 0 && num <= 10) {
        rating = (num * 100).round() / 100;
      }
    }

    final note = map['note']?.toString().trim();
    return WatchEntry(
      rating: rating,
      note: (note != null && note.isNotEmpty) ? note : null,
    );
  }
}

/// Grouped section for the watchlist grid.
class GenreGroup {
  const GenreGroup({
    required this.genre,
    required this.items,
    this.contentType,
    this.isAllMatch = false,
    this.isFlatSorted = false,
  });

  final String genre;
  final String? contentType;
  final List<WatchlistItem> items;
  final bool isAllMatch;
  final bool isFlatSorted;
}

enum WatchlistTypeFilter { all, movies, tvSeries, anime }

extension WatchlistTypeFilterX on WatchlistTypeFilter {
  String? get contentTypeKey => switch (this) {
        WatchlistTypeFilter.all => null,
        WatchlistTypeFilter.movies => 'movies',
        WatchlistTypeFilter.tvSeries => 'tvSeries',
        WatchlistTypeFilter.anime => 'anime',
      };
}

enum SyncDisplayStatus { local, saved, pending, error, offline }
