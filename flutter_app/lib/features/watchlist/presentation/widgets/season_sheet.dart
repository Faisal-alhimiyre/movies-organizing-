import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../app/theme/theme_extensions.dart';
import '../../../../core/utils/rating_utils.dart';
import '../../../../core/utils/watch_progress.dart';
import '../../../../l10n/l10n.dart';
import '../../../../models/series_metadata.dart';
import '../../../../models/watchlist_item.dart';
import '../../../../repositories/metadata/series_metadata_service.dart';
import '../../application/watchlist_controller.dart';

/// Season header block shown above summary when a season is selected (web `td-season-detail`).
class SeasonPresentation {
  const SeasonPresentation({
    required this.title,
    required this.overview,
    this.posterUrl,
  });

  final String title;
  final String overview;

  /// Season poster for immediate header display (before sync completes).
  final String? posterUrl;
}

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

/// Inline seasons/episodes block for the title detail surface (web `#tdSeasonsSlot`).
class TitleSeasonsPanel extends ConsumerStatefulWidget {
  const TitleSeasonsPanel({
    super.key,
    required this.l10n,
    required this.item,
    this.watched,
    this.embedded = false,
    this.scrollController,
    this.onSeasonPresentation,
  });

  final L10n l10n;
  final WatchlistItem item;
  final WatchEntry? watched;
  final bool embedded;
  final ScrollController? scrollController;
  final ValueChanged<SeasonPresentation?>? onSeasonPresentation;

  @override
  ConsumerState<TitleSeasonsPanel> createState() => _TitleSeasonsPanelState();
}

