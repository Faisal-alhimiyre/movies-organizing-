import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/config/environment.dart';
import '../../../core/services/session_service.dart';
import '../../../core/utils/share_url.dart';
import '../../../core/utils/watchlist_import.dart';
import '../../../core/utils/watchlist_parser.dart';
import '../../../models/session.dart';
import '../../../models/share_snapshot_payload.dart';
import '../../../models/watchlist_item.dart';
import '../../../repositories/auth_repository.dart';
import '../../../repositories/watchlist_repository.dart';

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

  void setRatingFilter(String value) {
    state = state.copyWith(ratingFilterValue: value);
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

  Future<String?> deleteItem(String itemId) async {
    final session = ref.read(sessionProvider);
    if (session == null) return 'watchlist.notSignedIn';

    final snapshot = state.value;
    if (snapshot == null) return 'watchlist.notLoaded';

    final items = snapshot.items.where((i) => i.id != itemId).toList();
    final watched = Map<String, WatchEntry>.from(snapshot.watched)..remove(itemId);

    return _persist(session, items, watched);
  }

  Future<String?> _persist(
    Session session,
    List<WatchlistItem> items,
    Map<String, WatchEntry> watched,
  ) async {
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

    ref.invalidateSelf();
    if (result.syncStatus == SyncDisplayStatus.error) {
      return 'watchlist.syncFailed';
    }
    return null;
  }

  Future<void> reload() async {
    ref.invalidateSelf();
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

  Future<({ShareSnapshotPayload? payload, String? errorKey})> fetchShareSnapshot(
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
}

final watchlistControllerProvider =
    AsyncNotifierProvider<WatchlistController, WatchlistSnapshot>(
  WatchlistController.new,
);
