import 'dart:async';

import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/utils/title_meta_format.dart';
import '../../../core/widgets/content_badges.dart';
import '../../../l10n/l10n.dart';
import '../../../core/widgets/poster_lightbox.dart';
import '../../../models/metadata_detail.dart';
import '../../../models/title_search_result.dart';
import '../../../models/watchlist_item.dart';
import '../../../repositories/metadata/metadata_service.dart';
import '../../../core/utils/watchlist_parser.dart';
import '../../../repositories/metadata/genre_mapper.dart';
import '../application/build_item_from_metadata.dart';
import 'bulk_add_tab.dart';
import '../../watchlist/presentation/widgets/title_form_sheet.dart';

enum AddTitleTab { search, manual, bulk }

Future<bool?> showAddTitleSheet(
  BuildContext context, {
  required L10n l10n,
  required String initialContentType,
  required List<WatchlistItem> existingItems,
  required Future<String?> Function(WatchlistItem item) onSave,
  required Future<String?> Function(List<WatchlistItem> items) onSaveBulk,
  AddTitleTab initialTab = AddTitleTab.search,
}) {
  return showModalBottomSheet<bool>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    builder: (context) => AddTitleSheet(
      l10n: l10n,
      initialContentType: initialContentType,
      existingItems: existingItems,
      onSave: onSave,
      onSaveBulk: onSaveBulk,
      initialTab: initialTab,
    ),
  );
}

class AddTitleSheet extends ConsumerStatefulWidget {
  const AddTitleSheet({
    super.key,
    required this.l10n,
    required this.initialContentType,
    required this.existingItems,
    required this.onSave,
    required this.onSaveBulk,
    this.initialTab = AddTitleTab.search,
  });

  final L10n l10n;
  final String initialContentType;
  final List<WatchlistItem> existingItems;
  final Future<String?> Function(WatchlistItem item) onSave;
  final Future<String?> Function(List<WatchlistItem> items) onSaveBulk;
  final AddTitleTab initialTab;

  @override
  ConsumerState<AddTitleSheet> createState() => _AddTitleSheetState();
}

