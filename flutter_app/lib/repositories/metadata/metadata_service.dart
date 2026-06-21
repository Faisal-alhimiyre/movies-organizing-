import 'dart:convert';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:hive_flutter/hive_flutter.dart';
import 'package:http/http.dart' as http;

import '../../core/config/app_config.dart';
import '../../core/config/environment.dart';
import '../../core/storage/hive_boxes.dart';
import '../../models/metadata_detail.dart';
import '../../models/title_search_result.dart';
import 'genre_mapper.dart';
import '../../core/utils/title_meta_format.dart';

const _anilistApi = 'https://graphql.anilist.co';
const _tmdbImage = 'https://image.tmdb.org/t/p/w500';
const _tmdbImageSm = 'https://image.tmdb.org/t/p/w92';
const _cachePrefix = 'metadata:v4:';

final metadataServiceProvider = Provider<MetadataService>((ref) {
  return MetadataService(
    config: ref.watch(appConfigProvider),
    cache: HiveBoxes.metadataCache,
  );
});

class MetadataService {
  MetadataService({
    required AppConfig config,
    required Box<dynamic> cache,
    http.Client? client,
  })  : _config = config,
        _cache = cache,
        _client = client ?? http.Client();

  final AppConfig _config;
  final Box<dynamic> _cache;
  final http.Client _client;

  bool get hasSearchConfigured =>
      _config.hasOmdbKey || _config.hasTmdbKey || true;

  void dispose() => _client.close();

  Future<TitleSearchResponse> searchTitles(
    String query, {
    String type = 'all',
    int page = 1,
  }) async {
    final q = query.trim();
    if (q.length < 2) {
      return const TitleSearchResponse(ok: true, results: []);
    }
    if (!hasSearchConfigured) {
      return const TitleSearchResponse(
        ok: false,
        error: 'search.notConfigured',
      );
    }

    final tasks = <Future<List<TitleSearchResult>>>[];
    if (type == 'anime') {
      tasks.add(_searchAnilist(q, page));
    } else {
      if (_config.hasOmdbKey) {
        tasks.add(_searchOmdb(q, type: type, page: page));
      }
      if (_config.hasTmdbKey) {
        final tmdbType = type == 'series'
            ? 'series'
            : type == 'movie'
                ? 'movie'
                : 'all';
        tasks.add(_searchTmdb(q, tmdbType, page));
      }
      if (type == 'all') {
        tasks.add(_searchAnilist(q, page));
      }
    }

    final lists = await Future.wait(tasks);
    final results = _mergeSearchResults(lists);
    return TitleSearchResponse(
      ok: true,
      results: results,
      message: results.isEmpty ? 'search.noMatches' : null,
    );
  }

  Future<MetadataDetail?> getDetailsForPick(TitleSearchResult pick) async {
    if (pick.anilistId != null) {
      return fetchAnilistById(pick.anilistId!);
    }
    if (pick.tmdbType != null && pick.tmdbId != null) {
      return fetchTmdbDetails(pick.tmdbType!, pick.tmdbId!);
    }
    if (pick.imdbId != null) {
      return getMetadata(pick.imdbId!);
    }
    return null;
  }

  Future<MetadataDetail?> resolveMetadataFromLink(
    String url, {
    bool requirePoster = false,
    bool forceRefresh = false,
  }) async {
    final value = url.trim();
    if (value.isEmpty) return null;

    final imdbId = extractImdbId(value);
    if (imdbId != null) {
      final data = await getMetadata(
        imdbId,
        requirePoster: requirePoster,
        forceRefresh: forceRefresh,
      );
      if (data != null) return data;
    }

    final anilistId = parseAnilistId(value);
    if (anilistId != null) {
      return fetchAnilistById(anilistId, requirePoster: requirePoster);
    }

    final malId = parseMalId(value);
    if (malId != null) {
      return fetchAnilistByMalId(malId, requirePoster: requirePoster);
    }

    return null;
  }

