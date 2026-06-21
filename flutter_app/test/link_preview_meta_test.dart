import 'dart:ui';

import 'package:flutter_test/flutter_test.dart';
import 'package:our_movie_nights/features/watchlist/application/link_preview_meta.dart';
import 'package:our_movie_nights/models/watchlist_item.dart';

void main() {
  test('previewDetailsFromItem maps stored fields', () {
    const item = WatchlistItem(
      id: 'movies-action-test',
      contentType: 'movies',
      genre: 'Action',
      title: 'Test Movie',
      summary: 'A plot.',
      link: 'https://www.imdb.com/title/tt1234567/',
      poster: 'https://example.com/poster.jpg',
      imdbRating: '8.1',
      year: 2020,
    );

    final details = previewDetailsFromItem(item);
    expect(details.title, 'Test Movie');
    expect(details.plot, 'A plot.');
    expect(details.rating, '8.1');
    expect(details.year, '2020');
  });

  test('linkPreviewMetaParts joins year and ratings', () {
    const item = WatchlistItem(
      id: 'movies-action-test',
      contentType: 'movies',
      genre: 'Action',
      title: 'Test Movie',
      year: 2020,
      imdbRating: '7.5',
    );
    final details = previewDetailsFromItem(item);

    expect(
      linkPreviewMetaParts(details, item),
      ['2020', 'IMDb 7.5'],
    );
  });

  test('computeLinkPreviewPosition centers below card', () {
    const anchor = Rect.fromLTWH(100, 100, 200, 120);
    const screen = Size(800, 600);

    final position = computeLinkPreviewPosition(
      anchor: anchor,
      screenSize: screen,
    );

    expect(position.dy, anchor.bottom + 10);
    expect(position.dx, greaterThan(16));
    expect(position.dx + 320, lessThanOrEqualTo(screen.width - 16));
  });
}
