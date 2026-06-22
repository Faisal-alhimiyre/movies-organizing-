import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../app/theme/theme_extensions.dart';
import '../../../../core/services/session_service.dart';
import '../../../../l10n/l10n.dart';
import '../../../../models/list_library_entry.dart';
import '../../../../models/watchlist_item.dart';
import '../../../../repositories/auth_repository.dart';
import '../../application/watchlist_controller.dart';
import 'account_menu_panel.dart';
import 'list_title_dropdown.dart';

/// Top header for the watchlist screen — mirrors `.header`.
///
/// Layout (matches website mobile CSS exactly):
///
///   [List title ▾]                      [Add title] [⋮]
///   [X total] [Y watched] [sync chip?]
///   ─── 1px border-bottom ──────────────────────────────
///
/// The list title becomes a tappable dropdown when the account has > 1 list.
/// The ⋮ menu reproduces the exact website `account-menu__panel` HTML:
///   Manage lists
///   Share
///   Theme
///   Language [English] [العربية]
///   ── hr ──
///   Change code
///   Delete account
///   ── hr ──
///   Sign out
class WatchlistHeader extends ConsumerWidget {
  const WatchlistHeader({
    super.key,
    required this.listName,
    required this.total,
    required this.watchedCount,
    required this.syncStatus,
    required this.cloudConfigured,
    required this.sharePublishing,
    required this.l10n,
    this.onAdd,
    required this.onShare,
    required this.onManageLists,
    required this.onChangeCode,
    required this.onDeleteAccount,
    required this.onSignOut,
  });

  final String listName;
  final int total;
  final int watchedCount;
  final SyncDisplayStatus syncStatus;
  final bool cloudConfigured;
  final bool sharePublishing;
  final L10n l10n;

  final VoidCallback? onAdd;
  final VoidCallback onShare;
  final VoidCallback onManageLists;
  final VoidCallback onChangeCode;
  final VoidCallback onDeleteAccount;
  final VoidCallback onSignOut;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final onSurface = theme.colorScheme.onSurface;
    final tc = theme.extension<AppTypeColors>();
    final titleAccent = tc?.titleAccent ?? theme.colorScheme.primary;

    final session = ref.watch(sessionProvider);
    final auth = ref.watch(authRepositoryProvider);
    final library = session != null
        ? auth.getLibrary(session.accountId)
        : const <ListLibraryEntry>[];
    final currentListId = session?.listId;
    final hasMultipleLists = library.length > 1;

    final titleStyle = TextStyle(
      fontSize: 24,
      fontWeight: FontWeight.w700,
      color: titleAccent,
      letterSpacing: -0.24,
      height: 1.08,
    );

    return DecoratedBox(
      decoration: BoxDecoration(
        border: Border(
          bottom: BorderSide(
            color: theme.dividerColor,
            width: 1,
          ),
        ),
      ),
      child: Padding(
        padding: const EdgeInsets.only(bottom: 13),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // ── Main row: brand + toolbar ────────────────────────────────
            Row(
              crossAxisAlignment: CrossAxisAlignment.center,
              children: [
                // List title — inline popup dropdown when multiple lists exist
                Expanded(
                  child: hasMultipleLists
                      ? ListTitleDropdown(
                          listName: listName,
                          titleStyle: titleStyle,
                          titleAccent: titleAccent,
                          library: library,
                          currentListId: currentListId,
                          onSurface: onSurface,
                          theme: theme,
                          onSwitchList: (listId) {
                            ref
                                .read(watchlistControllerProvider.notifier)
                                .switchToList(listId);
                          },
                        )
                      : Text(
                          listName,
                          style: titleStyle,
                          overflow: TextOverflow.ellipsis,
                        ),
                ),

                const SizedBox(width: 8),

                // ── Toolbar: Add title + account ⋮ ──────────────────────
                _Toolbar(
                  onSurface: onSurface,
                  onAdd: onAdd,
                  addLabel: l10n.addTitle,
                  sharePublishing: sharePublishing,
                  l10n: l10n,
                  onShare: onShare,
                  onManageLists: onManageLists,
                  onChangeCode: onChangeCode,
                  onDeleteAccount: onDeleteAccount,
                  onSignOut: onSignOut,
                  theme: theme,
                ),
              ],
            ),

            const SizedBox(height: 6),

            // ── Stats chip row ────────────────────────────────────────────
            _StatsRow(
              total: total,
              watchedCount: watchedCount,
              syncStatus: syncStatus,
              cloudConfigured: cloudConfigured,
              l10n: l10n,
              tc: tc,
              onSurface: onSurface,
            ),
          ],
        ),
      ),
    );
  }
}

