import 'package:flutter_test/flutter_test.dart';
import 'package:our_movie_nights/core/utils/account_id.dart' show generateListId;
import 'package:our_movie_nights/core/utils/list_name_validator.dart';

void main() {
  group('generateListId', () {
    test('uses lst_ prefix', () {
      expect(generateListId().startsWith('lst_'), isTrue);
    });
  });

  group('validateListNameKey', () {
    test('rejects empty name', () {
      expect(validateListNameKey(''), 'list.nameRequired');
      expect(validateListNameKey('   '), 'list.nameRequired');
    });

    test('rejects long name', () {
      expect(validateListNameKey('a' * 49), 'list.nameTooLong');
    });

    test('accepts valid name', () {
      expect(validateListNameKey('Classic movies'), isNull);
    });
  });
}
