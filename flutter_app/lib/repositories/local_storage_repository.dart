import 'dart:convert';

import '../core/constants/storage_keys.dart';
import '../core/utils/watchlist_parser.dart';
import '../core/storage/hive_boxes.dart';
import '../models/list_library_entry.dart';
import '../models/watchlist_data.dart';

/// Hive-backed storage mirroring `web-files/js/auth.js` localStorage keys.
class LocalStorageRepository {
  List<ListLibraryEntry> getLibrary(String accountId) {
    final raw = HiveBoxes.preferences.get(StorageKeys.library(accountId));
    if (raw is! List) return [];
    return raw
        .whereType<Map>()
        .map((e) => ListLibraryEntry.fromJson(Map<String, dynamic>.from(e)))
        .toList();
  }

  Future<void> saveLibrary(String accountId, List<ListLibraryEntry> entries) async {
    await HiveBoxes.preferences.put(
      StorageKeys.library(accountId),
      entries.map((e) => e.toJson()).toList(),
    );
  }

  Future<void> registerList(ListLibraryEntry entry) async {
    final library = getLibrary(entry.accountId);
    final index = library.indexWhere((e) => e.listId == entry.listId);
    final now = DateTime.now().millisecondsSinceEpoch;
    final next = entry.copyWith(updatedAt: now);

    if (index >= 0) {
      library[index] = ListLibraryEntry(
        listId: entry.listId,
        accountId: entry.accountId,
        name: next.name,
        description: next.description,
        addedAt: library[index].addedAt ?? now,
        updatedAt: now,
      );
    } else {
      library.add(
        ListLibraryEntry(
          listId: entry.listId,
          accountId: entry.accountId,
          name: entry.name,
          description: entry.description,
          addedAt: now,
          updatedAt: now,
        ),
      );
    }

    await saveLibrary(entry.accountId, library);
  }

  WatchlistData? readWatchlist(String listId) {
    final raw = HiveBoxes.preferences.get(StorageKeys.data(listId));
    if (raw == null) return null;

    try {
      final Map<String, dynamic> map;
      if (raw is String) {
        map = jsonDecode(raw) as Map<String, dynamic>;
      } else if (raw is Map) {
        map = Map<String, dynamic>.from(raw);
      } else {
        return null;
      }
      final data = WatchlistData.fromJson(map);
      return data.isEmpty ? null : data;
    } catch (_) {
      return null;
    }
  }

  Future<void> writeWatchlist(
    String listId,
    WatchlistData data, {
    Map<String, dynamic> watched = const {},
  }) async {
    await HiveBoxes.preferences.put(StorageKeys.data(listId), data.toJson());
    await HiveBoxes.preferences.put(StorageKeys.watched(listId), watched);
    await clearEmptyListFlag(listId);
  }

  bool listHasData(String listId) => readWatchlist(listId) != null;

  bool hasEmptyListFlag(String listId) {
    return HiveBoxes.preferences.get(StorageKeys.startEmpty(listId)) == '1';
  }

  Future<void> setEmptyListFlag(String listId) async {
    await HiveBoxes.preferences.put(StorageKeys.startEmpty(listId), '1');
  }

  Future<void> clearEmptyListFlag(String listId) async {
    await HiveBoxes.preferences.delete(StorageKeys.startEmpty(listId));
  }

  String? getLastListId(String accountId) {
    return HiveBoxes.preferences.get(StorageKeys.lastList(accountId)) as String?;
  }

  Future<void> setLastListId(String accountId, String listId) async {
    await HiveBoxes.preferences.put(StorageKeys.lastList(accountId), listId);
  }

  Future<void> clearEmptySavedWatchlist(String listId) async {
    final raw = HiveBoxes.preferences.get(StorageKeys.data(listId));
    if (raw == null) return;

    try {
      final Map<String, dynamic> map;
      if (raw is String) {
        map = jsonDecode(raw) as Map<String, dynamic>;
      } else if (raw is Map) {
        map = Map<String, dynamic>.from(raw);
      } else {
        await HiveBoxes.preferences.delete(StorageKeys.data(listId));
        return;
      }
      if (WatchlistData.fromJson(map).isEmpty) {
        await HiveBoxes.preferences.delete(StorageKeys.data(listId));
      }
    } catch (_) {
      await HiveBoxes.preferences.delete(StorageKeys.data(listId));
    }
  }

  bool hasLocalAccountData(String accountId) {
    if (getLibrary(accountId).isNotEmpty) return true;
    if (listHasData(accountId)) return true;
    if (hasEmptyListFlag(accountId)) return true;
    return false;
  }

  Future<void> ensureDefaultList(String accountId) async {
    final library = getLibrary(accountId);
    if (library.isNotEmpty) return;

    if (listHasData(accountId) || hasEmptyListFlag(accountId)) {
      await registerList(
        ListLibraryEntry(
          listId: accountId,
          accountId: accountId,
          name: 'My list',
        ),
      );
      return;
    }

    await registerList(
      ListLibraryEntry(
        listId: accountId,
        accountId: accountId,
        name: 'My list',
      ),
    );
  }

  Future<void> purgeAccount(String accountId) async {
    final library = getLibrary(accountId);
    for (final entry in library) {
      await _purgeListData(entry.listId);
    }
    await HiveBoxes.preferences.delete(StorageKeys.library(accountId));
  }

  Future<void> purgeList(String listId, String accountId) async {
    await _purgeListData(listId);
    final library =
        getLibrary(accountId).where((e) => e.listId != listId).toList();
    await saveLibrary(accountId, library);
  }

  int getListTitleCount(String listId) {
    final data = readWatchlist(listId);
    if (data == null) return 0;
    return flattenWatchlist(data).length;
  }

  Future<void> _purgeListData(String listId) async {
    await HiveBoxes.preferences.delete(StorageKeys.data(listId));
    await HiveBoxes.preferences.delete(StorageKeys.watched(listId));
    await HiveBoxes.preferences.delete(StorageKeys.syncMeta(listId));
    await HiveBoxes.preferences.delete(StorageKeys.startEmpty(listId));
  }
}
