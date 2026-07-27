import 'package:flutter_test/flutter_test.dart';
import 'package:our_movie_nights/core/config/app_config.dart';
import 'package:our_movie_nights/features/watchlist/application/year_backfill.dart';
import 'package:our_movie_nights/models/watchlist_item.dart';

WatchlistItem _item({
  String contentType = 'movies',
  String? link,
  int? year,
  String title = 'Test',
  String? anilistRating,
}) {
  return WatchlistItem(
    id: 'id',
    contentType: contentType,
    genre: 'Action',
    title: title,
    link: link,
    year: year,
    anilistRating: anilistRating,
  );
}

void main() {
  test('hasValidReleaseYear accepts stored year', () {
    expect(hasValidReleaseYear(_item(year: 2020)), isTrue);
    expect(hasValidReleaseYear(_item()), isFalse);
  });

  test('itemNeedsYearBackfill detects imdb link without year', () {
    expect(
      itemNeedsYearBackfill(
        _item(link: 'https://www.imdb.com/title/tt1234567/'),
      ),
      isTrue,
    );
    expect(
      itemNeedsYearBackfill(
        _item(link: 'https://www.imdb.com/title/tt1234567/', year: 2019),
      ),
      isFalse,
    );
  });

  test('itemNeedsYearBackfill detects anime title without year', () {
    expect(
      itemNeedsYearBackfill(_item(contentType: 'anime', title: 'Naruto')),
      isTrue,
    );
  });

  test('yearBackfillNeedsMovieApiKeys when imdb titles need keys', () {
    const config = AppConfig(
      supabaseUrl: '',
      supabaseAnonKey: '',
      omdbApiKey: '',
      tmdbApiKey: '',
      publicAppUrl: '',
    );
    expect(
      yearBackfillNeedsMovieApiKeys(
        [_item(link: 'https://www.imdb.com/title/tt1234567/')],
        config,
      ),
      isTrue,
    );
    expect(
      yearBackfillNeedsMovieApiKeys(
        [_item(contentType: 'anime', title: 'Naruto')],
        config,
      ),
      isFalse,
    );
  });

  test('applyYearBackfillResult preserves existing anilist rating', () {
    final updated = applyYearBackfillResult(
      _item(anilistRating: '90', contentType: 'anime'),
      year: 2020,
      anilistRating: '80',
    );
    expect(updated.year, 2020);
    expect(updated.anilistRating, '90');
  });

  test('applyYearBackfillResult preserves cardPoster and season fields', () {
    final base = WatchlistItem(
      id: 'id',
      contentType: 'tvSeries',
      genre: 'Drama',
      title: 'Test',
      link: 'https://www.imdb.com/title/tt1234567/',
      poster: 'https://example.com/poster.jpg',
      cardPoster: 'https://example.com/season-poster.jpg',
      selectedSeason: 3,
      selectedSeasonName: 'Season 3',
      imdbLink: 'https://www.imdb.com/title/tt1234567/',
    );
    final updated = applyYearBackfillResult(base, year: 2011);
    expect(updated.cardPoster, 'https://example.com/season-poster.jpg');
    expect(updated.selectedSeason, 3);
    expect(updated.selectedSeasonName, 'Season 3');
    expect(updated.imdbLink, 'https://www.imdb.com/title/tt1234567/');
    expect(updated.poster, 'https://example.com/poster.jpg');
  });
}
