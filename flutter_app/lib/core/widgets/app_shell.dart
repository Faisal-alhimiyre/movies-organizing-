import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../app/localization.dart';
import '../../app/theme/app_themes.dart';
import '../../app/theme/theme_controller.dart';
import '../../l10n/l10n.dart';
import '../widgets/responsive_layout.dart';

class AppShell extends ConsumerWidget {
  const AppShell({
    super.key,
    required this.title,
    required this.body,
    this.actions,
    this.floatingActionButton,
    this.showLangTheme = true,
  });

  final String title;
  final Widget body;
  final List<Widget>? actions;
  final Widget? floatingActionButton;
  final bool showLangTheme;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = ref.watch(l10nProvider);
    final themeId = ref.watch(themeIdProvider);

    return Scaffold(
      appBar: AppBar(
        title: Text(title),
        actions: [
          if (actions != null) ...actions!,
          if (showLangTheme) ...[
            IconButton(
              tooltip: l10n.languageEn,
              onPressed: () => ref.read(localeProvider.notifier).setLocale(const Locale('en')),
              icon: const Text('E', style: TextStyle(fontWeight: FontWeight.w700)),
            ),
            IconButton(
              tooltip: l10n.languageAr,
              onPressed: () => ref.read(localeProvider.notifier).setLocale(const Locale('ar')),
              icon: const Text('ع', style: TextStyle(fontWeight: FontWeight.w700)),
            ),
            PopupMenuButton<AppThemeId>(
              tooltip: 'Theme',
              initialValue: themeId,
              onSelected: (value) => ref.read(themeIdProvider.notifier).setTheme(value),
              itemBuilder: (context) => AppThemeId.values
                  .map(
                    (id) => PopupMenuItem(
                      value: id,
                      child: Text(AppThemes.label(id)),
                    ),
                  )
                  .toList(),
              icon: const Icon(Icons.palette_outlined),
            ),
          ],
        ],
      ),
      body: ResponsiveBody(child: body),
      floatingActionButton: floatingActionButton,
    );
  }
}