class _TitleSeasonsPanelState extends ConsumerState<TitleSeasonsPanel> {
  SeriesIdResolution? _resolution;
  SeriesMetadataResult? _series;
  SeasonEpisodesResult? _episodes;
  int? _selectedSeasonNum;
  int _seasonLoadToken = 0;
  Timer? _posterPersistTimer;
  int _posterPersistToken = 0;
  bool _loadingId = true;
  bool _loadingSeries = false;
  bool _loadingEpisodes = false;
  bool _noSpecials = false;
  bool _hideEpisodeStills = false;
  bool _hideSourceRatings = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _noSpecials = widget.item.noSpecials == true;
    _selectedSeasonNum = widget.item.selectedSeason;
    _resolveAndLoad();
  }

  @override
  void dispose() {
    _posterPersistTimer?.cancel();
    super.dispose();
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

    final specials = (result.seasons ?? [])
        .where((s) => s.seasonNumber == 0)
        .firstOrNull;
    if (specials != null &&
        specials.episodeCount == null &&
        widget.item.noSpecials != true) {
      unawaited(_silentlyCheckSpecials(specials));
    }

    final snapshot = ref.read(watchlistControllerProvider).value;
    final entry = snapshot?.watched[widget.item.id];
    final autoSelect = _pickInitialSeason(seasons, entry);

    await _selectSeason(autoSelect);
  }

  int _pickInitialSeason(List<SeasonSummary> seasons, WatchEntry? entry) {
    final saved = widget.item.selectedSeason;
    if (saved != null && seasons.any((s) => s.seasonNumber == saved)) {
      return saved;
    }

    final regular = seasons.where((s) => s.seasonNumber > 0).toList();
    final prog = entry?.progress;
    if (prog != null && prog.episodes.isNotEmpty) {
      final seasonNums = prog.episodes
          .map((k) => int.tryParse(k.split(':').first))
          .whereType<int>();
      if (seasonNums.isNotEmpty) {
        final maxSeason = seasonNums.reduce((a, b) => a > b ? a : b);
        if (seasons.any((s) => s.seasonNumber == maxSeason)) {
          return maxSeason;
        }
      }
    }

    final firstWithEps = regular.where((s) => (s.episodeCount ?? 0) > 0);
    if (firstWithEps.isNotEmpty) return firstWithEps.first.seasonNumber;
    if (regular.isNotEmpty) return regular.first.seasonNumber;
    return seasons.first.seasonNumber;
  }

  void _notifySeasonPresentation(SeasonSummary? season, {String? posterUrl}) {
    final cb = widget.onSeasonPresentation;
    if (cb == null) return;
    if (season == null) {
      cb(null);
      return;
    }
    final effectivePoster = posterUrl ?? _seasonPosterUrl(season);
    cb(SeasonPresentation(
      title: season.name,
      overview: season.overview,
      posterUrl: effectivePoster,
    ));
  }

  SeasonSummary _mergeSeasonFromEpisodeResult(
    SeasonSummary season,
    SeasonEpisodesResult result,
  ) {
    var poster = season.poster;
    var overview = season.overview;

    final detailPoster = result.seasonPoster?.trim() ?? '';
    if (detailPoster.isNotEmpty) poster = detailPoster;

    // Prefer season-detail overview (matches web `patchSeasonFromEpisodeResult`).
    final detailOverview = result.seasonOverview?.trim() ?? '';
    if (detailOverview.isNotEmpty) overview = detailOverview;

    return SeasonSummary(
      source: season.source,
      seriesTmdbId: season.seriesTmdbId,
      seasonNumber: season.seasonNumber,
      name: season.name,
      poster: poster,
      episodeCount: season.episodeCount,
      overview: overview,
      airDate: season.airDate,
      isSpecials: season.isSpecials,
      isSynthetic: season.isSynthetic,
    );
  }

  void _patchSeasonFromEpisodeResult(
    int seasonNum,
    SeasonEpisodesResult result,
  ) {
    final current = _series;
    final seasons = current?.seasons;
    if (current == null || seasons == null) return;

    final idx = seasons.indexWhere((s) => s.seasonNumber == seasonNum);
    if (idx < 0) return;

    final merged = _mergeSeasonFromEpisodeResult(seasons[idx], result);
    if (merged.poster == seasons[idx].poster &&
        merged.overview == seasons[idx].overview) {
      return;
    }

    final updatedSeasons = [...seasons];
    updatedSeasons[idx] = merged;
    setState(() {
      _series = SeriesMetadataResult(
        state: current.state,
        series: current.series,
        seasons: updatedSeasons,
        isStale: current.isStale,
        debugMessage: current.debugMessage,
      );
    });
  }

  List<SeasonSummary> _visibleSeasons(List<SeasonSummary> all) {
    if (_noSpecials) return all.where((s) => s.isRegular).toList();
    return all;
  }

  Future<void> _selectSeason(int seasonNumber) async {
    final resolution = _resolution;
    if (resolution == null || !resolution.hasUsableSource) return;

    if (_selectedSeasonNum == seasonNumber && _episodes != null) return;

    final loadToken = ++_seasonLoadToken;
    final seasonSummary = _seasonSummaryFor(seasonNumber, resolution);

    _notifySeasonPresentation(seasonSummary);

    _schedulePersistSelectedSeason(
      loadToken,
      seasonNumber,
      seasonSummary?.name,
      _seasonPosterUrl(seasonSummary),
    );

    setState(() {
      _selectedSeasonNum = seasonNumber;
      _episodes = null;
      _loadingEpisodes = true;
    });

    final svc = ref.read(seriesMetadataServiceProvider);
    final locale = widget.l10n.isArabic ? 'ar' : 'en';

    final result = await svc.fetchSeasonEpisodes(
      resolution: resolution,
      seasonNumber: seasonNumber,
      locale: locale,
      fallbackPoster: widget.item.poster,
      seasonSummary: seasonSummary,
    );

    if (!mounted || loadToken != _seasonLoadToken) return;
    setState(() {
      _episodes = result;
      _loadingEpisodes = false;
    });

    if (seasonNumber == 0) {
      final airedCount =
          (result.episodes ?? []).where((e) => e.isAired).length;
      if (airedCount == 0) {
        await _removeEmptySpecials();
        return;
      }
    }

    _patchSeasonFromEpisodeResult(seasonNumber, result);

    final patchedSeason = _seasonSummaryFor(seasonNumber, resolution);
    if (patchedSeason != null) {
      _notifySeasonPresentation(patchedSeason);
      _schedulePersistSelectedSeason(
        loadToken,
        seasonNumber,
        patchedSeason.name,
        _seasonPosterUrl(patchedSeason),
      );
    }
  }

  SeasonSummary? _seasonSummaryFor(int seasonNumber, SeriesIdResolution resolution) {
    return _series?.seasons?.firstWhere(
      (s) => s.seasonNumber == seasonNumber,
      orElse: () => SeasonSummary(
        source: resolution.source,
        seasonNumber: seasonNumber,
        name: widget.l10n.progressSeason(seasonNumber),
      ),
    );
  }

  String? _seasonPosterUrl(SeasonSummary? season) {
    final poster = season?.poster.trim() ?? '';
    if (poster.isNotEmpty && poster.startsWith('http')) return poster;
    return null;
  }

  void _schedulePersistSelectedSeason(
    int loadToken,
    int seasonNumber,
    String? name,
    String? seasonPoster,
  ) {
    final token = ++_posterPersistToken;
    _posterPersistTimer?.cancel();
    _posterPersistTimer = Timer(const Duration(milliseconds: 200), () {
      if (token != _posterPersistToken || loadToken != _seasonLoadToken) return;
      _persistSelectedSeason(seasonNumber, name, seasonPoster);
    });
  }

  void _persistSelectedSeason(
    int seasonNumber,
    String? name,
    String? seasonPoster,
  ) {
    final snapshot = ref.read(watchlistControllerProvider).value;
    if (snapshot == null) return;
    final index =
        snapshot.items.indexWhere((i) => i.id == widget.item.id);
    if (index == -1) return;

    final current = snapshot.items[index];
    final seasonName = name ?? widget.l10n.progressSeason(seasonNumber);
    final seasonPosterTrimmed = seasonPoster?.trim() ?? '';
    final itemPoster = current.poster?.trim() ?? '';
    final effectivePoster = seasonPosterTrimmed.isNotEmpty
        ? seasonPosterTrimmed
        : (itemPoster.isNotEmpty ? itemPoster : null);
    final nextCardPoster = effectivePoster ?? current.cardPoster;

    final changed = nextCardPoster != current.cardPoster ||
        current.selectedSeason != seasonNumber ||
        current.selectedSeasonName != seasonName;
    if (!changed) return;

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
      cardPoster: nextCardPoster,
      selectedSeason: seasonNumber,
      selectedSeasonName: seasonName,
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

  void _applyWatchedUpdate(Map<String, WatchEntry> newWatched) {
    final snapshot = ref.read(watchlistControllerProvider).value;
    if (snapshot == null) return;
    unawaited(
      ref.read(watchlistControllerProvider.notifier).replaceItems(
            snapshot.items,
            watched: newWatched,
          ),
    );
  }

  Future<void> _silentlyCheckSpecials(SeasonSummary specials) async {
    final resolution = _resolution;
    if (resolution == null || !resolution.hasUsableSource) return;

    final svc = ref.read(seriesMetadataServiceProvider);
    final locale = widget.l10n.isArabic ? 'ar' : 'en';

    try {
      final result = await svc.fetchSeasonEpisodes(
        resolution: resolution,
        seasonNumber: 0,
        locale: locale,
        fallbackPoster: widget.item.poster,
        seasonSummary: specials,
      );
      if (!mounted) return;

      final airedCount = (result.episodes ?? [])
          .where((e) => e.isAired)
          .length;
      if (airedCount > 0) return;

      await _removeEmptySpecials();
    } catch (_) {
      // Network error — leave the card; removal runs if user taps it.
    }
  }

  Future<void> _removeEmptySpecials() async {
    if (!mounted) return;
    setState(() => _noSpecials = true);

    final snapshot = ref.read(watchlistControllerProvider).value;
    if (snapshot != null) {
      final index =
          snapshot.items.indexWhere((i) => i.id == widget.item.id);
      if (index != -1) {
        final current = snapshot.items[index];
        if (current.noSpecials != true) {
          await ref.read(watchlistControllerProvider.notifier).upsertItem(
                WatchlistItem(
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
                  selectedSeason: current.selectedSeason,
                  selectedSeasonName: current.selectedSeasonName,
                  noSpecials: true,
                  imdbRating: current.imdbRating,
                  anilistRating: current.anilistRating,
                  ageRating: current.ageRating,
                  runtime: current.runtime,
                  seasonCount: current.seasonCount,
                  episodeCount: current.episodeCount,
                  year: current.year,
                  addedAt: current.addedAt,
                  secondaryGenres: current.secondaryGenres,
                ),
              );
        }
      }
    }

    if (_selectedSeasonNum == 0) {
      final visible = _visibleSeasons(_series?.seasons ?? []);
      final first = visible.where((s) => s.seasonNumber > 0).firstOrNull;
      if (first != null) {
        await _selectSeason(first.seasonNumber);
      }
    }
  }

  WatchEntry _expandLegacyToGranular(WatchEntry? entry) {
    final seasons = _series?.seasons ?? [];
    final loadedNum = _selectedSeasonNum;
    final loadedEps = _episodes?.episodes ?? [];
    final allKeys = <String>[];

    for (final s in seasons) {
      if (s.seasonNumber == 0) continue;
      if (loadedNum == s.seasonNumber && loadedEps.isNotEmpty) {
        allKeys.addAll(
          loadedEps
              .where((e) => e.isAired)
              .map((e) => episodeKey(e.seasonNumber, e.episodeNumber)),
        );
      } else {
        final count = seasonEpisodeTotal(s, entry);
        for (var i = 1; i <= count; i++) {
          allKeys.add(episodeKey(s.seasonNumber, i));
        }
      }
    }

    return markEpisodesWatchedWithKeys(entry, allKeys);
  }

  bool _shouldPromptGapFill(
    WatchEntry? entry,
    int seasonNum,
    int epNum,
    List<EpisodeDetail> loadedEpisodes,
  ) {
    return _hasUnwatchedPriorEpisodes(entry, seasonNum, epNum, loadedEpisodes) ||
        _hasUnwatchedPriorSeasons(entry, seasonNum);
  }

  bool _hasUnwatchedPriorEpisodes(
    WatchEntry? entry,
    int seasonNum,
    int epNum,
    List<EpisodeDetail> loadedEpisodes,
  ) {
    if (loadedEpisodes.isEmpty ||
        loadedEpisodes.first.seasonNumber != seasonNum) {
      return false;
    }
    return loadedEpisodes.any((ep) {
      if (!ep.isAired || ep.episodeNumber >= epNum) return false;
      return !isEpisodeWatched(entry, seasonNum, ep.episodeNumber);
    });
  }

  bool _hasUnwatchedPriorSeasons(WatchEntry? entry, int seasonNum) {
    final seasons = _visibleSeasons(_series?.seasons ?? []);
    return seasons.any((s) {
      if (s.seasonNumber <= 0 || s.seasonNumber >= seasonNum) return false;
      final ref = SeasonRef(
        seasonNumber: s.seasonNumber,
        episodes: [
          for (var i = 1; i <= (s.episodeCount ?? 0); i++)
            EpisodeRef(seasonNumber: s.seasonNumber, episodeNumber: i),
        ],
      );
      return !isSeasonFullyWatched(entry, s.seasonNumber, ref);
    });
  }

  List<String> _gapFillWatchKeys(
    WatchEntry? entry,
    int seasonNum,
    int epNum,
    List<EpisodeDetail> loadedEpisodes,
  ) {
    final keys = <String>[];
    final seasons = _visibleSeasons(_series?.seasons ?? []);

    for (final s in seasons) {
      final sNum = s.seasonNumber;
      if (sNum <= 0 || sNum > seasonNum) continue;
      if (sNum == seasonNum) {
        keys.addAll(
          loadedEpisodes
              .where((e) => e.isAired && e.episodeNumber <= epNum)
              .map((e) => episodeKey(e.seasonNumber, e.episodeNumber)),
        );
        continue;
      }
      if (_selectedSeasonNum == sNum &&
          loadedEpisodes.isNotEmpty &&
          loadedEpisodes.first.seasonNumber == sNum) {
        keys.addAll(
          loadedEpisodes
              .where((e) => e.isAired)
              .map((e) => episodeKey(e.seasonNumber, e.episodeNumber)),
        );
      } else {
        final count = seasonEpisodeTotal(s, entry);
        for (var i = 1; i <= count; i++) {
          keys.add(episodeKey(sNum, i));
        }
      }
    }

    return keys.toSet().toList();
  }

  Future<void> _handleToggleEpisode(EpisodeDetail ep, bool nowWatched) async {
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
    final loadedEps = _episodes?.episodes ?? [];

    WatchEntry updated;
    if (nowWatched) {
      if (_shouldPromptGapFill(
        entry,
        ep.seasonNumber,
        ep.episodeNumber,
        loadedEps,
      )) {
        final markAll = await showDialog<bool>(
          context: context,
          builder: (ctx) => AlertDialog(
            title: Text(widget.l10n.seasonsGapPromptTitle),
            content: Text(widget.l10n.seasonsGapPromptMessage),
            actions: [
              TextButton(
                onPressed: () => Navigator.of(ctx).pop(false),
                child: Text(widget.l10n.seasonsGapNo),
              ),
              FilledButton(
                onPressed: () => Navigator.of(ctx).pop(true),
                child: Text(widget.l10n.seasonsGapMarkAll),
              ),
            ],
          ),
        );
        if (markAll == true) {
          final keys = _gapFillWatchKeys(
            entry,
            ep.seasonNumber,
            ep.episodeNumber,
            loadedEps,
          );
          updated = markEpisodesWatchedWithKeys(entry, keys);
        } else {
          updated = markEpisodeWatched(
            entry,
            ep.seasonNumber,
            ep.episodeNumber,
            allAiredKeys: allAiredKeys,
          );
        }
      } else {
        updated = markEpisodeWatched(
          entry,
          ep.seasonNumber,
          ep.episodeNumber,
          allAiredKeys: allAiredKeys,
        );
      }
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

    _applyWatchedUpdate(newWatched);
  }

  Future<void> _handleMarkSeason(SeasonSummary season, bool watched) async {
    if (_selectedSeasonNum != season.seasonNumber ||
        _episodes?.episodes?.isEmpty != false) {
      await _selectSeason(season.seasonNumber);
    }

    final snapshot = ref.read(watchlistControllerProvider).value;
    if (snapshot == null) return;

    final episodes = _episodes?.episodes ?? [];
    final allSeasons = _series?.seasons ?? [];
    var entry = snapshot.watched[widget.item.id];

    if (entry?.isLegacyComplete == true) {
      entry = _expandLegacyToGranular(entry);
    }

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

    _applyWatchedUpdate(newWatched);

    if (watched) {
      final visible = _visibleSeasons(_series?.seasons ?? []);
      final next = visible
          .where((s) => s.seasonNumber > season.seasonNumber)
          .firstOrNull;
      if (next != null) {
        await _selectSeason(next.seasonNumber);
      }
    }
  }

  List<SeasonRef> _allSeasonRefsFromLoaded() {
    final allSeasons = _series?.seasons ?? [];
    return _allSeasonRefs(allSeasons);
  }

  Future<void> _openEpisode(EpisodeDetail ep) async {
    final snapshot = ref.read(watchlistControllerProvider).value;
    await showEpisodeRatingModal(
      context,
      l10n: widget.l10n,
      episode: ep,
      entry: snapshot?.watched[widget.item.id],
      onSave: ({required double? rating, required bool clear}) =>
          _saveEpisodeRating(ep, rating: rating, clear: clear),
    );
  }

  Future<void> _saveEpisodeRating(
    EpisodeDetail ep, {
    double? rating,
    bool clear = false,
  }) async {
    final snapshot = ref.read(watchlistControllerProvider).value;
    if (snapshot == null) return;

    var entry = snapshot.watched[widget.item.id];
    final allSeasonRefs = _allSeasonRefsFromLoaded();
    final allAiredKeys = airedEpisodeKeysForSeasons(allSeasonRefs);
    final seasonRef = _seasonRefFromEpisodes(
      ep.seasonNumber,
      _episodes?.episodes ?? [],
    );
    final airedKeys = airedEpisodeKeysForSeasons([seasonRef]);

    final hasGranular = entry?.progress != null;
    if (!hasGranular && !clear && rating != null) {
      entry = markEpisodeWatched(
        entry,
        ep.seasonNumber,
        ep.episodeNumber,
        allAiredKeys: allAiredKeys,
      );
    } else if (!(isEpisodeWatched(entry, ep.seasonNumber, ep.episodeNumber)) &&
        rating != null &&
        !clear) {
      entry = markEpisodeWatched(
        entry,
        ep.seasonNumber,
        ep.episodeNumber,
        allAiredKeys: airedKeys,
      );
    }

    WatchEntry? updated;
    if (clear || rating == null) {
      updated = clearEpisodeRating(entry, ep.seasonNumber, ep.episodeNumber);
    } else {
      updated = setEpisodeRating(
        entry,
        ep.seasonNumber,
        ep.episodeNumber,
        rating,
      );
    }
    if (updated == null) return;

    updated = _withCompletedFlag(updated, allSeasonRefs);

    final newWatched = Map<String, WatchEntry>.from(snapshot.watched);
    newWatched[widget.item.id] = updated;
    _applyWatchedUpdate(newWatched);
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

    final content = _loadingId || _loadingSeries
        ? _loadingIndicator(theme)
        : _error != null || !(_resolution?.hasUsableSource ?? false)
            ? _statusMessage(l10n, theme)
            : _series == null || !_series!.isUsable
                ? _statusMessage(l10n, theme)
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
                    scrollController: widget.scrollController,
                    embedded: widget.embedded,
                    onSeasonSelected: _selectSeason,
                    onToggleEpisode: _handleToggleEpisode,
                    onMarkSeason: _handleMarkSeason,
                    specialsToggle: _specialsToggle(),
                    hideEpisodeStills: _hideEpisodeStills,
                    hideSourceRatings: _hideSourceRatings,
                    onToggleHideStills: () =>
                        setState(() => _hideEpisodeStills = !_hideEpisodeStills),
                    onToggleHideRatings: () =>
                        setState(() => _hideSourceRatings = !_hideSourceRatings),
                    onOpenEpisode: _openEpisode,
                  );

    if (widget.embedded) {
      final specials = _specialsToggle();
      return Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const SizedBox(height: 8),
          Divider(
            height: 1,
            color: theme.colorScheme.outline.withValues(alpha: 0.28),
          ),
          const SizedBox(height: 14),
          Row(
            children: [
              Expanded(
                child: Text(
                  l10n.seasonsSectionTitle.toUpperCase(),
                  style: theme.textTheme.labelSmall?.copyWith(
                    color: tc?.textMuted ??
                        theme.colorScheme.onSurface.withValues(alpha: 0.55),
                    fontWeight: FontWeight.w700,
                    fontSize: 9,
                    letterSpacing: 1.4,
                  ),
                ),
              ),
              if (specials != null) specials,
            ],
          ),
          const SizedBox(height: 8),
          content,
        ],
      );
    }

    return content;
  }

  Widget _loadingIndicator(ThemeData theme) {
    return Center(
      child: Padding(
        padding: EdgeInsets.symmetric(vertical: widget.embedded ? 24 : 48),
        child: SizedBox(
          width: 28,
          height: 28,
          child: CircularProgressIndicator(
            strokeWidth: 2.5,
            color: theme.colorScheme.primary,
          ),
        ),
      ),
    );
  }

  Widget _statusMessage(L10n l10n, ThemeData theme) {
    return Padding(
      padding: EdgeInsets.symmetric(
        vertical: widget.embedded ? 20 : 48,
        horizontal: widget.embedded ? 0 : 24,
      ),
      child: Text(
        l10n.progressLoadError,
        textAlign: TextAlign.center,
        style: TextStyle(
          color: theme.colorScheme.onSurface.withValues(alpha: 0.6),
        ),
      ),
    );
  }

  Widget? _specialsToggle() {
    if (!(_series?.seasons ?? []).any((s) => s.isSpecials)) {
      return null;
    }
    return _SpecialsToggle(
      hidden: _noSpecials,
      onChanged: (hide) async {
        setState(() => _noSpecials = hide);
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
        await ref.read(watchlistControllerProvider.notifier).upsertItem(upd);
      },
    );
  }
}

