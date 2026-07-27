import 'dart:convert';
import 'dart:io';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:hive_flutter/hive_flutter.dart';
import 'package:http/http.dart' as http;

import '../../core/config/app_config.dart';
import '../../core/config/environment.dart';
import '../../core/storage/hive_boxes.dart';
import '../../core/utils/item_links.dart'
    show getAnilistIdFromItem, getImdbIdFromItem;
import '../../core/utils/title_meta_format.dart' show parsePositiveCount;
import '../../models/series_metadata.dart';
import '../../models/watchlist_item.dart';
import 'metadata_service.dart' show MetadataService;
import 'anifiller_service.dart';
import 'series_movie_filter.dart';

// ─────────────────────────────────────────────────────────────
// Provider
// ─────────────────────────────────────────────────────────────

final seriesMetadataServiceProvider = Provider<SeriesMetadataService>((ref) {
  return SeriesMetadataService(
    config: ref.watch(appConfigProvider),
    cache: HiveBoxes.metadataCache,
  );
});

// ─────────────────────────────────────────────────────────────
// Service
// ─────────────────────────────────────────────────────────────

/// Fetches and caches series, season, and episode metadata.
///
/// Uses the same Hive cache box as [MetadataService] but with a `metadata:v5:`
/// prefix to avoid collisions with existing v4 title-level entries.
///
/// Source priority (matches web `series-metadata.js`):
///   TV series / anime: TheTVDB (edge) → TMDb → AniList → OMDb fallback
///   Movies:            not supported (returns [MetadataResultState.invalidId])
class SeriesMetadataService {
  SeriesMetadataService({
    required AppConfig config,
    required Box<dynamic> cache,
    http.Client? client,
  })  : _config = config,
        _cache = cache,
        _client = client ?? http.Client();

  final AppConfig _config;
  final Box<dynamic> _cache;
  final http.Client _client;

  // Existing title metadata lives under this prefix (read-only from here).
  static const _v4Prefix = 'metadata:v4:';

  // All new entries written by this service use this prefix.
  static const _v5Prefix = 'metadata:v5:';

  static const _tmdbImage = 'https://image.tmdb.org/t/p/w500';
  static const _tvdbArt = 'https://artworks.thetvdb.com';
  static const _anilistApi = 'https://graphql.anilist.co';

  // ── Cache TTLs ─────────────────────────────────────────────
  static const _seriesTtl = Duration(days: 7);
  static const _episodesTtl = Duration(hours: 24);
  static const _resolveTtl = Duration(days: 30);
  static const _negativeResolveTtl = Duration(hours: 2);

  // After 80 % of TTL has elapsed the result is considered stale.
  static double get _staleRatio => 0.8;

  // ─────────────────────────────────────────────────────────────
  // Public API
  // ─────────────────────────────────────────────────────────────

  /// True when [item] is a content type that can have seasons.
  bool mightHaveSeasons(WatchlistItem item) {
    final ct = item.contentType;
    return ct == 'tvSeries' || ct == 'anime';
  }

  /// Resolves the best external series identity from a [WatchlistItem]'s link.
  ///
  /// Resolution order:
  ///   1. IMDb link → `/find` TMDb resolution (cached)
  ///   2. IMDb link → OMDb fallback when TMDb resolution fails
  ///   3. AniList link → AniList ID directly
  ///   4. MAL link → AniList ID via AniList cross-reference
  ///   5. No usable ID → [SeriesIdResolution.none]
  ///
  /// Negative results are briefly cached to avoid spamming APIs on repeated
  /// taps before a network call has a chance to succeed.
  Future<SeriesIdResolution> resolveSeriesId(WatchlistItem item) async {
    if (!mightHaveSeasons(item)) return SeriesIdResolution.none();

    if (item.contentType == 'anime') {
      return _resolveAnimeSeriesId(item);
    }

    final link = item.link;
    if (link == null || link.isEmpty) return SeriesIdResolution.none();

    // ── IMDb → TMDb ──────────────────────────────────────────
    final imdbId = MetadataService.extractImdbId(link);
    if (imdbId != null) {
      final negKey = '${_v5Prefix}resolve:negative:imdb:$imdbId';
      if (_isNegativeCacheValid(negKey)) return SeriesIdResolution.none();

      // Positive resolution cache (30-day)
      final resolveKey = '${_v5Prefix}resolve:imdb:$imdbId';
      final cachedResolved = _readRawCache(resolveKey, _resolveTtl);
      if (cachedResolved != null) {
        final tmdbId = cachedResolved['tmdbId'] as int?;
        if (tmdbId != null) {
          return SeriesIdResolution.tmdb(tmdbId, imdbId: imdbId);
        }
      }

      // Opportunistically read tmdbId from the existing v4 title cache.
      final v4Entry = _readV4OmdbCache(imdbId);
      if (v4Entry != null) {
        final tmdbId = v4Entry['tmdbId'];
        if (tmdbId is int) {
          _writeRawCache(
            resolveKey,
            {'tmdbId': tmdbId, 'imdbId': imdbId},
            _resolveTtl,
          );
          return SeriesIdResolution.tmdb(tmdbId, imdbId: imdbId);
        }
      }

      // Network resolution via TMDb /find.
      final tmdbId = await _resolveTmdbIdByImdb(imdbId);
      if (tmdbId != null) {
        _writeRawCache(
          resolveKey,
          {'tmdbId': tmdbId, 'imdbId': imdbId},
          _resolveTtl,
        );
        return SeriesIdResolution.tmdb(tmdbId, imdbId: imdbId);
      }

      // TMDb resolution failed; fall back to OMDb if available.
      if (_config.hasOmdbKey) {
        _writeNegativeCache(negKey, _negativeResolveTtl);
        return SeriesIdResolution.omdb(imdbId);
      }
      _writeNegativeCache(negKey, _negativeResolveTtl);
      return SeriesIdResolution.none();
    }

    // ── TMDb link (direct from search when no IMDb ID) ───────
    final tmdbLink = MetadataService.parseTmdbLink(link);
    if (tmdbLink != null && tmdbLink.mediaType == 'tv') {
      return SeriesIdResolution.tmdb(tmdbLink.id);
    }

    // ── AniList ──────────────────────────────────────────────
    final anilistId = MetadataService.parseAnilistId(link);
    if (anilistId != null) {
      final linkedImdb = await _resolveLinkedImdbByAnilist(anilistId);
      return SeriesIdResolution.anilist(anilistId, imdbId: linkedImdb);
    }

    // ── MAL → AniList ─────────────────────────────────────────
    final malId = MetadataService.parseMalId(link);
    if (malId != null) {
      final malKey = '${_v5Prefix}resolve:mal:$malId';
      final malCached = _readRawCache(malKey, _resolveTtl);
      if (malCached != null) {
        final alId = malCached['anilistId'] as int?;
        if (alId != null) return SeriesIdResolution.anilist(alId);
      }
      final alId = await _resolveMalToAnilist(malId);
      if (alId != null) {
        _writeRawCache(malKey, {'anilistId': alId}, _resolveTtl);
        return SeriesIdResolution.anilist(alId);
      }
      return SeriesIdResolution.none();
    }

    return SeriesIdResolution.none();
  }

  /// Anime always resolves to AniList — never TMDb/TVDB for season metadata.
  Future<SeriesIdResolution> _resolveAnimeSeriesId(WatchlistItem item) async {
    final link = item.link?.trim() ?? '';

    if (link.isNotEmpty) {
      final anilistId = MetadataService.parseAnilistId(link);
      if (anilistId != null) {
        final linkedImdb = await _resolveLinkedImdbByAnilist(anilistId);
        return SeriesIdResolution.anilist(anilistId, imdbId: linkedImdb);
      }

      final malId = MetadataService.parseMalId(link);
      if (malId != null) {
        final malKey = '${_v5Prefix}resolve:mal:$malId';
        final malCached = _readRawCache(malKey, _resolveTtl);
        if (malCached != null) {
          final alId = malCached['anilistId'] as int?;
          if (alId != null) return SeriesIdResolution.anilist(alId);
        }
        final alId = await _resolveMalToAnilist(malId);
        if (alId != null) {
          _writeRawCache(malKey, {'anilistId': alId}, _resolveTtl);
          return SeriesIdResolution.anilist(alId);
        }
      }
    }

    final imdbId = getImdbIdFromItem(item);
    if (imdbId != null) {
      final fromImdb = await _resolveAnilistIdByImdb(imdbId, item);
      if (fromImdb != null) {
        return SeriesIdResolution.anilist(fromImdb, imdbId: imdbId);
      }
    }

    final title = item.title.trim();
    if (title.isNotEmpty) {
      final fromTitle = await _resolveAnilistIdByTitle(title, item.year);
      if (fromTitle != null) {
        return SeriesIdResolution.anilist(fromTitle, imdbId: imdbId);
      }
    }

    return SeriesIdResolution.none();
  }

  Future<int?> _resolveAnilistIdByTitle(String title, int? year) async {
    final query = title.trim();
    if (query.length < 2) return null;

    final cacheKey =
        '${_v5Prefix}resolve:anilist:title:${query.toLowerCase()}:${year ?? ""}';
    final cached = _readRawCache(cacheKey, _resolveTtl);
    final cachedId = cached?['anilistId'];
    if (cachedId is int && cachedId > 0) return cachedId;

    final data = await _anilistQuery(
      r'''
      query ($search: String) {
        Page(page: 1, perPage: 8) {
          media(search: $search, type: ANIME, sort: SEARCH_MATCH) {
            id
            title { english romaji }
            startDate { year }
          }
        }
      }
      ''',
      {'search': query},
    );

    final media = data?['Page']?['media'] as List? ?? [];
    if (media.isEmpty) return null;

    Map<String, dynamic>? best;
    final key = query.toLowerCase();
    for (final raw in media) {
      if (raw is! Map) continue;
      final map = Map<String, dynamic>.from(raw);
      final titles = map['title'] as Map?;
      final label = titles?['english']?.toString() ??
          titles?['romaji']?.toString() ??
          '';
      final startYear = (map['startDate'] as Map?)?['year'];
      final yearStr = startYear?.toString() ?? '';
      if (year != null && yearStr == year.toString()) {
        best = map;
        break;
      }
      if (best == null) best = map;
      final labelKey = label.toLowerCase();
      if (labelKey == key || labelKey.contains(key) || key.contains(labelKey)) {
        best = map;
        if (year == null || yearStr == year.toString()) break;
      }
    }

    final id = best?['id'];
    final anilistId = id is int ? id : (id is num ? id.round() : null);
    if (anilistId == null || anilistId <= 0) return null;

    _writeRawCache(cacheKey, {'anilistId': anilistId}, _resolveTtl);
    return anilistId;
  }

  Future<int?> _resolveAnilistIdByImdb(String imdbId, WatchlistItem item) async {
    final cacheKey = '${_v5Prefix}resolve:anilist:imdb:$imdbId';
    final cached = _readRawCache(cacheKey, _resolveTtl);
    final cachedId = cached?['anilistId'];
    if (cachedId is int && cachedId > 0) return cachedId;

    final byTitle = await _resolveAnilistIdByTitle(item.title, item.year);
    if (byTitle != null) {
      final linked = await _resolveLinkedImdbByAnilist(byTitle);
      if (linked == null || linked == imdbId) {
        _writeRawCache(cacheKey, {'anilistId': byTitle}, _resolveTtl);
        return byTitle;
      }
    }

    return null;
  }

  /// Fetches the series summary and season list.
  ///
  /// Never fetches per-episode data; call [fetchSeasonEpisodes] for that.
  Future<SeriesMetadataResult> fetchSeriesMetadata({
    required SeriesIdResolution resolution,
    required String locale,
    String? fallbackPoster,
    bool forceRefresh = false,
  }) async {
    if (!resolution.hasUsableSource) {
      return const SeriesMetadataResult(state: MetadataResultState.invalidId);
    }

    // Anime: AniList is the canonical source (episode totals, single season).
    if (resolution.anilistId != null) {
      return _fetchAnilistSeriesMetadata(
        resolution.anilistId!,
        locale,
        fallbackPoster: fallbackPoster,
        forceRefresh: forceRefresh,
      );
    }

    if (_config.isSupabaseConfigured) {
      try {
        final tvdbId = await _resolveTvdbId(resolution);
        if (tvdbId != null) {
          final tvdbResult = await _fetchTvdbSeriesMetadata(
            tvdbId,
            locale,
            fallbackPoster: fallbackPoster,
            forceRefresh: forceRefresh,
          );
          if (tvdbResult.state == MetadataResultState.available ||
              tvdbResult.state == MetadataResultState.partiallyAvailable ||
              tvdbResult.state == MetadataResultState.offlineWithCache) {
            return tvdbResult;
          }
        }
      } catch (_) {
        // Fall through to TMDb / AniList / OMDb.
      }
    }

    switch (resolution.source) {
      case 'tmdb':
        return _fetchTmdbSeriesMetadata(
          resolution.tmdbId!,
          locale,
          fallbackPoster: fallbackPoster,
        );
      case 'anilist':
        return _fetchAnilistSeriesMetadata(
          resolution.anilistId!,
          locale,
          fallbackPoster: fallbackPoster,
          forceRefresh: forceRefresh,
        );
      case 'omdb':
        return _fetchOmdbSeriesMetadata(
          resolution.imdbId!,
          fallbackPoster: fallbackPoster,
        );
      default:
        return const SeriesMetadataResult(state: MetadataResultState.unavailable);
    }
  }

