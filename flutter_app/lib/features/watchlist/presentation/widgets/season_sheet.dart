import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../app/theme/theme_extensions.dart';
import '../../../../core/utils/watch_progress.dart';
import '../../../../l10n/l10n.dart';
import '../../../../models/series_metadata.dart';
import '../../../../models/watchlist_item.dart';
import '../../../../repositories/metadata/series_metadata_service.dart';
import '../../application/watchlist_controller.dart';

// ─────────────────────────────────────────────────────────────────────────────
// Public entry point
// ─────────────────────────────────────────────────────────────────────────────

/// Opens the season/episode sheet for a TV series or anime item.
Future<void> showSeasonSheet(
  BuildContext context, {
  required L10n l10n,
  required WatchlistItem item,
  required WatchEntry? watched,
}) {
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    backgroundColor: Colors.transparent,
    builder: (ctx) => SeasonSheet(l10n: l10n, item: item, watched: watched),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Season sheet — full height bottom sheet with season list + episode list
// ─────────────────────────────────────────────────────────────────────────────

class SeasonSheet extends ConsumerStatefulWidget {
  const SeasonSheet({
    super.key,
    required this.l10n,
    required this.item,
    required this.watched,
  });

  final L10n l10n;
  final WatchlistItem item;
  final WatchEntry? watched;

  @override
  ConsumerState<SeasonSheet> createState() => _SeasonSheetState();
}

class _SeasonSheetState extends ConsumerState<SeasonSheet> {
  SeriesIdResolution? _resolution;
  SeriesMetadataResult? _series;
  SeasonEpisodesResult? _episodes;
  int? _selectedSeasonNum;
  bool _loadingId = true;
  bool _loadingSeries = false;
  bool _loadingEpisodes = false;
  bool _noSpecials = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _noSpecials = widget.item.noSpecials == true;
    _selectedSeasonNum = widget.item.selectedSeason;
    _resolveAndLoad();
  }

  Future<void> _resolveAndLoad() async {
    final svc = ref.read(seriesMetadataServiceProvider);
    final resolution = await svc.resolveSeriesId(widget.item);

    if (!mounted) return;
    setState(() {
      _resolution = resolution;
      _loadingId = false;
    });

    if (!resolution.hasUsableSource) {
      setState(() => _error = 'no_id');
      return;
    }

    await _loadSeries(resolution);
  }

  Future<void> _loadSeries(SeriesIdResolution resolution) async {
    setState(() => _loadingSeries = true);
    final svc = ref.read(seriesMetadataServiceProvider);
    final locale = widget.l10n.isArabic ? 'ar' : 'en';

    final result = await svc.fetchSeriesMetadata(
      resolution: resolution,
      locale: locale,
      fallbackPoster: widget.item.poster,
    );

    if (!mounted) return;
    setState(() {
      _series = result;
      _loadingSeries = false;
    });

    final seasons = _visibleSeasons(result.seasons ?? []);
    if (seasons.isEmpty) return;

    // Auto-select first season or last-used season.
    final target = _selectedSeasonNum;
    final autoSelect = target != null &&
            seasons.any((s) => s.seasonNumber == target)
        ? target
        : seasons.first.seasonNumber;

    await _selectSeason(autoSelect);
  }

  List<SeasonSummary> _visibleSeasons(List<SeasonSummary> all) {
    if (_noSpecials) return all.where((s) => s.isRegular).toList();
    return all;
  }

  Future<void> _selectSeason(int seasonNumber) async {
    final resolution = _resolution;
    if (resolution == null || !resolution.hasUsableSource) return;

    if (_selectedSeasonNum == seasonNumber && _episodes != null) return;

    setState(() {
      _selectedSeasonNum = seasonNumber;
      _episodes = null;
      _loadingEpisodes = true;
    });

    final svc = ref.read(seriesMetadataServiceProvider);
    final locale = widget.l10n.isArabic ? 'ar' : 'en';
    final seasonSummary = _series?.seasons
        ?.firstWhere((s) => s.seasonNumber == seasonNumber, orElse: () {
      return SeasonSummary(
        source: resolution.source,
        seasonNumber: seasonNumber,
        name: widget.l10n.progressSeason(seasonNumber),
      );
    });

    final result = await svc.fetchSeasonEpisodes(
      resolution: resolution,
      seasonNumber: seasonNumber,
      locale: locale,
      fallbackPoster: widget.item.poster,
      seasonSummary: seasonSummary,
    );

    if (!mounted) return;
    setState(() {
      _episodes = result;
      _loadingEpisodes = false;
    });

    // Persist the selected season on the watchlist item.
    _persistSelectedSeason(seasonNumber, seasonSummary?.name);
  }

  void _persistSelectedSeason(int seasonNumber, String? name) {
    final snapshot = ref.read(watchlistControllerProvider).value;
    if (snapshot == null) return;
    final index =
        snapshot.items.indexWhere((i) => i.id == widget.item.id);
    if (index == -1) return;

    final current = snapshot.items[index];
    final updated = WatchlistItem(
      id: current.id,
      contentType: current.contentType,
      genre: current.genre,
      title: current.title,
      lead: current.lead,
      summary: current.summary,
      kind: current.kind,
      link: current.link,
      poster: current.poster,
      cardPoster: current.cardPoster,
      selectedSeason: seasonNumber,
      selectedSeasonName:
          name ?? widget.l10n.progressSeason(seasonNumber),
      noSpecials: current.noSpecials,
      imdbRating: current.imdbRating,
      anilistRating: current.anilistRating,
      ageRating: current.ageRating,
      runtime: current.runtime,
      seasonCount: current.seasonCount,
      episodeCount: current.episodeCount,
      year: current.year,
      addedAt: current.addedAt,
      secondaryGenres: current.secondaryGenres,
    );

    ref.read(watchlistControllerProvider.notifier).upsertItem(updated);
  }

  Future<void> _handleToggleEpisode(EpisodeDetail ep, bool nowWatched) async {
    final controller = ref.read(watchlistControllerProvider.notifier);
    final snapshot = ref.read(watchlistControllerProvider).value;
    if (snapshot == null) return;

    final entry = snapshot.watched[widget.item.id];
    final allSeasons = _series?.seasons ?? [];
    final allSeasonRefs = allSeasons
        .where((s) => _noSpecials ? s.isRegular : true)
        .map((s) => SeasonRef(
              seasonNumber: s.seasonNumber,
              episodes: [
                for (var i = 1; i <= (s.episodeCount ?? 0); i++)
                  EpisodeRef(seasonNumber: s.seasonNumber, episodeNumber: i),
              ],
            ))
        .toList();

    final allAiredKeys = airedEpisodeKeysForSeasons(allSeasonRefs);

    WatchEntry updated;
    if (nowWatched) {
      updated = markEpisodeWatched(
        entry,
        ep.seasonNumber,
        ep.episodeNumber,
        allAiredKeys: allAiredKeys,
      );
    } else {
      updated = unmarkEpisodeWatched(
        entry,
        ep.seasonNumber,
        ep.episodeNumber,
        allAiredKeys: allAiredKeys,
      );
    }

    // Recompute `completed` after toggling.
    updated = _withCompletedFlag(updated, allSeasonRefs);

    final newWatched = Map<String, WatchEntry>.from(snapshot.watched);
    newWatched[widget.item.id] = updated;

    await controller.replaceItems(
      snapshot.items,
      watched: newWatched,
    );
    setState(() {}); // trigger rebuild to update checkboxes
  }

  Future<void> _handleMarkSeason(SeasonSummary season, bool watched) async {
    final controller = ref.read(watchlistControllerProvider.notifier);
    final snapshot = ref.read(watchlistControllerProvider).value;
    if (snapshot == null) return;

    final episodes = _episodes?.episodes ?? [];
    final allSeasons = _series?.seasons ?? [];
    final entry = snapshot.watched[widget.item.id];
    final seasonRef = _seasonRefFromEpisodes(season.seasonNumber, episodes);
    final allSeasonRefs = _allSeasonRefs(allSeasons);
    final allAiredKeys = airedEpisodeKeysForSeasons(allSeasonRefs);

    WatchEntry updated;
    if (watched) {
      updated = markSeasonWatched(entry, seasonRef);
    } else {
      updated =
          unmarkSeasonWatched(entry, seasonRef, allAiredKeys: allAiredKeys);
    }

    updated = _withCompletedFlag(updated, allSeasonRefs);

    final newWatched = Map<String, WatchEntry>.from(snapshot.watched);
    newWatched[widget.item.id] = updated;

    await controller.replaceItems(snapshot.items, watched: newWatched);
    setState(() {});
  }

  /// Recompute the `completed` flag on a WatchEntry without needing all episode
  /// data loaded: if all aired regular-season episodes are in the progress list,
  /// set completed to true.
  WatchEntry _withCompletedFlag(
    WatchEntry entry,
    List<SeasonRef> allSeasonRefs,
  ) {
    if (entry.isLegacyComplete) return entry;
    final progress = entry.progress;
    if (progress == null) return entry;

    final regularSeasons = allSeasonRefs.where((s) => s.isRegular).toList();
    if (regularSeasons.isEmpty) return entry;

    final airedKeys = airedEpisodeKeysForSeasons(regularSeasons);
    if (airedKeys.isEmpty) return entry;

    final allWatched = airedKeys.every((k) => progress.episodes.contains(k));

    // Build updated seasonTotals map for display on cards (X/Y label).
    final seasonTotals = <String, int>{};
    for (final s in regularSeasons) {
      final count = s.airedEpisodes.length;
      if (count > 0) seasonTotals[s.seasonNumber.toString()] = count;
    }

    return WatchEntry(
      rating: entry.rating,
      note: entry.note,
      progress: WatchProgress(
        version: WatchProgress.currentVersion,
        episodes: progress.episodes,
        completed: allWatched,
        seasonTotals: seasonTotals,
        episodeRatings: progress.episodeRatings,
      ),
    );
  }

  SeasonRef _seasonRefFromEpisodes(
      int seasonNumber, List<EpisodeDetail> episodes) {
    return SeasonRef(
      seasonNumber: seasonNumber,
      episodes: episodes
          .where((e) => e.seasonNumber == seasonNumber)
          .map((e) => EpisodeRef(
                seasonNumber: e.seasonNumber,
                episodeNumber: e.episodeNumber,
                airDate: e.airDate != null
                    ? DateTime.tryParse(e.airDate!)
                    : null,
              ))
          .toList(),
    );
  }

  List<SeasonRef> _allSeasonRefs(List<SeasonSummary> seasons) {
    final visible = _noSpecials
        ? seasons.where((s) => s.isRegular).toList()
        : seasons;
    return visible
        .map((s) => SeasonRef(
              seasonNumber: s.seasonNumber,
              episodes: [
                for (var i = 1; i <= (s.episodeCount ?? 0); i++)
                  EpisodeRef(
                      seasonNumber: s.seasonNumber, episodeNumber: i),
              ],
            ))
        .toList();
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final tc = theme.extension<AppTypeColors>();
    final l10n = widget.l10n;

    // Listen for live updates from the watchlist.
    final snapshot = ref.watch(watchlistControllerProvider).value;
    final liveEntry = snapshot?.watched[widget.item.id];

    return DraggableScrollableSheet(
      initialChildSize: 0.92,
      minChildSize: 0.4,
      maxChildSize: 0.95,
      builder: (ctx, scrollController) {
        return Material(
          color: theme.colorScheme.surfaceContainerHigh,
          borderRadius: const BorderRadius.vertical(top: Radius.circular(16)),
          clipBehavior: Clip.antiAlias,
          child: Column(
            children: [
              // ── Drag handle ───────────────────────────────────────────
              Center(
                child: Padding(
                  padding: const EdgeInsets.only(top: 10, bottom: 4),
                  child: Container(
                    width: 36,
                    height: 4,
                    decoration: BoxDecoration(
                      color: theme.colorScheme.onSurface.withValues(alpha: 0.2),
                      borderRadius: BorderRadius.circular(2),
                    ),
                  ),
                ),
              ),

              // ── Header ────────────────────────────────────────────────
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 4, 12, 8),
                child: Row(
                  children: [
                    Expanded(
                      child: Text(
                        widget.item.title,
                        style: theme.textTheme.titleMedium?.copyWith(
                          fontWeight: FontWeight.w700,
                        ),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                    if (!_noSpecials &&
                        (_series?.seasons ?? [])
                            .any((s) => s.isSpecials))
                      _SpecialsToggle(
                        hidden: _noSpecials,
                        onChanged: (hide) async {
                          setState(() => _noSpecials = hide);
                          // Persist noSpecials on the item.
                          final cur = ref
                              .read(watchlistControllerProvider)
                              .value
                              ?.items
                              .firstWhere(
                                (i) => i.id == widget.item.id,
                                orElse: () => widget.item,
                              );
                          if (cur == null) return;
                          final upd = WatchlistItem(
                            id: cur.id,
                            contentType: cur.contentType,
                            genre: cur.genre,
                            title: cur.title,
                            lead: cur.lead,
                            summary: cur.summary,
                            kind: cur.kind,
                            link: cur.link,
                            poster: cur.poster,
                            cardPoster: cur.cardPoster,
                            selectedSeason: cur.selectedSeason,
                            selectedSeasonName: cur.selectedSeasonName,
                            noSpecials: hide,
                            imdbRating: cur.imdbRating,
                            anilistRating: cur.anilistRating,
                            ageRating: cur.ageRating,
                            runtime: cur.runtime,
                            seasonCount: cur.seasonCount,
                            episodeCount: cur.episodeCount,
                            year: cur.year,
                            addedAt: cur.addedAt,
                            secondaryGenres: cur.secondaryGenres,
                          );
                          await ref
                              .read(watchlistControllerProvider.notifier)
                              .upsertItem(upd);
                        },
                      ),
                    IconButton(
                      icon: const Icon(Icons.close),
                      onPressed: () => Navigator.pop(ctx),
                      visualDensity: VisualDensity.compact,
                    ),
                  ],
                ),
              ),

              const Divider(height: 1),

              // ── Content ───────────────────────────────────────────────
              Expanded(
                child: _loadingId || _loadingSeries
                    ? const Center(child: CircularProgressIndicator())
                    : _error != null ||
                            !(_resolution?.hasUsableSource ?? false)
                        ? _NoIdMessage(l10n: l10n)
                        : _series == null || !_series!.isUsable
                            ? _NoDataMessage(l10n: l10n)
                            : _SeasonContent(
                                l10n: l10n,
                                tc: tc,
                                theme: theme,
                                series: _series!,
                                episodes: _episodes,
                                selectedSeasonNum: _selectedSeasonNum,
                                noSpecials: _noSpecials,
                                entry: liveEntry,
                                loadingEpisodes: _loadingEpisodes,
                                scrollController: scrollController,
                                onSeasonSelected: _selectSeason,
                                onToggleEpisode: _handleToggleEpisode,
                                onMarkSeason: _handleMarkSeason,
                              ),
              ),
            ],
          ),
        );
      },
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main scrollable content: season carousel + episode list
// ─────────────────────────────────────────────────────────────────────────────

class _SeasonContent extends StatelessWidget {
  const _SeasonContent({
    required this.l10n,
    required this.tc,
    required this.theme,
    required this.series,
    required this.episodes,
    required this.selectedSeasonNum,
    required this.noSpecials,
    required this.entry,
    required this.loadingEpisodes,
    required this.scrollController,
    required this.onSeasonSelected,
    required this.onToggleEpisode,
    required this.onMarkSeason,
  });

  final L10n l10n;
  final AppTypeColors? tc;
  final ThemeData theme;
  final SeriesMetadataResult series;
  final SeasonEpisodesResult? episodes;
  final int? selectedSeasonNum;
  final bool noSpecials;
  final WatchEntry? entry;
  final bool loadingEpisodes;
  final ScrollController scrollController;
  final ValueChanged<int> onSeasonSelected;
  final Future<void> Function(EpisodeDetail, bool) onToggleEpisode;
  final Future<void> Function(SeasonSummary, bool) onMarkSeason;

  List<SeasonSummary> get _visibleSeasons {
    final all = series.seasons ?? [];
    if (noSpecials) return all.where((s) => s.isRegular).toList();
    return all;
  }

  SeasonSummary? get _selectedSeason {
    final num = selectedSeasonNum;
    if (num == null) return null;
    return _visibleSeasons.firstWhere(
      (s) => s.seasonNumber == num,
      orElse: () => _visibleSeasons.first,
    );
  }

  @override
  Widget build(BuildContext context) {
    final visibleSeasons = _visibleSeasons;
    if (visibleSeasons.isEmpty) {
      return _NoDataMessage(l10n: l10n);
    }

    final selSeason = _selectedSeason;

    return CustomScrollView(
      controller: scrollController,
      slivers: [
        // ── Season carousel ───────────────────────────────────────────
        SliverToBoxAdapter(
          child: _SeasonCarousel(
            seasons: visibleSeasons,
            selectedSeasonNum: selectedSeasonNum,
            entry: entry,
            l10n: l10n,
            tc: tc,
            theme: theme,
            onTap: onSeasonSelected,
          ),
        ),

        // ── Season header + mark button ───────────────────────────────
        if (selSeason != null)
          SliverToBoxAdapter(
            child: _SeasonHeader(
              season: selSeason,
              entry: entry,
              episodes: episodes?.episodes ?? [],
              l10n: l10n,
              tc: tc,
              theme: theme,
              onMarkSeason: onMarkSeason,
            ),
          ),

        // ── Episode list ──────────────────────────────────────────────
        if (loadingEpisodes)
          const SliverFillRemaining(
            hasScrollBody: false,
            child: Center(child: CircularProgressIndicator()),
          )
        else if (selSeason != null)
          _EpisodeListSliver(
            season: selSeason,
            episodes: episodes?.episodes ?? [],
            entry: entry,
            l10n: l10n,
            tc: tc,
            theme: theme,
            onToggle: onToggleEpisode,
          ),
      ],
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Season carousel (horizontal scroll of season cards)
// ─────────────────────────────────────────────────────────────────────────────

class _SeasonCarousel extends StatelessWidget {
  const _SeasonCarousel({
    required this.seasons,
    required this.selectedSeasonNum,
    required this.entry,
    required this.l10n,
    required this.tc,
    required this.theme,
    required this.onTap,
  });

  final List<SeasonSummary> seasons;
  final int? selectedSeasonNum;
  final WatchEntry? entry;
  final L10n l10n;
  final AppTypeColors? tc;
  final ThemeData theme;
  final ValueChanged<int> onTap;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 148,
      child: ListView.builder(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.fromLTRB(12, 10, 12, 8),
        itemCount: seasons.length,
        itemBuilder: (ctx, i) {
          final season = seasons[i];
          final isSelected = season.seasonNumber == selectedSeasonNum;
          return Padding(
            padding: const EdgeInsets.only(right: 8),
            child: _SeasonCard(
              season: season,
              isSelected: isSelected,
              entry: entry,
              l10n: l10n,
              tc: tc,
              theme: theme,
              onTap: () => onTap(season.seasonNumber),
            ),
          );
        },
      ),
    );
  }
}

class _SeasonCard extends StatelessWidget {
  const _SeasonCard({
    required this.season,
    required this.isSelected,
    required this.entry,
    required this.l10n,
    required this.tc,
    required this.theme,
    required this.onTap,
  });

  final SeasonSummary season;
  final bool isSelected;
  final WatchEntry? entry;
  final L10n l10n;
  final AppTypeColors? tc;
  final ThemeData theme;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final watchedColor = tc?.watched ?? const Color(0xFF58C322);
    final inProgressColor = tc?.inProgress ?? const Color(0xFFF59E0B);

    final seasonRef = SeasonRef(
      seasonNumber: season.seasonNumber,
      episodes: [
        for (var i = 1; i <= (season.episodeCount ?? 0); i++)
          EpisodeRef(seasonNumber: season.seasonNumber, episodeNumber: i),
      ],
    );

    final isFull = isSeasonFullyWatched(entry, season.seasonNumber, seasonRef);
    final isPartial =
        isSeasonPartiallyWatched(entry, season.seasonNumber, seasonRef);

    Color? badgeFg;
    if (isFull) {
      badgeFg = watchedColor;
    } else if (isPartial) {
      badgeFg = inProgressColor;
    }

    final borderColor = isSelected
        ? (tc?.titleAccent ?? theme.colorScheme.primary)
        : theme.dividerColor;

    return GestureDetector(
      onTap: onTap,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 200),
        width: 78,
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(8),
          border: Border.all(
            color: borderColor,
            width: isSelected ? 1.8 : 1,
          ),
          color: isSelected
              ? theme.colorScheme.surfaceContainerHighest
              : theme.colorScheme.surface,
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            // Poster
            ClipRRect(
              borderRadius:
                  const BorderRadius.vertical(top: Radius.circular(7)),
              child: AspectRatio(
                aspectRatio: 2 / 3,
                child: season.poster.isNotEmpty
                    ? Image.network(
                        season.poster,
                        fit: BoxFit.cover,
                        errorBuilder: (_, __, ___) =>
                            const _PosterPlaceholder(),
                      )
                    : const _PosterPlaceholder(),
              ),
            ),
            // Label
            Padding(
              padding: const EdgeInsets.fromLTRB(4, 3, 4, 3),
              child: Text(
                season.name,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  fontSize: 8.5,
                  fontWeight: isSelected ? FontWeight.w700 : FontWeight.w500,
                  color: badgeFg ?? theme.colorScheme.onSurface,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Season header (name + "Mark season watched" button)
// ─────────────────────────────────────────────────────────────────────────────

class _SeasonHeader extends StatelessWidget {
  const _SeasonHeader({
    required this.season,
    required this.entry,
    required this.episodes,
    required this.l10n,
    required this.tc,
    required this.theme,
    required this.onMarkSeason,
  });

  final SeasonSummary season;
  final WatchEntry? entry;
  final List<EpisodeDetail> episodes;
  final L10n l10n;
  final AppTypeColors? tc;
  final ThemeData theme;
  final Future<void> Function(SeasonSummary, bool) onMarkSeason;

  @override
  Widget build(BuildContext context) {
    final watchedColor = tc?.watched ?? const Color(0xFF58C322);

    final seasonRef = SeasonRef(
      seasonNumber: season.seasonNumber,
      episodes: episodes
          .where((e) => e.seasonNumber == season.seasonNumber)
          .map((e) => EpisodeRef(
                seasonNumber: e.seasonNumber,
                episodeNumber: e.episodeNumber,
                airDate: e.airDate != null
                    ? DateTime.tryParse(e.airDate!)
                    : null,
              ))
          .toList(),
    );

    final isFullyWatched =
        isSeasonFullyWatched(entry, season.seasonNumber, seasonRef);

    return Padding(
      padding: const EdgeInsets.fromLTRB(14, 10, 14, 4),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  season.name,
                  style: theme.textTheme.titleSmall?.copyWith(
                    fontWeight: FontWeight.w700,
                  ),
                ),
                if (season.episodeCount != null)
                  Text(
                    l10n.progressEpisodeCount(season.episodeCount!),
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: theme.colorScheme.onSurface.withValues(alpha: 0.6),
                    ),
                  ),
              ],
            ),
          ),
          const SizedBox(width: 8),
          OutlinedButton.icon(
            onPressed: () => onMarkSeason(season, !isFullyWatched),
            icon: Icon(
              isFullyWatched ? Icons.check_circle : Icons.radio_button_unchecked,
              size: 15,
              color: isFullyWatched ? watchedColor : null,
            ),
            label: Text(
              isFullyWatched
                  ? l10n.progressUnmarkSeasonWatched
                  : l10n.progressMarkSeasonWatched,
              style: TextStyle(
                fontSize: 11,
                color: isFullyWatched ? watchedColor : null,
              ),
            ),
            style: OutlinedButton.styleFrom(
              padding:
                  const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
              minimumSize: const Size(0, 32),
              tapTargetSize: MaterialTapTargetSize.shrinkWrap,
              visualDensity: VisualDensity.compact,
              side: BorderSide(
                color: isFullyWatched
                    ? watchedColor.withValues(alpha: 0.45)
                    : theme.dividerColor,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Episode list sliver
// ─────────────────────────────────────────────────────────────────────────────

class _EpisodeListSliver extends StatelessWidget {
  const _EpisodeListSliver({
    required this.season,
    required this.episodes,
    required this.entry,
    required this.l10n,
    required this.tc,
    required this.theme,
    required this.onToggle,
  });

  final SeasonSummary season;
  final List<EpisodeDetail> episodes;
  final WatchEntry? entry;
  final L10n l10n;
  final AppTypeColors? tc;
  final ThemeData theme;
  final Future<void> Function(EpisodeDetail, bool) onToggle;

  @override
  Widget build(BuildContext context) {
    final seasonEps = episodes
        .where((e) => e.seasonNumber == season.seasonNumber)
        .toList();

    if (seasonEps.isEmpty) {
      return SliverToBoxAdapter(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Center(
            child: Text(
              l10n.progressLoadError,
              style: TextStyle(
                color: theme.colorScheme.onSurface.withValues(alpha: 0.6),
              ),
            ),
          ),
        ),
      );
    }

    return SliverList(
      delegate: SliverChildBuilderDelegate(
        (ctx, i) {
          final ep = seasonEps[i];
          final isWatched = isEpisodeWatched(entry, ep.seasonNumber, ep.episodeNumber);
          return _EpisodeRow(
            ep: ep,
            isWatched: isWatched,
            l10n: l10n,
            tc: tc,
            theme: theme,
            onToggle: (val) => onToggle(ep, val),
          );
        },
        childCount: seasonEps.length,
      ),
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Episode row
// ─────────────────────────────────────────────────────────────────────────────

class _EpisodeRow extends StatelessWidget {
  const _EpisodeRow({
    required this.ep,
    required this.isWatched,
    required this.l10n,
    required this.tc,
    required this.theme,
    required this.onToggle,
  });

  final EpisodeDetail ep;
  final bool isWatched;
  final L10n l10n;
  final AppTypeColors? tc;
  final ThemeData theme;
  final ValueChanged<bool> onToggle;

  @override
  Widget build(BuildContext context) {
    final watchedColor = tc?.watched ?? const Color(0xFF58C322);
    final mutedColor = theme.colorScheme.onSurface.withValues(alpha: 0.55);
    final titleText = _episodeDisplayTitle(ep, l10n);

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 3),
      child: Opacity(
        opacity: isWatched ? 0.75 : 1.0,
        child: Material(
          color: isWatched
              ? theme.colorScheme.surfaceContainerHighest.withValues(alpha: 0.3)
              : Colors.transparent,
          borderRadius: BorderRadius.circular(8),
          child: InkWell(
            onTap: () => onToggle(!isWatched),
            borderRadius: BorderRadius.circular(8),
            child: Padding(
              padding: const EdgeInsets.fromLTRB(8, 6, 8, 6),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // Episode still
                  if (ep.still.isNotEmpty)
                    ClipRRect(
                      borderRadius: BorderRadius.circular(4),
                      child: SizedBox(
                        width: 72,
                        height: 40,
                        child: Image.network(
                          ep.still,
                          fit: BoxFit.cover,
                          errorBuilder: (_, __, ___) =>
                              const _StillPlaceholder(),
                        ),
                      ),
                    )
                  else
                    const SizedBox(
                      width: 72,
                      height: 40,
                      child: _StillPlaceholder(),
                    ),

                  const SizedBox(width: 10),

                  // Episode info
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            Text(
                              l10n.progressEpisodeNum(ep.episodeNumber),
                              style: TextStyle(
                                fontSize: 10,
                                fontWeight: FontWeight.w700,
                                color: mutedColor,
                              ),
                            ),
                            const SizedBox(width: 4),
                            if (titleText.isNotEmpty)
                              Expanded(
                                child: Text(
                                  titleText,
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: TextStyle(
                                  fontSize: 12,
                                  fontWeight: FontWeight.w600,
                                  color: isWatched
                                      ? mutedColor
                                      : theme.colorScheme.onSurface,
                                  decoration: isWatched
                                      ? TextDecoration.lineThrough
                                      : null,
                                  decorationColor: mutedColor,
                                ),
                              ),
                            ),
                          ],
                        ),
                        if (ep.overview.isNotEmpty) ...[
                          const SizedBox(height: 2),
                          Text(
                            ep.overview,
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                            style: TextStyle(
                              fontSize: 10,
                              color: mutedColor,
                              height: 1.3,
                            ),
                          ),
                        ],
                        if (ep.airDate != null || ep.runtimeMinutes != null) ...[
                          const SizedBox(height: 2),
                          Row(
                            children: [
                              if (ep.airDate != null)
                                Text(
                                  ep.airDate!.substring(0, 7),
                                  style: TextStyle(
                                      fontSize: 9, color: mutedColor),
                                ),
                              if (ep.airDate != null &&
                                  ep.runtimeMinutes != null)
                                Text(' · ',
                                    style: TextStyle(
                                        fontSize: 9, color: mutedColor)),
                              if (ep.runtimeMinutes != null)
                                Text(
                                  l10n.runtimeMin(ep.runtimeMinutes!),
                                  style: TextStyle(
                                      fontSize: 9, color: mutedColor),
                                ),
                            ],
                          ),
                        ],
                      ],
                    ),
                  ),

                  // Watch checkbox
                  Padding(
                    padding: const EdgeInsets.only(left: 6, top: 2),
                    child: GestureDetector(
                      onTap: () => onToggle(!isWatched),
                      child: Icon(
                        isWatched
                            ? Icons.check_circle
                            : Icons.radio_button_unchecked,
                        size: 20,
                        color: isWatched
                            ? watchedColor
                            : mutedColor.withValues(alpha: 0.5),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Specials toggle button (eye icon in header)
// ─────────────────────────────────────────────────────────────────────────────

class _SpecialsToggle extends StatelessWidget {
  const _SpecialsToggle({required this.hidden, required this.onChanged});

  final bool hidden;
  final ValueChanged<bool> onChanged;

  @override
  Widget build(BuildContext context) {
    return IconButton(
      icon: Icon(
        hidden ? Icons.visibility_off_outlined : Icons.visibility_outlined,
        size: 18,
      ),
      tooltip: hidden ? 'Show specials' : 'Hide specials',
      visualDensity: VisualDensity.compact,
      onPressed: () => onChanged(!hidden),
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Placeholder widgets
// ─────────────────────────────────────────────────────────────────────────────

class _PosterPlaceholder extends StatelessWidget {
  const _PosterPlaceholder();

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return DecoratedBox(
      decoration: BoxDecoration(
        color:
            theme.colorScheme.onSurface.withValues(alpha: 0.07),
      ),
      child: Center(
        child: Icon(
          Icons.tv_outlined,
          size: 20,
          color: theme.colorScheme.onSurface.withValues(alpha: 0.2),
        ),
      ),
    );
  }
}

class _StillPlaceholder extends StatelessWidget {
  const _StillPlaceholder();

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return DecoratedBox(
      decoration: BoxDecoration(
        color: theme.colorScheme.onSurface.withValues(alpha: 0.07),
        borderRadius: BorderRadius.circular(4),
      ),
      child: Center(
        child: Icon(
          Icons.play_circle_outline,
          size: 18,
          color: theme.colorScheme.onSurface.withValues(alpha: 0.2),
        ),
      ),
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Error states
// ─────────────────────────────────────────────────────────────────────────────

class _NoIdMessage extends StatelessWidget {
  const _NoIdMessage({required this.l10n});
  final L10n l10n;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Text(
          l10n.progressLoadError,
          textAlign: TextAlign.center,
          style: TextStyle(
            color:
                Theme.of(context).colorScheme.onSurface.withValues(alpha: 0.6),
          ),
        ),
      ),
    );
  }
}

bool _isGenericEpisodeTitle(String title, int epNum) {
  final text = title.trim();
  if (text.isEmpty) return true;
  if (RegExp(r'^episode \d+$', caseSensitive: false).hasMatch(text)) {
    return true;
  }
  if (RegExp('^الحلقة\\s*$epNum\$').hasMatch(text)) return true;
  return false;
}

String _episodeDisplayTitle(EpisodeDetail ep, L10n l10n) {
  if (_isGenericEpisodeTitle(ep.title, ep.episodeNumber)) {
    return '';
  }
  return ep.title;
}

class _NoDataMessage extends StatelessWidget {
  const _NoDataMessage({required this.l10n});
  final L10n l10n;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Text(
          l10n.progressLoadError,
          textAlign: TextAlign.center,
          style: TextStyle(
            color:
                Theme.of(context).colorScheme.onSurface.withValues(alpha: 0.6),
          ),
        ),
      ),
    );
  }
}
