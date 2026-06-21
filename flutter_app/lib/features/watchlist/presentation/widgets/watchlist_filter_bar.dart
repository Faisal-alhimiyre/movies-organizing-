import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../app/theme/theme_extensions.dart';
import '../../../../core/widgets/responsive_layout.dart';
import '../../../../l10n/l10n.dart';
import '../../../../models/watchlist_item.dart';
import '../../application/watchlist_controller.dart';
import '../../application/watchlist_filters.dart';
import 'metadata_backfill_banner.dart';

/// Filter toolbar — mirrors `.panel__filters` on the static site.
class WatchlistFilterBar extends ConsumerStatefulWidget {
  const WatchlistFilterBar({
    super.key,
    required this.items,
    required this.l10n,
  });

  final List<WatchlistItem> items;
  final L10n l10n;

  @override
  ConsumerState<WatchlistFilterBar> createState() => _WatchlistFilterBarState();
}

class _WatchlistFilterBarState extends ConsumerState<WatchlistFilterBar> {
  late final TextEditingController _searchController;

  @override
  void initState() {
    super.initState();
    _searchController =
        TextEditingController(text: ref.read(watchlistFilterProvider).search);
  }

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final filters = ref.watch(watchlistFilterProvider);
    final notifier = ref.read(watchlistFilterProvider.notifier);
    final l10n = widget.l10n;
    final theme = Theme.of(context);
    final tc = theme.extension<AppTypeColors>()!;
    final isMobile = AppBreakpoints.isMobile(context);

    final availableGenres = availableGenresFromItems(widget.items);
    final addableGenres = availableGenres
        .where((g) => !filters.selectedGenres.contains(g))
        .toList();

    if (filters.search != _searchController.text) {
      _searchController.text = filters.search;
    }

    final gap = isMobile ? 5.6 : 8.8;
    final padding = isMobile ? 6.4 : 12.0;
    final metrics = _FilterMetrics(isMobile: isMobile);

    final genreBlock = _FilterLabeledField(
      label: l10n.filterLabelGenre,
      tc: tc,
      child: _GenreFilterBlock(
        genres: addableGenres,
        selectedGenres: filters.selectedGenres,
        l10n: l10n,
        metrics: metrics,
        tc: tc,
        theme: theme,
        onSelected: notifier.addGenre,
        onRemove: notifier.removeGenre,
      ),
    );

    final watchedFilter = _FilterLabeledField(
      label: l10n.filterLabelWatched,
      tc: tc,
      child: _FilterDropdown<WatchedFilter>(
        value: filters.watchedFilter,
        hint: null,
        metrics: metrics,
        tc: tc,
        theme: theme,
        items: const [
          WatchedFilter.all,
          WatchedFilter.watched,
          WatchedFilter.unwatched,
        ],
        labelBuilder: (v) => switch (v) {
          WatchedFilter.all => l10n.filterAll,
          WatchedFilter.watched => l10n.filterWatched,
          WatchedFilter.unwatched => l10n.filterUnwatched,
        },
        onChanged: notifier.setWatchedFilter,
      ),
    );

    final sortBlock = _FilterLabeledField(
      label: l10n.filterLabelSort,
      tc: tc,
      child: _SortFilterBlock(
        value: filters.sortSource,
        showDirection: isToggleSortActive(filters),
        descending: isSortDescendingPreferred(filters),
        directionLabel: l10n.sortDirectionLabel(
          filters.sortSource,
          filters.sortDirection,
        ),
        l10n: l10n,
        metrics: metrics,
        tc: tc,
        theme: theme,
        onSortChanged: notifier.setSortSource,
        onDirectionToggle: notifier.toggleSortDirection,
      ),
    );

    final searchField = _SearchField(
      controller: _searchController,
      hint: l10n.searchPlaceholder,
      hasValue: filters.search.isNotEmpty,
      metrics: metrics,
      tc: tc,
      theme: theme,
      onChanged: notifier.setSearch,
      onClear: () {
        _searchController.clear();
        notifier.setSearch('');
      },
    );

    final clearButton = filters.hasActiveFilters
        ? _ClearFiltersButton(
            label: l10n.filterClear,
            isMobile: isMobile,
            tc: tc,
            theme: theme,
            onPressed: notifier.clearAll,
          )
        : null;

