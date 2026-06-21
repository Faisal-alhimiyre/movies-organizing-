import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/services/session_service.dart';
import '../../../../l10n/l10n.dart';
import '../../../../repositories/auth_repository.dart';
import '../../../watchlist/application/watchlist_controller.dart';

/// Quick list switcher shown when the account has more than one list.
class ListSwitcherBar extends ConsumerWidget {
  const ListSwitcherBar({super.key, required this.l10n});

  final L10n l10n;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final session = ref.watch(sessionProvider);
    if (session == null) return const SizedBox.shrink();

    final library = ref.watch(authRepositoryProvider).getLibrary(
          session.accountId,
        );
    if (library.length <= 1) return const SizedBox.shrink();

    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: DropdownButtonFormField<String>(
        initialValue: session.listId,
        decoration: InputDecoration(
          labelText: l10n.menuSwitchList,
          isDense: true,
        ),
        items: [
          for (final entry in library)
            DropdownMenuItem(
              value: entry.listId,
              child: Text(entry.name),
            ),
        ],
        onChanged: (listId) async {
          if (listId == null || listId == session.listId) return;
          await ref.read(sessionProvider.notifier).switchList(listId);
          ref.invalidate(watchlistControllerProvider);
        },
      ),
    );
  }
}
