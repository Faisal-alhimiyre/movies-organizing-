import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:supabase_flutter/supabase_flutter.dart' hide Session;

import '../core/config/environment.dart';
import '../core/services/session_service.dart';
import '../core/utils/account_id.dart';
import '../core/utils/code_validator.dart';
import '../core/utils/list_name_validator.dart';
import '../models/list_library_entry.dart';
import '../models/session.dart';
import '../models/watchlist_data.dart';
import 'local_storage_repository.dart';
import 'supabase_sync_repository.dart';

class AuthResult {
  const AuthResult.ok(this.session)
      : ok = true,
        errorKey = null;

  const AuthResult.fail(this.errorKey)
      : ok = false,
        session = null;

  final bool ok;
  final Session? session;
  final String? errorKey;
}

class AuthRepository {
  AuthRepository({
    required LocalStorageRepository local,
    required SupabaseSyncRepository? supabase,
    required bool supabaseConfigured,
  })  : _local = local,
        _supabase = supabase,
        _supabaseConfigured = supabaseConfigured;

  final LocalStorageRepository _local;
  final SupabaseSyncRepository? _supabase;
  final bool _supabaseConfigured;

  bool get isCloudMode => _supabaseConfigured;

  Future<bool> accountExists(String code) async {
    final accountId = accountIdFromCode(code);
    if (_local.hasLocalAccountData(accountId)) return true;
    if (_supabaseConfigured && _supabase != null) {
      return _supabase!.accountExists(accountId);
    }
    return false;
  }

  Future<AuthResult> signIn(
    String code, {
    required bool create,
    String listName = 'My list',
    String description = '',
  }) async {
    final errorKey = validateCodeKey(code, forCreate: create);
    if (errorKey != null) {
      return AuthResult.fail(errorKey);
    }

    final accountId = accountIdFromCode(code);

    if (create) {
      final listId = accountId;
      await _local.registerList(
        ListLibraryEntry(
          listId: listId,
          accountId: accountId,
          name: listName,
          description: description,
        ),
      );
      await _local.setEmptyListFlag(listId);

      await _local.setDefaultListId(accountId, listId);

      if (_supabaseConfigured && _supabase != null) {
        await _supabase!.createListRow(
          accountId: accountId,
          listId: listId,
          name: listName,
          description: description,
        );
      }

      return AuthResult.ok(
        Session(accountId: accountId, listId: listId),
      );
    }

    await _local.clearEmptySavedWatchlist(accountId);

    if (_supabaseConfigured && _supabase != null) {
      final remoteLists = await _supabase!.fetchListsForAccount(accountId);
      for (final row in remoteLists) {
        await _local.registerList(
          ListLibraryEntry(
            listId: row.listId,
            accountId: accountId,
            name: row.name,
            description: row.description,
          ),
        );
      }
    }

    await _local.ensureDefaultList(accountId);

    final library = _local.getLibrary(accountId);
    if (library.isEmpty) {
      return AuthResult.fail('gate.noList');
    }

    final defaultListId = _local.getDefaultListId(accountId);
    final activeListId =
        (defaultListId != null && library.any((e) => e.listId == defaultListId))
            ? defaultListId
            : library.first.listId;

    final needsUpgrade = isLegacyNumericCode(code);

    return AuthResult.ok(
      Session(
        accountId: accountId,
        listId: activeListId,
        needsCodeUpgrade: needsUpgrade,
      ),
    );
  }

  Future<void> signOut({bool purgeLocal = false}) async {
    // Session cleared by caller via SessionNotifier
    if (!purgeLocal) return;
    // Full purge handled in delete-account flow (Stage 5+)
  }

  String? listLabel(String? listId, String? accountId) {
    if (listId == null || accountId == null) return null;
    for (final entry in _local.getLibrary(accountId)) {
      if (entry.listId == listId) return entry.name;
    }
    return 'My list';
  }

  List<ListLibraryEntry> getLibrary(String accountId) =>
      _local.getLibrary(accountId);

  Future<void> syncRemoteListLibrary(String accountId) async {
    if (!_supabaseConfigured || _supabase == null) return;
    final remoteLists = await _supabase!.fetchListsForAccount(accountId);
    for (final row in remoteLists) {
      await _local.registerList(
        ListLibraryEntry(
          listId: row.listId,
          accountId: accountId,
          name: row.name,
          description: row.description,
        ),
      );
    }
  }

