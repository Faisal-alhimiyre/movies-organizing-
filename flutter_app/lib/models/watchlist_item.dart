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

/// Granular episode-level progress (stored alongside rating/note).
///
/// Format: `{ "version": 1, "episodes": ["1:1", "1:2", "2:5"] }`
/// Episode keys are `"seasonNumber:episodeNumber"` strings.
///
/// `null` progress on a [WatchEntry] means **legacy-complete**: the title was
/// marked watched before granular tracking existed. It still counts as fully
/// watched for filters and display.
class WatchProgress {
  const WatchProgress({
    required this.version,
    required this.episodes,
  });

  static const int currentVersion = 1;

  /// Canonical empty progress object (no episodes watched yet).
  static const WatchProgress empty =
      WatchProgress(version: currentVersion, episodes: []);

  final int version;
  final List<String> episodes;

  String episodeKey(int season, int episode) => '$season:$episode';

  bool hasEpisode(int season, int episode) =>
      episodes.contains(episodeKey(season, episode));

  WatchProgress withEpisode(int season, int episode) {
    final key = episodeKey(season, episode);
    if (episodes.contains(key)) return this;
    return WatchProgress(version: currentVersion, episodes: [...episodes, key]);
  }

  WatchProgress withoutEpisode(int season, int episode) {
    final key = episodeKey(season, episode);
    return WatchProgress(
        version: currentVersion,
        episodes: episodes.where((e) => e != key).toList());
  }

  WatchProgress withoutSeason(int season) {
    return WatchProgress(
        version: currentVersion,
        episodes: episodes.where((e) => !e.startsWith('$season:')).toList());
  }

  Map<String, dynamic> toJson() => {
        'version': version,
        'episodes': episodes,
      };

  factory WatchProgress.fromJson(dynamic raw) {
    if (raw == null) return empty;
    if (raw is! Map) return empty;
    final map = Map<String, dynamic>.from(raw);
    final epsList = map['episodes'];
    final eps = (epsList is List)
        ? epsList
            .map((e) => e.toString())
            .where((e) => e.contains(':'))
            .toList()
        : <String>[];
    return WatchProgress(version: currentVersion, episodes: eps);
  }

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is WatchProgress &&
          version == other.version &&
          episodes.length == other.episodes.length &&
          episodes.every((e) => other.episodes.contains(e));

  @override
  int get hashCode => Object.hash(version, Object.hashAll(episodes));
}

/// Watched / rating entry (`watchlist-watched-v1-{listId}`).
///
/// [progress] is `null` for **legacy-complete** entries (pre-granular-tracking).
/// A null progress + present key in the watched map = title is fully watched
/// (legacy). Granular state is only present once the user explicitly interacts
/// with individual episodes.
class WatchEntry {
  const WatchEntry({this.rating, this.note, this.progress});

  final double? rating;
  final String? note;

  /// `null` = legacy-complete. Non-null = explicit episode-level tracking.
  final WatchProgress? progress;

  bool get isWatched => true;

  /// True when no granular progress exists — the entry came from the old
  /// watched model and all episodes are implicitly watched.
  bool get isLegacyComplete => progress == null;

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
    if (rating != null) json['rating'] = rating;
    if (note != null && note!.isNotEmpty) json['note'] = note;
    if (progress != null) json['progress'] = progress!.toJson();
    return json;
  }

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
    WatchProgress? progress;
    if (map.containsKey('progress') && map['progress'] != null) {
      progress = WatchProgress.fromJson(map['progress']);
    }

    return WatchEntry(
      rating: rating,
      note: (note != null && note.isNotEmpty) ? note : null,
      progress: progress,
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
