import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../app/theme/theme_controller.dart';
import '../../../../app/theme/theme_extensions.dart';
import '../../../../core/widgets/responsive_layout.dart';
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
    final tc = theme.extension<AppTypeColors>()!;
    final themeId = ref.watch(themeIdProvider);
    final isMobile = AppBreakpoints.isMobile(context);
    final metrics = _GenreSectionMetrics(isMobile: isMobile);
    final showHeader = !group.isFlatSorted && group.genre.isNotEmpty;

    return Padding(
      padding: EdgeInsets.only(bottom: metrics.sectionBottom),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (showHeader) ...[
            Padding(
              padding: EdgeInsets.only(bottom: metrics.headerBottom),
              child: _GenreSectionHeader(
                group: group,
                l10n: l10n,
                theme: theme,
                tc: tc,
                themeId: themeId,
                metrics: metrics,
              ),
            ),
          ],
          LayoutBuilder(
            builder: (context, constraints) {
              final contentWidth = constraints.maxWidth;
              final vp = MediaQuery.sizeOf(context).width;
              final isPoster = layout == CardLayoutId.poster;

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

              final SliverGridDelegate gridDelegate;
              if (isPoster) {
                final cardWidth = (contentWidth - gap * (cols - 1)) / cols;
                const footerH = 58.0;
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
        ],
      ),
    );
  }
}

class _GenreSectionMetrics {
  const _GenreSectionMetrics({required this.isMobile});

  final bool isMobile;

  double get sectionBottom => isMobile ? 13.6 : 44.0; // 0.85rem / 2.75rem
  double get headerBottom => isMobile ? 5.6 : 17.6; // 0.35rem / 1.1rem
  double get barPaddingH => isMobile ? 8.0 : 16.0;
  double get barPaddingV => isMobile ? 5.12 : 11.2;
  double get titleSize => isMobile ? 14.08 : 19.2;
  double get countFontSize => isMobile ? 8.96 : 10.88;
  double get countPadH => isMobile ? 6.08 : 9.6;
  double get countPadV => isMobile ? 1.92 : 4.48;
  double get barRadius => isMobile ? 8.0 : 0.0;
}

class _GenreSectionHeader extends StatelessWidget {
  const _GenreSectionHeader({
    required this.group,
    required this.l10n,
    required this.theme,
    required this.tc,
    required this.themeId,
    required this.metrics,
  });

  final GenreGroup group;
  final L10n l10n;
  final ThemeData theme;
  final AppTypeColors tc;
  final AppThemeId themeId;
  final _GenreSectionMetrics metrics;

  @override
  Widget build(BuildContext context) {
    final barStyle = _genreBarStyle(
      themeId: themeId,
      tc: tc,
      theme: theme,
      isAllMatch: group.isAllMatch,
      radius: metrics.barRadius,
    );
    final hasBadges =
        group.contentType != null || group.isAllMatch;
    final titleStyle = theme.textTheme.titleMedium?.copyWith(
      fontSize: metrics.titleSize,
      fontWeight: FontWeight.w700,
      color: theme.colorScheme.onSurface,
      letterSpacing: -0.2,
      height: 1.2,
    );

    return DecoratedBox(
      decoration: barStyle,
      child: Padding(
        padding: EdgeInsets.symmetric(
          horizontal: metrics.barPaddingH,
          vertical: metrics.barPaddingV,
        ),
        child: metrics.isMobile && hasBadges
            ? Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.center,
                    children: [
                      Expanded(child: _BadgesRow(group: group, l10n: l10n, tc: tc)),
                      const SizedBox(width: 6),
                      _CountPill(
                        count: group.items.length,
                        l10n: l10n,
                        theme: theme,
                        tc: tc,
                        themeId: themeId,
                        metrics: metrics,
                      ),
                    ],
                  ),
                  const SizedBox(height: 4),
                  Text(
                    l10n.genreLabel(group.genre),
                    style: titleStyle,
                    overflow: TextOverflow.ellipsis,
                    maxLines: 3,
                  ),
                ],
              )
            : Row(
                crossAxisAlignment: CrossAxisAlignment.center,
                children: [
                  if (hasBadges) ...[
                    Flexible(
                      fit: FlexFit.loose,
                      child: _BadgesRow(group: group, l10n: l10n, tc: tc),
                    ),
                    const SizedBox(width: 8),
                  ],
                  Expanded(
                    child: Text(
                      l10n.genreLabel(group.genre),
                      style: titleStyle,
                      overflow: TextOverflow.ellipsis,
                      maxLines: metrics.isMobile ? 2 : 4,
                    ),
                  ),
                  const SizedBox(width: 6),
                  _CountPill(
                    count: group.items.length,
                    l10n: l10n,
                    theme: theme,
                    tc: tc,
                    themeId: themeId,
                    metrics: metrics,
                  ),
                ],
              ),
      ),
    );
  }
}

