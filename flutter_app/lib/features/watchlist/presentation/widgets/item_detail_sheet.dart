import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../../../core/utils/rating_utils.dart';
import '../../../../core/widgets/responsive_layout.dart';
import '../../../../app/theme/theme_extensions.dart';
import '../../../../core/widgets/content_badges.dart';
import '../../../../l10n/l10n.dart';
import '../../../../models/metadata_detail.dart';
import '../../../../models/watchlist_item.dart';
import '../../../../repositories/metadata/metadata_service.dart';
import '../../application/title_meta_backfill.dart';
import '../../../../repositories/watchlist_repository.dart';
import '../../application/watchlist_controller.dart';
import 'card_poster.dart';
import 'season_sheet.dart';

enum ItemDetailAction {
  openLink,
  toggleWatched,
  edit,
  moveToList,
  delete,
  rate,
}

Future<ItemDetailAction?> showItemDetailSheet(
  BuildContext context, {
  required L10n l10n,
  required WatchlistItem item,
  required WatchEntry? watched,
  required bool canMoveToList,
}) {
  final isMobile = AppBreakpoints.isMobile(context);

  if (isMobile) {
    return showModalBottomSheet<ItemDetailAction>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      backgroundColor: Colors.transparent,
      barrierColor: Colors.black.withValues(alpha: 0.62),
      builder: (ctx) {
        final bottomInset = MediaQuery.viewInsetsOf(ctx).bottom;
        return Padding(
          padding: EdgeInsets.only(bottom: bottomInset),
          child: DraggableScrollableSheet(
            expand: false,
            initialChildSize: 0.92,
            minChildSize: 0.4,
            maxChildSize: 0.92,
            builder: (context, scrollController) => ItemDetailSheet(
              l10n: l10n,
              item: item,
              watched: watched,
              canMoveToList: canMoveToList,
              scrollController: scrollController,
            ),
          ),
        );
      },
    );
  }

  return showGeneralDialog<ItemDetailAction>(
    context: context,
    barrierDismissible: true,
    barrierLabel: l10n.mobileClose,
    barrierColor: Colors.black.withValues(alpha: 0.78),
    pageBuilder: (context, animation, secondaryAnimation) {
      return ItemDetailSheet(
        l10n: l10n,
        item: item,
        watched: watched,
        canMoveToList: canMoveToList,
      );
    },
    transitionBuilder: (context, animation, secondaryAnimation, child) {
      return FadeTransition(
        opacity: CurvedAnimation(parent: animation, curve: Curves.easeOut),
        child: ScaleTransition(
          scale: Tween<double>(begin: 0.96, end: 1).animate(
            CurvedAnimation(parent: animation, curve: Curves.easeOut),
          ),
          child: child,
        ),
      );
    },
  );
}

class ItemDetailSheet extends ConsumerStatefulWidget {
  const ItemDetailSheet({
    super.key,
    required this.l10n,
    required this.item,
    required this.watched,
    required this.canMoveToList,
    this.scrollController,
  });

  final L10n l10n;
  final WatchlistItem item;
  final WatchEntry? watched;
  final bool canMoveToList;

  /// When set (mobile bottom sheet), drives drag-to-dismiss + inner scroll.
  final ScrollController? scrollController;

  @override
  ConsumerState<ItemDetailSheet> createState() => _ItemDetailSheetState();
}

class _ItemDetailSheetState extends ConsumerState<ItemDetailSheet> {
  WatchlistItem? _item;
  SeasonPresentation? _seasonPresentation;

  WatchlistItem get item => _item ?? widget.item;

  bool get _hasSeasons {
    final ct = item.contentType;
    return ct == 'tvSeries' || ct == 'anime';
  }

  @override
  void initState() {
    super.initState();
    _item = widget.item;
    _loadTitleMetaIfNeeded();
  }

