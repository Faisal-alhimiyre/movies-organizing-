import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:hive_flutter/hive_flutter.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

import 'package:our_movie_nights/core/config/app_config.dart';
import 'package:our_movie_nights/models/series_metadata.dart';
import 'package:our_movie_nights/models/watchlist_item.dart';
import 'package:our_movie_nights/repositories/metadata/series_metadata_service.dart';

// ─────────────────────────────────────────────────────────────
// Test fixtures / helpers
// ─────────────────────────────────────────────────────────────

const _testConfig = AppConfig(
  supabaseUrl: '',
  supabaseAnonKey: '',
  omdbApiKey: 'TEST_OMDB',
  tmdbApiKey: 'TEST_TMDB',
  publicAppUrl: '',
);

const _noKeyConfig = AppConfig(
  supabaseUrl: '',
  supabaseAnonKey: '',
  omdbApiKey: '',
  tmdbApiKey: '',
  publicAppUrl: '',
);

/// Minimal in-memory Hive box stub that does not touch disk.
class _FakeBox extends Fake implements Box<dynamic> {
  final _data = <dynamic, dynamic>{};

  @override
  dynamic get(dynamic key, {dynamic defaultValue}) =>
      _data.containsKey(key) ? _data[key] : defaultValue;

  @override
  Future<void> put(dynamic key, dynamic value) async => _data[key] = value;

  @override
  bool containsKey(dynamic key) => _data.containsKey(key);
}

http.Response _jsonResponse(Object body, {int status = 200}) =>
    http.Response(jsonEncode(body), status, headers: {'content-type': 'application/json'});

http.Response _anilistResponse(Map<String, dynamic> media) =>
    _jsonResponse({'data': {'Media': media}});

// ─────────────────────────────────────────────────────────────

