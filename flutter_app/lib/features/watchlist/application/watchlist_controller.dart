import 'dart:async';

import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/config/environment.dart';
import '../../../core/services/session_service.dart';
import '../../../core/utils/share_url.dart';
import '../../../core/utils/watchlist_import.dart';
import '../../../core/utils/watchlist_parser.dart';
import '../../../core/utils/rating_utils.dart';
import '../../../models/session.dart';
import '../../../models/share_snapshot_payload.dart';
import '../../../models/watchlist_item.dart';
import '../../../repositories/auth_repository.dart';
import '../../../repositories/metadata/metadata_service.dart';
import '../../../repositories/watchlist_repository.dart';

import 'poster_enrichment.dart';
import 'watchlist_filters.dart';

// ── Connectivity ──────────────────────────────────────────────────────────────

/// True when the device has at least one non-none connectivity result.
final connectivityProvider =
    StreamProvider<bool>((ref) async* {
  final conn = Connectivity();
  // Emit the current state immediately.
  final initial = await conn.checkConnectivity();
  yield _hasConnection(initial);
  // Then follow changes.
  yield* conn.onConnectivityChanged.map(_hasConnection);
});

bool _hasConnection(List<ConnectivityResult> results) =>
    results.any((r) => r != ConnectivityResult.none);

final watchlistTypeFilterProvider =
    NotifierProvider<WatchlistTypeFilterNotifier, WatchlistTypeFilter>(
  WatchlistTypeFilterNotifier.new,
);

class WatchlistTypeFilterNotifier extends Notifier<WatchlistTypeFilter> {
  @override
  WatchlistTypeFilter build() => WatchlistTypeFilter.all;

  void setFilter(WatchlistTypeFilter filter) => state = filter;
}

class WatchlistFilterNotifier extends Notifier<WatchlistFilterState> {
  @override
  WatchlistFilterState build() => const WatchlistFilterState();

  void setSearch(String value) => state = state.copyWith(search: value);

  void addGenre(String genre) {
    if (state.selectedGenres.contains(genre)) return;
    final next = [...state.selectedGenres, genre]..sort(
        (a, b) => standardGenres.indexOf(a) - standardGenres.indexOf(b),
      );
    state = state.copyWith(selectedGenres: next);
  }

  void removeGenre(String genre) {
    state = state.copyWith(
      selectedGenres: state.selectedGenres.where((g) => g != genre).toList(),
    );
  }

  void setWatchedFilter(WatchedFilter filter) {
    state = state.copyWith(watchedFilter: filter);
  }

  void setSortSource(String source) {
    if (source == 'all') {
      state = state.copyWith(sortSource: 'all', sortDirection: 'newest');
      return;
    }

    var direction = state.sortDirection;
    final prev = state.sortSource;

    if (isDateSortSource(prev) && isDateSortSource(source) && source != prev) {
      direction = state.sortDirection == 'oldest' ? 'oldest' : 'newest';
    } else if (isRatingSortSource(prev) &&
        isRatingSortSource(source) &&
        source != prev) {
      direction = state.sortDirection == 'worst' ? 'worst' : 'best';
    } else if (source != prev) {
      direction = isDateSortSource(source) ? 'newest' : 'best';
    }

    state = state.copyWith(sortSource: source, sortDirection: direction);
  }

  void toggleSortDirection() {
    if (state.sortSource == 'all') return;
    if (isDateSortSource(state.sortSource)) {
      state = state.copyWith(
        sortDirection: state.sortDirection == 'newest' ? 'oldest' : 'newest',
      );
      return;
    }
    if (isRatingSortSource(state.sortSource)) {
      state = state.copyWith(
        sortDirection: state.sortDirection == 'best' ? 'worst' : 'best',
      );
    }
  }

  void clearAll() => state = const WatchlistFilterState();
}

final watchlistFilterProvider =
    NotifierProvider<WatchlistFilterNotifier, WatchlistFilterState>(
  WatchlistFilterNotifier.new,
);

class WatchlistController extends AsyncNotifier<WatchlistSnapshot> {
  /// Serializes local/cloud writes so rapid taps don't race or block the UI.
  Future<void> _persistChain = Future.value();

