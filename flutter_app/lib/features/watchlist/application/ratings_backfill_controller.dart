import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/services/session_service.dart';
import '../../../models/watchlist_item.dart';
import '../../../repositories/watchlist_repository.dart';
import 'ratings_backfill.dart';
import 'ratings_backfill_service.dart';
import 'watchlist_controller.dart';
import 'watchlist_filters.dart';
import 'year_backfill_controller.dart';

enum RatingsBackfillPhase { anilist, imdb }

class RatingsBackfillProgress {
  const RatingsBackfillProgress({
    this.running = false,
    this.done = 0,
    this.total = 0,
    this.phase = RatingsBackfillPhase.anilist,
  });

  final bool running;
  final int done;
  final int total;
  final RatingsBackfillPhase phase;

  RatingsBackfillProgress copyWith({
    bool? running,
    int? done,
    int? total,
    RatingsBackfillPhase? phase,
  }) {
    return RatingsBackfillProgress(
      running: running ?? this.running,
      done: done ?? this.done,
      total: total ?? this.total,
      phase: phase ?? this.phase,
    );
  }
}

class RatingsBackfillOrchestrator extends ConsumerStatefulWidget {
  const RatingsBackfillOrchestrator({super.key});

  @override
  ConsumerState<RatingsBackfillOrchestrator> createState() =>
      _RatingsBackfillOrchestratorState();
}

class _RatingsBackfillOrchestratorState
    extends ConsumerState<RatingsBackfillOrchestrator> {
  var _bootstrapped = false;

  void _schedule() {
    WidgetsBinding.instance.addPostFrameCallback((_) async {
      if (!mounted) return;
      final filters = ref.read(watchlistFilterProvider);
      if (isReleaseSortActive(filters)) {
        await ref.read(yearBackfillControllerProvider.notifier).runIfNeeded();
      }
      if (!mounted) return;
      await ref.read(ratingsBackfillControllerProvider.notifier).runIfNeeded();
      if (!mounted) return;
      if (!isReleaseSortActive(filters)) {
        await ref.read(yearBackfillControllerProvider.notifier).runIfNeeded();
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    if (!_bootstrapped) {
      _bootstrapped = true;
      _schedule();
    }

    ref.listen(watchlistFilterProvider, (previous, next) {
      if (next.sortSource == 'imdb' && previous?.sortSource != 'imdb') {
        _schedule();
      }
      if (next.sortSource == 'anilist' && previous?.sortSource != 'anilist') {
        _schedule();
      }
      if (next.sortSource == 'release' && previous?.sortSource != 'release') {
        _schedule();
      }
    });

    ref.listen(watchlistControllerProvider, (previous, next) {
      if (next.hasValue && (previous?.isLoading ?? true)) {
        _schedule();
      }
    });

    return const SizedBox.shrink();
  }
}

class RatingsBackfillController extends Notifier<RatingsBackfillProgress> {
  bool _runScheduled = false;

  @override
  RatingsBackfillProgress build() => const RatingsBackfillProgress();

  Future<void> runIfNeeded() async {
    if (state.running || _runScheduled) return;

    final snapshot = ref.read(watchlistControllerProvider).value;
    if (snapshot == null) return;

    final anilistQueue =
        snapshot.items.where(itemNeedsAnilistBackfill).toList(growable: false);
    final imdbQueue =
        snapshot.items.where(itemNeedsImdbBackfill).toList(growable: false);

    if (anilistQueue.isEmpty && imdbQueue.isEmpty) return;

    _runScheduled = true;
    try {
      await _run(anilistQueue, imdbQueue, snapshot);
    } finally {
      _runScheduled = false;
    }
  }

  Future<void> _run(
    List<WatchlistItem> anilistQueue,
    List<WatchlistItem> imdbQueue,
    WatchlistSnapshot snapshot,
  ) async {
    final session = ref.read(sessionProvider);
    if (session == null) return;
    final listId = session.listId;
    final watched = Map<String, WatchEntry>.from(snapshot.watched);

    final total = anilistQueue.length + imdbQueue.length;
    state = RatingsBackfillProgress(
      running: true,
      total: total,
      phase: anilistQueue.isNotEmpty
          ? RatingsBackfillPhase.anilist
          : RatingsBackfillPhase.imdb,
    );

    final service = ref.read(ratingsBackfillServiceProvider);
    final controller = ref.read(watchlistControllerProvider.notifier);
    var items = [...snapshot.items];
    var done = 0;
    var updated = 0;

    for (final item in anilistQueue) {
      if (ref.read(sessionProvider)?.listId != listId) break;
      try {
        final result = await service.fetchAnilistRatingForItem(item);
        if (result?.anilistRating != null) {
          final index = items.indexWhere((entry) => entry.id == item.id);
          if (index != -1) {
            items[index] = applyRatingsBackfillResult(
              items[index],
              anilistRating: result!.anilistRating,
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
        // Best-effort per title.
      }

      done += 1;
      state = state.copyWith(done: done);
      await Future<void>.delayed(const Duration(milliseconds: 320));
    }

    if (imdbQueue.isNotEmpty) {
      state = state.copyWith(phase: RatingsBackfillPhase.imdb);
    }

    for (final item in imdbQueue) {
      if (ref.read(sessionProvider)?.listId != listId) break;
      try {
        final result = await service.fetchImdbRatingForItem(item);
        if (result?.imdbRating != null) {
          final index = items.indexWhere((entry) => entry.id == item.id);
          if (index != -1) {
            items[index] = applyRatingsBackfillResult(
              items[index],
              imdbRating: result!.imdbRating,
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
        // Best-effort per title.
      }

      done += 1;
      state = state.copyWith(done: done);
      await Future<void>.delayed(const Duration(milliseconds: 280));
    }

    state = const RatingsBackfillProgress();

    if (updated > 0 && ref.read(sessionProvider)?.listId == listId) {
      await controller.replaceItems(
        items,
        expectedListId: listId,
        watched: watched,
        refresh: false,
      );
    }
  }
}

final ratingsBackfillControllerProvider =
    NotifierProvider<RatingsBackfillController, RatingsBackfillProgress>(
  RatingsBackfillController.new,
);
