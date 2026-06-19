import 'package:flutter_test/flutter_test.dart';
import 'package:our_movie_nights/core/config/app_config.dart';
import 'package:our_movie_nights/models/session.dart';

void main() {
  test('AppConfig detects Supabase when url and key set', () {
    const config = AppConfig(
      supabaseUrl: 'https://example.supabase.co',
      supabaseAnonKey: 'anon',
      omdbApiKey: '',
      tmdbApiKey: '',
      publicAppUrl: '',
    );
    expect(config.isSupabaseConfigured, isTrue);
  });

  test('Session round-trips json', () {
    const session = Session(accountId: 'labc', listId: 'labc');
    final restored = Session.fromJson(session.toJson());
    expect(restored.accountId, session.accountId);
    expect(restored.isAuthenticated, isTrue);
  });
}