    return Padding(
      padding: EdgeInsets.all(padding),
      child: _FiltersGridLayout(
        isMobile: isMobile,
        metrics: metrics,
        gap: gap,
        search: searchField,
        genre: genreBlock,
        watched: watchedFilter,
        sort: sortBlock,
        clear: clearButton,
        banner: MetadataBackfillBanner(l10n: l10n, inPanel: true),
      ),
    );
  }
}

class _FilterMetrics {
  const _FilterMetrics({required this.isMobile});

  final bool isMobile;

  double get searchHeight => isMobile ? 48.0 : filterHeight;
  double get filterHeight => isMobile ? 37.6 : 36;
  double get sortButtonSize => 36;
  double get searchFontSize => isMobile ? 16 : 14;
  double get filterFontSize => isMobile ? 12.48 : 14;
  double get chipFontSize => 12.48;
  double get labelFontSize => isMobile ? 10.88 : 11.52;
}

class _FilterLabeledField extends StatelessWidget {
  const _FilterLabeledField({
    required this.label,
    required this.tc,
    required this.child,
  });

  final String label;
  final AppTypeColors tc;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    final isMobile = AppBreakpoints.isMobile(context);
    final metrics = _FilterMetrics(isMobile: isMobile);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          label,
          style: TextStyle(
            fontSize: metrics.labelFontSize,
            fontWeight: FontWeight.w500,
            color: tc.textMuted,
            height: 1.2,
          ),
        ),
        const SizedBox(height: 2.4),
        child,
      ],
    );
  }
}

class _FiltersGridLayout extends StatelessWidget {
  const _FiltersGridLayout({
    required this.isMobile,
    required this.metrics,
    required this.gap,
    required this.search,
    required this.genre,
    required this.watched,
    required this.sort,
    required this.clear,
    required this.banner,
  });

  final bool isMobile;
  final _FilterMetrics metrics;
  final double gap;
  final Widget search;
  final Widget genre;
  final Widget watched;
  final Widget sort;
  final Widget? clear;
  final Widget banner;

  double get _labelOffset => metrics.labelFontSize * 1.2 + 2.4;

  @override
  Widget build(BuildContext context) {
    if (isMobile) {
      return Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          search,
          SizedBox(height: gap),
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(child: genre),
              SizedBox(width: gap),
              Expanded(child: watched),
              SizedBox(width: gap),
              Expanded(child: sort),
            ],
          ),
          if (clear != null) ...[
            SizedBox(height: gap),
            Align(
              alignment: AlignmentDirectional.centerEnd,
              child: clear,
            ),
          ],
          banner,
        ],
      );
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            SizedBox(
              width: 280,
              child: Padding(
                padding: EdgeInsets.only(top: _labelOffset),
                child: search,
              ),
            ),
            SizedBox(width: gap),
            Expanded(child: genre),
            SizedBox(width: gap),
            Expanded(child: watched),
            SizedBox(width: gap),
            Expanded(child: sort),
          ],
        ),
        if (clear != null) ...[
          SizedBox(height: gap),
          Align(
            alignment: AlignmentDirectional.centerEnd,
            child: clear,
          ),
        ],
        banner,
      ],
    );
  }
}

class _SearchField extends StatefulWidget {
  const _SearchField({
    required this.controller,
    required this.hint,
    required this.hasValue,
    required this.metrics,
    required this.tc,
    required this.theme,
    required this.onChanged,
    required this.onClear,
  });

  final TextEditingController controller;
  final String hint;
  final bool hasValue;
  final _FilterMetrics metrics;
  final AppTypeColors tc;
  final ThemeData theme;
  final ValueChanged<String> onChanged;
  final VoidCallback onClear;

  @override
  State<_SearchField> createState() => _SearchFieldState();
}

class _SearchFieldState extends State<_SearchField> {
  static const _focusBorder = Color(0x66E8B84A);

  final _focusNode = FocusNode();
  var _focused = false;

  @override
  void initState() {
    super.initState();
    _focusNode.addListener(_onFocusChange);
  }

  void _onFocusChange() {
    final focused = _focusNode.hasFocus;
    if (focused != _focused) {
      setState(() => _focused = focused);
    }
  }

