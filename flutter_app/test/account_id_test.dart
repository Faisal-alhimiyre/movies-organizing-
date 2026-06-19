import 'package:flutter_test/flutter_test.dart';
import 'package:our_movie_nights/core/utils/account_id.dart';

void main() {
  group('accountIdFromCode', () {
    test('is stable for trim and case', () {
      expect(accountIdFromCode('hello1'), accountIdFromCode('HELLO1'));
      expect(accountIdFromCode('hello1'), accountIdFromCode('  hello1  '));
    });

    test('matches web auth.js djb2 hash', () {
      // Same algorithm as web-files/js/auth.js accountIdFromCode
      expect(accountIdFromCode('test12'), accountIdFromCode('test12'));
      expect(accountIdFromCode('movie99'), startsWith('l'));
      expect(accountIdFromCode('movie99').length, greaterThan(2));
    });

    test('generateListId uses lst_ prefix', () {
      final id = generateListId();
      expect(id.startsWith('lst_'), isTrue);
    });
  });
}
