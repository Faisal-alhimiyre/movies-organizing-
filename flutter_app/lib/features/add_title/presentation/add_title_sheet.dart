import 'dart:async';

import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../l10n/l10n.dart';
import '../../../models/metadata_detail.dart';
import '../../../models/title_search_result.dart';
import '../../../models/watchlist_item.dart';
import '../../../repositories/metadata/metadata_service.dart';
import '../../../core/utils/watchlist_parser.dart';
import '../../../repositories/metadata/genre_mapper.dart';
import '../application/build_item_from_metadata.dart';
import '../../watchlist/presentation/widgets/title_form_sheet.dart';

Future<bool?> showAddTitleSheet(
  BuildContext context, {
  required L10n l10n,
  required String initialContentType,
  required List<WatchlistItem> existingItems,
  required Future<String?> Function(WatchlistItem item) onSave,
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
  });

  final L10n l10n;
  final String initialContentType;
  final List<WatchlistItem> existingItems;
  final Future<String?> Function(WatchlistItem item) onSave;

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
  late String _confirmContentType;
  late String _confirmGenre;
  bool _saving = false;
  String? _errorKey;

  @override
  void initState() {
    super.initState();
    _tabs = TabController(length: 2, vsync: this);
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
    final response = await service.searchTitles(query, type: _searchType);

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
    setState(() {
      _loadingDetails = false;
      _confirmDetails = details;
      _confirmContentType = details.contentType;
      _confirmGenre = suggested.isNotEmpty ? suggested.first : standardGenres.first;
      _statusKey = null;
    });
  }

  void _backToSearch() {
    setState(() {
      _confirmDetails = null;
      _errorKey = null;
    });
  }

  Future<void> _confirmAdd() async {
    final details = _confirmDetails;
    if (details == null || _saving) return;

    final item = buildItemFromMetadata(
      details: details,
      contentType: _confirmContentType,
      genre: _confirmGenre,
    );

    if (item.title.isEmpty || item.summary.isEmpty) {
      setState(() => _errorKey = 'search.incomplete');
      return;
    }
    if (item.lead.isEmpty) {
      setState(() => _errorKey = 'search.missingActors');
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
      Navigator.of(context).pop(true);
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
              saving: _saving,
              errorKey: _errorKey,
              onContentTypeChanged: (value) => setState(() => _confirmContentType = value),
              onGenreChanged: (value) => setState(() => _confirmGenre = value),
              onBack: _backToSearch,
              onSave: _confirmAdd,
            );
          }

          return Column(
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 8, 8, 0),
                child: Row(
                  children: [
                    Expanded(
                      child: Text(
                        l10n.addTitle,
                        style: Theme.of(context).textTheme.titleLarge,
                      ),
                    ),
                    IconButton(
                      onPressed: () => Navigator.pop(context),
                      icon: const Icon(Icons.close),
                    ),
                  ],
                ),
              ),
              TabBar(
                controller: _tabs,
                tabs: [
                  Tab(text: l10n.addTabSearch),
                  Tab(text: l10n.addTabManual),
                ],
              ),
              Expanded(
                child: TabBarView(
                  controller: _tabs,
                  children: [
                    _SearchTab(
                      l10n: l10n,
                      scrollController: scrollController,
                      searchController: _searchController,
                      searchType: _searchType,
                      results: _results,
                      searching: _searching || _loadingDetails,
                      statusKey: _statusKey,
                      statusError: _statusError,
                      onSearchTypeChanged: (value) {
                        setState(() => _searchType = value);
                        _queueSearch();
                      },
                      onQueryChanged: (_) => _queueSearch(),
                      onPick: _pickResult,
                    ),
                    _ManualTab(
                      l10n: l10n,
                      initialContentType: widget.initialContentType,
                      onSave: widget.onSave,
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
    required this.scrollController,
    required this.searchController,
    required this.searchType,
    required this.results,
    required this.searching,
    required this.statusKey,
    required this.statusError,
    required this.onSearchTypeChanged,
    required this.onQueryChanged,
    required this.onPick,
  });

  final L10n l10n;
  final ScrollController scrollController;
  final TextEditingController searchController;
  final String searchType;
  final List<TitleSearchResult> results;
  final bool searching;
  final String? statusKey;
  final bool statusError;
  final ValueChanged<String> onSearchTypeChanged;
  final ValueChanged<String> onQueryChanged;
  final ValueChanged<TitleSearchResult> onPick;

  @override
  Widget build(BuildContext context) {
    return ListView(
      controller: scrollController,
      padding: const EdgeInsets.all(16),
      children: [
        TextField(
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
                      child: CircularProgressIndicator(strokeWidth: 2),
                    ),
                  )
                : null,
          ),
          onChanged: onQueryChanged,
        ),
        const SizedBox(height: 12),
        DropdownButtonFormField<String>(
          value: searchType,
          decoration: InputDecoration(labelText: l10n.titleSearchType),
          items: [
            DropdownMenuItem(value: 'all', child: Text(l10n.titleSearchTypeAll)),
            DropdownMenuItem(value: 'movie', child: Text(l10n.typeMovies)),
            DropdownMenuItem(value: 'series', child: Text(l10n.typeTv)),
            DropdownMenuItem(value: 'anime', child: Text(l10n.typeAnime)),
          ],
          onChanged: (value) {
            if (value != null) onSearchTypeChanged(value);
          },
        ),
        if (statusKey != null) ...[
          const SizedBox(height: 12),
          Text(
            _statusMessage(l10n, statusKey!),
            style: TextStyle(
              color: statusError ? Theme.of(context).colorScheme.error : null,
            ),
          ),
        ],
        const SizedBox(height: 12),
        ...results.map(
          (result) => Card(
            margin: const EdgeInsets.only(bottom: 8),
            child: ListTile(
              leading: _ResultPoster(poster: result.poster),
              title: Text(result.title),
              subtitle: result.year.isNotEmpty ? Text(result.year) : null,
              onTap: () => onPick(result),
            ),
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
    return l10n.message(key);
  }
}

class _ResultPoster extends StatelessWidget {
  const _ResultPoster({required this.poster});

  final String poster;

  @override
  Widget build(BuildContext context) {
    if (poster.startsWith('http')) {
      return ClipRRect(
        borderRadius: BorderRadius.circular(4),
        child: CachedNetworkImage(
          imageUrl: poster,
          width: 44,
          height: 66,
          fit: BoxFit.cover,
          errorWidget: (_, __, ___) => const _PosterPlaceholder(),
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
      color: Theme.of(context).colorScheme.surfaceContainerHighest,
      child: const Icon(Icons.movie_outlined, size: 20),
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
    required this.saving,
    required this.errorKey,
    required this.onContentTypeChanged,
    required this.onGenreChanged,
    required this.onBack,
    required this.onSave,
  });

  final L10n l10n;
  final ScrollController scrollController;
  final MetadataDetail details;
  final String contentType;
  final String genre;
  final bool saving;
  final String? errorKey;
  final ValueChanged<String> onContentTypeChanged;
  final ValueChanged<String> onGenreChanged;
  final VoidCallback onBack;
  final VoidCallback onSave;

  @override
  Widget build(BuildContext context) {
    return ListView(
      controller: scrollController,
      padding: const EdgeInsets.all(16),
      children: [
        Row(
          children: [
            IconButton(onPressed: onBack, icon: const Icon(Icons.arrow_back)),
            Expanded(
              child: Text(
                l10n.searchConfirmTitle,
                style: Theme.of(context).textTheme.titleLarge,
              ),
            ),
          ],
        ),
        const SizedBox(height: 8),
        if (details.poster.startsWith('http'))
          ClipRRect(
            borderRadius: BorderRadius.circular(8),
            child: CachedNetworkImage(
              imageUrl: details.poster,
              height: 180,
              width: double.infinity,
              fit: BoxFit.cover,
            ),
          ),
        const SizedBox(height: 12),
        Text(details.title, style: Theme.of(context).textTheme.titleMedium),
        if (details.year.isNotEmpty) ...[
          const SizedBox(height: 4),
          Text(details.year),
        ],
        if (details.plot.isNotEmpty) ...[
          const SizedBox(height: 12),
          Text(details.plot),
        ],
        const SizedBox(height: 16),
        DropdownButtonFormField<String>(
          value: contentType,
          decoration: InputDecoration(labelText: l10n.fieldType),
          items: [
            DropdownMenuItem(value: 'movies', child: Text(l10n.typeMovies)),
            DropdownMenuItem(value: 'tvSeries', child: Text(l10n.typeTv)),
            DropdownMenuItem(value: 'anime', child: Text(l10n.typeAnime)),
          ],
          onChanged: (value) {
            if (value != null) onContentTypeChanged(value);
          },
        ),
        const SizedBox(height: 12),
        DropdownButtonFormField<String>(
          value: genre,
          decoration: InputDecoration(labelText: l10n.fieldGenre),
          items: standardGenres
              .map((g) => DropdownMenuItem(value: g, child: Text(g)))
              .toList(),
          onChanged: (value) {
            if (value != null) onGenreChanged(value);
          },
        ),
        if (errorKey != null) ...[
          const SizedBox(height: 12),
          Text(
            l10n.message(errorKey!),
            style: TextStyle(color: Theme.of(context).colorScheme.error),
          ),
        ],
        const SizedBox(height: 20),
        FilledButton(
          onPressed: saving ? null : onSave,
          child: saving
              ? const SizedBox(
                  width: 20,
                  height: 20,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : Text(l10n.btnSave),
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
