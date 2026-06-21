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
      if (prev?.listId != next?.listId) {
        ref.invalidateSelf();
      }
    });

    final cloud = ref.watch(appConfigProvider).isSupabaseConfigured;
    return ref.read(watchlistRepositoryProvider).load(
          session.listId,
          cloudConfigured: cloud,
        );
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

    return _persist(session, snapshot.items, watched);
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

    return _persist(session, snapshot.items, watched);
  }

  Future<String?> markUnwatched(String itemId) async {
    final session = ref.read(sessionProvider);
    if (session == null) return 'watchlist.notSignedIn';

    final snapshot = state.value;
    if (snapshot == null) return 'watchlist.notLoaded';

    final watched = Map<String, WatchEntry>.from(snapshot.watched)
      ..remove(itemId);

    return _persist(session, snapshot.items, watched);
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

    return _persist(session, items, watched);
  }

  Future<String?> _persist(
    Session session,
    List<WatchlistItem> items,
    Map<String, WatchEntry> watched, {
    bool refresh = true,
  }) async {
    final cloud = ref.read(appConfigProvider).isSupabaseConfigured;
    final listName = ref.read(authRepositoryProvider).listLabel(
              session.listId,
              session.accountId,
            ) ??
        'My list';

    final result = await ref.read(watchlistRepositoryProvider).saveItems(
          listId: session.listId,
          accountId: session.accountId,
          items: items,
          watched: watched,
          cloudConfigured: cloud,
          listName: listName,
        );

    if (refresh) {
      ref.invalidateSelf();
    } else {
      state = AsyncData(
        WatchlistSnapshot(
          items: items,
          watched: watched,
          isEmptyList: items.isEmpty,
          syncStatus: result.syncStatus,
        ),
      );
    }

    if (result.syncStatus == SyncDisplayStatus.error) {
      return 'watchlist.syncFailed';
    }
    return null;
  }

  Future<void> reload() async {
    ref.invalidateSelf();
  }

  Future<void> replaceItems(
    List<WatchlistItem> items, {
    bool refresh = false,
  }) async {
    final session = ref.read(sessionProvider);
    if (session == null) return;

    final snapshot = state.value;
    if (snapshot == null) return;

    await _persist(
      session,
      items,
      snapshot.watched,
      refresh: refresh,
    );
  }

  /// Update one title in memory (and cloud/local storage when signed in).
  Future<void> upsertItem(WatchlistItem updated, {bool refresh = false}) async {
    final snapshot = state.value;
    if (snapshot == null) return;

    final index = snapshot.items.indexWhere((item) => item.id == updated.id);
    if (index == -1) return;

    final items = [...snapshot.items];
    items[index] = updated;

    final session = ref.read(sessionProvider);
    if (session == null) {
      state = AsyncData(
        WatchlistSnapshot(
          items: items,
          watched: snapshot.watched,
          isEmptyList: items.isEmpty,
          syncStatus: snapshot.syncStatus,
        ),
      );
      return;
    }

    await _persist(session, items, snapshot.watched, refresh: refresh);
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
    await _persist(session, items, snapshot.watched, refresh: false);
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