  @override
  Future<WatchlistSnapshot> build() async {
    final session = ref.watch(sessionProvider);
    if (session == null) {
      return const WatchlistSnapshot(
        items: [],
        watched: {},
        isEmptyList: true,
      );
    }

    ref.listen(sessionProvider, (prev, next) {
      if (prev?.listId != next?.listId && next != null) {
        _activateList(next.listId);
      }
    });

    // React to connectivity changes so the sync chip updates in real-time.
    ref.listen(connectivityProvider, (prev, next) {
      final isOnline = next.valueOrNull ?? true;
      final current = state.valueOrNull;
      if (current == null) return;
      final cloud = ref.read(appConfigProvider).isSupabaseConfigured;
      if (!cloud) return;
      if (!isOnline) {
        state = AsyncData(
          current.copyWith(syncStatus: SyncDisplayStatus.offline),
        );
      } else if (current.syncStatus == SyncDisplayStatus.offline) {
        // Came back online — re-trigger reconcile.
        final listId = ref.read(sessionProvider)?.listId;
        if (listId != null) _scheduleCloudReconcile(listId);
      }
    });

    final listId = session.listId;
    final snapshot = _instantSnapshot(listId);
    _scheduleCloudReconcile(listId);
    return snapshot;
  }

  bool get _isOnline {
    // connectivityProvider is a StreamProvider; read synchronously.
    final asyncOnline = ref.read(connectivityProvider);
    // Default to true (optimistic) while not yet determined.
    return asyncOnline.valueOrNull ?? true;
  }

  WatchlistSnapshot _instantSnapshot(String listId) {
    final cloud = ref.read(appConfigProvider).isSupabaseConfigured;
    final local = ref.read(watchlistRepositoryProvider).readSnapshot(
          listId,
          cloudConfigured: cloud,
        );
    if (!cloud) return local;
    if (!_isOnline) {
      return local.copyWith(syncStatus: SyncDisplayStatus.offline);
    }
    return local.copyWith(syncStatus: SyncDisplayStatus.pending);
  }

  void _activateList(String listId) {
    ref.read(watchlistFilterProvider.notifier).clearAll();
    ref.read(watchlistTypeFilterProvider.notifier).setFilter(WatchlistTypeFilter.all);
    state = AsyncData(_instantSnapshot(listId));
    _scheduleCloudReconcile(listId);
  }

  void _scheduleCloudReconcile(String listId) {
    if (!ref.read(appConfigProvider).isSupabaseConfigured) return;
    if (!_isOnline) return;

    Future(() async {
      final session = ref.read(sessionProvider);
      if (session == null || session.listId != listId) return;

      final listName = ref.read(authRepositoryProvider).listLabel(
                session.listId,
                session.accountId,
              ) ??
          'My list';

      final changed = await ref
          .read(watchlistRepositoryProvider)
          .reconcileWithCloud(
            listId,
            accountId: session.accountId,
            listName: listName,
          );

      // Guard against stale reconcile after list switch or sign-out.
      if (ref.read(sessionProvider)?.listId != listId) return;

      if (changed) {
        final cloud = ref.read(appConfigProvider).isSupabaseConfigured;
        final fresh = ref.read(watchlistRepositoryProvider).readSnapshot(
              listId,
              cloudConfigured: cloud,
            );
        state = AsyncData(
          fresh.copyWith(syncStatus: SyncDisplayStatus.saved),
        );
      } else if (state.hasValue) {
        state = AsyncData(
          state.value!.copyWith(syncStatus: SyncDisplayStatus.saved),
        );
      }
    });
  }

  /// Instant list switch: flush the outgoing list locally, then load the next one.
  /// No modal or delay — background work is cancelled via list-id guards on save.
  Future<void> switchToList(String targetListId) async {
    final session = ref.read(sessionProvider);
    if (session == null || targetListId.isEmpty) return;
    if (session.listId == targetListId) return;

    final snapshot = state.value;
    if (snapshot != null) {
      await _persist(
        session,
        snapshot.items,
        snapshot.watched,
        refresh: false,
        flushCloud: true,
      );
    }

    await ref.read(sessionProvider.notifier).switchList(targetListId);
  }