  /// TVDB-first season/episode totals for badges (web `fetchTitleSeriesCounts`).
  Future<({int? seasonCount, int? episodeCount})?> fetchTitleSeriesCounts(
    WatchlistItem item, {
    required String locale,
  }) async {
    final ct = item.contentType;
    if (ct != 'tvSeries' && ct != 'anime') return null;

    final resolution = await resolveSeriesId(item);
    if (!resolution.hasUsableSource) return null;

    if (resolution.anilistId != null) {
      final result = await _fetchAnilistSeriesMetadata(
        resolution.anilistId!,
        locale,
        fallbackPoster: item.poster,
      );
      if (result.state != MetadataResultState.available &&
          result.state != MetadataResultState.partiallyAvailable &&
          result.state != MetadataResultState.offlineWithCache) {
        return null;
      }
      final total = result.series?.totalEpisodes;
      if (total != null && total > 0) {
        return (seasonCount: 1, episodeCount: total);
      }
      return null;
    }

    final result = await fetchSeriesMetadata(
      resolution: resolution,
      locale: locale,
      fallbackPoster: item.poster,
    );
    if (result.state != MetadataResultState.available &&
        result.state != MetadataResultState.partiallyAvailable &&
        result.state != MetadataResultState.offlineWithCache) {
      return null;
    }

    final seasons = result.seasons ?? [];
    final regular = seasons.where((s) => s.seasonNumber > 0 && !s.isSpecials);
    final episodeCount = _regularEpisodeTotalFromSeasons(seasons);
    final seasonCount = regular.length;
    if (seasonCount <= 0 && (episodeCount == null || episodeCount <= 0)) {
      return null;
    }
    return (
      seasonCount: seasonCount > 0 ? seasonCount : null,
      episodeCount: episodeCount,
    );
  }

  int? _regularEpisodeTotalFromSeasons(List<SeasonSummary> seasons) {
    var total = 0;
    for (final season in seasons) {
      if (season.seasonNumber <= 0 || season.isSpecials) continue;
      final count = parsePositiveCount(season.episodeCount);
      if (count != null) total += count;
    }
    return total > 0 ? total : null;
  }

  /// Fetches episodes for a single season.
  ///
  /// Only called when the user opens a season in the detail view.
  Future<SeasonEpisodesResult> fetchSeasonEpisodes({
    required SeriesIdResolution resolution,
    required int seasonNumber,
    required String locale,
    String? fallbackPoster,
    SeasonSummary? seasonSummary,
    bool forceRefresh = false,
  }) async {
    if (!resolution.hasUsableSource) {
      return const SeasonEpisodesResult(state: MetadataResultState.invalidId);
    }

    final effectivePoster = seasonSummary?.poster.isNotEmpty == true
        ? seasonSummary!.poster
        : fallbackPoster;

    // Anime: AniList episodes (stubs or streaming list) — not TVDB.
    if (resolution.anilistId != null) {
      return _fetchAnilistEpisodes(
        resolution.anilistId!,
        seasonNumber,
        fallbackPoster: effectivePoster,
        forceRefresh: forceRefresh,
      );
    }

    if (_config.isSupabaseConfigured) {
      try {
        final tvdbId = await _resolveTvdbId(resolution);
        if (tvdbId != null) {
          var tvdbResult = await _fetchTvdbSeasonEpisodes(
            tvdbId,
            seasonNumber,
            locale,
            fallbackPoster: effectivePoster,
            seasonSummary: seasonSummary,
            forceRefresh: forceRefresh,
          );
          if (_hasRenderableEpisodes(tvdbResult)) {
            // Paint TVDB episodes first; TMDB rating enrich is applied by the
            // sheet as a non-blocking patch via [enrichSeasonEpisodeRatings].
            return tvdbResult;
          }
        }
      } catch (_) {
        // Fall through to TMDb / OMDb.
      }
    }

    switch (resolution.source) {
      case 'tmdb':
        return _fetchTmdbSeasonEpisodes(
          resolution.tmdbId!,
          seasonNumber,
          locale,
          fallbackPoster: seasonSummary?.poster.isNotEmpty == true
              ? seasonSummary!.poster
              : fallbackPoster,
        );
      case 'omdb':
        return _fetchOmdbSeasonEpisodes(resolution.imdbId!, seasonNumber);
      default:
        return const SeasonEpisodesResult(state: MetadataResultState.unavailable);
    }
  }

  /// Non-blocking TMDB rating patch after episodes are already on screen.
  Future<SeasonEpisodesResult> enrichSeasonEpisodeRatings({
    required SeriesIdResolution resolution,
    required SeasonEpisodesResult result,
    required int seasonNumber,
    required String locale,
  }) async {
    var tmdbId = resolution.tmdbId;
    if (tmdbId == null && resolution.imdbId != null) {
      tmdbId = await _resolveTmdbIdByImdb(resolution.imdbId!);
    }
    if (tmdbId == null) return result;
    return _enrichTmdbEpisodeRatingsIfNeeded(
      result,
      tmdbId,
      seasonNumber,
      locale,
    );
  }

  /// Standalone movies related to a TV series or anime (not season-carousel entries).
  Future<RelatedMoviesResult> fetchRelatedMovies({
    required SeriesIdResolution resolution,
    required WatchlistItem item,
    required String locale,
  }) async {
    if (!resolution.hasUsableSource) {
      return const RelatedMoviesResult(state: MetadataResultState.invalidId);
    }

    var anilistId = resolution.anilistId;
    if (anilistId == null && item.contentType == 'anime') {
      anilistId = getAnilistIdFromItem(item);
      if (anilistId == null) {
        final resolved = await resolveSeriesId(item);
        anilistId = resolved.anilistId;
      }
    }

    if (anilistId != null) {
      return _fetchAnilistRelatedMovies(anilistId, locale);
    }

    if (_config.isSupabaseConfigured) {
      final tvdbId = await _resolveTvdbId(resolution);
      if (tvdbId != null) {
        return _fetchTvdbRelatedMovies(tvdbId, locale);
      }
    }

    return const RelatedMoviesResult(state: MetadataResultState.noSeasons);
  }

  /// "More like this" recommendations — TMDB similar for movies/TV.
  Future<RelatedMoviesResult> fetchSimilarTitles({
    required SeriesIdResolution resolution,
    required WatchlistItem item,
    required String locale,
  }) async {
    final imdbId = resolution.imdbId ?? getImdbIdFromItem(item);
    var tmdbId = resolution.tmdbId;
    final mediaType = item.contentType == 'movies' ? 'movie' : 'tv';
    final lang = locale.startsWith('ar') ? 'ar-SA' : 'en-US';

    if ((imdbId == null || imdbId.isEmpty) && tmdbId == null) {
      return const RelatedMoviesResult(state: MetadataResultState.invalidId);
    }

    // Resolve IMDb → TMDB when needed (movie results, not only TV).
    if ((tmdbId == null || tmdbId <= 0) &&
        imdbId != null &&
        imdbId.isNotEmpty &&
        _config.hasTmdbKey) {
      final findJson = await _fetchTmdb(
        'find/$imdbId',
        {'external_source': 'imdb_id'},
      );
      if (findJson != null) {
        final movieResults =
            (findJson['movie_results'] as List?)?.cast<Map<String, dynamic>>() ??
                const [];
        final tvResults =
            (findJson['tv_results'] as List?)?.cast<Map<String, dynamic>>() ??
                const [];
        if (mediaType == 'movie' && movieResults.isNotEmpty) {
          tmdbId = movieResults.first['id'] as int?;
        } else if (mediaType == 'tv' && tvResults.isNotEmpty) {
          tmdbId = tvResults.first['id'] as int?;
        } else if (movieResults.isNotEmpty) {
          tmdbId = movieResults.first['id'] as int?;
        } else if (tvResults.isNotEmpty) {
          tmdbId = tvResults.first['id'] as int?;
        }
      }
    }

    // Direct TMDB when key is available.
    if (tmdbId != null && tmdbId > 0 && _config.hasTmdbKey) {
      final similarJson = await _fetchTmdb(
        '$mediaType/$tmdbId/similar',
        {'language': lang, 'page': '1'},
      );
      final recJson = await _fetchTmdb(
        '$mediaType/$tmdbId/recommendations',
        {'language': lang, 'page': '1'},
      );
      final rows = <Map<String, dynamic>>[
        ...((recJson?['results'] as List?)?.cast<Map<String, dynamic>>() ??
            const []),
        ...((similarJson?['results'] as List?)?.cast<Map<String, dynamic>>() ??
            const []),
      ];
      final movies = await _enrichTmdbTvSimilarMeta(
        _mapTmdbSimilarRows(rows, mediaType, tmdbId),
        mediaType,
        lang,
      );
      if (movies.isNotEmpty) {
        return RelatedMoviesResult(
          state: MetadataResultState.available,
          movies: movies,
        );
      }
    }

    // Edge fallback (deployed `similar` action).
    final edge = await _invokeTmdbEdge({
      'action': 'similar',
      if (tmdbId != null) 'tmdbId': tmdbId,
      'mediaType': mediaType,
      'imdbId': imdbId ?? '',
      'locale': locale,
    });
    if (edge == null) {
      return const RelatedMoviesResult(state: MetadataResultState.offlineNoCache);
    }

    final rows = edge['results'];
    if (rows is! List) {
      return const RelatedMoviesResult(state: MetadataResultState.noSeasons);
    }

    final movies = <RelatedMovie>[];
    for (final raw in rows) {
      if (raw is! Map) continue;
      final title = raw['title']?.toString().trim() ?? '';
      if (title.isEmpty) continue;
      final scoreRaw = raw['score'];
      final score = scoreRaw is num
          ? scoreRaw.toDouble()
          : double.tryParse('$scoreRaw');
      final genres = (raw['genres'] as List?)
              ?.map((e) => e.toString().trim())
              .where((e) => e.isNotEmpty)
              .take(4)
              .toList() ??
          const <String>[];
      final tmdbIdRaw = raw['tmdbId'];
      final tmdbId = tmdbIdRaw is int
          ? tmdbIdRaw
          : int.tryParse('$tmdbIdRaw');
      movies.add(
        RelatedMovie(
          source: 'tmdb',
          title: title,
          poster: raw['poster']?.toString() ?? '',
          year: raw['year']?.toString() ?? '',
          overview: raw['overview']?.toString() ?? '',
          score: score,
          tmdbId: tmdbId,
          genres: genres,
          contentType: raw['contentType']?.toString() ??
              (mediaType == 'movie' ? 'movies' : 'tvSeries'),
          adult: raw['adult'] == true,
          ageRating: raw['ageRating']?.toString() ?? '',
          seasonCount: raw['seasonCount'] is int
              ? raw['seasonCount'] as int
              : int.tryParse('${raw['seasonCount'] ?? ''}'),
          episodeCount: raw['episodeCount'] is int
              ? raw['episodeCount'] as int
              : int.tryParse('${raw['episodeCount'] ?? ''}'),
        ),
      );
    }

    return RelatedMoviesResult(
      state: movies.isEmpty
          ? MetadataResultState.noSeasons
          : MetadataResultState.available,
      movies: movies,
    );
  }

  Future<List<RelatedMovie>> _enrichTmdbTvSimilarMeta(
    List<RelatedMovie> movies,
    String mediaType,
    String lang,
  ) async {
    if (mediaType != 'tv' || movies.isEmpty || !_config.hasTmdbKey) {
      return movies;
    }
    final slice = movies.take(12).toList();
    final enriched = await Future.wait(slice.map((movie) async {
      final id = movie.tmdbId;
      if (id == null || id <= 0) return movie;
      if ((movie.seasonCount ?? 0) > 0 &&
          (movie.episodeCount ?? 0) > 0 &&
          movie.ageRating.isNotEmpty) {
        return movie;
      }
      final details = await _fetchTmdb(
        'tv/$id',
        {'language': lang, 'append_to_response': 'content_ratings'},
      );
      if (details == null) return movie;

      final seasons = details['number_of_seasons'] is int
          ? details['number_of_seasons'] as int
          : int.tryParse('${details['number_of_seasons'] ?? ''}');
      final episodes = details['number_of_episodes'] is int
          ? details['number_of_episodes'] as int
          : int.tryParse('${details['number_of_episodes'] ?? ''}');
      var age = movie.ageRating;
      final ratings = (details['content_ratings'] is Map
              ? (details['content_ratings'] as Map)['results']
              : null) as List? ??
          const [];
      const prefer = ['US', 'GB', 'CA', 'AU'];
      for (final iso in prefer) {
        for (final raw in ratings) {
          if (raw is! Map) continue;
          if (raw['iso_3166_1']?.toString().toUpperCase() != iso) continue;
          final rating = raw['rating']?.toString().trim() ?? '';
          if (rating.isNotEmpty) {
            age = rating;
            break;
          }
        }
        if (age.isNotEmpty && age != movie.ageRating) break;
      }
      if (age.isEmpty) {
        for (final raw in ratings) {
          if (raw is! Map) continue;
          final rating = raw['rating']?.toString().trim() ?? '';
          if (rating.isNotEmpty) {
            age = rating;
            break;
          }
        }
      }

      return RelatedMovie(
        source: movie.source,
        title: movie.title,
        poster: movie.poster,
        year: movie.year,
        overview: movie.overview,
        runtimeMinutes: movie.runtimeMinutes,
        anilistId: movie.anilistId,
        tmdbId: movie.tmdbId,
        score: movie.score,
        genres: movie.genres,
        contentType: movie.contentType,
        adult: movie.adult || details['adult'] == true,
        ageRating: age,
        seasonCount: (seasons != null && seasons > 0)
            ? seasons
            : movie.seasonCount,
        episodeCount: (episodes != null && episodes > 0)
            ? episodes
            : movie.episodeCount,
      );
    }));
    if (movies.length <= 12) return enriched;
    return [...enriched, ...movies.skip(12)];
  }

