import 'package:flutter_test/flutter_test.dart';
import 'package:our_movie_nights/core/utils/code_validator.dart';

void main() {
  group('validateCodeKey', () {
    test('rejects spaces', () {
      expect(validateCodeKey('ab cd1', forCreate: true), 'auth.spaces');
    });

    test('requires min length for create', () {
      expect(validateCodeKey('ab1', forCreate: true), 'auth.minLength');
    });

    test('requires letter and number', () {
      expect(validateCodeKey('abcdef', forCreate: true), 'auth.needNumber');
      expect(validateCodeKey('123456', forCreate: true), 'auth.needLetter');
    });

    test('allows legacy numeric codes on login', () {
      expect(validateCodeKey('12345', forCreate: false), isNull);
    });

    test('accepts valid create code', () {
      expect(validateCodeKey('movie99', forCreate: true), isNull);
    });
  });

  group('evaluateCodeRules', () {
    test('tracks partial progress', () {
      final checks = evaluateCodeRules('mov');
      expect(checks.length, isFalse);
      expect(checks.alnum, isFalse);
      expect(checks.spaces, isTrue);

      final ok = evaluateCodeRules('movie9');
      expect(ok.length, isTrue);
      expect(ok.alnum, isTrue);
      expect(ok.spaces, isTrue);
    });
  });
}
