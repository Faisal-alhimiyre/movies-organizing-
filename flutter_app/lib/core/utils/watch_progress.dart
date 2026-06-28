/// Pure progress helpers — mirrors `web-files/js/watch-progress.js`.
///
/// All functions are side-effect-free and operate on immutable value types.
/// Controllers and UI call these to derive display state and build new entries.
library;

import '../../models/series_metadata.dart';
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

/// List-filter progress state — mirrors web `itemProgressState` in `app.js`.
enum ItemProgressState {
  unwatched,
  inProgress,
  watched,
}

/// Mirrors web `exportProgressObject` in `watch-progress.js`.
/// Returns null when there is nothing meaningful to store or restore.
WatchProgress? exportProgressObject(dynamic raw) {
  final parsed = WatchProgress.fromJson(raw);
  if (parsed.episodes.isNotEmpty) return parsed;
  if (parsed.episodeRatings != null && parsed.episodeRatings!.isNotEmpty) {
    return parsed;
  }
  if (parsed.seasonTotals != null && parsed.seasonTotals!.isNotEmpty) {
    return parsed;
  }
  if (parsed.moviePosition != null && parsed.moviePosition! > 0) return parsed;
  if (parsed.completed == true) return parsed;
  return null;
}

/// Three-state progress for filters, stats, and cards (no episode-count lookup).
/// Pass [contentType] `"movies"` to use movie position semantics.
ItemProgressState itemProgressState(
  WatchEntry? entry, {
  String? contentType,
}) {
  if (entry == null) return ItemProgressState.unwatched;
  if (contentType == 'movies') {
    return switch (movieWatchState(entry)) {
      WatchState.inprogress => ItemProgressState.inProgress,
      WatchState.watched => ItemProgressState.watched,
      WatchState.unwatched => ItemProgressState.unwatched,
    };
  }
  if (entry.isLegacyComplete) return ItemProgressState.watched;
  final prog = entry.progress;
  if (prog == null) return ItemProgressState.unwatched;
  if (prog.completed == true) return ItemProgressState.watched;
  if (prog.moviePosition != null && prog.moviePosition! > 0) {
    return ItemProgressState.inProgress;
  }
  final hasRegularEpisode =
      prog.episodes.any((k) => !k.startsWith('0:'));
  if (hasRegularEpisode) return ItemProgressState.inProgress;
  return ItemProgressState.unwatched;
}

ItemProgressState itemProgressStateForId(
  String id,
  Map<String, WatchEntry> watched, {
  String? contentType,
}) =>
    itemProgressState(watched[id], contentType: contentType);

double getMoviePosition(WatchEntry? entry) {
  final pos = entry?.progress?.moviePosition;
  if (pos == null || !pos.isFinite || pos <= 0) return 0;
  return pos.clamp(0.0, 1.0);
}

WatchEntry? setMoviePosition(WatchEntry? entry, double fraction) {
  final pos = fraction.clamp(0.0, 1.0);
  if (pos <= 0) {
    if (entry == null) return null;
    final base = entry.progress;
    if (base == null) return entry;
    final next = WatchProgress(
      version: WatchProgress.currentVersion,
      episodes: base.episodes,
      completed: false,
      seasonTotals: base.seasonTotals,
      episodeRatings: base.episodeRatings,
    );
    if (next.episodes.isEmpty &&
        (next.episodeRatings == null || next.episodeRatings!.isEmpty) &&
        (next.seasonTotals == null || next.seasonTotals!.isEmpty)) {
      if (entry.rating == null && (entry.note == null || entry.note!.isEmpty)) {
        return null;
      }
      return WatchEntry(rating: entry.rating, note: entry.note);
    }
    return WatchEntry(
      rating: entry.rating,
      note: entry.note,
      progress: next,
    );
  }

  final base = entry?.progress ?? WatchProgress.empty;
  final rounded = (pos * 1000).round() / 1000;
  return WatchEntry(
    rating: entry?.rating,
    note: entry?.note,
    progress: WatchProgress(
      version: WatchProgress.currentVersion,
      episodes: List<String>.from(base.episodes),
      completed: base.completed,
      seasonTotals: base.seasonTotals,
      episodeRatings: base.episodeRatings,
      moviePosition: rounded,
    ),
  );
}

/// Movie watch state from stored position (0–1).
WatchState movieWatchState(WatchEntry? entry, {double completeThreshold = 0.97}) {
  if (entry == null) return WatchState.unwatched;
  if (entry.isLegacyComplete) return WatchState.watched;
  final pos = getMoviePosition(entry);
  if (pos <= 0) return WatchState.unwatched;
  if (pos >= completeThreshold) return WatchState.watched;
  return WatchState.inprogress;
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
    progress: _rebuildProgress(entry?.progress, episodes: updated),
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
    progress: _rebuildProgress(
      entry?.progress,
      episodes: base,
      completed: false,
    ),
  );
}
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
    progress: _rebuildProgress(entry?.progress, episodes: merged),
  );
}