class _BadgesRow extends StatelessWidget {
  const _BadgesRow({
    required this.group,
    required this.l10n,
    required this.tc,
  });

  final GenreGroup group;
  final L10n l10n;
  final AppTypeColors tc;

  @override
  Widget build(BuildContext context) {
    return Wrap(
      spacing: 5.6,
      runSpacing: 5.6,
      crossAxisAlignment: WrapCrossAlignment.center,
      children: [
        if (group.contentType != null)
          _TypePill(
            contentType: group.contentType!,
            label: l10n.typeSectionShort(group.contentType),
            tc: tc,
            isMobile: AppBreakpoints.isMobile(context),
          ),
        if (group.isAllMatch) _AllMatchPill(l10n: l10n, theme: Theme.of(context)),
      ],
    );
  }
}

BoxDecoration _genreBarStyle({
  required AppThemeId themeId,
  required AppTypeColors tc,
  required ThemeData theme,
  required bool isAllMatch,
  required double radius,
}) {
  if (isAllMatch) {
    return switch (themeId) {
      AppThemeId.purple => BoxDecoration(
          gradient: const LinearGradient(
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
            colors: [Color(0x1AE8C078), Color(0x148C50DC)],
          ),
          border: Border.all(color: const Color(0x59E8C078)),
          borderRadius: BorderRadius.circular(radius),
        ),
      AppThemeId.pink => BoxDecoration(
          gradient: const LinearGradient(
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
            colors: [Color(0x33FFB4CD), Color(0x2EE64B7D)],
          ),
          border: Border.all(color: const Color(0x61FFC8DA)),
          borderRadius: BorderRadius.circular(radius),
        ),
      AppThemeId.brown => BoxDecoration(
          gradient: const LinearGradient(
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
            colors: [Color(0x1AFFF8F0), Color(0x24C9956A)],
          ),
          border: Border.all(color: const Color(0x5CE8C9A8)),
          borderRadius: BorderRadius.circular(radius),
        ),
      AppThemeId.light => BoxDecoration(
          color: const Color(0x0F8A6D42),
          border: Border.all(color: const Color(0x478A6D42)),
          borderRadius: BorderRadius.circular(radius),
        ),
      AppThemeId.dark => BoxDecoration(
          color: const Color(0x140095F6),
          border: Border.all(color: const Color(0xFF0095F6)),
          borderRadius: BorderRadius.circular(radius),
        ),
    };
  }

  return switch (themeId) {
    AppThemeId.purple => BoxDecoration(
        gradient: const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [Color(0x1A8C50DC), Color(0x801E0C32)],
        ),
        border: Border.all(color: const Color(0x29B48CFF)),
        borderRadius: BorderRadius.circular(radius),
        boxShadow: const [
          BoxShadow(
            color: Color(0x14B48CFF),
            offset: Offset(0, 1),
            blurRadius: 0,
            spreadRadius: 0,
          ),
        ],
      ),
    AppThemeId.pink => BoxDecoration(
        gradient: const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [Color(0x1FFF8CAF), Color(0xB8440A24), Color(0xB8440A24)],
          stops: [0.0, 0.55, 1.0],
        ),
        border: Border.all(color: const Color(0x33FF96B9)),
        borderRadius: BorderRadius.circular(radius),
        boxShadow: const [
          BoxShadow(
            color: Color(0x0FFFC8DA),
            offset: Offset(0, 1),
            blurRadius: 0,
            spreadRadius: 0,
          ),
        ],
      ),
    AppThemeId.brown => BoxDecoration(
        gradient: const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [Color(0x12FFF8F0), Color(0x1AC9956A), Color(0xB82A1A10)],
          stops: [0.0, 0.38, 1.0],
        ),
        border: Border.all(color: const Color(0x2EE8C9A8)),
        borderRadius: BorderRadius.circular(radius),
        boxShadow: const [
          BoxShadow(
            color: Color(0x0DFFF8F0),
            offset: Offset(0, 1),
            blurRadius: 0,
            spreadRadius: 0,
          ),
        ],
      ),
    AppThemeId.light => BoxDecoration(
        color: const Color(0xE6FFFFFF),
        border: Border.all(color: theme.dividerColor),
        borderRadius: BorderRadius.circular(radius),
        boxShadow: const [
          BoxShadow(
            color: Color(0x0A000000),
            offset: Offset(0, 1),
            blurRadius: 0,
            spreadRadius: 0,
          ),
        ],
      ),
    AppThemeId.dark => BoxDecoration(
        color: tc.bgElevated,
        border: Border.all(color: theme.dividerColor),
        borderRadius: BorderRadius.circular(radius),
      ),
  };
}