  @override
  void dispose() {
    _focusNode.removeListener(_onFocusChange);
    _focusNode.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final metrics = widget.metrics;
    final tc = widget.tc;
    final theme = widget.theme;
    final iconInset = metrics.isMobile ? 12.0 : 10.4;
    final iconSize = metrics.isMobile ? 16.8 : 16.0;

    return LayoutBuilder(
      builder: (context, constraints) {
        return SizedBox(
          width: constraints.maxWidth,
          height: metrics.searchHeight,
          child: DecoratedBox(
            decoration: BoxDecoration(
              color: tc.searchFieldBg,
              borderRadius: BorderRadius.circular(8),
              border: Border.all(
                color: _focused ? _focusBorder : theme.dividerColor,
              ),
            ),
            child: Padding(
              padding: EdgeInsetsDirectional.only(
                start: iconInset,
                end: widget.hasValue ? 4 : 10.4,
              ),
              child: Row(
                children: [
                  Icon(Icons.search, size: iconSize, color: tc.textMuted),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Theme(
                      data: theme.copyWith(
                        inputDecorationTheme:
                            theme.inputDecorationTheme.copyWith(
                          border: InputBorder.none,
                          enabledBorder: InputBorder.none,
                          focusedBorder: InputBorder.none,
                          disabledBorder: InputBorder.none,
                          filled: false,
                        ),
                      ),
                      child: TextField(
                        controller: widget.controller,
                        focusNode: _focusNode,
                        onChanged: widget.onChanged,
                        textAlignVertical: TextAlignVertical.center,
                        style: TextStyle(
                          fontSize: metrics.searchFontSize,
                          color: theme.colorScheme.onSurface,
                          height: 1.25,
                        ),
                        decoration: InputDecoration(
                          border: InputBorder.none,
                          enabledBorder: InputBorder.none,
                          focusedBorder: InputBorder.none,
                          disabledBorder: InputBorder.none,
                          errorBorder: InputBorder.none,
                          focusedErrorBorder: InputBorder.none,
                          filled: false,
                          fillColor: Colors.transparent,
                          hoverColor: Colors.transparent,
                          isDense: true,
                          contentPadding: EdgeInsets.zero,
                          hintText: widget.hint,
                          hintStyle: TextStyle(
                            color: tc.textMuted,
                            fontSize: metrics.searchFontSize,
                          ),
                        ),
                      ),
                    ),
                  ),
                  if (widget.hasValue)
                    IconButton(
                      icon: Icon(
                        Icons.close,
                        size: 16,
                        color: tc.textMuted.withValues(alpha: 0.85),
                      ),
                      onPressed: widget.onClear,
                      padding: EdgeInsets.zero,
                      constraints:
                          const BoxConstraints(minWidth: 32, minHeight: 32),
                    ),
                ],
              ),
            ),
          ),
        );
      },
    );
  }
}

class _FilterDropdown<T> extends StatelessWidget {
  const _FilterDropdown({
    this.value,
    required this.hint,
    required this.metrics,
    required this.tc,
    required this.theme,
    required this.items,
    required this.labelBuilder,
    required this.onChanged,
  }) : assert(value != null || hint != null);

  final T? value;
  final String? hint;
  final _FilterMetrics metrics;
  final AppTypeColors tc;
  final ThemeData theme;
  final List<T> items;
  final String Function(T) labelBuilder;
  final ValueChanged<T> onChanged;

