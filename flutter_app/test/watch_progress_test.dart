// ignore_for_file: prefer_const_constructors
import 'package:flutter_test/flutter_test.dart';
import 'package:our_movie_nights/core/utils/watch_progress.dart';
import 'package:our_movie_nights/models/watchlist_item.dart';

// ─── shared test fixtures ──────────────────────────────────────────────────

// Two regular seasons; season 0 is specials.
final _s0 = SeasonRef(
  seasonNumber: 0,
  episodes: [
    EpisodeRef(seasonNumber: 0, episodeNumber: 1), // special
  ],
);
final _s1 = SeasonRef(
  seasonNumber: 1,
  episodes: [
    EpisodeRef(seasonNumber: 1, episodeNumber: 1),
    EpisodeRef(seasonNumber: 1, episodeNumber: 2),
    EpisodeRef(seasonNumber: 1, episodeNumber: 3),
  ],
);
final _s2 = SeasonRef(
  seasonNumber: 2,
  episodes: [
    EpisodeRef(seasonNumber: 2, episodeNumber: 1),
    EpisodeRef(seasonNumber: 2, episodeNumber: 2),
    // Unaired episode
    EpisodeRef(
      seasonNumber: 2,
      episodeNumber: 3,
      airDate: DateTime.now().add(const Duration(days: 30)),
    ),
  ],
);

// All aired regular keys across s1 + s2 (NOT s0 specials, NOT unaired s2e3).
final _allAiredRegularKeys = ['1:1', '1:2', '1:3', '2:1', '2:2'];

// ─── WatchProgress model ──────────────────────────────────────────────────────

