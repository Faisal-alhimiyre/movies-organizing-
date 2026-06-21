import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../app/theme/theme_controller.dart';
import '../../../../app/theme/theme_extensions.dart';
import '../../../../core/widgets/responsive_layout.dart';
import '../../../../l10n/l10n.dart';
import '../../../../models/watchlist_item.dart';

/// Flat tab bar with bottom-border indicator — mirrors `.type-tabs` / `.type-tab`.
///
/// Website structure per tab (horizontal flex row):
///   [icon?] [label?] [count]
///
/// Mobile ≤640px (`mobile.css`): equal-width tabs, icon-only for Movies/TV/Anime.
class TypeTabBar extends ConsumerWidget {
  const TypeTabBar({
    super.key,
    required this.selected,
    required this.counts,
    required this.onChanged,
    required this.l10n,
  });

  final WatchlistTypeFilter selected;
  final Map<WatchlistTypeFilter, int> counts;
  final ValueChanged<WatchlistTypeFilter> onChanged;
  final L10n l10n;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final tc = theme.extension<AppTypeColors>();
    final themeId = ref.watch(themeIdProvider);
    final width = MediaQuery.sizeOf(context).width;
    final isMobile = width < AppBreakpoints.mobile;
    final isNarrow = width <= 420;

    final activeFg = tc?.tabActiveFg ?? theme.colorScheme.onSurface;
    final inactiveFg = themeId == AppThemeId.pink
        ? Colors.white.withValues(alpha: 0.75)
        : (tc?.textMuted ??
            theme.colorScheme.onSurface.withValues(alpha: 0.45));
    final onSurface = theme.colorScheme.onSurface;
    final countInactive = onSurface.withValues(alpha: 0.75);
    final countActive = tc?.textMuted ?? inactiveFg;

    final containerPadding =
        isMobile ? const EdgeInsets.all(5.6) : EdgeInsets.zero; // 0.35rem
    final containerGap = isMobile ? 4.0 : 0.0; // 0.25rem mobile.css

    return DecoratedBox(
      decoration: _tabBarDecoration(theme, tc),
      child: Padding(
        padding: containerPadding,
        child: Row(
          spacing: containerGap,
          children: [
            _Tab(
              label: l10n.typeAll,
              count: counts[WatchlistTypeFilter.all] ?? 0,
              isSelected: selected == WatchlistTypeFilter.all,
              icon: null,
              activeFg: activeFg,
              inactiveFg: inactiveFg,
              countInactive: countInactive,
              countActive: countActive,
              isMobile: isMobile,
              isNarrow: isNarrow,
              useUppercase: !l10n.isArabic,
              onTap: () => onChanged(WatchlistTypeFilter.all),
            ),
            _Tab(
              label: l10n.typeMovies,
              count: counts[WatchlistTypeFilter.movies] ?? 0,
              isSelected: selected == WatchlistTypeFilter.movies,
              icon: '🎬',
              activeFg: activeFg,
              inactiveFg: inactiveFg,
              countInactive: countInactive,
              countActive: countActive,
              isMobile: isMobile,
              isNarrow: isNarrow,
              useUppercase: !l10n.isArabic,
              onTap: () => onChanged(WatchlistTypeFilter.movies),
            ),
            _Tab(
              label: l10n.typeTv,
              count: counts[WatchlistTypeFilter.tvSeries] ?? 0,
              isSelected: selected == WatchlistTypeFilter.tvSeries,
              icon: '📺',
              activeFg: activeFg,
              inactiveFg: inactiveFg,
              countInactive: countInactive,
              countActive: countActive,
              isMobile: isMobile,
              isNarrow: isNarrow,
              useUppercase: !l10n.isArabic,
              onTap: () => onChanged(WatchlistTypeFilter.tvSeries),
            ),
            _Tab(
              label: l10n.typeAnime,
              count: counts[WatchlistTypeFilter.anime] ?? 0,
              isSelected: selected == WatchlistTypeFilter.anime,
              icon: '🎌',
              activeFg: activeFg,
              inactiveFg: inactiveFg,
              countInactive: countInactive,
              countActive: countActive,
              isMobile: isMobile,
              isNarrow: isNarrow,
              useUppercase: !l10n.isArabic,
              onTap: () => onChanged(WatchlistTypeFilter.anime),
            ),
          ],
        ),
      ),
    );
  }

  BoxDecoration _tabBarDecoration(ThemeData theme, AppTypeColors? tc) {
    final border = theme.dividerColor;
    final bg = tc?.tabBarBg;
    final bgEnd = tc?.tabBarBgEnd;

    return BoxDecoration(
      color: bg != null && bgEnd == null ? bg : null,
      gradient: bg != null && bgEnd != null
          ? LinearGradient(
              begin: Alignment.topCenter,
              end: Alignment.bottomCenter,
              colors: [bg, bgEnd],
            )
          : null,
      border: Border(bottom: BorderSide(color: border, width: 1)),
    );
  }
}

