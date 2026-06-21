import 'package:flutter/foundation.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../core/utils/watchlist_sync_converter.dart';
import '../models/share_snapshot_payload.dart';
import '../models/watchlist_data.dart';

class AccountListMigrationPayload {
  const AccountListMigrationPayload({
    required this.listId,
    required this.name,
    required this.description,
    required this.watchlist,
    required this.watched,
  });

  final String listId;
  final String name;
  final String description;
  final WatchlistData watchlist;
  final Map<String, dynamic> watched;
}

class RemoteListRow {
  const RemoteListRow({
    required this.listId,
    required this.name,
    this.description = '',
    this.titleCount = 0,
    this.watchedCount = 0,
  });

  final String listId;
  final String name;
  final String description;
  final int titleCount;
  final int watchedCount;

  factory RemoteListRow.fromJson(Map<String, dynamic> json) {
    return RemoteListRow(
      listId: json['list_id'] as String? ?? '',
      name: json['name'] as String? ?? 'My list',
      description: json['description'] as String? ?? '',
      titleCount: _parseCount(json['title_count']),
      watchedCount: _parseCount(json['watched_count']),
    );
  }
}

int _parseCount(dynamic raw) {
  if (raw is int) return raw;
  if (raw is num) return raw.round();
  return int.tryParse(raw?.toString() ?? '') ?? 0;
}

class RemoteListSnapshot {
  const RemoteListSnapshot({
    required this.watchlist,
    required this.watched,
    required this.name,
    this.description = '',
    this.updatedAt,
  });

  final WatchlistData watchlist;
  final Map<String, dynamic> watched;
  final String name;
  final String description;
  final DateTime? updatedAt;
}

/// Minimal Supabase reads/writes for auth — mirrors `web-files/js/sync.js`.
class SupabaseSyncRepository {
  SupabaseSyncRepository(this._client);

  final SupabaseClient? _client;

  static const accountsTable = 'accounts';
  static const listsTable = 'lists';
  static const itemsTable = 'watchlist_items';
  static const snapshotsTable = 'list_snapshots';

  Future<bool> accountExists(String accountId) async {
    final client = _client;
    if (client == null || accountId.isEmpty) return false;

    try {
      final accountResult = await client
          .from(accountsTable)
          .select('account_id')
          .eq('account_id', accountId)
          .maybeSingle();

      if (accountResult != null) return true;

      final listsResult = await client
          .from(listsTable)
          .select('list_id')
          .eq('account_id', accountId)
          .limit(1);

      if (listsResult is List && listsResult.isNotEmpty) return true;
    } catch (_) {
      return false;
    }

    return false;
  }

  Future<List<RemoteListRow>> fetchListsForAccount(String accountId) async {
    final client = _client;
    if (client == null || accountId.isEmpty) return [];

    try {
      final data = await client
          .from(listsTable)
          .select(
              'list_id, name, description, title_count, watched_count, updated_at')
          .eq('account_id', accountId)
          .order('updated_at');

      if (data is! List) return [];

      return data
          .whereType<Map>()
          .map((row) => RemoteListRow.fromJson(Map<String, dynamic>.from(row)))
          .where((row) => row.listId.isNotEmpty)
          .toList();
    } catch (_) {
      return [];
    }
  }

  /// Pull list metadata + items (`sync.js` → `fetchSnapshot`).
  Future<RemoteListSnapshot?> fetchSnapshot(String listId) async {
    final client = _client;
    if (client == null || listId.isEmpty) return null;

    try {
      final listRow = await client
          .from(listsTable)
          .select('account_id, name, description, updated_at')
          .eq('list_id', listId)
          .maybeSingle();

      final itemsResult =
          await client.from(itemsTable).select().eq('list_id', listId);

      final rows = <Map<String, dynamic>>[];
      if (itemsResult is List) {
        for (final item in itemsResult) {
          if (item is Map) {
            rows.add(Map<String, dynamic>.from(item));
          }
        }
      }

      if (listRow == null && rows.isEmpty) return null;

      final converted = rowsToWatchlist(rows);
      final listMap = listRow == null
          ? <String, dynamic>{}
          : Map<String, dynamic>.from(listRow);

      DateTime? updatedAt;
      final updatedRaw = listMap['updated_at']?.toString();
      if (updatedRaw != null && updatedRaw.isNotEmpty) {
        updatedAt = DateTime.tryParse(updatedRaw);
      }

      return RemoteListSnapshot(
        watchlist: converted.watchlist,
        watched: converted.watched,
        name: listMap['name']?.toString() ?? 'My list',
        description: listMap['description']?.toString() ?? '',
        updatedAt: updatedAt,
      );
    } catch (_) {
      return null;
    }
  }

