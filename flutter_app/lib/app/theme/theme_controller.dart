import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/constants/storage_keys.dart';
import '../../core/storage/hive_boxes.dart';

/// Theme ids mirror `web-files/js/themes.js`.
enum AppThemeId {
  dark('dark'),
  light('light'),
  purple('purple'),
  brown('brown'),
  pink('pink');

  const AppThemeId(this.id);
  final String id;

  static AppThemeId fromId(String? raw) {
    return AppThemeId.values.firstWhere(
      (t) => t.id == raw,
      orElse: () => AppThemeId.dark,
    );
  }
}

class ThemeNotifier extends Notifier<AppThemeId> {
  @override
  AppThemeId build() {
    final raw = HiveBoxes.preferences.get(StorageKeys.theme) as String?;
    return AppThemeId.fromId(raw);
  }

  Future<void> setTheme(AppThemeId theme) async {
    await HiveBoxes.preferences.put(StorageKeys.theme, theme.id);
    state = theme;
  }
}

final themeIdProvider = NotifierProvider<ThemeNotifier, AppThemeId>(ThemeNotifier.new);
