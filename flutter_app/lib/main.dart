import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_web_plugins/url_strategy.dart';

import 'app/app.dart';
import 'core/config/app_config.dart';
import 'core/storage/hive_boxes.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  if (kIsWeb) {
    usePathUrlStrategy();
  }

  FlutterError.onError = (details) {
    FlutterError.presentError(details);
    debugPrint(details.toString());
  };

  runApp(
    const ProviderScope(
      child: _BootstrapApp(),
    ),
  );
}

/// Shows a spinner during Hive/Supabase init so the page is not blank white.
class _BootstrapApp extends StatefulWidget {
  const _BootstrapApp();

  @override
  State<_BootstrapApp> createState() => _BootstrapAppState();
}

class _BootstrapAppState extends State<_BootstrapApp> {
  Object? _error;
  bool _ready = false;

  @override
  void initState() {
    super.initState();
    _init();
  }

  Future<void> _init() async {
    try {
      const config = AppConfig.fromEnvironment;
      await HiveBoxes.init();
      await bootstrapSupabase(config).timeout(
        const Duration(seconds: 15),
        onTimeout: () {
          debugPrint(
            'Supabase init timed out after 15s — continuing in local mode.',
          );
        },
      );
      if (mounted) setState(() => _ready = true);
    } catch (error, stackTrace) {
      debugPrint('Startup failed: $error\n$stackTrace');
      if (mounted) setState(() => _error = error);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_error != null) {
      return MaterialApp(
        home: Scaffold(
          body: SafeArea(
            child: Padding(
              padding: const EdgeInsets.all(24),
              child: Text(
                'Startup error: $_error',
                style: const TextStyle(color: Colors.red),
              ),
            ),
          ),
        ),
      );
    }

    if (!_ready) {
      return const MaterialApp(
        home: Scaffold(
          backgroundColor: Color(0xFF060607),
          body: Center(
            child: CircularProgressIndicator(color: Color(0xFFD9B96A)),
          ),
        ),
      );
    }

    return const OurMovieNightsApp();
  }
}
