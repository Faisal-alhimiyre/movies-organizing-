import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../constants/storage_keys.dart';
import '../storage/hive_boxes.dart';
import '../../models/session.dart';

class SessionNotifier extends Notifier<Session?> {
  @override
  Session? build() {
    final raw = HiveBoxes.readSession();
    if (raw == null) return null;
    return Session.fromJson(raw);
  }

  Future<void> setSession(Session session) async {
    await HiveBoxes.saveSession(session.toJson());
    state = session;
  }

  Future<void> clearSession() async {
    await HiveBoxes.saveSession(null);
    state = null;
  }

  Future<void> switchList(String listId) async {
    final current = state;
    if (current == null || listId.isEmpty || current.listId == listId) return;

    final library = HiveBoxes.preferences.get(
      StorageKeys.library(current.accountId),
    );
    if (library is List) {
      final ids = library
          .whereType<Map>()
          .map((e) => e['listId']?.toString() ?? '')
          .where((id) => id.isNotEmpty);
      if (!ids.contains(listId)) return;
    }

    final next = Session(
      accountId: current.accountId,
      listId: listId,
      needsCodeUpgrade: current.needsCodeUpgrade,
    );
    await HiveBoxes.saveSession(next.toJson());
    state = next;
  }
}

final sessionProvider =
    NotifierProvider<SessionNotifier, Session?>(SessionNotifier.new);

final isAuthenticatedProvider = Provider<bool>((ref) {
  return ref.watch(sessionProvider)?.isAuthenticated ?? false;
});
