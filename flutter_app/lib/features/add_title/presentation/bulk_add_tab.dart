import 'package:flutter/material.dart';

import '../../../core/utils/clipboard_copy.dart';
import '../../../core/utils/watchlist_parser.dart';
import '../../../l10n/l10n.dart';
import '../../../models/watchlist_item.dart';
import '../application/bulk_titles_parser.dart';

class BulkAddTab extends StatefulWidget {
  const BulkAddTab({
    super.key,
    required this.l10n,
    required this.scrollController,
    required this.existingItems,
    required this.onSaveBulk,
  });

  final L10n l10n;
  final ScrollController scrollController;
  final List<WatchlistItem> existingItems;
  final Future<String?> Function(List<WatchlistItem> items) onSaveBulk;

  @override
  State<BulkAddTab> createState() => _BulkAddTabState();
}

class _BulkAddTabState extends State<BulkAddTab> {
  final _pasteController = TextEditingController();
  String? _errorMessage;
  bool _saving = false;

  @override
  void dispose() {
    _pasteController.dispose();
    super.dispose();
  }

  Future<void> _copyTemplate() async {
    final template = buildBulkTemplate(standardGenres);
    final copied = await copyLinkText(template);
    if (!mounted) return;

    if (copied) {
      await showDialog<void>(
        context: context,
        builder: (context) => AlertDialog(
          title: Text(widget.l10n.bulkTemplateCopiedTitle),
          content: Text(widget.l10n.bulkTemplateCopied),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context),
              child: Text(widget.l10n.btnOk),
            ),
          ],
        ),
      );
      return;
    }

    await showDialog<void>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(widget.l10n.bulkCopyFailedTitle),
        content: Text(widget.l10n.bulkCopyFailed),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: Text(widget.l10n.btnOk),
          ),
        ],
      ),
    );
  }

  Future<void> _submit() async {
    if (_saving) return;

    setState(() => _errorMessage = null);

    final parsed = parseBulkPaste(_pasteController.text);
    if (!parsed.ok) {
      setState(
          () => _errorMessage = parsed.error ?? widget.l10n.bulkReadFailed);
      return;
    }

    final batchStart = DateTime.now().millisecondsSinceEpoch;
    final toAdd = <WatchlistItem>[];
    var skipped = 0;

    for (var i = 0; i < parsed.items.length; i++) {
      final item = parsed.items[i].toWatchlistItem(
        addedAt: batchStart + toAdd.length,
      );
      if (findDuplicateTitle(widget.existingItems, item) != null ||
          findDuplicateTitle(toAdd, item) != null) {
        skipped += 1;
        continue;
      }
      toAdd.add(item);
    }

    if (toAdd.isEmpty) {
      setState(() {
        _errorMessage = skipped > 0
            ? widget.l10n.bulkAllDuplicates
            : widget.l10n.bulkNoneAdded;
      });
      return;
    }

    setState(() => _saving = true);

    final errorKey = await widget.onSaveBulk(toAdd);
    if (!mounted) return;

    if (errorKey != null) {
      setState(() {
        _saving = false;
        _errorMessage = widget.l10n.message(errorKey);
      });
      return;
    }

    final warnings = <String>[
      if (skipped > 0)
        skipped == 1
            ? widget.l10n.bulkDuplicatesSkipped(skipped)
            : widget.l10n.bulkDuplicatesSkippedPlural(skipped),
      ...parsed.errors,
    ];

    final extra = warnings.isEmpty
        ? ''
        : '\n\n${formatBulkErrors(warnings, maxShown: 8)}';

    await showDialog<void>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(widget.l10n.bulkAddedTitle),
        content: Text(
          toAdd.length == 1
              ? widget.l10n.bulkAddedOne(extra)
              : widget.l10n.bulkAddedMany(toAdd.length, extra),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: Text(widget.l10n.btnOk),
          ),
        ],
      ),
    );

    if (mounted) Navigator.of(context).pop(true);
  }

  @override
  Widget build(BuildContext context) {
    final l10n = widget.l10n;

    return ListView(
      controller: widget.scrollController,
      padding: const EdgeInsets.all(16),
      children: [
        Text(
          l10n.bulkHeadline,
          style: Theme.of(context).textTheme.titleMedium,
        ),
        const SizedBox(height: 16),
        _BulkStep(
          number: 1,
          title: l10n.bulkStep1Title,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(l10n.bulkStep1Text),
              const SizedBox(height: 12),
              OutlinedButton.icon(
                onPressed: _copyTemplate,
                icon: const Icon(Icons.copy_outlined),
                label: Text(l10n.btnCopyTemplate),
              ),
            ],
          ),
        ),
        const SizedBox(height: 16),
        _BulkStep(
          number: 2,
          title: l10n.bulkStep2Title,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(l10n.bulkStep2Text),
              const SizedBox(height: 8),
              Text(
                l10n.bulkExample,
                style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                      fontStyle: FontStyle.italic,
                      color: Theme.of(context).colorScheme.onSurfaceVariant,
                    ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 16),
        _BulkStep(
          number: 3,
          title: l10n.bulkStep3Title,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(l10n.bulkStep3Text),
              const SizedBox(height: 12),
              TextField(
                controller: _pasteController,
                minLines: 8,
                maxLines: 14,
                decoration: InputDecoration(
                  hintText: l10n.bulkPastePlaceholder,
                  alignLabelWithHint: true,
                  border: const OutlineInputBorder(),
                ),
              ),
              if (_errorMessage != null) ...[
                const SizedBox(height: 12),
                Text(
                  _errorMessage!,
                  style: TextStyle(color: Theme.of(context).colorScheme.error),
                ),
              ],
            ],
          ),
        ),
        const SizedBox(height: 20),
        FilledButton(
          onPressed: _saving ? null : _submit,
          child: _saving
              ? const SizedBox(
                  width: 20,
                  height: 20,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : Text(l10n.btnAddAllTitles),
        ),
      ],
    );
  }
}

class _BulkStep extends StatelessWidget {
  const _BulkStep({
    required this.number,
    required this.title,
    required this.child,
  });

  final int number;
  final String title;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        CircleAvatar(
          radius: 14,
          child: Text('$number', style: const TextStyle(fontSize: 13)),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(title, style: Theme.of(context).textTheme.titleSmall),
              const SizedBox(height: 8),
              child,
            ],
          ),
        ),
      ],
    );
  }
}
