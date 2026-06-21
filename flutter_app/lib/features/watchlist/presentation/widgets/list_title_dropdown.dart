import 'package:flutter/material.dart';

import '../../../../app/theme/theme_extensions.dart';
import '../../../../models/list_library_entry.dart';
import 'account_menu_panel.dart';

/// Anchored list selector — opens directly beneath the title box (not a dialog).
class ListTitleDropdown extends StatefulWidget {
  const ListTitleDropdown({
    super.key,
    required this.listName,
    required this.titleStyle,
    required this.titleAccent,
    required this.library,
    required this.currentListId,
    required this.onSurface,
    required this.theme,
    required this.onSwitchList,
  });

  final String listName;
  final TextStyle titleStyle;
  final Color titleAccent;
  final List<ListLibraryEntry> library;
  final String? currentListId;
  final Color onSurface;
  final ThemeData theme;
  final ValueChanged<String> onSwitchList;

  @override
  State<ListTitleDropdown> createState() => _ListTitleDropdownState();
}

class _ListTitleDropdownState extends State<ListTitleDropdown>
    with SingleTickerProviderStateMixin {
  final _link = LayerLink();
  OverlayEntry? _overlay;
  late final AnimationController _anim;
  late final Animation<double> _fade;
  late final Animation<double> _scale;

  bool get _isOpen => _overlay != null;

  @override
  void initState() {
    super.initState();
    _anim = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 150),
      reverseDuration: const Duration(milliseconds: 120),
    );
    _fade = CurvedAnimation(parent: _anim, curve: Curves.easeOut);
    _scale = Tween<double>(begin: 0.96, end: 1).animate(
      CurvedAnimation(parent: _anim, curve: Curves.easeOut),
    );
  }

  @override
  void dispose() {
    _removeOverlay(immediate: true);
    _anim.dispose();
    super.dispose();
  }

  List<ListLibraryEntry> get _sortedLibrary {
    final current = widget.currentListId;
    final currentEntries =
        widget.library.where((e) => e.listId == current).toList();
    final others = widget.library.where((e) => e.listId != current).toList();
    return [...currentEntries, ...others];
  }

  void _toggle() {
    if (_isOpen) {
      _close();
    } else {
      _open();
    }
  }

  void _open() {
    if (_overlay != null) return;
    _overlay = _buildOverlay();
    Overlay.of(context).insert(_overlay!);
    _anim.forward(from: 0);
    setState(() {});
  }

  Future<void> _close() async {
    if (_overlay == null) return;
    await _anim.reverse();
    _removeOverlay();
    if (mounted) setState(() {});
  }

  void _removeOverlay({bool immediate = false}) {
    _overlay?.remove();
    _overlay = null;
    if (immediate) {
      _anim.stop();
      _anim.value = 0;
    }
  }

  void _select(String listId) {
    if (listId != widget.currentListId) {
      widget.onSwitchList(listId);
    }
    _close();
  }

  OverlayEntry _buildOverlay() {
    final isRtl = Directionality.of(context) == TextDirection.rtl;
    final targetContext = context;
    final renderBox = targetContext.findRenderObject()! as RenderBox;
    final panelWidth = renderBox.size.width;
    final screenWidth = MediaQuery.sizeOf(context).width;
    final anchor = renderBox.localToGlobal(Offset.zero);
    final maxRight = screenWidth - 8;
    final overflowRight = anchor.dx + panelWidth - maxRight;
    final horizontalShift = overflowRight > 0 ? -overflowRight : 0.0;

    return OverlayEntry(
      builder: (overlayContext) {
        final tc = widget.theme.extension<AppTypeColors>();
        final panelBg = tc?.menuPanelBg ?? widget.theme.colorScheme.surface;

        return Stack(
          children: [
            Positioned.fill(
              child: GestureDetector(
                behavior: HitTestBehavior.translucent,
                onTap: _close,
              ),
            ),
            CompositedTransformFollower(
              link: _link,
              showWhenUnlinked: false,
              targetAnchor:
                  isRtl ? Alignment.bottomRight : Alignment.bottomLeft,
              followerAnchor: isRtl ? Alignment.topRight : Alignment.topLeft,
              offset: Offset(horizontalShift, 4),
              child: FadeTransition(
                opacity: _fade,
                child: ScaleTransition(
                  scale: _scale,
                  alignment: isRtl ? Alignment.topRight : Alignment.topLeft,
                  child: Material(
                    color: Colors.transparent,
                    child: ConstrainedBox(
                      constraints: BoxConstraints(
                        minWidth: panelWidth,
                        maxWidth: panelWidth.clamp(120, screenWidth - 16),
                      ),
                      child: DecoratedBox(
                        decoration:
                            accountMenuPanelDecoration(overlayContext).copyWith(
                          boxShadow: [
                            BoxShadow(
                              color: Colors.black.withValues(alpha: 0.35),
                              blurRadius: 16,
                              offset: const Offset(0, 6),
                            ),
                          ],
                        ),
                        child: ClipRRect(
                          borderRadius: BorderRadius.circular(12),
                          child: Column(
                            mainAxisSize: MainAxisSize.min,
                            crossAxisAlignment: CrossAxisAlignment.stretch,
                            children: _sortedLibrary.map((entry) {
                              final isCurrent =
                                  entry.listId == widget.currentListId;
                              return _ListMenuItem(
                                name: entry.name,
                                isCurrent: isCurrent,
                                onSurface: widget.onSurface,
                                primary: widget.theme.colorScheme.primary,
                                panelBg: panelBg,
                                hoverBg: tc?.menuItemHoverBg ??
                                    widget.onSurface.withValues(alpha: 0.06),
                                onTap: () => _select(entry.listId),
                              );
                            }).toList(),
                          ),
                        ),
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ],
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    final borderColor = widget.titleAccent.withValues(alpha: 0.35);
    final fillColor = widget.titleAccent.withValues(alpha: 0.08);

    return CompositedTransformTarget(
      link: _link,
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: _toggle,
          borderRadius: BorderRadius.circular(10),
          child: Ink(
            decoration: BoxDecoration(
              color: _isOpen ? fillColor : Colors.transparent,
              borderRadius: BorderRadius.circular(10),
              border: Border.all(
                color: _isOpen
                    ? widget.titleAccent.withValues(alpha: 0.55)
                    : borderColor,
              ),
            ),
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Flexible(
                    child: Text(
                      widget.listName,
                      style: widget.titleStyle,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                  const SizedBox(width: 2),
                  AnimatedRotation(
                    turns: _isOpen ? 0.5 : 0,
                    duration: const Duration(milliseconds: 150),
                    child: Icon(
                      Icons.keyboard_arrow_down,
                      size: 20,
                      color: widget.titleAccent.withValues(alpha: 0.75),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _ListMenuItem extends StatefulWidget {
  const _ListMenuItem({
    required this.name,
    required this.isCurrent,
    required this.onSurface,
    required this.primary,
    required this.panelBg,
    required this.hoverBg,
    required this.onTap,
  });

  final String name;
  final bool isCurrent;
  final Color onSurface;
  final Color primary;
  final Color panelBg;
  final Color hoverBg;
  final VoidCallback onTap;

  @override
  State<_ListMenuItem> createState() => _ListMenuItemState();
}

class _ListMenuItemState extends State<_ListMenuItem> {
  bool _hovered = false;

  @override
  Widget build(BuildContext context) {
    final fg = widget.isCurrent
        ? widget.primary
        : (_hovered
            ? widget.onSurface
            : widget.onSurface.withValues(alpha: 0.9));

    return MouseRegion(
      onEnter: (_) => setState(() => _hovered = true),
      onExit: (_) => setState(() => _hovered = false),
      child: Material(
        color: _hovered ? widget.hoverBg : widget.panelBg,
        child: InkWell(
          onTap: widget.onTap,
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
            child: Row(
              children: [
                Expanded(
                  child: Text(
                    widget.name,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      fontSize: 13.44,
                      fontWeight:
                          widget.isCurrent ? FontWeight.w600 : FontWeight.w500,
                      color: fg,
                    ),
                  ),
                ),
                if (widget.isCurrent) ...[
                  const SizedBox(width: 8),
                  Icon(Icons.check, size: 16, color: widget.primary),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}
