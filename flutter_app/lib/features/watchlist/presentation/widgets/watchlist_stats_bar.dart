import 'package:flutter/material.dart';

import '../../../../app/theme/theme_extensions.dart';
import '../../../../l10n/l10n.dart';
import '../../../../models/watchlist_item.dart';

class WatchlistStatsBar extends StatelessWidget {
  const WatchlistStatsBar({
    super.key,
    required this.total,
    required this.watchedCount,
    required this.syncStatus,
    required this.cloudConfigured,
    required this.l10n,
  });

  final int total;
  final int watchedCount;
  final SyncDisplayStatus syncStatus;
  final bool cloudConfigured;
  final L10n l10n;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final tc = Theme.of(context).extension<AppTypeColors>();
    final syncLabel = _syncLabel();

    return Wrap(
      spacing: 8,
      runSpacing: 8,
      crossAxisAlignment: WrapCrossAlignment.center,
      children: [
        _StatChip(value: '$total', label: l10n.statsTotal),
        _StatChip(
          value: '$watchedCount',
          label: l10n.statsWatched,
          valueColor: tc?.watched,
        ),
        if (!cloudConfigured)
          _SyncChip(
            icon: Icons.storage_outlined,
            label: l10n.syncLocal,
            theme: theme,
          )
        else if (syncLabel != null)
          _SyncChip(
            icon: syncStatus == SyncDisplayStatus.pending
                ? Icons.cloud_upload_outlined
                : Icons.cloud_off_outlined,
            label: syncLabel,
            theme: theme,
            isError: syncStatus == SyncDisplayStatus.error ||
                syncStatus == SyncDisplayStatus.offline,
          ),
      ],
    );
  }

  String? _syncLabel() => switch (syncStatus) {
        SyncDisplayStatus.pending => l10n.syncSaving,
        SyncDisplayStatus.error => l10n.syncFailed,
        SyncDisplayStatus.offline => l10n.syncOffline,
        SyncDisplayStatus.saved => null,
        SyncDisplayStatus.local => null,
      };
}

/// Premium glass-style stat chip — matches CSS `.header__stat-chip`.
class _StatChip extends StatelessWidget {
  const _StatChip({
    required this.value,
    required this.label,
    this.valueColor,
  });

  final String value;
  final String label;
  final Color? valueColor;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final onSurface = theme.colorScheme.onSurface;

    return DecoratedBox(
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [
            onSurface.withValues(alpha: 0.04),
            onSurface.withValues(alpha: 0.07),
          ],
        ),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(
          color: onSurface.withValues(alpha: 0.1),
          width: 1,
        ),
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              value,
              style: theme.textTheme.labelLarge?.copyWith(
                fontWeight: FontWeight.w700,
                color: valueColor ?? onSurface,
              ),
            ),
            const SizedBox(width: 5),
            Text(
              label,
              style: theme.textTheme.labelSmall?.copyWith(
                color: onSurface.withValues(alpha: 0.6),
                fontWeight: FontWeight.w500,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _SyncChip extends StatelessWidget {
  const _SyncChip({
    required this.icon,
    required this.label,
    required this.theme,
    this.isError = false,
  });

  final IconData icon;
  final String label;
  final ThemeData theme;
  final bool isError;

  @override
  Widget build(BuildContext context) {
    final color = isError
        ? theme.colorScheme.error
        : theme.colorScheme.onSurface.withValues(alpha: 0.6);
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(icon, size: 14, color: color),
        const SizedBox(width: 4),
        Text(
          label,
          style: theme.textTheme.labelSmall?.copyWith(color: color),
        ),
      ],
    );
  }
}

class WatchlistEmptyState extends StatelessWidget {
  const WatchlistEmptyState({super.key, required this.l10n});

  final L10n l10n;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Center(
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 48, horizontal: 24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              Icons.movie_outlined,
              size: 56,
              color: theme.colorScheme.primary.withValues(alpha: 0.8),
            ),
            const SizedBox(height: 16),
            Text(
              l10n.emptyListTitle,
              style: theme.textTheme.titleLarge,
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 8),
            Text(
              l10n.emptyListBody,
              style: theme.textTheme.bodyMedium?.copyWith(
                color: theme.colorScheme.onSurface.withValues(alpha: 0.75),
              ),
              textAlign: TextAlign.center,
            ),
          ],
        ),
      ),
    );
  }
}