class _AddTitleSheetState extends ConsumerState<AddTitleSheet>
    with SingleTickerProviderStateMixin {
  late final TabController _tabs;
  final _searchController = TextEditingController();
  Timer? _debounce;
  String _searchType = 'all';
  List<TitleSearchResult> _results = [];
  String? _statusKey;
  bool _statusError = false;
  bool _searching = false;
  bool _loadingDetails = false;
  MetadataDetail? _confirmDetails;
  String? _confirmResultKey;
  late String _confirmContentType;
  late String _confirmGenre;
  List<String> _confirmSecondaryGenres = const [];
  bool _saving = false;
  String? _errorKey;
  // Tracks inline + button states
  final Set<String> _addedKeys = {};
  final Set<String> _addingKeys = {};

  @override
  void initState() {
    super.initState();
    _tabs = TabController(
      length: 3,
      vsync: this,
      initialIndex: widget.initialTab.index,
    );
    _searchType = _searchTypeFromContent(widget.initialContentType);
    _confirmContentType = widget.initialContentType;
    _confirmGenre = standardGenres.first;
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _searchController.dispose();
    _tabs.dispose();
    super.dispose();
  }

  String _searchTypeFromContent(String contentType) => switch (contentType) {
        'movies' => 'movie',
        'tvSeries' => 'series',
        'anime' => 'anime',
        _ => 'all',
      };

  void _queueSearch() {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 350), _runSearch);
  }

  Future<void> _runSearch() async {
    final query = _searchController.text.trim();
    if (query.length < 2) {
      setState(() {
        _results = [];
        _statusKey = null;
        _statusError = false;
      });
      return;
    }

    setState(() {
      _searching = true;
      _statusKey = null;
      _statusError = false;
    });

    final service = ref.read(metadataServiceProvider);
    final response = await service.searchTitles(
      query,
      type: _searchType,
      locale: titleLocaleFromQuery(query),
    );

    if (!mounted) return;

    setState(() {
      _searching = false;
      if (!response.ok) {
        _results = [];
        _statusKey = response.error ?? 'search.failed';
        _statusError = true;
        return;
      }
      _results = response.results;
      _statusKey = _results.isEmpty
          ? (response.message ?? 'search.noMatches')
          : _results.length == 1
              ? 'search.foundOne'
              : 'search.foundMany:${_results.length}';
      _statusError = false;
    });
  }

  /// Add a result directly without going through the confirm step.
  /// Falls back to confirm step when metadata is incomplete.
  Future<void> _directAdd(TitleSearchResult result) async {
    final key = result.dedupeKey();
    if (_addedKeys.contains(key) || _addingKeys.contains(key)) return;

    setState(() => _addingKeys.add(key));

    final service = ref.read(metadataServiceProvider);
    final details = await service.getDetailsForPick(result);

    if (!mounted) return;

    if (details == null || details.title.trim().isEmpty) {
      setState(() {
        _addingKeys.remove(key);
        _statusKey = 'search.loadFailed';
        _statusError = true;
      });
      return;
    }

    final contentType = details.contentType;
    final suggested = suggestGenres(details.genres, contentType);
    final genre = suggested.isNotEmpty
        ? suggested.first
        : defaultGenreForContentType(contentType);
    final secondary = normalizeSecondaryGenres(
      genre,
      suggested.where((g) => g != genre).toList(),
    );

    final item = buildItemFromMetadata(
      details: details,
      contentType: contentType,
      genre: genre,
      secondaryGenres: secondary,
    );

    // Fall back to confirm step when title or summary is missing
    if (item.title.isEmpty || item.summary.isEmpty) {
      setState(() {
        _addingKeys.remove(key);
        _confirmDetails = details;
        _confirmResultKey = key;
        _confirmContentType = contentType;
        _confirmGenre = genre;
        _confirmSecondaryGenres = secondary;
      });
      return;
    }

    // Duplicate check
    final duplicate = findDuplicateTitle(widget.existingItems, item);
    if (duplicate != null) {
      setState(() {
        _addingKeys.remove(key);
        _addedKeys.add(key);
      });
      return;
    }

    final errorKey = await widget.onSave(item);
    if (!mounted) return;

    setState(() {
      _addingKeys.remove(key);
      if (errorKey == null) {
        _addedKeys.add(key);
        _statusKey = 'search.addedStatus:${item.title}';
        _statusError = false;
      } else {
        _statusKey = errorKey;
        _statusError = true;
      }
    });
  }

  Future<void> _pickResult(TitleSearchResult result) async {
    if (_loadingDetails || !result.hasLookupId) return;

    setState(() {
      _loadingDetails = true;
      _statusKey = 'search.loadingDetails';
      _statusError = false;
    });

    final service = ref.read(metadataServiceProvider);
    final details = await service.getDetailsForPick(result);

    if (!mounted) return;

    if (details == null || details.title.trim().isEmpty) {
      setState(() {
        _loadingDetails = false;
        _statusKey = 'search.loadFailed';
        _statusError = true;
      });
      return;
    }

    final suggested = suggestGenres(details.genres, details.contentType);
    final primary = suggested.isNotEmpty
        ? suggested.first
        : defaultGenreForContentType(details.contentType);
    setState(() {
      _loadingDetails = false;
      _confirmDetails = details;
      _confirmResultKey = result.dedupeKey();
      _confirmContentType = details.contentType;
      _confirmGenre = primary;
      _confirmSecondaryGenres = normalizeSecondaryGenres(
        primary,
        suggested.where((g) => g != primary).toList(),
      );
      _statusKey = null;
    });
  }

  void _backToSearch() {
    setState(() {
      _confirmDetails = null;
      _confirmResultKey = null;
      _confirmSecondaryGenres = const [];
      _errorKey = null;
    });
  }

  void _onConfirmGenreChanged(String value) {
    setState(() {
      _confirmGenre = value;
      _confirmSecondaryGenres = normalizeSecondaryGenres(
        value,
        _confirmSecondaryGenres,
      );
    });
  }

  void _addConfirmSecondaryGenre(String genre) {
    if (genre.isEmpty || genre == _confirmGenre) return;
    setState(() {
      _confirmSecondaryGenres = normalizeSecondaryGenres(
        _confirmGenre,
        [..._confirmSecondaryGenres, genre],
      );
    });
  }

  void _removeConfirmSecondaryGenre(String genre) {
    setState(() {
      _confirmSecondaryGenres =
          _confirmSecondaryGenres.where((g) => g != genre).toList();
    });
  }

  Future<void> _confirmAdd() async {
    final details = _confirmDetails;
    if (details == null || _saving) return;

    final item = buildItemFromMetadata(
      details: details,
      contentType: _confirmContentType,
      genre: _confirmGenre,
      secondaryGenres: _confirmSecondaryGenres,
    );

    if (item.title.isEmpty || item.summary.isEmpty) {
      setState(() => _errorKey = 'search.incomplete');
      return;
    }

    final duplicate = findDuplicateTitle(widget.existingItems, item);
    if (duplicate != null) {
      setState(() => _errorKey = 'watchlist.duplicate');
      return;
    }

    setState(() {
      _saving = true;
      _errorKey = null;
    });

    final errorKey = await widget.onSave(item);
    if (!mounted) return;

    if (errorKey == null) {
      final resultKey = _confirmResultKey ??
          '${item.title}::${details.year ?? ''}';
      setState(() {
        _saving = false;
        _confirmDetails = null;
        _confirmResultKey = null;
        _confirmSecondaryGenres = const [];
        _errorKey = null;
        _addedKeys.add(resultKey);
        _statusKey = 'search.addedStatus:${item.title}';
        _statusError = false;
      });
      return;
    }

    setState(() {
      _saving = false;
      _errorKey = errorKey;
    });
  }

  @override
  Widget build(BuildContext context) {
    final l10n = widget.l10n;
    final bottomInset = MediaQuery.viewInsetsOf(context).bottom;

    return Padding(
      padding: EdgeInsets.only(bottom: bottomInset),
      child: DraggableScrollableSheet(
        expand: false,
        initialChildSize: 0.92,
        minChildSize: 0.5,
        maxChildSize: 0.96,
        builder: (context, scrollController) {
          if (_confirmDetails != null) {
            return _ConfirmStep(
              l10n: l10n,
              scrollController: scrollController,
              details: _confirmDetails!,
              contentType: _confirmContentType,
              genre: _confirmGenre,
              secondaryGenres: _confirmSecondaryGenres,
              saving: _saving,
              errorKey: _errorKey,
              onContentTypeChanged: (value) =>
                  setState(() => _confirmContentType = value),
              onGenreChanged: _onConfirmGenreChanged,
              onAddSecondaryGenre: _addConfirmSecondaryGenre,
              onRemoveSecondaryGenre: _removeConfirmSecondaryGenre,
              onBack: _backToSearch,
              onSave: _confirmAdd,
            );
          }

          return Column(
            children: [
              // drag handle
              Center(
                child: Container(
                  margin: const EdgeInsets.only(top: 10, bottom: 4),
                  width: 36,
                  height: 4,
                  decoration: BoxDecoration(
                    color: Theme.of(context)
                        .colorScheme
                        .onSurface
                        .withValues(alpha: 0.2),
                    borderRadius: BorderRadius.circular(2),
                  ),
                ),
              ),
              ModalHeader(
                title: l10n.addTitle,
                onClose: () => Navigator.pop(context),
              ),
              SheetTabBar(
                tabs: [l10n.addTabSearch, l10n.addTabManual, l10n.addTabBulk],
                selectedIndex: _tabs.index,
                onChanged: (i) {
                  _tabs.animateTo(i);
                  setState(() {});
                },
              ),
              Expanded(
                child: TabBarView(
                  controller: _tabs,
                  children: [
                    _SearchTab(
                      l10n: l10n,
                      searchController: _searchController,
                      searchType: _searchType,
                      results: _results,
                      searching: _searching || _loadingDetails,
                      statusKey: _statusKey,
                      statusError: _statusError,
                      addedKeys: _addedKeys,
                      addingKeys: _addingKeys,
                      onSearchTypeChanged: (value) {
                        setState(() => _searchType = value);
                        _queueSearch();
                      },
                      onQueryChanged: (_) => _queueSearch(),
                      onPick: _pickResult,
                      onDirectAdd: _directAdd,
                    ),
                    _ManualTab(
                      l10n: l10n,
                      initialContentType: widget.initialContentType,
                      onSave: widget.onSave,
                    ),
                    BulkAddTab(
                      l10n: l10n,
                      scrollController: scrollController,
                      existingItems: widget.existingItems,
                      onSaveBulk: widget.onSaveBulk,
                    ),
                  ],
                ),
              ),
            ],
          );
        },
      ),
    );
  }
}

