import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../l10n/l10n.dart';
import '../../../../models/watchlist_item.dart';
import '../../application/watchlist_controller.dart';
import '../../application/watchlist_filters.dart';

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
    _searchController = TextEditingController(text: ref.read(watchlistFilterProvider).search);
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
    final availableGenres = availableGenresFromItems(widget.items);
    final addableGenres = availableGenres
        .where((genre) => !filters.selectedGenres.contains(genre))
        .toList();

    if (filters.search != _searchController.text) {
      _searchController.text = filters.search;
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        TextField(
          controller: _searchController,
          decoration: InputDecoration(
            hintText: l10n.searchPlaceholder,
            prefixIcon: const Icon(Icons.search),
            suffixIcon: filters.search.isNotEmpty
                ? IconButton(
                    onPressed: () {
                      _searchController.clear();
                      notifier.setSearch('');
                    },
                    icon: const Icon(Icons.clear),
                  )
                : null,
          ),
          onChanged: notifier.setSearch,
        ),
        const SizedBox(height: 12),
        SegmentedButton<WatchedFilter>(
          segments: [
            ButtonSegment(value: WatchedFilter.all, label: Text(l10n.filterAll)),
            ButtonSegment(
              value: WatchedFilter.watched,
              label: Text(l10n.filterWatched),
            ),
            ButtonSegment(
              value: WatchedFilter.unwatched,
              label: Text(l10n.filterUnwatched),
            ),
          ],
          selected: {filters.watchedFilter},
          onSelectionChanged: (value) => notifier.setWatchedFilter(value.first),
        ),
        const SizedBox(height: 12),
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: DropdownButtonFormField<String>(
                value: filters.sortSource,
                decoration: InputDecoration(labelText: l10n.filterSortBy),
                items: sortFilterOptions
                    .map(
                      (value) => DropdownMenuItem(
                        value: value,
                        child: Text(l10n.sortFilterLabel(value)),
                      ),
                    )
                    .toList(),
                onChanged: (value) {
                  if (value != null) notifier.setSortSource(value);
                },
              ),
            ),
            if (isToggleSortActive(filters)) ...[
              const SizedBox(width: 8),
              IconButton(
                tooltip: l10n.sortDirectionLabel(
                  filters.sortSource,
                  filters.sortDirection,
                ),
                onPressed: notifier.toggleSortDirection,
                icon: Transform.rotate(
                  angle: isSortDescendingPreferred(filters) ? 0 : 3.14159,
                  child: const Icon(Icons.arrow_upward),
                ),
              ),
            ],
          ],
        ),
        if (availableGenres.isNotEmpty) ...[
          const SizedBox(height: 12),
          Align(
            alignment: Alignment.centerLeft,
            child: Text(
              l10n.filterByGenre,
              style: Theme.of(context).textTheme.labelLarge,
            ),
          ),
          const SizedBox(height: 8),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              ...filters.selectedGenres.map(
                (genre) => InputChip(
                  label: Text(genre),
                  selected: true,
                  onDeleted: () => notifier.removeGenre(genre),
                ),
              ),
              if (addableGenres.isNotEmpty)
                _AddGenreChip(
                  genres: addableGenres,
                  label: l10n.filterAddGenre,
                  onSelected: notifier.addGenre,
                ),
            ],
          ),
        ],
        if (filters.hasActiveFilters) ...[
          const SizedBox(height: 8),
          Align(
            alignment: Alignment.centerRight,
            child: TextButton(
              onPressed: notifier.clearAll,
              child: Text(l10n.filterClear),
            ),
          ),
        ],
      ],
    );
  }
}

class _AddGenreChip extends StatelessWidget {
  const _AddGenreChip({
    required this.genres,
    required this.label,
    required this.onSelected,
  });

  final List<String> genres;
  final String label;
  final ValueChanged<String> onSelected;

  @override
  Widget build(BuildContext context) {
    return ActionChip(
      avatar: const Icon(Icons.add, size: 18),
      label: Text(label),
      onPressed: () async {
        final genre = await showModalBottomSheet<String>(
          context: context,
          builder: (context) => SafeArea(
            child: ListView(
              shrinkWrap: true,
              children: genres
                  .map(
                    (g) => ListTile(
                      title: Text(g),
                      onTap: () => Navigator.pop(context, g),
                    ),
                  )
                  .toList(),
            ),
          ),
        );
        if (genre != null) onSelected(genre);
      },
    );
  }
}
