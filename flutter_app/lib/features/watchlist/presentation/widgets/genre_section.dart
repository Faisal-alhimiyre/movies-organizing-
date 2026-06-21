import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../app/theme/theme_extensions.dart';
import '../../../../l10n/l10n.dart';
import '../../../../models/watchlist_item.dart';
import '../../application/card_layout_controller.dart';
import 'title_card.dart';

class GenreSection extends ConsumerWidget {
  const GenreSection({
    super.key,
    required this.group,
    required this.watched,
    required this.l10n,
    required this.onItemTap,
    this.onItemAction,
  });

  final GenreGroup group;
  final Map<String, WatchEntry> watched;
  final L10n l10n;
  final ValueChanged<WatchlistItem> onItemTap;
  final void Function(WatchlistItem item, TitleCardAction action)? onItemAction;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final layout = ref.watch(cardLayoutProvider);
    final theme = Theme.of(context);
    final tc = Theme.of(context).extension<AppTypeColors>();

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (!group.isFlatSorted && group.genre.isNotEmpty)
          _GenreSectionHeader(
            group: group,
            l10n: l10n,
            theme: theme,
            tc: tc,
          ),
        if (!group.isFlatSorted && group.genre.isNotEmpty)
          const SizedBox(height: 6),
        LayoutBuilder(
          builder: (context, constraints) {
            // CSS media queries compare against the VIEWPORT width, not the
            // content width. Use MediaQuery for breakpoint decisions but
            // constraints.maxWidth for computing the actual card pixel size.
            final contentWidth = constraints.maxWidth;
            final vp = MediaQuery.sizeOf(context).width;
            final isPoster = layout == CardLayoutId.poster;

            // Column counts + gaps match website CSS breakpoints exactly.
            // Poster: mobile.css → 3 cols ≤640px, 2 cols ≤420px.
            // Hover:  styles.css → 2 cols ≤640px, 1 col ≤420px.
            final int cols;
            final double gap;
            if (isPoster) {
              if (vp <= 420) {
                cols = 2;
                gap = 5.6;
              } else if (vp <= 640) {
                cols = 3;
                gap = 6.4;
              } else if (vp <= 900) {
                cols = 4;
                gap = 10;
              } else {
                cols = (contentWidth / 220).floor().clamp(4, 7);
                gap = 18.4;
              }
            } else {
              if (vp <= 420) {
                cols = 1;
                gap = 6.4;
              } else if (vp <= 640) {
                cols = 2;
                gap = 7.2;
              } else {
                cols = (contentWidth / 280).floor().clamp(2, 5);
                gap = 17.6;
              }
            }

            // For poster cards, compute exact cell height so there is no
            // empty space: posterHeight (2:3 ratio) + a fixed footer height.
            // footerH must accommodate the popup-menu touch target (≈28px
            // with materialTapTargetSize.shrinkWrap) + 10px padding.
            // For hover cards use childAspectRatio since content is variable.
            final SliverGridDelegate gridDelegate;
            if (isPoster) {
              final cardWidth = (contentWidth - gap * (cols - 1)) / cols;
              const footerH = 40.0; // 10px padding + 28px menu + 2px slack
              gridDelegate = SliverGridDelegateWithFixedCrossAxisCount(
                crossAxisCount: cols,
                crossAxisSpacing: gap,
                mainAxisSpacing: gap,
                mainAxisExtent: cardWidth * 1.5 + footerH,
              );
            } else {
              gridDelegate = SliverGridDelegateWithFixedCrossAxisCount(
                crossAxisCount: cols,
                crossAxisSpacing: gap,
                mainAxisSpacing: gap,
                childAspectRatio: cols == 1 ? 3.0 : 1.35,
              );
            }

            return GridView.builder(
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              gridDelegate: gridDelegate,
              itemCount: group.items.length,
              itemBuilder: (context, index) {
                final item = group.items[index];
                return TitleCard(
                  item: item,
                  watched: watched[item.id],
                  l10n: l10n,
                  layout: layout,
                  onTap: () => onItemTap(item),
                  onAction: onItemAction == null
                      ? null
                      : (action) => onItemAction!(item, action),
                );
              },
            );
          },
        ),
        const SizedBox(height: 28),
      ],
    );
  }
}

