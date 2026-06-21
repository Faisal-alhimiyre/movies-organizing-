/// Matches `accountIdFromCode` in `web-files/js/auth.js` (djb2 → base36).
String accountIdFromCode(String code) {
  final trimmed = code.trim().toLowerCase();
  var hash = 5381;

  for (final unit in trimmed.codeUnits) {
    hash = (hash * 33) ^ unit;
  }

  return 'l${(hash & 0xFFFFFFFF).toRadixString(36)}';
}

String generateListId() {
  final time = DateTime.now().millisecondsSinceEpoch.toRadixString(36);
  final rand =
      (DateTime.now().microsecondsSinceEpoch % 0xFFFFFF).toRadixString(36);
  return 'lst_${time}_$rand';
}
