import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../app/router.dart';
import '../../../../core/services/session_service.dart';
import '../../../../l10n/l10n.dart';
import '../../../../models/list_library_entry.dart';
import '../../../../repositories/auth_repository.dart';
import '../../../watchlist/application/watchlist_controller.dart';
import 'list_form_sheet.dart';

Future<void> showManageListsSheet(
  BuildContext context,
  WidgetRef ref, {
  required L10n l10n,
}) async {
  await showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    builder: (sheetContext) {
      return _ManageListsSheet(l10n: l10n);
    },
  );
}

class _ManageListsSheet extends ConsumerStatefulWidget {
  const _ManageListsSheet({required this.l10n});

  final L10n l10n;

  @override
  ConsumerState<_ManageListsSheet> createState() => _ManageListsSheetState();
}

class _ManageListsSheetState extends ConsumerState<_ManageListsSheet> {
  Future<void> _openCreate() async {
    final session = ref.read(sessionProvider);
    if (session == null) return;

    await showListFormSheet(
      context,
      l10n: widget.l10n,
      isEdit: false,
      onSubmit: (name, description) async {
        final auth = ref.read(authRepositoryProvider);
        final result = await auth.createList(
          session: session,
          name: name,
          description: description,
        );
        if (!result.ok) return result.errorKey;

        await ref.read(sessionProvider.notifier).setSession(result.session!);
        ref.invalidate(watchlistControllerProvider);
        if (mounted) setState(() {});
        return null;
      },
    );
  }

  Future<void> _openEdit(ListLibraryEntry entry) async {
    final session = ref.read(sessionProvider);
    if (session == null) return;

    await showListFormSheet(
      context,
      l10n: widget.l10n,
      isEdit: true,
      initialName: entry.name,
      initialDescription: entry.description,
      onSubmit: (name, description) async {
        final auth = ref.read(authRepositoryProvider);
        final result = await auth.updateList(
          session: session,
          listId: entry.listId,
          name: name,
          description: description,
        );
        if (!result.ok) return result.errorKey;

        if (!result.cloudOk && mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text(widget.l10n.message('watchlist.syncFailed'))),
          );
        }
        if (mounted) setState(() {});
        return null;
      },
    );
  }

  Future<void> _switchTo(String listId) async {
    await ref.read(sessionProvider.notifier).switchList(listId);
    ref.invalidate(watchlistControllerProvider);
    if (mounted) Navigator.pop(context);
  }

  Future<void> _deleteList(ListLibraryEntry entry) async {
    final session = ref.read(sessionProvider);
    if (session == null) return;

    final auth = ref.read(authRepositoryProvider);
    final titleCount = auth.listTitleCount(entry.listId);
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(widget.l10n.deleteListTitle),
        content: Text(
          widget.l10n.deleteListConfirm(
            name: entry.name,
            count: titleCount,
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: Text(widget.l10n.btnCancel),
          ),
          FilledButton(
            style: FilledButton.styleFrom(
              backgroundColor: Theme.of(context).colorScheme.error,
            ),
            onPressed: () => Navigator.pop(context, true),
            child: Text(widget.l10n.btnDelete),
          ),
        ],
      ),
    );

    if (confirmed != true || !mounted) return;

    final result = await auth.deleteList(
      session: session,
      listId: entry.listId,
    );

    if (!mounted) return;

    if (!result.cloudOk) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(widget.l10n.message('watchlist.syncFailed'))),
      );
    }

    if (result.signedOut) {
      await ref.read(sessionProvider.notifier).clearSession();
      ref.invalidate(watchlistControllerProvider);
      if (!mounted) return;
      Navigator.pop(context);
      context.go('${AppRoutes.gate}?mode=create');
      return;
    }

    if (result.session != null &&
        result.session!.listId != session.listId) {
      await ref.read(sessionProvider.notifier).setSession(result.session!);
      ref.invalidate(watchlistControllerProvider);
      if (!mounted) return;
      Navigator.pop(context);
      return;
    }

    setState(() {});
  }

  @override
  Widget build(BuildContext context) {
    final session = ref.watch(sessionProvider);
    if (session == null) {
      return const SizedBox.shrink();
    }

    final auth = ref.watch(authRepositoryProvider);
    final library = auth.getLibrary(session.accountId);
    final theme = Theme.of(context);

    return Padding(
      padding: EdgeInsets.fromLTRB(
        24,
        0,
        24,
        24 + MediaQuery.viewInsetsOf(context).bottom,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            widget.l10n.manageListsTitle,
            style: theme.textTheme.titleLarge,
          ),
          const SizedBox(height: 16),
          if (library.isEmpty)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 24),
              child: Text(
                widget.l10n.manageUnnamedList,
                textAlign: TextAlign.center,
              ),
            )
          else
            Flexible(
              child: ListView.separated(
                shrinkWrap: true,
                itemCount: library.length,
                separatorBuilder: (_, __) => const Divider(height: 1),
                itemBuilder: (context, index) {
                  final entry = library[index];
                  final isCurrent = entry.listId == session.listId;
                  final count = auth.listTitleCount(entry.listId);

                  return ListTile(
                    contentPadding: EdgeInsets.zero,
                    title: Row(
                      children: [
                        Expanded(child: Text(entry.name)),
                        if (isCurrent)
                          Container(
                            padding: const EdgeInsets.symmetric(
                              horizontal: 8,
                              vertical: 2,
                            ),
                            decoration: BoxDecoration(
                              color: theme.colorScheme.primaryContainer,
                              borderRadius: BorderRadius.circular(12),
                            ),
                            child: Text(
                              widget.l10n.manageSignedInNow,
                              style: theme.textTheme.labelSmall,
                            ),
                          ),
                      ],
                    ),
                    subtitle: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        if (entry.description.isNotEmpty)
                          Text(entry.description),
                        Text(widget.l10n.titleCount(count)),
                      ],
                    ),
                    trailing: Wrap(
                      spacing: 4,
                      children: [
                        if (!isCurrent)
                          TextButton(
                            onPressed: () => _switchTo(entry.listId),
                            child: Text(widget.l10n.manageSwitchToList),
                          ),
                        TextButton(
                          onPressed: () => _openEdit(entry),
                          child: Text(widget.l10n.cardEdit),
                        ),
                        TextButton(
                          onPressed: () => _deleteList(entry),
                          child: Text(
                            widget.l10n.btnDelete,
                            style: TextStyle(color: theme.colorScheme.error),
                          ),
                        ),
                      ],
                    ),
                  );
                },
              ),
            ),
          const SizedBox(height: 12),
          FilledButton.icon(
            onPressed: _openCreate,
            icon: const Icon(Icons.add),
            label: Text(widget.l10n.manageCreate),
          ),
        ],
      ),
    );
  }
}
