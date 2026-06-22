/// Pure progress helpers — mirrors `web-files/js/watch-progress.js`.
///
/// All functions are side-effect-free and operate on immutable value types.
/// Controllers and UI call these to derive display state and build new entries.
library;

import '../../models/watchlist_item.dart';

// ─── Episode/season references ───────────────────────────────────────────────

/// Minimal episode reference used for progress calculations.
/// Full metadata lives in SeasonDetail (added in Stage B).
class EpisodeRef {
  const EpisodeRef({
    required this.seasonNumber,
    required this.episodeNumber,
    this.airDate,
  });

  final int seasonNumber;
  final int episodeNumber;

  /// `null` = air date unknown. Unknown episodes are treated as aired.
  final DateTime? airDate;

  /// True when this episode counts toward completion.
  /// Future/unaired episodes (airDate > now) are excluded.
  bool get isAired {
    if (airDate == null) return true;
    return !airDate!.isAfter(DateTime.now());
  }

  String get key => '$seasonNumber:$episodeNumber';
}

/// Minimal season reference used for progress calculations.
class SeasonRef {
  const SeasonRef({
    required this.seasonNumber,
    required this.episodes,
  });

  final int seasonNumber;
  final List<EpisodeRef> episodes;

  /// Season 0 = Specials. Specials are stored but excluded from title completion.
  bool get isSpecials => seasonNumber == 0;
  bool get isRegular => seasonNumber > 0;

  List<EpisodeRef> get airedEpisodes =>
      episodes.where((e) => e.isAired).toList();
}

// ─── Watch state ─────────────────────────────────────────────────────────────

enum WatchState {
  unwatched,
  inprogress,
  watched,
}

class WatchStateResult {
  const WatchStateResult({
    required this.state,
    this.watchedEps = 0,
    this.totalEps = 0,
  });

  final WatchState state;

  /// Watched episode count (regular seasons, aired only).
  final int watchedEps;

  /// Total aired episode count (regular seasons only).
  final int totalEps;

  bool get hasEpisodeData => totalEps > 0;

  /// e.g. "8/24" — empty string when no episode data.
  String get progressLabel => hasEpisodeData ? '$watchedEps/$totalEps' : '';

  @override
  String toString() => 'WatchStateResult($state, $watchedEps/$totalEps)';
}

// ─── Key helpers ─────────────────────────────────────────────────────────────

String episodeKey(int season, int episode) => '$season:$episode';

List<String> airedEpisodeKeysForSeasons(List<SeasonRef> seasons) {
  return [
    for (final s in seasons)
      for (final e in s.episodes)
        if (e.isAired) e.key,
  ];
}

List<String> airedKeysForSeason(SeasonRef season) =>
    season.airedEpisodes.map((e) => e.key).toList();

// ─── State derivation ─────────────────────────────────────────────────────────

/// Derive the display watch state for a title given its [WatchEntry] (null =
/// unwatched) and known [seasons].
///
/// When [seasons] is null or empty, falls back to binary watched/unwatched so
/// existing titles without episode data continue to work.
WatchStateResult itemWatchState(WatchEntry? entry, List<SeasonRef>? seasons) {
  if (entry == null) {
    final total = _countAiredRegular(seasons);
    return WatchStateResult(state: WatchState.unwatched, totalEps: total);
  }

  final regularSeasons =
      (seasons ?? []).where((s) => s.isRegular).toList();

  if (regularSeasons.isEmpty) {
    // No episode data — binary state.
    return const WatchStateResult(state: WatchState.watched);
  }

  // Legacy-complete: progress is null, but entry exists → fully watched.
  if (entry.isLegacyComplete) {
    final total = _countAiredRegular(seasons);
    return WatchStateResult(
        state: WatchState.watched, watchedEps: total, totalEps: total);
  }

  final airedKeys = airedEpisodeKeysForSeasons(regularSeasons);
  final totalCount = airedKeys.length;
  final progress = entry.progress!;
  final watchedCount =
      airedKeys.where((k) => progress.episodes.contains(k)).length;

  if (watchedCount == 0) {
    return WatchStateResult(
        state: WatchState.unwatched, watchedEps: 0, totalEps: totalCount);
  }
  if (watchedCount >= totalCount) {
    return WatchStateResult(
        state: WatchState.watched,
        watchedEps: watchedCount,
        totalEps: totalCount);
  }
  return WatchStateResult(
      state: WatchState.inprogress,
      watchedEps: watchedCount,
      totalEps: totalCount);
}

/// How many aired regular-season episodes are watched for a specific season.
int watchedCountForSeason(
    WatchEntry? entry, int seasonNumber, SeasonRef season) {
  if (entry == null) return 0;
  final airedKeys = airedKeysForSeason(season);
  if (entry.isLegacyComplete) return airedKeys.length;
  return airedKeys.where((k) => entry.progress!.episodes.contains(k)).length;
}

bool isSeasonFullyWatched(
    WatchEntry? entry, int seasonNumber, SeasonRef season) {
  if (entry == null) return false;
  final airedKeys = airedKeysForSeason(season);
  if (airedKeys.isEmpty) return false;
  if (entry.isLegacyComplete) return true;
  return airedKeys.every((k) => entry.progress!.episodes.contains(k));
}