  Future<void> _loadTitleMetaIfNeeded() async {
    final needsMeta = !itemHasTitleMeta(widget.item);
    final needsEpisodeRuntime = itemNeedsEpisodeRuntime(widget.item);
    if (!needsMeta && !needsEpisodeRuntime) return;
    final link = widget.item.link?.trim();
    if (link == null || link.isEmpty) return;

    final metadata = ref.read(metadataServiceProvider);
    MetadataDetail? meta;
    final imdbId = MetadataService.extractImdbId(link);
    if (imdbId != null) {
      meta = await metadata.getMetadata(imdbId, forceRefresh: true);
    } else if (MetadataService.isSupportedLink(link)) {
      meta = await metadata.resolveMetadataFromLink(link, forceRefresh: true);
    }
    if (!mounted || meta == null) return;

    final merged = mergeTitleMetaFromDetail(widget.item, meta);
    if (!itemHasTitleMeta(merged) && !itemNeedsEpisodeRuntime(merged)) return;

    setState(() => _item = merged);

    final snapshot = ref.read(watchlistControllerProvider).value;
    if (snapshot == null) return;
    await ref.read(watchlistControllerProvider.notifier).upsertItem(merged);
  }

  void _close(BuildContext context, [ItemDetailAction? action]) {
    Navigator.of(context).pop(action);
  }

  WatchlistItem _liveItem(WatchlistSnapshot? snapshot) {
    if (snapshot != null) {
      final index = snapshot.items.indexWhere((i) => i.id == widget.item.id);
      if (index != -1) return snapshot.items[index];
    }
    return _item ?? widget.item;
  }

  Widget _buildScrollBody({
    required BuildContext context,
    required WatchlistItem item,
    required WatchEntry? watched,
    required bool isMobile,
  }) {
    return SingleChildScrollView(
      controller: widget.scrollController,
      padding: EdgeInsets.fromLTRB(
        isMobile ? 16 : 20,
        isMobile ? 4 : 8,
        isMobile ? 16 : 20,
        isMobile ? 20 : 16,
      ),
      child: _DetailContent(
        l10n: widget.l10n,
        item: item,
        watched: watched,
        seasonPresentation: _seasonPresentation,
        isMobile: isMobile,
        showSeasons: _hasSeasons,
        onRate: () => _close(context, ItemDetailAction.rate),
        onQuickToggleWatched: () =>
            _close(context, ItemDetailAction.toggleWatched),
        onSeasonPresentation: (presentation) {
          setState(() => _seasonPresentation = presentation);
        },
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final snapshot = ref.watch(watchlistControllerProvider).value;
    final item = _liveItem(snapshot);
    final watched = snapshot?.watched[widget.item.id];
    final theme = Theme.of(context);
    final tc = theme.extension<AppTypeColors>();
    final isMobile = AppBreakpoints.isMobile(context);
    final isDraggableSheet = widget.scrollController != null;
    final size = MediaQuery.sizeOf(context);
    final maxHeight = size.height * (isMobile ? 0.92 : 0.88);
    final panelBg = tc?.bgElevated ?? theme.colorScheme.surfaceContainerHigh;
    final borderColor =
        theme.colorScheme.outline.withValues(alpha: isMobile ? 0.35 : 0.25);

    final panel = Material(
      color: panelBg,
      elevation: isMobile ? 16 : 12,
      shadowColor: Colors.black.withValues(alpha: 0.5),
      shape: RoundedRectangleBorder(
        borderRadius: isMobile
            ? const BorderRadius.vertical(top: Radius.circular(20))
            : BorderRadius.circular(16),
        side: BorderSide(color: borderColor),
      ),
      clipBehavior: Clip.antiAlias,
      child: isDraggableSheet
          ? Column(
              children: [
                const _SheetDragHandle(),
                _DetailTopBar(
                  l10n: widget.l10n,
                  isWatched: watched != null,
                  canMoveToList: widget.canMoveToList,
                  onClose: () => _close(context),
                  onMenuAction: (action) => _close(context, action),
                ),
                Expanded(
                  child: _buildScrollBody(
                    context: context,
                    item: item,
                    watched: watched,
                    isMobile: isMobile,
                  ),
                ),
              ],
            )
          : ConstrainedBox(
              constraints: BoxConstraints(
                maxWidth: isMobile ? size.width : 800,
                maxHeight: maxHeight,
              ),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  if (isMobile) const _SheetDragHandle(),
                  _DetailTopBar(
                    l10n: widget.l10n,
                    isWatched: watched != null,
                    canMoveToList: widget.canMoveToList,
                    onClose: () => _close(context),
                    onMenuAction: (action) => _close(context, action),
                  ),
                  Flexible(
                    child: _buildScrollBody(
                      context: context,
                      item: item,
                      watched: watched,
                      isMobile: isMobile,
                    ),
                  ),
                ],
              ),
            ),
    );

    if (isDraggableSheet) return panel;

    return Align(
      alignment: isMobile ? Alignment.bottomCenter : Alignment.center,
      child: panel,
    );
  }
}

