import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/constants/storage_keys.dart';
import '../core/storage/hive_boxes.dart';

const supportedLocales = [Locale('en'), Locale('ar')];

class LocaleNotifier extends Notifier<Locale> {
  @override
  Locale build() {
    final code = HiveBoxes.preferences.get(StorageKeys.lang) as String?;
    if (code == 'ar') return const Locale('ar');
    return const Locale('en');
  }

  Future<void> setLocale(Locale locale) async {
    await HiveBoxes.preferences.put(StorageKeys.lang, locale.languageCode);
    state = locale;
  }
}

final localeProvider =
    NotifierProvider<LocaleNotifier, Locale>(LocaleNotifier.new);

final textDirectionProvider = Provider<TextDirection>((ref) {
  final lang = ref.watch(localeProvider).languageCode;
  return lang == 'ar' ? TextDirection.rtl : TextDirection.ltr;
});