  @override
  Widget build(BuildContext context) {
    if (items.isEmpty && hint != null) {
      return _FilterFieldShell(
        metrics: metrics,
        tc: tc,
        theme: theme,
        child: Align(
          alignment: AlignmentDirectional.centerStart,
          child: Text(
            hint!,
            style: TextStyle(
              fontSize: metrics.filterFontSize,
              color: tc.textMuted.withValues(alpha: 0.65),
            ),
            overflow: TextOverflow.ellipsis,
          ),
        ),
      );
    }

    return _FilterFieldShell(
      metrics: metrics,
      tc: tc,
      theme: theme,
      child: DropdownButtonHideUnderline(
        child: DropdownButton<T>(
          value: value,
          hint: hint == null
              ? null
              : Text(
                  hint!,
                  style: TextStyle(
                    fontSize: metrics.filterFontSize,
                    color: tc.textMuted.withValues(alpha: 0.65),
                  ),
                  overflow: TextOverflow.ellipsis,
                ),
          isExpanded: true,
          isDense: true,
          icon: Icon(Icons.keyboard_arrow_down,
              size: 14, color: tc.textMuted.withValues(alpha: 0.85)),
          dropdownColor: theme.colorScheme.surface,
          style: TextStyle(
            fontSize: metrics.filterFontSize,
            fontWeight: FontWeight.w500,
            color: theme.colorScheme.onSurface,
          ),
          items: items
              .map(
                (item) => DropdownMenuItem<T>(
                  value: item,
                  child: Text(
                    labelBuilder(item),
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
              )
              .toList(),
          onChanged: (v) {
            if (v != null) onChanged(v);
          },
        ),
      ),
    );
  }
}

class _FilterFieldShell extends StatelessWidget {
  const _FilterFieldShell({
    required this.metrics,
    required this.tc,
    required this.theme,
    required this.child,
  });

  final _FilterMetrics metrics;
  final AppTypeColors tc;
  final ThemeData theme;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: metrics.filterHeight,
      child: DecoratedBox(
        decoration: BoxDecoration(
          color: tc.filterFieldBg,
          borderRadius: BorderRadius.circular(8),
          border: Border.all(color: theme.dividerColor),
        ),
        child: Padding(
          padding: const EdgeInsetsDirectional.only(start: 10, end: 6),
          child: Align(
            alignment: AlignmentDirectional.centerStart,
            child: child,
          ),
        ),
      ),
    );
  }
}

class _GenreFilterBlock extends StatelessWidget {
  const _GenreFilterBlock({
    required this.genres,
    required this.selectedGenres,
    required this.l10n,
    required this.metrics,
    required this.tc,
    required this.theme,
    required this.onSelected,
    required this.onRemove,
  });

  final List<String> genres;
  final List<String> selectedGenres;
  final L10n l10n;
  final _FilterMetrics metrics;
  final AppTypeColors tc;
  final ThemeData theme;
  final ValueChanged<String> onSelected;
  final ValueChanged<String> onRemove;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _FilterDropdown<String>(
          hint: l10n.filterAllGenres,
          metrics: metrics,
          tc: tc,
          theme: theme,
          items: genres,
          labelBuilder: (g) => l10n.genreLabel(g),
          onChanged: onSelected,
        ),
        if (selectedGenres.isNotEmpty) ...[
          const SizedBox(height: 5.6),
          Wrap(
            spacing: 5.6,
            runSpacing: 5.6,
            children: selectedGenres
                .map(
                  (genre) => _GenreFilterChip(
                    label: l10n.genreLabel(genre),
                    metrics: metrics,
                    tc: tc,
                    onRemove: () => onRemove(genre),
                  ),
                )
                .toList(),
          ),
        ],
      ],
    );
  }
}

class _SortFilterBlock extends StatelessWidget {
  const _SortFilterBlock({
    required this.value,
    required this.showDirection,
    required this.descending,
    required this.directionLabel,
    required this.l10n,
    required this.metrics,
    required this.tc,
    required this.theme,
    required this.onSortChanged,
    required this.onDirectionToggle,
  });

  final String value;
  final bool showDirection;
  final bool descending;
  final String directionLabel;
  final L10n l10n;
  final _FilterMetrics metrics;
  final AppTypeColors tc;
  final ThemeData theme;
  final ValueChanged<String> onSortChanged;
  final VoidCallback onDirectionToggle;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Expanded(
          child: _FilterDropdown<String>(
            value: value,
            hint: null,
            metrics: metrics,
            tc: tc,
            theme: theme,
            items: sortFilterOptions,
            labelBuilder: (opt) => l10n.sortFilterLabel(opt),
            onChanged: onSortChanged,
          ),
        ),
        if (showDirection) ...[
          const SizedBox(width: 5.6),
          _SortDirectionButton(
            descending: descending,
            label: directionLabel,
            metrics: metrics,
            tc: tc,
            theme: theme,
            onPressed: onDirectionToggle,
          ),
        ],
      ],
    );
  }
}

class _SortDirectionButton extends StatelessWidget {
  const _SortDirectionButton({
    required this.descending,
    required this.label,
    required this.metrics,
    required this.tc,
    required this.theme,
    required this.onPressed,
  });