class _SheetDragHandle extends StatelessWidget {
  const _SheetDragHandle();

  @override
  Widget build(BuildContext context) {
    final muted = Theme.of(context).colorScheme.outline.withValues(alpha: 0.55);
    return Padding(
      padding: const EdgeInsets.only(top: 8, bottom: 4),
      child: Container(
        width: 40,
        height: 4,
        decoration: BoxDecoration(
          color: muted,
          borderRadius: BorderRadius.circular(999),
        ),
      ),
    );
  }
}

class _DetailTopBar extends StatelessWidget {
  const _DetailTopBar({
    required this.l10n,
    required this.isWatched,
    required this.canMoveToList,
    required this.onClose,
    required this.onMenuAction,
  });

  final L10n l10n;
  final bool isWatched;
  final bool canMoveToList;
  final VoidCallback onClose;
  final ValueChanged<ItemDetailAction> onMenuAction;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final tc = theme.extension<AppTypeColors>();
    final danger = tc?.menuDangerColor ?? const Color(0xFFF85149);
    final iconFg = theme.colorScheme.onSurface.withValues(alpha: 0.9);
    final iconBg = theme.colorScheme.onSurface.withValues(alpha: 0.08);
    final iconBorder = theme.colorScheme.outline.withValues(alpha: 0.45);

    return Padding(
      padding: const EdgeInsets.fromLTRB(12, 6, 12, 4),
      child: Row(
        children: [
          const Spacer(),
          Tooltip(
            message: l10n.detailOpenMenu,
            child: PopupMenuButton<ItemDetailAction>(
              tooltip: l10n.detailOpenMenu,
              padding: EdgeInsets.zero,
              offset: const Offset(0, 40),
              constraints: const BoxConstraints(minWidth: 32, minHeight: 32),
              onSelected: onMenuAction,
              itemBuilder: (context) => [
                PopupMenuItem(
                  value: ItemDetailAction.toggleWatched,
                  child: Text(
                    isWatched ? l10n.cardMarkUnwatched : l10n.cardMarkWatched,
                  ),
                ),
                PopupMenuItem(
                  value: ItemDetailAction.edit,
                  child: Text(l10n.cardEdit),
                ),
                if (canMoveToList)
                  PopupMenuItem(
                    value: ItemDetailAction.moveToList,
                    child: Text(l10n.cardMoveToList),
                  ),
                PopupMenuItem(
                  value: ItemDetailAction.delete,
                  child: Text(
                    l10n.btnDelete,
                    style: TextStyle(color: danger),
                  ),
                ),
              ],
              child: Material(
                color: iconBg,
                shape: CircleBorder(side: BorderSide(color: iconBorder)),
                clipBehavior: Clip.antiAlias,
                child: SizedBox(
                  width: 32,
                  height: 32,
                  child: Icon(Icons.more_vert, size: 18, color: iconFg),
                ),
              ),
            ),
          ),
          const SizedBox(width: 8),
          _DetailTopBarIconButton(
            tooltip: l10n.mobileClose,
            backgroundColor: iconBg,
            borderColor: danger.withValues(alpha: 0.3),
            foregroundColor: danger,
            onTap: onClose,
            child: Icon(Icons.close, size: 18, color: danger),
          ),
        ],
      ),
    );
  }
}

class _DetailTopBarIconButton extends StatelessWidget {
  const _DetailTopBarIconButton({
    required this.tooltip,
    required this.backgroundColor,
    required this.borderColor,
    required this.foregroundColor,
    required this.child,
    this.onTap,
  });

