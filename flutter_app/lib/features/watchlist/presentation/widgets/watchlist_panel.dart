import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../app/theme/theme_controller.dart';
import '../../../../app/theme/theme_extensions.dart';
import '../../../../core/widgets/responsive_layout.dart';

/// Mirrors the website `.panel` — elevated container wrapping type tabs + filters.
class WatchlistPanel extends ConsumerWidget {
  const WatchlistPanel({
    super.key,
    required this.tabs,
    this.filters,
  });

  final Widget tabs;
  final Widget? filters;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final tc = theme.extension<AppTypeColors>();
    final isMobile = AppBreakpoints.isMobile(context);
    final themeId = ref.watch(themeIdProvider);

    final radius = isMobile
        ? 10.0
        : themeId == AppThemeId.dark
            ? 0.0
            : 14.0;

    return Padding(
      padding: EdgeInsets.only(bottom: isMobile ? 12 : 32),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(radius),
        child: DecoratedBox(
          decoration: BoxDecoration(
            color: tc?.bgElevated,
            border: Border.all(color: theme.dividerColor),
            borderRadius: BorderRadius.circular(radius),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              tabs,
              if (filters != null) filters!,
            ],
          ),
        ),
      ),
    );
  }
}
