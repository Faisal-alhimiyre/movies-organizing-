/// Returns an l10n message key, or null when valid (`auth.js` → `validateListName`).
String? validateListNameKey(String name) {
  final trimmed = name.trim();
  if (trimmed.isEmpty) return 'list.nameRequired';
  if (trimmed.length > 48) return 'list.nameTooLong';
  return null;
}
