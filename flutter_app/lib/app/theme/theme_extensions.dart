import 'package:flutter/material.dart';

/// Per-theme gradient background — mirrors the CSS body `background: radial-gradient(…)`.
@immutable
class AppThemeBackground extends ThemeExtension<AppThemeBackground> {
  const AppThemeBackground({required this.gradient});

  final Gradient gradient;

  @override
  AppThemeBackground copyWith({Gradient? gradient}) =>
      AppThemeBackground(gradient: gradient ?? this.gradient);

  @override
  AppThemeBackground lerp(AppThemeBackground? other, double t) {
    if (other == null) return this;
    final lerped = DecorationTween(
      begin: BoxDecoration(gradient: gradient),
      end: BoxDecoration(gradient: other.gradient),
    ).lerp(t);
    final lerpedGradient = (lerped as BoxDecoration?)?.gradient;
    return AppThemeBackground(gradient: lerpedGradient ?? gradient);
  }
}

/// Per-theme content-type accent colors — mirrors CSS `--movie`, `--tv`, `--anime`, `--franchise`.
@immutable
class AppTypeColors extends ThemeExtension<AppTypeColors> {
  const AppTypeColors({
    required this.movie,
    required this.movieDim,
    required this.tv,
    required this.tvDim,
    required this.anime,
    required this.animeDim,
    required this.franchise,
    required this.franchiseDim,
    required this.watched,
    this.inProgress = const Color(0xFFF59E0B),
    required this.textMuted,
    required this.titleAccent,
    required this.lead,
    required this.bgElevated,
    required this.tabActiveFg,
    this.tabBarBg,
    this.tabBarBgEnd,
    required this.menuPanelBg,
    this.menuPanelBgEnd,
    required this.menuItemHoverBg,
    required this.menuDangerColor,
    required this.menuDangerHoverColor,
    required this.menuLangActiveBg,
    required this.menuLangActiveFg,
    this.menuLangActiveBgEnd,
    required this.searchFieldBg,
    required this.filterFieldBg,
    required this.filterChipFg,
    required this.filterChipGradientStart,
    required this.filterChipGradientEnd,
    required this.filterChipBorder,
    required this.filterChipRemoveHoverBg,
    this.filterChipGradientMid,
    this.filterChipHorizontalGradient = false,
  });

  final Color movie;
  final Color movieDim;
  final Color tv;
  final Color tvDim;
  final Color anime;
  final Color animeDim;
  final Color franchise;
  final Color franchiseDim;
  final Color watched;

  /// Orange accent for in-progress state — matches CSS `.card--in-progress`.
  final Color inProgress;

  final Color textMuted;

  /// Matches CSS `--title-accent` — used for page/section headings.
  final Color titleAccent;

  /// Matches CSS `.card__lead` color per theme.
  final Color lead;

  /// Matches CSS `--bg-elevated` — panel bg, popup menu bg, toolbar bg.
  final Color bgElevated;

  /// Matches CSS `--tab-active-fg` — active tab underline and text color.
  final Color tabActiveFg;

  /// Optional `.type-tabs` background (solid or gradient top color).
  final Color? tabBarBg;

  /// Optional `.type-tabs` gradient bottom color.
  final Color? tabBarBgEnd;

  /// `.account-menu__panel` background (top / solid).
  final Color menuPanelBg;

  /// Optional bottom color for panel vertical gradient (brown, pink).
  final Color? menuPanelBgEnd;

  /// `.account-menu__item:hover` background.
  final Color menuItemHoverBg;

  /// `.account-menu__item--danger` color.
  final Color menuDangerColor;

  /// `.account-menu__item--danger:hover` color.
  final Color menuDangerHoverColor;

  /// `.account-menu__lang-btn--active` background.
  final Color menuLangActiveBg;

  /// `.account-menu__lang-btn--active` text color.
  final Color menuLangActiveFg;

  /// Optional bottom color for active lang-button gradient.
  final Color? menuLangActiveBgEnd;

  /// `.search__input` background — `var(--search-field-bg)`.
  final Color searchFieldBg;

  /// Filter dropdown / sort-direction button background — `var(--filter-field-bg)`.
  final Color filterFieldBg;

