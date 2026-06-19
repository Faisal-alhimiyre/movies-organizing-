/// Full metadata payload after lookup — mirrors `metadata.js` → `buildDetailPayload`.
class MetadataDetail {
  const MetadataDetail({
    required this.source,
    required this.title,
    this.imdbId,
    this.anilistId,
    this.tmdbType,
    this.tmdbId,
    this.link = '',
    this.poster = '',
    this.rating = '',
    this.anilistRating = '',
    this.year = '',
    this.plot = '',
    this.runtime = '',
    this.director = '',
    this.actors = const [],
    this.genres = const [],
    this.contentType = 'movies',
  });

  final String source;
  final String title;
  final String? imdbId;
  final int? anilistId;
  final String? tmdbType;
  final int? tmdbId;
  final String link;
  final String poster;
  final String rating;
  final String anilistRating;
  final String year;
  final String plot;
  final String runtime;
  final String director;
  final List<String> actors;
  final List<String> genres;
  final String contentType;

  Map<String, dynamic> toCacheJson() => {
        'source': source,
        'title': title,
        'imdbId': imdbId,
        'anilistId': anilistId,
        'tmdbType': tmdbType,
        'tmdbId': tmdbId,
        'link': link,
        'poster': poster,
        'rating': rating,
        'anilistRating': anilistRating,
        'year': year,
        'plot': plot,
        'runtime': runtime,
        'director': director,
        'actors': actors,
        'genres': genres,
        'contentType': contentType,
      };

  factory MetadataDetail.fromCacheJson(Map<String, dynamic> json) {
    return MetadataDetail(
      source: json['source']?.toString() ?? 'omdb',
      title: json['title']?.toString() ?? '',
      imdbId: json['imdbId']?.toString(),
      anilistId: json['anilistId'] is int
          ? json['anilistId'] as int
          : int.tryParse(json['anilistId']?.toString() ?? ''),
      tmdbType: json['tmdbType']?.toString(),
      tmdbId: json['tmdbId'] is int
          ? json['tmdbId'] as int
          : int.tryParse(json['tmdbId']?.toString() ?? ''),
      link: json['link']?.toString() ?? '',
      poster: json['poster']?.toString() ?? '',
      rating: json['rating']?.toString() ?? '',
      anilistRating: json['anilistRating']?.toString() ?? '',
      year: json['year']?.toString() ?? '',
      plot: json['plot']?.toString() ?? '',
      runtime: json['runtime']?.toString() ?? '',
      director: json['director']?.toString() ?? '',
      actors: (json['actors'] as List?)?.map((e) => e.toString()).toList() ?? const [],
      genres: (json['genres'] as List?)?.map((e) => e.toString()).toList() ?? const [],
      contentType: json['contentType']?.toString() ?? 'movies',
    );
  }
}
