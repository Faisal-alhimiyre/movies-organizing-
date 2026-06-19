import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import '../../../core/utils/clipboard_copy.dart';
import '../../../core/utils/pending_share.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../app/router.dart';
import '../../../core/config/environment.dart';
import '../../../core/services/session_service.dart';
import '../../../core/widgets/app_shell.dart';
import '../../../l10n/l10n.dart';
import '../../../models/share_snapshot_payload.dart';
import '../../../models/watchlist_item.dart';
import '../../../repositories/auth_repository.dart';
import '../../../repositories/watchlist_repository.dart';
import '../../lists/presentation/widgets/list_switcher_bar.dart';
import '../../lists/presentation/widgets/manage_lists_sheet.dart';
import '../application/watchlist_controller.dart';
import '../application/watchlist_filters.dart';
import 'widgets/genre_section.dart';
import 'widgets/import_share_sheet.dart';
import 'widgets/share_arrival_banner.dart';
import 'widgets/share_result_dialog.dart';
import 'widgets/title_form_sheet.dart';
import 'widgets/type_tab_bar.dart';
import 'widgets/watchlist_filter_bar.dart';
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

  @override
  void initState() {
    super.initState();
    final shareId = resolvePendingShareId(fromRoute: widget.shareId);
    if (shareId != null && shareId.isNotEmpty) {
      _resolvedShareId = shareId;
      _arrivalLoading = true;
    }
    WidgetsBinding.instance.addPostFrameCallback((_) => _initShareArrival());
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

    if (result.payload != null &&
        _importPromptedForShareId != shareId) {
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

    final listName = auth.listLabel(session?.listId, session?.accountId) ?? l10n.appTitle;

    await showImportShareSheet(
      context,
      l10n: l10n,
      payload: payload,
      currentListName: listName,
      currentCount: snapshot.items.length,
      onImport: (includeWatched) => _finishImport(payload, includeWatched),
    );
  }

  Future<void> _finishImport(
    ShareSnapshotPayload payload,
    bool includeWatched,
  ) async {
    final l10n = ref.read(l10nProvider);
    final result = await ref.read(watchlistControllerProvider.notifier).importShare(
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

    _dismissShareArrival();
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
    });
    final session = ref.watch(sessionProvider);
    final auth = ref.watch(authRepositoryProvider);
    final cloud = ref.watch(appConfigProvider).isSupabaseConfigured;
    final listName = auth.listLabel(session?.listId, session?.accountId);
    final watchlistAsync = ref.watch(watchlistControllerProvider);
    final typeFilter = ref.watch(watchlistTypeFilterProvider);
    final showArrival = _resolvedShareId != null ||
        _arrivalLoading ||
        _arrivalError != null ||
        _arrivalPayload != null;

    return AppShell(
      title: listName ?? l10n.appTitle,
      actions: [
        IconButton(
          tooltip: l10n.manageListsTitle,
          onPressed: () => showManageListsSheet(context, ref, l10n: l10n),
          icon: const Icon(Icons.library_books_outlined),
        ),
        IconButton(
          tooltip: l10n.shareSend,
          onPressed: _sharePublishing || watchlistAsync.isLoading ? null : _shareList,
          icon: _sharePublishing
              ? const SizedBox(
                  width: 20,
                  height: 20,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : const Icon(Icons.ios_share),
        ),
        IconButton(
          tooltip: l10n.aboutTitle,
          onPressed: () => context.push(AppRoutes.about),
          icon: const Icon(Icons.info_outline),
        ),
        IconButton(
          tooltip: l10n.menuSignOut,
          onPressed: () async {
            await ref.read(sessionProvider.notifier).clearSession();
            ref.invalidate(watchlistControllerProvider);
            if (context.mounted) {
              context.go('${AppRoutes.gate}?mode=create');
            }
          },
          icon: const Icon(Icons.logout),
        ),
      ],
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => _openAddForm(context, ref, l10n, typeFilter),
        icon: const Icon(Icons.add),
        label: Text(l10n.addTitle),
      ),
      body: Column(
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
          ListSwitcherBar(l10n: l10n),
          Expanded(
            child: watchlistAsync.when(
              loading: () => const Center(child: CircularProgressIndicator()),
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
                    _openEditForm(context, ref, l10n, item, snapshot),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Future<void> _openAddForm(
    BuildContext context,
    WidgetRef ref,
    L10n l10n,
    WatchlistTypeFilter typeFilter,
  ) async {
    final initialType = typeFilter.contentTypeKey ?? 'movies';
    await showTitleFormSheet(
      context,
      mode: TitleFormMode.add,
      l10n: l10n,
      initialContentType: initialType,
      onSave: (item, watch) => ref.read(watchlistControllerProvider.notifier).saveItem(
            item: item,
            markWatched: watch.markWatched,
            rating: watch.rating,
            watchNote: watch.note,
          ),
    );
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
      onSave: (updated, watch) => ref.read(watchlistControllerProvider.notifier).saveItem(
            item: updated,
            editingId: item.id,
            markWatched: watch.markWatched,
            rating: watch.rating,
            watchNote: watch.note,
          ),
      onDelete: () => ref.read(watchlistControllerProvider.notifier).deleteItem(item.id),
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
  });

  final WatchlistSnapshot snapshot;
  final WatchlistTypeFilter typeFilter;
  final bool cloudConfigured;
  final L10n l10n;
  final ValueChanged<WatchlistTypeFilter> onTypeChanged;
  final ValueChanged<WatchlistItem> onItemTap;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final filters = ref.watch(watchlistFilterProvider);
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

    return ListView(
      children: [
        WatchlistStatsBar(
          total: snapshot.total,
          watchedCount: snapshot.watchedCount,
          syncStatus: snapshot.syncStatus,
          cloudConfigured: cloudConfigured,
          l10n: l10n,
        ),
        const SizedBox(height: 16),
        TypeTabBar(
          selected: typeFilter,
          counts: counts,
          onChanged: onTypeChanged,
          l10n: l10n,
        ),
        if (snapshot.items.isNotEmpty) ...[
          const SizedBox(height: 16),
          WatchlistFilterBar(items: snapshot.items, l10n: l10n),
        ],
        const SizedBox(height: 20),
        if (snapshot.isEmptyList || snapshot.items.isEmpty)
          WatchlistEmptyState(l10n: l10n)
        else if (filtered.isEmpty)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 32),
            child: Center(
              child: Text(
                filters.hasActiveFilters ? l10n.emptySearch : l10n.emptyFilter,
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
            ),
          ),
        const SizedBox(height: 80),
      ],
    );
  }
}

class WatchlistEmptyState extends StatelessWidget {
  const WatchlistEmptyState({super.key, required this.l10n});

  final L10n l10n;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 48, horizontal: 24),
      child: Column(
        children: [
          Icon(
            Icons.movie_outlined,
            size: 48,
            color: Theme.of(context).colorScheme.primary,
          ),
          const SizedBox(height: 16),
          Text(
            l10n.emptyListTitle,
            style: Theme.of(context).textTheme.titleMedium,
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: 8),
          Text(
            l10n.emptyListBody,
            style: Theme.of(context).textTheme.bodyMedium,
            textAlign: TextAlign.center,
          ),
        ],
      ),
    );
  }
}
