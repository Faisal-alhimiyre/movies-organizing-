/// Compile-time configuration via `--dart-define`.
///
/// Example:
/// ```bash
/// flutter run --dart-define=SUPABASE_URL=https://xxx.supabase.co \
///   --dart-define=SUPABASE_ANON_KEY=eyJ...
/// ```
class AppConfig {
  const AppConfig({
    required this.supabaseUrl,
    required this.supabaseAnonKey,
    required this.omdbApiKey,
    required this.tmdbApiKey,
    required this.publicAppUrl,
  });

  final String supabaseUrl;
  final String supabaseAnonKey;
  final String omdbApiKey;
  final String tmdbApiKey;
  final String publicAppUrl;

  static const AppConfig fromEnvironment = AppConfig(
    supabaseUrl: String.fromEnvironment('SUPABASE_URL', defaultValue: ''),
    supabaseAnonKey: String.fromEnvironment('SUPABASE_ANON_KEY', defaultValue: ''),
    omdbApiKey: String.fromEnvironment('OMDB_API_KEY', defaultValue: ''),
    tmdbApiKey: String.fromEnvironment('TMDB_API_KEY', defaultValue: ''),
    publicAppUrl: String.fromEnvironment('PUBLIC_APP_URL', defaultValue: ''),
  );

  bool get isSupabaseConfigured =>
      supabaseUrl.isNotEmpty && supabaseAnonKey.isNotEmpty;

  bool get hasOmdbKey => omdbApiKey.isNotEmpty;

  bool get hasTmdbKey => tmdbApiKey.isNotEmpty;

  /// Share links must use the live site URL when not on production host.
  String effectivePublicAppUrl(Uri current) {
    if (publicAppUrl.isNotEmpty) return publicAppUrl;
    return '${current.scheme}://${current.host}${current.port == 80 || current.port == 443 ? '' : ':${current.port}'}/';
  }
}
