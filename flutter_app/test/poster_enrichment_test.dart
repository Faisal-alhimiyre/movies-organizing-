import 'package:flutter_test/flutter_test.dart';

import 'package:our_movie_nights/core/config/app_config.dart';
import 'package:our_movie_nights/features/watchlist/application/poster_enrichment.dart';
import 'package:our_movie_nights/models/metadata_detail.dart';
import 'package:our_movie_nights/models/watchlist_item.dart';

WatchlistItem _item({
  String? link,
  String? poster,
  int? year,
}) {
  return WatchlistItem(
    id: 'tvSeries-drama-prison-break',
    contentType: 'tvSeries',
    genre: 'Drama',
    title: 'Prison Break',
    lead: 'Wentworth Miller',
    summary: 'A man breaks his brother out of prison.',
    kind: 'series',
    link: link,
    poster: poster,
    year: year,
  );
}

void main() {
  test('hasValidPoster accepts http URLs only', () {
    expect(hasValidPoster(_item(poster: 'https://example.com/p.jpg')), isTrue);
    expect(hasValidPoster(_item(poster: 'N/A')), isFalse);
    expect(hasValidPoster(_item()), isFalse);
  });

  test('itemNeedsPosterBackfill when link exists without poster', () {
    expect(
      itemNeedsPosterBackfill(
        _item(link: 'https://www.imdb.com/title/tt0455275/'),
      ),
      isTrue,
    );
    expect(
      itemNeedsPosterBackfill(
        _item(
          link: 'https://www.imdb.com/title/tt0455275/',
          poster: 'https://example.com/p.jpg',
        ),
      ),
      isFalse,
    );
  });

  test('applyPosterEnrichment merges poster and ratings', () {
    final enriched = applyPosterEnrichment(
      _item(link: 'https://www.imdb.com/title/tt0455275/'),
      const MetadataDetail(
        source: 'omdb',
        title: 'Prison Break',
        poster: 'https://example.com/poster.jpg',
        rating: '8.3',
        year: '2005',
      ),
    );

    expect(enriched.poster, 'https://example.com/poster.jpg');
    expect(enriched.imdbRating, '8.3');
    expect(enriched.year, 2005);
  });

  test('applyPosterEnrichment keeps existing year and ratings', () {
    final enriched = applyPosterEnrichment(
      _item(
        link: 'https://www.imdb.com/title/tt0455275/',
        year: 2005,
        poster: null,
      ),
      const MetadataDetail(
        source: 'omdb',
        title: 'Prison Break',
        poster: 'https://example.com/poster.jpg',
        rating: '8.3',
        year: '2009',
      ),
    );

    expect(enriched.year, 2005);
  });

  test('posterBackfillNeedsMovieApiKeys when imdb titles need keys', () {
    final items = [
      _item(link: 'https://www.imdb.com/title/tt0455275/'),
    ];
    const noKeys = AppConfig(
      supabaseUrl: '',
      supabaseAnonKey: '',
      omdbApiKey: '',
      tmdbApiKey: '',
      publicAppUrl: '',
    );

    expect(posterBackfillNeedsMovieApiKeys(items, noKeys), isTrue);
    expect(
      posterBackfillNeedsMovieApiKeys(
        items,
        const AppConfig(
          supabaseUrl: '',
          supabaseAnonKey: '',
          omdbApiKey: 'abc123',
          tmdbApiKey: '',
          publicAppUrl: '',
        ),
      ),
      isFalse,
    );
  });
}
