import 'dart:async';
import 'dart:convert';
import 'dart:math' as math;

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/constants/storage_keys.dart';
import '../core/storage/hive_boxes.dart';
import '../core/utils/watch_progress.dart';
import '../core/utils/watchlist_parser.dart';
import '../features/lists/application/move_title.dart';
import '../models/watchlist_item.dart';
import 'auth_repository.dart';
import 'local_storage_repository.dart';
import 'supabase_sync_repository.dart';

class CopyItemToListResult {
  const CopyItemToListResult._({
    required this.ok,
    this.listName,
    this.errorKey,
  });

  final bool ok;
  final String? listName;
  final String? errorKey;

  factory CopyItemToListResult.success(String listName) {
    return CopyItemToListResult._(ok: true, listName: listName);
  }

  factory CopyItemToListResult.fail(String errorKey) {
    return CopyItemToListResult._(ok: false, errorKey: errorKey);
  }
}

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

  int get watchedCount => items
      .where((i) =>
          itemProgressStateForId(i.id, watched) == ItemProgressState.watched)
      .length;

  int get inProgressCount => items
      .where((i) =>
          itemProgressStateForId(i.id, watched) == ItemProgressState.inProgress)
      .length;

  WatchlistSnapshot copyWith({
    List<WatchlistItem>? items,
    Map<String, WatchEntry>? watched,
    bool? isEmptyList,
    SyncDisplayStatus? syncStatus,
  }) {
    return WatchlistSnapshot(
      items: items ?? this.items,
      watched: watched ?? this.watched,
      isEmptyList: isEmptyList ?? this.isEmptyList,
      syncStatus: syncStatus ?? this.syncStatus,
    );
  }
}

class WatchlistSaveResult {
  const WatchlistSaveResult({required this.syncStatus});

  final SyncDisplayStatus syncStatus;
}

class _PendingCloudPush {
  _PendingCloudPush({
    required this.listId,
    required this.accountId,
    required this.items,
    required this.watched,
    required this.listName,
  });

  final String listId;
  final String accountId;
  final List<WatchlistItem> items;
  final Map<String, WatchEntry> watched;
  final String listName;
}

/// Mirrors web `sync.js` debounce (`DEBOUNCE_MS = 900`).
class WatchlistRepository {
  WatchlistRepository(this._local, this._supabase);

  final LocalStorageRepository _local;
  final SupabaseSyncRepository? _supabase;

  static const _cloudDebounceMs = 900;

  final Map<String, Timer> _cloudPushTimers = {};
  final Map<String, _PendingCloudPush> _pendingCloudPush = {};
  final Map<String, bool> _cloudPushInFlight = {};

  /// Local cache only — use [reconcileWithCloud] for background sync.
  WatchlistSnapshot readSnapshot(
    String listId, {
    bool cloudConfigured = false,
  }) {
    return _readSnapshot(listId, cloudConfigured: cloudConfigured);
  }

  /// Pulls remote snapshot when newer than local. Returns true if local data changed.
  Future<bool> reconcileWithCloud(
    String listId, {
    String? accountId,
    String listName = 'My list',
  }) async {
    return _reconcileWithCloud(
      listId,
      accountId: accountId,
      listName: listName,
    );
  }

  /// Writes local storage immediately; cloud push is debounced (web parity).
  Future<WatchlistSaveResult> saveItems({
    required String listId,
    required String accountId,
    required List<WatchlistItem> items,
    required Map<String, WatchEntry> watched,
    bool cloudConfigured = false,
    String listName = 'My list',
    bool flushCloud = false,
  }) async {
    final nested = itemsToNested(items);
    final watchedJson = watchedMapToJson(watched);
    final now = DateTime.now().millisecondsSinceEpoch;

    await _local.writeWatchlist(listId, nested, watched: watchedJson);
    await _writeSyncMeta(listId, localUpdated: now, syncedAt: _readSyncMeta(listId).syncedAt);

    if (!cloudConfigured || _supabase == null) {
      return const WatchlistSaveResult(syncStatus: SyncDisplayStatus.local);
    }

    _pendingCloudPush[listId] = _PendingCloudPush(
      listId: listId,
      accountId: accountId,
      items: items,
      watched: watched,
      listName: listName,
    );

    if (flushCloud) {
      final ok = await flushCloudPush(listId);
      return WatchlistSaveResult(
        syncStatus: ok ? SyncDisplayStatus.saved : SyncDisplayStatus.error,
      );
    }

    _scheduleCloudPush(listId);
    return const WatchlistSaveResult(syncStatus: SyncDisplayStatus.pending);
  }