  Future<String?> saveItem({
    required WatchlistItem item,
    String? editingId,
    bool markWatched = false,
    double? rating,
    String? watchNote,
  }) async {
    final session = ref.read(sessionProvider);
    if (session == null) return 'watchlist.notSignedIn';

    final snapshot = state.value;
    if (snapshot == null) return 'watchlist.notLoaded';

    final duplicate = findDuplicateTitle(
      snapshot.items,
      item,
      excludeId: editingId,
    );
    if (duplicate != null) return 'watchlist.duplicate';

    final items = [...snapshot.items];
    final watched = Map<String, WatchEntry>.from(snapshot.watched);
    final oldId = editingId;

    if (oldId != null) {
      final index = items.indexWhere((i) => i.id == oldId);
      if (index == -1) return 'watchlist.notFound';

      if (oldId != item.id && watched.containsKey(oldId)) {
        watched[item.id] = watched.remove(oldId)!;
      }
      items[index] = item;
    } else {
      items.add(item);
    }

    if (markWatched) {
      watched[item.id] = WatchEntry(
        rating: rating,
        note: watchNote?.trim().isEmpty == true ? null : watchNote?.trim(),
      );
    } else {
      watched.remove(item.id);
    }

    return _persist(session, items, watched);
  }

  Future<String?> saveItemsBulk(List<WatchlistItem> newItems) async {
    if (newItems.isEmpty) return 'bulk.noneAdded';

    final session = ref.read(sessionProvider);
    if (session == null) return 'watchlist.notSignedIn';

    final snapshot = state.value;
    if (snapshot == null) return 'watchlist.notLoaded';

    final metadata = ref.read(metadataServiceProvider);
    final config = ref.read(appConfigProvider);
    final enriched = await enrichItemsWithPosters(
      metadata,
      newItems,
      config: config,
    );

    final items = [...snapshot.items, ...enriched];
    return _persist(session, items, snapshot.watched);
  }

  Future<String?> saveWatchRating({
    required String itemId,
    required double rating,
    String? note,
  }) async {
    final session = ref.read(sessionProvider);
    if (session == null) return 'watchlist.notSignedIn';

    final snapshot = state.value;
    if (snapshot == null) return 'watchlist.notLoaded';

    if (!snapshot.items.any((item) => item.id == itemId)) {
      return 'watchlist.notFound';
    }

    final watched = Map<String, WatchEntry>.from(snapshot.watched);
    watched[itemId] = WatchEntry(
      rating: clampRatingValue(rating),
      note: note?.trim().isEmpty == true ? null : note?.trim(),
    );

    state = AsyncData(
      WatchlistSnapshot(
        items: snapshot.items,
        watched: watched,
        isEmptyList: snapshot.isEmptyList,
        syncStatus: snapshot.syncStatus,
      ),
    );

    _schedulePersist(session, refresh: false);
    return null;
  }

  Future<String?> markWatchedLater(String itemId) async {
    final session = ref.read(sessionProvider);
    if (session == null) return 'watchlist.notSignedIn';

    final snapshot = state.value;
    if (snapshot == null) return 'watchlist.notLoaded';

    if (!snapshot.items.any((item) => item.id == itemId)) {
      return 'watchlist.notFound';
    }

    final watched = Map<String, WatchEntry>.from(snapshot.watched);
    watched.putIfAbsent(itemId, () => const WatchEntry());

    state = AsyncData(
      WatchlistSnapshot(
        items: snapshot.items,
        watched: watched,
        isEmptyList: snapshot.isEmptyList,
        syncStatus: snapshot.syncStatus,
      ),
    );

    _schedulePersist(session, refresh: false);
    return null;
  }

  Future<String?> markUnwatched(String itemId) async {
    final session = ref.read(sessionProvider);
    if (session == null) return 'watchlist.notSignedIn';

    final snapshot = state.value;
    if (snapshot == null) return 'watchlist.notLoaded';

    final watched = Map<String, WatchEntry>.from(snapshot.watched)
      ..remove(itemId);

    state = AsyncData(
      WatchlistSnapshot(
        items: snapshot.items,
        watched: watched,
        isEmptyList: snapshot.isEmptyList,
        syncStatus: snapshot.syncStatus,
      ),
    );

    _schedulePersist(session, refresh: false);
    return null;
  }

