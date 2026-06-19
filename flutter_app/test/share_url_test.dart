import 'package:flutter_test/flutter_test.dart';
import 'package:our_movie_nights/core/config/app_config.dart';
import 'package:our_movie_nights/core/utils/share_url.dart';

void main() {
  const config = AppConfig(
    supabaseUrl: '',
    supabaseAnonKey: '',
    omdbApiKey: '',
    tmdbApiKey: '',
    publicAppUrl: '',
  );

  test('buildShareUrl uses browser base when route URI has no host', () {
    final url = buildShareUrl(
      config,
      Uri(path: '/'),
      'share-abc',
      browserBase: Uri.parse('http://172.20.10.3:53100/gate'),
    );

    expect(url, 'http://172.20.10.3:53100/gate?share=share-abc');
  });

  test('buildShareUrl uses route host when present', () {
    final url = buildShareUrl(
      config,
      Uri.parse('http://192.168.1.45:53100/'),
      'share-xyz',
    );

    expect(url, 'http://192.168.1.45:53100/gate?share=share-xyz');
  });
}