/// Genre section header — mirrors `.genre-section__bar` from the website CSS.
///
/// Mobile CSS (≤640px):
///   padding: 0.32rem 0.5rem  (5.1px 8px)
///   border-radius: 8px
///   background: var(--bg-elevated)  → theme.colorScheme.surface
///   border: 1px solid var(--border)
///   .genre-section__title { font-size: 0.88rem (14px) }
///   .genre-section__count { font-size: 0.56rem; padding: 0.12rem 0.38rem }
class _GenreSectionHeader extends StatelessWidget {
  const _GenreSectionHeader({
    required this.group,
    required this.l10n,
    required this.theme,
    required this.tc,
  });

  final GenreGroup group;
  final L10n l10n;
  final ThemeData theme;
  final AppTypeColors? tc;

  @override
  Widget build(BuildContext context) {
    final surface = theme.colorScheme.surface;
    final border = theme.dividerColor;
    final onSurface = theme.colorScheme.onSurface;

    return DecoratedBox(
      decoration: BoxDecoration(
        color: surface,
        border: Border.all(color: border),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Padding(
        // 0.32rem 0.5rem at 16px base → 5.1px 8px → use 5 / 8
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 5),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.center,
          children: [
            // Type badge (genre-section__type)
            if (group.contentType != null) ...[
              _TypePill(contentType: group.contentType!, tc: tc),
              const SizedBox(width: 6),
            ],
            // Genre name (genre-section__title — 14px sans, weight 700)
            Expanded(
              child: Text(
                l10n.genreLabel(group.genre),
                // Use theme.textTheme so dark theme gets DM Sans, others
                // get Playfair Display (set via displaySans flag in app_themes).
                style: theme.textTheme.titleMedium?.copyWith(
                  fontSize: 14,
                  fontWeight: FontWeight.w700,
                  color: onSurface,
                  letterSpacing: -0.2,
                  height: 1.2,
                ),
                overflow: TextOverflow.ellipsis,
              ),
            ),
            const SizedBox(width: 6),
            // Count pill (genre-section__count — 0.56rem ≈ 9px)
            _CountPill(count: group.items.length, theme: theme),
          ],
        ),
      ),
    );
  }
}

class _TypePill extends StatelessWidget {
  const _TypePill({required this.contentType, required this.tc});

  final String contentType;
  final AppTypeColors? tc;

  @override
  Widget build(BuildContext context) {
    final (fg, bg) = switch (contentType) {
      'movie' => (
          tc?.movie ?? const Color(0xFF5B9FD4),
          tc?.movieDim ?? const Color(0x265B9FD4),
        ),
      'tvSeries' || 'series' => (
          tc?.tv ?? const Color(0xFF9B7EDE),
          tc?.tvDim ?? const Color(0x269B7EDE),
        ),
      'anime' => (
          tc?.anime ?? const Color(0xFFE86B8A),
          tc?.animeDim ?? const Color(0x26E86B8A),
        ),
      'franchise' => (
          tc?.franchise ?? const Color(0xFF6BC9A8),
          tc?.franchiseDim ?? const Color(0x266BC9A8),
        ),
      _ => (
          tc?.movie ?? const Color(0xFF5B9FD4),
          tc?.movieDim ?? const Color(0x265B9FD4),
        ),
    };

    // genre-section__type: font-size 0.62rem, padding 0.22rem 0.55rem,
    // border-radius 999px
    return DecoratedBox(
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(999),
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
        child: Text(
          contentType == 'tvSeries' || contentType == 'series'
              ? 'TV'
              : contentType.toUpperCase(),
          style: TextStyle(
            color: fg,
            fontSize: 9,
            fontWeight: FontWeight.w700,
            letterSpacing: 0.7,
          ),
        ),
      ),
    );
  }
}

class _CountPill extends StatelessWidget {
  const _CountPill({required this.count, required this.theme});

  final int count;
  final ThemeData theme;

  @override
  Widget build(BuildContext context) {
    final onSurface = theme.colorScheme.onSurface;
    // genre-section__count: font-size 0.56rem ≈ 9px, padding 0.12rem 0.38rem
    return DecoratedBox(
      decoration: BoxDecoration(
        color: onSurface.withValues(alpha: 0.07),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: onSurface.withValues(alpha: 0.1)),
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
        child: Text(
          '$count',
          style: TextStyle(
            fontSize: 9,
            fontWeight: FontWeight.w600,
            color: onSurface.withValues(alpha: 0.7),
            fontFeatures: const [FontFeature.tabularFigures()],
          ),
        ),
      ),
    );
  }
}
