import '../config/app_config.dart';

/// Browser / server origin for share links (GoRouter URIs are often path-only on web).
Uri sharePageOrigin(Uri routeUri, {Uri? browserBase}) {
  final base = browserBase ?? Uri.base;

  if (routeUri.host.isNotEmpty) {
    return Uri(
      scheme: routeUri.scheme.isNotEmpty ? routeUri.scheme : base.scheme,
      host: routeUri.host,
      port: routeUri.hasPort ? routeUri.port : null,
    );
  }

  if (base.host.isNotEmpty) {
    return Uri(
      scheme: base.scheme.isNotEmpty ? base.scheme : 'http',
      host: base.host,
      port: base.hasPort ? base.port : null,
    );
  }

  return Uri(scheme: 'http', host: 'localhost', port: 53100);
}

/// Builds a share link (`/gate?share=`). Uses the real browser host so LAN dev URLs work.
String buildShareUrl(
  AppConfig config,
  Uri routeUri,
  String shareId, {
  Uri? browserBase,
}) {
  if (shareId.isEmpty) return '';

  final origin = sharePageOrigin(routeUri, browserBase: browserBase);

  if (config.publicAppUrl.isNotEmpty) {
    try {
      final configured = Uri.parse(config.publicAppUrl.trim());
      if (configured.host.isNotEmpty && !isLocalDevHost(origin.host)) {
        final publicOrigin = configured.replace(path: '', query: '', fragment: '');
        return publicOrigin.replace(
          path: '/gate',
          queryParameters: {'share': shareId},
        ).toString();
      }
    } catch (_) {
      // Fall through to current origin.
    }
  }

  return origin.replace(
    path: '/gate',
    queryParameters: {'share': shareId},
  ).toString();
}

bool _isPrivateLanHost(String host) =>
    host.startsWith('192.168.') ||
    host.startsWith('10.') ||
    host.startsWith('172.');

bool isLocalDevHost(String host) =>
    host == 'localhost' ||
    host == '127.0.0.1' ||
    _isPrivateLanHost(host);

String shareLinkMessage(String listName, int titleCount) =>
    '$listName — $titleCount ${titleCount == 1 ? 'title' : 'titles'} on Our Movie Nights';
