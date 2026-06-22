import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/config/environment.dart';
import '../../../core/services/session_service.dart';
import '../../../models/watchlist_item.dart';
import '../../../repositories/metadata/metadata_service.dart';
import '../../../repositories/watchlist_repository.dart';
import 'poster_enrichment.dart';
import 'watchlist_controller.dart';

class PosterBackfillOrchestrator extends ConsumerStatefulWidget {
  const PosterBackfillOrchestrator({super.key});

  @override
  ConsumerState<PosterBackfillOrchestrator> createState() =>
      _PosterBackfillOrchestratorState();
}

class _PosterBackfillOrchestratorState
    extends ConsumerState<PosterBackfillOrchestrator> {
  var _bootstrapped = false;

  void _scheduleBackfill() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      ref.read(posterBackfillControllerProvider.notifier).runIfNeeded();
    });
  }

  @override
  Widget build(BuildContext context) {
    if (!_bootstrapped) {
      _bootstrapped = true;
      _scheduleBackfill();
    }

    ref.listen(watchlistControllerProvider, (previous, next) {
      if (next.hasValue) {
        _scheduleBackfill();
      }
    });

    return const SizedBox.shrink();
  }
}

class PosterBackfillController extends Notifier<bool> {
  bool _runScheduled = false;

  @override
  bool build() => false;

  Future<void> runIfNeeded() async {
    if (state || _runScheduled) return;

    final snapshot = ref.read(watchlistControllerProvider).value;
    if (snapshot == null) return;

    final queue =
        snapshot.items.where(itemNeedsPosterBackfill).toList(growable: false);
    if (queue.isEmpty) return;

    final config = ref.read(appConfigProvider);
    if (posterBackfillNeedsMovieApiKeys(snapshot.items, config)) return;

    _runScheduled = true;
    state = true;
    try {
      await _run(queue, snapshot);
    } finally {
      _runScheduled = false;
      state = false;
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

    final metadata = ref.read(metadataServiceProvider);
    final config = ref.read(appConfigProvider);
    final controller = ref.read(watchlistControllerProvider.notifier);
    var items = [...snapshot.items];
    var updated = 0;

    for (final item in queue) {
      if (ref.read(sessionProvider)?.listId != listId) break;
      try {
        final enriched =
            await enrichItemWithPoster(metadata, item, config: config);
        if (hasValidPoster(enriched)) {
          final index = items.indexWhere((entry) => entry.id == item.id);
          if (index != -1) {
            items[index] = enriched;
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

      await Future<void>.delayed(posterEnrichmentThrottle);
    }

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

final posterBackfillControllerProvider =
    NotifierProvider<PosterBackfillController, bool>(
  PosterBackfillController.new,
);
