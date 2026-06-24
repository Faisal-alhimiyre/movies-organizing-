import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../app/localization.dart';
import '../../../../app/theme/theme_controller.dart';
import '../../../../app/theme/theme_extensions.dart';
import '../../../../l10n/l10n.dart';

/// Shared panel decoration for account menu and list-title dropdowns.
BoxDecoration accountMenuPanelDecoration(BuildContext context) {
  final theme = Theme.of(context);
  final tc = theme.extension<AppTypeColors>();
  final border = theme.dividerColor;
  final panelBg = tc?.menuPanelBg ?? theme.colorScheme.surface;
  final panelBgEnd = tc?.menuPanelBgEnd;

  return BoxDecoration(
    color: panelBgEnd == null ? panelBg : null,
    gradient: panelBgEnd != null
        ? LinearGradient(
            begin: Alignment.topCenter,
            end: Alignment.bottomCenter,
            colors: [panelBg, panelBgEnd],
          )
        : null,
    borderRadius: BorderRadius.circular(12),
    border: Border.all(color: border),
    boxShadow: [
      BoxShadow(
        color: Colors.black.withValues(alpha: 0.45),
        blurRadius: 28,
        offset: const Offset(0, 12),
      ),
    ],
  );
}

/// Shows the website-style `.account-menu__panel` anchored to [anchorContext].
Future<void> showAccountMenuPanel({
  required BuildContext context,
  required BuildContext anchorContext,
  required BuildContext parentContext,
  required L10n l10n,
  required bool sharePublishing,
  required VoidCallback onManageLists,
  required VoidCallback onImportFile,
  required VoidCallback onShare,
  required VoidCallback onChangeCode,
  required VoidCallback onDeleteAccount,
  required VoidCallback onSignOut,
}) {
  final box = anchorContext.findRenderObject()! as RenderBox;
  final overlay = Overlay.of(context).context.findRenderObject()! as RenderBox;
  final anchor = box.localToGlobal(Offset.zero, ancestor: overlay);
  final isRtl = Directionality.of(context) == TextDirection.rtl;
  final screenWidth = MediaQuery.sizeOf(context).width;
  const panelWidth = 200.0;
  const gap = 6.4; // 0.4rem

  final left = isRtl
      ? anchor.dx.clamp(8.0, screenWidth - panelWidth - 8)
      : (anchor.dx + box.size.width - panelWidth)
          .clamp(8.0, screenWidth - panelWidth - 8);
  final top = anchor.dy + box.size.height + gap;

  return showGeneralDialog<void>(
    context: context,
    barrierDismissible: true,
    barrierLabel: l10n.menuAccount,
    barrierColor: Colors.transparent,
    transitionDuration: const Duration(milliseconds: 120),
    pageBuilder: (dialogContext, _, __) {
      return Stack(
        children: [
          Positioned(
            left: left,
            top: top,
            width: panelWidth,
            child: Material(
              color: Colors.transparent,
              child: _AccountMenuPanel(
                l10n: l10n,
                parentContext: parentContext,
                sharePublishing: sharePublishing,
                onManageLists: () {
                  Navigator.pop(dialogContext);
                  onManageLists();
                },
                onImportFile: () {
                  Navigator.pop(dialogContext);
                  onImportFile();
                },
                onShare: () {
                  Navigator.pop(dialogContext);
                  if (!sharePublishing) onShare();
                },
                onChangeCode: () {
                  Navigator.pop(dialogContext);
                  onChangeCode();
                },
                onDeleteAccount: () {
                  Navigator.pop(dialogContext);
                  onDeleteAccount();
                },
                onSignOut: () {
                  Navigator.pop(dialogContext);
                  onSignOut();
                },
                onClose: () => Navigator.pop(dialogContext),
              ),
            ),
          ),
        ],
      );
    },
    transitionBuilder: (context, animation, _, child) {
      return FadeTransition(
        opacity: CurvedAnimation(parent: animation, curve: Curves.easeOut),
        child: ScaleTransition(
          scale: Tween<double>(begin: 0.96, end: 1).animate(
            CurvedAnimation(parent: animation, curve: Curves.easeOut),
          ),
          alignment: isRtl ? Alignment.topLeft : Alignment.topRight,
          child: child,
        ),
      );
    },
  );
}

void showThemePickerDialog(BuildContext context, WidgetRef ref) {
  final l10n = ref.read(l10nProvider);
  showDialog<void>(
    context: context,
    builder: (ctx) => Consumer(
      builder: (context, ref, _) {
        final current = ref.watch(themeIdProvider);
        return AlertDialog(
          title: Text(l10n.menuTheme),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: AppThemeId.values.map((id) {
                final selected = id == current;
                return ListTile(
                  leading: _ThemeDot(id: id),
                  title: Text(l10n.themeName(id)),
                  trailing: selected
                      ? Icon(
                          Icons.check,
                          size: 18,
                          color: Theme.of(context).colorScheme.primary,
                        )
                      : null,
                  onTap: () {
                    ref.read(themeIdProvider.notifier).setTheme(id);
                  },
                );
              }).toList(),
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(ctx),
              child: Text(l10n.btnClose),
            ),
          ],
        );
      },
    ),
  );
}