class _SearchTab extends StatelessWidget {
  const _SearchTab({
    required this.l10n,
    required this.searchController,
    required this.searchType,
    required this.results,
    required this.searching,
    required this.statusKey,
    required this.statusError,
    required this.addedKeys,
    required this.addingKeys,
    required this.onSearchTypeChanged,
    required this.onQueryChanged,
    required this.onPick,
    required this.onDirectAdd,
  });

  final L10n l10n;
  final TextEditingController searchController;
  final String searchType;
  final List<TitleSearchResult> results;
  final bool searching;
  final String? statusKey;
  final bool statusError;
  final Set<String> addedKeys;
  final Set<String> addingKeys;
  final ValueChanged<String> onSearchTypeChanged;
  final ValueChanged<String> onQueryChanged;
  final ValueChanged<TitleSearchResult> onPick;
  final ValueChanged<TitleSearchResult> onDirectAdd;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        // ── Sticky controls (never scroll) ──────────────────────
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              ValueListenableBuilder<TextEditingValue>(
                valueListenable: searchController,
                builder: (context, value, _) {
                  return TextField(
                    controller: searchController,
                    autofocus: true,
                    decoration: InputDecoration(
                      hintText: l10n.titleSearchPlaceholder,
                      prefixIcon: const Icon(Icons.search),
                      suffixIcon: searching
                          ? const Padding(
                              padding: EdgeInsets.all(12),
                              child: SizedBox(
                                width: 18,
                                height: 18,
                                child:
                                    CircularProgressIndicator(strokeWidth: 2),
                              ),
                            )
                          : value.text.isNotEmpty
                              ? IconButton(
                                  icon: const Icon(Icons.close),
                                  tooltip: l10n.titleSearchClear,
                                  onPressed: () {
                                    searchController.clear();
                                    onQueryChanged('');
                                  },
                                )
                              : null,
                    ),
                    onChanged: onQueryChanged,
                  );
                },
              ),
              const SizedBox(height: 10),
              _SearchTypeChips(
                value: searchType,
                onChanged: onSearchTypeChanged,
                l10n: l10n,
              ),
              if (statusKey != null) ...[
                const SizedBox(height: 8),
                Text(
                  _statusMessage(l10n, statusKey!),
                  style: TextStyle(
                    fontSize: 12,
                    color: statusError
                        ? Theme.of(context).colorScheme.error
                        : Theme.of(context)
                            .colorScheme
                            .onSurface
                            .withValues(alpha: 0.55),
                  ),
                ),
              ],
              const SizedBox(height: 8),
            ],
          ),
        ),
        // ── Scrollable results ───────────────────────────────────
        Expanded(
          child: ListView.separated(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
            itemCount: results.length,
            separatorBuilder: (_, __) => const SizedBox(height: 6),
            itemBuilder: (context, i) {
              final result = results[i];
              final key = result.dedupeKey();
              return _ResultRow(
                l10n: l10n,
                result: result,
                isAdded: addedKeys.contains(key),
                isAdding: addingKeys.contains(key),
                onPick: onPick,
                onDirectAdd: onDirectAdd,
              );
            },
          ),
        ),
      ],
    );
  }

  String _statusMessage(L10n l10n, String key) {
    if (key.startsWith('search.foundMany:')) {
      final count = int.tryParse(key.split(':').last) ?? 0;
      return l10n.searchFoundMany(count);
    }
    if (key.startsWith('search.addedStatus:')) {
      final title = key.substring('search.addedStatus:'.length);
      return '${l10n.message("search.added")}: $title';
    }
    return l10n.message(key);
  }
}

