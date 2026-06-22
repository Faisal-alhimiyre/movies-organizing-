/// Shared styled badge/chip widgets used across title cards, detail sheets,
/// and genre section headers — mirrors the website's `.badge--*` classes.
library;

import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

import '../../app/theme/theme_extensions.dart';
import '../../core/utils/rating_utils.dart';
import '../../core/utils/title_meta_format.dart';
import '../../l10n/l10n.dart';
import '../../models/watchlist_item.dart';

// ── Shared gold accent for lead text ────────────────────────────────────────
const kLeadGold = Color(0xFFD9B96A);

// ══════════════════════════════════════════════════════════════════════════════
// TypeBadge — colored pill: MOVIE / TV SERIES / ANIME / FRANCHISE
// ══════════════════════════════════════════════════════════════════════════════

class ContentTypeBadge extends StatelessWidget {
  const ContentTypeBadge({super.key, required this.contentType});

  final String contentType;

  @override
  Widget build(BuildContext context) {
    final tc = Theme.of(context).extension<AppTypeColors>();
    final (fg, bg, label) = _resolve(contentType, tc);
    return _BadgePill(label: label, fg: fg, bg: bg);
  }

  static (Color, Color, String) _resolve(String type, AppTypeColors? tc) {
    switch (type) {
      case 'movie':
        return (
          tc?.movie ?? const Color(0xFF5B9FD4),
          tc?.movieDim ?? const Color(0x265B9FD4),
          'MOVIE',
        );
      case 'tvSeries':
      case 'series':
        return (
          tc?.tv ?? const Color(0xFF9B7EDE),
          tc?.tvDim ?? const Color(0x269B7EDE),
          'TV SERIES',
        );
      case 'anime':
        return (
          tc?.anime ?? const Color(0xFFE86B8A),
          tc?.animeDim ?? const Color(0x26E86B8A),
          'ANIME',
        );
      case 'franchise':
        return (
          tc?.franchise ?? const Color(0xFF6BC9A8),
          tc?.franchiseDim ?? const Color(0x266BC9A8),
          'FRANCHISE',
        );
      default:
        return (
          tc?.movie ?? const Color(0xFF5B9FD4),
          tc?.movieDim ?? const Color(0x265B9FD4),
          type.toUpperCase(),
        );
    }
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// GenreChip — outline-style genre label
// ══════════════════════════════════════════════════════════════════════════════

class ContentGenreChip extends StatelessWidget {
  const ContentGenreChip({
    super.key,
    required this.label,
    this.primary = true,
  });

  final String label;
  final bool primary;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final tc = Theme.of(context).extension<AppTypeColors>();
    final onSurface = theme.colorScheme.onSurface;
    final fg = primary
        ? onSurface
        : (tc?.textMuted ?? onSurface.withValues(alpha: 0.6));
    final border = primary
        ? onSurface.withValues(alpha: 0.22)
        : onSurface.withValues(alpha: 0.1);
    final bg = primary
        ? onSurface.withValues(alpha: 0.08)
        : onSurface.withValues(alpha: 0.04);

    return DecoratedBox(
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(4),
        border: Border.all(color: border, width: 1),
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 3),
        child: Text(
          label,
          style: TextStyle(
            color: fg,
            fontSize: 10,
            fontWeight: primary ? FontWeight.w600 : FontWeight.w500,
            letterSpacing: 0.04,
          ),
        ),
      ),
    );
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// YearBadge — dark pill with white border
// ══════════════════════════════════════════════════════════════════════════════

class ContentYearBadge extends StatelessWidget {
  const ContentYearBadge({super.key, required this.label});

  final String label;

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: BoxDecoration(
        color: Colors.black.withValues(alpha: 0.72),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(
          color: Colors.white.withValues(alpha: 0.28),
          width: 1,
        ),
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 3),
        child: Text(
          label,
          style: const TextStyle(
            color: Color(0xFFF3F4F6),
            fontSize: 10,
            fontWeight: FontWeight.w700,
            letterSpacing: 0.3,
          ),
        ),
      ),
    );
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// Title meta badges — age rating, movie duration, TV/anime seasons
// ══════════════════════════════════════════════════════════════════════════════

