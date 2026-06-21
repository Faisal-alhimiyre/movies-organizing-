import '../../../core/utils/watchlist_parser.dart';
import '../../../models/watchlist_item.dart';

WatchlistItem buildListItemCopy(
  WatchlistItem item, {
  int? addedAt,
}) {
  return WatchlistItem(
    id: makeItemId(item.contentType, item.genre, item.title),
    contentType: item.contentType,
    genre: item.genre,
    title: item.title,
    lead: item.lead,
    summary: item.summary,
    kind: item.kind,
    link: item.link,
    poster: item.poster,
    imdbRating: item.imdbRating,
    anilistRating: item.anilistRating,
    year: item.year,
    addedAt: addedAt ?? DateTime.now().millisecondsSinceEpoch,
    secondaryGenres: item.secondaryGenres,
  );
}

String? copyItemValidationError({
  required String sourceListId,
  required String targetListId,
  required List<WatchlistItem> targetItems,
  required WatchlistItem copy,
}) {
  if (targetListId == sourceListId) return 'move.alreadyOnThisList';
  if (findDuplicateTitle(targetItems, copy) != null) {
    return 'move.alreadyOnList';
  }
  return null;
}
