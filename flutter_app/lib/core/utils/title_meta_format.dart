import '../../models/metadata_detail.dart';

enum TitleMetaBadgeKind { age, duration, seasons }

class TitleMetaBadge {
  const TitleMetaBadge({required this.kind, required this.label});

  final TitleMetaBadgeKind kind;
  final String label;
}

/// Badges for cards/detail: age rating, movie duration, TV/anime seasons + ep length.
List<TitleMetaBadge> buildTitleMetaBadges({
  required String contentType,
  String ageRating = '',
  String runtime = '',
  int? seasonCount,
  int? episodeCount,
}) {
  final badges = <TitleMetaBadge>[];
  final age = ageRating.trim();
  final run = runtime.trim();
  final episodeDuration = formatEpisodeDurationLabel(run);

  if (age.isNotEmpty) {
    badges.add(TitleMetaBadge(kind: TitleMetaBadgeKind.age, label: age));
  }

  switch (contentType) {
    case 'movies':
      if (run.isNotEmpty) {
        badges.add(TitleMetaBadge(kind: TitleMetaBadgeKind.duration, label: run));
      }
    case 'tvSeries':
      if (seasonCount != null && seasonCount > 0) {
        badges.add(
          TitleMetaBadge(
            kind: TitleMetaBadgeKind.seasons,
            label: seasonCount == 1 ? '1 season' : '$seasonCount seasons',
          ),
        );
      }
      if (episodeDuration.isNotEmpty) {
        badges.add(
          TitleMetaBadge(
            kind: TitleMetaBadgeKind.duration,
            label: episodeDuration,
          ),
        );
      }
    case 'anime':
      if (seasonCount != null && seasonCount > 0) {
        badges.add(
          TitleMetaBadge(
            kind: TitleMetaBadgeKind.seasons,
            label: seasonCount == 1 ? '1 season' : '$seasonCount seasons',
          ),
        );
      } else if (episodeCount != null && episodeCount > 0) {
        badges.add(
          TitleMetaBadge(
            kind: TitleMetaBadgeKind.seasons,
            label: episodeCount == 1 ? '1 episode' : '$episodeCount episodes',
          ),
        );
      }
      if (episodeDuration.isNotEmpty) {
        badges.add(
          TitleMetaBadge(
            kind: TitleMetaBadgeKind.duration,
            label: episodeDuration,
          ),
        );
      }
  }

  return badges;
}

/// Plain-text parts for link previews (year line + ratings).
List<String> formatTitleMetaParts({
  required String contentType,
  String ageRating = '',
  String runtime = '',
  int? seasonCount,
  int? episodeCount,
}) {
  return buildTitleMetaBadges(
    contentType: contentType,
    ageRating: ageRating,
    runtime: runtime,
    seasonCount: seasonCount,
    episodeCount: episodeCount,
  ).map((badge) => badge.label).toList();
}

int? parsePositiveCount(dynamic raw) {
  if (raw == null) return null;
  if (raw is int) return raw > 0 ? raw : null;
  if (raw is num && raw.isFinite) {
    final value = raw.round();
    return value > 0 ? value : null;
  }
  final parsed = int.tryParse(raw.toString().trim());
  return parsed != null && parsed > 0 ? parsed : null;
}

String formatRuntimeMinutes(int? minutes) {
  if (minutes == null || minutes <= 0) return '';
  return '$minutes min';
}

/// Per-episode label for TV/anime badges (e.g. `~23 min/ep`).
String formatEpisodeDurationLabel(String runtime) {
  final trimmed = runtime.trim();
  if (trimmed.isEmpty) return '';

  if (RegExp(r'/ep', caseSensitive: false).hasMatch(trimmed)) {
    return trimmed.startsWith('~') ? trimmed : '~$trimmed';
  }

  final match = RegExp(r'(\d+)').firstMatch(trimmed);
  final minutes = match != null ? int.tryParse(match.group(1)!) : null;
  if (minutes != null && minutes > 0) return '~$minutes min/ep';

  return '~$trimmed/ep';
}

List<TitleMetaBadge> titleMetaBadgesFromItem({
  required String contentType,
  String? ageRating,
  String? runtime,
  int? seasonCount,
  int? episodeCount,
}) {
  return buildTitleMetaBadges(
    contentType: contentType,
    ageRating: ageRating ?? '',
    runtime: runtime ?? '',
    seasonCount: seasonCount,
    episodeCount: episodeCount,
  );
}

List<TitleMetaBadge> titleMetaBadgesFromDetail(MetadataDetail details) {
  return buildTitleMetaBadges(
    contentType: details.contentType,
    ageRating: details.ageRating,
    runtime: details.runtime,
    seasonCount: details.seasonCount,
    episodeCount: details.episodeCount,
  );
}

List<String> titleMetaPartsFromItem({
  required String contentType,
  String? ageRating,
  String? runtime,
  int? seasonCount,
  int? episodeCount,
}) {
  return titleMetaBadgesFromItem(
    contentType: contentType,
    ageRating: ageRating,
    runtime: runtime,
    seasonCount: seasonCount,
    episodeCount: episodeCount,
  ).map((badge) => badge.label).toList();
}

List<String> titleMetaPartsFromDetail(MetadataDetail details) {
  return titleMetaBadgesFromDetail(details)
      .map((badge) => badge.label)
      .toList();
}
