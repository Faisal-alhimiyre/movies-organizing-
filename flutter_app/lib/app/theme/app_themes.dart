import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

import 'theme_controller.dart';
import 'theme_extensions.dart';

/// Visual themes aligned with `web-files/css/theme*.css` and `styles.css`.
class AppThemes {
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
    required Gradient gradient,
    required AppTypeColors typeColors,
    // When true, all text uses DM Sans (matches theme.css dark which sets
    // --font-display to system sans, same as --font). Other themes keep
    // Playfair Display for display/headline slots (styles.css default).
    bool displaySans = false,
  }) {
    final colorScheme = ColorScheme(
      brightness: brightness,
      primary: primary,
      onPrimary: onPrimary,
      secondary: brightness == Brightness.light
          ? const Color(0xFF8A6D42)
          : const Color(0xFFD9B96A),
      onSecondary:
          brightness == Brightness.dark ? Colors.white : Colors.black87,
      error: const Color(0xFFE85D5D),
      onError: Colors.white,
      surface: surface,
      onSurface: onSurface,
      surfaceContainerHighest: surface.withValues(alpha: 0.85),
    );

    // DM Sans for body text everywhere. Display/headline slots use Playfair
    // Display for themes that match styles.css, or DM Sans for the dark theme
    // that overrides --font-display to system sans in theme.css.
    final baseTextTheme = GoogleFonts.dmSansTextTheme(
      ThemeData(brightness: brightness).textTheme,
    );
    final textTheme = displaySans
        ? baseTextTheme
        : baseTextTheme.copyWith(
            displayLarge: GoogleFonts.playfairDisplay(
                textStyle: baseTextTheme.displayLarge,
                fontWeight: FontWeight.w700),
            displayMedium: GoogleFonts.playfairDisplay(
                textStyle: baseTextTheme.displayMedium,
                fontWeight: FontWeight.w700),
            displaySmall: GoogleFonts.playfairDisplay(
                textStyle: baseTextTheme.displaySmall,
                fontWeight: FontWeight.w700),
            headlineLarge: GoogleFonts.playfairDisplay(
                textStyle: baseTextTheme.headlineLarge,
                fontWeight: FontWeight.w700),
            headlineMedium: GoogleFonts.playfairDisplay(
                textStyle: baseTextTheme.headlineMedium,
                fontWeight: FontWeight.w700),
            headlineSmall: GoogleFonts.playfairDisplay(
                textStyle: baseTextTheme.headlineSmall,
                fontWeight: FontWeight.w700),
          );

    return ThemeData(
      useMaterial3: true,
      brightness: brightness,
      colorScheme: colorScheme,
      // Explicitly set dividerColor so theme.dividerColor returns the CSS
      // --border value everywhere (cards, genre bar, header, etc.).
      // Without this, M3 defaults to colorScheme.outlineVariant which is
      // auto-generated from onSurface and can look white/light on dark themes.
      dividerColor: border,
      textTheme: textTheme.apply(
        bodyColor: onSurface,
        displayColor: onSurface,
      ),
      // Transparent so the gradient wrapper in app.dart shows through.
      scaffoldBackgroundColor: Colors.transparent,
      extensions: [AppThemeBackground(gradient: gradient), typeColors],
      appBarTheme: AppBarTheme(
        backgroundColor: surface,
        foregroundColor: onSurface,
        elevation: 0,
        shadowColor: Colors.transparent,
        centerTitle: false,
        titleTextStyle: displaySans
            ? GoogleFonts.dmSans(
                fontSize: 22,
                fontWeight: FontWeight.w700,
                color: onSurface,
                letterSpacing: -0.3,
              )
            : GoogleFonts.playfairDisplay(
                fontSize: 22,
                fontWeight: FontWeight.w700,
                color: onSurface,
                letterSpacing: -0.3,
              ),
      ),
      cardTheme: CardThemeData(
        color: surface,
        elevation: 0,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(8),
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
          shape:
              RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
        ),
      ),
      textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(
          minimumSize: const Size(64, 44),
          foregroundColor: primary,
        ),
      ),
      chipTheme: ChipThemeData(
        side: BorderSide(color: border),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(999)),
      ),
      dividerTheme: DividerThemeData(color: border, space: 1, thickness: 1),
      // Popup menus use --bg-elevated and a rounded 12px border matching
      // `.account-menu__panel { border-radius: 12px; border: 1px solid var(--border) }`.
      popupMenuTheme: PopupMenuThemeData(
        color: typeColors.menuPanelBg,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(12),
          side: BorderSide(color: border),
        ),
        elevation: 8,
      ),
      focusColor: primary.withValues(alpha: 0.25),
      hoverColor: primary.withValues(alpha: 0.08),
    );
  }

  // ─── Dark (matches theme.css — black bg, #121212 cards, #0095f6 blue accent)
  // --bg: #000000 | --bg-card: #121212 | --accent: #0095f6 | --text: #fafafa
  // theme.css overrides --font-display to system sans → displaySans: true.
  static ThemeData _dark() => _base(
        scaffold: const Color(0xFF000000),
        surface: const Color(0xFF121212),
        onSurface: const Color(0xFFFAFAFA),
        primary: const Color(0xFF0095F6),
        onPrimary: Colors.white,
        border: const Color(0xFF363636),
        brightness: Brightness.dark,
        displaySans: true,
        gradient: const LinearGradient(
          colors: [Color(0xFF000000), Color(0xFF000000)],
        ),
        typeColors: const AppTypeColors(
          movie: Color(0xFF0095F6), // --movie
          movieDim: Color(0x240095F6), // rgba(0,149,246,0.14)
          tv: Color(0xFFA855F7), // --tv
          tvDim: Color(0x24A855F7), // rgba(168,85,247,0.14)
          anime: Color(0xFFED4956), // --anime
          animeDim: Color(0x24ED4956), // rgba(237,73,86,0.14)
          franchise: Color(0xFF58C322), // --franchise
          franchiseDim: Color(0x1E58C322), // rgba(88,195,34,0.12)
          watched: Color(0xFF58C322), // --watched
          textMuted: Color(0xFFA8A8A8), // --text-muted
          titleAccent: Color(0xFFC4A882), // --title-accent
          lead: Color(0xFF0095F6), // theme.css .card__lead color
          bgElevated: Color(0xFF121212), // --bg-elevated (theme.css)
          tabActiveFg: Color(0xFFFAFAFA), // --tab-active-fg (theme.css)
          menuPanelBg: Color(0xFF262626), // .account-menu__panel (theme.css)
          menuItemHoverBg: Color(0xFF363636),
          menuDangerColor: Color(0xFFF87171),
          menuDangerHoverColor: Color(0xFFFCA5A5),
          menuLangActiveBg: Color(0xFF0095F6),
          menuLangActiveFg: Color(0xFFFFFFFF),
          searchFieldBg: Color(0xFF262626),
          filterFieldBg: Color(0xFF1A1A1A),
          filterChipFg: Color(0xFF0C0C0D),
          filterChipGradientStart: Color(0xFFD4B896),
          filterChipGradientEnd: Color(0xFFC4A882),
          filterChipBorder: Color(0x73D4B896),
          filterChipRemoveHoverBg: Color(0x1A0C0C0D),
        ),
      );

  // ─── Light (matches theme-light.css) ─────────────────────────────────────
  // bg: #f3f2ee | card: #ffffff | accent: #8a6d42 | text: #1c1c20
  static ThemeData _light() => _base(
        scaffold: const Color(0xFFF3F2EE),
        surface: const Color(0xFFFFFFFF),
        onSurface: const Color(0xFF1C1C20),
        primary: const Color(0xFF8A6D42),
        onPrimary: Colors.white,
        border: const Color(0x1A1C1C20),
        brightness: Brightness.light,
        gradient: const LinearGradient(
          colors: [Color(0xFFF3F2EE), Color(0xFFF3F2EE)],
        ),
        typeColors: const AppTypeColors(
          movie: Color(0xFF3D7AA8),
          movieDim: Color(0x1F3D7AA8),
          tv: Color(0xFF6B52A8),
          tvDim: Color(0x1F6B52A8),
          anime: Color(0xFFB84A68),
          animeDim: Color(0x1FB84A68),
          franchise: Color(0xFF3D9A7A),
          franchiseDim: Color(0x1F3D9A7A),
          watched: Color(0xFF2D9A52),
          textMuted: Color(0xFF5E5E68),
          titleAccent: Color(0xFF8A6D42), // --title-accent light
          lead: Color(0xFF8A6D42),
          bgElevated: Color(0xFFFFFFFF), // --bg-elevated (theme-light.css)
          tabActiveFg: Color(0xFF1C1C20), // --tab-active-fg (theme-light.css)
          tabBarBg: Color(0x0A000000), // .type-tabs rgba(0,0,0,0.04)
          menuPanelBg: Color(0xFFFFFFFF),
          menuItemHoverBg: Color(0x0D000000), // rgba(0,0,0,0.05)
          menuDangerColor: Color(0xFFF87171),
          menuDangerHoverColor: Color(0xFFFCA5A5),
          menuLangActiveBg: Color(0xFF1C1C20),
          menuLangActiveFg: Color(0xFFFFFFFF),
          searchFieldBg: Color(0xFFE0DED8),
          filterFieldBg: Color(0xFFFFFFFF),
          filterChipFg: Color(0xFFFFFFFF),
          filterChipGradientStart: Color(0xFF9A7B4F),
          filterChipGradientEnd: Color(0xFF7D6238),
          filterChipBorder: Color(0x8C7D6238),
          filterChipRemoveHoverBg: Color(0x24FFFFFF),
        ),
      );

  // ─── Purple (matches theme-purple.css) ───────────────────────────────────
  // bg: #07040f | card: #1a0f30 | accent: #e8c078 (GOLD) | text: #f2eaf8
  static ThemeData _purple() => _base(
        scaffold: const Color(0xFF07040F),
        surface: const Color(0xFF1A0F30),
        onSurface: const Color(0xFFF2EAF8),
        primary: const Color(0xFFE8C078),
        onPrimary: const Color(0xFF1A0828),
        border: const Color(0x24B48CFF),
        brightness: Brightness.dark,
        gradient: const LinearGradient(
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
          colors: [Color(0xFF10062A), Color(0xFF07040F)],
        ),
        typeColors: const AppTypeColors(
          movie: Color(0xFF6EC8FF),
          movieDim: Color(0x246EC8FF),
          tv: Color(0xFFC49CFF),
          tvDim: Color(0x24C49CFF),
          anime: Color(0xFFFF8EB8),
          animeDim: Color(0x24FF8EB8),
          franchise: Color(0xFF5EE0B8),
          franchiseDim: Color(0x1F5EE0B8),
          watched: Color(0xFF62E090),
          textMuted: Color(0xFF9A8AB0),
          titleAccent: Color(0xFFE8C078), // --title-accent purple
          lead: Color(0xFFE8C078),
          bgElevated: Color(0xFF120A22), // --bg-elevated (theme-purple.css)
          tabActiveFg:
              Color(0xFFE8C078), // --tab-active-fg (theme-purple.css) GOLD
          tabBarBg: Color(0x59000000), // .type-tabs rgba(0,0,0,0.35)
          menuPanelBg: Color(0xFF140A26),
          menuItemHoverBg: Color(0x1FFFFFFF), // subtle hover
          menuDangerColor: Color(0xFFF87171),
          menuDangerHoverColor: Color(0xFFFCA5A5),
          menuLangActiveBg: Color(0xFFF0D498),
          menuLangActiveFg: Color(0xFF1A0828),
          menuLangActiveBgEnd: Color(0xFFE8C078),
          searchFieldBg: Color(0x8C0A0414),
          filterFieldBg: Color(0xE0201234),
          filterChipFg: Color(0xFF1A0F2E),
          filterChipGradientStart: Color(0xFFE8D4A8),
          filterChipGradientEnd: Color(0xFFD4BC88),
          filterChipBorder: Color(0x73E8C078),
          filterChipRemoveHoverBg: Color(0x1A1A0F2E),
        ),
      );

  // ─── Brown (matches theme-brown.css) ─────────────────────────────────────
  // bg: #18100c | card: #322018 | accent: #e8c9a8 | text: #faf3eb
  static ThemeData _brown() => _base(
        scaffold: const Color(0xFF18100C),
        surface: const Color(0xFF322018),
        onSurface: const Color(0xFFFAF3EB),
        primary: const Color(0xFFE8C9A8),
        onPrimary: const Color(0xFF3D2318),
        border: const Color(0x29E8C9A8),
        brightness: Brightness.dark,
        gradient: const LinearGradient(
          begin: Alignment(0, -0.5),
          end: Alignment.bottomCenter,
          colors: [Color(0xFF201410), Color(0xFF120A08)],
        ),
        typeColors: const AppTypeColors(
          movie: Color(0xFF8EC0E8),
          movieDim: Color(0x248EC0E8),
          tv: Color(0xFFC4A8E0),
          tvDim: Color(0x24C4A8E0),
          anime: Color(0xFFE098A8),
          animeDim: Color(0x24E098A8),
          franchise: Color(0xFF7ED4B4),
          franchiseDim: Color(0x247ED4B4),
          watched: Color(0xFF78D898),
          textMuted: Color(0xFFB89878),
          titleAccent: Color(0xFFC4A882), // --title-accent brown
          lead: Color(0xFFD9B96A),
          bgElevated: Color(0xFF261810), // --bg-elevated (theme-brown.css)
          tabActiveFg: Color(0xFFF5EAD8), // --tab-active-fg (theme-brown.css)
          tabBarBg: Color(0x6B080402), // rgba(8,4,2,0.42)
          tabBarBgEnd: Color(0x8C120A06), // rgba(18,10,6,0.55)
          menuPanelBg: Color(0xFF322018),
          menuPanelBgEnd: Color(0xFF261810),
          menuItemHoverBg: Color(0x14FFFFFF),
          menuDangerColor: Color(0xFFF87171),
          menuDangerHoverColor: Color(0xFFFCA5A5),
          menuLangActiveBg: Color(0xFFE8D4B8),
          menuLangActiveFg: Color(0xFF3D2318),
          menuLangActiveBgEnd: Color(0xFFD4B896),
          searchFieldBg: Color(0xC70A0604),
          filterFieldBg: Color(0xEB3D2518),
          filterChipFg: Color(0xFF1A1208),
          filterChipGradientStart: Color(0xFFE8D4BC),
          filterChipGradientEnd: Color(0xFFD4B896),
          filterChipBorder: Color(0x73E8C9A8),
          filterChipRemoveHoverBg: Color(0x1A1A1208),
        ),
      );

  // ─── Pink (matches theme-pink.css) ───────────────────────────────────────
  // bg: #9b1149 | card: #7a1840 | accent: #fff | text: #ffffff
  static ThemeData _pink() => _base(
        scaffold: const Color(0xFF9B1149),
        surface: const Color(0xFF7A1840),
        onSurface: Colors.white,
        primary: Colors.white,
        onPrimary: const Color(0xFF4A1430),
        border: const Color(0x47FFB4CD),
        brightness: Brightness.dark,
        gradient: const LinearGradient(
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
          colors: [
            Color(0xFF7A1238),
            Color(0xFF9E1448),
            Color(0xFFB91559),
            Color(0xFFA81450),
            Color(0xFF8E1144),
          ],
          stops: [0, 0.24, 0.5, 0.78, 1.0],
        ),
        typeColors: const AppTypeColors(
          movie: Color(0xFF8EC8FF),
          movieDim: Color(0x248EC8FF),
          tv: Color(0xFFD8A8F0),
          tvDim: Color(0x24D8A8F0),
          anime: Color(0xFFFF9EC0),
          animeDim: Color(0x24FF9EC0),
          franchise: Color(0xFF7ED4B4),
          franchiseDim: Color(0x247ED4B4),
          watched: Color(0xFF78D898),
          textMuted: Color(0xCCFFFFFF),
          titleAccent: Color(0xFFC4A882), // --title-accent pink
          lead: Color(0xFFD9B96A),
          bgElevated: Color(0xFF8A1E47), // --bg-elevated (theme-pink.css)
          tabActiveFg: Color(0xFFFFFFFF), // --tab-active-fg (theme-pink.css)
          tabBarBg: Color(0x59C82D64), // rgba(200,45,100,0.35)
          tabBarBgEnd: Color(0x85AA2055), // rgba(170,32,85,0.52)
          menuPanelBg: Color(0xFF7F2146),
          menuPanelBgEnd: Color(0xFF6A1839),
          menuItemHoverBg: Color(0x14FFFFFF),
          menuDangerColor: Color(0xFFF87171),
          menuDangerHoverColor: Color(0xFFFCA5A5),
          menuLangActiveBg: Color(0xFFD81B60),
          menuLangActiveFg: Color(0xFFFFFFFF),
          menuLangActiveBgEnd: Color(0xFFF06292),
          searchFieldBg: Color(0xFF9A2D58),
          filterFieldBg: Color(0xFF842147),
          filterChipFg: Color(0xFF4A1430),
          filterChipGradientStart: Color(0xFFFFF7FB),
          filterChipGradientMid: Color(0xFFFFE9F3),
          filterChipGradientEnd: Color(0xFFFFD8E9),
          filterChipBorder: Color(0xB3FFDCED),
          filterChipRemoveHoverBg: Color(0x144A1430),
          filterChipHorizontalGradient: true,
        ),
      );

  static String label(AppThemeId id) => switch (id) {
        AppThemeId.dark => 'Dark',
        AppThemeId.light => 'Light',
        AppThemeId.purple => 'Purple',
        AppThemeId.brown => 'Brown',
        AppThemeId.pink => 'Pink',
      };
}
