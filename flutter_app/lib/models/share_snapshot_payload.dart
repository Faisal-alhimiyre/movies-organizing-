import 'watchlist_data.dart';

class ShareSnapshotPayload {
  const ShareSnapshotPayload({
    required this.listName,
    required this.watchlist,
    this.listDescription = '',
    this.watched = const {},
    this.formatVersion = 2,
    this.app = 'Our Movie Nights',
    this.exportedAt,
    this.stats = const {},
  });

  final int formatVersion;
  final String app;
  final String? exportedAt;
  final String listName;
  final String listDescription;
  final WatchlistData watchlist;
  final Map<String, dynamic> watched;
  final Map<String, dynamic> stats;

  factory ShareSnapshotPayload.fromJson(Map<String, dynamic> json) {
    final watchlistRaw = json['watchlist'];
    return ShareSnapshotPayload(
      formatVersion: json['formatVersion'] as int? ?? 2,
      app: json['app'] as String? ?? 'Our Movie Nights',
      exportedAt: json['exportedAt'] as String?,
      listName: json['listName'] as String? ?? 'Shared list',
      listDescription: json['listDescription'] as String? ?? '',
      watchlist: watchlistRaw is Map
          ? WatchlistData.fromJson(Map<String, dynamic>.from(watchlistRaw))
          : WatchlistData.empty(),
      watched: json['watched'] is Map
          ? Map<String, dynamic>.from(json['watched'] as Map)
          : {},
      stats: json['stats'] is Map
          ? Map<String, dynamic>.from(json['stats'] as Map)
          : {},
    );
  }

  Map<String, dynamic> toJson() => {
        'formatVersion': formatVersion,
        'app': app,
        'exportedAt': exportedAt ?? DateTime.now().toUtc().toIso8601String(),
        'listName': listName,
        'listDescription': listDescription,
        'watchlist': watchlist.toJson(),
        'watched': watched,
        'stats': stats,
      };

  int get titleCount {
    final fromStats = stats['titles'];
    if (fromStats is int) return fromStats;
    if (fromStats is num) return fromStats.toInt();
    return countTitlesInWatchlist(watchlist);
  }

  bool get isValid => !watchlist.isEmpty;
}

int countTitlesInWatchlist(WatchlistData data) {
  var count = 0;
  for (final section in [data.movies, data.tvSeries, data.anime]) {
    for (final titles in section.values) {
      count += titles.length;
    }
  }
  return count;
}
