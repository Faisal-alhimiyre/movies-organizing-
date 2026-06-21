import 'package:flutter_test/flutter_test.dart';
import 'package:our_movie_nights/core/utils/rating_utils.dart';
import 'package:our_movie_nights/models/watchlist_item.dart';

void main() {
  test('clampRatingValue rounds to one decimal within 0-10', () {
    expect(clampRatingValue(8.04), 8.0);
    expect(clampRatingValue(10.5), 10.0);
    expect(clampRatingValue(-1), 0);
  });

  test('parseWatchRating accepts comma decimals', () {
    expect(parseWatchRating('8,5'), 8.5);
    expect(parseWatchRating(''), isNull);
    expect(parseWatchRating('11'), isNull);
  });

  test('formatWatchRating trims trailing zero', () {
    expect(formatWatchRating(8), '8');
    expect(formatWatchRating(8.5), '8.5');
  });

  test('watchEntryHasUserData detects rating or note', () {
    expect(watchEntryHasUserData(const WatchEntry(rating: 7)), isTrue);
    expect(watchEntryHasUserData(const WatchEntry(note: 'Great')), isTrue);
    expect(watchEntryHasUserData(const WatchEntry()), isFalse);
    expect(watchEntryHasUserData(null), isFalse);
  });
}
