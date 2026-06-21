import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:our_movie_nights/app/theme/app_themes.dart';
import 'package:our_movie_nights/app/theme/theme_controller.dart';
import 'package:our_movie_nights/features/watchlist/application/card_layout_controller.dart';
import 'package:our_movie_nights/features/watchlist/presentation/widgets/card_layout_toggle.dart';
import 'package:our_movie_nights/features/watchlist/presentation/widgets/genre_section.dart';
import 'package:our_movie_nights/l10n/l10n.dart';
import 'package:our_movie_nights/models/watchlist_item.dart';

class _TestCardLayoutNotifier extends CardLayoutNotifier {
  @override
  CardLayoutId build() => CardLayoutId.hover;

  @override
  Future<void> setLayout(CardLayoutId layout) async {
    state = layout;
  }
}

class _DarkThemeNotifier extends ThemeNotifier {
  @override
  AppThemeId build() => AppThemeId.dark;
}

class _PurpleThemeNotifier extends ThemeNotifier {
  @override
  AppThemeId build() => AppThemeId.purple;
}

void main() {
  group('CardLayoutToggle', () {
    testWidgets('wraps toggles in a pill bar', (tester) async {
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            cardLayoutProvider.overrideWith(_TestCardLayoutNotifier.new),
            themeIdProvider.overrideWith(_DarkThemeNotifier.new),
          ],
          child: MaterialApp(
            theme: AppThemes.forId(AppThemeId.dark),
            home: Scaffold(
              body: CardLayoutToggle(l10n: L10n('en')),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.byType(DecoratedBox), findsWidgets);
      expect(find.byIcon(Icons.view_agenda_outlined), findsOneWidget);
      expect(find.byIcon(Icons.view_module_outlined), findsOneWidget);
    });

    testWidgets('switches layout without error', (tester) async {
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            cardLayoutProvider.overrideWith(_TestCardLayoutNotifier.new),
            themeIdProvider.overrideWith(_DarkThemeNotifier.new),
          ],
          child: MaterialApp(
            theme: AppThemes.forId(AppThemeId.dark),
            home: Scaffold(
              body: CardLayoutToggle(l10n: L10n('en')),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();

      await tester.tap(find.byIcon(Icons.view_module_outlined));
      await tester.pumpAndSettle();

      final container = ProviderScope.containerOf(
        tester.element(find.byType(CardLayoutToggle)),
      );
      expect(container.read(cardLayoutProvider), CardLayoutId.poster);
    });
  });

  group('GenreSection header', () {
    final group = GenreGroup(
      genre: 'Science Fiction & Fantasy with a very long combined name',
      contentType: 'movies',
      isAllMatch: true,
      items: const [],
    );

    testWidgets('renders combined-genre heading and badges at 320px', (tester) async {
      await tester.binding.setSurfaceSize(const Size(320, 640));
      addTearDown(() => tester.binding.setSurfaceSize(null));

      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            cardLayoutProvider.overrideWith(_TestCardLayoutNotifier.new),
            themeIdProvider.overrideWith(_DarkThemeNotifier.new),
          ],
          child: MaterialApp(
            theme: AppThemes.forId(AppThemeId.dark),
            home: Directionality(
              textDirection: TextDirection.ltr,
              child: Scaffold(
                body: SingleChildScrollView(
                  child: GenreSection(
                    group: group,
                    watched: const {},
                    l10n: L10n('en'),
                    onItemTap: (_) {},
                  ),
                ),
              ),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(tester.takeException(), isNull);
      expect(find.text('ALL SELECTED'), findsOneWidget);
      expect(find.textContaining('Science Fiction & Fantasy'), findsOneWidget);
      expect(find.text('MOVIE'), findsOneWidget);
    });

    testWidgets('renders Arabic RTL header', (tester) async {
      await tester.binding.setSurfaceSize(const Size(390, 640));
      addTearDown(() => tester.binding.setSurfaceSize(null));

      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            cardLayoutProvider.overrideWith(_TestCardLayoutNotifier.new),
            themeIdProvider.overrideWith(_PurpleThemeNotifier.new),
          ],
          child: MaterialApp(
            theme: AppThemes.forId(AppThemeId.purple),
            home: Directionality(
              textDirection: TextDirection.rtl,
              child: Scaffold(
                body: SingleChildScrollView(
                  child: GenreSection(
                    group: const GenreGroup(
                      genre: 'Drama',
                      contentType: 'tvSeries',
                      items: [],
                    ),
                    watched: const {},
                    l10n: L10n('ar'),
                    onItemTap: (_) {},
                  ),
                ),
              ),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(tester.takeException(), isNull);
      expect(find.textContaining('مسلسل'), findsOneWidget);
      expect(find.textContaining('0 عنوان'), findsOneWidget);
    });
  });
}
