import 'dart:ui' show PlatformDispatcher;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/config/app_config.dart';
import '../../../core/config/environment.dart';
import '../../../core/services/session_service.dart';
import '../../../models/metadata_detail.dart';
import '../../../models/watchlist_item.dart';
import '../../../repositories/metadata/metadata_service.dart';
import '../../../repositories/metadata/series_metadata_service.dart';
import 'title_meta_backfill.dart';
import 'watchlist_controller.dart';
import 'year_backfill.dart';

class TitleMetaBackfillProgress {
  const TitleMetaBackfillProgress({
    this.running = false,
    this.done = 0,
    this.total = 0,
  });

  final bool running;
  final int done;
  final int total;
}

class TitleMetaBackfillOrchestrator extends ConsumerStatefulWidget {
  const TitleMetaBackfillOrchestrator({super.key});

  @override
  ConsumerState<TitleMetaBackfillOrchestrator> createState() =>
      _TitleMetaBackfillOrchestratorState();
}

class _TitleMetaBackfillOrchestratorState
    extends ConsumerState<TitleMetaBackfillOrchestrator> {
  var _bootstrapped = false;

  @override
  Widget build(BuildContext context) {
    if (!_bootstrapped) {
      _bootstrapped = true;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (!mounted) return;
        ref.read(titleMetaBackfillControllerProvider.notifier).runIfNeeded();
      });
    }

    ref.listen(watchlistControllerProvider, (previous, next) {
      if (next.hasValue && (previous?.isLoading ?? true)) {
        ref.read(titleMetaBackfillControllerProvider.notifier).runIfNeeded();
      }
    });

    return const SizedBox.shrink();
  }
}

class TitleMetaBackfillController extends Notifier<TitleMetaBackfillProgress> {
  bool _runScheduled = false;

  @override
  TitleMetaBackfillProgress build() => const TitleMetaBackfillProgress();

  Future<void> runIfNeeded() async {
    if (state.running || _runScheduled) return;

    final snapshot = ref.read(watchlistControllerProvider).value;
    if (snapshot == null) return;

    final queue = snapshot.items
        .where(itemNeedsTitleMetaBackfill)
        .toList(growable: false);
    if (queue.isEmpty) return;

    final config = ref.read(appConfigProvider);
    if (!config.hasOmdbKey &&
        !config.hasTmdbKey &&
        !config.isSupabaseConfigured) {
      final needsMovieApi = queue.any((item) => getImdbIdFromItem(item) != null);
      final needsSeriesApi = queue.any(
        (item) =>
            item.contentType == 'tvSeries' || item.contentType == 'anime',
      );
      if (needsMovieApi || needsSeriesApi) return;
    }

    _runScheduled = true;
    try {
      await _run(queue, snapshot.items);
    } finally {
      _runScheduled = false;
    }
  }

  Future<void> _run(
    List<WatchlistItem> queue,
    List<WatchlistItem> allItems,
  ) async {
    final session = ref.read(sessionProvider);
    if (session == null) return;
    final listId = session.listId;
    final watched = ref.read(watchlistControllerProvider).value?.watched ??
        const <String, WatchEntry>{};

    state = TitleMetaBackfillProgress(running: true, total: queue.length);

    final metadata = ref.read(metadataServiceProvider);
    final seriesMetadata = ref.read(seriesMetadataServiceProvider);
    final locale =
        PlatformDispatcher.instance.locale.languageCode == 'ar' ? 'ar' : 'en';
    final controller = ref.read(watchlistControllerProvider.notifier);
    var items = [...allItems];
    var done = 0;
    var updated = 0;

    for (final item in queue) {
      if (ref.read(sessionProvider)?.listId != listId) break;
      try {
        MetadataDetail? meta;
        final imdbId = getImdbIdFromItem(item);
        if (imdbId != null) {
          meta = await metadata.getMetadata(imdbId, forceRefresh: true);
        } else {
          final link = item.link?.trim();
          if (link != null && link.isNotEmpty) {
            meta = await metadata.resolveMetadataFromLink(
              link,
              forceRefresh: true,
            );
          }
        }

        if (meta != null) {
          final index = items.indexWhere((entry) => entry.id == item.id);
          if (index != -1) {
            var merged = mergeTitleMetaFromDetail(items[index], meta);
            if (item.contentType == 'tvSeries' ||
                item.contentType == 'anime') {
              final counts = await seriesMetadata.fetchTitleSeriesCounts(
                items[index],
                locale: locale,
              );
              if (counts != null) {
                merged = mergeTitleMetaFromDetail(
                  items[index],
                  meta,
                  seasonCount: counts.seasonCount,
                  episodeCount: counts.episodeCount,
                );
              }
            }
            if (itemHasTitleMeta(merged)) {
              items[index] = merged;
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
        } else if (item.contentType == 'tvSeries' ||
            item.contentType == 'anime') {
          final counts = await seriesMetadata.fetchTitleSeriesCounts(
            item,
            locale: locale,
          );
          if (counts != null) {
            final index = items.indexWhere((entry) => entry.id == item.id);
            if (index != -1) {
              final current = items[index];
              items[index] = WatchlistItem(
                id: current.id,
                contentType: current.contentType,
                genre: current.genre,
                title: current.title,
                lead: current.lead,
                summary: current.summary,
                kind: current.kind,
                link: current.link,
                poster: current.poster,
                cardPoster: current.cardPoster,
                selectedSeason: current.selectedSeason,
                selectedSeasonName: current.selectedSeasonName,
                noSpecials: current.noSpecials,
                imdbRating: current.imdbRating,
                anilistRating: current.anilistRating,
                ageRating: current.ageRating,
                runtime: current.runtime,
                seasonCount: counts.seasonCount ?? current.seasonCount,
                episodeCount: counts.episodeCount ?? current.episodeCount,
                year: current.year,
                addedAt: current.addedAt,
                secondaryGenres: current.secondaryGenres,
              );
              updated += 1;
            }
          }
        }
      } catch (_) {
        // Best-effort per title.
      }

      done += 1;
      state = TitleMetaBackfillProgress(
        running: true,
        done: done,
        total: queue.length,
      );
      await Future<void>.delayed(const Duration(milliseconds: 280));
    }

    state = const TitleMetaBackfillProgress();

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

final titleMetaBackfillControllerProvider =
    NotifierProvider<TitleMetaBackfillController, TitleMetaBackfillProgress>(
  TitleMetaBackfillController.new,
);
