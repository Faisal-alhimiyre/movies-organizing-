import 'package:flutter/material.dart';

import '../../../../l10n/l10n.dart';
import '../../../../models/watchlist_item.dart';

class TypeTabBar extends StatelessWidget {
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
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: SegmentedButton<WatchlistTypeFilter>(
        segments: [
          _segment(WatchlistTypeFilter.all, l10n.typeAll, counts),
          _segment(WatchlistTypeFilter.movies, l10n.typeMovies, counts),
          _segment(WatchlistTypeFilter.tvSeries, l10n.typeTv, counts),
          _segment(WatchlistTypeFilter.anime, l10n.typeAnime, counts),
        ],
        selected: {selected},
        onSelectionChanged: (value) => onChanged(value.first),
      ),
    );
  }

  ButtonSegment<WatchlistTypeFilter> _segment(
    WatchlistTypeFilter type,
    String label,
    Map<WatchlistTypeFilter, int> counts,
  ) {
    final count = counts[type] ?? 0;
    return ButtonSegment(
      value: type,
      label: Text('$label ($count)'),
    );
  }
}