  String? getDefaultListId(String accountId) =>
      _local.getDefaultListId(accountId);

  Future<bool> assignDefaultList({
    required String accountId,
    required String listId,
  }) async {
    final library = _local.getLibrary(accountId);
    if (!library.any((e) => e.listId == listId)) return false;
    await _local.setDefaultListId(accountId, listId);
    return true;
  }

  String listDescription(String listId, String accountId) {
    for (final entry in _local.getLibrary(accountId)) {
      if (entry.listId == listId) return entry.description;
    }
    return '';
  }

  int listTitleCount(String listId) => _local.getListTitleCount(listId);

  Future<({bool ok, Session? session, String? errorKey})> createList({
    required Session session,
    required String name,
    required String description,
  }) async {
    final nameError = validateListNameKey(name);
    if (nameError != null) {
      return (ok: false, session: null, errorKey: nameError);
    }

    final listId = generateListId();
    final trimmedName = name.trim();
    final trimmedDesc = description.trim();
    final desc =
        trimmedDesc.length > 120 ? trimmedDesc.substring(0, 120) : trimmedDesc;

    await _local.registerList(
      ListLibraryEntry(
        listId: listId,
        accountId: session.accountId,
        name: trimmedName,
        description: desc,
      ),
    );
    await _local.writeWatchlist(listId, WatchlistData.empty());
    await _local.setEmptyListFlag(listId);
    await _local.setLastListId(session.accountId, listId);

    if (_supabaseConfigured && _supabase != null) {
      await _supabase!.createListRow(
        accountId: session.accountId,
        listId: listId,
        name: trimmedName,
        description: desc,
      );
    }

    return (
      ok: true,
      session: Session(
        accountId: session.accountId,
        listId: listId,
        needsCodeUpgrade: session.needsCodeUpgrade,
      ),
      errorKey: null,
    );
  }

  Future<({bool ok, String? errorKey, bool cloudOk})> updateList({
    required Session session,
    required String listId,
    required String name,
    required String description,
  }) async {
    final nameError = validateListNameKey(name);
    if (nameError != null) {
      return (ok: false, errorKey: nameError, cloudOk: true);
    }

    final library = _local.getLibrary(session.accountId);
    final index = library.indexWhere((e) => e.listId == listId);
    if (index < 0) {
      return (ok: false, errorKey: 'list.notFound', cloudOk: true);
    }

    final trimmedName = name.trim();
    final trimmedDesc = description.trim();
    final desc =
        trimmedDesc.length > 120 ? trimmedDesc.substring(0, 120) : trimmedDesc;

    library[index] = library[index].copyWith(
      name: trimmedName,
      description: desc,
      updatedAt: DateTime.now().millisecondsSinceEpoch,
    );
    await _local.saveLibrary(session.accountId, library);

    var cloudOk = true;
    if (_supabaseConfigured && _supabase != null) {
      cloudOk = await _supabase!.updateListMeta(
        listId: listId,
        accountId: session.accountId,
        name: trimmedName,
        description: desc,
      );
    }

    return (ok: true, errorKey: null, cloudOk: cloudOk);
  }

  Future<({bool ok, Session? session, bool signedOut, bool cloudOk})>
      deleteList({
    required Session session,
    required String listId,
  }) async {
    final library = _local.getLibrary(session.accountId);
    if (!library.any((e) => e.listId == listId)) {
      return (ok: false, session: session, signedOut: false, cloudOk: true);
    }

    var cloudOk = true;
    if (_supabaseConfigured && _supabase != null) {
      cloudOk = await _supabase!.deleteList(listId);
    }

    await _local.purgeList(listId, session.accountId);

    final remaining = _local.getLibrary(session.accountId);
    if (listId != session.listId) {
      return (ok: true, session: session, signedOut: false, cloudOk: cloudOk);
    }

    if (remaining.isEmpty) {
      return (ok: true, session: null, signedOut: true, cloudOk: cloudOk);
    }

    final defaultId = _local.getDefaultListId(session.accountId);
    final nextListId =
        (defaultId != null && remaining.any((e) => e.listId == defaultId))
            ? defaultId
            : remaining.first.listId;
    return (
      ok: true,
      session: Session(
        accountId: session.accountId,
        listId: nextListId,
        needsCodeUpgrade: session.needsCodeUpgrade,
      ),
      signedOut: false,
      cloudOk: cloudOk,
    );
  }

