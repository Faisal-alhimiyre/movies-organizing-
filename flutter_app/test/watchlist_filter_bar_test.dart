import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:our_movie_nights/app/theme/app_themes.dart';
import 'package:our_movie_nights/app/theme/theme_controller.dart';
import 'package:our_movie_nights/features/watchlist/application/watchlist_filters.dart';
import 'package:our_movie_nights/features/watchlist/application/watchlist_controller.dart';
import 'package:our_movie_nights/features/watchlist/presentation/widgets/watchlist_filter_bar.dart';
import 'package:our_movie_nights/l10n/l10n.dart';
import 'package:our_movie_nights/models/watchlist_item.dart';

void main() {
  testWidgets('WatchlistFilterBar fits 320px with genre chips', (tester) async {
    await tester.binding.setSurfaceSize(const Size(320, 800));
    addTearDown(() => tester.binding.setSurfaceSize(null));

    final items = [
      const WatchlistItem(
        id: '1',
        title: 'Film A',
        contentType: 'movie',
        genre: 'Action',
        secondaryGenres: ['Drama', 'Sci-Fi'],
      ),
    ];

    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          watchlistFilterProvider.overrideWith(_PrefilledFilterNotifier.new),
        ],
        child: MaterialApp(
          theme: AppThemes.forId(AppThemeId.dark),
          home: Directionality(
            textDirection: TextDirection.ltr,
            child: Scaffold(
              body: WatchlistFilterBar(items: items, l10n: L10n('en')),
            ),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(tester.takeException(), isNull);
    expect(find.text('Clear filters'), findsOneWidget);
  });

  testWidgets('WatchlistFilterBar renders in Arabic RTL', (tester) async {
    await tester.binding.setSurfaceSize(const Size(390, 800));
    addTearDown(() => tester.binding.setSurfaceSize(null));

    final items = [
      const WatchlistItem(
        id: '1',
        title: 'فيلم',
        contentType: 'movie',
        genre: 'Action',
      ),
    ];

    await tester.pumpWidget(
      ProviderScope(
        child: MaterialApp(
          theme: AppThemes.forId(AppThemeId.purple),
          home: Directionality(
            textDirection: TextDirection.rtl,
            child: Scaffold(
              body: WatchlistFilterBar(items: items, l10n: L10n('ar')),
            ),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(tester.takeException(), isNull);
  });
}

class _PrefilledFilterNotifier extends WatchlistFilterNotifier {
  @override
  WatchlistFilterState build() => const WatchlistFilterState(
        selectedGenres: ['Action', 'Drama'],
        search: 'test',
      );
}