class _ResultPoster extends StatelessWidget {
  const _ResultPoster({
    required this.l10n,
    required this.poster,
    this.title = '',
  });

  final L10n l10n;
  final String poster;
  final String title;

  @override
  Widget build(BuildContext context) {
    if (poster.startsWith('http')) {
      return GestureDetector(
        onTap: () => showPosterLightbox(
          context,
          imageUrl: poster,
          semanticsLabel: title.isNotEmpty
              ? l10n.detailViewPoster(title)
              : null,
        ),
        child: ClipRRect(
          borderRadius: BorderRadius.circular(4),
          child: CachedNetworkImage(
            imageUrl: poster,
            width: 44,
            height: 66,
            fit: BoxFit.cover,
            errorWidget: (_, __, ___) => const _PosterPlaceholder(),
          ),
        ),
      );
    }
    return const _PosterPlaceholder();
  }
}

class _PosterPlaceholder extends StatelessWidget {
  const _PosterPlaceholder();

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 44,
      height: 66,
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surfaceContainerHighest,
        borderRadius: BorderRadius.circular(4),
      ),
      child: const Icon(Icons.movie_outlined, size: 20),
    );
  }
}

class _ResultRow extends StatelessWidget {
  const _ResultRow({
    required this.l10n,
    required this.result,
    required this.isAdded,
    required this.isAdding,
    required this.onPick,
    required this.onDirectAdd,
  });