class _TypePill extends StatelessWidget {
  const _TypePill({
    required this.contentType,
    required this.label,
    required this.tc,
    required this.isMobile,
  });

  final String contentType;
  final String label;
  final AppTypeColors tc;
  final bool isMobile;

  @override
  Widget build(BuildContext context) {
    final (fg, bg) = switch (contentType) {
      'movies' => (tc.movie, tc.movieDim),
      'tvSeries' => (tc.tv, tc.tvDim),
      'anime' => (tc.anime, tc.animeDim),
      'franchise' => (tc.franchise, tc.franchiseDim),
      _ => (tc.movie, tc.movieDim),
    };

    return DecoratedBox(
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(999),
      ),
      child: Padding(
        padding: EdgeInsets.symmetric(
          horizontal: isMobile ? 6.08 : 8.8,
          vertical: isMobile ? 1.92 : 3.52,
        ),
        child: Text(
          label.toUpperCase(),
          style: TextStyle(
            color: fg,
            fontSize: isMobile ? 8.64 : 9.92,
            fontWeight: FontWeight.w700,
            letterSpacing: 0.7,
          ),
        ),
      ),
    );
  }
}

class _AllMatchPill extends StatelessWidget {
  const _AllMatchPill({required this.l10n, required this.theme});

  final L10n l10n;
  final ThemeData theme;

  @override
  Widget build(BuildContext context) {
    final accent = theme.colorScheme.secondary;
    return DecoratedBox(
      decoration: BoxDecoration(
        color: accent.withValues(alpha: 0.14),
        borderRadius: BorderRadius.circular(999),
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 8.8, vertical: 3.2),
        child: Text(
          l10n.genreAllSelected.toUpperCase(),
          style: TextStyle(
            color: accent,
            fontSize: 10.88,
            fontWeight: FontWeight.w600,
            letterSpacing: 0.6,
          ),
        ),
      ),
    );
  }
}

class _CountPill extends StatelessWidget {
  const _CountPill({
    required this.count,
    required this.l10n,
    required this.theme,
    required this.tc,
    required this.themeId,
    required this.metrics,
  });

  final int count;
  final L10n l10n;
  final ThemeData theme;
  final AppTypeColors tc;
  final AppThemeId themeId;
  final _GenreSectionMetrics metrics;

  @override
  Widget build(BuildContext context) {
    final (bg, border, fg) = switch (themeId) {
      AppThemeId.purple => (
          const Color(0x59000000),
          const Color(0x24B48CFF),
          const Color(0xFFC4B0D8),
        ),
      AppThemeId.pink => (
          const Color(0xB8440A24),
          const Color(0x38FF96B9),
          Colors.white,
        ),
      AppThemeId.brown => (
          const Color(0x610C0604),
          const Color(0x29E8C9A8),
          tc.textMuted,
        ),
      AppThemeId.light => (
          const Color(0x0D000000),
          theme.dividerColor,
          tc.textMuted,
        ),
      AppThemeId.dark => (
          const Color(0xFF262626),
          theme.dividerColor,
          tc.textMuted,
        ),
    };

    return DecoratedBox(
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: border),
      ),
      child: Padding(
        padding: EdgeInsets.symmetric(
          horizontal: metrics.countPadH,
          vertical: metrics.countPadV,
        ),
        child: Text(
          metrics.isMobile
              ? l10n.titleCount(count)
              : l10n.titleCount(count).toUpperCase(),
          style: TextStyle(
            fontSize: metrics.countFontSize,
            fontWeight: FontWeight.w600,
            color: fg,
            letterSpacing: metrics.isMobile ? 0.4 : 0.6,
          ),
        ),
      ),
    );
  }
}
