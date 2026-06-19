import 'dart:convert';
import 'dart:math' as math;

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/constants/storage_keys.dart';
import '../core/storage/hive_boxes.dart';
import '../core/utils/watchlist_parser.dart';
import '../models/watchlist_item.dart';
import '../models/watchlist_data.dart';
import 'auth_repository.dart';
import 'local_storage_repository.dart';
import 'supabase_sync_repository.dart';

class WatchlistSnapshot {
  const WatchlistSnapshot({
    required this.items,
    required this.watched,
    required this.isEmptyList,
    this.syncStatus = SyncDisplayStatus.local,
  });

  final List<WatchlistItem> items;
  final Map<String, WatchEntry> watched;
  final bool isEmptyList;
  final SyncDisplayStatus syncStatus;

  int get total => items.length;

  int get watchedCount =>
      items.where((i) => isItemWatched(i.id, watched)).length;
}

class WatchlistSaveResult {
  const WatchlistSaveResult({required this.syncStatus});

  final SyncDisplayStatus syncStatus;
}

class WatchlistRepository {
  WatchlistRepository(this._local, this._supabase);

  final LocalStorageRepository _local;
  final SupabaseSyncRepository? _supabase;

  Future<WatchlistSnapshot> load(
    String listId, {
    bool cloudConfigured = false,
  }) async {
    if (cloudConfigured && _supabase != null) {
      await _reconcileWithCloud(listId);
    }

    return _readSnapshot(listId, cloudConfigured: cloudConfigured);
  }

  Future<WatchlistSaveResult> saveItems({
    required String listId,
    required String accountId,
    required List<WatchlistItem> items,
    required Map<String, WatchEntry> watched,
    bool cloudConfigured = false,
    String listName = 'My list',
  }) async {
    final nested = itemsToNested(items);
    final watchedJson = watchedMapToJson(watched);
    final now = DateTime.now().millisecondsSinceEpoch;

    await _local.writeWatchlist(listId, nested, watched: watchedJson);
    await _writeSyncMeta(listId, localUpdated: now, syncedAt: 0);

    if (!cloudConfigured || _supabase == null) {
      return const WatchlistSaveResult(syncStatus: SyncDisplayStatus.local);
    }

    final pushed = await _supabase!.pushSnapshot(
      listId: listId,
      accountId: accountId,
      watchlist: nested,
      watched: watchedJson,
      listName: listName,
    );

    if (pushed) {
      await _writeSyncMeta(listId, localUpdated: now, syncedAt: now);
      return const WatchlistSaveResult(syncStatus: SyncDisplayStatus.saved);
    }

    return const WatchlistSaveResult(syncStatus: SyncDisplayStatus.error);
  }

  WatchlistSnapshot _readSnapshot(
    String listId, {
    required bool cloudConfigured,
  }) {
    final hasEmptyFlag = _local.hasEmptyListFlag(listId);
    final data = _local.readWatchlist(listId);
    final watched = _readWatched(listId);

    if (data == null) {
      return WatchlistSnapshot(
        items: const [],
        watched: watched,
        isEmptyList: hasEmptyFlag,
        syncStatus: cloudConfigured
            ? SyncDisplayStatus.saved
            : SyncDisplayStatus.local,
      );
    }

    return WatchlistSnapshot(
      items: flattenWatchlist(data),
      watched: watched,
      isEmptyList: false,
      syncStatus:
          cloudConfigured ? SyncDisplayStatus.saved : SyncDisplayStatus.local,
    );
  }

  Future<void> _reconcileWithCloud(String listId) async {
    final supabase = _supabase;
    if (supabase == null) return;

    final localData = _local.readWatchlist(listId);
    final localHasData = localData != null && !localData.isEmpty;

    final remote = await supabase.fetchSnapshot(listId);
    if (remote == null) return;

    final remoteHasData = !remote.watchlist.isEmpty;
    if (!remoteHasData) return;

    final meta = _readSyncMeta(listId);
    final localStamp = math.max(meta.localUpdated, meta.syncedAt);
    final remoteUpdated = remote.updatedAt?.millisecondsSinceEpoch ?? 0;

    if (!localHasData || remoteUpdated > localStamp) {
      await _local.writeWatchlist(
        listId,
        remote.watchlist,
        watched: remote.watched,
      );
      await _writeSyncMeta(
        listId,
        syncedAt: remoteUpdated > 0 ? remoteUpdated : DateTime.now().millisecondsSinceEpoch,
        localUpdated: remoteUpdated > 0 ? remoteUpdated : DateTime.now().millisecondsSinceEpoch,
      );
    }
  }

  ({int localUpdated, int syncedAt}) _readSyncMeta(String listId) {
    final raw = HiveBoxes.preferences.get(StorageKeys.syncMeta(listId));
    if (raw == null) {
      return (localUpdated: 0, syncedAt: 0);
    }

    try {
      final Map<String, dynamic> map;
      if (raw is String) {
        map = jsonDecode(raw) as Map<String, dynamic>;
      } else if (raw is Map) {
        map = Map<String, dynamic>.from(raw);
      } else {
        return (localUpdated: 0, syncedAt: 0);
      }

      return (
        localUpdated: _parseMetaInt(map['localUpdated']),
        syncedAt: _parseMetaInt(map['syncedAt']),
      );
    } catch (_) {
      return (localUpdated: 0, syncedAt: 0);
    }
  }

  int _parseMetaInt(dynamic raw) {
    if (raw is int) return raw;
    if (raw is num) return raw.toInt();
    return int.tryParse(raw?.toString() ?? '') ?? 0;
  }

  Future<void> _writeSyncMeta(
    String listId, {
    required int syncedAt,
    required int localUpdated,
  }) async {
    await HiveBoxes.preferences.put(
      StorageKeys.syncMeta(listId),
      {
        'localUpdated': localUpdated,
        'syncedAt': syncedAt,
      },
    );
  }

  Map<String, WatchEntry> _readWatched(String listId) {
    final raw = HiveBoxes.preferences.get(StorageKeys.watched(listId));
    if (raw == null) return {};
    if (raw is String) {
      try {
        return parseWatchedMap(jsonDecode(raw));
      } catch (_) {
        return {};
      }
    }
    if (raw is Map) {
      return parseWatchedMap(Map<String, dynamic>.from(raw));
    }
    return {};
  }
}

final watchlistRepositoryProvider = Provider<WatchlistRepository>((ref) {
  return WatchlistRepository(
    ref.watch(localStorageRepositoryProvider),
    ref.watch(supabaseSyncRepositoryProvider),
  );
});