void main() {
  group('WatchProgress.fromJson', () {
    test('handles null', () {
      final p = WatchProgress.fromJson(null);
      expect(p.episodes, isEmpty);
    });

    test('handles empty map', () {
      final p = WatchProgress.fromJson({});
      expect(p.episodes, isEmpty);
    });

    test('handles valid format', () {
      final p = WatchProgress.fromJson({
        'version': 1,
        'episodes': ['1:1', '1:2', '2:5'],
      });
      expect(p.episodes, containsAll(['1:1', '1:2', '2:5']));
      expect(p.version, 1);
    });

    test('filters out invalid episode keys (no colon)', () {
      final p = WatchProgress.fromJson({
        'version': 1,
        'episodes': ['1:1', 'bad', '', '2:3'],
      });
      expect(p.episodes, containsAll(['1:1', '2:3']));
      expect(p.episodes, isNot(contains('bad')));
    });

    test('handles non-list episodes field', () {
      final p = WatchProgress.fromJson({'version': 1, 'episodes': null});
      expect(p.episodes, isEmpty);
    });
  });

  group('WatchEntry.fromJson', () {
    test('handles null → empty entry (no progress)', () {
      final e = WatchEntry.fromJson(null);
      expect(e.rating, isNull);
      expect(e.note, isNull);
      expect(e.progress, isNull);
      expect(e.isLegacyComplete, isTrue);
    });

    test('handles true → legacy-complete', () {
      final e = WatchEntry.fromJson(true);
      expect(e.isLegacyComplete, isTrue);
      expect(e.progress, isNull);
    });

    test('handles empty map → legacy-complete', () {
      final e = WatchEntry.fromJson({});
      expect(e.isLegacyComplete, isTrue);
    });

    test('handles {rating, note} → legacy-complete with data', () {
      final e = WatchEntry.fromJson({'rating': 8.5, 'note': 'Great'});
      expect(e.rating, 8.5);
      expect(e.note, 'Great');
      expect(e.isLegacyComplete, isTrue);
    });

    test('handles new format with progress', () {
      final e = WatchEntry.fromJson({
        'rating': 9.0,
        'note': 'Amazing',
        'progress': {'version': 1, 'episodes': ['1:1', '1:2']},
      });
      expect(e.rating, 9.0);
      expect(e.note, 'Amazing');
      expect(e.isLegacyComplete, isFalse);
      expect(e.progress!.episodes, containsAll(['1:1', '1:2']));
    });
  });

  group('WatchEntry.toJson / round-trip', () {
    test('empty entry round-trips', () {
      const e = WatchEntry();
      final json = e.toJson();
      expect(json, isEmpty);
    });

    test('legacy entry with rating round-trips', () {
      const e = WatchEntry(rating: 7.0, note: 'Good');
      final json = e.toJson();
      final e2 = WatchEntry.fromJson(json);
      expect(e2.rating, 7.0);
      expect(e2.note, 'Good');
      expect(e2.isLegacyComplete, isTrue);
    });

    test('entry with progress round-trips', () {
      final e = WatchEntry(
        rating: 8.0,
        progress: WatchProgress(
            version: 1, episodes: const ['1:1', '2:3']),
      );
      final json = e.toJson();
      final e2 = WatchEntry.fromJson(json);
      expect(e2.rating, 8.0);
      expect(e2.isLegacyComplete, isFalse);
      expect(e2.progress!.episodes, containsAll(['1:1', '2:3']));
    });
  });

  // ─── isEpisodeWatched ───────────────────────────────────────────────────────

  group('isEpisodeWatched', () {
    test('returns false when entry is null', () {
      expect(isEpisodeWatched(null, 1, 1), isFalse);
    });

    test('legacy-complete returns true for any episode', () {
      const entry = WatchEntry();
      expect(isEpisodeWatched(entry, 1, 1), isTrue);
      expect(isEpisodeWatched(entry, 5, 12), isTrue);
    });

    test('granular progress returns true for watched episode', () {
      final entry = WatchEntry(
        progress: WatchProgress(version: 1, episodes: const ['1:2']),
      );
      expect(isEpisodeWatched(entry, 1, 2), isTrue);
    });

    test('granular progress returns false for unwatched episode', () {
      final entry = WatchEntry(
        progress: WatchProgress(version: 1, episodes: const ['1:2']),
      );
      expect(isEpisodeWatched(entry, 1, 1), isFalse);
    });
  });

  // ─── markEpisodeWatched ─────────────────────────────────────────────────────

  group('markEpisodeWatched', () {
    test('creates progress when entry is null', () {
      final result = markEpisodeWatched(null, 1, 1);
      expect(result.progress!.episodes, contains('1:1'));
      expect(result.isLegacyComplete, isFalse);
    });

    test('materialises all aired keys when legacy-complete', () {
      const entry = WatchEntry();
      final result = markEpisodeWatched(
        entry, 2, 1,
        allAiredKeys: _allAiredRegularKeys,
      );
      // All previous keys preserved + new one
      for (final k in _allAiredRegularKeys) {
        expect(result.progress!.episodes, contains(k));
      }
      expect(result.progress!.episodes, contains('2:1'));
    });

    test('adds episode to existing granular progress', () {
      final entry = WatchEntry(
        progress: WatchProgress(version: 1, episodes: const ['1:1']),
      );
      final result = markEpisodeWatched(entry, 1, 2);
      expect(result.progress!.episodes, containsAll(['1:1', '1:2']));
    });

    test('is idempotent for already-watched episode', () {
      final entry = WatchEntry(
        progress: WatchProgress(version: 1, episodes: const ['1:1']),
      );
      final result = markEpisodeWatched(entry, 1, 1);
      expect(result.progress!.episodes.where((k) => k == '1:1').length, 1);
    });
  });

  // ─── unmarkEpisodeWatched ───────────────────────────────────────────────────

  group('unmarkEpisodeWatched', () {
    test('on null entry → creates empty progress', () {
      final result = unmarkEpisodeWatched(null, 1, 1, allAiredKeys: []);
      expect(result.progress!.episodes, isEmpty);
    });

    test('on legacy-complete → materialises all-minus-unchecked', () {
      const entry = WatchEntry();
      final result = unmarkEpisodeWatched(
        entry, 1, 2,
        allAiredKeys: _allAiredRegularKeys,
      );
      expect(result.progress!.episodes, contains('1:1'));
      expect(result.progress!.episodes, contains('1:3'));
      expect(result.progress!.episodes, isNot(contains('1:2')));
    });

    test('removes episode from granular progress', () {
      final entry = WatchEntry(
        progress: WatchProgress(
            version: 1, episodes: const ['1:1', '1:2', '1:3']),
      );
      final result = unmarkEpisodeWatched(entry, 1, 2, allAiredKeys: []);
      expect(result.progress!.episodes, containsAll(['1:1', '1:3']));
      expect(result.progress!.episodes, isNot(contains('1:2')));
    });
  });

  // ─── markSeasonWatched ──────────────────────────────────────────────────────

  group('markSeasonWatched', () {
    test('marks all aired episodes in season', () {
      final result = markSeasonWatched(null, _s1);
      expect(result.progress!.episodes, containsAll(['1:1', '1:2', '1:3']));
    });

    test('does not add unaired episodes', () {
      // Season 2 has ep3 as future-dated → should not be included.
      final result = markSeasonWatched(null, _s2);
      expect(result.progress!.episodes, containsAll(['2:1', '2:2']));
      expect(result.progress!.episodes, isNot(contains('2:3')));
    });

    test('merges with existing progress from other seasons', () {
      final entry = WatchEntry(
        progress: WatchProgress(version: 1, episodes: const ['1:1', '1:2', '1:3']),
      );
      final result = markSeasonWatched(entry, _s2);
      expect(result.progress!.episodes,
          containsAll(['1:1', '1:2', '1:3', '2:1', '2:2']));
    });
  });

  // ─── unmarkSeasonWatched ────────────────────────────────────────────────────

  group('unmarkSeasonWatched', () {
    test('removes all season keys from granular progress', () {
      final entry = WatchEntry(
        progress: WatchProgress(
            version: 1, episodes: const ['1:1', '1:2', '2:1']),
      );
      final result =
          unmarkSeasonWatched(entry, _s1, allAiredKeys: _allAiredRegularKeys);
      expect(result.progress!.episodes, contains('2:1'));
      expect(result.progress!.episodes, isNot(contains('1:1')));
      expect(result.progress!.episodes, isNot(contains('1:2')));
    });

    test('legacy-complete: materialises all aired minus that season', () {
      const entry = WatchEntry();
      final result =
          unmarkSeasonWatched(entry, _s1, allAiredKeys: _allAiredRegularKeys);
      expect(result.progress!.episodes, containsAll(['2:1', '2:2']));
      expect(result.progress!.episodes, isNot(contains('1:1')));
    });
  });

  // ─── markAllWatched / clearAllProgress ─────────────────────────────────────

  group('markAllWatched', () {
    test('marks all aired regular episodes (excludes specials)', () {
      final seasons = [_s0, _s1, _s2];
      final result = markAllWatched(null, seasons);
      expect(result.progress!.episodes,
          containsAll(['1:1', '1:2', '1:3', '2:1', '2:2']));
      // Specials excluded
      expect(result.progress!.episodes, isNot(contains('0:1')));
      // Unaired excluded
      expect(result.progress!.episodes, isNot(contains('2:3')));
    });
  });

  group('clearAllProgress', () {
    test('returns null', () {
      const entry = WatchEntry(rating: 8.0);
      expect(clearAllProgress(entry), isNull);
    });
  });

  group('itemProgressState', () {
    test('null entry → unwatched', () {
      expect(itemProgressState(null), ItemProgressState.unwatched);
    });

    test('legacy-complete entry → watched', () {
      const entry = WatchEntry(rating: 8);
      expect(itemProgressState(entry), ItemProgressState.watched);
    });

    test('empty granular progress → unwatched', () {
      const entry = WatchEntry(progress: WatchProgress.empty);
      expect(itemProgressState(entry), ItemProgressState.unwatched);
    });

    test('partial episodes → inProgress', () {
      const entry = WatchEntry(
        progress: WatchProgress(version: 1, episodes: ['1:1']),
      );
      expect(itemProgressState(entry), ItemProgressState.inProgress);
    });

    test('completed granular → watched', () {
      const entry = WatchEntry(
        progress: WatchProgress(
          version: 1,
          episodes: ['1:1'],
          completed: true,
        ),
      );
      expect(itemProgressState(entry), ItemProgressState.watched);
    });

    test('specials-only episodes → unwatched', () {
      const entry = WatchEntry(
        progress: WatchProgress(version: 1, episodes: ['0:1']),
      );
      expect(itemProgressState(entry), ItemProgressState.unwatched);
    });
  });

  group('moviePosition', () {
    test('getMoviePosition returns 0 when absent', () {
      expect(getMoviePosition(null), 0);
      expect(getMoviePosition(const WatchEntry()), 0);
    });

    test('setMoviePosition stores rounded fraction', () {
      final entry = setMoviePosition(null, 0.4567);
      expect(getMoviePosition(entry), 0.457);
    });

    test('setMoviePosition at 0 clears progress', () {
      final entry = setMoviePosition(
        WatchEntry(
          progress: WatchProgress(
            version: 1,
            episodes: const [],
            moviePosition: 0.5,
          ),
        ),
        0,
      );
      expect(entry?.progress, isNull);
    });

    test('movieWatchState watched at >= 97%', () {
      final entry = setMoviePosition(null, 0.97);
      expect(movieWatchState(entry), WatchState.watched);
    });

    test('movieWatchState inprogress between 0 and 97%', () {
      final entry = setMoviePosition(null, 0.5);
      expect(movieWatchState(entry), WatchState.inprogress);
    });

    test('itemProgressState uses movie semantics for movies', () {
      final entry = setMoviePosition(null, 0.5);
      expect(
        itemProgressState(entry, contentType: 'movies'),
        ItemProgressState.inProgress,
      );
    });

    test('WatchProgress round-trips moviePosition', () {
      final progress = WatchProgress.fromJson({
        'version': 1,
        'episodes': [],
        'moviePosition': 0.333,
      });
      expect(progress.moviePosition, 0.333);
      expect(progress.toJson()['moviePosition'], 0.333);
    });
  });

  // ─── itemWatchState ──────────────────────────────────────────────────────────

  group('itemWatchState', () {
    test('null entry → unwatched', () {
      final r = itemWatchState(null, [_s1, _s2]);
      expect(r.state, WatchState.unwatched);
    });

    test('no episode data → binary watched', () {
      const entry = WatchEntry();
      final r = itemWatchState(entry, null);
      expect(r.state, WatchState.watched);
    });

    test('legacy-complete + seasons → fully watched', () {
      const entry = WatchEntry();
      final r = itemWatchState(entry, [_s1, _s2]);
      expect(r.state, WatchState.watched);
      // Counts only aired regular eps: s1(3) + s2(2) = 5
      expect(r.totalEps, 5);
      expect(r.watchedEps, 5);
    });

    test('granular: 0 eps → unwatched', () {
      final entry = WatchEntry(
        progress: WatchProgress.empty,
      );
      final r = itemWatchState(entry, [_s1]);
      expect(r.state, WatchState.unwatched);
      expect(r.watchedEps, 0);
    });

    test('granular: partial → inprogress', () {
      final entry = WatchEntry(
        progress: WatchProgress(version: 1, episodes: const ['1:1', '1:2']),
      );
      final r = itemWatchState(entry, [_s1]);
      expect(r.state, WatchState.inprogress);
      expect(r.watchedEps, 2);
      expect(r.totalEps, 3);
      expect(r.progressLabel, '2/3');
    });

    test('granular: all aired → watched', () {
      final entry = WatchEntry(
        progress: WatchProgress(
            version: 1, episodes: const ['1:1', '1:2', '1:3']),
      );
      final r = itemWatchState(entry, [_s1]);
      expect(r.state, WatchState.watched);
      expect(r.watchedEps, 3);
      expect(r.totalEps, 3);
    });

    test('specials (season 0) do NOT count toward title completion', () {
      // All regular episodes watched + special NOT watched
      final entry = WatchEntry(
        progress: WatchProgress(
            version: 1, episodes: const ['1:1', '1:2', '1:3']),
      );
      final r = itemWatchState(entry, [_s0, _s1]);
      // Only s1 contributes to total (s0 = specials excluded).
      expect(r.state, WatchState.watched);
      expect(r.totalEps, 3);
    });

    test('unaired episodes do NOT count toward completion', () {
      // s2e3 is unaired; watching s2e1 + s2e2 = fully watched s2.
      final entry = WatchEntry(
        progress: WatchProgress(version: 1, episodes: const ['2:1', '2:2']),
      );
      final r = itemWatchState(entry, [_s2]);
      expect(r.state, WatchState.watched);
      expect(r.totalEps, 2); // not 3
    });

    test('empty season does not block completion', () {
      final emptyS3 = SeasonRef(seasonNumber: 3, episodes: []);
      final entry = WatchEntry(
        progress: WatchProgress(version: 1, episodes: const ['1:1', '1:2', '1:3']),
      );
      // s3 is empty → not counted; s1 fully watched → title complete.
      final r = itemWatchState(entry, [_s1, emptyS3]);
      expect(r.state, WatchState.watched);
    });
  });

  // ─── isSeasonFullyWatched / isSeasonPartiallyWatched ────────────────────────

  group('isSeasonFullyWatched', () {
    test('legacy-complete → true for any season', () {
      const entry = WatchEntry();
      expect(isSeasonFullyWatched(entry, 1, _s1), isTrue);
    });

    test('null entry → false', () {
      expect(isSeasonFullyWatched(null, 1, _s1), isFalse);
    });

    test('all aired eps in season watched → true', () {
      final entry = WatchEntry(
        progress: WatchProgress(version: 1, episodes: const ['1:1', '1:2', '1:3']),
      );
      expect(isSeasonFullyWatched(entry, 1, _s1), isTrue);
    });

    test('only some eps watched → false', () {
      final entry = WatchEntry(
        progress: WatchProgress(version: 1, episodes: const ['1:1']),
      );
      expect(isSeasonFullyWatched(entry, 1, _s1), isFalse);
    });

    test('unaired ep does not prevent full-watched', () {
      // s2 has ep3 unaired; watching ep1+ep2 = full.
      final entry = WatchEntry(
        progress: WatchProgress(version: 1, episodes: const ['2:1', '2:2']),
      );
      expect(isSeasonFullyWatched(entry, 2, _s2), isTrue);
    });
  });

  group('isSeasonPartiallyWatched', () {
    test('legacy-complete → not partial (fully watched)', () {
      const entry = WatchEntry();
      expect(isSeasonPartiallyWatched(entry, 1, _s1), isFalse);
    });

    test('null entry → false', () {
      expect(isSeasonPartiallyWatched(null, 1, _s1), isFalse);
    });

    test('some eps watched → partial', () {
      final entry = WatchEntry(
        progress: WatchProgress(version: 1, episodes: const ['1:1']),
      );
      expect(isSeasonPartiallyWatched(entry, 1, _s1), isTrue);
    });

    test('all eps watched → not partial', () {
      final entry = WatchEntry(
        progress: WatchProgress(version: 1, episodes: const ['1:1', '1:2', '1:3']),
      );
      expect(isSeasonPartiallyWatched(entry, 1, _s1), isFalse);
    });
  });

  // ─── EpisodeRef aired logic ──────────────────────────────────────────────────

  group('EpisodeRef.isAired', () {
    test('null airDate → treated as aired', () {
      final ep = EpisodeRef(seasonNumber: 1, episodeNumber: 1);
      expect(ep.isAired, isTrue);
    });

    test('past airDate → aired', () {
      final ep = EpisodeRef(
          seasonNumber: 1,
          episodeNumber: 1,
          airDate: DateTime(2000));
      expect(ep.isAired, isTrue);
    });

    test('future airDate → not aired', () {
      final ep = EpisodeRef(
          seasonNumber: 1,
          episodeNumber: 1,
          airDate: DateTime.now().add(const Duration(days: 7)));
      expect(ep.isAired, isFalse);
    });
  });

  // ─── WatchStateResult.progressLabel ─────────────────────────────────────────

  group('WatchStateResult.progressLabel', () {
    test('returns empty string with no episode data', () {
      const r = WatchStateResult(state: WatchState.watched);
      expect(r.progressLabel, '');
    });

    test('returns "watched/total" when data present', () {
      const r = WatchStateResult(
          state: WatchState.inprogress, watchedEps: 8, totalEps: 24);
      expect(r.progressLabel, '8/24');
    });
  });
}