  List<RelatedMovie> _mapTmdbSimilarRows(
    List<Map<String, dynamic>> rows,
    String mediaType,
    int selfTmdbId,
  ) {
    const genreNames = <int, String>{
      28: 'Action',
      12: 'Adventure',
      16: 'Animation',
      35: 'Comedy',
      80: 'Crime',
      99: 'Documentary',
      18: 'Drama',
      10751: 'Family',
      14: 'Fantasy',
      36: 'History',
      27: 'Horror',
      10402: 'Music',
      9648: 'Mystery',
      10749: 'Romance',
      878: 'Sci-Fi',
      10770: 'TV Movie',
      53: 'Thriller',
      10752: 'War',
      37: 'Western',
      10759: 'Action & Adventure',
      10762: 'Kids',
      10763: 'News',
      10764: 'Reality',
      10765: 'Sci-Fi & Fantasy',
      10766: 'Soap',
      10767: 'Talk',
      10768: 'War & Politics',
    };
    final seen = <int>{};
    final movies = <RelatedMovie>[];
    for (final row in rows) {
      final id = row['id'];
      final tmdbId = id is int ? id : int.tryParse('$id') ?? row['tmdbId'] as int?;
      if (tmdbId == null || tmdbId <= 0 || tmdbId == selfTmdbId) continue;
      if (!seen.add(tmdbId)) continue;
      final title =
          (row['title'] ?? row['name'])?.toString().trim() ?? '';
      if (title.isEmpty) continue;
      final date =
          (row['release_date'] ?? row['first_air_date'])?.toString() ?? '';
      final year = date.length >= 4
          ? date.substring(0, 4)
          : (row['year']?.toString() ?? '');
      final posterPath = row['poster_path']?.toString() ?? '';
      final poster = (row['poster']?.toString().isNotEmpty == true)
          ? row['poster'].toString()
          : (posterPath.isNotEmpty ? '$_tmdbImage$posterPath' : '');
      final vote = row['vote_average'];
      final scoreRaw = row['score'];
      final score = scoreRaw is num
          ? scoreRaw.toDouble()
          : (vote is num && vote > 0 ? (vote * 10).roundToDouble() : null);
      final genreIds = (row['genre_ids'] as List? ?? row['genreIds'] as List? ?? const [])
          .map((e) => e is int ? e : int.tryParse('$e'))
          .whereType<int>()
          .toList();
      final genresFromRow = (row['genres'] as List?)
              ?.map((e) => e.toString().trim())
              .where((e) => e.isNotEmpty)
              .toList() ??
          const <String>[];
      final genres = genresFromRow.isNotEmpty
          ? genresFromRow.take(4).toList()
          : genreIds
              .map((id) => genreNames[id])
              .whereType<String>()
              .take(4)
              .toList();
      movies.add(
        RelatedMovie(
          source: 'tmdb',
          title: title,
          poster: poster,
          year: year,
          overview: row['overview']?.toString() ?? '',
          score: score,
          tmdbId: tmdbId,
          genres: genres,
          contentType: mediaType == 'movie' ? 'movies' : 'tvSeries',
          adult: row['adult'] == true,
          ageRating: row['ageRating']?.toString() ?? '',
          seasonCount: row['seasonCount'] is int
              ? row['seasonCount'] as int
              : (row['number_of_seasons'] is int
                  ? row['number_of_seasons'] as int
                  : int.tryParse('${row['seasonCount'] ?? row['number_of_seasons'] ?? ''}')),
          episodeCount: row['episodeCount'] is int
              ? row['episodeCount'] as int
              : (row['number_of_episodes'] is int
                  ? row['number_of_episodes'] as int
                  : int.tryParse('${row['episodeCount'] ?? row['number_of_episodes'] ?? ''}')),
        ),
      );
      if (movies.length >= 24) break;
    }
    return movies;
  }

  // ─────────────────────────────────────────────────────────────
  // TMDb series + season list
  // ─────────────────────────────────────────────────────────────

  Future<SeriesMetadataResult> _fetchTmdbSeriesMetadata(
    int tmdbId,
    String locale, {
    String? fallbackPoster,
  }) async {
    final lang = _tmdbLanguage(locale);
    final cacheKey = '${_v5Prefix}series:tmdb:$tmdbId:$locale';

    final cached = _readRawCache(cacheKey, _seriesTtl);
    if (cached != null) {
      return _parseCachedSeriesResult(
        cached,
        isStale: _isStale(cacheKey, _seriesTtl),
      );
    }

    final json = await _fetchTmdb('tv/$tmdbId', {'language': lang});

    if (json != null) {
      final result = _normalizeTmdbSeriesResult(
        json,
        tmdbId,
        fallbackPoster: fallbackPoster,
      );
      if (result != null) {
        _writeRawCache(cacheKey, _seriesResultToJson(result), _seriesTtl);
        return result;
      }
    }

    // Fallback: try English when localized fetch returned nothing useful.
    if (locale != 'en') {
      final enKey = '${_v5Prefix}series:tmdb:$tmdbId:en';
      final enCached = _readRawCache(enKey, _seriesTtl);
      if (enCached != null) {
        return _parseCachedSeriesResult(enCached, isStale: true);
      }
      final enJson = await _fetchTmdb('tv/$tmdbId', {'language': 'en-US'});
      if (enJson != null) {
        final enResult = _normalizeTmdbSeriesResult(
          enJson,
          tmdbId,
          fallbackPoster: fallbackPoster,
        );
        if (enResult != null) {
          _writeRawCache(enKey, _seriesResultToJson(enResult), _seriesTtl);
          return enResult;
        }
      }
    }

    // Network failed — return stale if present.
    final stale = _readRawCacheStale(cacheKey);
    if (stale != null) {
      return _parseCachedSeriesResult(
        stale,
        isStale: true,
        forceState: MetadataResultState.offlineWithCache,
      );
    }
    return SeriesMetadataResult(
      state: MetadataResultState.offlineNoCache,
      debugMessage: 'TMDb tv/$tmdbId fetch failed, no stale cache',
    );
  }

  SeriesMetadataResult? _normalizeTmdbSeriesResult(
    Map<String, dynamic> json,
    int tmdbId, {
    String? fallbackPoster,
  }) {
    final series = _normalizeTmdbSeries(json, tmdbId, fallbackPoster: fallbackPoster);
    if (series == null) return null;

    final seasons = _normalizeTmdbSeasonList(
      json,
      tmdbId,
      fallbackPoster: series.poster,
    );

    return SeriesMetadataResult(
      state: seasons.isEmpty ? MetadataResultState.noSeasons : MetadataResultState.available,
      series: series,
      seasons: seasons,
    );
  }

  SeriesSummary? _normalizeTmdbSeries(
    Map<String, dynamic> json,
    int tmdbId, {
    String? fallbackPoster,
  }) {
    final name = json['name']?.toString() ?? json['original_name']?.toString();
    if (name == null || name.isEmpty) return null;

    final posterPath = json['poster_path']?.toString();
    final poster =
        posterPath != null ? '$_tmdbImage$posterPath' : (fallbackPoster ?? '');

    return SeriesSummary(
      source: 'tmdb',
      tmdbId: tmdbId,
      title: name,
      originalTitle: json['original_name']?.toString(),
      totalSeasons: parsePositiveCount(json['number_of_seasons']),
      totalEpisodes: parsePositiveCount(json['number_of_episodes']),
      poster: poster,
      overview: json['overview']?.toString() ?? '',
      status: json['status']?.toString(),
      firstAirDate: json['first_air_date']?.toString(),
      lastAirDate: json['last_air_date']?.toString(),
    );
  }

  List<SeasonSummary> _normalizeTmdbSeasonList(
    Map<String, dynamic> json,
    int tmdbId, {
    String? fallbackPoster,
  }) {
    final rawSeasons = json['seasons'] as List? ?? [];
    return rawSeasons
        .map((raw) => _normalizeTmdbSeasonSummary(
              raw as Map<String, dynamic>,
              tmdbId,
              fallbackPoster: fallbackPoster,
            ))
        .whereType<SeasonSummary>()
        .toList();
  }

  SeasonSummary? _normalizeTmdbSeasonSummary(
    Map<String, dynamic> json,
    int tmdbId, {
    String? fallbackPoster,
  }) {
    final seasonNum = json['season_number'];
    if (seasonNum == null) return null;

    final posterPath = json['poster_path']?.toString();
    final poster =
        posterPath != null ? '$_tmdbImage$posterPath' : (fallbackPoster ?? '');

    final num = seasonNum as int;
    return SeasonSummary(
      source: 'tmdb',
      seriesTmdbId: tmdbId,
      seasonNumber: num,
      name: json['name']?.toString() ?? 'Season $num',
      poster: poster,
      episodeCount: parsePositiveCount(json['episode_count']),
      overview: json['overview']?.toString() ?? '',
      airDate: json['air_date']?.toString(),
      isSpecials: num == 0,
      isSynthetic: false,
    );
  }

  // ─────────────────────────────────────────────────────────────
  // TMDb season episodes
  // ─────────────────────────────────────────────────────────────

  Future<SeasonEpisodesResult> _fetchTmdbSeasonEpisodes(
    int tmdbId,
    int season,
    String locale, {
    String? fallbackPoster,
  }) async {
    final lang = _tmdbLanguage(locale);
    final cacheKey = 'metadata:v9:season:tmdb:$tmdbId:$season:$locale';

    final cached = _readRawCache(cacheKey, _episodesTtl);
    if (cached != null) {
      final parsed = _parseCachedEpisodesResult(
        cached,
        isStale: _isStale(cacheKey, _episodesTtl),
      );
      return _enrichTmdbEpisodeRatingsIfNeeded(parsed, tmdbId, season, locale);
    }

    final json = await _fetchTmdb('tv/$tmdbId/season/$season', {'language': lang});

    if (json != null) {
      var result = _normalizeTmdbSeasonEpisodes(
        json,
        tmdbId,
        season,
        fallbackPoster: fallbackPoster,
      );
      if (locale != 'en') {
        final enJson = await _fetchTmdb(
          'tv/$tmdbId/season/$season',
          {'language': 'en-US'},
        );
        if (enJson != null) {
          final enResult = _normalizeTmdbSeasonEpisodes(
            enJson,
            tmdbId,
            season,
            fallbackPoster: fallbackPoster,
          );
          result = _mergeEpisodeLocaleResults(result, enResult);
        }
      }
      result = await _enrichTmdbEpisodeRatingsIfNeeded(result, tmdbId, season, locale);
      _writeRawCache(cacheKey, _episodesResultToJson(result), _episodesTtl);
      return result;
    }

    // Fallback to English when localized fetch failed.
    if (locale != 'en') {
      final enKey = 'metadata:v9:season:tmdb:$tmdbId:$season:en';
      final enCached = _readRawCache(enKey, _episodesTtl);
      if (enCached != null) {
        final parsed = _parseCachedEpisodesResult(enCached, isStale: true);
        return _enrichTmdbEpisodeRatingsIfNeeded(parsed, tmdbId, season, locale);
      }
      final enJson = await _fetchTmdb(
        'tv/$tmdbId/season/$season',
        {'language': 'en-US'},
      );
      if (enJson != null) {
        var enResult = _normalizeTmdbSeasonEpisodes(
          enJson,
          tmdbId,
          season,
          fallbackPoster: fallbackPoster,
        );
        enResult = await _enrichTmdbEpisodeRatingsIfNeeded(enResult, tmdbId, season, 'en');
        _writeRawCache(enKey, _episodesResultToJson(enResult), _episodesTtl);
        return enResult;
      }
    }

    final stale = _readRawCacheStale(cacheKey);
    if (stale != null) {
      final parsed = _parseCachedEpisodesResult(
        stale,
        isStale: true,
        forceState: MetadataResultState.offlineWithCache,
      );
      return _enrichTmdbEpisodeRatingsIfNeeded(parsed, tmdbId, season, locale);
    }
    return const SeasonEpisodesResult(
      state: MetadataResultState.offlineNoCache,
    );
  }

