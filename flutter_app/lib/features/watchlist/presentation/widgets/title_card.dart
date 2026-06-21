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

                      // Top overlay: DETAILS + GENRES sections
                      Positioned(
                        top: 0,
                        left: 0,
                        right: 0,
                        child: DecoratedBox(
                          decoration: BoxDecoration(
                            gradient: LinearGradient(
                              begin: Alignment.topCenter,
                              end: Alignment.bottomCenter,
                              colors: [
                                Colors.black.withValues(alpha: 0.88),
                                Colors.black.withValues(alpha: 0.72),
                                Colors.black.withValues(alpha: 0),
                              ],
                              stops: const [0.0, 0.72, 1.0],
                            ),
                          ),
                          child: Padding(
                            padding: const EdgeInsets.fromLTRB(5, 4.5, 5, 7),
                            child: _CardSections(
                              item: item,
                              l10n: l10n,
                              tc: tc,
                              yearLabel: yearLabel,
                              onOverlay: true,
                            ),
                          ),
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

                // ── External ratings (IMDb / AniList) ────────────────
                Padding(
                  padding: const EdgeInsets.fromLTRB(5, 4, 5, 0),
                  child: ContentCardRatingBadges.fromItem(item),
                ),

                // ── Footer: border-top + watch status + menu ─────────
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
                          child: _MobileFooterStatus(
                            l10n: l10n,
                            isWatched: isWatched,
                            watched: watched,
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
                    const SizedBox(height: 6),

                    // ── DETAILS + GENRES sections ──────────────────────
                    _CardSections(
                      item: item,
                      l10n: widget.l10n,
                      tc: tc,
                      yearLabel: yearLabel,
                      onOverlay: false,
                    ),

                    // ── Lead ───────────────────────────────────────────
                    if (item.lead.isNotEmpty) ...[
                      const SizedBox(height: 6),
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

                    // ── Summary (desktop only — hidden on mobile web) ──
                    if (item.summary.isNotEmpty && isDesktop) ...[
                      const SizedBox(height: 5),
                      Expanded(
                        child: Text(
                          item.summary,
                          maxLines: 3,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(
                            fontSize: 13.5,
                            color: tc?.textMuted ??
                                theme.colorScheme.onSurface
                                    .withValues(alpha: 0.6),
                            height: 1.45,
                          ),
                        ),
                      ),
                    ] else
                      const Spacer(),

                    // ── External ratings ───────────────────────────────
                    ContentCardRatingBadges.fromItem(
                      item,
                      compact: !isDesktop,
                    ),
                    const SizedBox(height: 6),

                    // ── Footer: watch status + menu ────────────────────
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.center,
                      children: [
                        Expanded(
                          child: isDesktop
                              ? _WatchStatusRow(
                                  l10n: widget.l10n,
                                  isWatched: isWatched,
                                  watched: widget.watched,
                                  tc: tc,
                                )
                              : _MobileFooterStatus(
                                  l10n: widget.l10n,
                                  isWatched: isWatched,
                                  watched: widget.watched,
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
// DETAILS / GENRES sections — mirrors web `.card__sections` + section labels
// ══════════════════════════════════════════════════════════════════════════════

class _CardSections extends StatelessWidget {
  const _CardSections({
    required this.item,
    required this.l10n,
    required this.tc,
    required this.yearLabel,
    required this.onOverlay,
  });

  final WatchlistItem item;
  final L10n l10n;
  final AppTypeColors? tc;
  final String? yearLabel;
  final bool onOverlay;

  @override
  Widget build(BuildContext context) {
    final genreBadges = <Widget>[
      if (item.genre.isNotEmpty)
        _SolidGenreBadge(
          label: l10n.genreLabel(item.genre),
          primary: true,
        ),
      ...item.secondaryGenres.map(
        (g) => _SolidGenreBadge(
          label: l10n.genreLabel(g),
          primary: false,
        ),
      ),
    ];

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _CardSectionBlock(
          label: l10n.cardSectionDetails,
          onOverlay: onOverlay,
          child: Wrap(
            spacing: 3,
            runSpacing: 3,
            children: [
              _MobileTypeBadge(contentType: item.contentType, tc: tc),
              if (yearLabel != null) _SolidYearBadge(label: yearLabel!),
              ContentTitleMetaBadges(
                contentType: item.contentType,
                ageRating: item.ageRating,
                runtime: item.runtime,
                seasonCount: item.seasonCount,
                episodeCount: item.episodeCount,
                solid: true,
                spacing: 3,
                runSpacing: 3,
                fontSize: 7.5,
                padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 2),
              ),
            ],
          ),
        ),
        if (genreBadges.isNotEmpty) ...[
          const SizedBox(height: 4),
          _CardSectionBlock(
            label: l10n.cardSectionGenres,
            onOverlay: onOverlay,
            showTopDivider: true,
            child: Wrap(
              spacing: 3,
              runSpacing: 3,
              children: genreBadges,
            ),
          ),
        ],
      ],
    );
  }
}

class _CardSectionBlock extends StatelessWidget {
  const _CardSectionBlock({
    required this.label,
    required this.onOverlay,
    required this.child,
    this.showTopDivider = false,
  });

  final String label;
  final bool onOverlay;
  final Widget child;
  final bool showTopDivider;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final labelColor = onOverlay
        ? Colors.white.withValues(alpha: 0.58)
        : (theme.extension<AppTypeColors>()?.textMuted ??
            theme.colorScheme.onSurface.withValues(alpha: 0.55));
    final dividerColor = onOverlay
        ? Colors.white.withValues(alpha: 0.2)
        : theme.dividerColor;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (showTopDivider)
          Padding(
            padding: const EdgeInsets.only(bottom: 4),
            child: DecoratedBox(
              decoration: BoxDecoration(
                border: Border(
                  top: BorderSide(color: dividerColor),
                ),
              ),
              child: const SizedBox(height: 3),
            ),
          ),
        Text(
          label.toUpperCase(),
          style: TextStyle(
            color: labelColor,
            fontSize: onOverlay ? 6.5 : 8,
            fontWeight: FontWeight.w600,
            letterSpacing: 1.6,
            height: 1.15,
            shadows: onOverlay
                ? const [Shadow(color: Colors.black87, blurRadius: 3, offset: Offset(0, 1))]
                : null,
          ),
        ),
        const SizedBox(height: 3),
        DecoratedBox(
          decoration: BoxDecoration(
            border: Border(
              bottom: BorderSide(color: dividerColor),
            ),
          ),
          child: Padding(
            padding: const EdgeInsets.only(bottom: 3),
            child: child,
          ),
        ),
      ],
    );
  }
}

class _SolidYearBadge extends StatelessWidget {
  const _SolidYearBadge({required this.label});
  final String label;

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: BoxDecoration(
        color: const Color(0xEB060608),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: Colors.white.withValues(alpha: 0.42)),
        boxShadow: const [
          BoxShadow(color: Colors.black54, blurRadius: 5, offset: Offset(0, 1)),
        ],
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 2.5),
        child: Text(
          label,
          style: const TextStyle(
            color: Colors.white,
            fontSize: 7.5,
            fontWeight: FontWeight.w700,
            letterSpacing: 0.2,
          ),
        ),
      ),
    );
  }
}

