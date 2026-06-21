import 'package:flutter/material.dart';

import '../../../../l10n/l10n.dart';
import '../../../../models/share_snapshot_payload.dart';

Future<void> showImportShareSheet(
  BuildContext context, {
  required L10n l10n,
  required ShareSnapshotPayload payload,
  required String currentListName,
  required int currentCount,
  required Future<void> Function() onNewList,
  required Future<void> Function(bool includeWatched) onMerge,
}) {
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    builder: (context) {
      final titleCount = payload.titleCount;
      final description = payload.listDescription.trim();
      final summary = currentCount > 0
          ? l10n.importSummaryWithCurrent(
              listName: payload.listName,
              count: titleCount,
              currentName: currentListName,
              currentCount: currentCount,
            )
          : l10n.importSummaryEmpty(
              listName: payload.listName,
              count: titleCount,
            );
      final hint = currentCount > 0 ? l10n.importHint : l10n.importHintEmpty;
      final mergeLabel =
          currentCount == 0 ? l10n.importAddToList : l10n.importMerge;

      return SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(20, 0, 20, 24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                l10n.importTitle,
                style: Theme.of(context).textTheme.titleLarge,
              ),
              const SizedBox(height: 12),
              Text(summary),
              if (description.isNotEmpty) ...[
                const SizedBox(height: 8),
                Text(l10n.importSummaryWithDescription(description)),
              ],
              const SizedBox(height: 8),
              Text(
                hint,
                style: Theme.of(context).textTheme.bodySmall,
              ),
              const SizedBox(height: 20),
              FilledButton(
                onPressed: () async {
                  Navigator.pop(context);
                  await onNewList();
                },
                child: Text(l10n.importNewList),
              ),
              const SizedBox(height: 8),
              OutlinedButton(
                onPressed: () async {
                  Navigator.pop(context);
                  await onMerge(false);
                },
                child: Text(mergeLabel),
              ),
              const SizedBox(height: 8),
              OutlinedButton(
                onPressed: () async {
                  Navigator.pop(context);
                  await onMerge(true);
                },
                child: Text(l10n.importMergeWithWatch),
              ),
              const SizedBox(height: 8),
              TextButton(
                onPressed: () => Navigator.pop(context),
                child: Text(l10n.btnCancel),
              ),
            ],
          ),
        ),
      );
    },
  );
}
