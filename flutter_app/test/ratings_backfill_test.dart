import 'package:flutter_test/flutter_test.dart';

import 'package:our_movie_nights/core/config/app_config.dart';
import 'package:our_movie_nights/core/utils/watchlist_parser.dart';
import 'package:our_movie_nights/features/watchlist/application/ratings_backfill.dart';
import 'package:our_movie_nights/models/watchlist_item.dart';

WatchlistItem _item({
  String contentType = 'tvSeries',
  String? link,
  String? imdbRating,
  String? anilistRating,
}) {
  return WatchlistItem(
    id: makeItemId(contentType, 'Drama', 'Prison Break'),
    contentType: contentType,
    genre: 'Drama',
    title: 'Prison Break',
    link: link ?? 'https://www.imdb.com/title/tt0455275/',
    imdbRating: imdbRating,
    anilistRating: anilistRating,
  );
}

void main() {
  test('itemNeedsImdbBackfill when link exists without rating', () {
    expect(itemNeedsImdbBackfill(_item()), isTrue);
    expect(itemNeedsImdbBackfill(_item(imdbRating: '8.3')), isFalse);
  });

  test('itemNeedsAnilistBackfill for anime without score', () {
    expect(
      itemNeedsAnilistBackfill(
        _item(contentType: 'anime', link: 'https://anilist.co/anime/1/'),
      ),
      isTrue,
    );
    expect(
      itemNeedsAnilistBackfill(
        _item(contentType: 'anime', anilistRating: '82'),
      ),
      isFalse,
    );
    expect(itemNeedsAnilistBackfill(_item()), isFalse);
  });

  test('applyRatingsBackfillResult preserves existing ratings', () {
    final updated = applyRatingsBackfillResult(
      _item(imdbRating: '8.0'),
      imdbRating: '8.3',
      anilistRating: '90',
    );
    expect(updated.imdbRating, '8.0');
    expect(updated.anilistRating, '90');
  });

  test('ratingSortEmptyHintKey when imdb sort has no scores', () {
    const config = AppConfig(
      supabaseUrl: '',
      supabaseAnonKey: '',
      omdbApiKey: 'abc',
      tmdbApiKey: '',
      publicAppUrl: '',
    );
    expect(
      ratingSortEmptyHintKey(
        items: [_item()],
        sortSource: 'imdb',
        ratingsBackfillRunning: false,
        config: config,
      ),
      'empty.ratingMissing',
    );
  });
}