  final String tooltip;
  final Color backgroundColor;
  final Color borderColor;
  final Color foregroundColor;
  final Widget child;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final button = Material(
      color: backgroundColor,
      shape: CircleBorder(side: BorderSide(color: borderColor)),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        customBorder: const CircleBorder(),
        child: SizedBox(
          width: 32,
          height: 32,
          child: IconTheme(
            data: IconThemeData(color: foregroundColor, size: 18),
            child: Center(child: child),
          ),
        ),
      ),
    );

    return Semantics(
      button: true,
      label: tooltip,
      child: Tooltip(message: tooltip, child: button),
    );
  }
}

class _DetailContent extends StatelessWidget {
  const _DetailContent({
    required this.l10n,
    required this.item,
    required this.watched,
    this.seasonPresentation,
    required this.isMobile,
    required this.showSeasons,
    required this.onRate,
    required this.onQuickToggleWatched,
    required this.onSeasonPresentation,
  });

  final L10n l10n;
  final WatchlistItem item;
  final WatchEntry? watched;
  final SeasonPresentation? seasonPresentation;
  final bool isMobile;
  final bool showSeasons;
  final VoidCallback onRate;
  final VoidCallback onQuickToggleWatched;
  final ValueChanged<SeasonPresentation?> onSeasonPresentation;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final tc = theme.extension<AppTypeColors>();
    final posterWidth = isMobile ? 104.0 : 144.0;
    final posterHeight = posterWidth * 1.5;
    // TV/anime: never mix saved series summary with a season poster.
    final hideSeriesSummary = showSeasons || seasonPresentation != null;
    final headerPoster = seasonPresentation?.posterUrl ??
        (showSeasons ? item.poster : item.displayPoster);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            ClipRRect(
              borderRadius: BorderRadius.circular(8),
              child: SizedBox(
                width: posterWidth,
                height: posterHeight,
                child: CardPoster(
                  key: ValueKey(headerPoster ?? item.displayPoster ?? item.id),
                  item: item,
                  posterOverride: headerPoster,
                ),
              ),
            ),
            const SizedBox(width: 14),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Wrap(
                    spacing: 5,
                    runSpacing: 5,
                    children: [
                      ContentTypeBadge(contentType: item.contentType),
                      if (item.year != null)
                        ContentYearBadge(label: item.year.toString()),
                      ContentTitleMetaBadges.fromItem(item),
                    ],
                  ),
                  const SizedBox(height: 6),
                  Text(
                    item.title,
                    style: theme.textTheme.titleMedium?.copyWith(
                      fontWeight: FontWeight.w700,
                      fontSize: isMobile ? 17 : 20,
                      height: 1.22,
                    ),
                  ),
                  if (item.lead.isNotEmpty) ...[
                    const SizedBox(height: 4),
                    Text(
                      item.lead,
                      style: theme.textTheme.bodySmall?.copyWith(
                        color: tc?.lead ?? kLeadGold,
                        fontSize: 12,
                        height: 1.35,
                      ),
                    ),
                  ],
                  if (_hasExternalRatings(item)) ...[
                    const SizedBox(height: 10),
                    _ExternalRatingsRow(item: item),
                  ],
                ],
              ),
            ),
          ],
        ),
        if (item.genre.isNotEmpty || item.secondaryGenres.isNotEmpty) ...[
          const SizedBox(height: 14),
          Text(
            l10n.cardSectionGenres.toUpperCase(),
            style: theme.textTheme.labelSmall?.copyWith(
              color: tc?.textMuted ??
                  theme.colorScheme.onSurface.withValues(alpha: 0.55),
              fontWeight: FontWeight.w700,
              fontSize: 9,
              letterSpacing: 1.4,
            ),
          ),
          const SizedBox(height: 4),
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: Row(
              children: [
                if (item.genre.isNotEmpty)
                  ContentGenreChip(
                    label: l10n.genreLabel(item.genre),
                    primary: true,
                  ),
                ...item.secondaryGenres.map(
                  (genre) => Padding(
                    padding: const EdgeInsets.only(left: 5),
                    child: ContentGenreChip(
                      label: l10n.genreLabel(genre),
                      primary: false,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ],
        if (seasonPresentation != null) ...[
          const SizedBox(height: 14),
          Text(
            seasonPresentation!.title,
            style: theme.textTheme.titleSmall?.copyWith(
              fontWeight: FontWeight.w700,
              fontSize: 15,
              height: 1.3,
            ),
          ),
          if (seasonPresentation!.overview.isNotEmpty) ...[
            const SizedBox(height: 6),
            Text(
              seasonPresentation!.overview,
              style: theme.textTheme.bodyMedium?.copyWith(
                color: tc?.textMuted ??
                    theme.colorScheme.onSurface.withValues(alpha: 0.72),
                fontSize: 14,
                height: 1.55,
              ),
            ),
          ],
        ],
        if (!hideSeriesSummary && item.summary.isNotEmpty) ...[
          const SizedBox(height: 14),
          Text(
            item.summary,
            style: theme.textTheme.bodyMedium?.copyWith(
              color: tc?.textMuted ??
                  theme.colorScheme.onSurface.withValues(alpha: 0.72),
              fontSize: 14,
              height: 1.55,
            ),
          ),
        ],
        const SizedBox(height: 12),
        _RatingBlock(
          l10n: l10n,
          watched: watched,
          onRate: onRate,
          onQuickToggleWatched: onQuickToggleWatched,
        ),
        if (showSeasons)
          TitleSeasonsPanel(
            l10n: l10n,
            item: item,
            watched: watched,
            embedded: true,
            onSeasonPresentation: onSeasonPresentation,
          ),
      ],
    );
  }
}

class _RatingBlock extends StatelessWidget {
  const _RatingBlock({
    required this.l10n,
    required this.watched,
    required this.onRate,
    required this.onQuickToggleWatched,
  });

  final L10n l10n;
  final WatchEntry? watched;
  final VoidCallback onRate;
  final VoidCallback onQuickToggleWatched;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final tc = theme.extension<AppTypeColors>();
    final isWatched = watched != null;
    final hasRating = hasWatchRating(watched);
    final isFullyWatched = watched?.isFullyWatched ?? false;
    final isInProgress = watched?.isInProgress ?? false;
    final inProgressColor = tc?.inProgress ?? const Color(0xFFFB923C);

    final decoration = BoxDecoration(
      color: theme.colorScheme.onSurface.withValues(alpha: 0.04),
      borderRadius: BorderRadius.circular(8),
      border: Border.all(
        color: theme.colorScheme.outline.withValues(alpha: 0.28),
      ),
    );

    if (!isWatched) {
      return Align(
        alignment: AlignmentDirectional.centerStart,
        child: Material(
          color: Colors.transparent,
          child: InkWell(
            onTap: onQuickToggleWatched,
            borderRadius: BorderRadius.circular(999),
            child: _StatusPill(
              label: l10n.cardUnwatched,
              fg: tc?.textMuted ??
                  theme.colorScheme.onSurface.withValues(alpha: 0.65),
              bg: theme.colorScheme.onSurface.withValues(alpha: 0.04),
              border: theme.colorScheme.outline.withValues(alpha: 0.28),
            ),
          ),
        ),
      );
    }

    if (isInProgress) {
      final note = watched?.note?.trim();
      final hasNote = note != null && note.isNotEmpty;
      final maxWidth = MediaQuery.sizeOf(context).width - 32;
      return Align(
        alignment: AlignmentDirectional.centerStart,
        child: ConstrainedBox(
          constraints: BoxConstraints(maxWidth: maxWidth),
          child: DecoratedBox(
            decoration: decoration,
            child: Padding(
              padding: const EdgeInsets.fromLTRB(8, 7, 8, 7),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Material(
                        color: Colors.transparent,
                        child: InkWell(
                          onTap: onQuickToggleWatched,
                          borderRadius: BorderRadius.circular(999),
                          child: _StatusPill(
                            label: l10n.progressInProgress,
                            fg: inProgressColor,
                            bg: inProgressColor.withValues(alpha: 0.08),
                            border: inProgressColor.withValues(alpha: 0.28),
                          ),
                        ),
                      ),
                      const SizedBox(width: 6),
                      TextButton(
                        onPressed: onRate,
                        style: TextButton.styleFrom(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 8,
                            vertical: 2,
                          ),
                          minimumSize: const Size(0, 28),
                          tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                          visualDensity: VisualDensity.compact,
                          foregroundColor: theme.colorScheme.onSurface
                              .withValues(alpha: 0.78),
                        ),
                        child: Text(
                          hasNote ? l10n.detailEditNote : l10n.detailAddNote,
                          style: theme.textTheme.bodySmall?.copyWith(
                            fontSize: 12,
                          ),
                        ),
                      ),
                    ],
                  ),
                  if (hasNote) ...[
                    const SizedBox(height: 6),
                    Container(
                      constraints: BoxConstraints(maxWidth: maxWidth - 16),
                      padding: const EdgeInsets.only(top: 6),
                      decoration: BoxDecoration(
                        border: Border(
                          top: BorderSide(
                            color:
                                theme.colorScheme.outline.withValues(alpha: 0.2),
                          ),
                        ),
                      ),
                      child: Text(
                        note,
                        style: theme.textTheme.bodySmall?.copyWith(
                          color: tc?.textMuted ??
                              theme.colorScheme.onSurface
                                  .withValues(alpha: 0.72),
                          fontSize: 12,
                          height: 1.45,
                        ),
                      ),
                    ),
                  ],
                ],
              ),
            ),
          ),
        ),
      );
    }

    final interactive = isFullyWatched;

    final Widget content;
    if (hasRating && isFullyWatched) {
      content = Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            l10n.cardYourRating.toUpperCase(),
            style: theme.textTheme.labelSmall?.copyWith(
              color: tc?.textMuted ??
                  theme.colorScheme.onSurface.withValues(alpha: 0.55),
              fontWeight: FontWeight.w700,
              letterSpacing: 0.8,
            ),
          ),
          const SizedBox(height: 6),
          Row(
            children: [
              Text(
                '★ ',
                style: TextStyle(
                  color: tc?.titleAccent ?? kLeadGold,
                  fontSize: 14,
                ),
              ),
              Text(
                formatWatchRating(watched!.rating!),
                style: theme.textTheme.titleMedium?.copyWith(
                  fontWeight: FontWeight.w700,
                  color: tc?.titleAccent ?? kLeadGold,
                ),
              ),
              Text(
                '/10',
                style: theme.textTheme.bodySmall?.copyWith(
                  color: tc?.textMuted,
                ),
              ),
              const Spacer(),
              TextButton(
                onPressed: onRate,
                style: TextButton.styleFrom(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                  minimumSize: const Size(0, 32),
                  tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                  visualDensity: VisualDensity.compact,
                ),
                child: Text(
                  l10n.mobileEditRating,
                  style: theme.textTheme.bodySmall,
                ),
              ),
            ],
          ),
          if (watched!.note != null && watched!.note!.isNotEmpty) ...[
            const SizedBox(height: 8),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.only(top: 8),
              decoration: BoxDecoration(
                border: Border(
                  top: BorderSide(
                    color: theme.colorScheme.outline.withValues(alpha: 0.25),
                  ),
                ),
              ),
              child: Text(
                watched!.note!,
                style: theme.textTheme.bodySmall?.copyWith(height: 1.48),
              ),
            ),
          ],
        ],
      );
    } else if (isFullyWatched) {
      content = Align(
        alignment: AlignmentDirectional.centerStart,
        child: FilledButton(
          onPressed: onRate,
          style: FilledButton.styleFrom(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
            minimumSize: const Size(0, 36),
            tapTargetSize: MaterialTapTargetSize.shrinkWrap,
            visualDensity: VisualDensity.compact,
          ),
          child: Text(l10n.cardRate),
        ),
      );
    } else {
      content = Text(
        l10n.mobileNotWatched,
        style: theme.textTheme.bodyMedium?.copyWith(
          color: theme.colorScheme.onSurface.withValues(alpha: 0.7),
        ),
      );
    }

    if (!interactive) {
      if (isFullyWatched && !hasRating) {
        return content;
      }
      return DecoratedBox(
        decoration: decoration,
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: content,
        ),
      );
    }

    return Semantics(
      button: true,
      label: hasRating ? l10n.mobileEditRating : l10n.mobileRateTitle,
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: onRate,
          borderRadius: BorderRadius.circular(8),
          child: Ink(
            decoration: decoration,
            child: Padding(
              padding: const EdgeInsets.all(12),
              child: content,
            ),
          ),
        ),
      ),
    );
  }
}

