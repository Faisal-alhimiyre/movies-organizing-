import 'package:flutter_test/flutter_test.dart';
import 'package:our_movie_nights/features/watchlist/application/card_layout_controller.dart';

void main() {
  test('CardLayoutId defaults to hover for unknown storage', () {
    expect(CardLayoutId.fromStorage(null), CardLayoutId.hover);
    expect(CardLayoutId.fromStorage('unknown'), CardLayoutId.hover);
  });

  test('CardLayoutId round-trips storage value', () {
    for (final layout in CardLayoutId.values) {
      expect(
        CardLayoutId.fromStorage(layout.storageValue),
        layout,
      );
    }
  });
}