class ContentTitleMetaBadges extends StatelessWidget {
  const ContentTitleMetaBadges({
    super.key,
    required this.contentType,
    this.ageRating,
    this.runtime,
    this.seasonCount,
    this.episodeCount,
    this.spacing = 4,
    this.runSpacing = 4,
    this.solid = false,
    this.fontSize = 10,
    this.padding = const EdgeInsets.symmetric(horizontal: 7, vertical: 3),
  });

  final String contentType;
  final String? ageRating;
  final String? runtime;
  final int? seasonCount;
  final int? episodeCount;
  final double spacing;
  final double runSpacing;
  final bool solid;
  final double fontSize;
  final EdgeInsets padding;

  factory ContentTitleMetaBadges.fromItem(WatchlistItem item) {
    return ContentTitleMetaBadges(
      contentType: item.contentType,
      ageRating: item.ageRating,
      runtime: item.runtime,
      seasonCount: item.seasonCount,
      episodeCount: item.episodeCount,
    );
  }

  @override
  Widget build(BuildContext context) {
    final l10n = L10n(Localizations.localeOf(context).languageCode);
    final badges = titleMetaBadgesFromItem(
      contentType: contentType,
      ageRating: ageRating,
      runtime: runtime,
      seasonCount: seasonCount,
      episodeCount: episodeCount,
      formatAgeRating: l10n.ageRatingLabel,
    );
    if (badges.isEmpty) return const SizedBox.shrink();

    return Wrap(
      spacing: spacing,
      runSpacing: runSpacing,
      children: badges
          .map(
            (badge) => _TitleMetaBadge(
              badge: badge,
              solid: solid,
              fontSize: fontSize,
              padding: padding,
            ),
          )
          .toList(),
    );
  }
}

class _TitleMetaBadge extends StatelessWidget {
  const _TitleMetaBadge({
    required this.badge,
    required this.solid,
    required this.fontSize,
    required this.padding,
  });

  final TitleMetaBadge badge;
  final bool solid;
  final double fontSize;
  final EdgeInsets padding;

  @override
  Widget build(BuildContext context) {
    final (fg, bg, border) = switch (badge.kind) {
      TitleMetaBadgeKind.age => solid
          ? (
              const Color(0xFFFCD34D),
              const Color(0xF2181206),
              const Color(0x80FBBF24),
            )
          : (
              const Color(0xFFFBBF24),
              const Color(0x1FFBBF24),
              const Color(0x59FBBF24),
            ),
      TitleMetaBadgeKind.duration => solid
          ? (
              const Color(0xFF93C5FD),
              const Color(0xF2080E1A),
              const Color(0x7393C5FD),
            )
          : (
              const Color(0xFF93C5FD),
              const Color(0x1A93C5FD),
              const Color(0x4D93C5FD),
            ),
      TitleMetaBadgeKind.seasons => solid
          ? (
              const Color(0xFFA5B4FC),
              const Color(0xF20C0C1E),
              const Color(0x73A5B4FC),
            )
          : (
              const Color(0xFFA5B4FC),
              const Color(0x1AA5B4FC),
              const Color(0x4DA5B4FC),
            ),
    };

    final chip = DecoratedBox(
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: border, width: 1),
        boxShadow: solid
            ? const [BoxShadow(color: Colors.black38, blurRadius: 4, offset: Offset(0, 1))]
            : null,
      ),
      child: Padding(
        padding: padding,
        child: Text(
          badge.label,
          style: TextStyle(
            color: fg,
            fontSize: fontSize,
            fontWeight: FontWeight.w700,
            letterSpacing: 0.2,
          ),
        ),
      ),
    );

    final tip = badge.tooltip;
    if (tip != null && tip.isNotEmpty && tip != badge.label) {
      return Tooltip(message: tip, child: chip);
    }
    return chip;
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// ScorePill — branded IMDb / AniList score
// ══════════════════════════════════════════════════════════════════════════════

/// Compact IMDb / AniList row for list cards — side-by-side, no wrap.
class ContentCardRatingBadges extends StatelessWidget {
  const ContentCardRatingBadges({
    super.key,
    required this.imdbRating,
    required this.anilistRating,
    this.compact = true,
  });

  final String? imdbRating;
  final String? anilistRating;
  final bool compact;

  factory ContentCardRatingBadges.fromItem(WatchlistItem item, {bool compact = true}) {
    return ContentCardRatingBadges(
      imdbRating: item.imdbRating,
      anilistRating: item.anilistRating,
      compact: compact,
    );
  }

