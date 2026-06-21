import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../l10n/l10n.dart';
import '../../application/link_preview_controller.dart';
import '../../application/link_preview_meta.dart';
import 'link_preview_popover.dart';

/// Desktop hover metadata popover — mirrors web `#linkPreviewPopover`.
class LinkPreviewLayer extends ConsumerWidget {
  const LinkPreviewLayer({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state = ref.watch(linkPreviewControllerProvider);
    if (!state.visible || state.anchor == null || state.item == null) {
      return const SizedBox.shrink();
    }

    final l10n = ref.watch(l10nProvider);
    final screen = MediaQuery.sizeOf(context);
    final width = math.min(320.0, screen.width - 32);
    final position = computeLinkPreviewPosition(
      anchor: state.anchor!,
      screenSize: screen,
      popoverWidth: width,
    );

    return Positioned(
      left: position.dx,
      top: position.dy,
      width: width,
      child: MouseRegion(
        onEnter: (_) =>
            ref.read(linkPreviewControllerProvider.notifier).cancelHide(),
        onExit: (_) =>
            ref.read(linkPreviewControllerProvider.notifier).scheduleHide(),
        child: Material(
          elevation: 10,
          shadowColor: Colors.black.withValues(alpha: 0.35),
          borderRadius: BorderRadius.circular(12),
          clipBehavior: Clip.antiAlias,
          child: LinkPreviewPopover(
            loading: state.loading,
            details: state.details,
            item: state.item!,
            l10n: l10n,
          ),
        ),
      ),
    );
  }
}