  final L10n l10n;
  final TitleSearchResult result;
  final bool isAdded;
  final bool isAdding;
  final ValueChanged<TitleSearchResult> onPick;
  final ValueChanged<TitleSearchResult> onDirectAdd;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final onSurface = theme.colorScheme.onSurface;
    final accent = theme.colorScheme.primary;
    final addedColor = const Color(0xFF22C55E);

    final borderColor = isAdded
        ? addedColor.withValues(alpha: 0.25)
        : onSurface.withValues(alpha: 0.1);

    return Container(
      decoration: BoxDecoration(
        color: isAdded
            ? addedColor.withValues(alpha: 0.06)
            : onSurface.withValues(alpha: 0.03),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: borderColor),
      ),
      clipBehavior: Clip.antiAlias,
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // Main info area (tappable for confirm step)
          Expanded(
            child: GestureDetector(
              behavior: HitTestBehavior.opaque,
              onTap: isAdded ? null : () => onPick(result),
              child: Padding(
                padding: const EdgeInsets.all(10),
                child: Row(
                  children: [
                    _ResultPoster(
                      l10n: l10n,
                      poster: result.poster,
                      title: result.title,
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            result.title,
                            style: TextStyle(
                              fontWeight: FontWeight.w500,
                              fontSize: 14,
                              color: isAdded
                                  ? onSurface.withValues(alpha: 0.5)
                                  : null,
                            ),
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                          ),
                          if (result.year.isNotEmpty) ...[
                            const SizedBox(height: 3),
                            Text(
                              result.year,
                              style: TextStyle(
                                fontSize: 12,
                                color: onSurface.withValues(alpha: 0.45),
                              ),
                            ),
                          ],
                          if (isAdded) ...[
                            const SizedBox(height: 3),
                            Text(
                              'Added',
                              style: TextStyle(
                                fontSize: 11,
                                fontWeight: FontWeight.w600,
                                color: addedColor,
                              ),
                            ),
                          ],
                        ],
                      ),
                    ),
                    if (!isAdded && !isAdding)
                      Icon(
                        Icons.chevron_right,
                        size: 18,
                        color: onSurface.withValues(alpha: 0.3),
                      ),
                  ],
                ),
              ),
            ),
          ),
          // Vertical divider + add/status button — inside the box
          Container(width: 1, color: borderColor),
          SizedBox(
            width: 48,
            child: isAdded
                ? Center(
                    child: Icon(Icons.check_circle_rounded,
                        size: 22, color: addedColor),
                  )
                : isAdding
                    ? const Center(
                        child: SizedBox(
                          width: 20,
                          height: 20,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        ),
                      )
                    : IconButton(
                        padding: EdgeInsets.zero,
                        icon: Icon(Icons.add, size: 22, color: accent),
                        onPressed: () => onDirectAdd(result),
                      ),
          ),
        ],
      ),
    );
  }
}

