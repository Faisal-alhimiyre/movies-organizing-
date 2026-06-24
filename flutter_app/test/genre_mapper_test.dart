import 'package:flutter_test/flutter_test.dart';
import 'package:our_movie_nights/models/metadata_detail.dart';
import 'package:our_movie_nights/repositories/metadata/genre_mapper.dart';

void main() {
  group('suggestGenres', () {
    test('skips Animation as main genre for anime', () {
      final genres = suggestGenres(
        ['Animation', 'Action', 'Adventure'],
        'anime',
      );
      expect(genres, contains('Action'));
      expect(genres, isNot(contains('Animation')));
    });

    test('returns Animation when it is the only mapped genre for anime', () {
      expect(suggestGenres(['Animation'], 'anime'), ['Animation']);
    });

    test('uses Action fallback when nothing maps for anime', () {
      expect(suggestGenres(['Ecchi'], 'anime'), ['Action']);
    });

    test('keeps Animation for movies', () {
      expect(
        suggestGenres(['Animation', 'Family'], 'movies'),
        contains('Animation'),
      );
    });
  });

  group('inferContentType', () {
    test('detects anime from animated TV', () {
      expect(
        inferContentType('series', ['Animation']),
        'anime',
      );
    });

    test('detects TV series without animation', () {
      expect(
        inferContentType('series', ['Drama']),
        'tvSeries',
      );
    });
  });

  group('mapGenreToStandard', () {
    test('maps sci-fi alias', () {
      expect(mapGenreToStandard('Sci-Fi'), 'Science Fiction');
    });
  });

  group('defaultLinkForDetails', () {
    test('prefers IMDb when both IMDb and TMDB ids exist', () {
      const details = MetadataDetail(
        source: 'tmdb',
        title: 'Shameless',
        imdbId: 'tt1586680',
        tmdbType: 'tv',
        tmdbId: 34307,
        link: 'https://www.themoviedb.org/tv/34307',
      );
      expect(
        defaultLinkForDetails(details),
        'https://www.imdb.com/title/tt1586680/',
      );
    });

    test('uses TMDB link when no IMDb id', () {
      const details = MetadataDetail(
        source: 'tmdb',
        title: 'Arabic Show',
        tmdbType: 'tv',
        tmdbId: 999,
      );
      expect(
        defaultLinkForDetails(details),
        'https://www.themoviedb.org/tv/999',
      );
    });
  });
}