  Future<MetadataDetail?> getMetadata(
    String imdbId, {
    bool requirePoster = false,
    bool forceRefresh = false,
  }) async {
    final id = imdbId.toLowerCase();
    final cacheKey = 'omdb:$id';
    if (!forceRefresh) {
      final cached = _readCached(cacheKey, requirePoster: requirePoster);
      if (cached != null && _cachedHasTitleMeta(cached)) return cached;
    }

    var data = await _fetchFromOmdb(id);
    if (data == null && _config.hasTmdbKey) {
      data = await _fetchTmdbByImdbId(id);
    }
    if (data != null) _writeCache(cacheKey, data);
    return data;
  }

  Future<MetadataDetail?> fetchAnilistById(
    int anilistId, {
    bool requirePoster = false,
  }) async {
    final cacheKey = 'anilist:$anilistId';
    final cached = _readCached(cacheKey, requirePoster: requirePoster);
    if (cached != null) return cached;

    final data = await _anilistQuery(
      r'''
      query ($id: Int) {
        Media(id: $id, type: ANIME) {
          id
          format
          title { english romaji native }
          averageScore
          startDate { year }
          description
          genres
          coverImage { large }
          episodes
          duration
          isAdult
          characters(perPage: 6, sort: ROLE) {
            nodes {
              name { full }
              voiceActors(language: JAPANESE, sort: RELEVANCE) { name { full } }
            }
          }
        }
      }
      ''',
      {'id': anilistId},
    );

    final payload =
        _normalizeAnilistMedia(data?['Media'] as Map<String, dynamic>?);
    if (payload != null) _writeCache(cacheKey, payload);
    return payload;
  }

  Future<MetadataDetail?> fetchAnilistByMalId(
    int malId, {
    bool requirePoster = false,
  }) async {
    final cacheKey = 'mal:$malId';
    final cached = _readCached(cacheKey, requirePoster: requirePoster);
    if (cached != null) return cached;

    final data = await _anilistQuery(
      r'''
      query ($malId: Int) {
        Media(idMal: $malId, type: ANIME) {
          id
          format
          title { english romaji native }
          averageScore
          startDate { year }
          description
          genres
          coverImage { large }
          episodes
          duration
          isAdult
          characters(perPage: 6, sort: ROLE) {
            nodes {
              name { full }
              voiceActors(language: JAPANESE, sort: RELEVANCE) { name { full } }
            }
          }
        }
      }
      ''',
      {'malId': malId},
    );

    final payload =
        _normalizeAnilistMedia(data?['Media'] as Map<String, dynamic>?);
    if (payload != null) _writeCache(cacheKey, payload);
    return payload;
  }

  Future<MetadataDetail?> fetchTmdbDetails(String mediaType, int tmdbId) async {
    final cacheKey = 'tmdb:$mediaType:$tmdbId';
    final cached = _readCached(cacheKey);
    if (cached != null) return cached;

    final json = await _fetchTmdb('$mediaType/$tmdbId', {
      'append_to_response': mediaType == 'tv'
          ? 'credits,content_ratings'
          : 'credits,release_dates',
    });
    final payload = _normalizeTmdbDetail(json, mediaType);
    if (payload != null) _writeCache(cacheKey, payload);
    return payload;
  }

  static String? extractImdbId(String url) {
    final match = RegExp(r'tt\d{7,8}', caseSensitive: false).firstMatch(url);
    return match?.group(0)?.toLowerCase();
  }

  static bool isAnilistLink(String url) => parseAnilistId(url) != null;

  static bool isMalLink(String url) => parseMalId(url) != null;

  static bool isSupportedLink(String url) {
    final value = url.trim();
    if (value.isEmpty) return false;
    return extractImdbId(value) != null ||
        isAnilistLink(value) ||
        isMalLink(value);
  }

  static String? normalizeLink(String raw) {
    final trimmed = raw.trim();
    if (trimmed.isEmpty) return null;
    return trimmed.startsWith('http') ? trimmed : 'https://$trimmed';
  }

  static int? parseAnilistId(String url) {
    try {
      final uri = Uri.parse(url);
      if (!uri.host.replaceFirst('www.', '').contains('anilist.co'))
        return null;
      final parts = uri.pathSegments.where((p) => p.isNotEmpty).toList();
      if (parts.isNotEmpty && parts[0] == 'anime' && parts.length > 1) {
        return int.tryParse(parts[1]);
      }
    } catch (_) {}
    return null;
  }

