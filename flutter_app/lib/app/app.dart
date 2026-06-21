import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../core/config/app_config.dart';
import '../core/services/session_service.dart';
import '../core/utils/pending_share.dart';
import '../features/about/presentation/about_screen.dart';
import '../features/gate/presentation/gate_screen.dart';
import '../features/watchlist/presentation/watchlist_screen.dart';
import 'localization.dart';
import 'router.dart';
import 'theme/app_themes.dart';
import 'theme/theme_controller.dart';
import 'theme/theme_extensions.dart';

final _routerRefreshProvider = Provider<_RouterRefreshNotifier>((ref) {
  final notifier = _RouterRefreshNotifier();
  ref.onDispose(notifier.dispose);
  ref.listen(sessionProvider, (_, __) => notifier.notify());
  return notifier;
});

class _RouterRefreshNotifier extends ChangeNotifier {
  void notify() => notifyListeners();
}

String _initialWebLocation() {
  final base = Uri.base;
  final path = base.path.isEmpty ? AppRoutes.gate : base.path;
  final query = base.query;
  return query.isNotEmpty ? '$path?$query' : path;
}

final goRouterProvider = Provider<GoRouter>((ref) {
  final refresh = ref.watch(_routerRefreshProvider);
  return GoRouter(
    initialLocation: kIsWeb ? _initialWebLocation() : AppRoutes.gate,
    refreshListenable: refresh,
    debugLogDiagnostics: kDebugMode,
    errorBuilder: (context, state) => Scaffold(
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Text(
            state.error?.toString() ?? 'Unknown routing error',
            style: const TextStyle(color: Colors.red),
          ),
        ),
      ),
    ),
    redirect: (context, state) {
      final loggedIn = ref.read(isAuthenticatedProvider);
      final location = state.matchedLocation;
      final onGate = location == AppRoutes.gate;
      final onHome = location == AppRoutes.home;
      final shareId = resolvePendingShareId(
        fromRoute: state.uri.queryParameters['share'],
      );

      if (!loggedIn && !onGate) {
        if (shareId != null) {
          return '${AppRoutes.gate}?share=${Uri.encodeComponent(shareId)}';
        }
        final query = state.uri.query.isNotEmpty ? '?${state.uri.query}' : '';
        return '${AppRoutes.gate}$query';
      }
      if (loggedIn && onGate) {
        if (shareId != null) return homeWithShareQuery(shareId);
        return AppRoutes.home;
      }
      if (loggedIn && onHome && shareId != null) {
        final inUrl = state.uri.queryParameters['share']?.trim();
        if (inUrl == null || inUrl.isEmpty) {
          return homeWithShareQuery(shareId);
        }
      }
      return null;
    },
    routes: [
      GoRoute(
        path: AppRoutes.gate,
        builder: (context, state) {
          final mode = state.uri.queryParameters['mode'] == 'create'
              ? GateMode.create
              : GateMode.login;
          return GateScreen(
            shareId: resolvePendingShareId(
              fromRoute: state.uri.queryParameters['share'],
            ),
            initialMode: mode,
            showDeletedMessage: state.uri.queryParameters['deleted'] == '1',
          );
        },
      ),
      GoRoute(
        path: AppRoutes.home,
        builder: (context, state) => WatchlistScreen(
          shareId: resolvePendingShareId(
            fromRoute: state.uri.queryParameters['share'],
          ),
        ),
      ),
      GoRoute(
        path: AppRoutes.about,
        builder: (context, state) => const AboutScreen(),
      ),
    ],
  );
});

class OurMovieNightsApp extends ConsumerWidget {
  const OurMovieNightsApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final router = ref.watch(goRouterProvider);
    final locale = ref.watch(localeProvider);
    final themeId = ref.watch(themeIdProvider);
    final textDirection = ref.watch(textDirectionProvider);

    return MaterialApp.router(
      title: 'Our Movie Nights',
      debugShowCheckedModeBanner: false,
      locale: locale,
      supportedLocales: supportedLocales,
      localizationsDelegates: const [
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      theme: AppThemes.forId(themeId),
      builder: (context, child) {
        final gradient =
            Theme.of(context).extension<AppThemeBackground>()?.gradient;
        Widget body = child ??
            const Center(
              child: CircularProgressIndicator(color: Color(0xFFE8B84A)),
            );
        if (gradient != null) {
          body = DecoratedBox(
            decoration: BoxDecoration(gradient: gradient),
            child: body,
          );
        }
        return Directionality(
          textDirection: textDirection,
          child: MediaQuery(
            data: MediaQuery.of(context).copyWith(
              textScaler: MediaQuery.textScalerOf(context).clamp(
                minScaleFactor: 0.9,
                maxScaleFactor: 1.3,
              ),
            ),
            child: body,
          ),
        );
      },
      routerConfig: router,
    );
  }
}

/// Bootstrap Supabase when compile-time keys are present.
Future<void> bootstrapSupabase(AppConfig config) async {
  if (!config.isSupabaseConfigured) return;
  await Supabase.initialize(
    url: config.supabaseUrl,
    anonKey: config.supabaseAnonKey,
  );
}
