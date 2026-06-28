import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import '../../../core/utils/clipboard_copy.dart';
import '../../../core/utils/pending_share.dart';
import '../../../core/utils/import_file.dart';
import '../../../core/utils/watchlist_import.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../app/router.dart';
import '../../../core/config/environment.dart';
import '../../../core/services/session_service.dart';
import '../../../core/widgets/responsive_layout.dart';
import '../../../l10n/l10n.dart';
import '../../../models/list_library_entry.dart';
import '../../../models/session.dart';
import '../../../models/share_snapshot_payload.dart';
import '../../../models/watchlist_item.dart';
import '../../../repositories/auth_repository.dart';
import '../../../repositories/watchlist_repository.dart';
import '../../account/presentation/change_code_sheet.dart';
import '../../add_title/presentation/add_title_sheet.dart';
import 'widgets/watchlist_header.dart';
import '../../lists/presentation/widgets/manage_lists_sheet.dart';
import '../../lists/presentation/widgets/move_list_sheet.dart';
import '../application/watchlist_controller.dart';
import '../application/watchlist_filters.dart';
import '../application/link_preview_controller.dart';
import '../application/title_meta_backfill.dart';
import '../application/title_meta_backfill_controller.dart';
import '../application/poster_backfill_controller.dart';
import '../application/ratings_backfill.dart';
import '../application/ratings_backfill_controller.dart';
import '../application/year_backfill.dart';
import '../../../core/utils/rating_utils.dart';
import '../application/year_backfill_controller.dart';
import 'widgets/card_layout_toggle.dart';
import 'widgets/item_detail_sheet.dart';
import 'widgets/rating_sheet.dart';
import 'widgets/title_card.dart';
import 'widgets/link_preview_layer.dart';
import 'widgets/genre_section.dart';
import 'widgets/import_new_list_sheet.dart';
import 'widgets/import_share_sheet.dart';
import 'widgets/share_arrival_banner.dart';
import 'widgets/share_result_dialog.dart';
import 'widgets/title_form_sheet.dart';
import 'widgets/type_tab_bar.dart';
import 'widgets/watchlist_filter_bar.dart';
import 'widgets/watchlist_panel.dart';
import 'widgets/watchlist_stats_bar.dart';

class WatchlistScreen extends ConsumerStatefulWidget {
  const WatchlistScreen({super.key, this.shareId});

  final String? shareId;

  @override
  ConsumerState<WatchlistScreen> createState() => _WatchlistScreenState();
}

class _WatchlistScreenState extends ConsumerState<WatchlistScreen> {
  ShareSnapshotPayload? _arrivalPayload;
  String? _arrivalError;
  bool _arrivalLoading = false;
  bool _sharePublishing = false;
  String? _resolvedShareId;
  String? _importPromptedForShareId;
  bool _codeUpgradePrompted = false;

