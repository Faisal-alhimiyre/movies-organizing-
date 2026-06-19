import 'package:flutter/material.dart';

import '../../../../l10n/l10n.dart';
import '../../../../models/share_snapshot_payload.dart';

class ShareArrivalBanner extends StatelessWidget {
  const ShareArrivalBanner({
    super.key,
    required this.l10n,
    required this.loading,
    required this.errorKey,
    required this.payload,
    required this.onReview,
    required this.onDismiss,
  });

  final L10n l10n;
  final bool loading;
  final String? errorKey;
  final ShareSnapshotPayload? payload;
  final VoidCallback onReview;
  final VoidCallback onDismiss;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    if (loading) {
      return Card(
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Row(
            children: [
              const SizedBox(
                width: 20,
                height: 20,
                child: CircularProgressIndicator(strokeWidth: 2),
              ),
              const SizedBox(width: 12),
              Expanded(child: Text(l10n.shareArrivalLoading)),
            ],
          ),
        ),
      );
    }

    if (errorKey != null) {
      return Card(
        color: theme.colorScheme.errorContainer,
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Row(
            children: [
              Expanded(child: Text(l10n.shareArrivalError(errorKey!))),
              TextButton(
                onPressed: onDismiss,
                child: Text(l10n.shareArrivalDismiss),
              ),
            ],
          ),
        ),
      );
    }

    if (payload == null) return const SizedBox.shrink();

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              l10n.shareArrivalTitle,
              style: theme.textTheme.titleSmall,
            ),
            const SizedBox(height: 8),
            Text(
              l10n.shareArrivalText(
                name: payload!.listName,
                count: payload!.titleCount,
              ),
            ),
            const SizedBox(height: 12),
            Row(
              children: [
                FilledButton(
                  onPressed: onReview,
                  child: Text(l10n.shareArrivalImport),
                ),
                const SizedBox(width: 8),
                TextButton(
                  onPressed: onDismiss,
                  child: Text(l10n.shareArrivalDismiss),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
