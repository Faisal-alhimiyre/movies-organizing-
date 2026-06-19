import 'dart:js_interop';
import 'package:web/web.dart';

const _key = 'watchlist-pending-share';

void writePendingShareSession(String shareId) {
  window.sessionStorage.setItem(_key, shareId);
}

String? readPendingShareSession() {
  final value = window.sessionStorage.getItem(_key);
  if (value == null) return null;
  final id = value.toString().trim();
  return id.isEmpty ? null : id;
}

String? readShareFromLocation() {
  final href = window.location.href;
  if (href.isEmpty) return null;
  final id = Uri.parse(href).queryParameters['share']?.trim();
  return (id == null || id.isEmpty) ? null : id;
}

void clearPendingShareSession() {
  window.sessionStorage.removeItem(_key);
}

void navigateToHomeWithShare(String shareId) {
  final base = Uri.base;
  final port = base.hasPort ? ':${base.port}' : '';
  final path = '/?share=${Uri.encodeComponent(shareId.trim())}';
  window.location.href = '${base.scheme}://${base.host}$port$path';
}

void navigateToHome() {
  final base = Uri.base;
  final port = base.hasPort ? ':${base.port}' : '';
  window.location.href = '${base.scheme}://${base.host}$port/';
}