  static int? parseMalId(String url) {
    try {
      final uri = Uri.parse(url);
      if (!uri.host.replaceFirst('www.', '').contains('myanimelist.net')) {
        return null;
      }
      final parts = uri.pathSegments.where((p) => p.isNotEmpty).toList();
      if (parts.isNotEmpty && parts[0] == 'anime' && parts.length > 1) {
        return int.tryParse(parts[1]);
      }
    } catch (_) {}
    return null;
  }

  /// Lightweight AniList title match for year/rating backfill.
  Future<({String year, String anilistRating})?> fetchAnilistMatchByTitle(
    String title,
    int? year,
  ) async {
    final query = title.trim();
    if (query.length < 2) return null;

    final data = await _anilistQuery(
      r'''
      query ($search: String) {
        Page(page: 1, perPage: 8) {
          media(search: $search, type: ANIME, sort: SEARCH_MATCH) {
            id
            title { english romaji }
            averageScore
            startDate { year }
          }
        }
      }
      ''',
      {'search': query},
    );

    final media = data?['Page']?['media'] as List? ?? [];
    if (media.isEmpty) return null;

    final results = media.map((raw) {
      final entry = raw as Map<String, dynamic>;
      final titles = entry['title'] as Map<String, dynamic>?;
      return (
        title: titles?['english']?.toString() ??
            titles?['romaji']?.toString() ??
            '',
        year: (entry['startDate'] as Map?)?['year']?.toString() ?? '',
        averageScore: entry['averageScore'],
      );
    }).toList();

    var match = _pickBestSearchMatch(results, query);
    if (year != null) {
      final yearStr = year.toString();
      final yearMatch =
          results.where((entry) => entry.year == yearStr).firstOrNull;
      if (yearMatch != null) match = yearMatch;
    }

    if (match == null) return null;

    final rating = match.averageScore;
    return (
      year: match.year,
      anilistRating: rating == null ? '' : rating.toString(),
    );
  }

  static ({String title, String year, dynamic averageScore})?
      _pickBestSearchMatch(
    List<({String title, String year, dynamic averageScore})> results,
    String query,
  ) {
    if (results.isEmpty) return null;
    final key = _normalizeTitleKey(query);
    if (key.isEmpty) return results.first;

    ({String title, String year, dynamic averageScore})? best = results.first;
    var bestScore = -1;

    for (final result in results) {
      final titleKey = _normalizeTitleKey(result.title);
      var score = 0;
      if (titleKey == key) {
        score = 100;
      } else if (titleKey.contains(key) || key.contains(titleKey)) {
        score = 50;
      } else {
        final words = key.split(' ').where((word) => word.length > 2);
        score = words.where((word) => titleKey.contains(word)).length * 10;
      }
      if (score > bestScore) {
        bestScore = score;
        best = result;
      }
    }

    return best;
  }

  static String _normalizeTitleKey(String title) {
    return title.toLowerCase().replaceAll(RegExp(r'[^a-z0-9]+'), ' ').trim();
  }

  Future<List<TitleSearchResult>> _searchOmdb(
    String query, {
    required String type,
    required int page,
  }) async {
    final params = <String, String>{
      's': query,
      'apikey': _config.omdbApiKey,
      'page': '$page',
    };
    if (type != 'all') params['type'] = type;

    final uri = Uri.https('www.omdbapi.com', '/', params);
    final response = await _client.get(uri);
    if (response.statusCode != 200) return [];

    final json = jsonDecode(response.body) as Map<String, dynamic>;
    if (json['Response'] != 'True') return [];

    final search = json['Search'] as List? ?? [];
    return search
        .map((raw) => _normalizeOmdbSearchResult(raw as Map<String, dynamic>))
        .whereType<TitleSearchResult>()
        .toList();
  }

