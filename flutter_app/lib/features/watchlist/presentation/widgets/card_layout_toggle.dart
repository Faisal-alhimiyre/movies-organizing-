import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../app/theme/theme_controller.dart';
import '../../../../app/theme/theme_extensions.dart';
import '../../../../core/widgets/responsive_layout.dart';
import '../../../../l10n/l10n.dart';
import '../../application/card_layout_controller.dart';
import '../../application/link_preview_controller.dart';

/// Grid / list view toggles — mirrors `.page-toolbar` / `.layout-bar` / `.layout-toggle`.
class CardLayoutToggle extends ConsumerWidget {
  const CardLayoutToggle({super.key, required this.l10n});

  final L10n l10n;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final layout = ref.watch(cardLayoutProvider);
    final theme = Theme.of(context);
    final tc = theme.extension<AppTypeColors>()!;
    final themeId = ref.watch(themeIdProvider);
    final isMobile = AppBreakpoints.isMobile(context);
    final barStyle = _layoutBarStyle(themeId, tc, theme);

    void toggle(CardLayoutId id) {
      ref.read(linkPreviewControllerProvider.notifier).hide();
      ref.read(cardLayoutProvider.notifier).setLayout(id);
    }

    final btnSize = isMobile ? 33.6 : 36.0; // 2.1rem / 2.25rem
    final iconSize = 19.2; // 1.2rem
    final gap = 2.4; // 0.15rem

    return Semantics(
      label: l10n.layoutToolbar,
      child: DecoratedBox(
        decoration: barStyle.bar,
        child: Padding(
          padding: const EdgeInsets.all(3.2), // 0.2rem
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              _LayoutToggleBtn(
                icon: Icons.view_agenda_outlined,
                tooltip: l10n.layoutHover,
                active: layout == CardLayoutId.hover,
                size: btnSize,
                iconSize: iconSize,
                theme: theme,
                tc: tc,
                activeStyle: barStyle.active,
                onTap: () => toggle(CardLayoutId.hover),
              ),
              SizedBox(width: gap),
              _LayoutToggleBtn(
                icon: Icons.view_module_outlined,
                tooltip: l10n.layoutPoster,
                active: layout == CardLayoutId.poster,
                size: btnSize,
                iconSize: iconSize,
                theme: theme,
                tc: tc,
                activeStyle: barStyle.active,
                onTap: () => toggle(CardLayoutId.poster),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _LayoutToggleActiveStyle {
  const _LayoutToggleActiveStyle({
    required this.background,
    required this.border,
    required this.icon,
  });

  final Color background;
  final Color border;
  final Color icon;
}

class _LayoutBarStyle {
  const _LayoutBarStyle({
    required this.bar,
    required this.active,
  });

  final BoxDecoration bar;
  final _LayoutToggleActiveStyle active;
}

_LayoutBarStyle _layoutBarStyle(
  AppThemeId themeId,
  AppTypeColors tc,
  ThemeData theme,
) {
  final border = theme.dividerColor;
  final onSurface = theme.colorScheme.onSurface;

  final bar = switch (themeId) {
    AppThemeId.purple => BoxDecoration(
        gradient: const LinearGradient(
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
          colors: [Color(0x1A8C50DC), Color(0x1A8C50DC)],
        ),
        border: Border.all(color: const Color(0x24B48CFF)),
        borderRadius: BorderRadius.circular(999),
      ),
    AppThemeId.pink => BoxDecoration(
        gradient: const LinearGradient(
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
          colors: [Color(0x24FFA0C8), Color(0x7AB9265A)],
        ),
        border: Border.all(color: const Color(0x3DFFB4CD)),
        borderRadius: BorderRadius.circular(999),
      ),
    AppThemeId.brown => BoxDecoration(
        gradient: const LinearGradient(
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
          colors: [Color(0x0DFFF8F0), Color(0x1AC9956A)],
        ),
        border: Border.all(color: const Color(0x29E8C9A8)),
        borderRadius: BorderRadius.circular(999),
      ),
    AppThemeId.light => BoxDecoration(
        color: const Color(0x0A000000),
        border: Border.all(color: border),
        borderRadius: BorderRadius.circular(999),
      ),
    AppThemeId.dark => BoxDecoration(
        color: tc.bgElevated,
        border: Border.all(color: border),
        borderRadius: BorderRadius.circular(999),
      ),
  };

  final active = switch (themeId) {
    AppThemeId.purple => _LayoutToggleActiveStyle(
        background: const Color(0x26E8C078),
        border: const Color(0x4DE8C078),
        icon: onSurface,
      ),
    AppThemeId.pink => const _LayoutToggleActiveStyle(
        background: const Color(0x38FFB4CD),
        border: const Color(0x61FFC8DA),
        icon: Colors.white,
      ),
    AppThemeId.brown => _LayoutToggleActiveStyle(
        background: const Color(0x29E8C9A8),
        border: const Color(0x4DF5EAD8),
        icon: onSurface,
      ),
    AppThemeId.light => _LayoutToggleActiveStyle(
        background: const Color(0x12000000),
        border: border,
        icon: onSurface,
      ),
    AppThemeId.dark => _LayoutToggleActiveStyle(
        background: const Color(0xFF262626),
        border: const Color(0xFF525252),
        icon: onSurface,
      ),
  };

  return _LayoutBarStyle(bar: bar, active: active);
}

class _LayoutToggleBtn extends StatelessWidget {
  const _LayoutToggleBtn({
    required this.icon,
    required this.tooltip,
    required this.active,
    required this.size,
    required this.iconSize,
    required this.theme,
    required this.tc,
    required this.activeStyle,
    required this.onTap,
  });

  final IconData icon;
  final String tooltip;
  final bool active;
  final double size;
  final double iconSize;
  final ThemeData theme;
  final AppTypeColors tc;
  final _LayoutToggleActiveStyle activeStyle;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final muted = tc.textMuted;
    final iconColor = active ? activeStyle.icon : muted;
    final bgColor = active ? activeStyle.background : Colors.transparent;
    final borderColor = active ? activeStyle.border : Colors.transparent;

    return Tooltip(
      message: tooltip,
      child: Material(
        color: Colors.transparent,
        borderRadius: BorderRadius.circular(999),
        child: InkWell(
          borderRadius: BorderRadius.circular(999),
          onTap: onTap,
          child: AnimatedContainer(
            duration: const Duration(milliseconds: 150),
            width: size,
            height: size,
            decoration: BoxDecoration(
              color: bgColor,
              borderRadius: BorderRadius.circular(999),
              border: Border.all(color: borderColor),
            ),
            child: Icon(icon, size: iconSize, color: iconColor),
          ),
        ),
      ),
    );
  }
}
