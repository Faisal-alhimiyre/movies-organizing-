import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';

import 'clipboard_copy_web.dart';

/// Copies text; on web over HTTP (LAN IP) uses a DOM fallback when the Clipboard API is blocked.
Future<bool> copyLinkText(String text) async {
  if (!kIsWeb) {
    await Clipboard.setData(ClipboardData(text: text));
    return true;
  }

  try {
    await Clipboard.setData(ClipboardData(text: text));
    return true;
  } catch (_) {
    return copyWithExecCommand(text);
  }
}