  Future<List<TitleSearchResult>> _searchTmdb(
    String query,
    String type,
    int page,
  ) async {
    final results = <TitleSearchResult>[];

    if (type == 'all' || type == 'movie') {
      final movies =
          await _fetchTmdb('search/movie', {'query': query, 'page': '$page'});
      for (final item in movies?['results'] as List? ?? []) {
        final map = item as Map<String, dynamic>;
        results.add(
          TitleSearchResult(
            source: 'tmdb',
            tmdbType: 'movie',
            tmdbId: map['id'] as int?,
            title: map['title']?.toString() ?? '',
            year: (map['release_date']?.toString() ?? '').length >= 4
                ? map['release_date'].toString().substring(0, 4)
                : '',
            type: 'movie',
            poster: map['poster_path'] != null
                ? '$_tmdbImageSm${map['poster_path']}'
                : '',
          ),
        );
      }
    }

    if (type == 'all' || type == 'series') {
      final shows =
          await _fetchTmdb('search/tv', {'query': query, 'page': '$page'});
      for (final item in shows?['results'] as List? ?? []) {
        final map = item as Map<String, dynamic>;
        results.add(
          TitleSearchResult(
            source: 'tmdb',
            tmdbType: 'tv',
            tmdbId: map['id'] as int?,
            title: map['name']?.toString() ?? '',
            year: (map['first_air_date']?.toString() ?? '').length >= 4
                ? map['first_air_date'].toString().substring(0, 4)
                : '',
            type: 'series',
            poster: map['poster_path'] != null
                ? '$_tmdbImageSm${map['poster_path']}'
                : '',
          ),
        );
      }
    }

    return results;
  }

  Future<List<TitleSearchResult>> _searchAnilist(String query, int page) async {
    final data = await _anilistQuery(
      r'''
      query ($search: String, $page: Int) {
        Page(page: $page, perPage: 10) {
          media(search: $search, type: ANIME, sort: SEARCH_MATCH) {
            id
            format
            title { romaji english }
            startDate { year }
            coverImage { large }
          }
        }
      }
      ''',
      {'search': query, 'page': page},
    );

    final media = data?['Page']?['media'] as List? ?? [];
    return media.map((raw) {
      final item = raw as Map<String, dynamic>;
      final format = item['format']?.toString().toUpperCase() ?? '';
      return TitleSearchResult(
        source: 'anilist',
        anilistId: item['id'] as int?,
        title: item['title']?['english']?.toString() ??
            item['title']?['romaji']?.toString() ??
            '',
        year: item['startDate']?['year']?.toString() ?? '',
        type: format == 'MOVIE' || format == 'ONE_SHOT' ? 'anime' : 'anime',
        poster: item['coverImage']?['large']?.toString() ?? '',
      );
    }).toList();
  }

  Future<MetadataDetail?> _fetchFromOmdb(String imdbId) async {
    final uri = Uri.https('www.omdbapi.com', '/', {
      'i': imdbId,
      'plot': 'short',
      'apikey': _config.omdbApiKey,
    });
    final response = await _client.get(uri);
    if (response.statusCode != 200) return null;
    final json = jsonDecode(response.body) as Map<String, dynamic>;
    return _normalizeFullOmdbPayload(imdbId, json);
  }

  Future<MetadataDetail?> _fetchTmdbByImdbId(String imdbId) async {
    final json =
        await _fetchTmdb('find/$imdbId', {'external_source': 'imdb_id'});
    if (json == null) return null;

    final movie =
        (json['movie_results'] as List?)?.cast<Map<String, dynamic>>();
    if (movie != null && movie.isNotEmpty) {
      final payload = await fetchTmdbDetails('movie', movie.first['id'] as int);
      if (payload == null) return null;
      return MetadataDetail(
        source: payload.source,
        title: payload.title,
        imdbId: imdbId,
        tmdbType: payload.tmdbType,
        tmdbId: payload.tmdbId,
        link: payload.link,
        poster: payload.poster,
        rating: payload.rating,
        anilistRating: payload.anilistRating,
        year: payload.year,
        plot: payload.plot,
        runtime: payload.runtime,
        ageRating: payload.ageRating,
        seasonCount: payload.seasonCount,
        episodeCount: payload.episodeCount,
        director: payload.director,
        actors: payload.actors,
        genres: payload.genres,
        contentType: payload.contentType,
      );
    }

    final show = (json['tv_results'] as List?)?.cast<Map<String, dynamic>>();
    if (show != null && show.isNotEmpty) {
      final payload = await fetchTmdbDetails('tv', show.first['id'] as int);
      if (payload == null) return null;
      return MetadataDetail(
        source: payload.source,
        title: payload.title,
        imdbId: imdbId,
        tmdbType: payload.tmdbType,
        tmdbId: payload.tmdbId,
        link: payload.link,
        poster: payload.poster,
        rating: payload.rating,
        anilistRating: payload.anilistRating,
        year: payload.year,
        plot: payload.plot,
        runtime: payload.runtime,
        ageRating: payload.ageRating,
        seasonCount: payload.seasonCount,
        episodeCount: payload.episodeCount,
        director: payload.director,
        actors: payload.actors,
        genres: payload.genres,
        contentType: payload.contentType,
      );
    }

    return null;
  }