  @override
  void initState() {
    super.initState();
    final shareId = resolvePendingShareId(fromRoute: widget.shareId);
    if (shareId != null && shareId.isNotEmpty) {
      _resolvedShareId = shareId;
      _arrivalLoading = true;
    }
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _initShareArrival();
      _maybePromptCodeUpgrade(ref.read(sessionProvider));
    });
  }

  @override
  void didUpdateWidget(covariant WatchlistScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.shareId != widget.shareId) {
      _initShareArrival();
    }
  }

  Future<void> _initShareArrival({bool force = false}) async {
    final shareId = resolvePendingShareId(fromRoute: widget.shareId);
    if (shareId == null || shareId.isEmpty) {
      if (mounted) {
        setState(() {
          _resolvedShareId = null;
          _arrivalPayload = null;
          _arrivalError = null;
          _arrivalLoading = false;
        });
      }
      return;
    }

    if (!force &&
        shareId == _resolvedShareId &&
        !_arrivalLoading &&
        (_arrivalPayload != null || _arrivalError != null)) {
      return;
    }

    setState(() {
      _resolvedShareId = shareId;
      _arrivalLoading = true;
      _arrivalError = null;
      _arrivalPayload = null;
    });

    await persistPendingShareId(shareId);

    final result = await ref
        .read(watchlistControllerProvider.notifier)
        .fetchShareSnapshot(shareId);

    if (!mounted) return;

    setState(() {
      _arrivalLoading = false;
      _arrivalError = result.errorKey;
      _arrivalPayload = result.payload;
    });

    if (result.payload != null && _importPromptedForShareId != shareId) {
      _importPromptedForShareId = shareId;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) _openShareArrivalImport();
      });
    }
  }

  void _dismissShareArrival() {
    unawaited(clearPendingShareId());
    final uri = GoRouterState.of(context).uri;
    if (uri.queryParameters.containsKey('share')) {
      context.go(AppRoutes.home);
    }
    setState(() {
      _resolvedShareId = null;
      _arrivalPayload = null;
      _arrivalError = null;
    });
  }

  Future<void> _openShareArrivalImport() async {
    final payload = _arrivalPayload;
    if (payload == null) return;

    final l10n = ref.read(l10nProvider);
    final session = ref.read(sessionProvider);
    final auth = ref.read(authRepositoryProvider);
    final snapshot = ref.read(watchlistControllerProvider).value;
    if (snapshot == null) return;

    final listName =
        auth.listLabel(session?.listId, session?.accountId) ?? l10n.appTitle;

    await _openImportOptions(
      payload: payload,
      listName: listName,
      currentCount: snapshot.items.length,
      dismissArrivalOnSuccess: true,
    );
  }

  Future<void> _openImportOptions({
    required ShareSnapshotPayload payload,
    required String listName,
    required int currentCount,
    bool dismissArrivalOnSuccess = false,
  }) async {
    final l10n = ref.read(l10nProvider);

    await showImportShareSheet(
      context,
      l10n: l10n,
      payload: payload,
      currentListName: listName,
      currentCount: currentCount,
      onNewList: () => _finishImportAsNewList(payload, dismissArrivalOnSuccess),
      onMerge: (includeWatched) => _finishImport(
        payload,
        includeWatched,
        dismissArrival: dismissArrivalOnSuccess,
      ),
    );
  }

  Future<void> _finishImportAsNewList(
    ShareSnapshotPayload payload,
    bool dismissArrival,
  ) async {
    final l10n = ref.read(l10nProvider);
    final auth = ref.read(authRepositoryProvider);
    final session = ref.read(sessionProvider);
    if (session == null) return;

    final library = auth.getLibrary(session.accountId);
    final initialName = uniqueImportedListName(
      payload.listName,
      library.map((entry) => entry.name),
    );
    final initialDescription = importedListDescription(payload);

    final form = await showImportNewListSheet(
      context,
      l10n: l10n,
      initialName: initialName,
      initialDescription: initialDescription,
    );

    if (!mounted || form == null) return;

    final result =
        await ref.read(watchlistControllerProvider.notifier).importAsNewList(
              payload: payload,
              name: form.name,
              description: form.description,
            );

    if (!mounted) return;

    if (result.errorKey != null) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(l10n.message(result.errorKey!))),
      );
      return;
    }

    await showDialog<void>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(l10n.importNewListCreatedTitle),
        content: Text(l10n.importOpenedNewList(result.listName ?? initialName)),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: Text(l10n.btnOk),
          ),
        ],
      ),
    );

    if (dismissArrival) _dismissShareArrival();
  }

  Future<void> _finishImport(
    ShareSnapshotPayload payload,
    bool includeWatched, {
    bool dismissArrival = false,
  }) async {
    final l10n = ref.read(l10nProvider);
    final result =
        await ref.read(watchlistControllerProvider.notifier).importShare(
              payload: payload,
              includeWatched: includeWatched,
            );

    if (!mounted) return;

    if (result.errorKey != null && result.errorKey != 'watchlist.syncFailed') {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(l10n.message(result.errorKey!))),
      );
      return;
    }

    final merge = result.merge;
    if (merge != null) {
      final message = includeWatched
          ? l10n.importMergedWithWatchMessage(
              added: merge.added,
              skipped: merge.skipped,
            )
          : l10n.importMergedMessage(
              added: merge.added,
              skipped: merge.skipped,
            );

      await showDialog<void>(
        context: context,
        builder: (context) => AlertDialog(
          title: Text(l10n.shareListUpdatedTitle),
          content: Text(message),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context),
              child: Text(l10n.btnOk),
            ),
          ],
        ),
      );
    }

    if (result.errorKey == 'watchlist.syncFailed' && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(l10n.message('watchlist.syncFailed'))),
      );
    }

    if (dismissArrival) {
      _dismissShareArrival();
    }
  }

  Future<void> _showCodeUpdatedDialog() async {
    final l10n = ref.read(l10nProvider);
    await showDialog<void>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(l10n.codeUpdatedTitle),
        content: Text(l10n.codeUpdatedBody),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: Text(l10n.btnOk),
          ),
        ],
      ),
    );
  }

  Future<void> _changeCode() async {
    final l10n = ref.read(l10nProvider);
    final changed = await showChangeCodeSheet(context, ref, l10n: l10n);
    if (!mounted || !changed) return;
    ref.invalidate(watchlistControllerProvider);
    await _showCodeUpdatedDialog();
  }

  void _maybePromptCodeUpgrade(Session? session) {
    if (_codeUpgradePrompted || session?.needsCodeUpgrade != true) return;
    _codeUpgradePrompted = true;

    WidgetsBinding.instance.addPostFrameCallback((_) async {
      if (!mounted) return;
      final l10n = ref.read(l10nProvider);
      await showDialog<void>(
        context: context,
        builder: (context) => AlertDialog(
          title: Text(l10n.codeUpgradeTitle),
          content: Text(l10n.codeUpgradeBody),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context),
              child: Text(l10n.btnOk),
            ),
          ],
        ),
      );
      if (!mounted) return;
      await _changeCode();
    });
  }

  Future<void> _deleteAccount() async {
    final session = ref.read(sessionProvider);
    if (session == null) return;

    final l10n = ref.read(l10nProvider);
    final auth = ref.read(authRepositoryProvider);
    final listCount = auth.getLibrary(session.accountId).length;

    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(l10n.deleteAccountTitle),
        content: Text(l10n.deleteAccountConfirm(listCount)),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: Text(l10n.btnCancel),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            style: FilledButton.styleFrom(
              backgroundColor: Theme.of(context).colorScheme.error,
              foregroundColor: Theme.of(context).colorScheme.onError,
            ),
            child: Text(l10n.menuDeleteAccount),
          ),
        ],
      ),
    );

    if (confirmed != true || !mounted) return;

    final result = await auth.deleteAccount(session);
    await ref.read(sessionProvider.notifier).clearSession();
    ref.invalidate(watchlistControllerProvider);

    if (!mounted) return;

    if (!result.cloudOk) {
      await showDialog<void>(
        context: context,
        builder: (context) => AlertDialog(
          title: Text(l10n.deleteAccountPartialTitle),
          content: Text(l10n.deleteAccountPartialBody),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context),
              child: Text(l10n.btnOk),
            ),
          ],
        ),
      );
    }

    if (mounted) {
      context.go('${AppRoutes.gate}?deleted=1');
    }
  }

  Future<void> _signOut() async {
    await ref.read(sessionProvider.notifier).clearSession();
    ref.invalidate(watchlistControllerProvider);
    if (mounted) {
      context.go('${AppRoutes.gate}?mode=create');
    }
  }

  Future<void> _shareList() async {
    if (_sharePublishing) return;

    final l10n = ref.read(l10nProvider);
    final session = ref.read(sessionProvider);
    final auth = ref.read(authRepositoryProvider);
    final snapshot = ref.read(watchlistControllerProvider).value;
    if (snapshot == null) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(l10n.message('watchlist.notLoaded'))),
        );
      }
      return;
    }

    final listName =
        auth.listLabel(session?.listId, session?.accountId) ?? l10n.appTitle;
    final currentUri = GoRouterState.of(context).uri;

    setState(() => _sharePublishing = true);

    try {
      final published = await ref
          .read(watchlistControllerProvider.notifier)
          .publishShareLink(listName: listName, currentUri: currentUri);

      if (!mounted) return;

      if (published.ok && published.shareUrl != null) {
        await showShareResultDialog(
          context,
          l10n: l10n,
          shareUrl: published.shareUrl!,
          listName: listName,
          currentUri: currentUri,
        );
        return;
      }

      if (published.errorKey == 'share.needsCloud' ||
          published.errorKey == 'share.publishFailed') {
        final payload = ref
            .read(watchlistControllerProvider.notifier)
            .buildSharePayload(listName: listName);
        if (payload != null) {
          await _exportBackupFile(payload, l10n);
          return;
        }
      }

      if (published.errorKey != null && mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(l10n.message(published.errorKey!))),
        );
      }
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(l10n.message('share.publishFailed'))),
        );
      }
    } finally {
      if (mounted) setState(() => _sharePublishing = false);
    }
  }

  Future<void> _importFromFile() async {
    final l10n = ref.read(l10nProvider);
    final result = await pickImportPayloadFromFile();

    if (!mounted) return;

    if (result.cancelled) return;

    if (result.invalid || result.payload == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(l10n.importInvalidFile)),
      );
      return;
    }

    final session = ref.read(sessionProvider);
    final auth = ref.read(authRepositoryProvider);
    final listName =
        auth.listLabel(session?.listId, session?.accountId) ?? l10n.appTitle;
    final snapshot = ref.read(watchlistControllerProvider).value;
    await _openImportOptions(
      payload: result.payload!,
      listName: listName,
      currentCount: snapshot?.items.length ?? 0,
    );
  }

  Future<void> _exportBackupFile(
    ShareSnapshotPayload payload,
    L10n l10n,
  ) async {
    final json = const JsonEncoder.withIndent('  ').convert(payload.toJson());
    await copyLinkText(json);
    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(l10n.shareBackupCopied)),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = ref.watch(l10nProvider);
    ref.listen(sessionProvider, (previous, next) {
      if (previous == null && next != null) {
        WidgetsBinding.instance.addPostFrameCallback((_) {
          if (mounted) _initShareArrival(force: true);
        });
      }
      _maybePromptCodeUpgrade(next);
    });
    final session = ref.watch(sessionProvider);
    final auth = ref.watch(authRepositoryProvider);
    final cloud = ref.watch(appConfigProvider).isSupabaseConfigured;
    final listName = auth.listLabel(session?.listId, session?.accountId);
    final watchlistAsync = ref.watch(watchlistControllerProvider);
    final typeFilter = ref.watch(watchlistTypeFilterProvider);
    final filters = ref.watch(watchlistFilterProvider);
    final filterNotifier = ref.read(watchlistFilterProvider.notifier);
    final showArrival = _resolvedShareId != null ||
        _arrivalLoading ||
        _arrivalError != null ||
        _arrivalPayload != null;

    // Build the header widget. Stats + sync status come from the snapshot
    // when available; the Add Title button is wired only when data is ready.
    Widget buildHeader({
      int total = 0,
      int watchedCount = 0,
      int inProgressCount = 0,
      SyncDisplayStatus syncStatus = SyncDisplayStatus.local,
      VoidCallback? onAdd,
    }) =>
        WatchlistHeader(
          listName: listName ?? l10n.appTitle,
          total: total,
          watchedCount: watchedCount,
          inProgressCount: inProgressCount,
          watchedFilter: filters.watchedFilter,
          onWatchedFilterChanged: filterNotifier.setWatchedFilter,
          syncStatus: syncStatus,
          cloudConfigured: cloud,
          sharePublishing: _sharePublishing,
          l10n: l10n,
          onAdd: onAdd,
          onShare: _shareList,
          onManageLists: () => showManageListsSheet(context, ref, l10n: l10n),
          onImportFile: _importFromFile,
          onChangeCode: _changeCode,
          onDeleteAccount: _deleteAccount,
          onSignOut: _signOut,
        );

    return Scaffold(
      backgroundColor: Colors.transparent,
      body: SafeArea(
        child: ResponsiveBody(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              if (showArrival) ...[
                ShareArrivalBanner(
                  l10n: l10n,
                  loading: _arrivalLoading,
                  errorKey: _arrivalError,
                  payload: _arrivalPayload,
                  onReview: _openShareArrivalImport,
                  onDismiss: _dismissShareArrival,
                ),
                const SizedBox(height: 12),
              ],
              watchlistAsync.maybeWhen(
                data: (s) => buildHeader(
                  total: s.total,
                  watchedCount: s.watchedCount,
                  inProgressCount: s.inProgressCount,
                  syncStatus: s.syncStatus,
                  onAdd: () => _openAddForm(context, ref, l10n, typeFilter, s),
                ),
                orElse: () => buildHeader(),
              ),
              Expanded(
                child: watchlistAsync.when(
                  loading: () =>
                      const Center(child: CircularProgressIndicator()),
                  error: (error, _) => Center(
                    child: Padding(
                      padding: const EdgeInsets.all(24),
                      child: Text(
                        l10n.watchlistLoadError(error.toString()),
                        textAlign: TextAlign.center,
                      ),
                    ),
                  ),
                  data: (snapshot) => _WatchlistBody(
                    snapshot: snapshot,
                    typeFilter: typeFilter,
                    cloudConfigured: cloud,
                    l10n: l10n,
                    onTypeChanged: (filter) => ref
                        .read(watchlistTypeFilterProvider.notifier)
                        .setFilter(filter),
                    onItemTap: (item) =>
                        _onItemTap(context, ref, l10n, item, snapshot),
                    onItemAction: (item, action) => _handleCardAction(
                        context, ref, l10n, item, snapshot, action),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Future<void> _openAddForm(
    BuildContext context,
    WidgetRef ref,
    L10n l10n,
    WatchlistTypeFilter typeFilter,
    WatchlistSnapshot? snapshot,
  ) async {
    final initialType = typeFilter.contentTypeKey ?? 'movies';
    final items = snapshot?.items ?? const [];
    await showAddTitleSheet(
      context,
      l10n: l10n,
      initialContentType: initialType,
      existingItems: items,
      onSave: (item) => ref.read(watchlistControllerProvider.notifier).saveItem(
            item: item,
          ),
      onSaveBulk: (items) =>
          ref.read(watchlistControllerProvider.notifier).saveItemsBulk(items),
    );
  }

  Future<void> _onItemTap(
    BuildContext context,
    WidgetRef ref,
    L10n l10n,
    WatchlistItem item,
    WatchlistSnapshot snapshot,
  ) async {
    if (AppBreakpoints.isMobile(context)) {
      final session = ref.read(sessionProvider);
      final library = session == null
          ? const <ListLibraryEntry>[]
          : ref.read(authRepositoryProvider).getLibrary(session.accountId);

      final action = await showItemDetailSheet(
        context,
        l10n: l10n,
        item: item,
        watched: snapshot.watched[item.id],
        canMoveToList: library.length > 1,
      );

      if (!context.mounted || action == null) return;
      await _handleDetailAction(
        context,
        ref,
        l10n,
        item,
        snapshot,
        action,
      );
      return;
    }

    await _openEditForm(context, ref, l10n, item, snapshot);
  }

  Future<void> _handleDetailAction(
    BuildContext context,
    WidgetRef ref,
    L10n l10n,
    WatchlistItem item,
    WatchlistSnapshot snapshot,
    ItemDetailAction action,
  ) async {
    switch (action) {
      case ItemDetailAction.rate:
        await _openRatingSheet(context, ref, l10n, item, snapshot);
      case ItemDetailAction.edit:
        await _openEditForm(context, ref, l10n, item, snapshot);
      case ItemDetailAction.toggleWatched:
        await _handleCardAction(
          context,
          ref,
          l10n,
          item,
          snapshot,
          TitleCardAction.toggleWatched,
        );
      case ItemDetailAction.moveToList:
        await _handleCardAction(
          context,
          ref,
          l10n,
          item,
          snapshot,
          TitleCardAction.moveToList,
        );
      case ItemDetailAction.delete:
        await _handleCardAction(
          context,
          ref,
          l10n,
          item,
          snapshot,
          TitleCardAction.delete,
        );
    }
  }

  Future<void> _openEditForm(
    BuildContext context,
    WidgetRef ref,
    L10n l10n,
    WatchlistItem item,
    WatchlistSnapshot snapshot,
  ) async {
    await showTitleFormSheet(
      context,
      mode: TitleFormMode.edit,
      l10n: l10n,
      item: item,
      watched: snapshot.watched[item.id],
      onSave: (updated, watch) =>
          ref.read(watchlistControllerProvider.notifier).saveItem(
                item: updated,
                editingId: item.id,
                markWatched: watch.markWatched,
                rating: watch.rating,
                watchNote: watch.note,
              ),
      onDelete: () =>
          ref.read(watchlistControllerProvider.notifier).deleteItem(item.id),
    );
  }

  Future<void> _handleCardAction(
    BuildContext context,
    WidgetRef ref,
    L10n l10n,
    WatchlistItem item,
    WatchlistSnapshot snapshot,
    TitleCardAction action,
  ) async {
    final controller = ref.read(watchlistControllerProvider.notifier);

    switch (action) {
      case TitleCardAction.rate:
        await _openRatingSheet(context, ref, l10n, item, snapshot);
      case TitleCardAction.toggleWatched:
        final watched = snapshot.watched[item.id];
        if (watched != null) {
          if (watchEntryHasUserData(watched)) {
            final confirmed = await showDialog<bool>(
              context: context,
              builder: (context) => AlertDialog(
                title: Text(l10n.markUnwatchedTitle),
                content: Text(l10n.markUnwatchedConfirm),
                actions: [
                  TextButton(
                    onPressed: () => Navigator.pop(context, false),
                    child: Text(l10n.btnCancel),
                  ),
                  FilledButton(
                    onPressed: () => Navigator.pop(context, true),
                    child: Text(l10n.cardMarkUnwatched),
                  ),
                ],
              ),
            );
            if (confirmed != true || !context.mounted) return;
          }
          final errorKey = await controller.markUnwatched(item.id);
          if (errorKey != null && context.mounted) {
            ScaffoldMessenger.of(context).showSnackBar(
              SnackBar(content: Text(l10n.message(errorKey))),
            );
          }
        } else {
          final errorKey = await controller.markWatchedLater(item.id);
          if (!context.mounted) return;
          if (errorKey != null) {
            ScaffoldMessenger.of(context).showSnackBar(
              SnackBar(content: Text(l10n.message(errorKey))),
            );
            return;
          }
          final refreshed = ref.read(watchlistControllerProvider).value;
          if (refreshed != null) {
            await _openRatingSheet(context, ref, l10n, item, refreshed);
          }
        }
      case TitleCardAction.moveToList:
        await showMoveListSheet(
          context,
          ref,
          l10n: l10n,
          item: item,
        );
      case TitleCardAction.delete:
        final confirmed = await showDialog<bool>(
          context: context,
          builder: (context) => AlertDialog(
            title: Text(l10n.deleteTitleTitle),
            content: Text(l10n.deleteTitleConfirm(item.title)),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(context, false),
                child: Text(l10n.btnCancel),
              ),
              FilledButton(
                onPressed: () => Navigator.pop(context, true),
                child: Text(l10n.btnDelete),
              ),
            ],
          ),
        );
        if (confirmed != true || !context.mounted) return;
        final errorKey = await controller.deleteItem(item.id);
        if (errorKey != null && context.mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text(l10n.message(errorKey))),
          );
        }
    }
  }

  Future<void> _openRatingSheet(
    BuildContext context,
    WidgetRef ref,
    L10n l10n,
    WatchlistItem item,
    WatchlistSnapshot snapshot,
  ) async {
    final controller = ref.read(watchlistControllerProvider.notifier);
    await showRatingSheet(
      context,
      l10n: l10n,
      item: item,
      watched: snapshot.watched[item.id],
      onSave: ({required rating, note}) => controller.saveWatchRating(
        itemId: item.id,
        rating: rating,
        note: note,
      ),
      onRateLater: () => controller.markWatchedLater(item.id),
    );
  }
}

class _WatchlistBody extends ConsumerWidget {
  const _WatchlistBody({
    required this.snapshot,
    required this.typeFilter,
    required this.cloudConfigured,
    required this.l10n,
    required this.onTypeChanged,
    required this.onItemTap,
    required this.onItemAction,
  });

  final WatchlistSnapshot snapshot;
  final WatchlistTypeFilter typeFilter;
  final bool cloudConfigured;
  final L10n l10n;
  final ValueChanged<WatchlistTypeFilter> onTypeChanged;
  final ValueChanged<WatchlistItem> onItemTap;
  final void Function(WatchlistItem item, TitleCardAction action) onItemAction;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final filters = ref.watch(watchlistFilterProvider);
    final yearProgress = ref.watch(yearBackfillControllerProvider);
    final ratingsProgress = ref.watch(ratingsBackfillControllerProvider);
    final titleMetaProgress = ref.watch(titleMetaBackfillControllerProvider);
    final config = ref.watch(appConfigProvider);
    final filtered = filterWatchlistItems(
      items: snapshot.items,
      watched: snapshot.watched,
      typeFilter: typeFilter,
      filters: filters,
    );
    final counts = {
      for (final type in WatchlistTypeFilter.values)
        type: filterWatchlistItems(
          items: snapshot.items,
          watched: snapshot.watched,
          typeFilter: type,
          filters: filters,
        ).length,
    };
    final groups = buildFilteredGroups(
      items: snapshot.items,
      watched: snapshot.watched,
      typeFilter: typeFilter,
      filters: filters,
    );
    final backfillRunning =
        yearProgress.running || ratingsProgress.running || titleMetaProgress.running;
    final releaseHintKey = isReleaseSortActive(filters)
        ? releaseSortEmptyHintKey(
            items: snapshot.items,
            backfillRunning: backfillRunning,
            config: config,
          )
        : null;
    final ageHintKey = isAgeSortActive(filters)
        ? ageSortEmptyHintKey(
            items: snapshot.items,
            backfillRunning: titleMetaProgress.running,
            config: config,
          )
        : null;
    final ratingHintKey =
        isImdbSortActive(filters) || isAnilistSortActive(filters)
            ? ratingSortEmptyHintKey(
                items: snapshot.items,
                sortSource: filters.sortSource,
                ratingsBackfillRunning: backfillRunning,
                config: config,
              )
            : null;

    return Stack(
      clipBehavior: Clip.none,
      children: [
        NotificationListener<ScrollNotification>(
          onNotification: (notification) {
            ref.read(linkPreviewControllerProvider.notifier).hide();
            return false;
          },
          child: ListView(
            children: [
              const RatingsBackfillOrchestrator(),
              const TitleMetaBackfillOrchestrator(),
              const PosterBackfillOrchestrator(),
              WatchlistPanel(
                tabs: TypeTabBar(
                  selected: typeFilter,
                  counts: counts,
                  onChanged: onTypeChanged,
                  l10n: l10n,
                ),
                filters: snapshot.items.isNotEmpty
                    ? WatchlistFilterBar(items: snapshot.items, l10n: l10n)
                    : null,
              ),
              if (snapshot.items.isNotEmpty)
                Transform.translate(
                  offset: Offset(
                    0,
                    AppBreakpoints.isMobile(context) ? -5.6 : -12,
                  ),
                  child: Padding(
                    padding: EdgeInsets.only(
                      bottom: AppBreakpoints.isMobile(context) ? 8.8 : 24,
                    ),
                    child: Align(
                      alignment: AlignmentDirectional.centerStart,
                      child: CardLayoutToggle(l10n: l10n),
                    ),
                  ),
                ),
              if (snapshot.isEmptyList || snapshot.items.isEmpty)
                WatchlistEmptyState(l10n: l10n)
              else if (filtered.isEmpty)
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 32),
                  child: Center(
                    child: Text(
                      _emptyFilterMessage(
                        l10n: l10n,
                        filters: filters,
                        releaseHintKey: releaseHintKey,
                        ageHintKey: ageHintKey,
                        ratingHintKey: ratingHintKey,
                      ),
                      textAlign: TextAlign.center,
                    ),
                  ),
                )
              else if (groups.isEmpty)
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 32),
                  child: Center(child: Text(l10n.emptySearch)),
                )
              else
                ...groups.map(
                  (group) => GenreSection(
                    group: group,
                    watched: snapshot.watched,
                    l10n: l10n,
                    onItemTap: onItemTap,
                    onItemAction: onItemAction,
                  ),
                ),
              const SizedBox(height: 80),
            ],
          ),
        ),
        const LinkPreviewLayer(),
      ],
    );
  }
}