  final bool descending;
  final String label;
  final _FilterMetrics metrics;
  final AppTypeColors tc;
  final ThemeData theme;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    final size = metrics.sortButtonSize;
    return Tooltip(
      message: label,
      child: Material(
        color: tc.filterFieldBg,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(8),
          side: BorderSide(color: theme.dividerColor),
        ),
        child: InkWell(
          onTap: onPressed,
          borderRadius: BorderRadius.circular(8),
          child: SizedBox(
            width: size,
            height: size,
            child: Transform.rotate(
              angle: descending ? -math.pi / 2 : math.pi / 2,
              child: Icon(
                Icons.arrow_forward,
                size: 17.6,
                color: tc.textMuted,
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _GenreFilterChip extends StatelessWidget {
  const _GenreFilterChip({
    required this.label,
    required this.metrics,
    required this.tc,
    required this.onRemove,
  });

  final String label;
  final _FilterMetrics metrics;
  final AppTypeColors tc;
  final VoidCallback onRemove;

  Gradient get _gradient {
    if (tc.filterChipHorizontalGradient && tc.filterChipGradientMid != null) {
      return LinearGradient(
        begin: Alignment.centerLeft,
        end: Alignment.centerRight,
        colors: [
          tc.filterChipGradientStart,
          tc.filterChipGradientMid!,
          tc.filterChipGradientEnd,
        ],
        stops: const [0, 0.48, 1],
      );
    }
    return LinearGradient(
      begin: Alignment.topCenter,
      end: Alignment.bottomCenter,
      colors: [tc.filterChipGradientStart, tc.filterChipGradientEnd],
    );
  }

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: BoxDecoration(
        gradient: _gradient,
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: tc.filterChipBorder),
      ),
      child: Padding(
        padding: const EdgeInsetsDirectional.fromSTEB(8.8, 4.8, 2, 4.8),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              label,
              style: TextStyle(
                fontSize: metrics.chipFontSize,
                fontWeight: FontWeight.w500,
                color: tc.filterChipFg,
              ),
            ),
            _ChipRemoveButton(
              color: tc.filterChipFg,
              hoverBg: tc.filterChipRemoveHoverBg,
              onPressed: onRemove,
            ),
          ],
        ),
      ),
    );
  }
}

class _ChipRemoveButton extends StatefulWidget {
  const _ChipRemoveButton({
    required this.color,
    required this.hoverBg,
    required this.onPressed,
  });

  final Color color;
  final Color hoverBg;
  final VoidCallback onPressed;

  @override
  State<_ChipRemoveButton> createState() => _ChipRemoveButtonState();
}

class _ChipRemoveButtonState extends State<_ChipRemoveButton> {
  bool _hovered = false;

  @override
  Widget build(BuildContext context) {
    return MouseRegion(
      onEnter: (_) => setState(() => _hovered = true),
      onExit: (_) => setState(() => _hovered = false),
      child: Material(
        color: _hovered ? widget.hoverBg : Colors.transparent,
        shape: const CircleBorder(),
        child: InkWell(
          onTap: widget.onPressed,
          customBorder: const CircleBorder(),
          child: SizedBox(
            width: 28,
            height: 28,
            child: Center(
              child: Text(
                '×',
                style: TextStyle(
                  fontSize: 15,
                  height: 1,
                  color: widget.color,
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _ClearFiltersButton extends StatelessWidget {
  const _ClearFiltersButton({
    required this.label,
    required this.isMobile,
    required this.tc,
    required this.theme,
    required this.onPressed,
  });

  final String label;
  final bool isMobile;
  final AppTypeColors tc;
  final ThemeData theme;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    return TextButton(
      style: TextButton.styleFrom(
        foregroundColor: theme.colorScheme.onSurface,
        backgroundColor: tc.bgElevated,
        minimumSize: Size(0, isMobile ? 32 : 36),
        padding: EdgeInsets.symmetric(
          horizontal: isMobile ? 8.8 : 12,
          vertical: isMobile ? 4.8 : 6.4,
        ),
        tapTargetSize: MaterialTapTargetSize.shrinkWrap,
        visualDensity: VisualDensity.compact,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(8),
          side: BorderSide(color: theme.dividerColor),
        ),
      ),
      onPressed: onPressed,
      child: Text(
        label,
        style: TextStyle(fontSize: isMobile ? 11.52 : 13),
      ),
    );
  }
}