  Future<Map<String, dynamic>?> _fetchTmdb(
    String path,
    Map<String, String> params,
  ) async {
    if (!_config.hasTmdbKey) return null;
    final query = {...params, 'api_key': _config.tmdbApiKey};
    final uri = Uri.https('api.themoviedb.org', '/3/$path', query);
    final response = await _client.get(uri);
    if (response.statusCode != 200) return null;
    return jsonDecode(response.body) as Map<String, dynamic>;
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
    } catch (_) {
      return null;
    }
  }

  TitleSearchResult? _normalizeOmdbSearchResult(Map<String, dynamic> item) {
    final imdbId = item['imdbID']?.toString();
    if (imdbId == null || imdbId.isEmpty) return null;
    final poster = item['Poster']?.toString() ?? '';
    return TitleSearchResult(
      source: 'omdb',
      imdbId: imdbId.toLowerCase(),
      title: item['Title']?.toString() ?? '',
      year: item['Year']?.toString() ?? '',
      type: item['Type']?.toString() ?? '',
      poster: poster != 'N/A' ? poster : '',
    );
  }

  MetadataDetail? _normalizeFullOmdbPayload(
    String imdbId,
    Map<String, dynamic> json,
  ) {
    if (json['Response'] != 'True') return null;

    final actors = _parseActorList(json['Actors']?.toString());
    final genres = parseGenreList(json['Genre']);
    final director = json['Director']?.toString();
    final omdbType = json['Type']?.toString() ?? '';

    return _buildDetailPayload(
      source: 'omdb',
      imdbId: imdbId,
      title: _na(json['Title']),
      year: _na(json['Year']),
      plot: _na(json['Plot']),
      poster: _na(json['Poster']),
      rating: _na(json['imdbRating']),
      runtime: _na(json['Runtime']),
      ageRating: _na(json['Rated']),
      seasonCount: json['Type']?.toString() == 'series'
          ? parsePositiveCount(json['totalSeasons'])
          : null,
      actors: actors,
      genres: genres,
      director: director != null && director != 'N/A' ? director : '',
      mediaType: omdbType != 'N/A' ? omdbType : '',
      omdbType: omdbType != 'N/A' ? omdbType : '',
    );
  }

  MetadataDetail? _normalizeTmdbDetail(
    Map<String, dynamic>? item,
    String mediaType,
  ) {
    if (item == null) return null;

    final title = item['title']?.toString() ?? item['name']?.toString() ?? '';
    final date = item['release_date']?.toString() ??
        item['first_air_date']?.toString() ??
        '';
    final year = date.length >= 4 ? date.substring(0, 4) : '';
    final genres = (item['genres'] as List?)
            ?.map((g) => (g as Map)['name']?.toString() ?? '')
            .where((g) => g.isNotEmpty)
            .toList() ??
        const [];
    final actors = (item['credits']?['cast'] as List?)
            ?.take(6)
            .map((person) => (person as Map)['name']?.toString() ?? '')
            .where((name) => name.isNotEmpty)
            .toList() ??
        const <String>[];
    final vote = item['vote_average'];
    final rating = vote != null && vote is num && vote.isFinite
        ? vote.toDouble().toStringAsFixed(1)
        : '';

    return _buildDetailPayload(
      source: 'tmdb',
      imdbId: item['imdb_id']?.toString(),
      tmdbType: mediaType,
      tmdbId: item['id'] as int?,
      title: title,
      year: year,
      plot: item['overview']?.toString() ?? '',
      poster: item['poster_path'] != null
          ? '$_tmdbImage${item['poster_path']}'
          : '',
      rating: rating,
      actors: actors,
      genres: genres,
      mediaType: mediaType == 'tv' ? 'series' : 'movie',
      omdbType: mediaType == 'tv' ? 'series' : 'movie',
      ageRating: _pickTmdbAgeRating(item, mediaType),
      runtime: _pickTmdbRuntime(item, mediaType),
      seasonCount: mediaType == 'tv'
          ? parsePositiveCount(item['number_of_seasons'])
          : null,
      episodeCount: mediaType == 'tv'
          ? parsePositiveCount(item['number_of_episodes'])
          : null,
    );
  }

  MetadataDetail? _normalizeAnilistMedia(Map<String, dynamic>? media) {
    if (media == null) return null;

    final title = media['title']?['english']?.toString() ??
        media['title']?['romaji']?.toString() ??
        media['title']?['native']?.toString() ??
        '';

    final leads = <String>[];
    for (final node in media['characters']?['nodes'] as List? ?? []) {
      final map = node as Map<String, dynamic>;
      final va = (map['voiceActors'] as List?)?.cast<Map<String, dynamic>>();
      final voiceMap = va?.isNotEmpty == true ? va!.first['name'] : null;
      final voice = voiceMap is Map ? voiceMap['full']?.toString() : null;
      if (voice != null && voice.isNotEmpty) {
        leads.add(voice);
      } else {
        final name = map['name']?['full']?.toString();
        if (name != null && name.isNotEmpty) leads.add(name);
      }
      if (leads.length >= 4) break;
    }

    final format = media['format']?.toString().toUpperCase() ?? '';
    final mediaType =
        format == 'MOVIE' || format == 'ONE_SHOT' ? 'movie' : 'anime';
    final score = media['averageScore'];

    return _buildDetailPayload(
      source: 'anilist',
      anilistId: media['id'] as int?,
      link: 'https://anilist.co/anime/${media['id']}/',
      title: title,
      year: media['startDate']?['year']?.toString() ?? '',
      plot: _stripHtml(media['description']?.toString() ?? ''),
      poster: media['coverImage']?['large']?.toString() ?? '',
      anilistRating: score != null ? score.toString() : '',
      actors: leads,
      genres: (media['genres'] as List?)?.map((e) => e.toString()).toList() ??
          const [],
      mediaType: mediaType,
      ageRating: media['isAdult'] == true ? '18+' : '',
      runtime: formatRuntimeMinutes(parsePositiveCount(media['duration'])),
      episodeCount: parsePositiveCount(media['episodes']),
    );
  }

  MetadataDetail _buildDetailPayload({
    required String source,
    String? imdbId,
    int? anilistId,
    String? tmdbType,
    int? tmdbId,
    String link = '',
    required String title,
    String year = '',
    String plot = '',
    String poster = '',
    String rating = '',
    String anilistRating = '',
    String runtime = '',
    String ageRating = '',
    int? seasonCount,
    int? episodeCount,
    List<String> actors = const [],
    List<String> genres = const [],
    String director = '',
    String mediaType = '',
    String omdbType = '',
  }) {
    final genreList = parseGenreList(genres);
    final contentType = inferContentType(
        mediaType.isNotEmpty ? mediaType : omdbType, genreList);
    final resolvedLink = link.isNotEmpty
        ? link
        : defaultLinkForDetails(
            MetadataDetail(
              source: source,
              title: title,
              imdbId: imdbId,
              anilistId: anilistId,
              link: link,
            ),
          );

    return MetadataDetail(
      source: source,
      title: title,
      imdbId: imdbId,
      anilistId: anilistId,
      tmdbType: tmdbType,
      tmdbId: tmdbId,
      link: resolvedLink,
      poster: poster,
      rating: rating,
      anilistRating: anilistRating,
      year: year,
      plot: plot,
      runtime: runtime,
      ageRating: ageRating,
      seasonCount: seasonCount,
      episodeCount: episodeCount,
      director: director,
      actors: actors,
      genres: genreList,
      contentType: contentType,
    );
  }

  List<TitleSearchResult> _mergeSearchResults(
      List<List<TitleSearchResult>> lists) {
    final merged = <TitleSearchResult>[];
    final seen = <String>{};

    for (final list in lists) {
      for (final result in list) {
        if (result.title.trim().isEmpty) continue;
        final key = result.dedupeKey();
        if (seen.contains(key)) continue;
        seen.add(key);
        merged.add(
          TitleSearchResult(
            source: result.source,
            title: result.title,
            imdbId: result.imdbId,
            anilistId: result.anilistId,
            tmdbType: result.tmdbType,
            tmdbId: result.tmdbId,
            year: result.year,
            type: result.type,
            poster: result.poster,
            resultKey: key,
          ),
        );
      }
    }

    return merged;
  }

  MetadataDetail? _readCached(String key, {bool requirePoster = false}) {
    final raw = _cache.get('$_cachePrefix$key');
    if (raw is Map) {
      final detail =
          MetadataDetail.fromCacheJson(Map<String, dynamic>.from(raw));
      if (requirePoster && !_hasUsablePoster(detail)) return null;
      return detail;
    }
    return null;
  }

  static bool _hasUsablePoster(MetadataDetail detail) {
    final poster = detail.poster.trim();
    return poster.isNotEmpty && poster.startsWith('http');
  }

  void _writeCache(String key, MetadataDetail detail) {
    _cache.put('$_cachePrefix$key', detail.toCacheJson());
  }

  static String _na(dynamic value) {
    final text = value?.toString() ?? '';
    return text == 'N/A' ? '' : text;
  }

  static List<String> _parseActorList(String? raw) {
    if (raw == null || raw.isEmpty || raw == 'N/A') return const [];
    return raw
        .split(',')
        .map((e) => e.trim())
        .where((e) => e.isNotEmpty)
        .toList();
  }

  static bool _cachedHasTitleMeta(MetadataDetail detail) {
    if (detail.ageRating.trim().isNotEmpty) return true;
    if (detail.runtime.trim().isNotEmpty) return true;
    if (detail.seasonCount != null && detail.seasonCount! > 0) return true;
    if (detail.episodeCount != null && detail.episodeCount! > 0) return true;
    return false;
  }

  static String _stripHtml(String html) {
    return html
        .replaceAll(RegExp(r'<br\s*/?>', caseSensitive: false), '\n')
        .replaceAll(RegExp(r'<[^>]+>'), '')
        .replaceAll('&nbsp;', ' ')
        .replaceAll('&amp;', '&')
        .replaceAll('&quot;', '"')
        .trim();
  }

  static String _pickTmdbAgeRating(Map<String, dynamic> item, String mediaType) {
    if (mediaType == 'tv') {
      final results = item['content_ratings']?['results'] as List? ?? [];
      for (final raw in results) {
        final entry = raw as Map<String, dynamic>;
        if (entry['iso_3166_1']?.toString() != 'US') continue;
        final rating = entry['rating']?.toString().trim() ?? '';
        if (rating.isNotEmpty && rating != 'N/A') return rating;
      }
      return '';
    }

    final results = item['release_dates']?['results'] as List? ?? [];
    for (final raw in results) {
      final entry = raw as Map<String, dynamic>;
      if (entry['iso_3166_1']?.toString() != 'US') continue;
      final dates = entry['release_dates'] as List? ?? [];
      for (final dateRaw in dates) {
        final date = dateRaw as Map<String, dynamic>;
        final certification = date['certification']?.toString().trim() ?? '';
        if (certification.isNotEmpty && certification != 'N/A') {
          return certification;
        }
      }
    }
    return '';
  }

  static String _pickTmdbRuntime(Map<String, dynamic> item, String mediaType) {
    if (mediaType == 'tv') {
      final times = (item['episode_run_time'] as List? ?? [])
          .map((value) => parsePositiveCount(value))
          .whereType<int>()
          .toList();
      if (times.isEmpty) return '';
      final avg =
          (times.reduce((sum, value) => sum + value) / times.length).round();
      return formatRuntimeMinutes(avg);
    }
    return formatRuntimeMinutes(parsePositiveCount(item['runtime']));
  }
}