  @override
  Widget build(BuildContext context) {
    final imdb = formatImdbDisplay(imdbRating);
    final anilist = formatAnilistDisplay(anilistRating);
    if (imdb == null && anilist == null) return const SizedBox.shrink();

    final children = <Widget>[
      if (imdb != null)
        Flexible(
          flex: 0,
          child: ContentScorePill(
            value: imdb,
            sourceLabel: 'IMDb',
            bg: const Color(0xFFF5C518),
            fg: Colors.black,
            compact: compact,
          ),
        ),
      if (imdb != null && anilist != null) SizedBox(width: compact ? 2.5 : 8),
      if (anilist != null)
        Flexible(
          flex: 0,
          child: ContentScorePill(
            value: anilist,
            sourceLabel: 'AL',
            bg: const Color(0xFF02A9FF),
            fg: Colors.white,
            compact: compact,
          ),
        ),
    ];

    return Row(
      mainAxisAlignment: MainAxisAlignment.start,
      mainAxisSize: MainAxisSize.max,
      children: children,
    );
  }
}

class ContentScorePill extends StatelessWidget {
  const ContentScorePill({
    super.key,
    required this.value,
    required this.sourceLabel,
    required this.bg,
    required this.fg,
    this.compact = false,
  });

  final String value;
  final String sourceLabel;
  final Color bg;
  final Color fg;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    final pad = compact
        ? const EdgeInsets.fromLTRB(4.8, 1.6, 5.4, 1.6)
        : const EdgeInsets.symmetric(horizontal: 8, vertical: 3);
    final valueSize = compact ? 7.0 : 10.5;
    final labelSize = compact ? 6.5 : 9.0;
    final gap = compact ? 2.5 : 4.0;

    return DecoratedBox(
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(999),
        boxShadow: compact
            ? const [BoxShadow(color: Colors.black26, blurRadius: 3, offset: Offset(0, 1))]
            : null,
      ),
      child: Padding(
        padding: pad,
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              value,
              style: TextStyle(
                color: fg,
                fontSize: valueSize,
                fontWeight: FontWeight.w800,
                height: 1,
              ),
            ),
            SizedBox(width: gap),
            Text(
              sourceLabel,
              style: TextStyle(
                color: fg.withValues(alpha: 0.75),
                fontSize: labelSize,
                fontWeight: FontWeight.w600,
                letterSpacing: 0.2,
                height: 1,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

// ── Private pill used by ContentTypeBadge ───────────────────────────────────

class _BadgePill extends StatelessWidget {
  const _BadgePill({
    required this.label,
    required this.fg,
    required this.bg,
  });

  final String label;
  final Color fg;
  final Color bg;

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(4),
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 3),
        child: Text(
          label,
          style: TextStyle(
            color: fg,
            fontSize: 10,
            fontWeight: FontWeight.w700,
            letterSpacing: 0.6,
          ),
        ),
      ),
    );
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// ContentTypePicker — pill-style Movie / TV / Anime selector for forms
// Replaces Material SegmentedButton — mirrors website modal content type field
// ══════════════════════════════════════════════════════════════════════════════

class ContentTypePicker extends StatelessWidget {
  const ContentTypePicker({
    super.key,
    required this.value,
    required this.onChanged,
    this.movies = 'Movies',
    this.tv = 'TV',
    this.anime = 'Anime',
  });

  final String value;
  final ValueChanged<String> onChanged;
  final String movies;
  final String tv;
  final String anime;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        _TypePill(
          label: movies,
          value: 'movies',
          selected: value == 'movies',
          onTap: () => onChanged('movies'),
        ),
        const SizedBox(width: 6),
        _TypePill(
          label: tv,
          value: 'tvSeries',
          selected: value == 'tvSeries',
          onTap: () => onChanged('tvSeries'),
        ),
        const SizedBox(width: 6),
        _TypePill(
          label: anime,
          value: 'anime',
          selected: value == 'anime',
          onTap: () => onChanged('anime'),
        ),
      ],
    );
  }
}

class _TypePill extends StatelessWidget {
  const _TypePill({
    required this.label,
    required this.value,
    required this.selected,
    required this.onTap,
  });

  final String label;
  final String value;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final tc = theme.extension<AppTypeColors>();
    final onSurface = theme.colorScheme.onSurface;