  /// Full list replace (`sync.js` → `pushSnapshot`).
  Future<bool> pushSnapshot({
    required String listId,
    required String accountId,
    required WatchlistData watchlist,
    required Map<String, dynamic> watched,
    String listName = 'My list',
    String description = '',
  }) async {
    final client = _client;
    if (client == null || listId.isEmpty || accountId.isEmpty) return false;

    try {
      final existingAddedAt = <String, dynamic>{};
      final existingRows = await client
          .from(itemsTable)
          .select('item_id, added_at')
          .eq('list_id', listId);
      for (final row in existingRows as List) {
        final map = Map<String, dynamic>.from(row as Map);
        final itemId = map['item_id']?.toString() ?? '';
        if (itemId.isNotEmpty) {
          existingAddedAt[itemId] = map['added_at'];
        }
      }

      final rows = watchlistToRows(
        listId,
        watchlist,
        watched,
        existingAddedAt: existingAddedAt,
      );
      final titleCount = rows.length;
      final watchedCount = rows.where((row) => row['watched'] == true).length;
      final now = DateTime.now().toUtc().toIso8601String();

      await client.from(accountsTable).upsert(
        {'account_id': accountId, 'updated_at': now},
        onConflict: 'account_id',
      );

      await client.from(listsTable).upsert(
        {
          'list_id': listId,
          'account_id': accountId,
          'name': listName,
          'description': description,
          'updated_at': now,
        },
        onConflict: 'list_id',
      );

      await client.from(itemsTable).delete().eq('list_id', listId);

      if (rows.isNotEmpty) {
        await client.from(itemsTable).insert(rows);
      }

      await client.from(listsTable).update({
        'title_count': titleCount,
        'watched_count': watchedCount,
        'updated_at': now,
      }).eq('list_id', listId);

      return true;
    } catch (error, stackTrace) {
      debugPrint('[sync] pushSnapshot failed: $error\n$stackTrace');
      return false;
    }
  }

  Future<({bool ok, String? shareId, String? error})> publishShareSnapshot(
    ShareSnapshotPayload payload,
  ) async {
    final client = _client;
    if (client == null || !payload.isValid) {
      return (ok: false, shareId: null, error: 'not_configured');
    }

    try {
      final shareId =
          'share-${DateTime.now().millisecondsSinceEpoch}-${DateTime.now().microsecondsSinceEpoch.toRadixString(36)}';

      await client.from(snapshotsTable).insert({
        'share_id': shareId,
        'list_name': payload.listName,
        'title_count': payload.titleCount,
        'payload': payload.toJson(),
      });

      return (ok: true, shareId: shareId, error: null);
    } catch (error, stackTrace) {
      debugPrint('[sync] publishShareSnapshot failed: $error\n$stackTrace');
      return (ok: false, shareId: null, error: 'publish_failed');
    }
  }

