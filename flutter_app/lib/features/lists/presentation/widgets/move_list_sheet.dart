import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/services/session_service.dart';
import '../../../../l10n/l10n.dart';
import '../../../../models/list_library_entry.dart';
import '../../../../models/watchlist_item.dart';
import '../../../../repositories/auth_repository.dart';
import '../../../../repositories/watchlist_repository.dart';
import '../../../watchlist/application/watchlist_controller.dart';

Future<void> showMoveListSheet(
  BuildContext context,
  WidgetRef ref, {
  required L10n l10n,
  required WatchlistItem item,
}) async {
  await showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    builder: (sheetContext) {
      return _MoveListSheet(l10n: l10n, item: item);
    },
  );
}

class _MoveListSheet extends ConsumerStatefulWidget {
  const _MoveListSheet({required this.l10n, required this.item});

  final L10n l10n;
  final WatchlistItem item;

  @override
  ConsumerState<_MoveListSheet> createState() => _MoveListSheetState();
}

class _MoveListSheetState extends ConsumerState<_MoveListSheet> {
  String? _busyListId;

  Future<void> _pickList(ListLibraryEntry entry) async {
    if (_busyListId != null) return;

    setState(() => _busyListId = entry.listId);

    final result =
        await ref.read(watchlistControllerProvider.notifier).copyItemToList(
              itemId: widget.item.id,
              targetListId: entry.listId,
            );

    if (!mounted) return;

    setState(() => _busyListId = null);
    Navigator.pop(context);

    if (!context.mounted) return;

    if (!result.ok) {
      final message = _errorMessage(widget.l10n, result, entry.name);
      await showDialog<void>(
        context: context,
        builder: (context) => AlertDialog(
          title: Text(widget.l10n.moveCouldNotCopyTitle),
          content: Text(message),
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
        title: Text(widget.l10n.moveCopiedTitle),
        content: Text(
          widget.l10n.moveCopied(
            widget.item.title,
            result.listName ?? entry.name,
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: Text(widget.l10n.btnOk),
          ),
        ],
      ),
    );
  }

  String _errorMessage(
    L10n l10n,
    CopyItemToListResult result,
    String listName,
  ) {
    switch (result.errorKey) {
      case 'move.alreadyOnList':
        return l10n.moveAlreadyOnList(widget.item.title, listName);
      case 'move.alreadyOnThisList':
        return l10n.moveAlreadyOnThisList;
      case 'move.titleNotFound':
        return l10n.moveTitleNotFound;
      default:
        return l10n.message(result.errorKey ?? 'watchlist.syncFailed');
    }
  }

  @override
  Widget build(BuildContext context) {
    final session = ref.watch(sessionProvider);
    final l10n = widget.l10n;
    final theme = Theme.of(context);

    if (session == null) {
      return const SizedBox.shrink();
    }

    final auth = ref.watch(authRepositoryProvider);
    final library = auth.getLibrary(session.accountId);
    final otherLists = library
        .where((entry) => entry.listId != session.listId)
        .toList(growable: false);

    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              l10n.moveTitle,
              style: theme.textTheme.titleLarge,
            ),
            const SizedBox(height: 8),
            Text(
              l10n.moveText(widget.item.title),
              style: theme.textTheme.bodyMedium,
            ),
            const SizedBox(height: 16),
            if (otherLists.isEmpty)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 24),
                child: Text(
                  l10n.moveEmpty,
                  textAlign: TextAlign.center,
                  style: theme.textTheme.bodyMedium,
                ),
              )
            else
              Flexible(
                child: ListView.separated(
                  shrinkWrap: true,
                  itemCount: otherLists.length,
                  separatorBuilder: (_, __) => const Divider(height: 1),
                  itemBuilder: (context, index) {
                    final entry = otherLists[index];
                    final busy = _busyListId == entry.listId;
                    final count = auth.listTitleCount(entry.listId);

                    return ListTile(
                      title: Text(entry.name),
                      subtitle: Text(l10n.titleCount(count)),
                      trailing: busy
                          ? const SizedBox(
                              width: 20,
                              height: 20,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            )
                          : const Icon(Icons.chevron_right),
                      onTap: busy ? null : () => _pickList(entry),
                    );
                  },
                ),
              ),
          ],
        ),
      ),
    );
  }
}