class _SearchTypeChips extends StatelessWidget {
  const _SearchTypeChips({
    required this.value,
    required this.onChanged,
    required this.l10n,
  });

  final String value;
  final ValueChanged<String> onChanged;
  final L10n l10n;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final onSurface = theme.colorScheme.onSurface;
    final accent = theme.colorScheme.primary;

    final options = [
      ('all', l10n.titleSearchTypeAll),
      ('movie', l10n.typeMovies),
      ('series', l10n.typeTv),
      ('anime', l10n.typeAnime),
    ];

    return Wrap(
      spacing: 6,
      runSpacing: 6,
      children: options.map((opt) {
        final active = value == opt.$1;
        return GestureDetector(
          onTap: () => onChanged(opt.$1),
          child: AnimatedContainer(
            duration: const Duration(milliseconds: 120),
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
            decoration: BoxDecoration(
              color: active
                  ? accent.withValues(alpha: 0.15)
                  : onSurface.withValues(alpha: 0.06),
              borderRadius: BorderRadius.circular(16),
              border: Border.all(
                color: active
                    ? accent.withValues(alpha: 0.5)
                    : onSurface.withValues(alpha: 0.1),
              ),
            ),
            child: Text(
              opt.$2,
              style: TextStyle(
                fontSize: 12,
                fontWeight: active ? FontWeight.w600 : FontWeight.w400,
                color: active ? accent : onSurface.withValues(alpha: 0.65),
              ),
            ),
          ),
        );
      }).toList(),
    );
  }
}

class _ConfirmStep extends StatelessWidget {
  const _ConfirmStep({
    required this.l10n,
    required this.scrollController,
    required this.details,
    required this.contentType,
    required this.genre,
    required this.secondaryGenres,
    required this.saving,
    required this.errorKey,
    required this.onContentTypeChanged,
    required this.onGenreChanged,
    required this.onAddSecondaryGenre,
    required this.onRemoveSecondaryGenre,
    required this.onBack,
    required this.onSave,
  });

  final L10n l10n;
  final ScrollController scrollController;
  final MetadataDetail details;
  final String contentType;
  final String genre;
  final List<String> secondaryGenres;
  final bool saving;
  final String? errorKey;
  final ValueChanged<String> onContentTypeChanged;
  final ValueChanged<String> onGenreChanged;
  final ValueChanged<String> onAddSecondaryGenre;
  final ValueChanged<String> onRemoveSecondaryGenre;
  final VoidCallback onBack;
  final VoidCallback onSave;

