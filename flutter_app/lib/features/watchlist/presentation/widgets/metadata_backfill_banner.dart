import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/widgets/responsive_layout.dart';
import '../../../../l10n/l10n.dart';
import '../../application/ratings_backfill_controller.dart';
import '../../application/year_backfill_controller.dart';

class MetadataBackfillBanner extends ConsumerWidget {
  const MetadataBackfillBanner({
    super.key,
    required this.l10n,
    this.inPanel = false,
  });

  final L10n l10n;
  final bool inPanel;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final yearProgress = ref.watch(yearBackfillControllerProvider);
    final ratingsProgress = ref.watch(ratingsBackfillControllerProvider);

    final String? message;
    if (yearProgress.running && yearProgress.total > 0) {
      message =
          l10n.backfillYearProgress(yearProgress.done, yearProgress.total);
    } else if (ratingsProgress.running && ratingsProgress.total > 0) {
      message = switch (ratingsProgress.phase) {
        RatingsBackfillPhase.anilist => l10n.backfillAnilistProgress(
            ratingsProgress.done,
            ratingsProgress.total,
          ),
        RatingsBackfillPhase.imdb => l10n.backfillImdbProgress(
            ratingsProgress.done,
            ratingsProgress.total,
          ),
      };
    } else {
      return const SizedBox.shrink();
    }

    final theme = Theme.of(context);
    final accent = theme.colorScheme.primary;
    final padding = inPanel
        ? EdgeInsets.only(top: AppBreakpoints.isMobile(context) ? 5.6 : 8)
        : const EdgeInsets.only(top: 8, bottom: 4);

    return Padding(
      padding: padding,
      child: DecoratedBox(
        decoration: BoxDecoration(
          color: accent.withValues(alpha: 0.1),
          borderRadius: BorderRadius.circular(8),
          border: Border.all(color: accent.withValues(alpha: 0.28)),
        ),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 11.2, vertical: 7.2),
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
                  message,
                  style: TextStyle(
                    fontSize: 12.48,
                    fontWeight: FontWeight.w500,
                    height: 1.4,
                    color: accent,
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