  ({bool ok, String? errorKey, String? oldAccountId, String? newAccountId})
      prepareChangeCode({
    required Session session,
    required String newCode,
  }) {
    final errorKey = validateCodeKey(newCode, forCreate: true);
    if (errorKey != null) {
      return (
        ok: false,
        errorKey: errorKey,
        oldAccountId: null,
        newAccountId: null
      );
    }

    final oldAccountId = session.accountId;
    final newAccountId = accountIdFromCode(newCode.trim().toLowerCase());
    if (newAccountId == oldAccountId) {
      return (
        ok: false,
        errorKey: 'changeCode.sameCode',
        oldAccountId: null,
        newAccountId: null,
      );
    }

    return (
      ok: true,
      errorKey: null,
      oldAccountId: oldAccountId,
      newAccountId: newAccountId,
    );
  }

  List<AccountListMigrationPayload> _readAccountListPayloads(String accountId) {
    return getLibrary(accountId).map((entry) {
      final watchlist =
          _local.readWatchlist(entry.listId) ?? WatchlistData.empty();
      return AccountListMigrationPayload(
        listId: entry.listId,
        name: entry.name,
        description: entry.description,
        watchlist: watchlist,
        watched: _local.readWatchedJson(entry.listId),
      );
    }).toList();
  }

  Future<({bool ok, String? errorKey, String? newAccountId})>
      changeAccountCode({
    required Session session,
    required String newCode,
    required String confirmCode,
  }) async {
    if (newCode.trim() != confirmCode.trim()) {
      return (
        ok: false,
        errorKey: 'changeCode.codesMismatch',
        newAccountId: null
      );
    }

    final prep = prepareChangeCode(session: session, newCode: newCode);
    if (!prep.ok) {
      return (ok: false, errorKey: prep.errorKey, newAccountId: null);
    }

    if (_local.codeHasLocalList(newCode)) {
      return (ok: false, errorKey: 'changeCode.codeInUse', newAccountId: null);
    }

    if (_supabaseConfigured && _supabase != null) {
      if (await _supabase!.accountExists(prep.newAccountId!)) {
        return (
          ok: false,
          errorKey: 'changeCode.codeInUse',
          newAccountId: null
        );
      }

      final lists = _readAccountListPayloads(prep.oldAccountId!);
      final migrated = await _supabase!.migrateAccount(
        oldAccountId: prep.oldAccountId!,
        newAccountId: prep.newAccountId!,
        lists: lists,
      );
      if (!migrated) {
        return (
          ok: false,
          errorKey: 'changeCode.cloudFailed',
          newAccountId: null
        );
      }
    }

    await _local.migrateLocalAccount(
      oldAccountId: prep.oldAccountId!,
      newAccountId: prep.newAccountId!,
      currentListId: session.listId,
    );

    return (ok: true, errorKey: null, newAccountId: prep.newAccountId);
  }

  Future<({bool ok, bool cloudOk})> deleteAccount(Session session) async {
    var cloudOk = true;
    if (_supabaseConfigured && _supabase != null) {
      cloudOk = await _supabase!.deleteAccount(session.accountId);
    }

    await _local.purgeAccount(session.accountId);
    return (ok: true, cloudOk: cloudOk);
  }
}

final localStorageRepositoryProvider = Provider<LocalStorageRepository>(
  (ref) => LocalStorageRepository(),
);

final supabaseSyncRepositoryProvider = Provider<SupabaseSyncRepository?>((ref) {
  final config = ref.watch(appConfigProvider);
  if (!config.isSupabaseConfigured) return null;
  try {
    return SupabaseSyncRepository(Supabase.instance.client);
  } catch (_) {
    return null;
  }
});

final authRepositoryProvider = Provider<AuthRepository>((ref) {
  final config = ref.watch(appConfigProvider);
  return AuthRepository(
    local: ref.watch(localStorageRepositoryProvider),
    supabase: ref.watch(supabaseSyncRepositoryProvider),
    supabaseConfigured: config.isSupabaseConfigured,
  );
});

final cloudModeProvider = Provider<bool>((ref) {
  return ref.watch(authRepositoryProvider).isCloudMode;
});
