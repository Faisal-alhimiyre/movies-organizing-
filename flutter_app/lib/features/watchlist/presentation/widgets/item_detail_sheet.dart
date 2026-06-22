import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../../../core/utils/rating_utils.dart';
import '../../../../core/widgets/content_badges.dart';
import '../../../../l10n/l10n.dart';
import '../../../../models/metadata_detail.dart';
import '../../../../models/watchlist_item.dart';
import '../../../../repositories/metadata/metadata_service.dart';
import '../../application/title_meta_backfill.dart';
import '../../application/watchlist_controller.dart';
import 'card_poster.dart';

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
  });

  final L10n l10n;
  final WatchlistItem item;
  final WatchEntry? watched;
  final bool canMoveToList;

  @override
  ConsumerState<ItemDetailSheet> createState() => _ItemDetailSheetState();
}

class _ItemDetailSheetState extends ConsumerState<ItemDetailSheet> {
  WatchlistItem? _item;

  WatchlistItem get item => _item ?? widget.item;

  bool get _isWatched => widget.watched != null;
  bool get _hasLink {
    final link = item.link?.trim();
    return link != null && link.isNotEmpty;
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

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final maxHeight = MediaQuery.sizeOf(context).height * 0.88;

    return SafeArea(
      child: Center(
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Material(
            color: theme.colorScheme.surfaceContainerHigh,
            elevation: 12,
            shadowColor: Colors.black.withValues(alpha: 0.5),
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(14),
              side: BorderSide(
                color: theme.colorScheme.outline.withValues(alpha: 0.25),
              ),
            ),
            clipBehavior: Clip.antiAlias,
            child: ConstrainedBox(
              constraints: BoxConstraints(
                maxWidth: 328,
                maxHeight: maxHeight,
              ),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Flexible(
                    child: Stack(
                      children: [
                        SingleChildScrollView(
                          padding: const EdgeInsets.fromLTRB(16, 16, 16, 12),
                          child: _DetailContent(
                            l10n: widget.l10n,
                            item: item,
                            watched: widget.watched,
                            onRate: () =>
                                _close(context, ItemDetailAction.rate),
                          ),
                        ),
                        Positioned(
                          top: 8,
                          right: 8,
                          child: _CloseButton(
                            label: widget.l10n.mobileClose,
                            onPressed: () => _close(context),
                          ),
                        ),
                      ],
                    ),
                  ),
                  const Divider(height: 1),
                  Padding(
                    padding: const EdgeInsets.fromLTRB(12, 10, 12, 12),
                    child: _ActionList(
                      l10n: widget.l10n,
                      showOpenLink: _hasLink,
                      isWatched: _isWatched,
                      canMoveToList: widget.canMoveToList,
                      onOpenLink: () =>
                          _close(context, ItemDetailAction.openLink),
                      onToggleWatched: () =>
                          _close(context, ItemDetailAction.toggleWatched),
                      onEdit: () => _close(context, ItemDetailAction.edit),
                      onMove: () =>
                          _close(context, ItemDetailAction.moveToList),
                      onDelete: () => _close(context, ItemDetailAction.delete),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _CloseButton extends StatelessWidget {
  const _CloseButton({required this.label, required this.onPressed});

  final String label;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      label: label,
      child: Material(
        color: Colors.black.withValues(alpha: 0.55),
        shape: const CircleBorder(
          side: BorderSide(color: Color(0x29FFFFFF)),
        ),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: onPressed,
          child: const SizedBox(
            width: 28,
            height: 28,
            child: Icon(Icons.close, size: 18, color: Colors.white),
          ),
        ),
      ),
    );
  }
}

class _DetailContent extends StatelessWidget {
  const _DetailContent({
    required this.l10n,
    required this.item,
    required this.watched,
    required this.onRate,
  });

  final L10n l10n;
  final WatchlistItem item;
  final WatchEntry? watched;
  final VoidCallback onRate;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            ClipRRect(
              borderRadius: BorderRadius.circular(8),
              child: SizedBox(
                width: 72,
                height: 108,
                child: CardPoster(item: item),
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    item.title,
                    style: theme.textTheme.titleMedium?.copyWith(
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  if (item.lead.isNotEmpty) ...[
                    const SizedBox(height: 4),
                    Text(
                      item.lead,
                      style: theme.textTheme.bodySmall?.copyWith(
                        color: kLeadGold,
                        fontWeight: FontWeight.w500,
                      ),
                    ),
                  ],
                  const SizedBox(height: 6),
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
                  if (item.genre.isNotEmpty ||
                      item.secondaryGenres.isNotEmpty) ...[
                    const SizedBox(height: 8),
                    Text(
                      l10n.cardSectionGenres.toUpperCase(),
                      style: theme.textTheme.labelSmall?.copyWith(
                        color: theme.colorScheme.onSurface
                            .withValues(alpha: 0.55),
                        fontWeight: FontWeight.w600,
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
                ],
              ),
            ),
          ],
        ),
        if (item.summary.isNotEmpty) ...[
          const SizedBox(height: 14),
          Text(item.summary, style: theme.textTheme.bodyMedium),
        ],
        if (_hasExternalRatings(item)) ...[
          const SizedBox(height: 12),
          _ExternalRatingsRow(item: item),
        ],
        const SizedBox(height: 12),
        _RatingBlock(
          l10n: l10n,
          watched: watched,
          onRate: onRate,
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
  });

  final L10n l10n;
  final WatchEntry? watched;
  final VoidCallback onRate;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final isWatched = watched != null;
    final hasRating = hasWatchRating(watched);
    final interactive = isWatched;

    final Widget content;
    if (hasRating) {
      content = Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Text(
                l10n.cardYourRating,
                style: theme.textTheme.labelLarge,
              ),
              const Spacer(),
              Text(
                '${formatWatchRating(watched!.rating!)}/10',
                style: theme.textTheme.titleSmall?.copyWith(
                  fontWeight: FontWeight.w700,
                ),
              ),
            ],
          ),
          if (watched!.note != null && watched!.note!.isNotEmpty) ...[
            const SizedBox(height: 6),
            Text(watched!.note!, style: theme.textTheme.bodySmall),
          ],
        ],
      );
    } else if (isWatched) {
      content = Text(
        l10n.mobileWatchedUnrated,
        style: theme.textTheme.bodyMedium,
      );
    } else {
      content = Text(
        l10n.mobileNotWatched,
        style: theme.textTheme.bodyMedium?.copyWith(
          color: theme.colorScheme.onSurface.withValues(alpha: 0.7),
        ),
      );
    }

