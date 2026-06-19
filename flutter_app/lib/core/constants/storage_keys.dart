/// Mirrors `watchlist-*` keys from the static web app (`web-files/js/auth.js`).
abstract final class StorageKeys {
  static const session = 'watchlist-session-v2';
  static const lang = 'watchlist-lang-v1';
  static const theme = 'watchlist-theme-v1';
  static const cardLayout = 'watchlist-card-layout-v2';
  static const pendingShare = 'watchlist-pending-share';

  static String library(String accountId) => 'watchlist-library-v2-$accountId';
  static String lastList(String accountId) => 'watchlist-last-list-$accountId';
  static String data(String listId) => 'watchlist-data-v2-$listId';
  static String watched(String listId) => 'watchlist-watched-v1-$listId';
  static String syncMeta(String listId) => 'watchlist-sync-meta-$listId';
  static String startEmpty(String listId) => 'watchlist-start-empty-$listId';
}