class _AccountMenuPanel extends ConsumerWidget {
  const _AccountMenuPanel({
    required this.l10n,
    required this.parentContext,
    required this.sharePublishing,
    required this.onManageLists,
    required this.onImportFile,
    required this.onShare,
    required this.onChangeCode,
    required this.onDeleteAccount,
    required this.onSignOut,
    required this.onClose,
  });

  final L10n l10n;
  final BuildContext parentContext;
  final bool sharePublishing;
  final VoidCallback onManageLists;
  final VoidCallback onImportFile;
  final VoidCallback onShare;
  final VoidCallback onChangeCode;
  final VoidCallback onDeleteAccount;
  final VoidCallback onSignOut;
  final VoidCallback onClose;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final tc = theme.extension<AppTypeColors>();
    final onSurface = theme.colorScheme.onSurface;
    final textMuted = tc?.textMuted ?? onSurface.withValues(alpha: 0.55);
    final hoverBg = tc?.menuItemHoverBg ?? onSurface.withValues(alpha: 0.06);
    final dangerColor = tc?.menuDangerColor ?? const Color(0xFFF87171);
    final locale = ref.watch(localeProvider);

    return DecoratedBox(
      decoration: accountMenuPanelDecoration(context),
      child: Padding(
        padding: const EdgeInsets.all(6.4), // 0.4rem
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            _MenuItem(
              label: l10n.manageListsTitle,
              onSurface: onSurface,
              hoverBg: hoverBg,
              onTap: onManageLists,
            ),
            _MenuItem(
              label: l10n.menuShare,
              onSurface: onSurface,
              hoverBg: hoverBg,
              enabled: !sharePublishing,
              trailing: sharePublishing
                  ? SizedBox(
                      width: 14,
                      height: 14,
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                        color: onSurface.withValues(alpha: 0.65),
                      ),
                    )
                  : null,
              onTap: onShare,
            ),
            _MenuItem(
              label: l10n.menuImportFile,
              onSurface: onSurface,
              hoverBg: hoverBg,
              onTap: onImportFile,
            ),
            _MenuItem(
              label: l10n.menuTheme,
              onSurface: onSurface,
              hoverBg: hoverBg,
              onTap: () {
                onClose();
                WidgetsBinding.instance.addPostFrameCallback((_) {
                  if (parentContext.mounted) {
                    showThemePickerDialog(parentContext, ref);
                  }
                });
              },
            ),
            _LanguageSection(
              l10n: l10n,
              locale: locale,
              textMuted: textMuted,
              onSurface: onSurface,
              border: theme.dividerColor,
              tc: tc,
              onSelectEn: () {
                ref.read(localeProvider.notifier).setLocale(const Locale('en'));
              },
              onSelectAr: () {
                ref.read(localeProvider.notifier).setLocale(const Locale('ar'));
              },
            ),
            _MenuDivider(color: theme.dividerColor),
            _MenuItem(
              label: l10n.menuChangeCode,
              onSurface: onSurface,
              hoverBg: hoverBg,
              onTap: onChangeCode,
            ),
            _MenuItem(
              label: l10n.menuDeleteAccount,
              onSurface: dangerColor,
              hoverBg:
                  (tc?.menuDangerColor ?? dangerColor).withValues(alpha: 0.1),
              hoverFg: tc?.menuDangerHoverColor ?? dangerColor,
              onTap: onDeleteAccount,
            ),
            _MenuItem(
              label: l10n.menuSignOut,
              onSurface: onSurface,
              hoverBg: hoverBg,
              onTap: onSignOut,
            ),
          ],
        ),
      ),
    );
  }
}

class _MenuItem extends StatefulWidget {
  const _MenuItem({
    required this.label,
    required this.onSurface,
    required this.hoverBg,
    required this.onTap,
    this.enabled = true,
    this.hoverFg,
    this.trailing,
  });

  final String label;
  final Color onSurface;
  final Color hoverBg;
  final Color? hoverFg;
  final VoidCallback onTap;
  final bool enabled;
  final Widget? trailing;

  @override
  State<_MenuItem> createState() => _MenuItemState();
}

class _MenuItemState extends State<_MenuItem> {
  bool _hovered = false;