    final decoration = BoxDecoration(
      color: theme.colorScheme.surfaceContainerHighest.withValues(alpha: 0.5),
      borderRadius: BorderRadius.circular(10),
      border: Border.all(
        color: theme.colorScheme.outline.withValues(alpha: 0.2),
      ),
    );

    if (!interactive) {
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
          borderRadius: BorderRadius.circular(10),
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

class _ExternalRatingsRow extends StatelessWidget {
  const _ExternalRatingsRow({required this.item});

  final WatchlistItem item;

  @override
  Widget build(BuildContext context) {
    final imdb = _formatImdb(item.imdbRating);
    final anilist = _formatAnilist(item.anilistRating);

    return Wrap(
      spacing: 8,
      runSpacing: 6,
      children: [
        if (imdb != null)
          ContentScorePill(
            value: imdb,
            sourceLabel: 'IMDb',
            bg: const Color(0xFFF5C518),
            fg: Colors.black,
          ),
        if (anilist != null)
          ContentScorePill(
            value: anilist,
            sourceLabel: 'AniList',
            bg: const Color(0xFF02A9FF),
            fg: Colors.white,
          ),
      ],
    );
  }
}

class _ActionList extends StatelessWidget {
  const _ActionList({
    required this.l10n,
    required this.showOpenLink,
    required this.isWatched,
    required this.canMoveToList,
    required this.onOpenLink,
    required this.onToggleWatched,
    required this.onEdit,
    required this.onMove,
    required this.onDelete,
  });

  final L10n l10n;
  final bool showOpenLink;
  final bool isWatched;
  final bool canMoveToList;
  final VoidCallback onOpenLink;
  final VoidCallback onToggleWatched;
  final VoidCallback onEdit;
  final VoidCallback onMove;
  final VoidCallback onDelete;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (showOpenLink)
          FilledButton(
            onPressed: onOpenLink,
            child: Text(l10n.cardOpenLink),
          ),
        if (showOpenLink) const SizedBox(height: 8),
        OutlinedButton(
          onPressed: onToggleWatched,
          child:
              Text(isWatched ? l10n.cardMarkUnwatched : l10n.cardMarkWatched),
        ),
        const SizedBox(height: 8),
        OutlinedButton(
          onPressed: onEdit,
          child: Text(l10n.cardEdit),
        ),
        if (canMoveToList) ...[
          const SizedBox(height: 8),
          OutlinedButton(
            onPressed: onMove,
            child: Text(l10n.cardMoveToList),
          ),
        ],
        const SizedBox(height: 8),
        TextButton(
          onPressed: onDelete,
          style: TextButton.styleFrom(
            foregroundColor: Theme.of(context).colorScheme.error,
          ),
          child: Text(l10n.btnDelete),
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
