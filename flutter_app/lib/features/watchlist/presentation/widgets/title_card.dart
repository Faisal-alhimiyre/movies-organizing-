import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../app/theme/theme_extensions.dart';
import '../../../../core/utils/rating_utils.dart';
import '../../../../core/widgets/content_badges.dart';
import '../../../../core/widgets/responsive_layout.dart';
import '../../../../l10n/l10n.dart';
import '../../../../models/watchlist_item.dart';
import '../../application/card_layout_controller.dart';
import '../../application/link_preview_controller.dart';
import '../../application/link_preview_meta.dart';
import 'card_poster.dart';

enum TitleCardAction { rate, toggleWatched, moveToList, delete }

class TitleCard extends StatelessWidget {
  const TitleCard({
    super.key,
    required this.item,
    required this.watched,
    required this.l10n,
    required this.layout,
    this.onTap,
    this.onAction,
  });

  final WatchlistItem item;
  final WatchEntry? watched;
  final L10n l10n;
  final CardLayoutId layout;
  final VoidCallback? onTap;
  final void Function(TitleCardAction action)? onAction;

  @override
  Widget build(BuildContext context) {
    if (layout == CardLayoutId.poster) {
      return _PosterTitleCard(
        item: item,
        watched: watched,
        l10n: l10n,
        onTap: onTap,
        onAction: onAction,
      );
    }

    return _HoverTitleCard(
      item: item,
      watched: watched,
      l10n: l10n,
      onTap: onTap,
      onAction: onAction,
    );
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// Poster card — image fills card; badges + title rendered ON the poster.
// Matches website mobile `.card[data-layout="poster"]` with `.card__overlay`.
// ══════════════════════════════════════════════════════════════════════════════

class _PosterTitleCard extends StatelessWidget {
  const _PosterTitleCard({
    required this.item,
    required this.watched,
    required this.l10n,
    this.onTap,
    this.onAction,
  });

  final WatchlistItem item;
  final WatchEntry? watched;
  final L10n l10n;
  final VoidCallback? onTap;
  final void Function(TitleCardAction action)? onAction;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final tc = theme.extension<AppTypeColors>();
    final isWatched = watched != null;
    final yearLabel = _formatReleaseYear(item.year);
    final cardBg = theme.colorScheme.surface; // #121212

    return Opacity(
      opacity: isWatched ? 0.82 : 1.0,
      child: Material(
        color: cardBg,
        borderRadius: BorderRadius.circular(8),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: onTap,
          child: DecoratedBox(
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(8),
              border:
                  Border.all(color: theme.dividerColor.withValues(alpha: 1)),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                // ── Poster + overlay ────────────────────────────────────
                AspectRatio(
                  aspectRatio: 2 / 3,
                  child: Stack(
                    fit: StackFit.expand,
                    children: [
                      // Poster image
                      CardPoster(item: item),

                      // Bottom gradient (title background)
                      Positioned(
                        left: 0,
                        right: 0,
                        bottom: 0,
                        height: 90,
                        child: DecoratedBox(
                          decoration: BoxDecoration(
                            gradient: LinearGradient(
                              begin: Alignment.topCenter,
                              end: Alignment.bottomCenter,
                              colors: [
                                Colors.transparent,
                                Colors.black.withValues(alpha: 0.92),
                              ],
                              stops: const [0.0, 1.0],
                            ),
                          ),
                        ),
                      ),

                      // Top-left: type + year + primary genre
                      Positioned(
                        top: 5,
                        left: 5,
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Row(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                _MobileTypeBadge(
                                  contentType: item.contentType,
                                  tc: tc,
                                ),
                                if (yearLabel != null) ...[
                                  const SizedBox(width: 3),
                                  _OverlayYearBadge(label: yearLabel),
                                ],
                              ],
                            ),
                            if (item.genre.isNotEmpty) ...[
                              const SizedBox(height: 3),
                              _OverlayGenreBadge(
                                  label: l10n.genreLabel(item.genre)),
                            ],
                          ],
                        ),
                      ),

                      // Top-right: watched ✓ only (menu moves to footer)
                      if (isWatched)
                        const Positioned(
                          top: 5,
                          right: 5,
                          child: _WatchedCheck(),
                        ),

                      // Bottom-left: title
                      Positioned(
                        left: 5,
                        right: 5,
                        bottom: 5,
                        child: Text(
                          item.title,
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(
                            color: Colors.white,
                            fontSize: 11,
                            fontWeight: FontWeight.w600,
                            height: 1.2,
                            decoration:
                                isWatched ? TextDecoration.lineThrough : null,
                            decorationColor:
                                Colors.white.withValues(alpha: 0.55),
                          ),
                        ),
                      ),
                    ],
                  ),
                ),

                // ── Meta badges (age, seasons, episode length) ───────
                Padding(
                  padding: const EdgeInsets.fromLTRB(5, 4, 5, 0),
                  child: ContentTitleMetaBadges.fromItem(item),
                ),

                // ── Footer: border-top + watch status chips + menu ─────
                DecoratedBox(
                  decoration: BoxDecoration(
                    border: Border(
                      top: BorderSide(
                        color: theme.dividerColor,
                        width: 1,
                      ),
                    ),
                  ),
                  child: Padding(
                    padding: const EdgeInsets.fromLTRB(5, 5, 0, 5),
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.center,
                      children: [
                        Flexible(
                          child: _WatchStatusRow(
                            l10n: l10n,
                            isWatched: isWatched,
                            watched: watched,
                            // Website hides .card__rating from the poster
                            // footer on mobile — only watch-status pill shows.
                            imdbRating: null,
                            anilistRating: null,
                            tc: tc,
                          ),
                        ),
                        _CardMenuButton(
                          l10n: l10n,
                          isWatched: isWatched,
                          compact: true,
                          onAction: onAction,
                        ),
                      ],
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// Hover card — text layout, two badge rows, compact mobile sizing.
// Matches website mobile `.card[data-layout="hover"]`.
// ══════════════════════════════════════════════════════════════════════════════

class _HoverTitleCard extends ConsumerStatefulWidget {
  const _HoverTitleCard({
    required this.item,
    required this.watched,
    required this.l10n,
    this.onTap,
    this.onAction,
  });

  final WatchlistItem item;
  final WatchEntry? watched;
  final L10n l10n;
  final VoidCallback? onTap;
  final void Function(TitleCardAction action)? onAction;

  @override
  ConsumerState<_HoverTitleCard> createState() => _HoverTitleCardState();
}

class _HoverTitleCardState extends ConsumerState<_HoverTitleCard> {
  final _cardKey = GlobalKey();

  bool get _linkPreviewEnabled =>
      AppBreakpoints.isDesktop(context) && itemHasLinkPreview(widget.item);

  Rect? _cardRect() {
    final box = _cardKey.currentContext?.findRenderObject() as RenderBox?;
    if (box == null || !box.hasSize) return null;
    final topLeft = box.localToGlobal(Offset.zero);
    return topLeft & box.size;
  }

  void _onHoverEnter() {
    if (!_linkPreviewEnabled) return;
    final rect = _cardRect();
    if (rect == null) return;
    ref
        .read(linkPreviewControllerProvider.notifier)
        .scheduleShow(widget.item, rect);
  }

  void _onHoverExit() {
    if (!_linkPreviewEnabled) return;
    ref.read(linkPreviewControllerProvider.notifier).scheduleHide();
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final tc = theme.extension<AppTypeColors>();
    final item = widget.item;
    final isWatched = widget.watched != null;
    final isDesktop = AppBreakpoints.isDesktop(context);
    final yearLabel = _formatReleaseYear(item.year);

    // Mobile: 8×7px padding; desktop: 14×14px
    final pad = isDesktop
        ? const EdgeInsets.fromLTRB(14, 14, 14, 10)
        : const EdgeInsets.fromLTRB(8, 8, 8, 7);

    return Opacity(
      opacity: isWatched ? 0.82 : 1.0,
      child: Material(
        key: _cardKey,
        color: theme.colorScheme.surface,
        borderRadius: BorderRadius.circular(8),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: widget.onTap,
          child: MouseRegion(
            onEnter: _linkPreviewEnabled ? (_) => _onHoverEnter() : null,
            onExit: _linkPreviewEnabled ? (_) => _onHoverExit() : null,
            child: DecoratedBox(
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(8),
                border:
                    Border.all(color: theme.dividerColor.withValues(alpha: 1)),
              ),
              child: Padding(
                padding: pad,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    // ── Row 1: type + year ─────────────────────────────
                    Wrap(
                      spacing: 4,
                      runSpacing: 4,
                      children: [
                        _MobileTypeBadge(contentType: item.contentType, tc: tc),
                        if (yearLabel != null)
                          _CompactYearBadge(label: yearLabel),
                      ],
                    ),
                    const SizedBox(height: 4),

                    // ── Row 2: genres ──────────────────────────────────
                    Wrap(
                      spacing: 4,
                      runSpacing: 4,
                      children: [
                        if (item.genre.isNotEmpty)
                          _CompactGenreBadge(
                              label: widget.l10n.genreLabel(item.genre),
                              primary: true),
                        ...item.secondaryGenres.map(
                          (g) => _CompactGenreBadge(
                              label: widget.l10n.genreLabel(g),
                              primary: false),
                        ),
                      ],
                    ),
                    const SizedBox(height: 8),

                    // ── Title ──────────────────────────────────────────
                    Text(
                      item.title,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        fontSize: isDesktop ? 15 : 13,
                        fontWeight: FontWeight.w600,
                        height: 1.25,
                        color: isWatched
                            ? (tc?.textMuted ??
                                theme.colorScheme.onSurface
                                    .withValues(alpha: 0.55))
                            : theme.colorScheme.onSurface,
                        decoration:
                            isWatched ? TextDecoration.lineThrough : null,
                        decorationColor:
                            theme.colorScheme.onSurface.withValues(alpha: 0.45),
                      ),
                    ),

                    // ── Lead ───────────────────────────────────────────
                    if (item.lead.isNotEmpty) ...[
                      const SizedBox(height: 4),
                      Text(
                        item.lead,
                        maxLines: isDesktop ? 1 : 2,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          color: tc?.lead ?? theme.colorScheme.primary,
                          fontWeight: FontWeight.w500,
                          fontSize: isDesktop ? 12.8 : 10,
                        ),
                      ),
                    ],

                    const SizedBox(height: 4),
                    ContentTitleMetaBadges.fromItem(item),

                    // ── Summary ────────────────────────────────────────
                    if (item.summary.isNotEmpty) ...[
                      const SizedBox(height: 5),
                      Expanded(
                        child: Text(
                          item.summary,
                          maxLines: isDesktop ? 3 : 2,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(
                            fontSize: isDesktop ? 13.5 : 10,
                            color: tc?.textMuted ??
                                theme.colorScheme.onSurface
                                    .withValues(alpha: 0.6),
                            height: isDesktop ? 1.45 : 1.32,
                          ),
                        ),
                      ),
                    ] else
                      const Spacer(),

                    const SizedBox(height: 6),

                    // ── Footer: watch status + scores + menu ───────────
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.center,
                      children: [
                        Expanded(
                          child: _WatchStatusRow(
                            l10n: widget.l10n,
                            isWatched: isWatched,
                            watched: widget.watched,
                            imdbRating: item.imdbRating,
                            anilistRating: item.anilistRating,
                            tc: tc,
                          ),
                        ),
                        _CardMenuButton(
                          l10n: widget.l10n,
                          isWatched: isWatched,
                          onAction: widget.onAction,
                          compact: true,
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// Mobile-style solid type badge — white text on solid type-color bg
// `.app[data-layout="hover"] .card__head .badge--movie` on mobile
// ══════════════════════════════════════════════════════════════════════════════

class _MobileTypeBadge extends StatelessWidget {
  const _MobileTypeBadge({required this.contentType, required this.tc});

  final String contentType;
  final AppTypeColors? tc;

  @override
  Widget build(BuildContext context) {
    final (label, bg) = _resolve(contentType, tc);
    return DecoratedBox(
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: Colors.white.withValues(alpha: 0.38)),
        boxShadow: const [
          BoxShadow(color: Colors.black38, blurRadius: 4, offset: Offset(0, 1))
        ],
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2.5),
        child: Text(
          label,
          style: const TextStyle(
            color: Colors.white,
            fontSize: 8,
            fontWeight: FontWeight.w700,
            letterSpacing: 0.5,
          ),
        ),
      ),
    );
  }

  static (String, Color) _resolve(String contentType, AppTypeColors? tc) {
    return switch (contentType) {
      'tvSeries' => ('TV', tc?.tv ?? const Color(0xFFA855F7)),
      'anime' => ('ANIME', tc?.anime ?? const Color(0xFFED4956)),
      'franchise' => ('FRANCHISE', tc?.franchise ?? const Color(0xFF58C322)),
      _ => ('MOVIE', tc?.movie ?? const Color(0xFF0095F6)),
    };
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// Compact badges for hover card (both rows)
// ══════════════════════════════════════════════════════════════════════════════

class _CompactYearBadge extends StatelessWidget {
  const _CompactYearBadge({required this.label});
  final String label;

  @override
  Widget build(BuildContext context) {
    final onSurface = Theme.of(context).colorScheme.onSurface;
    return DecoratedBox(
      decoration: BoxDecoration(
        color: Colors.black.withValues(alpha: 0.45),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: onSurface.withValues(alpha: 0.28)),
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 2),
        child: Text(
          label,
          style: const TextStyle(
            color: Color(0xFFF3F4F6),
            fontSize: 8,
            fontWeight: FontWeight.w700,
            letterSpacing: 0.2,
          ),
        ),
      ),
    );
  }
}

class _CompactGenreBadge extends StatelessWidget {
  const _CompactGenreBadge({required this.label, required this.primary});
  final String label;
  final bool primary;

  @override
  Widget build(BuildContext context) {
    final onSurface = Theme.of(context).colorScheme.onSurface;
    return DecoratedBox(
      decoration: BoxDecoration(
        color: onSurface.withValues(alpha: primary ? 0.08 : 0.04),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(
          color: onSurface.withValues(alpha: primary ? 0.3 : 0.15),
        ),
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 2),
        child: Text(
          label,
          style: TextStyle(
            color: onSurface.withValues(alpha: primary ? 0.9 : 0.6),
            fontSize: 8,
            fontWeight: primary ? FontWeight.w600 : FontWeight.w500,
            letterSpacing: 0.3,
          ),
        ),
      ),
    );
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// Overlay badges (shown on top of poster image)
// ══════════════════════════════════════════════════════════════════════════════

/// Dark translucent genre badge on poster overlay
class _OverlayGenreBadge extends StatelessWidget {
  const _OverlayGenreBadge({required this.label});
  final String label;

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: BoxDecoration(
        color: Colors.black.withValues(alpha: 0.55),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: Colors.white.withValues(alpha: 0.22)),
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 2),
        child: Text(
          label,
          style: const TextStyle(
            color: Color(0xFFF3F4F6),
            fontSize: 7.5,
            fontWeight: FontWeight.w600,
            letterSpacing: 0.3,
          ),
        ),
      ),
    );
  }
}

/// Year badge on poster overlay (inline with type badge)
class _OverlayYearBadge extends StatelessWidget {
  const _OverlayYearBadge({required this.label});
  final String label;

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: BoxDecoration(
        color: Colors.black.withValues(alpha: 0.65),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: Colors.white.withValues(alpha: 0.28)),
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 2.5),
        child: Text(
          label,
          style: const TextStyle(
            color: Color(0xFFF3F4F6),
            fontSize: 7.5,
            fontWeight: FontWeight.w700,
            letterSpacing: 0.2,
          ),
        ),
      ),
    );
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// Watched checkmark — ✓ circle top-right on poster
// ══════════════════════════════════════════════════════════════════════════════

class _WatchedCheck extends StatelessWidget {
  const _WatchedCheck();

  @override
  Widget build(BuildContext context) {
    final watched = Theme.of(context).extension<AppTypeColors>()?.watched ??
        const Color(0xFF58C322);
    return DecoratedBox(
      decoration: BoxDecoration(
        color: Colors.black.withValues(alpha: 0.65),
        shape: BoxShape.circle,
        border: Border.all(color: watched.withValues(alpha: 0.45)),
      ),
      child: SizedBox(
        width: 18,
        height: 18,
        child: Icon(Icons.check, size: 11, color: watched),
      ),
    );
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// Watch status row — pill chips matching `.card__watch-status`
// ══════════════════════════════════════════════════════════════════════════════

class _WatchStatusRow extends StatelessWidget {
  const _WatchStatusRow({
    required this.l10n,
    required this.isWatched,
    required this.watched,
    required this.tc,
    this.imdbRating,
    this.anilistRating,
  });

  final L10n l10n;
  final bool isWatched;
  final WatchEntry? watched;
  final AppTypeColors? tc;
  final String? imdbRating;
  final String? anilistRating;

  @override
  Widget build(BuildContext context) {
    final watchedColor = tc?.watched ?? const Color(0xFF58C322);
    final onSurface = Theme.of(context).colorScheme.onSurface;
    final personalRating = watched?.rating;

    return Wrap(
      spacing: 4,
      runSpacing: 4,
      children: [
        _StatusPill(
          label: isWatched
              ? (hasWatchRating(watched)
                  ? '${l10n.cardWatched} · ${formatWatchRating(personalRating!)}'
                  : l10n.cardWatched)
              : l10n.cardUnwatched,
          isWatched: isWatched,
          watchedColor: watchedColor,
          onSurface: onSurface,
        ),
        if (imdbRating != null && imdbRating!.isNotEmpty)
          ContentScorePill(
            value: imdbRating!,
            sourceLabel: 'IMDb',
            bg: const Color(0xFFF5C518),
            fg: Colors.black,
          ),
        if (anilistRating != null && anilistRating!.isNotEmpty)
          ContentScorePill(
            value: anilistRating!,
            sourceLabel: 'AL',
            bg: const Color(0xFF02A9FF),
            fg: Colors.white,
          ),
      ],
    );
  }
}

/// Pill-shaped watch status chip — matches `.card__watch-status`
class _StatusPill extends StatelessWidget {
  const _StatusPill({
    required this.label,
    required this.isWatched,
    required this.watchedColor,
    required this.onSurface,
  });

  final String label;
  final bool isWatched;
  final Color watchedColor;
  final Color onSurface;

  @override
  Widget build(BuildContext context) {
    final fg = isWatched ? watchedColor : onSurface.withValues(alpha: 0.6);
    final bg = isWatched
        ? watchedColor.withValues(alpha: 0.08)
        : Colors.white.withValues(alpha: 0.04);
    final border = isWatched
        ? watchedColor.withValues(alpha: 0.28)
        : onSurface.withValues(alpha: 0.15);

    return DecoratedBox(
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: border),
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2.5),
        child: Text(
          label,
          style: TextStyle(
            color: fg,
            fontSize: 7.5,
            fontWeight: FontWeight.w600,
          ),
        ),
      ),
    );
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// Card action menu (⋮)
// ══════════════════════════════════════════════════════════════════════════════

class _CardMenuButton extends StatelessWidget {
  const _CardMenuButton({
    required this.l10n,
    required this.isWatched,
    this.onAction,
    this.compact = false,
  });

  final L10n l10n;
  final bool isWatched;
  final void Function(TitleCardAction action)? onAction;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    if (onAction == null) return const SizedBox.shrink();

    final theme = Theme.of(context);
    final iconColor = compact
        ? theme.colorScheme.onSurface.withValues(alpha: 0.6)
        : Colors.white;

    final button = PopupMenuButton<TitleCardAction>(
      padding: const EdgeInsets.all(4),
      icon: Icon(Icons.more_vert, color: iconColor, size: compact ? 18 : 22),
      onSelected: onAction,
      itemBuilder: (context) => [
        PopupMenuItem(
          value: TitleCardAction.rate,
          child: Text(l10n.cardRate),
        ),
        PopupMenuItem(
          value: TitleCardAction.toggleWatched,
          child: Text(
            isWatched ? l10n.cardMarkUnwatched : l10n.cardMarkWatched,
          ),
        ),
        PopupMenuItem(
          value: TitleCardAction.moveToList,
          child: Text(l10n.cardMoveToList),
        ),
        PopupMenuItem(
          value: TitleCardAction.delete,
          child: Text(
            l10n.btnDelete,
            style: TextStyle(color: theme.colorScheme.error),
          ),
        ),
      ],
    );

    if (compact) {
      // With useMaterial3:true, IconButton minimum size is controlled by
      // iconButtonTheme.style.minimumSize (48px), NOT materialTapTargetSize.
      // Override iconButtonTheme so the button fits in the ~30px footer.
      return Theme(
        data: Theme.of(context).copyWith(
          iconButtonTheme: IconButtonThemeData(
            style: IconButton.styleFrom(
              minimumSize: const Size(28, 28),
              padding: const EdgeInsets.all(4),
              tapTargetSize: MaterialTapTargetSize.shrinkWrap,
            ),
          ),
        ),
        child: button,
      );
    }

    return Material(
      color: Colors.black.withValues(alpha: 0.45),
      shape: const CircleBorder(),
      clipBehavior: Clip.antiAlias,
      child: button,
    );
  }
}

String? _formatReleaseYear(int? year) {
  if (year == null) return null;
  return year.toString();
}
