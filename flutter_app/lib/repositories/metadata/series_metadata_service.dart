import 'dart:convert';
import 'dart:io';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:hive_flutter/hive_flutter.dart';
import 'package:http/http.dart' as http;

import '../../core/config/app_config.dart';
import '../../core/config/environment.dart';
import '../../core/storage/hive_boxes.dart';
import '../../core/utils/title_meta_format.dart' show parsePositiveCount;
import '../../models/series_metadata.dart';
import '../../models/watchlist_item.dart';
import 'metadata_service.dart' show MetadataService;

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
/// Source priority:
///   TV series: TMDb → OMDb fallback
///   Anime:     TMDb → AniList → OMDb fallback → synthetic Season 1
///   Movies:    not supported (returns [MetadataResultState.invalidId])
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

    // ── AniList ──────────────────────────────────────────────
    final anilistId = MetadataService.parseAnilistId(link);
    if (anilistId != null) {
      return SeriesIdResolution.anilist(anilistId);
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

  /// Fetches the series summary and season list.
  ///
  /// Never fetches per-episode data; call [fetchSeasonEpisodes] for that.
  Future<SeriesMetadataResult> fetchSeriesMetadata({
    required SeriesIdResolution resolution,
    required String locale,
    String? fallbackPoster,
  }) async {
    if (!resolution.hasUsableSource) {
      return const SeriesMetadataResult(state: MetadataResultState.invalidId);
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

  /// Fetches episodes for a single season.
  ///
  /// Only called when the user opens a season in the detail view.
  Future<SeasonEpisodesResult> fetchSeasonEpisodes({
    required SeriesIdResolution resolution,
    required int seasonNumber,
    required String locale,
    String? fallbackPoster,
    SeasonSummary? seasonSummary,
  }) async {
    if (!resolution.hasUsableSource) {
      return const SeasonEpisodesResult(state: MetadataResultState.invalidId);
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
      case 'anilist':
        return _fetchAnilistEpisodes(
          resolution.anilistId!,
          seasonNumber,
          fallbackPoster: fallbackPoster,
        );
      case 'omdb':
        return _fetchOmdbSeasonEpisodes(resolution.imdbId!, seasonNumber);
      default:
        return const SeasonEpisodesResult(state: MetadataResultState.unavailable);
    }
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
    final cacheKey = '${_v5Prefix}season:tmdb:$tmdbId:$season:$locale';

    final cached = _readRawCache(cacheKey, _episodesTtl);
    if (cached != null) {
      return _parseCachedEpisodesResult(
        cached,
        isStale: _isStale(cacheKey, _episodesTtl),
      );
    }

    final json = await _fetchTmdb('tv/$tmdbId/season/$season', {'language': lang});

    if (json != null) {
      final result = _normalizeTmdbSeasonEpisodes(
        json,
        tmdbId,
        season,
        fallbackPoster: fallbackPoster,
      );
      _writeRawCache(cacheKey, _episodesResultToJson(result), _episodesTtl);
      return result;
    }

    // Fallback to English when localized fetch failed.
    if (locale != 'en') {
      final enKey = '${_v5Prefix}season:tmdb:$tmdbId:$season:en';
      final enCached = _readRawCache(enKey, _episodesTtl);
      if (enCached != null) {
        return _parseCachedEpisodesResult(enCached, isStale: true);
      }
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
        _writeRawCache(enKey, _episodesResultToJson(enResult), _episodesTtl);
        return enResult;
      }
    }

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

    return SeasonEpisodesResult(
      state: episodes.isEmpty
          ? MetadataResultState.noSeasons
          : MetadataResultState.available,
      episodes: episodes,
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
    );
  }

  // ─────────────────────────────────────────────────────────────
  // AniList series
  // ─────────────────────────────────────────────────────────────

  Future<SeriesMetadataResult> _fetchAnilistSeriesMetadata(
    int anilistId,
    String locale, {
    String? fallbackPoster,
  }) async {
    final cacheKey = '${_v5Prefix}series:anilist:$anilistId:$locale';

    final cached = _readRawCache(cacheKey, _seriesTtl);
    if (cached != null) {
      return _parseCachedSeriesResult(
        cached,
        isStale: _isStale(cacheKey, _seriesTtl),
      );
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
  }) async {
    if (seasonNumber != 1) {
      // AniList only models a single synthetic season.
      return const SeasonEpisodesResult(state: MetadataResultState.unavailable);
    }

    final cacheKey = '${_v5Prefix}episodes:anilist:$anilistId';
    final cached = _readRawCache(cacheKey, _episodesTtl);
    if (cached != null) {
      return _parseCachedEpisodesResult(
        cached,
        isStale: _isStale(cacheKey, _episodesTtl),
      );
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
        return _parseCachedEpisodesResult(
          stale,
          isStale: true,
          forceState: MetadataResultState.offlineWithCache,
        );
      }
      return const SeasonEpisodesResult(state: MetadataResultState.offlineNoCache);
    }

    final episodeCount = parsePositiveCount(media['episodes']);
    final streamingEps = (media['streamingEpisodes'] as List? ?? [])
        .cast<Map<String, dynamic>>();
    final poster =
        media['coverImage']?['large']?.toString() ?? fallbackPoster ?? '';

    List<EpisodeDetail> episodes;
    MetadataResultState state;

    if (streamingEps.isNotEmpty) {
      // streamingEpisodes is incomplete and unordered; treat as best-effort.
      episodes = _normalizeAnilistStreamingEpisodes(streamingEps, anilistId, poster);
      state = MetadataResultState.partiallyAvailable;
    } else if (episodeCount != null) {
      // Only count known — generate synthetic stubs.
      episodes = List.generate(
        episodeCount,
        (i) => EpisodeDetail(
          source: 'anilist',
          seasonNumber: 1,
          episodeNumber: i + 1,
          title: 'Episode ${i + 1}',
          still: poster,
          isAired: true,
        ),
      );
      state = MetadataResultState.episodeDetailsUnavailable;
    } else {
      return const SeasonEpisodesResult(
        state: MetadataResultState.episodeDetailsUnavailable,
      );
    }

    final result = SeasonEpisodesResult(state: state, episodes: episodes);
    _writeRawCache(cacheKey, _episodesResultToJson(result), _episodesTtl);
    return result;
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
    if (!_config.hasTmdbKey) return null;
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

  Future<int?> _resolveTmdbIdByImdb(String imdbId) async {
    if (!_config.hasTmdbKey) return null;
    final json =
        await _fetchTmdb('find/$imdbId', {'external_source': 'imdb_id'});
    if (json == null) return null;

    final tvResults =
        (json['tv_results'] as List?)?.cast<Map<String, dynamic>>() ?? [];
    if (tvResults.isNotEmpty) return tvResults.first['id'] as int?;

    // Movie results → not a TV series.
    return null;
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

    final stateStr = cached['state']?.toString();
    final parsedState = MetadataResultState.values.firstWhere(
      (s) => s.name == stateStr,
      orElse: () => MetadataResultState.available,
    );

    return SeasonEpisodesResult(
      state: forceState ?? parsedState,
      episodes: episodes,
      isStale: isStale,
    );
  }

  // ─────────────────────────────────────────────────────────────
  // Utility
  // ─────────────────────────────────────────────────────────────

  /// Maps locale code to a TMDb `language` parameter.
  static String _tmdbLanguage(String locale) =>
      locale == 'ar' ? 'ar-SA' : 'en-US';

  /// True when [airDate] is in the past (or absent, assumed aired).
  static bool _isAired(String? airDate) {
    if (airDate == null || airDate.isEmpty) return true;
    try {
      return DateTime.parse(airDate).isBefore(DateTime.now());
    } catch (_) {
      return true;
    }
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
