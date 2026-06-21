import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/constants/storage_keys.dart';
import '../../../core/storage/hive_boxes.dart';

/// Card layout ids mirror `web-files/js/app.js` → `CARD_LAYOUTS`.
enum CardLayoutId {
  hover('hover'),
  poster('poster');

  const CardLayoutId(this.storageValue);
  final String storageValue;

  static CardLayoutId fromStorage(String? raw) {
    return CardLayoutId.values.firstWhere(
      (layout) => layout.storageValue == raw,
      orElse: () => CardLayoutId.hover,
    );
  }
}

class CardLayoutNotifier extends Notifier<CardLayoutId> {
  @override
  CardLayoutId build() {
    final raw = HiveBoxes.preferences.get(StorageKeys.cardLayout) as String?;
    return CardLayoutId.fromStorage(raw);
  }

  Future<void> setLayout(CardLayoutId layout) async {
    await HiveBoxes.preferences
        .put(StorageKeys.cardLayout, layout.storageValue);
    state = layout;
  }
}

final cardLayoutProvider =
    NotifierProvider<CardLayoutNotifier, CardLayoutId>(CardLayoutNotifier.new);
