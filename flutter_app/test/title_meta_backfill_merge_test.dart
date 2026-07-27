import 'package:flutter_test/flutter_test.dart';
import 'package:our_movie_nights/features/watchlist/application/title_meta_backfill.dart';
import 'package:our_movie_nights/models/metadata_detail.dart';
import 'package:our_movie_nights/models/watchlist_item.dart';

void main() {
  test('mergeTitleMetaFromDetail preserves cardPoster and season fields', () {
    final item = WatchlistItem(
      id: 'id',
      contentType: 'tvSeries',
      genre: 'Drama',
      title: 'Test',
      link: 'https://www.imdb.com/title/tt1234567/',
      poster: 'https://example.com/poster.jpg',
      cardPoster: 'https://example.com/season.jpg',
      selectedSeason: 4,
      selectedSeasonName: 'Season 4',
      imdbLink: 'https://www.imdb.com/title/tt1234567/',
      seasonCount: 5,
      episodeCount: 60,
    );
    const meta = MetadataDetail(
      source: 'omdb',
      title: 'Test',
      year: '2010',
      rating: '8.1',
      plot: '',
      poster: 'https://example.com/other.jpg',
      genres: const [],
      runtime: '42 min',
      ageRating: 'TV-14',
    );
    final merged = mergeTitleMetaFromDetail(item, meta);
    expect(merged.cardPoster, 'https://example.com/season.jpg');
    expect(merged.selectedSeason, 4);
    expect(merged.selectedSeasonName, 'Season 4');
    expect(merged.imdbLink, 'https://www.imdb.com/title/tt1234567/');
    expect(merged.poster, 'https://example.com/poster.jpg');
    expect(merged.ageRating, 'TV-14');
    expect(merged.runtime, '42 min');
  });
}
