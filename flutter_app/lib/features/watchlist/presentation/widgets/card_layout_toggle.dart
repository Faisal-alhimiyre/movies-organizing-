import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../l10n/l10n.dart';
import '../../application/card_layout_controller.dart';
import '../../application/link_preview_controller.dart';

/// Two square ghost icon buttons matching the website's `.layout-toggle`:
///   inactive = muted icon with border
///   active   = gold icon + gold border + gold tinted background
class CardLayoutToggle extends ConsumerWidget {
  const CardLayoutToggle({super.key, required this.l10n});

  final L10n l10n;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final layout = ref.watch(cardLayoutProvider);

    void toggle(CardLayoutId id) {
      ref.read(linkPreviewControllerProvider.notifier).hide();
      ref.read(cardLayoutProvider.notifier).setLayout(id);
    }

    return Semantics(
      label: l10n.layoutToolbar,
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          _LayoutToggleBtn(
            icon: Icons.view_agenda_outlined,
            tooltip: l10n.layoutHover,
            active: layout == CardLayoutId.hover,
            onTap: () => toggle(CardLayoutId.hover),
          ),
          const SizedBox(width: 4),
          _LayoutToggleBtn(
            icon: Icons.view_module_outlined,
            tooltip: l10n.layoutPoster,
            active: layout == CardLayoutId.poster,
            onTap: () => toggle(CardLayoutId.poster),
          ),
        ],
      ),
    );
  }
}

class _LayoutToggleBtn extends StatelessWidget {
  const _LayoutToggleBtn({
    required this.icon,
    required this.tooltip,
    required this.active,
    required this.onTap,
  });

  final IconData icon;
  final String tooltip;
  final bool active;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final accent = theme.colorScheme.primary;
    final onSurface = theme.colorScheme.onSurface;

    final iconColor = active ? accent : onSurface.withValues(alpha: 0.45);
    final borderColor = active
        ? accent.withValues(alpha: 0.45)
        : onSurface.withValues(alpha: 0.15);
    final bgColor =
        active ? accent.withValues(alpha: 0.08) : theme.colorScheme.surface;

    return Tooltip(
      message: tooltip,
      child: Material(
        color: Colors.transparent,
        borderRadius: BorderRadius.circular(8),
        child: InkWell(
          borderRadius: BorderRadius.circular(8),
          onTap: onTap,
          child: AnimatedContainer(
            duration: const Duration(milliseconds: 150),
            width: 36,
            height: 36,
            decoration: BoxDecoration(
              color: bgColor,
              borderRadius: BorderRadius.circular(8),
              border: Border.all(color: borderColor),
            ),
            child: Icon(icon, size: 18, color: iconColor),
          ),
        ),
      ),
    );
  }
}
