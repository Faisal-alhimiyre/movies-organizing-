import 'package:flutter/material.dart';

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
    final syncChip = _syncChip(theme);

    return Wrap(
      spacing: 8,
      runSpacing: 8,
      crossAxisAlignment: WrapCrossAlignment.center,
      children: [
        _statChip(theme, l10n.statsTotal, '$total'),
        _statChip(theme, l10n.statsWatched, '$watchedCount'),
        if (!cloudConfigured)
          Chip(
            avatar: const Icon(Icons.storage_outlined, size: 18),
            label: Text(l10n.syncLocal),
          )
        else if (syncChip != null)
          syncChip,
      ],
    );
  }

  Widget _statChip(ThemeData theme, String label, String value) {
    return Chip(
      label: Text.rich(
        TextSpan(
          children: [
            TextSpan(
              text: value,
              style: theme.textTheme.labelLarge?.copyWith(
                fontWeight: FontWeight.w700,
              ),
            ),
            TextSpan(text: ' $label'),
          ],
        ),
      ),
    );
  }

  Widget? _syncChip(ThemeData theme) {
    final label = switch (syncStatus) {
      SyncDisplayStatus.pending => l10n.syncSaving,
      SyncDisplayStatus.error => l10n.syncFailed,
      SyncDisplayStatus.offline => l10n.syncOffline,
      SyncDisplayStatus.saved => null,
      SyncDisplayStatus.local => null,
    };
    if (label == null) return null;

    return Chip(
      avatar: Icon(
        syncStatus == SyncDisplayStatus.pending
            ? Icons.cloud_upload_outlined
            : Icons.cloud_off_outlined,
        size: 18,
      ),
      label: Text(label),
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
