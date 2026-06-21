import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:our_movie_nights/app/theme/app_themes.dart';
import 'package:our_movie_nights/app/theme/theme_controller.dart';
import 'package:our_movie_nights/features/watchlist/presentation/widgets/type_tab_bar.dart';
import 'package:our_movie_nights/l10n/l10n.dart';
import 'package:our_movie_nights/models/watchlist_item.dart';

void main() {
  testWidgets('TypeTabBar hides icon-tab labels on mobile', (tester) async {
    await tester.binding.setSurfaceSize(const Size(390, 800));
    addTearDown(() => tester.binding.setSurfaceSize(null));

    await tester.pumpWidget(_wrap(
      width: 390,
      child: TypeTabBar(
        selected: WatchlistTypeFilter.movies,
        counts: const {
          WatchlistTypeFilter.all: 10,
          WatchlistTypeFilter.movies: 4,
          WatchlistTypeFilter.tvSeries: 3,
          WatchlistTypeFilter.anime: 3,
        },
        onChanged: (_) {},
        l10n: L10n('en'),
      ),
    ));

    expect(find.text('ALL'), findsOneWidget);
    expect(find.text('MOVIES'), findsNothing);
    expect(find.text('🎬'), findsOneWidget);
    expect(find.text('4'), findsOneWidget);
  });

  testWidgets('TypeTabBar uses tabActiveFg for active label on desktop',
      (tester) async {
    await tester.binding.setSurfaceSize(const Size(900, 800));
    addTearDown(() => tester.binding.setSurfaceSize(null));

    await tester.pumpWidget(_wrap(
      width: 900,
      child: TypeTabBar(
        selected: WatchlistTypeFilter.movies,
        counts: const {
          WatchlistTypeFilter.all: 1,
          WatchlistTypeFilter.movies: 1,
          WatchlistTypeFilter.tvSeries: 0,
          WatchlistTypeFilter.anime: 0,
        },
        onChanged: (_) {},
        l10n: L10n('en'),
      ),
    ));

    final label = tester.widget<Text>(find.text('MOVIES'));
    expect(label.style?.color, const Color(0xFFE8C078));
  });
}

Widget _wrap({required double width, required Widget child}) {
  return ProviderScope(
    overrides: [
      themeIdProvider.overrideWith(() => _FixedPurpleTheme()),
    ],
    child: MediaQuery(
      data: MediaQueryData(size: Size(width, 800)),
      child: MaterialApp(
        theme: AppThemes.forId(AppThemeId.purple),
        home: Scaffold(
          body: SizedBox(width: width, child: child),
        ),
      ),
    ),
  );
}

class _FixedPurpleTheme extends ThemeNotifier {
  @override
  AppThemeId build() => AppThemeId.purple;
}
