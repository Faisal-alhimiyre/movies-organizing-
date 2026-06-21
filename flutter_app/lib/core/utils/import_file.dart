import 'dart:convert';

import 'package:file_picker/file_picker.dart';

import '../../models/share_snapshot_payload.dart';
import 'watchlist_import.dart';

class ImportFilePickResult {
  const ImportFilePickResult._({
    this.payload,
    this.cancelled = false,
    this.invalid = false,
  });

  final ShareSnapshotPayload? payload;
  final bool cancelled;
  final bool invalid;

  const ImportFilePickResult.cancelled() : this._(cancelled: true);

  const ImportFilePickResult.invalid() : this._(invalid: true);

  ImportFilePickResult.ok(ShareSnapshotPayload payload)
      : this._(payload: payload);
}

/// Picks a `.json` backup and parses it (`web-files/js/app.js` → `importBackup`).
Future<ImportFilePickResult> pickImportPayloadFromFile() async {
  final result = await FilePicker.platform.pickFiles(
    type: FileType.custom,
    allowedExtensions: const ['json'],
    withData: true,
    allowMultiple: false,
  );

  if (result == null || result.files.isEmpty) {
    return const ImportFilePickResult.cancelled();
  }

  final bytes = result.files.first.bytes;
  if (bytes == null) {
    return const ImportFilePickResult.invalid();
  }

  final payload = parseImportPayload(utf8.decode(bytes));
  if (payload == null) {
    return const ImportFilePickResult.invalid();
  }

  return ImportFilePickResult.ok(payload);
}