/// Mark episodes watched by explicit key list (gap-fill, legacy expand).
WatchEntry markEpisodesWatchedWithKeys(
  WatchEntry? entry,
  List<String> airedKeys,
) {
  final existing = entry?.isLegacyComplete == true
      ? const <String>[]
      : List<String>.from(entry?.progress?.episodes ?? const []);
  final merged = {...existing, ...airedKeys}.toList();
  return WatchEntry(
    rating: entry?.rating,
    note: entry?.note,
    progress: _rebuildProgress(entry?.progress, episodes: merged),
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
    progress: _rebuildProgress(
      entry?.progress,
      episodes: base,
      completed: false,
    ),
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
    progress: _rebuildProgress(
      entry?.progress,
      episodes: regularAiredKeys,
      completed: true,
    ),
  );
}

/// Clear all progress; returns null so caller can remove the key from the
/// watched map. Preserves rating/note for callers that need them separately.
WatchEntry? clearAllProgress(WatchEntry? entry) => null;

/// Preserve seasonTotals / episodeRatings when rebuilding episode lists.
WatchProgress _rebuildProgress(
  WatchProgress? base, {
  required List<String> episodes,
  bool? completed,
}) {
  return WatchProgress(
    version: WatchProgress.currentVersion,
    episodes: episodes,
    completed: completed ?? base?.completed,
    seasonTotals: base?.seasonTotals,
    episodeRatings: base?.episodeRatings,
    moviePosition: base?.moviePosition,
  );
}

double? getEpisodeRating(WatchEntry? entry, int season, int episode) {
  final ratings = entry?.progress?.episodeRatings;
  if (ratings == null) return null;
  final val = ratings[episodeKey(season, episode)];
  if (val == null || !val.isFinite || val <= 0 || val > 10) return null;
  return (val * 10).round() / 10;
}

WatchEntry? setEpisodeRating(
  WatchEntry? entry,
  int season,
  int episode,
  double rating,
) {
  if (!rating.isFinite || rating < 0 || rating > 10) return entry;
  final key = episodeKey(season, episode);
  final base = entry?.progress ?? WatchProgress.empty;
  final episodes = base.episodes.contains(key)
      ? base.episodes
      : [...base.episodes, key];
  final ratings = Map<String, double>.from(base.episodeRatings ?? {});
  ratings[key] = (rating * 10).round() / 10;
  return WatchEntry(
    rating: entry?.rating,
    note: entry?.note,
    progress: WatchProgress(
      version: WatchProgress.currentVersion,
      episodes: episodes,
      completed: base.completed,
      seasonTotals: base.seasonTotals,
      episodeRatings: ratings,
      moviePosition: base.moviePosition,
    ),
  );
}

WatchEntry? clearEpisodeRating(WatchEntry? entry, int season, int episode) {
  final key = episodeKey(season, episode);
  final base = entry?.progress;
  if (base?.episodeRatings == null || !base!.episodeRatings!.containsKey(key)) {
    return entry;
  }
  final ratings = Map<String, double>.from(base.episodeRatings!);
  ratings.remove(key);
  return WatchEntry(
    rating: entry?.rating,
    note: entry?.note,
    progress: WatchProgress(
      version: WatchProgress.currentVersion,
      episodes: base.episodes,
      completed: base.completed,
      seasonTotals: base.seasonTotals,
      episodeRatings: ratings.isEmpty ? null : ratings,
      moviePosition: base.moviePosition,
    ),
  );
}

/// Watched / total for a season using loaded episode metadata.
({int watched, int total}) seasonProgressFromEpisodes(
  WatchEntry? entry,
  List<EpisodeDetail> episodes,
  int seasonNumber,
) {
  final aired = episodes
      .where((e) => e.seasonNumber == seasonNumber && e.isAired)
      .toList();
  if (aired.isEmpty) return (watched: 0, total: 0);
  final watched = aired
      .where((e) => isEpisodeWatched(entry, e.seasonNumber, e.episodeNumber))
      .length;
  return (watched: watched, total: aired.length);
}

// ─── Private helpers ─────────────────────────────────────────────────────────

int _countAiredRegular(List<SeasonRef>? seasons) {
  if (seasons == null) return 0;
  return seasons
      .where((s) => s.isRegular)
      .expand((s) => s.airedEpisodes)
      .length;
}
