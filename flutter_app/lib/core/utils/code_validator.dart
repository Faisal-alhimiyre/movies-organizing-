const minCodeLength = 6;

bool isLegacyNumericCode(String code) {
  final normalized = code.trim().toLowerCase();
  return RegExp(r'^[0-9]{3,}$').hasMatch(normalized);
}

/// Returns a message key for i18n, or null if valid.
/// Keys: auth.spaces, auth.minLength, auth.needLetter, auth.needNumber
String? validateCodeKey(String code, {required bool forCreate}) {
  final raw = code;

  if (RegExp(r'\s').hasMatch(raw)) {
    return 'auth.spaces';
  }

  final normalized = code.trim().toLowerCase();

  if (!forCreate && isLegacyNumericCode(code)) {
    return null;
  }

  if (normalized.length < minCodeLength) {
    return 'auth.minLength';
  }

  if (!RegExp(r'[a-z]').hasMatch(normalized)) {
    return 'auth.needLetter';
  }

  if (!RegExp(r'[0-9]').hasMatch(normalized)) {
    return 'auth.needNumber';
  }

  return null;
}

class CodeRuleChecks {
  const CodeRuleChecks({
    required this.length,
    required this.alnum,
    required this.spaces,
  });

  final bool length;
  final bool alnum;
  final bool spaces;
}

CodeRuleChecks evaluateCodeRules(String code) {
  final raw = code;
  final normalized = code.trim().toLowerCase();

  return CodeRuleChecks(
    length: normalized.length >= minCodeLength,
    alnum: RegExp(r'[a-z]').hasMatch(normalized) &&
        RegExp(r'[0-9]').hasMatch(normalized),
    spaces: raw.isNotEmpty && !RegExp(r'\s').hasMatch(raw),
  );
}