  @override
  Widget build(BuildContext context) {
    final fg = !widget.enabled
        ? widget.onSurface.withValues(alpha: 0.4)
        : _hovered
            ? (widget.hoverFg ?? widget.onSurface)
            : widget.onSurface;

    return MouseRegion(
      onEnter: (_) => setState(() => _hovered = true),
      onExit: (_) => setState(() => _hovered = false),
      child: Material(
        color: _hovered && widget.enabled ? widget.hoverBg : Colors.transparent,
        borderRadius: BorderRadius.circular(8),
        child: InkWell(
          borderRadius: BorderRadius.circular(8),
          onTap: widget.enabled ? widget.onTap : null,
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 10.4, vertical: 8),
            child: Row(
              children: [
                Expanded(
                  child: Text(
                    widget.label,
                    textAlign: TextAlign.start,
                    style: TextStyle(
                      fontSize: 13.44, // 0.84rem
                      fontWeight: FontWeight.w500,
                      color: fg,
                    ),
                  ),
                ),
                if (widget.trailing != null) ...[
                  const SizedBox(width: 8),
                  widget.trailing!,
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _LanguageSection extends StatelessWidget {
  const _LanguageSection({
    required this.l10n,
    required this.locale,
    required this.textMuted,
    required this.onSurface,
    required this.border,
    required this.tc,
    required this.onSelectEn,
    required this.onSelectAr,
  });

  final L10n l10n;
  final Locale locale;
  final Color textMuted;
  final Color onSurface;
  final Color border;
  final AppTypeColors? tc;
  final VoidCallback onSelectEn;
  final VoidCallback onSelectAr;

  @override
  Widget build(BuildContext context) {
    final isEn = locale.languageCode == 'en';
    final activeBg = tc?.menuLangActiveBg ?? const Color(0xFF0095F6);
    final activeBgEnd = tc?.menuLangActiveBgEnd;
    final activeFg = tc?.menuLangActiveFg ?? Colors.white;

    return Padding(
      padding: const EdgeInsets.fromLTRB(8.8, 5.6, 8.8, 7.2),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            l10n.menuLanguage,
            textAlign: TextAlign.start,
            style: TextStyle(
              fontSize: 10.88, // 0.68rem
              fontWeight: FontWeight.w500,
              color: textMuted,
            ),
          ),
          const SizedBox(height: 4),
          Row(
            children: [
              Expanded(
                child: _LangButton(
                  label: l10n.languageEn,
                  active: isEn,
                  onSurface: onSurface,
                  border: border,
                  activeBg: activeBg,
                  activeBgEnd: activeBgEnd,
                  activeFg: activeFg,
                  onTap: onSelectEn,
                ),
              ),
              const SizedBox(width: 5.6), // 0.35rem
              Expanded(
                child: _LangButton(
                  label: l10n.languageAr,
                  active: !isEn,
                  onSurface: onSurface,
                  border: border,
                  activeBg: activeBg,
                  activeBgEnd: activeBgEnd,
                  activeFg: activeFg,
                  onTap: onSelectAr,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _LangButton extends StatefulWidget {
  const _LangButton({
    required this.label,
    required this.active,
    required this.onSurface,
    required this.border,
    required this.activeBg,
    required this.activeBgEnd,
    required this.activeFg,
    required this.onTap,
  });

  final String label;
  final bool active;
  final Color onSurface;
  final Color border;
  final Color activeBg;
  final Color? activeBgEnd;
  final Color activeFg;
  final VoidCallback onTap;

  @override
  State<_LangButton> createState() => _LangButtonState();
}

class _LangButtonState extends State<_LangButton> {
  bool _hovered = false;

  @override
  Widget build(BuildContext context) {
    final inactiveFg =
        _hovered ? widget.onSurface : widget.onSurface.withValues(alpha: 0.55);

    return Material(
      color: Colors.transparent,
      borderRadius: BorderRadius.circular(999),
      child: InkWell(
        borderRadius: BorderRadius.circular(999),
        onTap: widget.onTap,
        onHover: (hovered) => setState(() => _hovered = hovered),
        child: Ink(
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(999),
            color: widget.active && widget.activeBgEnd == null
                ? widget.activeBg
                : (!widget.active
                    ? widget.onSurface.withValues(alpha: 0.03)
                    : null),
            gradient: widget.active && widget.activeBgEnd != null
                ? LinearGradient(
                    begin: Alignment.topCenter,
                    end: Alignment.bottomCenter,
                    colors: [widget.activeBg, widget.activeBgEnd!],
                  )
                : null,
            border: Border.all(
              color: widget.active ? Colors.transparent : widget.border,
            ),
          ),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6.4),
            child: Text(
              widget.label,
              textAlign: TextAlign.center,
              style: TextStyle(
                fontSize: 12.48, // 0.78rem
                fontWeight: FontWeight.w600,
                color: widget.active ? widget.activeFg : inactiveFg,
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _MenuDivider extends StatelessWidget {
  const _MenuDivider({required this.color});

  final Color color;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 5.6, vertical: 4.8),
      child: DecoratedBox(
        decoration: BoxDecoration(color: color),
        child: const SizedBox(height: 1, width: double.infinity),
      ),
    );
  }
}

class _ThemeDot extends StatelessWidget {
  const _ThemeDot({required this.id});
  final AppThemeId id;

  @override
  Widget build(BuildContext context) {
    final color = switch (id) {
      AppThemeId.dark => const Color(0xFF1A1A1A),
      AppThemeId.light => const Color(0xFFF1F5F9),
      AppThemeId.purple => const Color(0xFF1A1025),
      AppThemeId.brown => const Color(0xFF1C1410),
      AppThemeId.pink => const Color(0xFF1A0A10),
    };
    return Container(
      width: 20,
      height: 20,
      decoration: BoxDecoration(
        color: color,
        shape: BoxShape.circle,
        border: Border.all(
          color: Theme.of(context).colorScheme.onSurface.withValues(alpha: 0.3),
        ),
      ),
    );
  }
}
