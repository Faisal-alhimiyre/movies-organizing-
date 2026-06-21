import '../../models/watchlist_item.dart';

double clampRatingValue(double value) {
  return (value.clamp(0, 10) * 10).roundToDouble() / 10;
}

double? parseWatchRating(dynamic raw) {
  final trimmed = raw?.toString().trim().replaceAll(',', '.') ?? '';
  if (trimmed.isEmpty) return null;

  final num = double.tryParse(trimmed);
  if (num == null || !num.isFinite || num < 0 || num > 10) return null;

  return (num * 100).roundToDouble() / 100;
}

String formatWatchRating(double rating) {
  if (!rating.isFinite) return '0';
  if (rating.truncateToDouble() == rating) return rating.toInt().toString();
  return rating.toStringAsFixed(1);
}

bool hasWatchRating(WatchEntry? entry) {
  final rating = entry?.rating;
  return rating != null && rating.isFinite;
}

bool watchEntryHasUserData(WatchEntry? entry) {
  if (entry == null) return false;
  return hasWatchRating(entry) ||
      (entry.note != null && entry.note!.trim().isNotEmpty);
}

String? formatImdbDisplay(String? raw) {
  final num = double.tryParse(raw?.replaceAll(',', '.') ?? '');
  if (num == null || !num.isFinite) return null;
  return num == num.roundToDouble()
      ? num.round().toString()
      : num.toStringAsFixed(1);
}

String? formatAnilistDisplay(String? raw) {
  final num = double.tryParse(raw?.replaceAll(',', '.') ?? '');
  if (num == null || !num.isFinite) return null;
  final pct = num > 10 ? num.round() : (num * 10).round();
  return '$pct%';
}