// ── Toolbar pill container: [Add title] [⋮] ──────────────────────────────────

class _Toolbar extends StatelessWidget {
  const _Toolbar({
    required this.onSurface,
    required this.onAdd,
    required this.addLabel,
    required this.sharePublishing,
    required this.l10n,
    required this.onShare,
    required this.onManageLists,
    required this.onChangeCode,
    required this.onDeleteAccount,
    required this.onSignOut,
    required this.theme,
  });

  final Color onSurface;
  final VoidCallback? onAdd;
  final String addLabel;
  final bool sharePublishing;
  final L10n l10n;
  final VoidCallback onShare;
  final VoidCallback onManageLists;
  final VoidCallback onChangeCode;
  final VoidCallback onDeleteAccount;
  final VoidCallback onSignOut;
  final ThemeData theme;

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: BoxDecoration(
        border: Border.all(color: onSurface.withValues(alpha: 0.12)),
        borderRadius: BorderRadius.circular(999),
      ),
      child: Padding(
        padding: const EdgeInsets.all(3),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (onAdd != null) ...[
              _AddButton(label: addLabel, onPressed: onAdd!),
              const SizedBox(width: 3),
            ],
            _AccountMenu(
              l10n: l10n,
              sharePublishing: sharePublishing,
              onShare: onShare,
              onManageLists: onManageLists,
              onChangeCode: onChangeCode,
              onDeleteAccount: onDeleteAccount,
              onSignOut: onSignOut,
              onSurface: onSurface,
              theme: theme,
            ),
          ],
        ),
      ),
    );
  }
}

// ── Add title button — mirrors `.header__toolbar .btn--primary` ───────────────
//
// Website CSS (applies to ALL themes via `html[data-theme]` override):
//   border-radius: 999px (pill)
//   background: linear-gradient(180deg, #d4b896 0%, #c4a882 100%)
//   color: #0c0c0d
//   padding: 0.55rem 1.1rem
//   font-size: 0.82rem
//   font-weight: 600

class _AddButton extends StatelessWidget {
  const _AddButton({required this.label, required this.onPressed});

  final String label;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      borderRadius: BorderRadius.circular(999),
      clipBehavior: Clip.antiAlias,
      child: Ink(
        decoration: const BoxDecoration(
          gradient: LinearGradient(
            begin: Alignment.topCenter,
            end: Alignment.bottomCenter,
            colors: [Color(0xFFD4B896), Color(0xFFC4A882)],
          ),
          borderRadius: BorderRadius.all(Radius.circular(999)),
        ),
        child: InkWell(
          onTap: onPressed,
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
            child: Text(
              label,
              style: const TextStyle(
                color: Color(0xFF0C0C0D),
                fontSize: 12,
                fontWeight: FontWeight.w600,
                letterSpacing: 0.1,
              ),
            ),
          ),
        ),
      ),
    );
  }
}

// ── Account popup menu — reproduces website `account-menu__panel` exactly ─────
//
// Website HTML order (index.html):
//   button "Manage lists"
//   button "Share"
//   button "Theme"
//   div.account-menu__lang
//     label "Language"
//     button "English" | button "العربية"
//   <hr>
//   button "Change code"
//   button "Delete account" (destructive)
//   <hr>
//   button "Sign out"
//
// Switch list was removed from this menu — it is now the tappable title
// in WatchlistHeader (when the account has > 1 list).

class _AccountMenu extends ConsumerStatefulWidget {
  const _AccountMenu({
    required this.l10n,
    required this.sharePublishing,
    required this.onShare,
    required this.onManageLists,
    required this.onChangeCode,
    required this.onDeleteAccount,
    required this.onSignOut,
    required this.onSurface,
    required this.theme,
  });

  final L10n l10n;
  final bool sharePublishing;
  final VoidCallback onShare;
  final VoidCallback onManageLists;
  final VoidCallback onChangeCode;
  final VoidCallback onDeleteAccount;
  final VoidCallback onSignOut;
  final Color onSurface;
  final ThemeData theme;

