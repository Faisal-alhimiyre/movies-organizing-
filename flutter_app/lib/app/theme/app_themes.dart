import 'package:flutter/material.dart';

import 'theme_controller.dart';

/// Visual themes aligned with `web-files/css/theme*.css`.
class AppThemes {
  static const _gold = Color(0xFFD9B96A);
  static const _goldMuted = Color(0xFF8B7355);

  static ThemeData forId(AppThemeId id) {
    return switch (id) {
      AppThemeId.light => _light(),
      AppThemeId.purple => _purple(),
      AppThemeId.brown => _brown(),
      AppThemeId.pink => _pink(),
      AppThemeId.dark => _dark(),
    };
  }

  static ThemeData _base({
    required Color scaffold,
    required Color surface,
    required Color onSurface,
    required Color primary,
    required Color onPrimary,
    required Color border,
    required Brightness brightness,
  }) {
    final colorScheme = ColorScheme(
      brightness: brightness,
      primary: primary,
      onPrimary: onPrimary,
      secondary: _gold,
      onSecondary: brightness == Brightness.dark ? Colors.white : Colors.black87,
      error: const Color(0xFFE85D5D),
      onError: Colors.white,
      surface: surface,
      onSurface: onSurface,
    );

    return ThemeData(
      useMaterial3: true,
      brightness: brightness,
      colorScheme: colorScheme,
      scaffoldBackgroundColor: scaffold,
      appBarTheme: AppBarTheme(
        backgroundColor: surface,
        foregroundColor: onSurface,
        elevation: 0,
        centerTitle: false,
      ),
      cardTheme: CardThemeData(
        color: surface,
        elevation: 0,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(12),
          side: BorderSide(color: border),
        ),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: surface,
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(10),
          borderSide: BorderSide(color: border),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(10),
          borderSide: BorderSide(color: border),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(10),
          borderSide: BorderSide(color: primary, width: 1.5),
        ),
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          backgroundColor: primary,
          foregroundColor: onPrimary,
          minimumSize: const Size(64, 44),
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
        ),
      ),
      textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(
          minimumSize: const Size(64, 44),
          foregroundColor: _gold,
        ),
      ),
      chipTheme: ChipThemeData(
        side: BorderSide(color: border),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(999)),
      ),
      dividerTheme: DividerThemeData(color: border, space: 1, thickness: 1),
      focusColor: primary.withValues(alpha: 0.25),
      hoverColor: primary.withValues(alpha: 0.08),
    );
  }

  static ThemeData _dark() => _base(
        scaffold: const Color(0xFF060607),
        surface: const Color(0xFF141416),
        onSurface: const Color(0xFFE8EAED),
        primary: _gold,
        onPrimary: const Color(0xFF1A1408),
        border: const Color(0xFF2A2A2E),
        brightness: Brightness.dark,
      );

  static ThemeData _light() => _base(
        scaffold: const Color(0xFFF4F4F6),
        surface: Colors.white,
        onSurface: const Color(0xFF1A1A1E),
        primary: const Color(0xFF8B6914),
        onPrimary: Colors.white,
        border: const Color(0xFFD8D8DE),
        brightness: Brightness.light,
      );

  static ThemeData _purple() => _base(
        scaffold: const Color(0xFF120A1E),
        surface: const Color(0xFF1E1230),
        onSurface: const Color(0xFFF0E8FF),
        primary: const Color(0xFFC8A0FF),
        onPrimary: const Color(0xFF1A0E2E),
        border: const Color(0xFF3D2A5C),
        brightness: Brightness.dark,
      );

  static ThemeData _brown() => _base(
        scaffold: const Color(0xFF1A1008),
        surface: const Color(0xFF2A1C12),
        onSurface: const Color(0xFFF5EADA),
        primary: _gold,
        onPrimary: const Color(0xFF2A1E12),
        border: const Color(0xFF4A3528),
        brightness: Brightness.dark,
      );

  static ThemeData _pink() => _base(
        scaffold: const Color(0xFF3A0E22),
        surface: const Color(0xFF5A1232),
        onSurface: Colors.white,
        primary: const Color(0xFFFFB4CD),
        onPrimary: const Color(0xFF4A0E28),
        border: const Color(0xFF8B3A58),
        brightness: Brightness.dark,
      );

  static String label(AppThemeId id) => switch (id) {
        AppThemeId.dark => 'Dark',
        AppThemeId.light => 'Light',
        AppThemeId.purple => 'Purple',
        AppThemeId.brown => 'Brown',
        AppThemeId.pink => 'Pink',
      };
}