  Future<CopyItemToListResult> copyItemToList({
    required String itemId,
    required String targetListId,
  }) async {
    final session = ref.read(sessionProvider);
    if (session == null) {
      return CopyItemToListResult.fail('watchlist.notSignedIn');
    }

    final snapshot = state.value;
    if (snapshot == null) {
      return CopyItemToListResult.fail('watchlist.notLoaded');
    }

    final itemIndex = snapshot.items.indexWhere((entry) => entry.id == itemId);
    if (itemIndex == -1) {
      return CopyItemToListResult.fail('move.titleNotFound');
    }
    final item = snapshot.items[itemIndex];

    final auth = ref.read(authRepositoryProvider);
    final listName =
        auth.listLabel(targetListId, session.accountId) ?? 'My list';

    return ref.read(watchlistRepositoryProvider).copyItemToTargetList(
          item: item,
          watchedEntry: snapshot.watched[itemId],
          sourceListId: session.listId,
          targetListId: targetListId,
          accountId: session.accountId,
          targetListName: listName,
          cloudConfigured: ref.read(appConfigProvider).isSupabaseConfigured,
        );
  }

  Future<String?> deleteItem(String itemId) async {
    final session = ref.read(sessionProvider);
    if (session == null) return 'watchlist.notSignedIn';

    final snapshot = state.value;
    if (snapshot == null) return 'watchlist.notLoaded';

    final items = snapshot.items.where((i) => i.id != itemId).toList();
    final watched = Map<String, WatchEntry>.from(snapshot.watched)
      ..remove(itemId);

    state = AsyncData(
      WatchlistSnapshot(
        items: items,
        watched: watched,
        isEmptyList: items.isEmpty,
        syncStatus: snapshot.syncStatus,
      ),
    );

    return _persist(session, items, watched, refresh: false);
  }

  void _schedulePersist(
    Session session, {
    bool refresh = false,
    bool flushCloud = false,
  }) {
    _persistChain = _persistChain.then((_) async {
      if (ref.read(sessionProvider)?.listId != session.listId) return;
      final snap = state.value;
      if (snap == null) return;
      await _persist(
        session,
        snap.items,
        snap.watched,
        refresh: refresh,
        flushCloud: flushCloud,
      );
    });
  }

  Future<String?> _persist(
    Session session,
    List<WatchlistItem> items,
    Map<String, WatchEntry> watched, {
    bool refresh = true,
    bool flushCloud = false,
  }) async {
    final live = ref.read(sessionProvider);
    if (live == null || live.listId != session.listId) {
      return null;
    }

    // Queued / optimistic paths may update state while an earlier save is in
    // flight — always flush the latest snapshot (web: localStorage is current).
    var itemsToSave = items;
    var watchedToSave = watched;
    if (!refresh) {
      final snap = state.value;
      if (snap != null) {
        itemsToSave = snap.items;
        watchedToSave = snap.watched;
      }
    }

    final cloud = ref.read(appConfigProvider).isSupabaseConfigured;
    final listName = ref.read(authRepositoryProvider).listLabel(
              session.listId,
              session.accountId,
            ) ??
        'My list';

    final result = await ref.read(watchlistRepositoryProvider).saveItems(
          listId: session.listId,
          accountId: session.accountId,
          items: itemsToSave,
          watched: watchedToSave,
          cloudConfigured: cloud,
          listName: listName,
          flushCloud: flushCloud,
        );

    if (refresh) {
      ref.invalidateSelf();
    } else {
      // Never roll back optimistic UI — only refresh sync status.
      final current = state.value;
      if (current != null) {
        state = AsyncData(
          current.copyWith(syncStatus: result.syncStatus),
        );
      }
    }

    if (result.syncStatus == SyncDisplayStatus.error) {
      return 'watchlist.syncFailed';
    }
    if (result.syncStatus == SyncDisplayStatus.pending) {
      unawaited(_schedulePostCloudSync(session));
    }
    return null;
  }