  Future<({bool ok, ShareSnapshotPayload? payload, String? error})>
      fetchShareSnapshot(String shareId) async {
    final client = _client;
    if (client == null || shareId.isEmpty) {
      return (ok: false, payload: null, error: 'not_configured');
    }

    try {
      final data = await client
          .from(snapshotsTable)
          .select('payload, expires_at')
          .eq('share_id', shareId)
          .maybeSingle();

      if (data == null) {
        return (ok: false, payload: null, error: 'not_found');
      }

      final map = Map<String, dynamic>.from(data);
      final expiresAt = map['expires_at']?.toString();
      if (expiresAt != null && expiresAt.isNotEmpty) {
        final expiry = DateTime.tryParse(expiresAt);
        if (expiry != null && expiry.isBefore(DateTime.now().toUtc())) {
          return (ok: false, payload: null, error: 'expired');
        }
      }

      final payloadRaw = map['payload'];
      if (payloadRaw is! Map) {
        return (ok: false, payload: null, error: 'not_found');
      }

      final payload =
          ShareSnapshotPayload.fromJson(Map<String, dynamic>.from(payloadRaw));
      if (!payload.isValid) {
        return (ok: false, payload: null, error: 'empty');
      }

      return (ok: true, payload: payload, error: null);
    } catch (_) {
      return (ok: false, payload: null, error: 'not_found');
    }
  }

  /// Registers account + default list in Supabase (`sync.js` → `createListRow`).
  Future<bool> createListRow({
    required String accountId,
    required String listId,
    String name = 'My list',
    String description = '',
  }) async {
    final client = _client;
    if (client == null || accountId.isEmpty || listId.isEmpty) return false;

    try {
      final now = DateTime.now().toUtc().toIso8601String();

      await client.from(accountsTable).upsert(
        {'account_id': accountId, 'updated_at': now},
        onConflict: 'account_id',
      );

      await client.from(listsTable).upsert(
        {
          'list_id': listId,
          'account_id': accountId,
          'name': name,
          'description': description,
          'updated_at': now,
        },
        onConflict: 'list_id',
      );

      return true;
    } catch (error, stackTrace) {
      debugPrint('[sync] createListRow failed: $error\n$stackTrace');
      return false;
    }
  }

  Future<bool> updateListMeta({
    required String listId,
    required String accountId,
    required String name,
    String description = '',
  }) async {
    final client = _client;
    if (client == null || listId.isEmpty || accountId.isEmpty) return false;

    try {
      final now = DateTime.now().toUtc().toIso8601String();

      await client.from(accountsTable).upsert(
        {'account_id': accountId, 'updated_at': now},
        onConflict: 'account_id',
      );

      await client.from(listsTable).upsert(
        {
          'list_id': listId,
          'account_id': accountId,
          'name': name.isNotEmpty ? name : 'My list',
          'description': description,
          'updated_at': now,
        },
        onConflict: 'list_id',
      );

      return true;
    } catch (error, stackTrace) {
      debugPrint('[sync] updateListMeta failed: $error\n$stackTrace');
      return false;
    }
  }

  Future<bool> deleteList(String listId) async {
    final client = _client;
    if (client == null || listId.isEmpty) return false;

    try {
      await client.from(itemsTable).delete().eq('list_id', listId);
      await client.from(listsTable).delete().eq('list_id', listId);
      return true;
    } catch (error, stackTrace) {
      debugPrint('[sync] deleteList failed: $error\n$stackTrace');
      return false;
    }
  }

  Future<bool> deleteAccount(String accountId) async {
    final client = _client;
    if (client == null || accountId.isEmpty) return false;

    try {
      await client.from(accountsTable).delete().eq('account_id', accountId);
      return true;
    } catch (error, stackTrace) {
      debugPrint('[sync] deleteAccount failed: $error\n$stackTrace');
      return false;
    }
  }

  Future<bool> migrateAccount({
    required String oldAccountId,
    required String newAccountId,
    required List<AccountListMigrationPayload> lists,
  }) async {
    final client = _client;
    if (client == null || oldAccountId.isEmpty || newAccountId.isEmpty) {
      return false;
    }

    try {
      for (final entry in lists) {
        final pushed = await pushSnapshot(
          listId: entry.listId,
          accountId: newAccountId,
          watchlist: entry.watchlist,
          watched: entry.watched,
          listName: entry.name,
          description: entry.description,
        );
        if (!pushed) return false;
      }

      if (oldAccountId == newAccountId) return true;

      await client.from(accountsTable).delete().eq('account_id', oldAccountId);
      return true;
    } catch (error, stackTrace) {
      debugPrint('[sync] migrateAccount failed: $error\n$stackTrace');
      return false;
    }
  }
}
