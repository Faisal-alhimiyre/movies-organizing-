import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../l10n/l10n.dart';
import '../../application/watchlist_controller.dart';
import '../../application/year_backfill_controller.dart';

class YearBackfillBanner extends ConsumerWidget {
  const YearBackfillBanner({super.key, required this.l10n});

  final L10n l10n;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final progress = ref.watch(yearBackfillControllerProvider);
    if (!progress.running || progress.total <= 0) {
      return const SizedBox.shrink();
    }

    final theme = Theme.of(context);
    final accent = theme.colorScheme.primary;
    return Padding(
      padding: const EdgeInsets.only(top: 8, bottom: 4),
      child: DecoratedBox(
        decoration: BoxDecoration(
          color: accent.withValues(alpha: 0.07),
          borderRadius: BorderRadius.circular(8),
          border: Border.all(color: accent.withValues(alpha: 0.25)),
        ),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
          child: Row(
            children: [
              SizedBox(
                width: 16,
                height: 16,
                child: CircularProgressIndicator(strokeWidth: 2, color: accent),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  l10n.backfillYearProgress(progress.done, progress.total),
                  style: TextStyle(
                    fontSize: 13,
                    color: theme.colorScheme.onSurface.withValues(alpha: 0.8),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class YearBackfillOrchestrator extends ConsumerWidget {
  const YearBackfillOrchestrator({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    ref.listen(watchlistFilterProvider, (previous, next) {
      if (next.sortSource == 'release' && previous?.sortSource != 'release') {
        ref.read(yearBackfillControllerProvider.notifier).runIfNeeded();
      }
    });

    ref.listen(watchlistControllerProvider, (previous, next) {
      final releaseSort =
          ref.read(watchlistFilterProvider).sortSource == 'release';
      if (!releaseSort) return;
      if (next.hasValue && (previous?.isLoading ?? true)) {
        ref.read(yearBackfillControllerProvider.notifier).runIfNeeded();
      }
    });

    return const SizedBox.shrink();
  }
}