class _StatusPill extends StatelessWidget {
  const _StatusPill({
    required this.label,
    required this.fg,
    required this.bg,
    required this.border,
  });

  final String label;
  final Color fg;
  final Color bg;
  final Color border;

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: border),
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
        child: Text(
          label,
          style: TextStyle(
            color: fg,
            fontSize: 13,
            fontWeight: FontWeight.w600,
          ),
        ),
      ),
    );
  }
}

class _ExternalRatingsRow extends StatelessWidget {
  const _ExternalRatingsRow({required this.item});

  final WatchlistItem item;

  @override
  Widget build(BuildContext context) {
    final imdb = _formatImdb(item.imdbRating);
    final anilist = _formatAnilist(item.anilistRating);
    final imdbUrl = _imdbUrl(item.link);
    final anilistUrl = _anilistUrl(item.link);

    return Wrap(
      spacing: 8,
      runSpacing: 8,
      children: [
        if (imdb != null)
          GestureDetector(
            onTap: imdbUrl != null ? () => _openUrl(imdbUrl) : null,
            child: ContentScorePill(
              value: imdb,
              sourceLabel: 'IMDb',
              bg: const Color(0xFFF5C518),
              fg: Colors.black,
              detail: true,
            ),
          ),
        if (anilist != null)
          GestureDetector(
            onTap: anilistUrl != null ? () => _openUrl(anilistUrl) : null,
            child: ContentScorePill(
              value: anilist,
              sourceLabel: 'AniList',
              bg: const Color(0xFF02A9FF),
              fg: Colors.white,
              detail: true,
            ),
          ),
      ],
    );
  }
}

