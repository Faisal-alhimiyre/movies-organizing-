/// Nested watchlist shape from `web-files/js/auth.js` → `emptyWatchlist()`.
class WatchlistData {
  const WatchlistData({
    this.movies = const {},
    this.tvSeries = const {},
    this.anime = const {},
  });

  final Map<String, List<dynamic>> movies;
  final Map<String, List<dynamic>> tvSeries;
  final Map<String, List<dynamic>> anime;

  static WatchlistData empty() => const WatchlistData();

  factory WatchlistData.fromJson(Map<String, dynamic> json) {
    Map<String, List<dynamic>> parseSection(dynamic raw) {
      if (raw is! Map) return {};
      return raw.map(
        (key, value) => MapEntry(
          key.toString(),
          value is List ? List<dynamic>.from(value) : <dynamic>[],
        ),
      );
    }

    return WatchlistData(
      movies: parseSection(json['movies']),
      tvSeries: parseSection(json['tvSeries']),
      anime: parseSection(json['anime']),
    );
  }

  Map<String, dynamic> toJson() => {
        'movies': movies,
        'tvSeries': tvSeries,
        'anime': anime,
      };

  bool get isEmpty {
    for (final section in [movies, tvSeries, anime]) {
      for (final titles in section.values) {
        if (titles.isNotEmpty) return false;
      }
    }
    return true;
  }
}
