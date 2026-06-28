import '../../models/metadata_detail.dart';

enum TitleMetaBadgeKind { age, duration, seasons, episodes }

class TitleMetaBadge {
  const TitleMetaBadge({
    required this.kind,
    required this.label,
    this.tooltip,
  });

  final TitleMetaBadgeKind kind;
  final String label;
  /// Original API value (e.g. `TV-MA`) for tooltips; display uses [label].
  final String? tooltip;
}

/// Normalize stored age-rating codes for lookup (storage value unchanged).
String normalizeAgeRatingKey(String raw) {
  return raw.trim().toUpperCase().replaceAll(RegExp(r'\s+'), ' ');
}

/// Canonical maturity bucket for a stored age-rating code, if recognized.
String? ageRatingCategory(String raw) {
  final trimmed = raw.trim();
  if (trimmed.isEmpty) return null;

  final key = normalizeAgeRatingKey(trimmed);
  final compact = key.replaceAll(RegExp(r'[-\s]'), '');

  if (key == 'G' || key == 'TV-G' || compact == 'TVG') return 'allAges';
  if (key == 'TV-Y' || compact == 'TVY') return 'kids';
  if (key == 'TV-Y7' ||
      key == 'TV-Y7-FV' ||
      compact == 'TVY7' ||
      compact == 'TVY7FV') {
    return 'ages7';
  }
  if (key == 'PG' || key == 'TV-PG' || compact == 'TVPG') {
    return 'parentalGuidance';
  }
  if (key == 'PG-13' || compact == 'PG13') return 'ages13';
  if (key == 'TV-14' || compact == 'TV14') return 'ages14';
  if (key == 'R' || key == 'TV-MA' || compact == 'TVMA') return 'ages17';
  if (key == 'NC-17' ||
      key == 'NC17' ||
      key == '18+' ||
      key == '18' ||
      compact == 'NC17') {
    return 'adultsOnly';
  }
  if (key == 'NR' ||
      key == 'UNRATED' ||
      key == 'NOT RATED' ||
      compact == 'NOTRATED') {
    return 'unrated';
  }
  return null;
}

/// Sort rank for age-rating order: All ages (lowest) → Adults only (highest).
int? ageRatingSortRank(String? raw) {
  final trimmed = raw?.trim() ?? '';
  if (trimmed.isEmpty) return null;

  final category = ageRatingCategory(trimmed);
  if (category != null) {
    return switch (category) {
      'allAges' => 10,
      'kids' => 20,
      'ages7' => 30,
      'unrated' => 35,
      'parentalGuidance' => 40,
      'ages13' => 50,
      'ages14' => 60,
      'ages17' => 70,
      'adultsOnly' => 80,
      _ => 55,
    };
  }

  // Unknown regional codes still sort, but after known US buckets.
  return 55;
}

/// User-facing age label; [raw] is still stored/synced as returned by APIs.
String formatAgeRatingDisplay(String raw, {bool arabic = false}) {
  final trimmed = raw.trim();
  if (trimmed.isEmpty) return '';

  final category = ageRatingCategory(trimmed);
  if (category == null) return trimmed;

  if (arabic) {
    return switch (category) {
      'allAges' => 'لجميع الأعمار',
      'kids' => 'للأطفال',
      'ages7' => '7+',
      'parentalGuidance' => 'يُفضّل الإشراف',
      'ages13' => '13+',
      'ages14' => '14+',
      'ages17' => '17+',
      'adultsOnly' => 'للبالغين',
      'unrated' => 'غير مصنّف',
      _ => trimmed,
    };
  }

  return switch (category) {
    'allAges' => 'All ages',
    'kids' => 'Kids',
    'ages7' => 'Ages 7+',
    'parentalGuidance' => 'Parental guidance',
    'ages13' => 'Ages 13+',
    'ages14' => 'Ages 14+',
    'ages17' => 'Ages 17+',
    'adultsOnly' => 'Adults only',
    'unrated' => 'Unrated',
    _ => trimmed,
  };
}

String episodesBadgeLabel(int count) {
  return count == 1 ? '1 episode' : '$count episodes';
}

/// Badges for cards/detail: age rating, movie duration, TV/anime seasons + ep length.
List<TitleMetaBadge> buildTitleMetaBadges({
  required String contentType,
  String ageRating = '',
  String runtime = '',
  int? seasonCount,
  int? episodeCount,
  String Function(String raw)? formatAgeRating,
  bool arabic = false,
}) {
  final badges = <TitleMetaBadge>[];
  final age = ageRating.trim();
  final run = runtime.trim();
  final episodeDuration = formatEpisodeDurationLabel(run, arabic: arabic);

  if (age.isNotEmpty) {
    final label = formatAgeRating?.call(age) ?? formatAgeRatingDisplay(age);
    badges.add(
      TitleMetaBadge(
        kind: TitleMetaBadgeKind.age,
        label: label,
        tooltip: age,
      ),
    );
  }

  switch (contentType) {
    case 'movies':
      if (run.isNotEmpty) {
        badges.add(TitleMetaBadge(kind: TitleMetaBadgeKind.duration, label: run));
      }
    case 'tvSeries':
      if (episodeCount != null && episodeCount > 0) {
        badges.add(
          TitleMetaBadge(
            kind: TitleMetaBadgeKind.episodes,
            label: episodesBadgeLabel(episodeCount),
          ),
        );
      }
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
      if (episodeCount != null && episodeCount > 0) {
        badges.add(
          TitleMetaBadge(
            kind: TitleMetaBadgeKind.episodes,
            label: episodesBadgeLabel(episodeCount),
          ),
        );
      }
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

/// First integer in a runtime string (e.g. `"148 min"` → 148). Mirrors web `parseRuntimeMinutes`.
int? parseRuntimeMinutes(String? runtime) {
  final raw = runtime?.trim() ?? '';
  if (raw.isEmpty) return null;
  final match = RegExp(r'(\d{1,4})').firstMatch(raw);
  if (match == null) return null;
  final minutes = int.tryParse(match.group(1)!);
  if (minutes == null || minutes <= 0) return null;
  return minutes;
}

String formatRuntimeMinutes(int? minutes, {bool arabic = false}) {
  if (minutes == null || minutes <= 0) return '';
  return arabic ? '$minutes دقيقة' : '$minutes min';
}

/// Per-episode label for TV/anime badges (e.g. `~23 min/ep`).
String formatEpisodeDurationLabel(String runtime, {bool arabic = false}) {
  final trimmed = runtime.trim();
  if (trimmed.isEmpty) return '';

  if (RegExp(r'/ep', caseSensitive: false).hasMatch(trimmed)) {
    return trimmed.startsWith('~') ? trimmed : '~$trimmed';
  }

  final match = RegExp(r'(\d+)').firstMatch(trimmed);
  final minutes = match != null ? int.tryParse(match.group(1)!) : null;
  if (minutes != null && minutes > 0) {
    return arabic ? '~$minutes دقيقة/ح' : '~$minutes min/ep';
  }

  return '~$trimmed/ep';
}

List<TitleMetaBadge> titleMetaBadgesFromItem({
  required String contentType,
  String? ageRating,
  String? runtime,
  int? seasonCount,
  int? episodeCount,
  String Function(String raw)? formatAgeRating,
  bool arabic = false,
}) {
  return buildTitleMetaBadges(
    contentType: contentType,
    ageRating: ageRating ?? '',
    runtime: runtime ?? '',
    seasonCount: seasonCount,
    episodeCount: episodeCount,
    formatAgeRating: formatAgeRating,
    arabic: arabic,
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