class _Tab extends StatelessWidget {
  const _Tab({
    required this.label,
    required this.count,
    required this.isSelected,
    required this.icon,
    required this.activeFg,
    required this.inactiveFg,
    required this.countInactive,
    required this.countActive,
    required this.isMobile,
    required this.isNarrow,
    required this.useUppercase,
    required this.onTap,
  });

  final String label;
  final int count;
  final bool isSelected;
  final String? icon;
  final Color activeFg;
  final Color inactiveFg;
  final Color countInactive;
  final Color countActive;
  final bool isMobile;
  final bool isNarrow;
  final bool useUppercase;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final fg = isSelected ? activeFg : inactiveFg;
    final displayLabel = useUppercase ? label.toUpperCase() : label;

    // mobile.css ≤640px: hide label when tab has an icon.
    final showLabel = icon == null || !isMobile;

    // theme.css desktop / mobile.css mobile sizing.
    final hPad = isNarrow ? 6.72 : (isMobile ? 4.0 : 8.8); // rem → px
    final vPad = isNarrow ? 4.8 : (isMobile ? 5.6 : 8.8);
    final minHeight = isNarrow ? 30.0 : (isMobile ? 37.6 : 0.0);
    final fontSize = isNarrow ? 11.2 : (isMobile ? 11.52 : 12.8);
    final iconSize = isMobile ? 15.2 : 16.0;
    final itemGap = isNarrow ? 3.2 : (isMobile ? 2.88 : 5.6);
    final fontWeight = isMobile ? FontWeight.w500 : FontWeight.w600;
    final letterSpacing = isMobile ? 0.0 : 0.38; // 0.03em @ 12.8px

    return Expanded(
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: onTap,
          child: Ink(
            decoration: BoxDecoration(
              border: Border(
                bottom: BorderSide(
                  color: isSelected ? activeFg : Colors.transparent,
                  width: 2,
                ),
              ),
            ),
            child: ConstrainedBox(
              constraints: BoxConstraints(
                minHeight: minHeight > 0 ? minHeight : 0,
              ),
              child: Padding(
                padding: EdgeInsets.symmetric(
                  horizontal: hPad,
                  vertical: vPad,
                ),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    if (icon != null) ...[
                      Text(icon!, style: TextStyle(fontSize: iconSize)),
                      SizedBox(width: itemGap),
                    ],
                    if (showLabel) ...[
                      Flexible(
                        child: Text(
                          displayLabel,
                          style: TextStyle(
                            fontSize: fontSize,
                            fontWeight: fontWeight,
                            color: fg,
                            letterSpacing: letterSpacing,
                            height: 1.2,
                          ),
                          overflow: TextOverflow.ellipsis,
                          maxLines: 1,
                          textAlign: TextAlign.center,
                        ),
                      ),
                      SizedBox(width: itemGap),
                    ],
                    Directionality(
                      textDirection: TextDirection.ltr,
                      child: Text(
                        '$count',
                        style: TextStyle(
                          fontSize: fontSize,
                          fontWeight: FontWeight.w600,
                          color: isSelected ? countActive : countInactive,
                          fontFeatures: const [FontFeature.tabularFigures()],
                          height: 1.2,
                        ),
                      ),
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
