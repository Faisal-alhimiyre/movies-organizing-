import 'package:flutter_test/flutter_test.dart';
import 'package:our_movie_nights/core/utils/account_id.dart';
import 'package:our_movie_nights/models/session.dart';
import 'package:our_movie_nights/repositories/auth_repository.dart';
import 'package:our_movie_nights/repositories/local_storage_repository.dart';

void main() {
  test('prepareChangeCode rejects equivalent code', () {
    final auth = AuthRepository(
      local: LocalStorageRepository(),
      supabase: null,
      supabaseConfigured: false,
    );
    const code = 'Movie1';
    final session = Session(
      accountId: accountIdFromCode(code),
      listId: accountIdFromCode(code),
    );

    final prep = auth.prepareChangeCode(session: session, newCode: 'movie1');
    expect(prep.ok, isFalse);
    expect(prep.errorKey, 'changeCode.sameCode');
  });

  test('prepareChangeCode accepts different valid code', () {
    final auth = AuthRepository(
      local: LocalStorageRepository(),
      supabase: null,
      supabaseConfigured: false,
    );
    final session = Session(
      accountId: accountIdFromCode('Movie1'),
      listId: accountIdFromCode('Movie1'),
    );

    final prep = auth.prepareChangeCode(session: session, newCode: 'Night2');
    expect(prep.ok, isTrue);
    expect(prep.newAccountId, isNot(session.accountId));
  });
}
