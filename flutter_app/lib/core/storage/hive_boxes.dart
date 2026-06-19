import 'package:flutter/foundation.dart';
import 'package:hive_flutter/hive_flutter.dart';

import '../constants/storage_keys.dart';

/// Hive box names — structured local storage (web: IndexedDB).
abstract final class HiveBoxes {
  static const prefs = 'omn_prefs';
  static const cache = 'omn_cache';

  static Future<void> init() async {
    await Hive.initFlutter();
    await Hive.openBox<dynamic>(prefs);
    await Hive.openBox<dynamic>(cache);
  }

  static Box<dynamic> get preferences => Hive.box<dynamic>(prefs);

  static Box<dynamic> get metadataCache => Hive.box<dynamic>(cache);

  static Future<void> saveSession(Map<String, dynamic>? session) async {
    final box = preferences;
    if (session == null) {
      await box.delete(StorageKeys.session);
    } else {
      await box.put(StorageKeys.session, session);
    }
  }

  static Map<String, dynamic>? readSession() {
    final raw = preferences.get(StorageKeys.session);
    if (raw is Map) {
      return Map<String, dynamic>.from(raw);
    }
    return null;
  }
}
