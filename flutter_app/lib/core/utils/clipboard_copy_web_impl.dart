import 'dart:js_interop';
import 'package:web/web.dart';

bool copyWithExecCommandImpl(String text) {
  final textarea = document.createElement('textarea') as HTMLTextAreaElement;
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  document.body?.appendChild(textarea);
  textarea.select();
  final ok = document.execCommand('copy');
  textarea.remove();
  return ok;
}