  @override
  Widget build(BuildContext context) {
    final taken = {genre, ...secondaryGenres};
    final availableSecondary =
        standardGenres.where((g) => !taken.contains(g)).toList();

    return Column(
      children: [
        Center(
          child: Container(
            margin: const EdgeInsets.only(top: 10, bottom: 4),
            width: 36,
            height: 4,
            decoration: BoxDecoration(
              color: Theme.of(context)
                  .colorScheme
                  .onSurface
                  .withValues(alpha: 0.2),
              borderRadius: BorderRadius.circular(2),
            ),
          ),
        ),
        ModalHeader(title: l10n.searchConfirmTitle),
        Expanded(
          child: ListView(
            controller: scrollController,
            padding: const EdgeInsets.fromLTRB(20, 8, 20, 8),
            children: [
              if (details.poster.startsWith('http'))
                GestureDetector(
                  onTap: () => showPosterLightbox(
                    context,
                    imageUrl: details.poster,
                    semanticsLabel: l10n.detailViewPoster(details.title),
                  ),
                  child: ClipRRect(
                    borderRadius: BorderRadius.circular(8),
                    child: CachedNetworkImage(
                      imageUrl: details.poster,
                      height: 180,
                      width: double.infinity,
                      fit: BoxFit.cover,
                    ),
                  ),
                ),
              const SizedBox(height: 12),
              Text(details.title,
                  style: Theme.of(context).textTheme.titleMedium),
              if (details.year.isNotEmpty ||
                  titleMetaBadgesFromDetail(details).isNotEmpty) ...[
                const SizedBox(height: 6),
                Wrap(
                  spacing: 8,
                  runSpacing: 4,
                  crossAxisAlignment: WrapCrossAlignment.center,
                  children: [
                    if (details.year.isNotEmpty)
                      ContentYearBadge(label: details.year),
                    ContentTitleMetaBadges(
                      contentType: details.contentType,
                      ageRating: details.ageRating,
                      runtime: details.runtime,
                      seasonCount: details.seasonCount,
                      episodeCount: details.episodeCount,
                    ),
                  ],
                ),
              ],
              if (details.plot.isNotEmpty) ...[
                const SizedBox(height: 12),
                Text(details.plot),
              ],
              const SizedBox(height: 16),
              Text(l10n.fieldType,
                  style: Theme.of(context).textTheme.labelLarge),
              const SizedBox(height: 8),
              ContentTypePicker(
                value: contentType,
                movies: l10n.typeMovies,
                tv: l10n.typeTv,
                anime: l10n.typeAnime,
                onChanged: onContentTypeChanged,
              ),
              const SizedBox(height: 12),
              DropdownButtonFormField<String>(
                initialValue: genre,
                decoration: InputDecoration(labelText: l10n.fieldGenre),
                items: standardGenres
                    .map((g) => DropdownMenuItem(
                          value: g,
                          child: Text(l10n.genreLabel(g)),
                        ))
                    .toList(),
                onChanged: (value) {
                  if (value != null) onGenreChanged(value);
                },
              ),
              const SizedBox(height: 12),
              DropdownButtonFormField<String>(
                key: ValueKey('secondary-$genre-${secondaryGenres.join(',')}'),
                decoration:
                    InputDecoration(labelText: l10n.fieldSecondaryGenres),
                hint: Text(l10n.fieldAddSecondaryGenre),
                initialValue: null,
                items: availableSecondary
                    .map(
                      (g) => DropdownMenuItem(
                        value: g,
                        child: Text(l10n.genreLabel(g)),
                      ),
                    )
                    .toList(),
                onChanged: availableSecondary.isEmpty
                    ? null
                    : (value) {
                        if (value != null) onAddSecondaryGenre(value);
                      },
              ),
              if (secondaryGenres.isNotEmpty) ...[
                const SizedBox(height: 8),
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: secondaryGenres
                      .map(
                        (g) => InputChip(
                          label: Text(l10n.genreLabel(g)),
                          onDeleted: () => onRemoveSecondaryGenre(g),
                        ),
                      )
                      .toList(),
                ),
              ],
              if (errorKey != null) ...[
                const SizedBox(height: 12),
                Text(
                  l10n.message(errorKey!),
                  style: TextStyle(color: Theme.of(context).colorScheme.error),
                ),
              ],
            ],
          ),
        ),
        SafeArea(
          top: false,
          child: Padding(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 16),
            child: Row(
              children: [
                TextButton(onPressed: onBack, child: Text(l10n.searchBack)),
                const Spacer(),
                FilledButton(
                  onPressed: saving ? null : onSave,
                  child: saving
                      ? const SizedBox(
                          width: 20,
                          height: 20,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : Text(l10n.addTitle),
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }
}

class _ManualTab extends StatelessWidget {
  const _ManualTab({
    required this.l10n,
    required this.initialContentType,
    required this.onSave,
  });

  final L10n l10n;
  final String initialContentType;
  final Future<String?> Function(WatchlistItem item) onSave;

  @override
  Widget build(BuildContext context) {
    return TitleFormSheet(
      mode: TitleFormMode.add,
      l10n: l10n,
      initialContentType: initialContentType,
      onSave: (item, watch) => onSave(item),
    );
  }
}