    Color activeBg;
    Color activeFg;
    switch (value) {
      case 'tvSeries':
        activeBg =
            (tc?.tv ?? theme.colorScheme.secondary).withValues(alpha: 0.18);
        activeFg = tc?.tv ?? theme.colorScheme.secondary;
      case 'anime':
        activeBg =
            (tc?.anime ?? theme.colorScheme.tertiary).withValues(alpha: 0.18);
        activeFg = tc?.anime ?? theme.colorScheme.tertiary;
      default:
        activeBg = theme.colorScheme.primary.withValues(alpha: 0.18);
        activeFg = theme.colorScheme.primary;
    }

    return GestureDetector(
      onTap: onTap,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 150),
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
        decoration: BoxDecoration(
          color: selected ? activeBg : onSurface.withValues(alpha: 0.06),
          borderRadius: BorderRadius.circular(20),
          border: Border.all(
            color: selected
                ? activeFg.withValues(alpha: 0.5)
                : onSurface.withValues(alpha: 0.12),
          ),
        ),
        child: Text(
          label,
          style: TextStyle(
            fontSize: 13,
            fontWeight: selected ? FontWeight.w600 : FontWeight.w400,
            color: selected ? activeFg : onSurface.withValues(alpha: 0.7),
          ),
        ),
      ),
    );
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// ModalHeader — Playfair title + bordered ✕ button (.modal__header)
// ══════════════════════════════════════════════════════════════════════════════

class ModalHeader extends StatelessWidget {
  const ModalHeader({
    super.key,
    required this.title,
    this.onClose,
  });

  final String title;
  final VoidCallback? onClose;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final onSurface = theme.colorScheme.onSurface;

    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 20, 16, 10),
      child: Row(
        children: [
          Expanded(
            child: Text(
              title,
              style: GoogleFonts.playfairDisplay(
                fontSize: 22,
                fontWeight: FontWeight.w600,
                color: onSurface,
                letterSpacing: -0.3,
              ),
            ),
          ),
          if (onClose != null) ...[
            const SizedBox(width: 12),
            _CloseButton(onClose: onClose!),
          ],
        ],
      ),
    );
  }
}

class _CloseButton extends StatelessWidget {
  const _CloseButton({required this.onClose});
  final VoidCallback onClose;

  @override
  Widget build(BuildContext context) {
    final onSurface = Theme.of(context).colorScheme.onSurface;
    return Material(
      color: Colors.transparent,
      borderRadius: BorderRadius.circular(6),
      child: InkWell(
        borderRadius: BorderRadius.circular(6),
        onTap: onClose,
        child: DecoratedBox(
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(6),
            border: Border.all(color: onSurface.withValues(alpha: 0.2)),
          ),
          child: SizedBox(
            width: 32,
            height: 32,
            child: Icon(
              Icons.close,
              size: 16,
              color: onSurface.withValues(alpha: 0.6),
            ),
          ),
        ),
      ),
    );
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// SheetTabBar — flat underline tab row for bottom sheets (.modal tabs)
// ══════════════════════════════════════════════════════════════════════════════

class SheetTabBar extends StatelessWidget {
  const SheetTabBar({
    super.key,
    required this.tabs,
    required this.selectedIndex,
    required this.onChanged,
  });

  final List<String> tabs;
  final int selectedIndex;
  final ValueChanged<int> onChanged;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final onSurface = theme.colorScheme.onSurface;
    final accent = theme.colorScheme.primary;

    return DecoratedBox(
      decoration: BoxDecoration(
        border: Border(
          bottom: BorderSide(color: onSurface.withValues(alpha: 0.1)),
        ),
      ),
      child: Row(
        children: List.generate(tabs.length, (i) {
          final active = i == selectedIndex;
          return GestureDetector(
            behavior: HitTestBehavior.opaque,
            onTap: () => onChanged(i),
            child: AnimatedContainer(
              duration: const Duration(milliseconds: 150),
              padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 10),
              decoration: BoxDecoration(
                border: Border(
                  bottom: BorderSide(
                    color: active ? accent : Colors.transparent,
                    width: 2,
                  ),
                ),
              ),
              child: Text(
                tabs[i],
                style: TextStyle(
                  fontSize: 13,
                  fontWeight: active ? FontWeight.w600 : FontWeight.w400,
                  color: active ? accent : onSurface.withValues(alpha: 0.55),
                ),
              ),
            ),
          );
        }),
      ),
    );
  }
}