String _emptyFilterMessage({
  required L10n l10n,
  required WatchlistFilterState filters,
  required String? releaseHintKey,
  required String? ageHintKey,
  required String? ratingHintKey,
}) {
  if (ratingHintKey != null && !_hasPanelFilters(filters)) {
    return switch (ratingHintKey) {
      'empty.ratingLoading' => l10n.emptyRatingLoading,
      'empty.ratingMissing' => l10n.emptyRatingMissing,
      'empty.ratingNeedConfig' => l10n.emptyRatingNeedConfig,
      'empty.anilistRatingLoading' => l10n.emptyAnilistRatingLoading,
      'empty.anilistRatingMissing' => l10n.emptyAnilistRatingMissing,
      _ => l10n.message(ratingHintKey),
    };
  }
  if (ageHintKey != null && !_hasPanelFilters(filters)) {
    return switch (ageHintKey) {
      'empty.ageRatingLoading' => l10n.emptyAgeRatingLoading,
      'empty.ageRatingMissing' => l10n.emptyAgeRatingMissing,
      'empty.yearsNeedConfig' => l10n.emptyYearsNeedConfig,
      _ => l10n.message(ageHintKey),
    };
  }
  if (releaseHintKey != null && !_hasPanelFilters(filters)) {
    return switch (releaseHintKey) {
      'empty.releaseYearLoading' => l10n.emptyReleaseYearLoading,
      'empty.releaseYearMissing' => l10n.emptyReleaseYearMissing,
      'empty.yearsNeedConfig' => l10n.emptyYearsNeedConfig,
      _ => l10n.message(releaseHintKey),
    };
  }
  return filters.hasActiveFilters ? l10n.emptySearch : l10n.emptyFilter;
}

bool _hasPanelFilters(WatchlistFilterState filters) =>
    filters.search.trim().isNotEmpty ||
    filters.selectedGenres.isNotEmpty ||
    filters.watchedFilter != WatchedFilter.all;