  /// After debounced cloud push, flush + reconcile so sync chip clears (web onComplete).
  Future<void> _schedulePostCloudSync(Session session) async {
    await Future<void>.delayed(const Duration(milliseconds: 950));
    if (ref.read(sessionProvider)?.listId != session.listId) return;

    final repo = ref.read(watchlistRepositoryProvider);
    await repo.flushCloudPush(session.listId);
    if (ref.read(sessionProvider)?.listId != session.listId) return;

    final listName = ref.read(authRepositoryProvider).listLabel(
              session.listId,
              session.accountId,
            ) ??
        'My list';

    await repo.reconcileWithCloud(
      session.listId,
      accountId: session.accountId,
      listName: listName,
    );

    if (ref.read(sessionProvider)?.listId != session.listId) return;

    final cloud = ref.read(appConfigProvider).isSupabaseConfigured;
    final fresh = ref.read(watchlistRepositoryProvider).readSnapshot(
          session.listId,
          cloudConfigured: cloud,
        );
    state = AsyncData(
      fresh.copyWith(syncStatus: SyncDisplayStatus.saved),
    );
  }

  Future<void> reload() async {
    ref.invalidateSelf();
  }

  Future<void> replaceItems(
    List<WatchlistItem> items, {
    bool refresh = false,
    String? expectedListId,
    Map<String, WatchEntry>? watched,
  }) async {
    final session = ref.read(sessionProvider);
    if (session == null) return;

    final listId = expectedListId ?? session.listId;
    if (session.listId != listId) return;

    final snapshot = state.value;
    if (snapshot == null) return;

    final newWatched = watched ?? snapshot.watched;

    state = AsyncData(
      WatchlistSnapshot(
        items: items,
        watched: newWatched,
        isEmptyList: items.isEmpty,
        syncStatus: snapshot.syncStatus,
      ),
    );

    _schedulePersist(session, refresh: refresh);
  }

  /// Update one title in memory (and cloud/local storage when signed in).
  Future<void> upsertItem(WatchlistItem updated, {bool refresh = false}) async {
    final snapshot = state.value;
    if (snapshot == null) return;

    final index = snapshot.items.indexWhere((item) => item.id == updated.id);
    if (index == -1) return;

    final items = [...snapshot.items];
    items[index] = updated;

    // Optimistic update so poster / season fields refresh immediately in UI.
    state = AsyncData(
      WatchlistSnapshot(
        items: items,
        watched: snapshot.watched,
        isEmptyList: items.isEmpty,
        syncStatus: snapshot.syncStatus,
      ),
    );

    final session = ref.read(sessionProvider);
    if (session == null) return;

    _schedulePersist(session, refresh: refresh);
  }

  /// Merge metadata (poster, ratings, year) for one title without a full reload.
  Future<void> patchEnrichedItem(WatchlistItem enriched) async {
    if (!hasValidPoster(enriched)) return;

    final session = ref.read(sessionProvider);
    if (session == null) return;

    final snapshot = state.value;
    if (snapshot == null) return;

    final index = snapshot.items.indexWhere((item) => item.id == enriched.id);
    if (index == -1) return;

    final current = snapshot.items[index];
    if (hasValidPoster(current) && current.poster == enriched.poster) return;

    final items = [...snapshot.items];
    items[index] = enriched;
    state = AsyncData(
      WatchlistSnapshot(
        items: items,
        watched: snapshot.watched,
        isEmptyList: items.isEmpty,
        syncStatus: snapshot.syncStatus,
      ),
    );

    _schedulePersist(session, refresh: false);
  }

  ShareSnapshotPayload? buildSharePayload({
    required String listName,
    String listDescription = '',
  }) {
    final snapshot = state.value;
    if (snapshot == null) return null;

    return buildExportPayload(
      listName: listName,
      listDescription: listDescription,
      items: snapshot.items,
      watched: snapshot.watched,
    );
  }

