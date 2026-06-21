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
