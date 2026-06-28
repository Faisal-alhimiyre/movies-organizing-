import 'dart:convert';

import 'package:flutter/services.dart';

import '../../models/series_metadata.dart';

class _AniFillerShowEntry {
  _AniFillerShowEntry({
    required this.episodeKinds,
    required this.hasBadge,
    required this.hasHideable,
  });

  final Map<int, String> episodeKinds;
  final bool hasBadge;
  final bool hasHideable;
}

/// Anime filler/canon labels from the AniFiller community dataset.
/// https://github.com/AniraTeam/AniFiller
class AniFillerService {
  AniFillerService._();

  static final AniFillerService instance = AniFillerService._();

  static const _badgeKinds = {'filler'};
  static const _hideKinds = {'filler'};

  Map<int, _AniFillerShowEntry>? _byAnilist;
  Map<int, _AniFillerShowEntry>? _byMal;
  Future<void>? _loadFuture;

  Future<void> ensureLoaded() {
    if (_byAnilist != null) return Future.value();
    _loadFuture ??= _load();
    return _loadFuture!;
  }

  Future<void> _load() async {
    try {
      final raw =
          await rootBundle.loadString('assets/data/anifiller.min.json');
      final decoded = jsonDecode(raw);
      final shows = decoded is List
          ? decoded.cast<Map<String, dynamic>>()
          : <Map<String, dynamic>>[];
      _buildIndex(shows);
    } catch (_) {
      _byAnilist = {};
      _byMal = {};
    }
  }

  void _buildIndex(List<Map<String, dynamic>> shows) {
    final byAnilist = <int, _AniFillerShowEntry>{};
    final byMal = <int, _AniFillerShowEntry>{};

    for (final show in shows) {
      final mappings = show['mappings'];
      if (mappings is! Map) continue;
      final anilistId = _positiveInt(mappings['anilist_id']);
      final malId = _positiveInt(mappings['mal_id']);
      final episodes = show['episodes'];
      if (episodes is! List) continue;

      final kinds = <int, String>{};
      var hasBadge = false;
      var hasHideable = false;
      for (final rawEp in episodes) {
        if (rawEp is! Map) continue;
        final num = _positiveInt(rawEp['episode']);
        final type = rawEp['type']?.toString().trim() ?? '';
        if (num == null || type.isEmpty) continue;
        kinds[num] = type;
        if (_badgeKinds.contains(type)) hasBadge = true;
        if (_hideKinds.contains(type)) hasHideable = true;
      }
      if (kinds.isEmpty) continue;

      final entry = _AniFillerShowEntry(
        episodeKinds: kinds,
        hasBadge: hasBadge,
        hasHideable: hasHideable,
      );
      if (anilistId != null) byAnilist[anilistId] = entry;
      if (malId != null) byMal[malId] = entry;
    }

    _byAnilist = byAnilist;
    _byMal = byMal;
  }

  int? _positiveInt(dynamic value) {
    final n = value is int ? value : int.tryParse(value?.toString() ?? '');
    if (n == null || n <= 0) return null;
    return n;
  }

  _AniFillerShowEntry? _lookup(int? anilistId, int? malId) {
    if (_byAnilist == null) return null;
    if (anilistId != null && _byAnilist!.containsKey(anilistId)) {
      return _byAnilist![anilistId];
    }
    if (malId != null && _byMal!.containsKey(malId)) {
      return _byMal![malId];
    }
    return null;
  }

  bool hasFillerUi(int? anilistId, [int? malId]) =>
      _lookup(anilistId, malId)?.hasBadge ?? false;

  bool hasHideableFiller(int? anilistId, [int? malId]) =>
      _lookup(anilistId, malId)?.hasHideable ?? false;

  bool isBadgeKind(String? kind) =>
      kind != null && _badgeKinds.contains(kind);

  bool shouldHideEpisode(EpisodeDetail ep, bool hideFiller) =>
      hideFiller && ep.fillerKind != null && _hideKinds.contains(ep.fillerKind);

  ({List<EpisodeDetail> episodes, bool hasFillerUi, bool hasHideable})
      enrichEpisodes(
    int? anilistId,
    int? malId,
    List<EpisodeDetail> episodes,
  ) {
    final entry = _lookup(anilistId, malId);
    if (entry == null) {
      return (
        episodes: episodes,
        hasFillerUi: false,
        hasHideable: false,
      );
    }

    final enriched = episodes.map((ep) {
      final kind = entry.episodeKinds[ep.episodeNumber];
      if (kind == null || !_badgeKinds.contains(kind)) return ep;
      return ep.copyWith(fillerKind: kind);
    }).toList();

    return (
      episodes: enriched,
      hasFillerUi: entry.hasBadge,
      hasHideable: entry.hasHideable,
    );
  }
}
