/// Source-independent normalized models for series, season, and episode metadata.
///
/// No TMDb-, AniList-, or OMDb-specific response objects should leak into the UI.
/// All callers receive one of these normalized types regardless of the data source.

// ─────────────────────────────────────────────────────────────
// Result states
// ─────────────────────────────────────────────────────────────

/// Possible states of a series/season/episode metadata fetch.
enum MetadataResultState {
  /// Active fetch in progress.
  loading,

  /// Data is available and fresh.
  available,

  /// Some data is available but fields are incomplete (e.g. AniList episode
  /// stubs, OMDb without stills or descriptions).
  partiallyAvailable,

  /// No data could be fetched and no cache exists.
  unavailable,

  /// Device is offline; stale cached data is returned.
  offlineWithCache,

  /// Device is offline and no cached data exists.
  offlineNoCache,

  /// The watchlist item has no resolvable external ID that supports seasons.
  invalidId,

  /// The upstream API returned an unexpected error response.
  apiFailure,

  /// The upstream API returned a rate-limit response.
  rateLimited,

  /// The series was resolved but has no season data.
  noSeasons,

  /// Episode count is known but per-episode details are unavailable
  /// (e.g. AniList with only a total-episode count).
  episodeDetailsUnavailable,
}

// ─────────────────────────────────────────────────────────────
// ID resolution
// ─────────────────────────────────────────────────────────────

/// The best external series identity resolved from a [WatchlistItem].
///
/// Exactly one of [tmdbId], [anilistId], or [imdbId] is non-null when
/// [isNegative] is false.
class SeriesIdResolution {
  const SeriesIdResolution._({
    required this.source,
    this.tmdbId,
    this.imdbId,
    this.anilistId,
    this.isNegative = false,
  });

  /// Resolved via TMDb (either directly or from an IMDb→TMDb `/find` call).
  factory SeriesIdResolution.tmdb(int tmdbId, {String? imdbId}) =>
      SeriesIdResolution._(
        source: 'tmdb',
        tmdbId: tmdbId,
        imdbId: imdbId,
      );

  /// Resolved via AniList (anime).
  factory SeriesIdResolution.anilist(int anilistId, {String? imdbId}) =>
      SeriesIdResolution._(
        source: 'anilist',
        anilistId: anilistId,
        imdbId: imdbId,
      );

  /// Only an IMDb ID is available; TMDb resolution failed. OMDb fallback.
  factory SeriesIdResolution.omdb(String imdbId) =>
      SeriesIdResolution._(source: 'omdb', imdbId: imdbId);

  /// No usable external ID could be resolved.
  factory SeriesIdResolution.none() =>
      const SeriesIdResolution._(source: 'none', isNegative: true);

  /// Data source: `'tmdb'`, `'anilist'`, `'omdb'`, or `'none'`.
  final String source;
  final int? tmdbId;
  final String? imdbId;
  final int? anilistId;

  /// True when resolution failed; all ID fields will be null.
  final bool isNegative;

  bool get hasUsableSource => !isNegative;

  /// Compact string used to build v5 cache keys.
  String get cacheSegment {
    if (tmdbId != null) return 'tmdb:$tmdbId';
    if (anilistId != null) return 'anilist:$anilistId';
    if (imdbId != null) return 'omdb:$imdbId';
    return 'none';
  }

  @override
  String toString() => 'SeriesIdResolution($source cacheSegment=$cacheSegment)';
}

// ─────────────────────────────────────────────────────────────
// Series summary
// ─────────────────────────────────────────────────────────────

/// Normalized series-level data (header + season list from `/tv/{id}`).
class SeriesSummary {
  const SeriesSummary({
    required this.source,
    this.tmdbId,
    this.imdbId,
    this.anilistId,
    required this.title,
    this.originalTitle,
    this.totalSeasons,
    this.totalEpisodes,
    this.poster = '',
    this.overview = '',
    this.status,
    this.firstAirDate,
    this.lastAirDate,
  });

  /// Data source: `'tmdb'`, `'anilist'`, or `'omdb'`.
  final String source;
  final int? tmdbId;
  final String? imdbId;
  final int? anilistId;
  final String title;
  final String? originalTitle;
  final int? totalSeasons;
  final int? totalEpisodes;

