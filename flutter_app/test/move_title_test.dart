import 'package:flutter_test/flutter_test.dart';

import 'package:our_movie_nights/core/utils/watchlist_parser.dart';
import 'package:our_movie_nights/features/lists/application/move_title.dart';
import 'package:our_movie_nights/models/watchlist_item.dart';

WatchlistItem _item({String title = 'Prison Break'}) {
  return WatchlistItem(
    id: makeItemId('tvSeries', 'Drama', title),
    contentType: 'tvSeries',
    genre: 'Drama',
    title: title,
    lead: 'Wentworth Miller',
    summary: 'A man breaks his brother out of prison.',
    kind: 'series',
    link: 'https://www.imdb.com/title/tt0455275/',
  );
}

void main() {
  test('buildListItemCopy assigns fresh id and addedAt', () {
    final source = _item();
    final copy = buildListItemCopy(source, addedAt: 1234);

    expect(copy.id, makeItemId('tvSeries', 'Drama', 'Prison Break'));
    expect(copy.addedAt, 1234);
    expect(copy.poster, source.poster);
    expect(copy.link, source.link);
  });

  test('copyItemValidationError rejects same list', () {
    expect(
      copyItemValidationError(
        sourceListId: 'list-a',
        targetListId: 'list-a',
        targetItems: const [],
        copy: _item(),
      ),
      'move.alreadyOnThisList',
    );
  });

  test('copyItemValidationError rejects duplicate title on target', () {
    final targetItems = [_item()];
    expect(
      copyItemValidationError(
        sourceListId: 'list-a',
        targetListId: 'list-b',
        targetItems: targetItems,
        copy: buildListItemCopy(_item()),
      ),
      'move.alreadyOnList',
    );
  });

  test('copyItemValidationError allows unique title on target', () {
    expect(
      copyItemValidationError(
        sourceListId: 'list-a',
        targetListId: 'list-b',
        targetItems: [_item(title: 'Breaking Bad')],
        copy: buildListItemCopy(_item()),
      ),
      isNull,
    );
  });
}
