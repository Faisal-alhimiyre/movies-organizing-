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
    this.imdbLink,
    this.poster,
    this.cardPoster,
    this.selectedSeason,
    this.selectedSeasonName,
    this.noSpecials,
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

  /// Secondary IMDb URL for anime when [link] is AniList (both badges open links).
  final String? imdbLink;
  final String? poster;

  /// Season-specific poster URL — shown on the card when a season is selected.
  final String? cardPoster;

  /// Last selected season number (for restoring UI state across devices).
  final int? selectedSeason;

  /// Display name of the last selected season (e.g. "Season 2").
  final String? selectedSeasonName;

  /// When `true`, Season 0 (Specials) is hidden and excluded from completion.
  final bool? noSpecials;

  final String? imdbRating;
  final String? anilistRating;
  final String? ageRating;
  final String? runtime;
  final int? seasonCount;
  final int? episodeCount;
  final int? year;
  final int? addedAt;
  final List<String> secondaryGenres;

  /// Effective poster for cards and detail header.
  /// Mirrors web `cardDisplayPoster(item)` → `cardPoster || poster`.
  String? get displayPoster => cardPoster ?? poster;

  Map<String, dynamic> toJson() => {
        'title': title,
        if (lead.isNotEmpty) 'lead': lead,
        if (summary.isNotEmpty) 'summary': summary,
        if (kind.isNotEmpty) 'kind': kind,
        if (link != null) 'link': link,
        if (imdbLink != null && imdbLink!.isNotEmpty) 'imdbLink': imdbLink,
        if (poster != null) 'poster': poster,
        if (cardPoster != null && cardPoster!.isNotEmpty)
          'cardPoster': cardPoster,
        if (selectedSeason != null) 'selectedSeason': selectedSeason,
        if (selectedSeasonName != null && selectedSeasonName!.isNotEmpty)
          'selectedSeasonName': selectedSeasonName,
        if (noSpecials == true) 'noSpecials': true,
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
/// Format: `{ "version": 1, "episodes": ["1:1", "1:2", "2:5"], "completed": true }`
/// Episode keys are `"seasonNumber:episodeNumber"` strings.
///
/// `null` progress on a [WatchEntry] means **legacy-complete**: the title was
/// marked watched before granular tracking existed. It still counts as fully
/// watched for filters and display.
class WatchProgress {
  const WatchProgress({
    required this.version,
    required this.episodes,
    this.completed,
    this.seasonTotals,
    this.episodeRatings,
  });

  static const int currentVersion = 1;

  /// Canonical empty progress object (no episodes watched yet).
  static const WatchProgress empty =
      WatchProgress(version: currentVersion, episodes: []);

  final int version;
  final List<String> episodes;

  /// `true` when all aired regular-season episodes are watched.
  /// `null` means unknown (pre-feature data). Used to drive the DB `watched`
  /// column without needing to load all season data.
  final bool? completed;

  /// Total aired episodes per season: `{"1": 13, "2": 10}`.
  /// Stored so completion can be displayed without fetching episode lists.
  final Map<String, int>? seasonTotals;

  /// Per-episode external ratings from TMDB/OMDb: `{"1:1": 8.5}`.
  final Map<String, double>? episodeRatings;

  String episodeKey(int season, int episode) => '$season:$episode';

  bool hasEpisode(int season, int episode) =>
      episodes.contains(episodeKey(season, episode));

  WatchProgress withEpisode(int season, int episode) {
    final key = episodeKey(season, episode);
    if (episodes.contains(key)) return this;
    return WatchProgress(
      version: currentVersion,
      episodes: [...episodes, key],
      completed: completed,
      seasonTotals: seasonTotals,
      episodeRatings: episodeRatings,
    );
  }

  WatchProgress withoutEpisode(int season, int episode) {
    final key = episodeKey(season, episode);
    return WatchProgress(
      version: currentVersion,
      episodes: episodes.where((e) => e != key).toList(),
      completed: false,
      seasonTotals: seasonTotals,
      episodeRatings: episodeRatings,
    );
  }

  WatchProgress withoutSeason(int season) {
    return WatchProgress(
      version: currentVersion,
      episodes: episodes.where((e) => !e.startsWith('$season:')).toList(),
      completed: false,
      seasonTotals: seasonTotals,
      episodeRatings: episodeRatings,
    );
  }

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{
      'version': version,
      'episodes': episodes,
    };
    if (completed != null) json['completed'] = completed;
    if (seasonTotals != null && seasonTotals!.isNotEmpty) {
      json['seasonTotals'] = seasonTotals;
    }
    if (episodeRatings != null && episodeRatings!.isNotEmpty) {
      json['episodeRatings'] = episodeRatings;
    }
    return json;
  }

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

    bool? completed;
    final completedRaw = map['completed'];
    if (completedRaw is bool) completed = completedRaw;

    Map<String, int>? seasonTotals;
    final totalsRaw = map['seasonTotals'];
    if (totalsRaw is Map) {
      seasonTotals = {};
      for (final e in totalsRaw.entries) {
        final v = e.value;
        final n = v is int ? v : int.tryParse(v.toString());
        if (n != null) seasonTotals[e.key.toString()] = n;
      }
    }

    Map<String, double>? episodeRatings;
    final ratingsRaw = map['episodeRatings'];
    if (ratingsRaw is Map) {
      episodeRatings = {};
      for (final e in ratingsRaw.entries) {
        final v = e.value;
        final n = v is double ? v : double.tryParse(v.toString());
        if (n != null && n.isFinite) episodeRatings[e.key.toString()] = n;
      }
    }

    return WatchProgress(
      version: currentVersion,
      episodes: eps,
      completed: completed,
      seasonTotals: seasonTotals,
      episodeRatings: episodeRatings,
    );
  }

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is WatchProgress &&
          version == other.version &&
          completed == other.completed &&
          episodes.length == other.episodes.length &&
          episodes.every((e) => other.episodes.contains(e));

  @override
  int get hashCode => Object.hash(version, completed, Object.hashAll(episodes));
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

  /// True when the title is fully watched (all episodes done or legacy entry).
  bool get isFullyWatched =>
      isLegacyComplete || progress?.completed == true;

  /// True when ≥1 regular-season episode is watched but the title is not complete.
  /// Mirrors web `itemProgressState` → `"inProgress"` in `app.js`.
  bool get isInProgress {
    if (isFullyWatched) return false;
    final prog = progress;
    if (prog == null) return false;
    if (prog.completed == true) return false;
    return prog.episodes.any((k) => !k.startsWith('0:'));
  }

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