bool isSeasonPartiallyWatched(
    WatchEntry? entry, int seasonNumber, SeasonRef season) {
  if (entry == null) return false;
  if (entry.isLegacyComplete) return false; // legacy = fully watched
  final airedKeys = airedKeysForSeason(season);
  if (airedKeys.isEmpty) return false;
  final watched = airedKeys.where((k) => entry.progress!.episodes.contains(k));
  return watched.isNotEmpty && watched.length < airedKeys.length;
}

bool isEpisodeWatched(WatchEntry? entry, int season, int episode) {
  if (entry == null) return false;
  if (entry.isLegacyComplete) return true;
  return entry.progress!.hasEpisode(season, episode);
}

// ─── Mutation helpers ─────────────────────────────────────────────────────────
// All return a *new* WatchEntry. Caller writes it to the watched map.

/// Mark a single episode watched.
/// If [entry] is legacy-complete, materializes all [allAiredKeys] first, then
/// adds the new key. This only happens on explicit user interaction (unchecking
/// another episode or the season), not on opening the detail view.
WatchEntry markEpisodeWatched(
  WatchEntry? entry,
  int season,
  int episode, {
  List<String> allAiredKeys = const [],
}) {
  final key = episodeKey(season, episode);
  final List<String> base;

  if (entry == null) {
    base = const [];
  } else if (entry.isLegacyComplete) {
    base = List<String>.from(allAiredKeys);
  } else {
    base = List<String>.from(entry.progress!.episodes);
  }

  final updated = base.contains(key) ? base : [...base, key];
  return WatchEntry(
    rating: entry?.rating,
    note: entry?.note,
    progress: WatchProgress(
        version: WatchProgress.currentVersion, episodes: updated),
  );
}

/// Unmark a single episode.
/// If [entry] is legacy-complete, materializes all [allAiredKeys] then removes
/// the given key — this is the "user unchecks for the first time" path.
WatchEntry unmarkEpisodeWatched(
  WatchEntry? entry,
  int season,
  int episode, {
  required List<String> allAiredKeys,
}) {
  final key = episodeKey(season, episode);
  final List<String> base;

  if (entry == null || (!entry.isLegacyComplete && entry.progress == null)) {
    base = const [];
  } else if (entry.isLegacyComplete) {
    // Materialize all aired except the one being unchecked.
    base = allAiredKeys.where((k) => k != key).toList();
  } else {
    base = entry.progress!.episodes.where((k) => k != key).toList();
  }

  return WatchEntry(
    rating: entry?.rating,
    note: entry?.note,
    progress:
        WatchProgress(version: WatchProgress.currentVersion, episodes: base),
  );
}

/// Mark all currently aired episodes in [season] as watched.
WatchEntry markSeasonWatched(
    WatchEntry? entry, SeasonRef season) {
  final airedKeys = airedKeysForSeason(season);
  final List<String> existing;

  if (entry == null) {
    existing = const [];
  } else if (entry.isLegacyComplete) {
    existing = const [];
  } else {
    existing = entry.progress!.episodes;
  }

  final merged = {...existing, ...airedKeys}.toList();
  return WatchEntry(
    rating: entry?.rating,
    note: entry?.note,
    progress:
        WatchProgress(version: WatchProgress.currentVersion, episodes: merged),
  );
}

/// Unmark all episodes in [season] (by season number).
/// For legacy-complete entries, requires [allAiredKeys] to materialize the
/// rest of the series.
WatchEntry unmarkSeasonWatched(
  WatchEntry? entry,
  SeasonRef season, {
  required List<String> allAiredKeys,
}) {
  final sNum = season.seasonNumber;
  final List<String> base;

  if (entry == null) {
    base = const [];
  } else if (entry.isLegacyComplete) {
    base = allAiredKeys.where((k) => !k.startsWith('$sNum:')).toList();
  } else {
    base = entry.progress!.episodes
        .where((k) => !k.startsWith('$sNum:'))
        .toList();
  }

  return WatchEntry(
    rating: entry?.rating,
    note: entry?.note,
    progress:
        WatchProgress(version: WatchProgress.currentVersion, episodes: base),
  );
}

/// Mark all aired regular-season episodes as watched (title-level mark-all).
/// Specials (season 0) are excluded.
WatchEntry markAllWatched(WatchEntry? entry, List<SeasonRef> seasons) {
  final regularAiredKeys = airedEpisodeKeysForSeasons(
      seasons.where((s) => s.isRegular).toList());

  return WatchEntry(
    rating: entry?.rating,
    note: entry?.note,
    progress: WatchProgress(
        version: WatchProgress.currentVersion, episodes: regularAiredKeys),
  );
}

/// Clear all progress; returns null so caller can remove the key from the
/// watched map. Preserves rating/note for callers that need them separately.
WatchEntry? clearAllProgress(WatchEntry? entry) => null;

// ─── Private helpers ─────────────────────────────────────────────────────────

int _countAiredRegular(List<SeasonRef>? seasons) {
  if (seasons == null) return 0;
  return seasons
      .where((s) => s.isRegular)
      .expand((s) => s.airedEpisodes)
      .length;
}