class SeasonSheet extends ConsumerWidget {
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
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);

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
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 4, 12, 8),
                child: Row(
                  children: [
                    Expanded(
                      child: Text(
                        item.title,
                        style: theme.textTheme.titleMedium?.copyWith(
                          fontWeight: FontWeight.w700,
                        ),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
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
              Expanded(
                child: TitleSeasonsPanel(
                  l10n: l10n,
                  item: item,
                  watched: watched,
                  scrollController: scrollController,
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
    required this.embedded,
    required this.onSeasonSelected,
    required this.onToggleEpisode,
    required this.onMarkSeason,
    required this.hideEpisodeStills,
    required this.hideSourceRatings,
    required this.onToggleHideStills,
    required this.onToggleHideRatings,
    required this.onOpenEpisode,
    this.specialsToggle,
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
  final ScrollController? scrollController;
  final bool embedded;
  final ValueChanged<int> onSeasonSelected;
  final Future<void> Function(EpisodeDetail, bool) onToggleEpisode;
  final Future<void> Function(SeasonSummary, bool) onMarkSeason;
  final bool hideEpisodeStills;
  final bool hideSourceRatings;
  final VoidCallback onToggleHideStills;
  final VoidCallback onToggleHideRatings;
  final Future<void> Function(EpisodeDetail) onOpenEpisode;
  final Widget? specialsToggle;

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
    final episodeList = episodes?.episodes ?? [];

    Widget episodesBlock() {
      if (selSeason == null) return const SizedBox.shrink();
      return Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          _SeasonActionsBar(
            season: selSeason,
            entry: entry,
            episodes: episodeList,
            l10n: l10n,
            tc: tc,
            theme: theme,
            onMarkSeason: onMarkSeason,
          ),
          const SizedBox(height: 10),
          _EpisodesSectionHeader(season: selSeason, l10n: l10n, theme: theme, tc: tc),
          _SpoilerToggleRow(
            l10n: l10n,
            theme: theme,
            hideEpisodeStills: hideEpisodeStills,
            hideSourceRatings: hideSourceRatings,
            onToggleHideStills: onToggleHideStills,
            onToggleHideRatings: onToggleHideRatings,
          ),
          if (loadingEpisodes)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 24),
              child: Center(child: CircularProgressIndicator()),
            )
          else
            _EpisodeListColumn(
              season: selSeason,
              episodes: episodeList,
              entry: entry,
              l10n: l10n,
              tc: tc,
              theme: theme,
              hideEpisodeStills: hideEpisodeStills,
              hideSourceRatings: hideSourceRatings,
              onToggle: onToggleEpisode,
              onOpenEpisode: onOpenEpisode,
            ),
        ],
      );
    }

    if (embedded) {
      return Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          _SeasonCarousel(
            seasons: visibleSeasons,
            selectedSeasonNum: selectedSeasonNum,
            entry: entry,
            loadedEpisodes: episodeList,
            l10n: l10n,
            tc: tc,
            theme: theme,
            onTap: onSeasonSelected,
            onMarkSeason: onMarkSeason,
          ),
          episodesBlock(),
        ],
      );
    }

    return CustomScrollView(
      controller: scrollController,
      slivers: [
        if (specialsToggle != null)
          SliverToBoxAdapter(
            child: Align(
              alignment: AlignmentDirectional.centerEnd,
              child: Padding(
                padding: const EdgeInsets.only(right: 8, top: 4),
                child: specialsToggle,
              ),
            ),
          ),
        SliverToBoxAdapter(
          child: _SeasonCarousel(
            seasons: visibleSeasons,
            selectedSeasonNum: selectedSeasonNum,
            entry: entry,
            loadedEpisodes: episodeList,
            l10n: l10n,
            tc: tc,
            theme: theme,
            onTap: onSeasonSelected,
            onMarkSeason: onMarkSeason,
          ),
        ),
        SliverToBoxAdapter(child: episodesBlock()),
      ],
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Season carousel (horizontal scroll of season cards)
// ─────────────────────────────────────────────────────────────────────────────

class _SeasonCarousel extends StatefulWidget {
  const _SeasonCarousel({
    required this.seasons,
    required this.selectedSeasonNum,
    required this.entry,
    required this.loadedEpisodes,
    required this.l10n,
    required this.tc,
    required this.theme,
    required this.onTap,
    required this.onMarkSeason,
  });

  final List<SeasonSummary> seasons;
  final int? selectedSeasonNum;
  final WatchEntry? entry;
  final List<EpisodeDetail> loadedEpisodes;
  final L10n l10n;
  final AppTypeColors? tc;
  final ThemeData theme;
  final ValueChanged<int> onTap;
  final Future<void> Function(SeasonSummary, bool) onMarkSeason;

  @override
  State<_SeasonCarousel> createState() => _SeasonCarouselState();
}

class _SeasonCarouselState extends State<_SeasonCarousel> {
  late final ScrollController _scrollController;

  static const _cardWidth = 120.0;
  static const _cardGap = 8.0;
  static const _listPaddingTop = 10.0;
  static const _listPaddingBottom = 6.0;
  /// Poster 2:3 at card width + meta (name, counts, bar) — must match [_SeasonCard].
  static const _cardContentHeight = _cardWidth * 3 / 2 + 56;
  static const _carouselHeight =
      _cardContentHeight + _listPaddingTop + _listPaddingBottom;

  @override
  void initState() {
    super.initState();
    _scrollController = ScrollController();
  }

  @override
  void dispose() {
    _scrollController.dispose();
    super.dispose();
  }

  void _scrollBy(int direction) {
    if (!_scrollController.hasClients) return;
    _scrollController.animateTo(
      (_scrollController.offset + direction * (_cardWidth + _cardGap))
          .clamp(0.0, _scrollController.position.maxScrollExtent),
      duration: const Duration(milliseconds: 220),
      curve: Curves.easeOut,
    );
  }

  @override
  Widget build(BuildContext context) {
    final selectedIndex = widget.seasons.indexWhere(
      (s) => s.seasonNumber == widget.selectedSeasonNum,
    );

    return SizedBox(
      height: _carouselHeight,
      child: Stack(
        clipBehavior: Clip.hardEdge,
        alignment: Alignment.center,
        children: [
          ListView.separated(
            controller: _scrollController,
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.fromLTRB(
              0,
              _listPaddingTop,
              0,
              _listPaddingBottom,
            ),
            itemCount: widget.seasons.length,
            separatorBuilder: (_, __) => const SizedBox(width: _cardGap),
            itemBuilder: (ctx, i) {
              final season = widget.seasons[i];
              final isSelected = season.seasonNumber == widget.selectedSeasonNum;
              final isAdjacent = selectedIndex >= 0 &&
                  (i == selectedIndex - 1 || i == selectedIndex + 1);
              return _SeasonCard(
                season: season,
                isSelected: isSelected,
                isAdjacent: isAdjacent,
                entry: widget.entry,
                loadedEpisodes: widget.loadedEpisodes,
                l10n: widget.l10n,
                tc: widget.tc,
                theme: widget.theme,
                onTap: () => widget.onTap(season.seasonNumber),
                onMarkSeason: widget.onMarkSeason,
              );
            },
          ),
          if (widget.seasons.length > 1) ...[
            Positioned(
              left: 0,
              child: _CarouselNavButton(
                icon: Icons.chevron_left,
                onPressed: () => _scrollBy(-1),
              ),
            ),
            Positioned(
              right: 0,
              child: _CarouselNavButton(
                icon: Icons.chevron_right,
                onPressed: () => _scrollBy(1),
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class _CarouselNavButton extends StatelessWidget {
  const _CarouselNavButton({required this.icon, required this.onPressed});

  final IconData icon;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.black.withValues(alpha: 0.45),
      shape: const CircleBorder(),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onPressed,
        child: SizedBox(
          width: 28,
          height: 28,
          child: Icon(icon, size: 18, color: Colors.white),
        ),
      ),
    );
  }
}

class _SeasonCard extends StatelessWidget {
  const _SeasonCard({
    required this.season,
    required this.isSelected,
    required this.isAdjacent,
    required this.entry,
    required this.loadedEpisodes,
    required this.l10n,
    required this.tc,
    required this.theme,
    required this.onTap,
    required this.onMarkSeason,
  });

  final SeasonSummary season;
  final bool isSelected;
  final bool isAdjacent;
  final WatchEntry? entry;
  final List<EpisodeDetail> loadedEpisodes;
  final L10n l10n;
  final AppTypeColors? tc;
  final ThemeData theme;
  final VoidCallback onTap;
  final Future<void> Function(SeasonSummary, bool) onMarkSeason;

  @override
  Widget build(BuildContext context) {
    final watchedColor = tc?.watched ?? const Color(0xFF58C322);
    final inProgressColor = tc?.inProgress ?? const Color(0xFFFB923C);
    final accent = tc?.titleAccent ?? theme.colorScheme.primary;

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

    final prog = seasonProgressForCard(entry, season, loadedEpisodes);
    final scale = isSelected ? 1.0 : (isAdjacent ? 0.91 : 0.86);
    final opacity = isSelected ? 1.0 : (isAdjacent ? 0.72 : 0.55);
    final barPct = prog.total > 0 ? prog.watched / prog.total : 0.0;

    final borderColor = isSelected ? accent : Colors.transparent;

    return GestureDetector(
      onTap: onTap,
      child: AnimatedScale(
        scale: scale,
        duration: const Duration(milliseconds: 200),
        child: AnimatedOpacity(
          opacity: opacity,
          duration: const Duration(milliseconds: 200),
          child: SizedBox(
            width: _SeasonCarouselState._cardWidth,
            height: _SeasonCarouselState._cardContentHeight,
            child: DecoratedBox(
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(10),
                border: Border.all(
                  color: borderColor,
                  width: isSelected ? 2 : 0,
                ),
                color: theme.colorScheme.surface,
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  SizedBox(
                    height: _SeasonCarouselState._cardWidth * 3 / 2,
                    child: Stack(
                      fit: StackFit.expand,
                      children: [
                        ClipRRect(
                          borderRadius: BorderRadius.vertical(
                            top: Radius.circular(isSelected ? 8 : 10),
                          ),
                          child: season.poster.isNotEmpty
                              ? Image.network(
                                  season.poster,
                                  fit: BoxFit.cover,
                                  errorBuilder: (_, __, ___) =>
                                      const _PosterPlaceholder(),
                                )
                              : const _PosterPlaceholder(),
                        ),
                        Positioned(
                          right: 6,
                          bottom: 6,
                          child: Material(
                            color: Colors.black.withValues(alpha: 0.55),
                            shape: const CircleBorder(),
                            clipBehavior: Clip.antiAlias,
                            child: InkWell(
                              onTap: () => onMarkSeason(season, !isFull),
                              child: SizedBox(
                                width: 28,
                                height: 28,
                                child: Icon(
                                  isFull
                                      ? Icons.check_circle
                                      : Icons.radio_button_unchecked,
                                  size: 16,
                                  color: isFull ? watchedColor : Colors.white70,
                                ),
                              ),
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                  Expanded(
                    child: Padding(
                      padding: const EdgeInsets.fromLTRB(6, 4, 6, 5),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          Text(
                            season.name,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: TextStyle(
                              fontSize: 11,
                              height: 1.2,
                              fontWeight: isSelected
                                  ? FontWeight.w700
                                  : FontWeight.w600,
                              color: isFull
                                  ? watchedColor
                                  : isPartial
                                      ? inProgressColor
                                      : theme.colorScheme.onSurface,
                            ),
                          ),
                          if (season.episodeCount != null &&
                              season.episodeCount! > 0)
                            Text(
                              l10n.progressEpisodeCount(season.episodeCount!),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: TextStyle(
                                fontSize: 9,
                                height: 1.2,
                                color: theme.colorScheme.onSurface
                                    .withValues(alpha: 0.55),
                              ),
                            ),
                          if (prog.total > 0)
                            Text(
                              l10n.seasonsWatchedProgress(
                                prog.watched,
                                prog.total,
                              ),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: TextStyle(
                                fontSize: 9,
                                height: 1.2,
                                color: theme.colorScheme.onSurface
                                    .withValues(alpha: 0.55),
                              ),
                            ),
                          const Spacer(),
                          ClipRRect(
                            borderRadius: BorderRadius.circular(999),
                            child: LinearProgressIndicator(
                              value: barPct,
                              minHeight: 3,
                              backgroundColor: theme.colorScheme.onSurface
                                  .withValues(alpha: 0.08),
                              color: isFull
                                  ? watchedColor
                                  : isPartial
                                      ? inProgressColor
                                      : accent.withValues(alpha: 0.45),
                            ),
                          ),
                        ],
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

({int watched, int total}) seasonProgressForCard(
  WatchEntry? entry,
  SeasonSummary season,
  List<EpisodeDetail> loadedEpisodes,
) {
  if (loadedEpisodes.isNotEmpty &&
      loadedEpisodes.first.seasonNumber == season.seasonNumber) {
    return seasonProgressFromEpisodes(
      entry,
      loadedEpisodes,
      season.seasonNumber,
    );
  }

  final total = seasonEpisodeTotal(season, entry);
  if (entry == null) return (watched: 0, total: total);
  if (entry.isLegacyComplete) return (watched: total, total: total);
  final prog = entry.progress;
  if (prog == null) return (watched: 0, total: total);
  final prefix = '${season.seasonNumber}:';
  final watched =
      prog.episodes.where((k) => k.startsWith(prefix)).length;
  return (watched: watched, total: total);
}

int seasonEpisodeTotal(SeasonSummary season, WatchEntry? entry) {
  final fromSeason = season.episodeCount;
  if (fromSeason != null && fromSeason > 0) return fromSeason;
  final stored = entry?.progress?.seasonTotals?[season.seasonNumber.toString()];
  if (stored != null && stored > 0) return stored;
  return 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Season actions (watched progress + mark season)
// ─────────────────────────────────────────────────────────────────────────────

class _SeasonActionsBar extends StatelessWidget {
  const _SeasonActionsBar({
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
    final seasonEps =
        episodes.where((e) => e.seasonNumber == season.seasonNumber).toList();
    final sourceAvg = _seasonAverageExternalRating(seasonEps);
    final avgSource = _episodeExternalRatingSource(seasonEps);

    final seasonRef = SeasonRef(
      seasonNumber: season.seasonNumber,
      episodes: seasonEps
          .map((e) => EpisodeRef(
                seasonNumber: e.seasonNumber,
                episodeNumber: e.episodeNumber,
                airDate:
                    e.airDate != null ? DateTime.tryParse(e.airDate!) : null,
              ))
          .toList(),
    );
    final isFullyWatched =
        isSeasonFullyWatched(entry, season.seasonNumber, seasonRef);

    return Padding(
      padding: const EdgeInsets.fromLTRB(0, 8, 0, 0),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          OutlinedButton(
            onPressed: () => onMarkSeason(season, !isFullyWatched),
            style: OutlinedButton.styleFrom(
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
              minimumSize: const Size(0, 28),
              tapTargetSize: MaterialTapTargetSize.shrinkWrap,
              visualDensity: VisualDensity.compact,
              shape: const StadiumBorder(),
              foregroundColor: isFullyWatched
                  ? watchedColor
                  : theme.colorScheme.onSurface.withValues(alpha: 0.88),
              side: BorderSide(
                color: isFullyWatched
                    ? watchedColor.withValues(alpha: 0.45)
                    : theme.colorScheme.outline.withValues(alpha: 0.42),
              ),
            ),
            child: Text(
              isFullyWatched
                  ? l10n.progressUnmarkSeasonWatched
                  : l10n.progressMarkSeasonWatched,
              style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w600),
            ),
          ),
          if (sourceAvg != null) ...[
            const Spacer(),
            _SeasonAvgBadge(
              label: avgSource == 'imdb'
                  ? l10n.seasonsSeasonAvgOmdb(sourceAvg)
                  : l10n.seasonsSeasonAvgSource(sourceAvg),
              tc: tc,
              theme: theme,
            ),
          ],
        ],
      ),
    );
  }
}

class _SeasonAvgBadge extends StatelessWidget {
  const _SeasonAvgBadge({
    required this.label,
    required this.tc,
    required this.theme,
  });

  final String label;
  final AppTypeColors? tc;
  final ThemeData theme;

  @override
  Widget build(BuildContext context) {
    final accent = tc?.titleAccent ?? theme.colorScheme.primary;
    return DecoratedBox(
      decoration: BoxDecoration(
        color: accent.withValues(alpha: 0.14),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: accent.withValues(alpha: 0.38)),
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
        child: Text(
          label,
          style: TextStyle(
            fontSize: 11,
            fontWeight: FontWeight.w600,
            height: 1.2,
            color: theme.colorScheme.onSurface,
          ),
        ),
      ),
    );
  }
}

class _EpisodesSectionHeader extends StatelessWidget {
  const _EpisodesSectionHeader({
    required this.season,
    required this.l10n,
    required this.theme,
    required this.tc,
  });

  final SeasonSummary season;
  final L10n l10n;
  final ThemeData theme;
  final AppTypeColors? tc;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: Text(
        l10n.seasonsEpisodesFor(season.name).toUpperCase(),
        style: theme.textTheme.labelSmall?.copyWith(
          color: tc?.textMuted ??
              theme.colorScheme.onSurface.withValues(alpha: 0.55),
          fontWeight: FontWeight.w700,
          fontSize: 9,
          letterSpacing: 1.2,
        ),
      ),
    );
  }
}

class _SpoilerToggleRow extends StatelessWidget {
  const _SpoilerToggleRow({
    required this.l10n,
    required this.theme,
    required this.hideEpisodeStills,
    required this.hideSourceRatings,
    required this.onToggleHideStills,
    required this.onToggleHideRatings,
  });

  final L10n l10n;
  final ThemeData theme;
  final bool hideEpisodeStills;
  final bool hideSourceRatings;
  final VoidCallback onToggleHideStills;
  final VoidCallback onToggleHideRatings;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Align(
        alignment: AlignmentDirectional.centerStart,
        child: Table(
        columnWidths: const {
          0: IntrinsicColumnWidth(),
          1: FixedColumnWidth(34),
        },
        defaultVerticalAlignment: TableCellVerticalAlignment.middle,
        children: [
          _SpoilerToggle.tableRow(
            label: l10n.seasonsSpoilerMode,
            value: hideEpisodeStills,
            onChanged: onToggleHideStills,
            theme: theme,
          ),
          _SpoilerToggle.tableRow(
            label: l10n.seasonsHideEpisodeRatings,
            value: hideSourceRatings,
            onChanged: onToggleHideRatings,
            theme: theme,
          ),
        ],
        ),
      ),
    );
  }
}

class _SpoilerToggle {
  const _SpoilerToggle._();

  static TableRow tableRow({
    required String label,
    required bool value,
    required VoidCallback onChanged,
    required ThemeData theme,
  }) {
    final accent = theme.colorScheme.primary;
    final labelStyle = theme.textTheme.bodySmall?.copyWith(
      color: theme.colorScheme.onSurface.withValues(alpha: 0.62),
      fontSize: 12,
    );
    Widget rowTap({required Widget child}) {
      return Semantics(
        button: true,
        toggled: value,
        label: label,
        child: InkWell(
          onTap: onChanged,
          borderRadius: BorderRadius.circular(6),
          child: child,
        ),
      );
    }

    return TableRow(
      children: [
        TableCell(
          child: rowTap(
            child: Padding(
              padding: const EdgeInsets.fromLTRB(0, 4, 8, 4),
              child: Text(label, style: labelStyle),
            ),
          ),
        ),
        TableCell(
          child: rowTap(
            child: Padding(
              padding: const EdgeInsets.symmetric(vertical: 4),
              child: _ToggleTrack(value: value, accent: accent, theme: theme),
            ),
          ),
        ),
      ],
    );
  }
}

class _ToggleTrack extends StatelessWidget {
  const _ToggleTrack({
    required this.value,
    required this.accent,
    required this.theme,
  });

  final bool value;
  final Color accent;
  final ThemeData theme;

  @override
  Widget build(BuildContext context) {
    return AnimatedContainer(
      duration: const Duration(milliseconds: 150),
      width: 34,
      height: 18,
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(999),
        color: value
            ? accent
            : theme.colorScheme.outline.withValues(alpha: 0.55),
      ),
      child: AnimatedAlign(
        duration: const Duration(milliseconds: 150),
        alignment: value ? Alignment.centerRight : Alignment.centerLeft,
        child: Container(
          width: 14,
          height: 14,
          margin: const EdgeInsets.symmetric(horizontal: 2),
          decoration: const BoxDecoration(
            color: Colors.white,
            shape: BoxShape.circle,
          ),
        ),
      ),
    );
  }
}

class _EpisodeListColumn extends StatelessWidget {
  const _EpisodeListColumn({
    required this.season,
    required this.episodes,
    required this.entry,
    required this.l10n,
    required this.tc,
    required this.theme,
    required this.hideEpisodeStills,
    required this.hideSourceRatings,
    required this.onToggle,
    required this.onOpenEpisode,
  });

  final SeasonSummary season;
  final List<EpisodeDetail> episodes;
  final WatchEntry? entry;
  final L10n l10n;
  final AppTypeColors? tc;
  final ThemeData theme;
  final bool hideEpisodeStills;
  final bool hideSourceRatings;
  final Future<void> Function(EpisodeDetail, bool) onToggle;
  final Future<void> Function(EpisodeDetail) onOpenEpisode;

  @override
  Widget build(BuildContext context) {
    final seasonEps = episodes
        .where((e) => e.seasonNumber == season.seasonNumber)
        .toList();

    if (seasonEps.isEmpty) {
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: 20),
        child: Center(
          child: Text(
            l10n.progressLoadError,
            style: TextStyle(
              color: theme.colorScheme.onSurface.withValues(alpha: 0.6),
            ),
          ),
        ),
      );
    }

    return Column(
      children: [
        for (final ep in seasonEps)
          _EpisodeRow(
            ep: ep,
            seasonPoster: season.poster,
            isWatched:
                isEpisodeWatched(entry, ep.seasonNumber, ep.episodeNumber),
            userRating: getEpisodeRating(entry, ep.seasonNumber, ep.episodeNumber),
            hideEpisodeStills: hideEpisodeStills,
            hideSourceRatings: hideSourceRatings,
            l10n: l10n,
            tc: tc,
            theme: theme,
            onToggle: (val) => onToggle(ep, val),
            onOpen: () => onOpenEpisode(ep),
          ),
      ],
    );
  }
}

class _EpisodeRow extends StatelessWidget {
  const _EpisodeRow({
    required this.ep,
    required this.seasonPoster,
    required this.isWatched,
    required this.userRating,
    required this.hideEpisodeStills,
    required this.hideSourceRatings,
    required this.l10n,
    required this.tc,
    required this.theme,
    required this.onToggle,
    required this.onOpen,
  });

  final EpisodeDetail ep;
  final String seasonPoster;
  final bool isWatched;
  final double? userRating;
  final bool hideEpisodeStills;
  final bool hideSourceRatings;
  final L10n l10n;
  final AppTypeColors? tc;
  final ThemeData theme;
  final ValueChanged<bool> onToggle;
  final VoidCallback onOpen;

  @override
  Widget build(BuildContext context) {
    final watchedColor = tc?.watched ?? const Color(0xFF58C322);
    final mutedColor = theme.colorScheme.onSurface.withValues(alpha: 0.55);
    final titleText = _episodeDisplayTitle(ep, l10n);
    final sourceRating = hideSourceRatings ? null : _episodeExternalRating(ep);
    final stillUrl = hideEpisodeStills && seasonPoster.isNotEmpty
        ? seasonPoster
        : ep.still;

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 3),
      child: Opacity(
        opacity: isWatched ? 0.78 : 1.0,
        child: Material(
          color: isWatched
              ? theme.colorScheme.surfaceContainerHighest.withValues(alpha: 0.28)
              : Colors.transparent,
          child: InkWell(
            onTap: onOpen,
            child: Padding(
              padding: const EdgeInsets.symmetric(vertical: 8),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  if (stillUrl.isNotEmpty)
                    ClipRRect(
                      borderRadius: BorderRadius.circular(6),
                      child: SizedBox(
                        width: 88,
                        height: 50,
                        child: Image.network(
                          stillUrl,
                          fit: BoxFit.cover,
                          errorBuilder: (_, __, ___) =>
                              const _StillPlaceholder(),
                        ),
                      ),
                    )
                  else
                    const SizedBox(
                      width: 88,
                      height: 50,
                      child: _StillPlaceholder(),
                    ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Wrap(
                          spacing: 6,
                          runSpacing: 2,
                          crossAxisAlignment: WrapCrossAlignment.center,
                          children: [
                            Text(
                              l10n.progressEpisodeNum(ep.episodeNumber),
                              style: TextStyle(
                                fontSize: 10,
                                fontWeight: FontWeight.w700,
                                color: mutedColor,
                              ),
                            ),
                            if (titleText.isNotEmpty)
                              Text(
                                titleText,
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
                            if (sourceRating != null)
                              _SourceRatingBadge(
                                rating: sourceRating,
                                l10n: l10n,
                                tc: tc,
                                theme: theme,
                              ),
                          ],
                        ),
                        if (ep.overview.isNotEmpty) ...[
                          const SizedBox(height: 4),
                          Text(
                            ep.overview,
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                            style: TextStyle(
                              fontSize: 11,
                              color: mutedColor,
                              height: 1.35,
                            ),
                          ),
                        ],
                        if (ep.airDate != null || ep.runtimeMinutes != null) ...[
                          const SizedBox(height: 4),
                          Text(
                            [
                              if (ep.airDate != null && ep.airDate!.length >= 7)
                                ep.airDate!.substring(0, 7),
                              if (ep.runtimeMinutes != null)
                                l10n.runtimeMin(ep.runtimeMinutes!),
                            ].join(' · '),
                            style: TextStyle(fontSize: 10, color: mutedColor),
                          ),
                        ],
                        if (userRating != null) ...[
                          const SizedBox(height: 6),
                          _UserRatingChip(
                            label: l10n.seasonsEpisodeRatingYours(userRating!),
                            tc: tc,
                            theme: theme,
                          ),
                        ],
                      ],
                    ),
                  ),
                  IconButton(
                    onPressed: () => onToggle(!isWatched),
                    icon: Icon(
                      isWatched
                          ? Icons.check_circle
                          : Icons.radio_button_unchecked,
                      size: 22,
                      color: isWatched
                          ? watchedColor
                          : mutedColor.withValues(alpha: 0.45),
                    ),
                    visualDensity: VisualDensity.compact,
                    padding: const EdgeInsets.only(left: 4, top: 2),
                    constraints: const BoxConstraints(minWidth: 36, minHeight: 36),
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

class _SourceRatingBadge extends StatelessWidget {
  const _SourceRatingBadge({
    required this.rating,
    required this.l10n,
    required this.tc,
    required this.theme,
  });

  final double rating;
  final L10n l10n;
  final AppTypeColors? tc;
  final ThemeData theme;

  @override
  Widget build(BuildContext context) {
    final accent = tc?.titleAccent ?? theme.colorScheme.primary;
    return Tooltip(
      message: l10n.seasonsEpisodeRatingSource(rating),
      child: RichText(
        text: TextSpan(
          style: TextStyle(
            fontSize: 11,
            fontWeight: FontWeight.w700,
            color: accent,
          ),
          children: [
            TextSpan(text: formatWatchRating(rating)),
            TextSpan(
              text: '/10',
              style: TextStyle(
                fontSize: 9,
                fontWeight: FontWeight.w500,
                color: theme.colorScheme.onSurface.withValues(alpha: 0.55),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _UserRatingChip extends StatelessWidget {
  const _UserRatingChip({
    required this.label,
    required this.tc,
    required this.theme,
  });

  final String label;
  final AppTypeColors? tc;
  final ThemeData theme;

  @override
  Widget build(BuildContext context) {
    final accent = tc?.titleAccent ?? theme.colorScheme.primary;
    return DecoratedBox(
      decoration: BoxDecoration(
        color: accent.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: accent.withValues(alpha: 0.3)),
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
        child: Text(
          label,
          style: TextStyle(fontSize: 10, fontWeight: FontWeight.w600, color: accent),
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
// Episode rating modal + rating helpers
// ─────────────────────────────────────────────────────────────────────────────

Future<void> showEpisodeRatingModal(
  BuildContext context, {
  required L10n l10n,
  required EpisodeDetail episode,
  required WatchEntry? entry,
  required Future<void> Function({
    required double? rating,
    required bool clear,
  }) onSave,
}) {
  return showDialog<void>(
    context: context,
    barrierColor: Colors.black.withValues(alpha: 0.72),
    builder: (ctx) => _EpisodeRatingDialog(
      l10n: l10n,
      episode: episode,
      entry: entry,
      onSave: onSave,
    ),
  );
}

class _EpisodeRatingDialog extends StatefulWidget {
  const _EpisodeRatingDialog({
    required this.l10n,
    required this.episode,
    required this.entry,
    required this.onSave,
  });

  final L10n l10n;
  final EpisodeDetail episode;
  final WatchEntry? entry;
  final Future<void> Function({
    required double? rating,
    required bool clear,
  }) onSave;

  @override
  State<_EpisodeRatingDialog> createState() => _EpisodeRatingDialogState();
}

class _EpisodeRatingDialogState extends State<_EpisodeRatingDialog> {
  late final TextEditingController _controller;
  bool _editing = false;

  @override
  void initState() {
    super.initState();
    final existing = getEpisodeRating(
      widget.entry,
      widget.episode.seasonNumber,
      widget.episode.episodeNumber,
    );
    _controller = TextEditingController(
      text: existing != null ? formatWatchRating(existing) : '',
    );
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  double? get _existingRating => getEpisodeRating(
        widget.entry,
        widget.episode.seasonNumber,
        widget.episode.episodeNumber,
      );

  double? _parseInput() {
    final text = _controller.text.trim().replaceAll(',', '.');
    if (text.isEmpty) return null;
    final n = double.tryParse(text);
    if (n == null || !n.isFinite || n < 0 || n > 10) return null;
    return n;
  }

  Future<void> _submit({bool clear = false}) async {
    if (!clear && _existingRating != null && !_editing) {
      setState(() => _editing = true);
      return;
    }
    await widget.onSave(
      rating: clear ? null : _parseInput(),
      clear: clear,
    );
    if (mounted) Navigator.of(context).pop();
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final tc = theme.extension<AppTypeColors>();
    final ep = widget.episode;
    final l10n = widget.l10n;
    final sourceRating = _episodeExternalRating(ep);
    final yourRating = _existingRating;
    final showForm = yourRating == null || _editing;
    final titleText = _episodeDisplayTitle(ep, l10n);
    final displayTitle = titleText.isEmpty
        ? l10n.progressEpisodeNum(ep.episodeNumber)
        : titleText;

    return Dialog(
      backgroundColor: tc?.bgElevated ?? theme.colorScheme.surfaceContainerHigh,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 420),
        child: Padding(
          padding: const EdgeInsets.fromLTRB(18, 16, 18, 16),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Align(
                alignment: AlignmentDirectional.topEnd,
                child: IconButton(
                  onPressed: () => Navigator.of(context).pop(),
                  icon: const Icon(Icons.close, size: 20),
                  visualDensity: VisualDensity.compact,
                ),
              ),
              if (ep.still.isNotEmpty)
                ClipRRect(
                  borderRadius: BorderRadius.circular(8),
                  child: AspectRatio(
                    aspectRatio: 16 / 9,
                    child: Image.network(ep.still, fit: BoxFit.cover),
                  ),
                )
              else
                const AspectRatio(
                  aspectRatio: 16 / 9,
                  child: _StillPlaceholder(),
                ),
              const SizedBox(height: 12),
              Text(
                '${l10n.progressEpisodeNum(ep.episodeNumber)} · $displayTitle',
                style: theme.textTheme.titleSmall?.copyWith(
                  fontWeight: FontWeight.w700,
                ),
              ),
              if (ep.airDate != null || ep.runtimeMinutes != null) ...[
                const SizedBox(height: 4),
                Text(
                  [
                    if (ep.airDate != null && ep.airDate!.length >= 10)
                      ep.airDate!.substring(0, 10),
                    if (ep.runtimeMinutes != null)
                      l10n.runtimeMin(ep.runtimeMinutes!),
                  ].join(' · '),
                  style: theme.textTheme.bodySmall?.copyWith(
                    color: theme.colorScheme.onSurface.withValues(alpha: 0.62),
                  ),
                ),
              ],
              if (ep.overview.isNotEmpty) ...[
                const SizedBox(height: 8),
                Text(
                  ep.overview,
                  style: theme.textTheme.bodySmall?.copyWith(height: 1.45),
                ),
              ],
              const SizedBox(height: 12),
              if (sourceRating != null)
                _UserRatingChip(
                  label: l10n.seasonsEpisodeRatingSource(sourceRating),
                  tc: tc,
                  theme: theme,
                ),
              if (yourRating != null) ...[
                const SizedBox(height: 6),
                _UserRatingChip(
                  label: l10n.seasonsEpisodeRatingYours(yourRating),
                  tc: tc,
                  theme: theme,
                ),
              ],
              if (showForm) ...[
                const SizedBox(height: 12),
                Text(
                  l10n.seasonsYourEpisodeRating,
                  style: theme.textTheme.labelMedium,
                ),
                const SizedBox(height: 6),
                TextField(
                  controller: _controller,
                  keyboardType: const TextInputType.numberWithOptions(decimal: true),
                  decoration: const InputDecoration(
                    hintText: '8.5',
                    isDense: true,
                  ),
                  autofocus: true,
                ),
              ],
              const SizedBox(height: 14),
              Row(
                children: [
                  TextButton(
                    onPressed: () => Navigator.of(context).pop(),
                    child: Text(l10n.btnCancel),
                  ),
                  if (yourRating != null) ...[
                    const SizedBox(width: 8),
                    TextButton(
                      onPressed: () => _submit(clear: true),
                      child: Text(l10n.seasonsClearEpisodeRating),
                    ),
                  ],
                  const Spacer(),
                  FilledButton(
                    onPressed: _submit,
                    child: Text(
                      yourRating != null && !_editing
                          ? l10n.seasonsEditEpisodeRating
                          : l10n.btnSave,
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

double? _episodeExternalRating(EpisodeDetail ep) {
  final source = ep.episodeRatingSource ?? '';
  if (source != 'imdb' && source != 'tmdb') return null;
  final rating = ep.episodeRating;
  if (rating == null || !rating.isFinite || rating <= 0 || rating > 10) {
    return null;
  }
  return (rating * 10).round() / 10;
}

String? _episodeExternalRatingSource(List<EpisodeDetail> episodes) {
  for (final ep in episodes) {
    if (_episodeExternalRating(ep) == null) continue;
    final source = ep.episodeRatingSource ?? '';
    if (source == 'imdb' || source == 'tmdb') return source;
  }
  return null;
}

double? _seasonAverageExternalRating(List<EpisodeDetail> episodes) {
  final vals = episodes
      .where((e) => e.isAired)
      .map(_episodeExternalRating)
      .whereType<double>()
      .toList();
  if (vals.isEmpty) return null;
  return (vals.reduce((a, b) => a + b) / vals.length * 10).round() / 10;
}

// ─────────────────────────────────────────────────────────────────────────────
// Error states
// ─────────────────────────────────────────────────────────────────────────────

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