  /// Push any debounced cloud save immediately (e.g. before switching lists).
  Future<bool> flushCloudPush(String listId) async {
    _cloudPushTimers.remove(listId)?.cancel();
    return _executeCloudPush(listId);
  }

  Future<CopyItemToListResult> copyItemToTargetList({
    required WatchlistItem item,
    required WatchEntry? watchedEntry,
    required String sourceListId,
    required String targetListId,
    required String accountId,
    required String targetListName,
    bool cloudConfigured = false,
  }) async {
    final targetData = _local.readWatchlist(targetListId);
    final targetItems =
        targetData != null ? flattenWatchlist(targetData) : <WatchlistItem>[];
    final copy = buildListItemCopy(item);

    final validationError = copyItemValidationError(
      sourceListId: sourceListId,
      targetListId: targetListId,
      targetItems: targetItems,
      copy: copy,
    );
    if (validationError != null) {
      return CopyItemToListResult.fail(validationError);
    }

    targetItems.add(copy);
    final targetWatched =
        Map<String, WatchEntry>.from(_readWatched(targetListId));
    if (watchedEntry != null) {
      targetWatched[copy.id] = WatchEntry(
        rating: watchedEntry.rating,
        note: watchedEntry.note,
        progress: watchedEntry.progress,
      );
    }

    final result = await saveItems(
      listId: targetListId,
      accountId: accountId,
      items: targetItems,
      watched: targetWatched,
      cloudConfigured: cloudConfigured,
      listName: targetListName,
      flushCloud: true,
    );

    if (result.syncStatus == SyncDisplayStatus.error) {
      return CopyItemToListResult.fail('watchlist.syncFailed');
    }

    return CopyItemToListResult.success(targetListName);
  }

  void _scheduleCloudPush(String listId) {
    _cloudPushTimers.remove(listId)?.cancel();
    _cloudPushTimers[listId] = Timer(
      const Duration(milliseconds: _cloudDebounceMs),
      () {
        unawaited(_executeCloudPush(listId));
      },
    );
  }