  /// Absolute URL of the series poster, or empty string.
  final String poster;

  final String overview;

  /// Raw status string from the API, e.g. `'Ended'`, `'Returning Series'`.
  final String? status;

  /// ISO-8601 first air date, or null.
  final String? firstAirDate;

  /// ISO-8601 last air date, or null.
  final String? lastAirDate;

  Map<String, dynamic> toJson() => {
        'source': source,
        if (tmdbId != null) 'tmdbId': tmdbId,
        if (imdbId != null) 'imdbId': imdbId,
        if (anilistId != null) 'anilistId': anilistId,
        'title': title,
        if (originalTitle != null) 'originalTitle': originalTitle,
        if (totalSeasons != null) 'totalSeasons': totalSeasons,
        if (totalEpisodes != null) 'totalEpisodes': totalEpisodes,
        'poster': poster,
        'overview': overview,
        if (status != null) 'status': status,
        if (firstAirDate != null) 'firstAirDate': firstAirDate,
        if (lastAirDate != null) 'lastAirDate': lastAirDate,
      };

  factory SeriesSummary.fromJson(Map<String, dynamic> json) => SeriesSummary(
        source: json['source']?.toString() ?? 'unknown',
        tmdbId: json['tmdbId'] as int?,
        imdbId: json['imdbId']?.toString(),
        anilistId: json['anilistId'] as int?,
        title: json['title']?.toString() ?? '',
        originalTitle: json['originalTitle']?.toString(),
        totalSeasons: json['totalSeasons'] as int?,
        totalEpisodes: json['totalEpisodes'] as int?,
        poster: json['poster']?.toString() ?? '',
        overview: json['overview']?.toString() ?? '',
        status: json['status']?.toString(),
        firstAirDate: json['firstAirDate']?.toString(),
        lastAirDate: json['lastAirDate']?.toString(),
      );
}

// ─────────────────────────────────────────────────────────────
// Season summary
// ─────────────────────────────────────────────────────────────

/// Normalized season row shown in the season carousel.
class SeasonSummary {
  const SeasonSummary({
    required this.source,
    this.seriesTmdbId,
    required this.seasonNumber,
    required this.name,
    this.poster = '',
    this.episodeCount,
    this.overview = '',
    this.airDate,
    this.isSpecials = false,
    this.isSynthetic = false,
  });

  final String source;
  final int? seriesTmdbId;
  final int seasonNumber;

  /// Display name, e.g. `'Season 1'`, `'Specials'`.
  final String name;

  /// Absolute URL of the season poster, or empty string.
  final String poster;

  final int? episodeCount;
  final String overview;

  /// ISO-8601 season air date, or null.
  final String? airDate;

  /// True when [seasonNumber] is 0 (Specials / bonus content).
  final bool isSpecials;

  /// True when this entry was constructed synthetically (e.g. AniList single
  /// season, OMDb stub), not from structured API season data.
  final bool isSynthetic;

  bool get isRegular => !isSpecials;

  Map<String, dynamic> toJson() => {
        'source': source,
        if (seriesTmdbId != null) 'seriesTmdbId': seriesTmdbId,
        'seasonNumber': seasonNumber,
        'name': name,
        'poster': poster,
        if (episodeCount != null) 'episodeCount': episodeCount,
        'overview': overview,
        if (airDate != null) 'airDate': airDate,
        'isSpecials': isSpecials,
        'isSynthetic': isSynthetic,
      };

  factory SeasonSummary.fromJson(Map<String, dynamic> json) => SeasonSummary(
        source: json['source']?.toString() ?? 'unknown',
        seriesTmdbId: json['seriesTmdbId'] as int?,
        seasonNumber: json['seasonNumber'] as int? ?? 0,
        name: json['name']?.toString() ?? '',
        poster: json['poster']?.toString() ?? '',
        episodeCount: json['episodeCount'] as int?,
        overview: json['overview']?.toString() ?? '',
        airDate: json['airDate']?.toString(),
        isSpecials: json['isSpecials'] == true,
        isSynthetic: json['isSynthetic'] == true,
      );
}