  @override
  ConsumerState<_AccountMenu> createState() => _AccountMenuState();
}

class _AccountMenuState extends ConsumerState<_AccountMenu> {
  final _triggerKey = GlobalKey();

  void _openMenu() {
    final anchorContext = _triggerKey.currentContext;
    if (anchorContext == null) return;
    showAccountMenuPanel(
      context: context,
      anchorContext: anchorContext,
      parentContext: context,
      l10n: widget.l10n,
      sharePublishing: widget.sharePublishing,
      onManageLists: widget.onManageLists,
      onShare: widget.onShare,
      onChangeCode: widget.onChangeCode,
      onDeleteAccount: widget.onDeleteAccount,
      onSignOut: widget.onSignOut,
    );
  }

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      key: _triggerKey,
      onTap: _openMenu,
      child: DecoratedBox(
        decoration: BoxDecoration(
          color: widget.onSurface.withValues(alpha: 0.06),
          borderRadius: BorderRadius.circular(8),
          border: Border.all(color: widget.onSurface.withValues(alpha: 0.1)),
        ),
        child: Padding(
          padding: const EdgeInsets.all(7),
          child: Icon(
            Icons.more_vert,
            size: 18,
            color: widget.onSurface.withValues(alpha: 0.75),
          ),
        ),
      ),
    );
  }
}

// ── Stats chip row — mirrors `.header__stats` ─────────────────────────────────

class _StatsRow extends StatelessWidget {
  const _StatsRow({
    required this.total,
    required this.watchedCount,
    required this.syncStatus,
    required this.cloudConfigured,
    required this.l10n,
    required this.tc,
    required this.onSurface,
  });

  final int total;
  final int watchedCount;
  final SyncDisplayStatus syncStatus;
  final bool cloudConfigured;
  final L10n l10n;
  final AppTypeColors? tc;
  final Color onSurface;

  @override
  Widget build(BuildContext context) {
    final syncLabel = _syncLabel();
    final watchedColor = tc?.watched ?? const Color(0xFF58C322);

    return Wrap(
      spacing: 6,
      runSpacing: 6,
      crossAxisAlignment: WrapCrossAlignment.center,
      children: [
        _StatChip(
          value: '$total',
          label: l10n.statsTotal,
          onSurface: onSurface,
        ),
        _StatChip(
          value: '$watchedCount',
          label: l10n.statsWatched,
          valueColor: watchedColor,
          onSurface: onSurface,
        ),
        if (!cloudConfigured)
          _SyncLabel(
            icon: Icons.storage_outlined,
            label: l10n.syncLocal,
            onSurface: onSurface,
          )
        else if (syncLabel != null)
          _SyncLabel(
            icon: syncStatus == SyncDisplayStatus.pending
                ? Icons.cloud_upload_outlined
                : Icons.cloud_off_outlined,
            label: syncLabel,
            onSurface: onSurface,
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
        _ => null,
      };
}

class _StatChip extends StatelessWidget {
  const _StatChip({
    required this.value,
    required this.label,
    required this.onSurface,
    this.valueColor,
  });

  final String value;
  final String label;
  final Color onSurface;
  final Color? valueColor;

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: onSurface.withValues(alpha: 0.14)),
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4.5),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              value,
              style: TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.w600,
                color: valueColor ?? onSurface,
                fontFeatures: const [FontFeature.tabularFigures()],
              ),
            ),
            const SizedBox(width: 4),
            Text(
              label,
              style: TextStyle(
                fontSize: 11.5,
                fontWeight: FontWeight.w500,
                color: onSurface.withValues(alpha: 0.55),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _SyncLabel extends StatelessWidget {
  const _SyncLabel({
    required this.icon,
    required this.label,
    required this.onSurface,
    this.isError = false,
  });

  final IconData icon;
  final String label;
  final Color onSurface;
  final bool isError;

  @override
  Widget build(BuildContext context) {
    final color = isError
        ? Theme.of(context).colorScheme.error
        : onSurface.withValues(alpha: 0.55);
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(icon, size: 13, color: color),
        const SizedBox(width: 4),
        Text(
          label,
          style: TextStyle(
            fontSize: 11.5,
            color: color,
          ),
        ),
      ],
    );
  }
}