  Future<bool> _executeCloudPush(String listId) async {
    final supabase = _supabase;
    final pending = _pendingCloudPush.remove(listId);
    if (supabase == null || pending == null || pending.listId != listId) {
      return false;
    }

    if (_cloudPushInFlight[listId] == true) {
      _pendingCloudPush[listId] = pending;
      _scheduleCloudPush(listId);
      return false;
    }

    _cloudPushInFlight[listId] = true;
    try {
      final nested = itemsToNested(pending.items);
      final watchedJson = watchedMapToJson(pending.watched);
      final now = DateTime.now().millisecondsSinceEpoch;

      final pushed = await supabase.pushSnapshot(
        listId: pending.listId,
        accountId: pending.accountId,
        watchlist: nested,
        watched: watchedJson,
        listName: pending.listName,
      );

      if (pushed) {
        await _writeSyncMeta(
          listId,
          localUpdated: now,
          syncedAt: now,
        );
        return true;
      }
      return false;
    } finally {
      _cloudPushInFlight[listId] = false;
      if (_pendingCloudPush.containsKey(listId)) {
        _scheduleCloudPush(listId);
      }
    }
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
        syncStatus:
            cloudConfigured ? SyncDisplayStatus.saved : SyncDisplayStatus.local,
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

  Future<bool> _reconcileWithCloud(
    String listId, {
    String? accountId,
    String listName = 'My list',
  }) async {
    final supabase = _supabase;
    if (supabase == null) return false;
    if (_cloudPushInFlight[listId] == true) return false;
    if (_pendingCloudPush.containsKey(listId)) return false;

    final localData = _local.readWatchlist(listId);
    final localWatched = _readWatched(listId);
    final localHasData = localData != null && !localData.isEmpty;

    final remote = await supabase.fetchSnapshot(listId);
    if (remote == null) {
      if (localHasData && accountId != null && accountId.isNotEmpty) {
        _pendingCloudPush[listId] = _PendingCloudPush(
          listId: listId,
          accountId: accountId,
          items: flattenWatchlist(localData),
          watched: localWatched,
          listName: listName,
        );
        return await _executeCloudPush(listId);
      }
      return false;
    }

    final remoteHasData = !remote.watchlist.isEmpty;
    if (!remoteHasData) return false;

    final meta = _readSyncMeta(listId);
    final localStamp = math.max(meta.localUpdated, meta.syncedAt);
    final remoteUpdated = remote.updatedAt?.millisecondsSinceEpoch ?? 0;

    // Local is newer — push up (matches web `reconcileWithCloud`).
    if (localHasData &&
        localStamp > remoteUpdated &&
        accountId != null &&
        accountId.isNotEmpty) {
      _pendingCloudPush[listId] = _PendingCloudPush(
        listId: listId,
        accountId: accountId,
        items: flattenWatchlist(localData),
        watched: localWatched,
        listName: listName,
      );
      return await _executeCloudPush(listId);
    }

    if (!localHasData || remoteUpdated > localStamp) {
      if (_cloudPushInFlight[listId] == true ||
          _pendingCloudPush.containsKey(listId)) {
        return false;
      }

      final remoteWatched = parseWatchedMap(remote.watched);
      final mergedWatched = localHasData
          ? mergeWatchedPreferRicher(remoteWatched, localWatched)
          : remoteWatched;

      await _local.writeWatchlist(
        listId,
        remote.watchlist,
        watched: watchedMapToJson(mergedWatched),
      );
      await _writeSyncMeta(
        listId,
        syncedAt: remoteUpdated > 0
            ? remoteUpdated
            : DateTime.now().millisecondsSinceEpoch,
        localUpdated: remoteUpdated > 0
            ? remoteUpdated
            : DateTime.now().millisecondsSinceEpoch,
      );
      return true;
    }

    return false;
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

/// Union watched maps; keep the entry with more progress (never drop local watch state).
Map<String, WatchEntry> mergeWatchedPreferRicher(
  Map<String, WatchEntry> remote,
  Map<String, WatchEntry> local,
) {
  final merged = Map<String, WatchEntry>.from(remote);
  for (final entry in local.entries) {
    final existing = merged[entry.key];
    if (existing == null) {
      merged[entry.key] = entry.value;
    } else {
      merged[entry.key] = _richerWatchEntry(existing, entry.value);
    }
  }
  return merged;
}

int _watchEntryRichness(WatchEntry entry) {
  if (entry.isFullyWatched) {
    return 1000 + (entry.rating != null ? 1 : 0) + (entry.note?.isNotEmpty == true ? 1 : 0);
  }
  final prog = entry.progress;
  if (prog != null) {
    return 100 +
        prog.episodes.length +
        (prog.completed == true ? 500 : 0) +
        (prog.episodeRatings?.length ?? 0);
  }
  if (entry.rating != null || (entry.note?.isNotEmpty == true)) return 10;
  return entry.isLegacyComplete ? 5 : 0;
}

WatchEntry _richerWatchEntry(WatchEntry a, WatchEntry b) {
  return _watchEntryRichness(a) >= _watchEntryRichness(b) ? a : b;
}

final watchlistRepositoryProvider = Provider<WatchlistRepository>((ref) {
  return WatchlistRepository(
    ref.watch(localStorageRepositoryProvider),
    ref.watch(supabaseSyncRepositoryProvider),
  );
});