  /// `.genre-chip--filter` text color.
  final Color filterChipFg;

  /// `.genre-chip--filter` gradient start.
  final Color filterChipGradientStart;

  /// `.genre-chip--filter` gradient end.
  final Color filterChipGradientEnd;

  /// `.genre-chip--filter` border color.
  final Color filterChipBorder;

  /// `.genre-chip--filter .genre-chip__remove:hover` background.
  final Color filterChipRemoveHoverBg;

  /// Optional middle stop for pink theme horizontal chip gradient.
  final Color? filterChipGradientMid;

  /// When true, chip gradient runs left-to-right (pink theme).
  final bool filterChipHorizontalGradient;

  @override
  AppTypeColors copyWith({
    Color? movie,
    Color? movieDim,
    Color? tv,
    Color? tvDim,
    Color? anime,
    Color? animeDim,
    Color? franchise,
    Color? franchiseDim,
    Color? watched,
    Color? inProgress,
    Color? textMuted,
    Color? titleAccent,
    Color? lead,
    Color? bgElevated,
    Color? tabActiveFg,
    Color? tabBarBg,
    Color? tabBarBgEnd,
    Color? menuPanelBg,
    Color? menuPanelBgEnd,
    Color? menuItemHoverBg,
    Color? menuDangerColor,
    Color? menuDangerHoverColor,
    Color? menuLangActiveBg,
    Color? menuLangActiveFg,
    Color? menuLangActiveBgEnd,
    Color? searchFieldBg,
    Color? filterFieldBg,
    Color? filterChipFg,
    Color? filterChipGradientStart,
    Color? filterChipGradientEnd,
    Color? filterChipBorder,
    Color? filterChipRemoveHoverBg,
    Color? filterChipGradientMid,
    bool? filterChipHorizontalGradient,
  }) =>
      AppTypeColors(
        movie: movie ?? this.movie,
        movieDim: movieDim ?? this.movieDim,
        tv: tv ?? this.tv,
        tvDim: tvDim ?? this.tvDim,
        anime: anime ?? this.anime,
        animeDim: animeDim ?? this.animeDim,
        franchise: franchise ?? this.franchise,
        franchiseDim: franchiseDim ?? this.franchiseDim,
        watched: watched ?? this.watched,
        inProgress: inProgress ?? this.inProgress,
        textMuted: textMuted ?? this.textMuted,
        titleAccent: titleAccent ?? this.titleAccent,
        lead: lead ?? this.lead,
        bgElevated: bgElevated ?? this.bgElevated,
        tabActiveFg: tabActiveFg ?? this.tabActiveFg,
        tabBarBg: tabBarBg ?? this.tabBarBg,
        tabBarBgEnd: tabBarBgEnd ?? this.tabBarBgEnd,
        menuPanelBg: menuPanelBg ?? this.menuPanelBg,
        menuPanelBgEnd: menuPanelBgEnd ?? this.menuPanelBgEnd,
        menuItemHoverBg: menuItemHoverBg ?? this.menuItemHoverBg,
        menuDangerColor: menuDangerColor ?? this.menuDangerColor,
        menuDangerHoverColor: menuDangerHoverColor ?? this.menuDangerHoverColor,
        menuLangActiveBg: menuLangActiveBg ?? this.menuLangActiveBg,
        menuLangActiveFg: menuLangActiveFg ?? this.menuLangActiveFg,
        menuLangActiveBgEnd: menuLangActiveBgEnd ?? this.menuLangActiveBgEnd,
        searchFieldBg: searchFieldBg ?? this.searchFieldBg,
        filterFieldBg: filterFieldBg ?? this.filterFieldBg,
        filterChipFg: filterChipFg ?? this.filterChipFg,
        filterChipGradientStart:
            filterChipGradientStart ?? this.filterChipGradientStart,
        filterChipGradientEnd:
            filterChipGradientEnd ?? this.filterChipGradientEnd,
        filterChipBorder: filterChipBorder ?? this.filterChipBorder,
        filterChipRemoveHoverBg:
            filterChipRemoveHoverBg ?? this.filterChipRemoveHoverBg,
        filterChipGradientMid:
            filterChipGradientMid ?? this.filterChipGradientMid,
        filterChipHorizontalGradient: filterChipHorizontalGradient ??
            this.filterChipHorizontalGradient,
      );

