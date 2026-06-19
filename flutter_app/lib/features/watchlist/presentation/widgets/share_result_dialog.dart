import 'package:flutter/material.dart';

import '../../../../core/utils/clipboard_copy.dart';
import '../../../../core/utils/share_url.dart';
import '../../../../l10n/l10n.dart';

Future<void> showShareResultDialog(
  BuildContext context, {
  required L10n l10n,
  required String shareUrl,
  required String listName,
  required Uri currentUri,
}) {
  final origin = sharePageOrigin(currentUri);
  final isDev = isLocalDevHost(origin.host);

  return showDialog<void>(
    context: context,
    builder: (dialogContext) {
      return AlertDialog(
        title: Text(l10n.shareListSharedTitle),
        content: SingleChildScrollView(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(l10n.shareLinkReady(listName)),
              const SizedBox(height: 8),
              Text(
                l10n.sharePasteInAddressBar,
                style: Theme.of(dialogContext).textTheme.bodySmall,
              ),
              const SizedBox(height: 12),
              SelectableText(
                shareUrl,
                style: Theme.of(dialogContext).textTheme.bodyMedium?.copyWith(
                      fontFamily: 'monospace',
                    ),
              ),
              if (isDev) ...[
                const SizedBox(height: 12),
                Text(
                  l10n.shareDevHint,
                  style: Theme.of(dialogContext).textTheme.bodySmall,
                ),
              ],
              const SizedBox(height: 12),
              Text(
                l10n.shareDifferentAccountHint,
                style: Theme.of(dialogContext).textTheme.bodySmall,
              ),
            ],
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext),
            child: Text(l10n.btnCancel),
          ),
          FilledButton(
            onPressed: () async {
              final copied = await copyLinkText(shareUrl);
              if (!dialogContext.mounted) return;

              final messenger = ScaffoldMessenger.of(context);
              Navigator.pop(dialogContext);
              messenger.showSnackBar(
                SnackBar(
                  content: Text(
                    copied ? l10n.shareLinkCopied : l10n.shareCopyFailed,
                  ),
                ),
              );
            },
            child: Text(l10n.shareCopyLink),
          ),
        ],
      );
    },
  );
}