// ─────────────────────────────────────────────────────────────
// Episode detail
// ─────────────────────────────────────────────────────────────

/// Normalized per-episode detail shown in the episode list.
class EpisodeDetail {
  const EpisodeDetail({
    required this.source,
    this.seriesTmdbId,
    this.seriesTvdbId,
    required this.seasonNumber,
    required this.episodeNumber,
    required this.title,
    this.still = '',
    this.overview = '',
    this.runtimeMinutes,
    this.airDate,
    this.isAired = true,
    this.episodeRating,
    this.episodeRatingSource,
    this.isMovie,
    this.linkedMovieId,
    this.fillerKind,
  });

  final String source;
  final int? seriesTmdbId;
  final int? seriesTvdbId;
  final int seasonNumber;
  final int episodeNumber;
  final String title;

  /// Still image URL for the episode. May be empty; callers should apply the
  /// image fallback chain: still → season poster → series poster → placeholder.
  final String still;

  final String overview;

  /// Per-episode runtime in minutes, or null when unavailable (e.g. OMDb).
  final int? runtimeMinutes;

  /// ISO-8601 air date, or null.
  final String? airDate;

  /// False only for future episodes with a known future air date.
  final bool isAired;

  /// External rating (IMDb/OMDb or TMDB vote_average), 0–10.
  final double? episodeRating;

  /// `"imdb"` or `"tmdb"` when [episodeRating] is set.
  final String? episodeRatingSource;

  /// TVDB marks season-0 feature films.
  final bool? isMovie;

  /// TVDB linked standalone movie id, when present.
  final int? linkedMovieId;

  /// AniFiller label (`filler`) when the episode is community-tagged as filler.
  final String? fillerKind;

  /// Stable progress key used by [WatchProgress] (format: `season:episode`).
  String get progressKey => '$seasonNumber:$episodeNumber';

  Map<String, dynamic> toJson() => {
        'source': source,
        if (seriesTmdbId != null) 'seriesTmdbId': seriesTmdbId,
        'seasonNumber': seasonNumber,
        'episodeNumber': episodeNumber,
        'title': title,
        'still': still,
        'overview': overview,
        if (runtimeMinutes != null) 'runtimeMinutes': runtimeMinutes,
        if (airDate != null) 'airDate': airDate,
        'isAired': isAired,
        if (episodeRating != null) 'episodeRating': episodeRating,
        if (episodeRatingSource != null)
          'episodeRatingSource': episodeRatingSource,
        if (isMovie != null) 'isMovie': isMovie,
        if (linkedMovieId != null) 'linkedMovieId': linkedMovieId,
        if (seriesTvdbId != null) 'seriesTvdbId': seriesTvdbId,
        if (fillerKind != null) 'fillerKind': fillerKind,
      };

  EpisodeDetail copyWith({
    String? fillerKind,
  }) =>
      EpisodeDetail(
        source: source,
        seriesTmdbId: seriesTmdbId,
        seriesTvdbId: seriesTvdbId,
        seasonNumber: seasonNumber,
        episodeNumber: episodeNumber,
        title: title,
        still: still,
        overview: overview,
        runtimeMinutes: runtimeMinutes,
        airDate: airDate,
        isAired: isAired,
        episodeRating: episodeRating,
        episodeRatingSource: episodeRatingSource,
        isMovie: isMovie,
        linkedMovieId: linkedMovieId,
        fillerKind: fillerKind ?? this.fillerKind,
      );

  factory EpisodeDetail.fromJson(Map<String, dynamic> json) => EpisodeDetail(
        source: json['source']?.toString() ?? 'unknown',
        seriesTmdbId: json['seriesTmdbId'] as int?,
        seasonNumber: json['seasonNumber'] as int? ?? 0,
        episodeNumber: json['episodeNumber'] as int? ?? 0,
        title: json['title']?.toString() ?? '',
        still: json['still']?.toString() ?? '',
        overview: json['overview']?.toString() ?? '',
        runtimeMinutes: json['runtimeMinutes'] as int?,
        airDate: json['airDate']?.toString(),
        isAired: json['isAired'] != false,
        episodeRating: _parseEpisodeRating(json['episodeRating']),
        episodeRatingSource: json['episodeRatingSource']?.toString(),
        isMovie: json['isMovie'] == true || json['isMovie'] == 1,
        linkedMovieId: json['linkedMovieId'] is int
            ? json['linkedMovieId'] as int
            : int.tryParse(json['linkedMovieId']?.toString() ?? ''),
        seriesTvdbId: json['seriesTvdbId'] is int
            ? json['seriesTvdbId'] as int
            : int.tryParse(json['seriesTvdbId']?.toString() ?? ''),
        fillerKind: json['fillerKind']?.toString(),
      );
}