  Future<({bool ok, String? shareUrl, String? errorKey})> publishShareLink({
    required String listName,
    String listDescription = '',
    required Uri currentUri,
  }) async {
    final payload = buildSharePayload(
      listName: listName,
      listDescription: listDescription,
    );
    if (payload == null) {
      return (ok: false, shareUrl: null, errorKey: 'watchlist.notLoaded');
    }

    final supabase = ref.read(supabaseSyncRepositoryProvider);
    if (supabase == null) {
      return (ok: false, shareUrl: null, errorKey: 'share.needsCloud');
    }

    final published = await supabase.publishShareSnapshot(payload);
    if (!published.ok) {
      return (ok: false, shareUrl: null, errorKey: 'share.publishFailed');
    }

    final shareUrl = buildShareUrl(
      ref.read(appConfigProvider),
      currentUri,
      published.shareId!,
    );
    if (shareUrl.isEmpty) {
      return (ok: false, shareUrl: null, errorKey: 'share.publishFailed');
    }

    return (ok: true, shareUrl: shareUrl, errorKey: null);
  }

  Future<({ShareSnapshotPayload? payload, String? errorKey})>
      fetchShareSnapshot(
    String shareId,
  ) async {
    final supabase = ref.read(supabaseSyncRepositoryProvider);
    if (supabase == null) {
      return (payload: null, errorKey: 'share.needsCloud');
    }

    final result = await supabase.fetchShareSnapshot(shareId);
    if (!result.ok) {
      return (payload: null, errorKey: result.error ?? 'share.invalid');
    }

    return (payload: result.payload, errorKey: null);
  }

  Future<({String? errorKey, ImportMergeResult? merge})> importShare({
    required ShareSnapshotPayload payload,
    bool includeWatched = false,
  }) async {
    final session = ref.read(sessionProvider);
    if (session == null) {
      return (errorKey: 'watchlist.notSignedIn', merge: null);
    }

    final snapshot = state.value;
    if (snapshot == null) {
      return (errorKey: 'watchlist.notLoaded', merge: null);
    }

    if (!payload.isValid) {
      return (errorKey: 'import.empty', merge: null);
    }

    final applied = applyMergeImport(
      currentItems: snapshot.items,
      currentWatched: snapshot.watched,
      payload: payload,
      includeWatched: includeWatched,
    );

    final listName = ref.read(authRepositoryProvider).listLabel(
              session.listId,
              session.accountId,
            ) ??
        'My list';

    final result = await ref.read(watchlistRepositoryProvider).saveItems(
          listId: session.listId,
          accountId: session.accountId,
          items: applied.items,
          watched: applied.watched,
          cloudConfigured: ref.read(appConfigProvider).isSupabaseConfigured,
          listName: listName,
          flushCloud: true,
        );

    ref.invalidateSelf();

    if (result.syncStatus == SyncDisplayStatus.error) {
      return (errorKey: 'watchlist.syncFailed', merge: applied.result);
    }

    return (errorKey: null, merge: applied.result);
  }

  Future<({String? errorKey, String? listName})> importAsNewList({
    required ShareSnapshotPayload payload,
    required String name,
    required String description,
  }) async {
    final session = ref.read(sessionProvider);
    if (session == null) {
      return (errorKey: 'watchlist.notSignedIn', listName: null);
    }

    if (!payload.isValid) {
      return (errorKey: 'import.empty', listName: null);
    }

    final auth = ref.read(authRepositoryProvider);
    final createResult = await auth.createList(
      session: session,
      name: name,
      description: description,
    );

    if (!createResult.ok || createResult.session == null) {
      return (
        errorKey: createResult.errorKey ?? 'import.failed',
        listName: null,
      );
    }

    final newSession = createResult.session!;
    final replaced = applyReplaceImport(payload);

    final saveResult = await ref.read(watchlistRepositoryProvider).saveItems(
          listId: newSession.listId,
          accountId: newSession.accountId,
          items: replaced.items,
          watched: replaced.watched,
          cloudConfigured: ref.read(appConfigProvider).isSupabaseConfigured,
          listName: name.trim(),
          flushCloud: true,
        );

    await ref.read(sessionProvider.notifier).setSession(newSession);
    ref.invalidateSelf();

    if (saveResult.syncStatus == SyncDisplayStatus.error) {
      return (errorKey: 'watchlist.syncFailed', listName: name.trim());
    }

    return (errorKey: null, listName: name.trim());
  }
}

final watchlistControllerProvider =
    AsyncNotifierProvider<WatchlistController, WatchlistSnapshot>(
  WatchlistController.new,
);