  @override
  AppTypeColors lerp(AppTypeColors? other, double t) {
    if (other == null) return this;
    return AppTypeColors(
      movie: Color.lerp(movie, other.movie, t)!,
      movieDim: Color.lerp(movieDim, other.movieDim, t)!,
      tv: Color.lerp(tv, other.tv, t)!,
      tvDim: Color.lerp(tvDim, other.tvDim, t)!,
      anime: Color.lerp(anime, other.anime, t)!,
      animeDim: Color.lerp(animeDim, other.animeDim, t)!,
      franchise: Color.lerp(franchise, other.franchise, t)!,
      franchiseDim: Color.lerp(franchiseDim, other.franchiseDim, t)!,
      watched: Color.lerp(watched, other.watched, t)!,
      inProgress: Color.lerp(inProgress, other.inProgress, t)!,
      textMuted: Color.lerp(textMuted, other.textMuted, t)!,
      titleAccent: Color.lerp(titleAccent, other.titleAccent, t)!,
      lead: Color.lerp(lead, other.lead, t)!,
      bgElevated: Color.lerp(bgElevated, other.bgElevated, t)!,
      tabActiveFg: Color.lerp(tabActiveFg, other.tabActiveFg, t)!,
      tabBarBg: Color.lerp(tabBarBg, other.tabBarBg, t),
      tabBarBgEnd: Color.lerp(tabBarBgEnd, other.tabBarBgEnd, t),
      menuPanelBg: Color.lerp(menuPanelBg, other.menuPanelBg, t)!,
      menuPanelBgEnd: menuPanelBgEnd != null && other.menuPanelBgEnd != null
          ? Color.lerp(menuPanelBgEnd, other.menuPanelBgEnd, t)
          : menuPanelBgEnd ?? other.menuPanelBgEnd,
      menuItemHoverBg: Color.lerp(menuItemHoverBg, other.menuItemHoverBg, t)!,
      menuDangerColor: Color.lerp(menuDangerColor, other.menuDangerColor, t)!,
      menuDangerHoverColor:
          Color.lerp(menuDangerHoverColor, other.menuDangerHoverColor, t)!,
      menuLangActiveBg:
          Color.lerp(menuLangActiveBg, other.menuLangActiveBg, t)!,
      menuLangActiveFg:
          Color.lerp(menuLangActiveFg, other.menuLangActiveFg, t)!,
      menuLangActiveBgEnd:
          menuLangActiveBgEnd != null && other.menuLangActiveBgEnd != null
              ? Color.lerp(menuLangActiveBgEnd, other.menuLangActiveBgEnd, t)
              : menuLangActiveBgEnd ?? other.menuLangActiveBgEnd,
      searchFieldBg: Color.lerp(searchFieldBg, other.searchFieldBg, t)!,
      filterFieldBg: Color.lerp(filterFieldBg, other.filterFieldBg, t)!,
      filterChipFg: Color.lerp(filterChipFg, other.filterChipFg, t)!,
      filterChipGradientStart:
          Color.lerp(filterChipGradientStart, other.filterChipGradientStart, t)!,
      filterChipGradientEnd:
          Color.lerp(filterChipGradientEnd, other.filterChipGradientEnd, t)!,
      filterChipBorder: Color.lerp(filterChipBorder, other.filterChipBorder, t)!,
      filterChipRemoveHoverBg: Color.lerp(
          filterChipRemoveHoverBg, other.filterChipRemoveHoverBg, t)!,
      filterChipGradientMid:
          filterChipGradientMid != null && other.filterChipGradientMid != null
              ? Color.lerp(filterChipGradientMid, other.filterChipGradientMid, t)
              : filterChipGradientMid ?? other.filterChipGradientMid,
      filterChipHorizontalGradient: t < 0.5
          ? filterChipHorizontalGradient
          : other.filterChipHorizontalGradient,
    );
  }
}