double? _parseEpisodeRating(dynamic raw) {
  if (raw == null) return null;
  final n = double.tryParse(raw.toString().replaceAll(',', '.'));
  if (n == null || !n.isFinite || n <= 0 || n > 10) return null;
  return (n * 10).round() / 10;
}

// ─────────────────────────────────────────────────────────────
// Fetch results
// ─────────────────────────────────────────────────────────────

/// Result of fetching the series summary and its season list.
class SeriesMetadataResult {
  const SeriesMetadataResult({
    required this.state,
    this.series,
    this.seasons,
    this.isStale = false,
    this.debugMessage,
  });

  final MetadataResultState state;
  final SeriesSummary? series;
  final List<SeasonSummary>? seasons;

  /// True when the data came from a stale cache entry (background refresh
  /// may be desirable).
  final bool isStale;

  /// Non-null only in development/debug; never show raw API errors to users.
  final String? debugMessage;

  bool get isUsable => series != null || (seasons?.isNotEmpty == true);
}

/// Result of fetching episodes for a single season.
class SeasonEpisodesResult {
  const SeasonEpisodesResult({
    required this.state,
    this.episodes,
    this.seasonPoster,
    this.seasonOverview,
    this.isStale = false,
    this.debugMessage,
  });

  final MetadataResultState state;
  final List<EpisodeDetail>? episodes;

  /// Season poster from the season-details API (TMDB `poster_path`).
  final String? seasonPoster;

  /// Season overview from the season-details API (TMDB `overview`).
  final String? seasonOverview;

  /// True when the data came from a stale cache entry.
  final bool isStale;

  /// Non-null only in development/debug.
  final String? debugMessage;

  bool get isUsable => episodes?.isNotEmpty == true;
}

// ─────────────────────────────────────────────────────────────
// Related movies (TV series / anime spin-off films)
// ─────────────────────────────────────────────────────────────

/// A standalone film related to a series (AniList MOVIE or TVDB S0 film).
class RelatedMovie {
  const RelatedMovie({
    required this.source,
    required this.title,
    this.poster = '',
    this.year = '',
    this.overview = '',
    this.runtimeMinutes,
    this.anilistId,
    this.score,
  });

  final String source;
  final String title;
  final String poster;
  final String year;
  final String overview;
  final int? runtimeMinutes;
  final int? anilistId;
  final double? score;

  Map<String, dynamic> toJson() => {
        'source': source,
        'title': title,
        'poster': poster,
        'year': year,
        'overview': overview,
        if (runtimeMinutes != null) 'runtimeMinutes': runtimeMinutes,
        if (anilistId != null) 'anilistId': anilistId,
        if (score != null) 'score': score,
      };

  factory RelatedMovie.fromJson(Map<String, dynamic> json) => RelatedMovie(
        source: json['source']?.toString() ?? 'unknown',
        title: json['title']?.toString() ?? '',
        poster: json['poster']?.toString() ?? '',
        year: json['year']?.toString() ?? '',
        overview: json['overview']?.toString() ?? '',
        runtimeMinutes: json['runtimeMinutes'] as int?,
        anilistId: json['anilistId'] as int?,
        score: (json['score'] as num?)?.toDouble(),
      );
}

/// Result of [SeriesMetadataService.fetchRelatedMovies].
class RelatedMoviesResult {
  const RelatedMoviesResult({
    required this.state,
    this.movies = const [],
    this.isStale = false,
  });

  final MetadataResultState state;
  final List<RelatedMovie> movies;
  final bool isStale;
}
