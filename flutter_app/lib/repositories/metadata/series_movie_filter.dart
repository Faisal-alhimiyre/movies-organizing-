import '../../models/series_metadata.dart';

final _tvSpecialNonMovieTitle = RegExp(
  r'\b(story\s+so\s+far|recap|making\s+of|behind\s+the\s+scenes|featurette|trailer|preview|deleted\s+scenes?|clip\s+show|retrospective|look\s+back|highlights?)\b',
  caseSensitive: false,
);

/// Recaps, making-ofs, etc. — stay in Specials only, not the Movies tab.
bool isTvSpecialNonMovie(EpisodeDetail episode) {
  final title = episode.title.trim();
  if (title.isEmpty) return false;
  if (_tvSpecialNonMovieTitle.hasMatch(title)) return true;
  if (RegExp(r'^the\s+making\b', caseSensitive: false).hasMatch(title)) {
    return true;
  }
  return false;
}

/// TV feature films in season 0: TVDB [isMovie]/[linkedMovieId] when present,
/// else long runtime (80+ min) excluding obvious non-movie specials.
bool isMovieLikeTvSpecial(EpisodeDetail episode) {
  if (episode.isMovie == true) return true;
  final linked = episode.linkedMovieId;
  if (linked != null && linked > 0) return true;
  if (isTvSpecialNonMovie(episode)) return false;
  final runtime = episode.runtimeMinutes;
  return runtime != null && runtime >= 80;
}

/// Drop TV feature films from the Specials episode list (they live in Movies tab).
List<EpisodeDetail> filterSpecialsEpisodes(List<EpisodeDetail> season0) =>
    season0.where((ep) => !isMovieLikeTvSpecial(ep)).toList();