class _SolidGenreBadge extends StatelessWidget {
  const _SolidGenreBadge({required this.label, required this.primary});
  final String label;
  final bool primary;

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: BoxDecoration(
        color: const Color(0xF50E0E12),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: Colors.white.withValues(alpha: 0.3)),
        boxShadow: const [
          BoxShadow(color: Colors.black38, blurRadius: 3, offset: Offset(0, 1)),
        ],
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 2),
        child: Text(
          label,
          style: TextStyle(
            color: const Color(0xFFF3F4F6).withValues(alpha: primary ? 1 : 0.82),
            fontSize: 7.5,
            fontWeight: primary ? FontWeight.w600 : FontWeight.w500,
            letterSpacing: 0.3,
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
      'tvSeries' => ('TV SERIES', tc?.tv ?? const Color(0xFFA855F7)),
      'anime' => ('ANIME', tc?.anime ?? const Color(0xFFED4956)),
      'franchise' => ('FRANCHISE', tc?.franchise ?? const Color(0xFF58C322)),
      _ => ('MOVIE', tc?.movie ?? const Color(0xFF0095F6)),
    };
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
// Mobile footer — unwatched pill or personal rating block (no external scores)
// ══════════════════════════════════════════════════════════════════════════════

class _MobileFooterStatus extends StatelessWidget {
  const _MobileFooterStatus({
    required this.l10n,
    required this.isWatched,
    required this.watched,
    required this.tc,
  });

  final L10n l10n;
  final bool isWatched;
  final WatchEntry? watched;
  final AppTypeColors? tc;

  @override
  Widget build(BuildContext context) {
    final watchedColor = tc?.watched ?? const Color(0xFF58C322);
    final onSurface = Theme.of(context).colorScheme.onSurface;

    if (!isWatched) {
      return _StatusPill(
        label: l10n.cardUnwatched,
        isWatched: false,
        watchedColor: watchedColor,
        onSurface: onSurface,
      );
    }

    if (!hasWatchRating(watched)) {
      return _StatusPill(
        label: l10n.cardWatched,
        isWatched: true,
        watchedColor: watchedColor,
        onSurface: onSurface,
      );
    }

    final note = watched?.note?.trim();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(
          l10n.cardYourRating.toUpperCase(),
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: TextStyle(
            color: onSurface.withValues(alpha: 0.55),
            fontSize: 7.5,
            fontWeight: FontWeight.w700,
            letterSpacing: 0.4,
          ),
        ),
        const SizedBox(height: 2),
        Text(
          '${formatWatchRating(watched!.rating!)}/10',
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: TextStyle(
            color: watchedColor,
            fontSize: 10,
            fontWeight: FontWeight.w700,
          ),
        ),
        if (note != null && note.isNotEmpty) ...[
          const SizedBox(height: 1),
          Text(
            note,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(
              color: onSurface.withValues(alpha: 0.55),
              fontSize: 7,
            ),
          ),
        ],
      ],
    );
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// Watch status row — desktop footer (watch pill only; scores live in body)
// ══════════════════════════════════════════════════════════════════════════════

class _WatchStatusRow extends StatelessWidget {
  const _WatchStatusRow({
    required this.l10n,
    required this.isWatched,
    required this.watched,
    required this.tc,
  });

  final L10n l10n;
  final bool isWatched;
  final WatchEntry? watched;
  final AppTypeColors? tc;

  @override
  Widget build(BuildContext context) {
    final watchedColor = tc?.watched ?? const Color(0xFF58C322);
    final onSurface = Theme.of(context).colorScheme.onSurface;
    final personalRating = watched?.rating;

    return _StatusPill(
      label: isWatched
          ? (hasWatchRating(watched)
              ? '${l10n.cardWatched} · ${formatWatchRating(personalRating!)}'
              : l10n.cardWatched)
          : l10n.cardUnwatched,
      isWatched: isWatched,
      watchedColor: watchedColor,
      onSurface: onSurface,
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