bool _hasExternalRatings(WatchlistItem item) {
  final imdb = item.imdbRating?.trim();
  final anilist = item.anilistRating?.trim();
  return (imdb != null && imdb.isNotEmpty) ||
      (anilist != null && anilist.isNotEmpty);
}

String? _formatImdb(String? raw) {
  final num = double.tryParse(raw?.replaceAll(',', '.') ?? '');
  if (num == null || !num.isFinite) return null;
  return num == num.roundToDouble()
      ? num.round().toString()
      : num.toStringAsFixed(1);
}

String? _formatAnilist(String? raw) {
  final num = double.tryParse(raw?.replaceAll(',', '.') ?? '');
  if (num == null || !num.isFinite) return null;
  final pct = num > 10 ? num.round() : (num * 10).round();
  return '$pct%';
}

Future<void> openItemLink(String? link) async {
  final raw = link?.trim();
  if (raw == null || raw.isEmpty) return;

  final uri = Uri.tryParse(raw.contains('://') ? raw : 'https://$raw');
  if (uri == null) return;

  await launchUrl(uri, mode: LaunchMode.externalApplication);
}

Future<void> _openUrl(String url) async {
  final uri = Uri.tryParse(url);
  if (uri == null) return;
  await launchUrl(uri, mode: LaunchMode.externalApplication);
}

/// Returns the IMDb URL from the item's link if it points to IMDb.
String? _imdbUrl(String? link) {
  final raw = link?.trim();
  if (raw == null || raw.isEmpty) return null;
  if (raw.contains('imdb.com')) return raw.contains('://') ? raw : 'https://$raw';
  final imdbId = MetadataService.extractImdbId(raw);
  if (imdbId != null) return 'https://www.imdb.com/title/$imdbId/';
  return null;
}

/// Returns the AniList URL from the item's link if it points to AniList.
String? _anilistUrl(String? link) {
  final raw = link?.trim();
  if (raw == null || raw.isEmpty) return null;
  if (raw.contains('anilist.co')) return raw.contains('://') ? raw : 'https://$raw';
  return null;
}
