import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/config/environment.dart';
import '../../../core/services/session_service.dart';
import '../../../models/watchlist_item.dart';
import '../../../repositories/watchlist_repository.dart';
import 'year_backfill.dart';
import 'watchlist_controller.dart';
import 'watchlist_filters.dart';
import 'year_backfill_service.dart';

class YearBackfillProgress {
  const YearBackfillProgress({
    this.running = false,
    this.done = 0,
    this.total = 0,
  });

  final bool running;
  final int done;
  final int total;

  YearBackfillProgress copyWith({
    bool? running,
    int? done,
    int? total,
  }) {
    return YearBackfillProgress(
      running: running ?? this.running,
      done: done ?? this.done,
      total: total ?? this.total,
    );
  }
}

class YearBackfillController extends Notifier<YearBackfillProgress> {
  bool _runScheduled = false;

  @override
  YearBackfillProgress build() => const YearBackfillProgress();

  Future<void> runIfNeeded() async {
    if (state.running || _runScheduled) return;
    if (!isReleaseSortActive(ref.read(watchlistFilterProvider))) return;

    final snapshot = ref.read(watchlistControllerProvider).value;
    if (snapshot == null) return;

    final queue =
        snapshot.items.where(itemNeedsYearBackfill).toList(growable: false);
    if (queue.isEmpty) return;

    final config = ref.read(appConfigProvider);
    if (yearBackfillNeedsMovieApiKeys(snapshot.items, config)) return;

    _runScheduled = true;
    try {
      await _run(queue, snapshot);
    } finally {
      _runScheduled = false;
    }
  }

  Future<void> _run(
    List<WatchlistItem> queue,
    WatchlistSnapshot snapshot,
  ) async {
    final session = ref.read(sessionProvider);
    if (session == null) return;
    final listId = session.listId;
    final watched = Map<String, WatchEntry>.from(snapshot.watched);

    state = YearBackfillProgress(running: true, total: queue.length);

    final service = ref.read(yearBackfillServiceProvider);
    final controller = ref.read(watchlistControllerProvider.notifier);
    var items = [...snapshot.items];
    var done = 0;
    var updated = 0;

    for (final item in queue) {
      if (ref.read(sessionProvider)?.listId != listId) break;
      try {
        final result = await service.fetchYearForItem(item);
        if (result?.year != null) {
          final index = items.indexWhere((entry) => entry.id == item.id);
          if (index != -1) {
            items[index] = applyYearBackfillResult(
              items[index],
              year: result!.year,
              anilistRating: result.anilistRating,
            );
            updated += 1;
            if (updated % 3 == 0) {
              await controller.replaceItems(
                items,
                expectedListId: listId,
                watched: watched,
              );
            }
          }
        }
      } catch (_) {
        // Best-effort per title, same as web.
      }

      done += 1;
      state = state.copyWith(done: done);
      await Future<void>.delayed(const Duration(milliseconds: 280));
    }

    state = const YearBackfillProgress();

    if (updated > 0 && ref.read(sessionProvider)?.listId == listId) {
      await controller.replaceItems(
        items,
        expectedListId: listId,
        watched: watched,
        refresh: true,
      );
    }
  }
}

final yearBackfillControllerProvider =
    NotifierProvider<YearBackfillController, YearBackfillProgress>(
  YearBackfillController.new,
);