  Future<SeasonEpisodesResult> _enrichTmdbEpisodeRatingsIfNeeded(
    SeasonEpisodesResult result,
    int tmdbId,
    int season,
    String locale,
  ) async {
    final episodes = result.episodes;
    if (episodes == null || episodes.isEmpty) return result;
    // Season JSON already carries vote_average — paint episodes first without a
    // second ratings round-trip when we already have a usable season score.
    if (result.seasonRating != null) return result;
    if (episodes.any((e) => e.episodeRating != null)) return result;
    return _enrichTmdbEpisodeRatings(result, tmdbId, season, locale);
  }

  Future<SeasonEpisodesResult> _enrichTmdbEpisodeRatings(
    SeasonEpisodesResult result,
    int tmdbId,
    int season,
    String locale,
  ) async {
    final episodes = result.episodes;
    if (episodes == null || episodes.isEmpty) return result;

    final needsEpisodeRating = episodes.any((e) => e.episodeRating == null);
    final needsSeasonRating = result.seasonRating == null;
    if (!needsEpisodeRating && !needsSeasonRating) return result;

    var ratingPayload = await _fetchEpisodeRatingPayload(tmdbId, season, locale);
    ratingPayload ??= locale != 'en'
        ? await _fetchEpisodeRatingPayload(tmdbId, season, 'en')
        : null;
    if (ratingPayload == null) return result;

    final ratingMap = ratingPayload.byEpisode;
    final seasonRating = result.seasonRating ?? ratingPayload.seasonRating;

    final enriched = !needsEpisodeRating || ratingMap.isEmpty
        ? episodes
        : episodes.map((ep) {
            if (ep.episodeRating != null) return ep;
            final rating = ratingMap[ep.episodeNumber];
            if (rating == null) return ep;
            return EpisodeDetail(
              source: ep.source,
              seriesTmdbId: ep.seriesTmdbId,
              seasonNumber: ep.seasonNumber,
              episodeNumber: ep.episodeNumber,
              title: ep.title,
              still: ep.still,
              overview: ep.overview,
              runtimeMinutes: ep.runtimeMinutes,
              airDate: ep.airDate,
              isAired: ep.isAired,
              episodeRating: rating,
              episodeRatingSource: 'tmdb',
            );
          }).toList();

    return result.copyWith(
      episodes: enriched,
      seasonRating: seasonRating,
      seasonRatingSource:
          seasonRating != null ? (result.seasonRatingSource ?? 'tmdb') : null,
    );
  }

  Future<({Map<int, double> byEpisode, double? seasonRating})?>
      _fetchEpisodeRatingPayload(
    int tmdbId,
    int season,
    String locale,
  ) async {
    if (_config.hasTmdbKey) {
      final lang = _tmdbLanguage(locale);
      final json = await _fetchTmdb(
        'tv/$tmdbId/season/$season',
        {'language': lang},
      );
      final byEpisode = _ratingMapFromSeasonJson(json) ?? <int, double>{};
      final seasonRating = _parseExternalRating(json?['vote_average']);
      if (byEpisode.isEmpty && seasonRating == null) return null;
      return (byEpisode: byEpisode, seasonRating: seasonRating);
    }

    final edge = await _invokeTmdbEdge({
      'action': 'seasonRatings',
      'tmdbId': tmdbId,
      'season': season,
      'locale': locale,
    });
    if (edge == null) return null;

    final rows = edge['episodes'];
    final map = <int, double>{};
    if (rows is List) {
      for (final raw in rows) {
        if (raw is! Map) continue;
        final epNum = raw['episodeNumber'];
        final rating = raw['rating'];
        if (epNum is! int && epNum is! num) continue;
        final n = rating is num ? rating.toDouble() : double.tryParse('$rating');
        if (n == null || !n.isFinite || n <= 0 || n > 10) continue;
        map[epNum is int ? epNum : epNum.round()] = (n * 10).round() / 10;
      }
    }
    final seasonRating = _parseExternalRating(edge['seasonRating']);
    if (map.isEmpty && seasonRating == null) return null;
    return (byEpisode: map, seasonRating: seasonRating);
  }

  Map<int, double>? _ratingMapFromSeasonJson(Map<String, dynamic>? json) {
    if (json == null) return null;
    final rawEps = json['episodes'];
    if (rawEps is! List) return null;
    final map = <int, double>{};
    for (final raw in rawEps) {
      if (raw is! Map) continue;
      final epNum = raw['episode_number'];
      final vote = raw['vote_average'];
      if (epNum is! int && epNum is! num) continue;
      final n = vote is num ? vote.toDouble() : double.tryParse('$vote');
      if (n == null || !n.isFinite || n <= 0 || n > 10) continue;
      map[epNum is int ? epNum : epNum.round()] = (n * 10).round() / 10;
    }
    return map.isEmpty ? null : map;
  }