void main() {
  // ── Model round-trip ─────────────────────────────────────────
  group('SeriesSummary toJson / fromJson', () {
    test('round-trips all fields', () {
      const original = SeriesSummary(
        source: 'tmdb',
        tmdbId: 1399,
        imdbId: 'tt0944947',
        title: 'Game of Thrones',
        originalTitle: 'Game of Thrones',
        totalSeasons: 8,
        totalEpisodes: 73,
        poster: 'https://image.tmdb.org/t/p/w500/foo.jpg',
        overview: 'Dragons.',
        status: 'Ended',
        firstAirDate: '2011-04-17',
        lastAirDate: '2019-05-19',
      );
      final restored = SeriesSummary.fromJson(original.toJson());

      expect(restored.source, 'tmdb');
      expect(restored.tmdbId, 1399);
      expect(restored.imdbId, 'tt0944947');
      expect(restored.title, 'Game of Thrones');
      expect(restored.totalSeasons, 8);
      expect(restored.totalEpisodes, 73);
      expect(restored.status, 'Ended');
      expect(restored.firstAirDate, '2011-04-17');
    });

    test('handles missing optional fields gracefully', () {
      final restored = SeriesSummary.fromJson({'source': 'omdb'});
      expect(restored.title, '');
      expect(restored.poster, '');
      expect(restored.totalSeasons, isNull);
    });
  });

  group('SeasonSummary toJson / fromJson', () {
    test('round-trips specials flag', () {
      const season = SeasonSummary(
        source: 'tmdb',
        seriesTmdbId: 1399,
        seasonNumber: 0,
        name: 'Specials',
        isSpecials: true,
      );
      final restored = SeasonSummary.fromJson(season.toJson());
      expect(restored.isSpecials, true);
      expect(restored.isRegular, false);
      expect(restored.seasonNumber, 0);
    });

    test('round-trips synthetic flag', () {
      const season = SeasonSummary(
        source: 'anilist',
        seasonNumber: 1,
        name: 'Season 1',
        isSynthetic: true,
      );
      final restored = SeasonSummary.fromJson(season.toJson());
      expect(restored.isSynthetic, true);
    });
  });

  group('EpisodeDetail toJson / fromJson', () {
    test('round-trips all fields', () {
      const ep = EpisodeDetail(
        source: 'tmdb',
        seriesTmdbId: 1399,
        seasonNumber: 1,
        episodeNumber: 3,
        title: 'Lord Snow',
        still: 'https://image.tmdb.org/t/p/w500/still.jpg',
        overview: 'Jon arrives at the Wall.',
        runtimeMinutes: 58,
        airDate: '2011-05-01',
        isAired: true,
      );
      final restored = EpisodeDetail.fromJson(ep.toJson());

      expect(restored.source, 'tmdb');
      expect(restored.seasonNumber, 1);
      expect(restored.episodeNumber, 3);
      expect(restored.runtimeMinutes, 58);
      expect(restored.progressKey, '1:3');
      expect(restored.isAired, true);
    });

    test('defaults isAired to true when key absent', () {
      final ep = EpisodeDetail.fromJson({
        'source': 'tmdb',
        'seasonNumber': 1,
        'episodeNumber': 1,
        'title': 'Ep',
      });
      expect(ep.isAired, true);
    });

    test('preserves isAired = false for future episodes', () {
      final ep = EpisodeDetail.fromJson({
        'source': 'tmdb',
        'seasonNumber': 1,
        'episodeNumber': 99,
        'title': 'Future',
        'isAired': false,
      });
      expect(ep.isAired, false);
    });

    test('progressKey matches season:episode format', () {
      const ep = EpisodeDetail(source: 'omdb', seasonNumber: 3, episodeNumber: 7, title: 'Ep');
      expect(ep.progressKey, '3:7');
    });
  });

  // ── TMDb series normalization ────────────────────────────────
  group('SeriesMetadataService — TMDb series', () {
    test('multi-season series with all fields', () async {
      final fakeBox = _FakeBox();
      final tmdbJson = {
        'id': 1399,
        'name': 'Game of Thrones',
        'original_name': 'Game of Thrones',
        'number_of_seasons': 8,
        'number_of_episodes': 73,
        'poster_path': '/foo.jpg',
        'overview': 'Dragons.',
        'status': 'Ended',
        'first_air_date': '2011-04-17',
        'last_air_date': '2019-05-19',
        'seasons': [
          {
            'season_number': 0,
            'name': 'Specials',
            'episode_count': 14,
            'poster_path': '/s0.jpg',
            'overview': '',
            'air_date': '2010-12-05',
          },
          {
            'season_number': 1,
            'name': 'Season 1',
            'episode_count': 10,
            'poster_path': '/s1.jpg',
            'overview': 'The North.',
            'air_date': '2011-04-17',
          },
        ],
      };
      final svc = SeriesMetadataService(
        config: _testConfig,
        cache: fakeBox,
        client: MockClient((_) async => _jsonResponse(tmdbJson)),
      );

      final result = await svc.fetchSeriesMetadata(
        resolution: SeriesIdResolution.tmdb(1399),
        locale: 'en',
      );

      expect(result.state, MetadataResultState.available);
      expect(result.series?.tmdbId, 1399);
      expect(result.series?.totalSeasons, 8);
      expect(result.seasons?.length, 2);

      final specials = result.seasons!.first;
      expect(specials.isSpecials, true);
      expect(specials.seasonNumber, 0);

      final s1 = result.seasons![1];
      expect(s1.isSpecials, false);
      expect(s1.isRegular, true);
      expect(s1.episodeCount, 10);
      expect(s1.poster, contains('s1.jpg'));
    });

    test('missing poster uses fallback', () async {
      final fakeBox = _FakeBox();
      final svc = SeriesMetadataService(
        config: _testConfig,
        cache: fakeBox,
        client: MockClient((_) async => _jsonResponse({
          'id': 999,
          'name': 'No Poster Show',
          'poster_path': null,
          'seasons': [],
        })),
      );

      final result = await svc.fetchSeriesMetadata(
        resolution: SeriesIdResolution.tmdb(999),
        locale: 'en',
        fallbackPoster: 'https://example.com/fallback.jpg',
      );
      expect(result.series?.poster, 'https://example.com/fallback.jpg');
    });

    test('empty seasons returns noSeasons state', () async {
      final fakeBox = _FakeBox();
      final svc = SeriesMetadataService(
        config: _testConfig,
        cache: fakeBox,
        client: MockClient((_) async => _jsonResponse({
          'id': 888,
          'name': 'Minimal Show',
          'seasons': [],
        })),
      );

      final result = await svc.fetchSeriesMetadata(
        resolution: SeriesIdResolution.tmdb(888),
        locale: 'en',
      );
      expect(result.state, MetadataResultState.noSeasons);
      expect(result.seasons, isEmpty);
    });
  });

  // ── TMDb episode normalization ───────────────────────────────
  group('SeriesMetadataService — TMDb episodes', () {
    test('episode list with all fields including still fallback', () async {
      final fakeBox = _FakeBox();
      final json = {
        'season_number': 1,
        'poster_path': '/season1.jpg',
        'episodes': [
          {
            'episode_number': 1,
            'season_number': 1,
            'name': 'Winter Is Coming',
            'overview': 'Ned Stark.',
            'still_path': '/ep1.jpg',
            'runtime': 62,
            'air_date': '2011-04-17',
          },
          {
            'episode_number': 2,
            'season_number': 1,
            'name': 'The Kingsroad',
            'still_path': null, // no still
            'runtime': null,
            'air_date': '2011-04-24',
          },
        ],
      };
      final svc = SeriesMetadataService(
        config: _testConfig,
        cache: fakeBox,
        client: MockClient((_) async => _jsonResponse(json)),
      );

      final result = await svc.fetchSeasonEpisodes(
        resolution: SeriesIdResolution.tmdb(1399),
        seasonNumber: 1,
        locale: 'en',
      );

      expect(result.state, MetadataResultState.available);
      expect(result.episodes?.length, 2);

      final ep1 = result.episodes!.first;
      expect(ep1.title, 'Winter Is Coming');
      expect(ep1.runtimeMinutes, 62);
      expect(ep1.still, contains('ep1.jpg'));
      expect(ep1.isAired, true);
      expect(ep1.progressKey, '1:1');

      // Ep 2 has no still — falls back to season poster
      final ep2 = result.episodes![1];
      expect(ep2.still, contains('season1.jpg'));
      expect(ep2.runtimeMinutes, isNull);
    });

    test('future episode has isAired = false', () async {
      final future = DateTime.now().add(const Duration(days: 30));
      final futureDate =
          '${future.year}-${future.month.toString().padLeft(2, '0')}-${future.day.toString().padLeft(2, '0')}';

      final svc = SeriesMetadataService(
        config: _testConfig,
        cache: _FakeBox(),
        client: MockClient((_) async => _jsonResponse({
          'episodes': [
            {
              'episode_number': 5,
              'season_number': 1,
              'name': 'Future Episode',
              'air_date': futureDate,
            },
          ],
        })),
      );

      final result = await svc.fetchSeasonEpisodes(
        resolution: SeriesIdResolution.tmdb(1399),
        seasonNumber: 1,
        locale: 'en',
      );
      expect(result.episodes!.first.isAired, false);
    });

    test('null air date defaults isAired = true', () async {
      final svc = SeriesMetadataService(
        config: _testConfig,
        cache: _FakeBox(),
        client: MockClient((_) async => _jsonResponse({
          'episodes': [
            {'episode_number': 1, 'season_number': 1, 'name': 'No Date', 'air_date': null},
          ],
        })),
      );

      final result = await svc.fetchSeasonEpisodes(
        resolution: SeriesIdResolution.tmdb(1),
        seasonNumber: 1,
        locale: 'en',
      );
      expect(result.episodes!.first.isAired, true);
    });

    test('no still + no season poster falls back to provided fallbackPoster', () async {
      final svc = SeriesMetadataService(
        config: _testConfig,
        cache: _FakeBox(),
        client: MockClient((_) async => _jsonResponse({
          'poster_path': null,
          'episodes': [
            {'episode_number': 1, 'season_number': 1, 'name': 'Ep', 'still_path': null},
          ],
        })),
      );

      final result = await svc.fetchSeasonEpisodes(
        resolution: SeriesIdResolution.tmdb(1),
        seasonNumber: 1,
        locale: 'en',
        fallbackPoster: 'https://example.com/series.jpg',
      );
      expect(result.episodes!.first.still, 'https://example.com/series.jpg');
    });
  });

  // ── AniList normalization ────────────────────────────────────
  group('SeriesMetadataService — AniList', () {
    test('complete streaming episode data', () async {
      final media = {
        'id': 15125,
        'title': {'english': 'Fullmetal Alchemist: Brotherhood', 'romaji': 'Hagane no Renkinjutsushi'},
        'episodes': 64,
        'coverImage': {'large': 'https://anilist.co/cover.jpg'},
        'description': 'Two brothers.',
        'startDate': {'year': 2009, 'month': 4, 'day': 5},
        'endDate': {'year': 2010, 'month': 7, 'day': 4},
        'status': 'FINISHED',
        'streamingEpisodes': [
          {'title': 'Fullmetal Alchemist', 'thumbnail': 'https://thumb/1.jpg'},
          {'title': 'The First Day', 'thumbnail': 'https://thumb/2.jpg'},
        ],
      };

      final svc = SeriesMetadataService(
        config: _testConfig,
        cache: _FakeBox(),
        client: MockClient((_) async => _anilistResponse(media)),
      );

      final result = await svc.fetchSeriesMetadata(
        resolution: SeriesIdResolution.anilist(15125),
        locale: 'en',
      );

      expect(result.state, MetadataResultState.available);
      expect(result.series?.title, 'Fullmetal Alchemist: Brotherhood');
      expect(result.series?.totalSeasons, 1);
      expect(result.series?.firstAirDate, '2009-04-05');
      expect(result.seasons?.length, 1);
      expect(result.seasons?.first.isSynthetic, true);
    });

    test('no thumbnails — uses fallbackPoster as still', () async {
      final media = {
        'id': 1,
        'title': {'english': 'TestAnime'},
        'episodes': 3,
        'coverImage': {'large': 'https://cover.jpg'},
        'description': null,
        'startDate': {'year': 2020},
        'endDate': null,
        'status': 'FINISHED',
        'streamingEpisodes': [
          {'title': 'Ep 1', 'thumbnail': null},
        ],
      };

      final svc = SeriesMetadataService(
        config: _testConfig,
        cache: _FakeBox(),
        client: MockClient((_) async => _anilistResponse(media)),
      );

      final result = await svc.fetchSeasonEpisodes(
        resolution: SeriesIdResolution.anilist(1),
        seasonNumber: 1,
        locale: 'en',
        fallbackPoster: 'https://cover.jpg',
      );

      expect(result.episodes!.first.still, 'https://cover.jpg');
    });

    test('episode count known, no streamingEpisodes → synthetic stubs', () async {
      final media = {
        'id': 2,
        'title': {'english': 'Short Anime'},
        'episodes': 12,
        'coverImage': {'large': 'https://cover.jpg'},
        'description': null,
        'startDate': {'year': 2021},
        'endDate': null,
        'status': 'FINISHED',
        'streamingEpisodes': [],
      };

      final svc = SeriesMetadataService(
        config: _testConfig,
        cache: _FakeBox(),
        client: MockClient((_) async => _anilistResponse(media)),
      );

      final result = await svc.fetchSeasonEpisodes(
        resolution: SeriesIdResolution.anilist(2),
        seasonNumber: 1,
        locale: 'en',
      );

      expect(result.state, MetadataResultState.episodeDetailsUnavailable);
      expect(result.episodes?.length, 12);
      expect(result.episodes?.first.title, 'Episode 1');
    });

    test('no episode count and no streamingEpisodes → episodeDetailsUnavailable', () async {
      final media = {
        'id': 3,
        'title': {'english': 'Unknown Eps'},
        'episodes': null,
        'coverImage': {'large': 'https://cover.jpg'},
        'description': null,
        'startDate': null,
        'endDate': null,
        'status': 'RELEASING',
        'streamingEpisodes': [],
      };

      final svc = SeriesMetadataService(
        config: _testConfig,
        cache: _FakeBox(),
        client: MockClient((_) async => _anilistResponse(media)),
      );

      final result = await svc.fetchSeasonEpisodes(
        resolution: SeriesIdResolution.anilist(3),
        seasonNumber: 1,
        locale: 'en',
      );

      expect(result.state, MetadataResultState.episodeDetailsUnavailable);
      expect(result.episodes, isNull);
    });

    test('season > 1 returns unavailable (AniList is single-season only)', () async {
      final svc = SeriesMetadataService(
        config: _testConfig,
        cache: _FakeBox(),
        client: MockClient((_) async => _jsonResponse({})),
      );

      final result = await svc.fetchSeasonEpisodes(
        resolution: SeriesIdResolution.anilist(15125),
        seasonNumber: 2,
        locale: 'en',
      );
      expect(result.state, MetadataResultState.unavailable);
    });

    test('missing description produces empty string', () async {
      final media = {
        'id': 4,
        'title': {'romaji': 'No Desc'},
        'episodes': 1,
        'coverImage': {'large': ''},
        'description': null,
        'startDate': null,
        'endDate': null,
        'status': 'FINISHED',
        'streamingEpisodes': [],
      };

      final svc = SeriesMetadataService(
        config: _testConfig,
        cache: _FakeBox(),
        client: MockClient((_) async => _anilistResponse(media)),
      );

      final result = await svc.fetchSeriesMetadata(
        resolution: SeriesIdResolution.anilist(4),
        locale: 'en',
      );

      expect(result.series?.overview, '');
    });
  });

  // ── OMDb normalization ───────────────────────────────────────
  group('SeriesMetadataService — OMDb', () {
    test('valid season response', () async {
      final svc = SeriesMetadataService(
        config: _testConfig,
        cache: _FakeBox(),
        client: MockClient((_) async => _jsonResponse({
          'Response': 'True',
          'Title': 'Game of Thrones',
          'Season': '1',
          'Episodes': [
            {'Title': 'Winter Is Coming', 'Released': '2011-04-17', 'Episode': '1', 'imdbRating': '9.1'},
            {'Title': 'The Kingsroad', 'Released': '2011-04-24', 'Episode': '2', 'imdbRating': '8.8'},
          ],
        })),
      );

      final result = await svc.fetchSeasonEpisodes(
        resolution: SeriesIdResolution.omdb('tt0944947'),
        seasonNumber: 1,
        locale: 'en',
      );

      expect(result.state, MetadataResultState.available);
      expect(result.episodes?.length, 2);
      expect(result.episodes!.first.title, 'Winter Is Coming');
      expect(result.episodes!.first.airDate, '2011-04-17');
      expect(result.episodes!.first.still, '');        // OMDb never provides stills
      expect(result.episodes!.first.overview, '');      // OMDb never provides summaries
      expect(result.episodes!.first.runtimeMinutes, isNull);
    });

    test('OMDb error response returns unavailable', () async {
      final svc = SeriesMetadataService(
        config: _testConfig,
        cache: _FakeBox(),
        client: MockClient(
          (_) async => _jsonResponse({'Response': 'False', 'Error': 'Incorrect IMDb ID.'}),
        ),
      );

      final result = await svc.fetchSeasonEpisodes(
        resolution: SeriesIdResolution.omdb('tt9999999'),
        seasonNumber: 1,
        locale: 'en',
      );
      expect(result.state, MetadataResultState.unavailable);
    });

    test('N/A fields normalized to empty / null', () async {
      final svc = SeriesMetadataService(
        config: _testConfig,
        cache: _FakeBox(),
        client: MockClient((_) async => _jsonResponse({
          'Response': 'True',
          'Episodes': [
            {'Episode': '1', 'Title': 'N/A', 'Released': 'N/A'},
          ],
        })),
      );

      final result = await svc.fetchSeasonEpisodes(
        resolution: SeriesIdResolution.omdb('tt0000001'),
        seasonNumber: 1,
        locale: 'en',
      );

      expect(result.episodes!.first.title, '');
      expect(result.episodes!.first.airDate, isNull);
    });

    test('no OMDb key returns unavailable without making network request', () async {
      bool wasCalled = false;
      final svc = SeriesMetadataService(
        config: _noKeyConfig,
        cache: _FakeBox(),
        client: MockClient((_) async {
          wasCalled = true;
          return _jsonResponse({});
        }),
      );

      final result = await svc.fetchSeasonEpisodes(
        resolution: SeriesIdResolution.omdb('tt0000001'),
        seasonNumber: 1,
        locale: 'en',
      );

      expect(result.state, MetadataResultState.unavailable);
      expect(wasCalled, false);
    });
  });

  // ── Cache behaviour ──────────────────────────────────────────
  group('Cache', () {
    test('second call uses cache, no new network request', () async {
      final fakeBox = _FakeBox();
      int callCount = 0;
      final svc = SeriesMetadataService(
        config: _testConfig,
        cache: fakeBox,
        client: MockClient((_) async {
          callCount++;
          return _jsonResponse({'id': 1399, 'name': 'GoT', 'seasons': []});
        }),
      );

      await svc.fetchSeriesMetadata(resolution: SeriesIdResolution.tmdb(1399), locale: 'en');
      await svc.fetchSeriesMetadata(resolution: SeriesIdResolution.tmdb(1399), locale: 'en');

      expect(callCount, 1);
    });

    test('en and ar locale entries are cached separately', () async {
      final fakeBox = _FakeBox();
      int callCount = 0;
      final svc = SeriesMetadataService(
        config: _testConfig,
        cache: fakeBox,
        client: MockClient((_) async {
          callCount++;
          return _jsonResponse({'id': 1, 'name': 'Show', 'seasons': []});
        }),
      );

      await svc.fetchSeriesMetadata(resolution: SeriesIdResolution.tmdb(1), locale: 'en');
      await svc.fetchSeriesMetadata(resolution: SeriesIdResolution.tmdb(1), locale: 'ar');

      expect(callCount, greaterThanOrEqualTo(2));
    });

    test('negative cache prevents repeated TMDb /find calls', () async {
      final fakeBox = _FakeBox();
      int findCalls = 0;
      final svc = SeriesMetadataService(
        config: _testConfig,
        cache: fakeBox,
        client: MockClient((req) async {
          if (req.url.path.contains('find')) {
            findCalls++;
            return _jsonResponse({'tv_results': [], 'movie_results': []});
          }
          return _jsonResponse({});
        }),
      );

      const item = WatchlistItem(
        id: 'tvSeries::Drama::GoT',
        contentType: 'tvSeries',
        genre: 'Drama',
        title: 'GoT',
        link: 'https://www.imdb.com/title/tt0944947/',
      );

      await svc.resolveSeriesId(item);
      await svc.resolveSeriesId(item);

      expect(findCalls, 1, reason: 'negative cache prevents second /find call');
    });

    test('stale cache returned with offlineWithCache on network failure', () async {
      final fakeBox = _FakeBox();

      // Pre-seed an expired cache entry (8 days old, TTL 7 days).
      await fakeBox.put('metadata:v5:series:tmdb:1399:en', {
        'payload': {
          'series': const SeriesSummary(
            source: 'tmdb',
            tmdbId: 1399,
            title: 'Stale GoT',
          ).toJson(),
          'seasons': <Map<String, dynamic>>[],
        },
        'state': 'available',
        'cachedAt':
            DateTime.now().subtract(const Duration(days: 8)).millisecondsSinceEpoch,
        'ttlMs': const Duration(days: 7).inMilliseconds,
      });

      final svc = SeriesMetadataService(
        config: _testConfig,
        cache: fakeBox,
        client: MockClient((_) async => http.Response('', 500)),
      );

      final result = await svc.fetchSeriesMetadata(
        resolution: SeriesIdResolution.tmdb(1399),
        locale: 'en',
      );

      expect(result.state, MetadataResultState.offlineWithCache);
      expect(result.series?.title, 'Stale GoT');
      expect(result.isStale, true);
    });
  });

  // ── ID resolution ────────────────────────────────────────────
  group('resolveSeriesId', () {
    test('movie contentType returns none immediately', () async {
      final svc = SeriesMetadataService(
        config: _testConfig,
        cache: _FakeBox(),
        client: MockClient((_) async => _jsonResponse({})),
      );
      const item = WatchlistItem(
        id: 'movies::Action::Interstellar',
        contentType: 'movies',
        genre: 'Action',
        title: 'Interstellar',
        link: 'https://www.imdb.com/title/tt0816692/',
      );

      final res = await svc.resolveSeriesId(item);
      expect(res.isNegative, true);
    });

    test('item with no link returns none', () async {
      final svc = SeriesMetadataService(
        config: _testConfig,
        cache: _FakeBox(),
        client: MockClient((_) async => _jsonResponse({})),
      );
      const item = WatchlistItem(
        id: 'tvSeries::Drama::NoLink',
        contentType: 'tvSeries',
        genre: 'Drama',
        title: 'No Link',
      );

      final res = await svc.resolveSeriesId(item);
      expect(res.isNegative, true);
    });

    test('IMDb link + successful TMDb /find → tmdb resolution', () async {
      final svc = SeriesMetadataService(
        config: _testConfig,
        cache: _FakeBox(),
        client: MockClient((req) async {
          if (req.url.path.contains('find')) {
            return _jsonResponse({
              'tv_results': [{'id': 1399}],
              'movie_results': [],
            });
          }
          return _jsonResponse({});
        }),
      );
      const item = WatchlistItem(
        id: 'tvSeries::Drama::GoT',
        contentType: 'tvSeries',
        genre: 'Drama',
        title: 'GoT',
        link: 'https://www.imdb.com/title/tt0944947/',
      );

      final res = await svc.resolveSeriesId(item);
      expect(res.source, 'tmdb');
      expect(res.tmdbId, 1399);
      expect(res.imdbId, 'tt0944947');
      expect(res.hasUsableSource, true);
    });

    test('failed TMDb resolution with OMDb key → omdb fallback', () async {
      final svc = SeriesMetadataService(
        config: _testConfig,
        cache: _FakeBox(),
        client: MockClient((_) async => _jsonResponse({
          'tv_results': [],
          'movie_results': [],
        })),
      );
      const item = WatchlistItem(
        id: 'tvSeries::Drama::GoT',
        contentType: 'tvSeries',
        genre: 'Drama',
        title: 'GoT',
        link: 'https://www.imdb.com/title/tt0944947/',
      );

      final res = await svc.resolveSeriesId(item);
      expect(res.source, 'omdb');
      expect(res.imdbId, 'tt0944947');
    });

    test('failed TMDb resolution without OMDb key → none', () async {
      final svc = SeriesMetadataService(
        config: _noKeyConfig,
        cache: _FakeBox(),
        client: MockClient((_) async => _jsonResponse({
          'tv_results': [],
          'movie_results': [],
        })),
      );
      const item = WatchlistItem(
        id: 'tvSeries::Drama::GoT',
        contentType: 'tvSeries',
        genre: 'Drama',
        title: 'GoT',
        link: 'https://www.imdb.com/title/tt0944947/',
      );

      final res = await svc.resolveSeriesId(item);
      expect(res.isNegative, true);
    });

    test('AniList link → anilist resolution', () async {
      final svc = SeriesMetadataService(
        config: _testConfig,
        cache: _FakeBox(),
        client: MockClient((_) async => _jsonResponse({})),
      );
      const item = WatchlistItem(
        id: 'anime::Action::FMA',
        contentType: 'anime',
        genre: 'Action',
        title: 'FMA: Brotherhood',
        link: 'https://anilist.co/anime/15125/',
      );

      final res = await svc.resolveSeriesId(item);
      expect(res.source, 'anilist');
      expect(res.anilistId, 15125);
    });
  });

  // ── mightHaveSeasons ─────────────────────────────────────────
  group('mightHaveSeasons', () {
    late SeriesMetadataService svc;
    setUp(() {
      svc = SeriesMetadataService(
        config: _testConfig,
        cache: _FakeBox(),
        client: MockClient((_) async => _jsonResponse({})),
      );
    });

    test('movies → false', () {
      const item = WatchlistItem(
        id: 'movies::Action::Test',
        contentType: 'movies',
        genre: 'Action',
        title: 'Test',
      );
      expect(svc.mightHaveSeasons(item), false);
    });

    test('tvSeries → true', () {
      const item = WatchlistItem(
        id: 'tvSeries::Drama::Test',
        contentType: 'tvSeries',
        genre: 'Drama',
        title: 'Test',
      );
      expect(svc.mightHaveSeasons(item), true);
    });

    test('anime → true', () {
      const item = WatchlistItem(
        id: 'anime::Action::Test',
        contentType: 'anime',
        genre: 'Action',
        title: 'Test',
      );
      expect(svc.mightHaveSeasons(item), true);
    });
  });

  // ── Normalization shape parity across sources ─────────────────
  group('Normalization shape parity', () {
    test('EpisodeDetail has identical fields regardless of source', () {
      for (final source in ['tmdb', 'anilist', 'omdb']) {
        final ep = EpisodeDetail(
          source: source,
          seasonNumber: 1,
          episodeNumber: 1,
          title: 'Ep',
        );
        expect(ep.progressKey, '1:1');
        expect(ep.isAired, true);
        expect(ep.overview, '');
        expect(ep.runtimeMinutes, isNull);
        expect(ep.still, '');
      }
    });

    test('SeasonSummary has identical fields regardless of source', () {
      for (final source in ['tmdb', 'anilist', 'omdb']) {
        final season = SeasonSummary(
          source: source,
          seasonNumber: 1,
          name: 'Season 1',
          isSynthetic: source != 'tmdb',
        );
        expect(season.isSpecials, false);
        expect(season.isRegular, true);
        expect(season.poster, '');
        expect(season.overview, '');
      }
    });
  });
}
