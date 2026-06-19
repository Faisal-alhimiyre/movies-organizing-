import '../constants/storage_keys.dart';
import '../storage/hive_boxes.dart';
import 'pending_share_storage.dart';

/// Resolves a pending share id from route query, browser URL, or local storage.
String? resolvePendingShareId({String? fromRoute}) {
  final route = fromRoute?.trim();
  if (route != null && route.isNotEmpty) return route;

  final fromBrowser = Uri.base.queryParameters['share']?.trim();
  if (fromBrowser != null && fromBrowser.isNotEmpty) return fromBrowser;

  final fromLocation = readShareFromLocation();
  if (fromLocation != null && fromLocation.isNotEmpty) return fromLocation;

  final fromSession = readPendingShareSession();
  if (fromSession != null && fromSession.isNotEmpty) return fromSession;

  final stored = HiveBoxes.preferences.get(StorageKeys.pendingShare);
  if (stored is String) {
    final id = stored.trim();
    if (id.isNotEmpty) return id;
  }

  return null;
}

Future<void> persistPendingShareId(String? shareId) async {
  final id = shareId?.trim();
  if (id == null || id.isEmpty) return;
  writePendingShareSession(id);
  await HiveBoxes.preferences.put(StorageKeys.pendingShare, id);
}

Future<void> clearPendingShareId() async {
  clearPendingShareSession();
  await HiveBoxes.preferences.delete(StorageKeys.pendingShare);
}

String homeWithShareQuery(String shareId) =>
    '/?share=${Uri.encodeComponent(shareId.trim())}';