  Future<Map<String, dynamic>?> _invokeTmdbEdge(
    Map<String, dynamic> body,
  ) async {
    if (!_config.isSupabaseConfigured) return null;

    final baseUrl = _config.supabaseUrl.replaceAll(RegExp(r'/$'), '');
    final functionUrl = '$baseUrl/functions/v1/tmdb-metadata';

    try {
      final response = await _client.post(
        Uri.parse(functionUrl),
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ${_config.supabaseAnonKey}',
          'apikey': _config.supabaseAnonKey,
        },
        body: jsonEncode(body),
      );
      if (response.statusCode != 200) return null;
      final json = jsonDecode(response.body) as Map<String, dynamic>;
      if (json['error'] != null) return null;
      return json;
    } catch (_) {
      return null;
    }
  }

  SeasonEpisodesResult _normalizeTmdbSeasonEpisodes(
    Map<String, dynamic> json,
    int tmdbId,
    int season, {
    String? fallbackPoster,
  }) {
    final posterPath = json['poster_path']?.toString();
    final seasonPoster =
        posterPath != null ? '$_tmdbImage$posterPath' : (fallbackPoster ?? '');

    final rawEps = json['episodes'] as List? ?? [];
    final episodes = rawEps
        .map((raw) => _normalizeTmdbEpisode(
              raw as Map<String, dynamic>,
              tmdbId,
              seasonPoster: seasonPoster,
              fallbackPoster: fallbackPoster,
            ))
        .whereType<EpisodeDetail>()
        .toList();

    if (rawEps.isNotEmpty && episodes.isEmpty) {
      return const SeasonEpisodesResult(state: MetadataResultState.unavailable);
    }

    final seasonRating = _parseExternalRating(json['vote_average']);

    return SeasonEpisodesResult(
      state: episodes.isEmpty
          ? MetadataResultState.noSeasons
          : MetadataResultState.available,
      episodes: episodes,
      seasonPoster: posterPath != null ? seasonPoster : null,
      seasonOverview: json['overview']?.toString(),
      seasonRating: seasonRating,
      seasonRatingSource: seasonRating != null ? 'tmdb' : null,
    );
  }

  EpisodeDetail? _normalizeTmdbEpisode(
    Map<String, dynamic> json,
    int tmdbId, {
    String? seasonPoster,
    String? fallbackPoster,
  }) {
    final epNum = json['episode_number'];
    if (epNum == null) return null;

    final stillPath = json['still_path']?.toString();
    final still = stillPath != null
        ? '$_tmdbImage$stillPath'
        : (seasonPoster ?? fallbackPoster ?? '');

    final airDate = json['air_date']?.toString();
    final voteAvg = (json['vote_average'] as num?)?.toDouble();
    final externalRating = voteAvg != null && voteAvg > 0 && voteAvg <= 10
        ? ((voteAvg * 10).round() / 10)
        : null;

    return EpisodeDetail(
      source: 'tmdb',
      seriesTmdbId: tmdbId,
      seasonNumber: json['season_number'] as int? ?? 0,
      episodeNumber: epNum as int,
      title: json['name']?.toString() ?? 'Episode $epNum',
      still: still,
      overview: json['overview']?.toString() ?? '',
      runtimeMinutes: json['runtime'] as int?,
      airDate: airDate?.isNotEmpty == true ? airDate : null,
      isAired: _isAired(airDate),
      episodeRating: externalRating,
      episodeRatingSource: externalRating != null ? 'tmdb' : null,
    );
  }

  // ─────────────────────────────────────────────────────────────
  // AniList series
  // ─────────────────────────────────────────────────────────────

  Future<SeriesMetadataResult> _fetchAnilistSeriesMetadata(
    int anilistId,
    String locale, {
    String? fallbackPoster,
    bool forceRefresh = false,
  }) async {
    final cacheKey = '${_v5Prefix}series:anilist:$anilistId:$locale';

    if (!forceRefresh) {
      final cached = _readRawCache(cacheKey, _seriesTtl);
      if (cached != null) {
        return _parseCachedSeriesResult(
          cached,
          isStale: _isStale(cacheKey, _seriesTtl),
        );
      }
    }

    final data = await _anilistQuery(
      r'''
      query ($id: Int) {
        Media(id: $id, type: ANIME) {
          id
          title { english romaji native }
          episodes
          coverImage { large }
          description
          startDate { year month day }
          endDate { year month day }
          status
          streamingEpisodes { title thumbnail }
        }
      }
      ''',
      {'id': anilistId},
    );

    final media = data?['Media'] as Map<String, dynamic>?;
    if (media == null) {
      final stale = _readRawCacheStale(cacheKey);
      if (stale != null) {
        return _parseCachedSeriesResult(
          stale,
          isStale: true,
          forceState: MetadataResultState.offlineWithCache,
        );
      }
      return const SeriesMetadataResult(state: MetadataResultState.offlineNoCache);
    }

    final title = media['title']?['english']?.toString() ??
        media['title']?['romaji']?.toString() ??
        media['title']?['native']?.toString() ??
        '';
    final posterUrl =
        media['coverImage']?['large']?.toString() ?? fallbackPoster ?? '';
    final episodeCount = parsePositiveCount(media['episodes']);
    final streamingEps = (media['streamingEpisodes'] as List?)?.length ?? 0;

    final series = SeriesSummary(
      source: 'anilist',
      anilistId: anilistId,
      title: title,
      totalEpisodes: episodeCount,
      totalSeasons: 1,
      poster: posterUrl,
      overview: _stripHtml(media['description']?.toString() ?? ''),
      status: media['status']?.toString(),
      firstAirDate: _anilistDateStr(media['startDate'] as Map?),
      lastAirDate: _anilistDateStr(media['endDate'] as Map?),
    );

    final season = SeasonSummary(
      source: 'anilist',
      seasonNumber: 1,
      name: 'Season 1',
      poster: posterUrl,
      episodeCount: episodeCount,
      overview: series.overview,
      airDate: series.firstAirDate,
      isSpecials: false,
      isSynthetic: true,
    );

    final hasEpDetails = streamingEps > 0 || episodeCount != null;
    final result = SeriesMetadataResult(
      state: hasEpDetails
          ? MetadataResultState.available
          : MetadataResultState.episodeDetailsUnavailable,
      series: series,
      seasons: [season],
    );

    _writeRawCache(cacheKey, _seriesResultToJson(result), _seriesTtl);
    return result;
  }

  // ─────────────────────────────────────────────────────────────
  // AniList episodes
  // ─────────────────────────────────────────────────────────────

  Future<SeasonEpisodesResult> _fetchAnilistEpisodes(
    int anilistId,
    int seasonNumber, {
    String? fallbackPoster,
    bool forceRefresh = false,
  }) async {
    if (seasonNumber != 1) {
      // AniList only models a single synthetic season.
      return const SeasonEpisodesResult(state: MetadataResultState.unavailable);
    }

    final cacheKey = 'metadata:v7:episodes:anilist:$anilistId';
    if (!forceRefresh) {
      final cached = _readRawCache(cacheKey, _episodesTtl);
      if (cached != null) {
        final parsed = _parseCachedEpisodesResult(
          cached,
          isStale: _isStale(cacheKey, _episodesTtl),
        );
        return _enrichAniFillerEpisodes(parsed, anilistId);
      }
    }

    final data = await _anilistQuery(
      r'''
      query ($id: Int) {
        Media(id: $id, type: ANIME) {
          id
          episodes
          coverImage { large }
          streamingEpisodes { title thumbnail }
        }
      }
      ''',
      {'id': anilistId},
    );

    final media = data?['Media'] as Map<String, dynamic>?;
    if (media == null) {
      final stale = _readRawCacheStale(cacheKey);
      if (stale != null) {
        final parsed = _parseCachedEpisodesResult(
          stale,
          isStale: true,
          forceState: MetadataResultState.offlineWithCache,
        );
        return _enrichAniFillerEpisodes(parsed, anilistId);
      }
      return const SeasonEpisodesResult(state: MetadataResultState.offlineNoCache);
    }

    final poster =
        media['coverImage']?['large']?.toString() ??
        (fallbackPoster ?? '');
    final episodeCount = parsePositiveCount(media['episodes']);
    final streamingEps = (media['streamingEpisodes'] as List? ?? [])
        .cast<Map<String, dynamic>>();

    List<EpisodeDetail> episodes;
    MetadataResultState state;

    if (episodeCount != null && episodeCount > 0) {
      episodes = _buildAnilistEpisodeList(
        episodeCount,
        streamingEps,
        anilistId,
        poster,
      );
      state = streamingEps.isNotEmpty
          ? MetadataResultState.partiallyAvailable
          : MetadataResultState.episodeDetailsUnavailable;
    } else if (streamingEps.isNotEmpty) {
      episodes = _buildAnilistEpisodeList(
        streamingEps.length,
        streamingEps,
        anilistId,
        poster,
      );
      state = MetadataResultState.partiallyAvailable;
    } else {
      return const SeasonEpisodesResult(
        state: MetadataResultState.episodeDetailsUnavailable,
      );
    }

    final result = SeasonEpisodesResult(state: state, episodes: episodes);
    final enriched = await _enrichAniFillerEpisodes(result, anilistId);
    _writeRawCache(cacheKey, _episodesResultToJson(enriched), _episodesTtl);
    return enriched;
  }

  Future<SeasonEpisodesResult> _enrichAniFillerEpisodes(
    SeasonEpisodesResult result,
    int anilistId,
  ) async {
    if (result.episodes == null || result.episodes!.isEmpty) return result;
    await AniFillerService.instance.ensureLoaded();
    final enriched = AniFillerService.instance.enrichEpisodes(
      anilistId,
      null,
      result.episodes!,
    );
    return result.copyWith(episodes: enriched.episodes);
  }

  List<EpisodeDetail> _buildAnilistEpisodeList(
    int episodeCount,
    List<Map<String, dynamic>> streamingEps,
    int anilistId,
    String fallbackPoster,
  ) {
    return List.generate(episodeCount, (i) {
      final stream = i < streamingEps.length ? streamingEps[i] : null;
      final rawTitle = stream?['title']?.toString() ?? '';
      final thumb = stream?['thumbnail']?.toString() ?? '';
      return EpisodeDetail(
        source: 'anilist',
        seasonNumber: 1,
        episodeNumber: i + 1,
        title: rawTitle.isNotEmpty ? rawTitle : 'Episode ${i + 1}',
        still: thumb.isNotEmpty ? thumb : '',
        isAired: true,
      );
    });
  }

  List<EpisodeDetail> _normalizeAnilistStreamingEpisodes(
    List<Map<String, dynamic>> streamingEps,
    int anilistId,
    String fallbackPoster,
  ) {
    return List.generate(streamingEps.length, (i) {
      final ep = streamingEps[i];
      final rawTitle = ep['title']?.toString() ?? '';
      return EpisodeDetail(
        source: 'anilist',
        seasonNumber: 1,
        episodeNumber: i + 1,
        title: rawTitle.isNotEmpty ? rawTitle : 'Episode ${i + 1}',
        still: ep['thumbnail']?.toString() ?? fallbackPoster,
        isAired: true,
      );
    });
  }

  // ─────────────────────────────────────────────────────────────
  // OMDb series
  // ─────────────────────────────────────────────────────────────

  Future<SeriesMetadataResult> _fetchOmdbSeriesMetadata(
    String imdbId, {
    String? fallbackPoster,
  }) async {
    // OMDb title-level data is already cached by MetadataService in v4.
    final v4 = _readV4OmdbCache(imdbId);

    final title = v4?['title']?.toString() ?? '';
    final totalSeasons = v4 != null ? parsePositiveCount(v4['seasonCount']) : null;
    final poster = v4?['poster']?.toString() ?? fallbackPoster ?? '';
    final overview = v4?['plot']?.toString() ?? '';

    final series = SeriesSummary(
      source: 'omdb',
      imdbId: imdbId,
      title: title,
      totalSeasons: totalSeasons,
      poster: poster,
      overview: overview,
    );

    if (totalSeasons == null || totalSeasons <= 0) {
      return SeriesMetadataResult(
        state: MetadataResultState.noSeasons,
        series: series,
        seasons: const [],
      );
    }

    // Generate season stubs — no episode details until a season is opened.
    final seasons = List.generate(
      totalSeasons,
      (i) => SeasonSummary(
        source: 'omdb',
        seasonNumber: i + 1,
        name: 'Season ${i + 1}',
        poster: poster,
        isSpecials: false,
        isSynthetic: true,
      ),
    );

    return SeriesMetadataResult(
      state: MetadataResultState.partiallyAvailable,
      series: series,
      seasons: seasons,
    );
  }

  // ─────────────────────────────────────────────────────────────
  // OMDb season episodes
  // ─────────────────────────────────────────────────────────────

  Future<SeasonEpisodesResult> _fetchOmdbSeasonEpisodes(
    String imdbId,
    int season,
  ) async {
    final cacheKey = '${_v5Prefix}season:omdb:$imdbId:$season';
    final cached = _readRawCache(cacheKey, _episodesTtl);
    if (cached != null) {
      return _parseCachedEpisodesResult(
        cached,
        isStale: _isStale(cacheKey, _episodesTtl),
      );
    }

    if (!_config.hasOmdbKey) {
      return const SeasonEpisodesResult(
        state: MetadataResultState.unavailable,
        debugMessage: 'No OMDb API key configured',
      );
    }

    final uri = Uri.https('www.omdbapi.com', '/', {
      'i': imdbId,
      'Season': '$season',
      'apikey': _config.omdbApiKey,
    });

    try {
      final response = await _client.get(uri);
      if (response.statusCode == 429) {
        return const SeasonEpisodesResult(state: MetadataResultState.rateLimited);
      }
      if (response.statusCode != 200) {
        return SeasonEpisodesResult(
          state: MetadataResultState.apiFailure,
          debugMessage: 'OMDb status ${response.statusCode}',
        );
      }

      final json = jsonDecode(response.body) as Map<String, dynamic>;
      if (json['Response'] != 'True') {
        return SeasonEpisodesResult(
          state: MetadataResultState.unavailable,
          debugMessage: json['Error']?.toString(),
        );
      }

      final episodes = _normalizeOmdbSeason(json, season);
      final result = SeasonEpisodesResult(
        state: MetadataResultState.available,
        episodes: episodes,
      );
      _writeRawCache(cacheKey, _episodesResultToJson(result), _episodesTtl);
      return result;
    } on SocketException {
      final stale = _readRawCacheStale(cacheKey);
      if (stale != null) {
        return _parseCachedEpisodesResult(
          stale,
          isStale: true,
          forceState: MetadataResultState.offlineWithCache,
        );
      }
      return const SeasonEpisodesResult(state: MetadataResultState.offlineNoCache);
    } catch (e) {
      return SeasonEpisodesResult(
        state: MetadataResultState.apiFailure,
        debugMessage: e.toString(),
      );
    }
  }

  List<EpisodeDetail> _normalizeOmdbSeason(
    Map<String, dynamic> json,
    int season,
  ) {
    final rawEps = json['Episodes'] as List? ?? [];
    return rawEps.map((raw) {
      final ep = raw as Map<String, dynamic>;
      final epNum = parsePositiveCount(ep['Episode']) ?? 0;
      final released = _na(ep['Released']?.toString());
      return EpisodeDetail(
        source: 'omdb',
        seasonNumber: season,
        episodeNumber: epNum,
        title: _na(ep['Title']?.toString()),
        // OMDb never provides stills or per-episode descriptions.
        still: '',
        overview: '',
        runtimeMinutes: null,
        airDate: released.isNotEmpty ? released : null,
        isAired: released.isNotEmpty ? _isAired(released) : true,
        // OMDb season bulk ratings are incomplete — do not surface as episode scores.
        episodeRating: null,
        episodeRatingSource: null,
      );
    }).where((e) => e.episodeNumber > 0).toList();
  }

  // ─────────────────────────────────────────────────────────────
  // HTTP helpers
  // ─────────────────────────────────────────────────────────────

  Future<Map<String, dynamic>?> _fetchTmdb(
    String path,
    Map<String, String> params,
  ) async {
    if (_config.hasTmdbKey) {
      final query = {...params, 'api_key': _config.tmdbApiKey};
      final uri = Uri.https('api.themoviedb.org', '/3/$path', query);
      try {
        final response = await _client.get(uri);
        if (response.statusCode == 429) return null;
        if (response.statusCode != 200) return null;
        return jsonDecode(response.body) as Map<String, dynamic>;
      } on SocketException {
        return null;
      } catch (_) {
        return null;
      }
    }

    if (path.startsWith('tv/')) {
      return _fetchTmdbViaEdge(path, params);
    }
    return null;
  }

  Future<Map<String, dynamic>?> _fetchTmdbViaEdge(
    String path,
    Map<String, String> params,
  ) async {
    if (!_config.isSupabaseConfigured) return null;

    final match = RegExp(r'^tv/(\d+)(?:/season/(\d+))?$').firstMatch(path);
    if (match == null) return null;

    final tmdbId = int.tryParse(match.group(1)!);
    if (tmdbId == null) return null;
    final season = match.group(2) != null ? int.tryParse(match.group(2)!) : null;
    final language = params['language'] ?? 'en-US';
    final locale = language.startsWith('ar') ? 'ar' : 'en';

    final baseUrl = _config.supabaseUrl.replaceAll(RegExp(r'/$'), '');
    final functionUrl = '$baseUrl/functions/v1/tmdb-metadata';

    try {
      final response = await _client.post(
        Uri.parse(functionUrl),
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ${_config.supabaseAnonKey}',
          'apikey': _config.supabaseAnonKey,
        },
        body: jsonEncode({
          'action': 'tvFetch',
          'tmdbId': tmdbId,
          if (season != null) 'season': season,
          'locale': locale,
        }),
      );
      if (response.statusCode != 200) return null;
      final json = jsonDecode(response.body) as Map<String, dynamic>;
      if (json['error'] != null || json['data'] == null) return null;
      return Map<String, dynamic>.from(json['data'] as Map);
    } catch (_) {
      return null;
    }
  }

  Future<int?> _resolveTmdbIdByImdb(String imdbId) async {
    if (_config.hasTmdbKey) {
      final json =
          await _fetchTmdb('find/$imdbId', {'external_source': 'imdb_id'});
      if (json == null) return null;

      final tvResults =
          (json['tv_results'] as List?)?.cast<Map<String, dynamic>>() ?? [];
      if (tvResults.isNotEmpty) return tvResults.first['id'] as int?;
      return null;
    }

    if (!_config.isSupabaseConfigured) return null;

    final baseUrl = _config.supabaseUrl.replaceAll(RegExp(r'/$'), '');
    final functionUrl = '$baseUrl/functions/v1/tmdb-metadata';
    try {
      final response = await _client.post(
        Uri.parse(functionUrl),
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ${_config.supabaseAnonKey}',
          'apikey': _config.supabaseAnonKey,
        },
        body: jsonEncode({'action': 'resolve', 'imdbId': imdbId}),
      );
      if (response.statusCode != 200) return null;
      final json = jsonDecode(response.body) as Map<String, dynamic>;
      final tmdbId = json['tmdbId'];
      if (tmdbId is int && tmdbId > 0) return tmdbId;
      return null;
    } catch (_) {
      return null;
    }
  }

  Future<int?> _resolveMalToAnilist(int malId) async {
    final data = await _anilistQuery(
      r'query ($malId: Int) { Media(idMal: $malId, type: ANIME) { id } }',
      {'malId': malId},
    );
    return data?['Media']?['id'] as int?;
  }

  Future<Map<String, dynamic>?> _anilistQuery(
    String query,
    Map<String, dynamic> variables,
  ) async {
    try {
      final response = await _client.post(
        Uri.parse(_anilistApi),
        headers: const {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: jsonEncode({'query': query, 'variables': variables}),
      );
      final json = jsonDecode(response.body) as Map<String, dynamic>;
      if (response.statusCode != 200 ||
          (json['errors'] as List?)?.isNotEmpty == true) {
        return null;
      }
      return json['data'] as Map<String, dynamic>?;
    } on SocketException {
      return null;
    } catch (_) {
      return null;
    }
  }

  // ─────────────────────────────────────────────────────────────
  // TheTVDB provider (via tvdb-metadata edge function — matches web)
  // ─────────────────────────────────────────────────────────────

  Future<Map<String, dynamic>?> _invokeTvdbEdge(
    Map<String, dynamic> body,
  ) async {
    if (!_config.isSupabaseConfigured) return null;

    final baseUrl = _config.supabaseUrl.replaceAll(RegExp(r'/$'), '');
    final functionUrl = '$baseUrl/functions/v1/tvdb-metadata';

    try {
      final response = await _client.post(
        Uri.parse(functionUrl),
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ${_config.supabaseAnonKey}',
          'apikey': _config.supabaseAnonKey,
        },
        body: jsonEncode(body),
      );
      if (response.statusCode != 200) return null;
      final json = jsonDecode(response.body);
      if (json is! Map<String, dynamic>) return null;
      if (json['error'] != null) return null;
      return json;
    } catch (_) {
      return null;
    }
  }

  Future<int?> _resolveTvdbId(SeriesIdResolution resolution) async {
    if (!_config.isSupabaseConfigured) return null;

    final imdbId = resolution.imdbId;
    if (imdbId != null && imdbId.isNotEmpty) {
      final id = await _resolveTvdbIdByImdb(imdbId);
      if (id != null) return id;
    }

    final tmdbId = resolution.tmdbId;
    if (tmdbId != null) {
      final id = await _resolveTvdbIdByTmdb(tmdbId);
      if (id != null) return id;
    }

    final anilistId = resolution.anilistId;
    if (anilistId != null) {
      return _resolveTvdbIdByAnilist(anilistId);
    }

    return null;
  }

  Future<int?> _resolveTvdbIdByImdb(String imdbId) async {
    final cacheKey = 'metadata:v7:resolve:tvdb:imdb:$imdbId';
    final cached = _readRawCache(cacheKey, _resolveTtl);
    final cachedId = cached?['tvdbId'];
    if (cachedId is int && cachedId > 0) return cachedId;

    final negKey = 'metadata:v7:resolve:tvdb:negative:imdb:$imdbId';
    if (_isNegativeCacheValid(negKey)) return null;

    final result = await _invokeTvdbEdge({'action': 'resolve', 'imdbId': imdbId});
    final tvdbId = result?['tvdbId'];
    if (tvdbId is int && tvdbId > 0) {
      _writeRawCache(cacheKey, {'tvdbId': tvdbId}, _resolveTtl);
      return tvdbId;
    }

    _writeNegativeCache(negKey, _negativeResolveTtl);
    return null;
  }

  Future<int?> _resolveTvdbIdByTmdb(int tmdbId) async {
    final cacheKey = 'metadata:v7:resolve:tvdb:tmdb:$tmdbId';
    final cached = _readRawCache(cacheKey, _resolveTtl);
    final cachedId = cached?['tvdbId'];
    if (cachedId is int && cachedId > 0) return cachedId;

    final negKey = 'metadata:v7:resolve:tvdb:negative:tmdb:$tmdbId';
    if (_isNegativeCacheValid(negKey)) return null;

    final result = await _invokeTvdbEdge({'action': 'resolve', 'tmdbId': tmdbId});
    final tvdbId = result?['tvdbId'];
    if (tvdbId is int && tvdbId > 0) {
      _writeRawCache(cacheKey, {'tvdbId': tvdbId}, _resolveTtl);
      return tvdbId;
    }

    _writeNegativeCache(negKey, _negativeResolveTtl);
    return null;
  }

  Future<String?> _resolveLinkedImdbByAnilist(int anilistId) async {
    final cacheKey = 'metadata:v7:resolve:imdb:anilist:$anilistId';
    final cached = _readRawCache(cacheKey, _resolveTtl);
    final cachedImdb = cached?['imdbId']?.toString();
    if (cachedImdb != null && cachedImdb.isNotEmpty) return cachedImdb;

    final data = await _anilistQuery(
      r'query ($id: Int) { Media(id: $id, type: ANIME) { externalLinks { site url } } }',
      {'id': anilistId},
    );
    final links = data?['Media']?['externalLinks'] as List? ?? [];
    for (final raw in links) {
      if (raw is! Map) continue;
      final site = raw['site']?.toString() ?? '';
      if (!RegExp(r'^imdb$', caseSensitive: false).hasMatch(site)) continue;
      final linkedImdb =
          MetadataService.extractImdbId(raw['url']?.toString() ?? '');
      if (linkedImdb != null) {
        _writeRawCache(cacheKey, {'imdbId': linkedImdb}, _resolveTtl);
        return linkedImdb;
      }
    }
    return null;
  }

  Future<String?> resolveLinkedImdbByAnilist(int anilistId) =>
      _resolveLinkedImdbByAnilist(anilistId);

  Future<int?> _resolveTvdbIdByAnilist(int anilistId) async {
    final cacheKey = 'metadata:v7:resolve:tvdb:anilist:$anilistId';
    final cached = _readRawCache(cacheKey, _resolveTtl);
    final cachedId = cached?['tvdbId'];
    if (cachedId is int && cachedId > 0) return cachedId;

    final linkedImdb = await _resolveLinkedImdbByAnilist(anilistId);
    if (linkedImdb != null) {
      final tvdbId = await _resolveTvdbIdByImdb(linkedImdb);
      if (tvdbId != null) {
        _writeRawCache(cacheKey, {'tvdbId': tvdbId}, _resolveTtl);
        return tvdbId;
      }
    }
    return null;
  }

  Future<SeriesMetadataResult> _fetchTvdbSeriesMetadata(
    int tvdbId,
    String locale, {
    String? fallbackPoster,
    bool forceRefresh = false,
  }) async {
    final cacheKey = 'metadata:v8:series:tvdb:$tvdbId:$locale';
    if (!forceRefresh) {
      final cached = _readRawCache(cacheKey, _seriesTtl);
      if (cached != null) {
        return _parseCachedSeriesResult(
          cached,
          isStale: _isStale(cacheKey, _seriesTtl),
        );
      }
    }

    try {
      final seriesData = await _invokeTvdbEdge({
        'action': 'series',
        'tvdbId': tvdbId,
        'locale': locale,
      });
      final seasonsResult = await _invokeTvdbEdge({
        'action': 'seasons',
        'tvdbId': tvdbId,
        'locale': locale,
      });

      if (seriesData == null) {
        final stale = _readRawCacheStale(cacheKey);
        if (stale != null) {
          return _parseCachedSeriesResult(
            stale,
            isStale: true,
            forceState: MetadataResultState.offlineWithCache,
          );
        }
        return const SeriesMetadataResult(
          state: MetadataResultState.offlineNoCache,
        );
      }

      final poster = _normalizeTvdbArtworkUrl(seriesData['poster']?.toString()) !=
              ''
          ? _normalizeTvdbArtworkUrl(seriesData['poster']?.toString())
          : (fallbackPoster ?? '');

      final rawSeasons = seasonsResult?['seasons'] as List? ?? [];
      var seasons = rawSeasons
          .whereType<Map>()
          .map((raw) => _normalizeTvdbSeasonSummary(
                Map<String, dynamic>.from(raw),
                fallbackPoster: poster,
              ))
          .whereType<SeasonSummary>()
          .toList();

      Map<String, dynamic>? totalsData;
      try {
        totalsData = await _invokeTvdbEdge({
          'action': 'episodeTotals',
          'tvdbId': tvdbId,
          'locale': locale,
        });
        final seasonCounts = totalsData?['seasonCounts'];
        if (seasonCounts is Map) {
          seasons = seasons.map((season) {
            if (season.seasonNumber <= 0) return season;
            final count = parsePositiveCount(
              seasonCounts['${season.seasonNumber}'],
            );
            if (count == null || count <= 0) return season;
            return SeasonSummary(
              source: season.source,
              seasonNumber: season.seasonNumber,
              name: season.name,
              poster: season.poster,
              episodeCount: count,
              overview: season.overview,
              airDate: season.airDate,
              isSpecials: season.isSpecials,
              isSynthetic: season.isSynthetic,
            );
          }).toList();
        }
      } catch (_) {
        // Episode counts optional.
      }

      final regularSeasons =
          rawSeasons.where((s) => s is Map && s['isSpecials'] != true).length;

      final series = SeriesSummary(
        source: 'tvdb',
        imdbId: seriesData['imdbId']?.toString(),
        title: seriesData['title']?.toString() ?? '',
        overview: seriesData['overview']?.toString() ?? '',
        poster: poster,
        status: seriesData['status']?.toString(),
        firstAirDate: seriesData['firstAired']?.toString(),
        totalSeasons: regularSeasons > 0 ? regularSeasons : null,
        totalEpisodes: parsePositiveCount(totalsData?['episodeTotal']),
      );

      final result = SeriesMetadataResult(
        state: seasons.isEmpty
            ? MetadataResultState.noSeasons
            : MetadataResultState.available,
        series: series,
        seasons: seasons,
      );
      _writeRawCache(cacheKey, _seriesResultToJson(result), _seriesTtl);
      return result;
    } catch (_) {
      final stale = _readRawCacheStale(cacheKey);
      if (stale != null) {
        return _parseCachedSeriesResult(
          stale,
          isStale: true,
          forceState: MetadataResultState.offlineWithCache,
        );
      }
      return const SeriesMetadataResult(
        state: MetadataResultState.unavailable,
      );
    }
  }

  SeasonSummary? _normalizeTvdbSeasonSummary(
    Map<String, dynamic> json, {
    String? fallbackPoster,
  }) {
    final seasonNum = json['seasonNumber'];
    final int? seasonNumber = switch (seasonNum) {
      int n => n,
      num n => n.round(),
      _ => null,
    };
    if (seasonNumber == null) return null;

    final posterRaw = json['poster']?.toString() ?? '';
    final poster = _normalizeTvdbArtworkUrl(posterRaw).isNotEmpty
        ? _normalizeTvdbArtworkUrl(posterRaw)
        : (fallbackPoster ?? '');

    return SeasonSummary(
      source: 'tvdb',
      seasonNumber: seasonNumber,
      name: json['name']?.toString() ?? 'Season $seasonNumber',
      poster: poster,
      overview: json['overview']?.toString() ?? '',
      airDate: json['airDate']?.toString(),
      isSpecials: json['isSpecials'] == true || seasonNumber == 0,
      isSynthetic: false,
    );
  }

  Future<SeasonEpisodesResult> _fetchTvdbSeasonEpisodes(
    int tvdbId,
    int season,
    String locale, {
    String? fallbackPoster,
    SeasonSummary? seasonSummary,
    bool forceRefresh = false,
  }) async {
    final cacheKey = 'metadata:v14:season:tvdb:$tvdbId:$season:$locale';
    if (!forceRefresh) {
      final cached = _readRawCache(cacheKey, _episodesTtl);
      if (cached != null) {
        return _parseCachedEpisodesResult(
          cached,
          isStale: _isStale(cacheKey, _episodesTtl),
        );
      }
    }

    try {
      final episodesResult = await _invokeTvdbEdge({
        'action': 'episodes',
        'tvdbId': tvdbId,
        'season': season,
        'locale': locale,
      });
      Map<String, dynamic>? enEpisodesResult;
      if (locale != 'en') {
        enEpisodesResult = await _invokeTvdbEdge({
          'action': 'episodes',
          'tvdbId': tvdbId,
          'season': season,
          'locale': 'en',
        });
      }

      final rawEps = episodesResult?['episodes'] as List?;
      if (rawEps == null) {
        final stale = _readRawCacheStale(cacheKey);
        if (stale != null) {
          return _parseCachedEpisodesResult(
            stale,
            isStale: true,
            forceState: MetadataResultState.offlineWithCache,
          );
        }
        return const SeasonEpisodesResult(
          state: MetadataResultState.offlineNoCache,
        );
      }

      if (rawEps.isEmpty) {
        return const SeasonEpisodesResult(
          state: MetadataResultState.unavailable,
        );
      }

      var episodes = rawEps
          .whereType<Map>()
          .map((raw) => _normalizeTvdbEpisode(Map<String, dynamic>.from(raw)))
          .where((ep) => ep.seasonNumber == season)
          .toList();

      // TVDB can return episodes with missing/wrong seasonNumber after filtering.
      if (episodes.isEmpty && rawEps.isNotEmpty) {
        episodes = rawEps
            .whereType<Map>()
            .map((raw) {
              final ep =
                  _normalizeTvdbEpisode(Map<String, dynamic>.from(raw));
              if (ep.episodeNumber <= 0) return null;
              if (ep.seasonNumber == season) return ep;
              return EpisodeDetail(
                source: ep.source,
                seasonNumber: season,
                episodeNumber: ep.episodeNumber,
                title: ep.title,
                still: ep.still,
                overview: ep.overview,
                runtimeMinutes: ep.runtimeMinutes,
                airDate: ep.airDate,
                isAired: ep.isAired,
                episodeRating: ep.episodeRating,
                episodeRatingSource: ep.episodeRatingSource,
              );
            })
            .whereType<EpisodeDetail>()
            .toList();
      }

      final seasonPosterUrl = _normalizeTvdbArtworkUrl(fallbackPoster);
      final nonEmpty = episodes.where((e) => e.still.isNotEmpty).toList();
      final uniqueUrls = nonEmpty.map((e) => e.still).toSet();
      final isPosterDup = nonEmpty.length >= 2 &&
          uniqueUrls.length == 1 &&
          seasonPosterUrl.isNotEmpty &&
          uniqueUrls.contains(seasonPosterUrl);
      if (isPosterDup) {
        episodes = episodes
            .map(
              (e) => EpisodeDetail(
                source: e.source,
                seasonNumber: e.seasonNumber,
                episodeNumber: e.episodeNumber,
                title: e.title,
                still: '',
                overview: e.overview,
                runtimeMinutes: e.runtimeMinutes,
                airDate: e.airDate,
                isAired: e.isAired,
              ),
            )
            .toList();
      }

      if (locale != 'en' && enEpisodesResult != null) {
        final enRaw = enEpisodesResult['episodes'] as List? ?? [];
        final enByKey = <String, EpisodeDetail>{
          for (final raw in enRaw.whereType<Map>())
            _normalizeTvdbEpisode(Map<String, dynamic>.from(raw)).progressKey:
                _normalizeTvdbEpisode(Map<String, dynamic>.from(raw)),
        };
        episodes = episodes.map((ep) {
          final enEp = enByKey[ep.progressKey];
          if (enEp == null) return ep;
          return EpisodeDetail(
            source: ep.source,
            seasonNumber: ep.seasonNumber,
            episodeNumber: ep.episodeNumber,
            title: _pickLocalizedEpisodeTitle(
              ep.title,
              enEp.title,
              ep.episodeNumber,
            ),
            still: ep.still.isNotEmpty ? ep.still : enEp.still,
            overview: _pickLocalizedOverview(ep.overview, enEp.overview),
            runtimeMinutes: ep.runtimeMinutes ?? enEp.runtimeMinutes,
            airDate: ep.airDate ?? enEp.airDate,
            isAired: ep.isAired,
          );
        }).toList();
      }

      if (season == 0) {
        episodes = filterSpecialsEpisodes(episodes);
      }

      if (episodes.isEmpty) {
        return const SeasonEpisodesResult(
          state: MetadataResultState.unavailable,
        );
      }

      final seasonPoster = seasonSummary?.poster.isNotEmpty == true
          ? seasonSummary!.poster
          : fallbackPoster;
      final seasonOverview = seasonSummary?.overview.isNotEmpty == true
          ? seasonSummary!.overview
          : null;

      final result = SeasonEpisodesResult(
        state: MetadataResultState.available,
        episodes: episodes,
        seasonPoster: seasonPoster,
        seasonOverview: seasonOverview,
      );
      _writeRawCache(cacheKey, _episodesResultToJson(result), _episodesTtl);
      return result;
    } catch (_) {
      final stale = _readRawCacheStale(cacheKey);
      if (stale != null) {
        return _parseCachedEpisodesResult(
          stale,
          isStale: true,
          forceState: MetadataResultState.offlineWithCache,
        );
      }
      return const SeasonEpisodesResult(
        state: MetadataResultState.unavailable,
      );
    }
  }

  EpisodeDetail _normalizeTvdbEpisode(Map<String, dynamic> json) {
    final seasonNum = json['seasonNumber'];
    final epNum = json['episodeNumber'];
    final season = seasonNum is int
        ? seasonNum
        : (seasonNum is num ? seasonNum.round() : 0);
    final episode = epNum is int ? epNum : (epNum is num ? epNum.round() : 0);

    return EpisodeDetail(
      source: 'tvdb',
      seriesTvdbId: parsePositiveCount(json['seriesTvdbId'] ?? json['tvdbId']),
      seasonNumber: season,
      episodeNumber: episode,
      title: json['title']?.toString() ?? 'Episode $episode',
      still: _normalizeTvdbArtworkUrl(json['still']?.toString()),
      overview: json['overview']?.toString() ?? '',
      runtimeMinutes: parsePositiveCount(json['runtimeMinutes']),
      airDate: json['airDate']?.toString(),
      isAired: json['isAired'] != false,
      isMovie: json['isMovie'] == true || json['isMovie'] == 1,
      linkedMovieId: parsePositiveCount(json['linkedMovieId']),
    );
  }

  Future<RelatedMoviesResult> _fetchTvdbRelatedMovies(
    int tvdbId,
    String locale,
  ) async {
    final cacheKey = '${_v5Prefix}related:movies:tvdb:$tvdbId:$locale';
    final cached = _readRawCache(cacheKey, _seriesTtl);
    if (cached != null && cached['movies'] is List) {
      final movies = (cached['movies'] as List)
          .whereType<Map>()
          .map((m) => RelatedMovie.fromJson(Map<String, dynamic>.from(m)))
          .where((m) => m.title.isNotEmpty)
          .toList();
      return RelatedMoviesResult(
        state: movies.isNotEmpty
            ? MetadataResultState.available
            : MetadataResultState.noSeasons,
        movies: movies,
        isStale: _isStale(cacheKey, _seriesTtl),
      );
    }

    try {
      final result = await _invokeTvdbEdge({
        'action': 'episodes',
        'tvdbId': tvdbId,
        'season': 0,
        'locale': locale,
      });
      final rawEps = result?['episodes'] as List? ?? [];
      final movies = rawEps
          .whereType<Map>()
          .map((raw) => _normalizeTvdbEpisode(Map<String, dynamic>.from(raw)))
          .where(isMovieLikeTvSpecial)
          .map(_normalizeTvdbRelatedMovie)
          .where((m) => m.title.isNotEmpty)
          .toList();

      _writeRawCache(cacheKey, {
        'movies': movies.map((m) => m.toJson()).toList(),
      }, _seriesTtl);

      return RelatedMoviesResult(
        state: movies.isNotEmpty
            ? MetadataResultState.available
            : MetadataResultState.noSeasons,
        movies: movies,
      );
    } catch (_) {
      final stale = _readRawCacheStale(cacheKey);
      if (stale != null && stale['movies'] is List) {
        final movies = (stale['movies'] as List)
            .whereType<Map>()
            .map((m) => RelatedMovie.fromJson(Map<String, dynamic>.from(m)))
            .toList();
        return RelatedMoviesResult(
          state: MetadataResultState.offlineWithCache,
          movies: movies,
          isStale: true,
        );
      }
      return const RelatedMoviesResult(state: MetadataResultState.unavailable);
    }
  }

  RelatedMovie _normalizeTvdbRelatedMovie(EpisodeDetail episode) {
    final year = episode.airDate != null && episode.airDate!.length >= 4
        ? episode.airDate!.substring(0, 4)
        : '';
    return RelatedMovie(
      source: 'tvdb',
      title: episode.title.trim(),
      poster: episode.still,
      year: year,
      overview: episode.overview,
      runtimeMinutes: episode.runtimeMinutes,
    );
  }

  static const _anilistRelatedNodeFields = '''
    id
    type
    format
    duration
    averageScore
    isAdult
    genres
    episodes
    title { english romaji native }
    coverImage { large }
    description(asHtml: false)
    startDate { year month day }
  ''';

  Future<RelatedMoviesResult> _fetchAnilistRelatedMovies(
    int anilistId,
    String locale,
  ) async {
    final cacheKey = '${_v5Prefix}related:movies:anilist:$anilistId:$locale';
    final cached = _readRawCache(cacheKey, _seriesTtl);
    if (cached != null && cached['movies'] is List) {
      final movies = (cached['movies'] as List)
          .whereType<Map>()
          .map((m) => RelatedMovie.fromJson(Map<String, dynamic>.from(m)))
          .where((m) => m.title.isNotEmpty)
          .toList();
      return RelatedMoviesResult(
        state: movies.isNotEmpty
            ? MetadataResultState.available
            : MetadataResultState.noSeasons,
        movies: movies,
        isStale: _isStale(cacheKey, _seriesTtl),
      );
    }

    final data = await _anilistQuery(
      '''
      query (\$id: Int) {
        Media(id: \$id, type: ANIME) {
          $_anilistRelatedNodeFields
          relations {
            edges {
              relationType
              node {
                $_anilistRelatedNodeFields
                relations {
                  edges {
                    relationType
                    node { $_anilistRelatedNodeFields }
                  }
                }
              }
            }
          }
        }
      }
      ''',
      {'id': anilistId},
    );

    final media = data?['Media'] as Map<String, dynamic>?;
    if (media == null) {
      final stale = _readRawCacheStale(cacheKey);
      if (stale != null && stale['movies'] is List) {
        final movies = (stale['movies'] as List)
            .whereType<Map>()
            .map((m) => RelatedMovie.fromJson(Map<String, dynamic>.from(m)))
            .toList();
        return RelatedMoviesResult(
          state: MetadataResultState.offlineWithCache,
          movies: movies,
          isStale: true,
        );
      }
      return const RelatedMoviesResult(
        state: MetadataResultState.offlineNoCache,
      );
    }

    final chain = await _collectAnilistSeasonChain(media);
    final chainIds = chain
        .map((n) => n['id'])
        .whereType<int>()
        .toSet();
    final sources = <Map<String, dynamic>>[media];
    for (final node in chain) {
      final id = node['id'] as int?;
      if (id != null && id != anilistId) {
        final expanded = await _fetchAnilistRelatedNode(id);
        if (expanded != null) sources.add(expanded);
      }
    }

    final related = _collectAnilistRelatedMoviesFromSources(sources, chainIds);
    final movies = related
        .map(_normalizeAnilistRelatedMovie)
        .where((m) => m.title.isNotEmpty)
        .toList();

    _writeRawCache(cacheKey, {
      'movies': movies.map((m) => m.toJson()).toList(),
    }, _seriesTtl);

    return RelatedMoviesResult(
      state: movies.isNotEmpty
          ? MetadataResultState.available
          : MetadataResultState.noSeasons,
      movies: movies,
    );
  }

  Future<Map<String, dynamic>?> _fetchAnilistRelatedNode(int anilistId) async {
    final data = await _anilistQuery(
      '''
      query (\$id: Int) {
        Media(id: \$id, type: ANIME) {
          $_anilistRelatedNodeFields
          relations {
            edges {
              relationType
              node { $_anilistRelatedNodeFields }
            }
          }
        }
      }
      ''',
      {'id': anilistId},
    );
    return data?['Media'] as Map<String, dynamic>?;
  }

  Future<List<Map<String, dynamic>>> _collectAnilistSeasonChain(
    Map<String, dynamic> root, {
    int maxSeasons = 30,
  }) async {
    final chain = <Map<String, dynamic>>[];
    final seen = <int>{};
    var current = root;

    while (chain.length < maxSeasons) {
      final currentId = current['id'] as int?;
      if (currentId == null || seen.contains(currentId)) break;
      seen.add(currentId);
      chain.add(current);

      final nextStub = _pickBestAnilistSequel(
        current['relations']?['edges'] as List?,
      );
      if (nextStub == null) break;
      final nextId = nextStub['id'] as int?;
      if (nextId == null || seen.contains(nextId)) break;

      final expanded = await _fetchAnilistRelatedNode(nextId);
      if (expanded == null) break;

      final nextEpisodeCount = parsePositiveCount(expanded['episodes']);
      if (nextEpisodeCount == null || nextEpisodeCount <= 0) break;
      current = expanded;
    }

    return chain;
  }

  Map<String, dynamic>? _pickBestAnilistSequel(List? edges) {
    if (edges == null) return null;
    const sequelTypes = {'SEQUEL', 'SIDE_STORY', 'ALTERNATIVE'};
    Map<String, dynamic>? best;
    var bestPriority = -1;

    for (final edge in edges.whereType<Map>()) {
      final relationType =
          edge['relationType']?.toString().toUpperCase() ?? '';
      if (!sequelTypes.contains(relationType)) continue;
      final node = edge['node'] as Map<String, dynamic>?;
      if (node == null || node['type']?.toString() != 'ANIME') continue;
      final format = node['format']?.toString().toUpperCase() ?? '';
      if (format == 'MOVIE' || format == 'MUSIC' || format == 'SPECIAL') {
        continue;
      }
      final priority = relationType == 'SEQUEL' ? 3 : 1;
      if (priority > bestPriority) {
        bestPriority = priority;
        best = node;
      }
    }
    return best;
  }

  List<Map<String, dynamic>> _collectAnilistRelatedMoviesFromSources(
    List<Map<String, dynamic>> sources,
    Set<int> chainIds,
  ) {
    final seen = <int>{};
    final movies = <Map<String, dynamic>>[];

    for (final media in sources) {
      final edges = media['relations']?['edges'] as List? ?? [];
      for (final edge in edges.whereType<Map>()) {
        final node = edge['node'] as Map<String, dynamic>?;
        if (node == null || node['type']?.toString() != 'ANIME') continue;
        final id = node['id'] as int?;
        if (id == null || chainIds.contains(id) || seen.contains(id)) continue;
        final format = node['format']?.toString().toUpperCase() ?? '';
        if (format != 'MOVIE') continue;
        final relationType =
            edge['relationType']?.toString().toUpperCase() ?? '';
        if (relationType == 'CHARACTER') continue;
        seen.add(id);
        movies.add(node);
      }
    }

    movies.sort((a, b) {
      final aKey = _anilistStartSortKey(a['startDate'] as Map?);
      final bKey = _anilistStartSortKey(b['startDate'] as Map?);
      return aKey.compareTo(bKey);
    });
    return movies;
  }

  int _anilistStartSortKey(Map? date) {
    if (date == null) return 0;
    final y = date['year'] as int? ?? 0;
    final m = date['month'] as int? ?? 0;
    final d = date['day'] as int? ?? 0;
    return y * 10000 + m * 100 + d;
  }

  RelatedMovie _normalizeAnilistRelatedMovie(Map<String, dynamic> node) {
    final titleObj = node['title'] as Map?;
    final title = titleObj?['english']?.toString() ??
        titleObj?['romaji']?.toString() ??
        titleObj?['native']?.toString() ??
        '';
    final startDate = node['startDate'] as Map?;
    final year = startDate?['year']?.toString() ?? '';
    final scoreRaw = node['averageScore'];
    final score = scoreRaw is num ? scoreRaw.toDouble() : null;
    return RelatedMovie(
      source: 'anilist',
      anilistId: node['id'] as int?,
      title: title,
      poster: node['coverImage']?['large']?.toString() ?? '',
      year: year,
      overview: _stripHtml(node['description']?.toString() ?? ''),
      runtimeMinutes: parsePositiveCount(node['duration']),
      score: score,
      genres: (node['genres'] as List?)
              ?.map((e) => e.toString().trim())
              .where((e) => e.isNotEmpty)
              .take(4)
              .toList() ??
          const [],
      contentType: 'anime',
      adult: node['isAdult'] == true,
      ageRating: node['isAdult'] == true ? 'R' : '',
      episodeCount: parsePositiveCount(node['episodes']),
      seasonCount: () {
        final format = node['format']?.toString().toUpperCase() ?? '';
        if (format == 'MOVIE' || format == 'SPECIAL') return null;
        return 1;
      }(),
    );
  }

  String _normalizeTvdbArtworkUrl(String? url) {
    final s = url?.trim() ?? '';
    if (s.isEmpty) return '';
    if (s.startsWith('http')) return s;
    if (s.startsWith('/')) return '$_tvdbArt$s';
    return s;
  }

  // ─────────────────────────────────────────────────────────────
  // Cache helpers
  // ─────────────────────────────────────────────────────────────

  /// Reads an entry only if it is within [ttl].
  Map<String, dynamic>? _readRawCache(String key, Duration ttl) {
    final raw = _cache.get(key);
    if (raw is! Map) return null;
    final map = Map<String, dynamic>.from(raw);
    final cachedAt = map['cachedAt'] as int?;
    if (cachedAt == null) return null;
    final age = DateTime.now().millisecondsSinceEpoch - cachedAt;
    if (age > ttl.inMilliseconds) return null;
    return map;
  }

  /// Reads an entry regardless of age (for offline stale fallback).
  Map<String, dynamic>? _readRawCacheStale(String key) {
    final raw = _cache.get(key);
    if (raw is! Map) return null;
    return Map<String, dynamic>.from(raw);
  }

  /// True when the cached entry has consumed more than [_staleRatio] of [ttl].
  bool _isStale(String key, Duration ttl) {
    final raw = _cache.get(key);
    if (raw is! Map) return false;
    final cachedAt = raw['cachedAt'] as int?;
    if (cachedAt == null) return false;
    final age = DateTime.now().millisecondsSinceEpoch - cachedAt;
    return age > ttl.inMilliseconds * _staleRatio;
  }

  void _writeRawCache(String key, Map<String, dynamic> data, Duration ttl) {
    _cache.put(key, {
      ...data,
      'cachedAt': DateTime.now().millisecondsSinceEpoch,
      'ttlMs': ttl.inMilliseconds,
    });
  }

  void _writeNegativeCache(String key, Duration ttl) {
    _cache.put(key, {
      'negative': true,
      'cachedAt': DateTime.now().millisecondsSinceEpoch,
      'ttlMs': ttl.inMilliseconds,
    });
  }

  bool _isNegativeCacheValid(String key) {
    final raw = _cache.get(key);
    if (raw is! Map) return false;
    final map = Map<String, dynamic>.from(raw);
    if (map['negative'] != true) return false;
    final cachedAt = map['cachedAt'] as int?;
    final ttlMs = map['ttlMs'] as int? ?? _negativeResolveTtl.inMilliseconds;
    if (cachedAt == null) return false;
    return DateTime.now().millisecondsSinceEpoch - cachedAt < ttlMs;
  }

  /// Reads existing title-level metadata that [MetadataService] wrote for this
  /// IMDb ID (v4 prefix, `omdb:` key).
  Map<String, dynamic>? _readV4OmdbCache(String imdbId) {
    final raw = _cache.get('${_v4Prefix}omdb:$imdbId');
    if (raw is Map) return Map<String, dynamic>.from(raw);
    return null;
  }

  // ─────────────────────────────────────────────────────────────
  // Cache serialization / deserialization
  // ─────────────────────────────────────────────────────────────

  Map<String, dynamic> _seriesResultToJson(SeriesMetadataResult result) => {
        'payload': {
          if (result.series != null) 'series': result.series!.toJson(),
          if (result.seasons != null)
            'seasons': result.seasons!.map((s) => s.toJson()).toList(),
        },
        'state': result.state.name,
      };

  Map<String, dynamic> _episodesResultToJson(SeasonEpisodesResult result) => {
        'payload': {
          if (result.episodes != null)
            'episodes': result.episodes!.map((e) => e.toJson()).toList(),
          if (result.seasonPoster != null) 'seasonPoster': result.seasonPoster,
          if (result.seasonOverview != null && result.seasonOverview!.isNotEmpty)
            'seasonOverview': result.seasonOverview,
          if (result.seasonRating != null) 'seasonRating': result.seasonRating,
          if (result.seasonRatingSource != null)
            'seasonRatingSource': result.seasonRatingSource,
        },
        'state': result.state.name,
      };

  SeriesMetadataResult _parseCachedSeriesResult(
    Map<String, dynamic> cached, {
    bool isStale = false,
    MetadataResultState? forceState,
  }) {
    final payload = cached['payload'];
    if (payload is! Map) {
      return const SeriesMetadataResult(state: MetadataResultState.unavailable);
    }

    final seriesRaw = payload['series'];
    final seasonsRaw = payload['seasons'];

    final series = seriesRaw is Map
        ? SeriesSummary.fromJson(Map<String, dynamic>.from(seriesRaw))
        : null;
    final seasons = seasonsRaw is List
        ? seasonsRaw
            .map((s) => SeasonSummary.fromJson(Map<String, dynamic>.from(s as Map)))
            .toList()
        : null;

    final stateStr = cached['state']?.toString();
    final parsedState = MetadataResultState.values.firstWhere(
      (s) => s.name == stateStr,
      orElse: () => MetadataResultState.available,
    );

    return SeriesMetadataResult(
      state: forceState ?? parsedState,
      series: series,
      seasons: seasons,
      isStale: isStale,
    );
  }

  SeasonEpisodesResult _parseCachedEpisodesResult(
    Map<String, dynamic> cached, {
    bool isStale = false,
    MetadataResultState? forceState,
  }) {
    final payload = cached['payload'];
    if (payload is! Map) {
      return const SeasonEpisodesResult(state: MetadataResultState.unavailable);
    }

    final episodesRaw = payload['episodes'];
    final episodes = episodesRaw is List
        ? episodesRaw
            .map((e) =>
                EpisodeDetail.fromJson(Map<String, dynamic>.from(e as Map)))
            .toList()
        : null;
    final seasonPoster = payload['seasonPoster']?.toString();
    final seasonOverview = payload['seasonOverview']?.toString();
    final seasonRating = _parseExternalRating(payload['seasonRating']);
    final seasonRatingSource = payload['seasonRatingSource']?.toString();

    final stateStr = cached['state']?.toString();
    final parsedState = MetadataResultState.values.firstWhere(
      (s) => s.name == stateStr,
      orElse: () => MetadataResultState.available,
    );

    return SeasonEpisodesResult(
      state: forceState ?? parsedState,
      episodes: episodes,
      seasonPoster: seasonPoster != null && seasonPoster.isNotEmpty
          ? seasonPoster
          : null,
      seasonOverview:
          seasonOverview != null && seasonOverview.isNotEmpty ? seasonOverview : null,
      seasonRating: seasonRating,
      seasonRatingSource: seasonRating != null
          ? (seasonRatingSource != null && seasonRatingSource.isNotEmpty
              ? seasonRatingSource
              : 'tmdb')
          : null,
      isStale: isStale,
    );
  }

  // ─────────────────────────────────────────────────────────────
  // Utility
  // ─────────────────────────────────────────────────────────────

  bool _hasRenderableEpisodes(SeasonEpisodesResult result) {
    final eps = result.episodes;
    if (eps == null || eps.isEmpty) return false;
    switch (result.state) {
      case MetadataResultState.available:
      case MetadataResultState.offlineWithCache:
      case MetadataResultState.partiallyAvailable:
      case MetadataResultState.episodeDetailsUnavailable:
        return true;
      default:
        return false;
    }
  }

  /// Clears cached episode lists so the next fetch hits the network.
  Future<void> invalidateSeasonEpisodesCache({
    required SeriesIdResolution resolution,
    required int seasonNumber,
    required String locale,
  }) async {
    if (resolution.anilistId != null) {
      await _cache.delete('metadata:v7:episodes:anilist:${resolution.anilistId}');
    }
    if (!_config.isSupabaseConfigured) return;
    final tvdbId = await _resolveTvdbId(resolution);
    if (tvdbId == null) return;
    for (final version in ['v14', 'v13']) {
      await _cache.delete(
        'metadata:$version:season:tvdb:$tvdbId:$seasonNumber:$locale',
      );
    }
  }

  /// Maps locale code to a TMDb `language` parameter.
  static String _tmdbLanguage(String locale) =>
      locale == 'ar' ? 'ar-SA' : 'en-US';

  static bool _isGenericEpisodeTitle(String? title, int epNum) {
    final text = title?.trim() ?? '';
    if (text.isEmpty) return true;
    if (RegExp(r'^episode \d+$', caseSensitive: false).hasMatch(text)) {
      return true;
    }
    if (RegExp('^الحلقة\\s*$epNum\$').hasMatch(text)) return true;
    return false;
  }

  static String _pickLocalizedEpisodeTitle(
    String? localTitle,
    String? enTitle,
    int epNum,
  ) {
    final local = localTitle?.trim() ?? '';
    final en = enTitle?.trim() ?? '';
    if (local.isNotEmpty && !_isGenericEpisodeTitle(local, epNum)) return local;
    if (en.isNotEmpty) return en;
    if (local.isNotEmpty) return local;
    return 'Episode $epNum';
  }

  static String _pickLocalizedOverview(String? localText, String? enText) {
    final local = localText?.trim() ?? '';
    final en = enText?.trim() ?? '';
    return local.isNotEmpty ? local : en;
  }

  static SeasonEpisodesResult _mergeEpisodeLocaleResults(
    SeasonEpisodesResult localResult,
    SeasonEpisodesResult enResult,
  ) {
    final localEps = localResult.episodes ?? const [];
    final enEps = enResult.episodes ?? const [];
    if (localEps.isEmpty) return enResult;
    if (enEps.isEmpty) return localResult;

    final enByKey = {
      for (final ep in enEps) ep.progressKey: ep,
    };

    final merged = localEps.map((ep) {
      final enEp = enByKey[ep.progressKey];
      if (enEp == null) return ep;
      return EpisodeDetail(
        source: ep.source,
        seriesTmdbId: ep.seriesTmdbId,
        seasonNumber: ep.seasonNumber,
        episodeNumber: ep.episodeNumber,
        title: _pickLocalizedEpisodeTitle(ep.title, enEp.title, ep.episodeNumber),
        still: ep.still.isNotEmpty ? ep.still : enEp.still,
        overview: _pickLocalizedOverview(ep.overview, enEp.overview),
        runtimeMinutes: ep.runtimeMinutes ?? enEp.runtimeMinutes,
        airDate: ep.airDate ?? enEp.airDate,
        isAired: ep.isAired,
        episodeRating: ep.episodeRating ?? enEp.episodeRating,
        episodeRatingSource: ep.episodeRatingSource ?? enEp.episodeRatingSource,
      );
    }).toList();

    final seasonRating =
        localResult.seasonRating ?? enResult.seasonRating;

    return SeasonEpisodesResult(
      state: localResult.state,
      episodes: merged,
      seasonPoster: localResult.seasonPoster ?? enResult.seasonPoster,
      seasonOverview: localResult.seasonOverview ?? enResult.seasonOverview,
      seasonRating: seasonRating,
      seasonRatingSource: seasonRating != null
          ? (localResult.seasonRatingSource ??
              enResult.seasonRatingSource ??
              'tmdb')
          : null,
    );
  }

  static double? _parseExternalRating(dynamic raw) {
    final n = raw is num ? raw.toDouble() : double.tryParse('$raw');
    if (n == null || !n.isFinite || n <= 0 || n > 10) return null;
    return (n * 10).round() / 10;
  }

  /// True when [airDate] is in the past (or absent, assumed aired).
  static bool _isAired(String? airDate) {
    if (airDate == null || airDate.isEmpty) return true;
    try {
      return DateTime.parse(airDate).isBefore(DateTime.now());
    } catch (_) {
      return true;
    }
  }

  static double? _parseOmdbEpisodeRating(String? raw) {
    if (raw == null) return null;
    final text = raw.trim();
    if (text.isEmpty || text.toUpperCase() == 'N/A') return null;
    final n = double.tryParse(text.replaceAll(',', '.'));
    if (n == null || !n.isFinite || n <= 0 || n > 10) return null;
    return (n * 10).round() / 10;
  }

  static String? _anilistDateStr(Map? dateMap) {
    if (dateMap == null) return null;
    final year = dateMap['year'];
    if (year == null) return null;
    final month = dateMap['month'];
    final day = dateMap['day'];
    if (month == null) return '$year';
    if (day == null) return '$year-${_pad(month)}';
    return '$year-${_pad(month)}-${_pad(day)}';
  }

  static String _pad(dynamic value) =>
      value.toString().padLeft(2, '0');

  static String _stripHtml(String html) => html
      .replaceAll(RegExp(r'<br\s*/?>', caseSensitive: false), '\n')
      .replaceAll(RegExp(r'<[^>]+>'), '')
      .replaceAll('&nbsp;', ' ')
      .replaceAll('&amp;', '&')
      .replaceAll('&quot;', '"')
      .trim();

  static String _na(String? value) {
    final text = value ?? '';
    return text == 'N/A' ? '' : text;
  }
}
