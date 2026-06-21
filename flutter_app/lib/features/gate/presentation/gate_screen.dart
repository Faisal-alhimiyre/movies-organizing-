import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:google_fonts/google_fonts.dart';

import '../../../app/localization.dart';
import '../../../app/theme/app_themes.dart';
import '../../../app/theme/theme_controller.dart';
import '../../../core/services/session_service.dart';
import '../../../core/storage/hive_boxes.dart';
import '../../../core/utils/code_validator.dart';
import '../../../core/utils/pending_share.dart';
import '../../../core/utils/pending_share_storage.dart';
import '../../../l10n/l10n.dart';
import '../../../models/session.dart';
import '../../../repositories/auth_repository.dart';
import 'gate_code_rules.dart';

enum GateMode { login, create }

class GateScreen extends ConsumerStatefulWidget {
  const GateScreen({
    super.key,
    this.shareId,
    this.initialMode = GateMode.login,
    this.showDeletedMessage = false,
  });

  final String? shareId;
  final GateMode initialMode;
  final bool showDeletedMessage;

  @override
  ConsumerState<GateScreen> createState() => _GateScreenState();
}

class _GateScreenState extends ConsumerState<GateScreen> {
  late GateMode _mode;
  final _codeController = TextEditingController();
  final _confirmController = TextEditingController();
  final _codeFocus = FocusNode();
  final _confirmFocus = FocusNode();
  bool _obscureCode = true;
  bool _loading = false;
  String? _errorKey;
  bool _invalidCode = false;
  bool _invalidConfirm = false;

  @override
  void initState() {
    super.initState();
    _mode = widget.initialMode;
    final fromLocation = readShareFromLocation();
    if (fromLocation != null) {
      writePendingShareSession(fromLocation);
    }
    _persistShareId();
    if (widget.showDeletedMessage) {
      _errorKey = 'gate.deleted';
    }
  }

  String? get _activeShareId {
    return readShareFromLocation() ??
        resolvePendingShareId(fromRoute: widget.shareId);
  }

  Future<void> _persistShareId() async {
    await persistPendingShareId(_activeShareId);
  }

  Future<void> _completeAuth(Session session, {String? shareId}) async {
    await persistPendingShareId(shareId ?? _activeShareId);

    // Web: save session then full page reload (matches web gate.js goToApp).
    // Avoids GoRouter stripping ?share= during client-side redirect.
    if (kIsWeb) {
      await HiveBoxes.saveSession(session.toJson());
      final id = resolvePendingShareId();
      if (id != null && id.isNotEmpty) {
        navigateToHomeWithShare(id);
      } else {
        navigateToHome();
      }
      return;
    }

    await ref.read(sessionProvider.notifier).setSession(session);
  }

  @override
  void dispose() {
    _codeController.dispose();
    _confirmController.dispose();
    _codeFocus.dispose();
    _confirmFocus.dispose();
    super.dispose();
  }

  void _clearErrors() {
    if (_errorKey == null && !_invalidCode && !_invalidConfirm) return;
    setState(() {
      _errorKey = null;
      _invalidCode = false;
      _invalidConfirm = false;
    });
  }

  void _setError(String? key, {bool code = false, bool confirm = false}) {
    setState(() {
      _errorKey = key;
      _invalidCode = code;
      _invalidConfirm = confirm;
    });
  }

  Future<void> _submit() async {
    if (_loading) return;
    _clearErrors();

    final pendingShare = readShareFromLocation() ?? _activeShareId;
    final auth = ref.read(authRepositoryProvider);
    final code = _codeController.text;

    if (_mode == GateMode.create) {
      final confirm = _confirmController.text;
      final formatKey = validateCodeKey(code, forCreate: true);
      if (formatKey != null) {
        _setError(formatKey, code: true, confirm: true);
        return;
      }
      if (code != confirm) {
        _setError('gate.codesMismatch', code: true, confirm: true);
        return;
      }

      setState(() => _loading = true);
      try {
        if (await auth.accountExists(code)) {
          _setError('gate.codeExists', code: true);
          return;
        }

        final result = await auth.signIn(code, create: true);
        if (!result.ok) {
          _setError(result.errorKey, code: true, confirm: true);
          return;
        }

        await _completeAuth(result.session!, shareId: pendingShare);
      } finally {
        if (mounted) setState(() => _loading = false);
      }
      return;
    }

    final formatKey = validateCodeKey(code, forCreate: false);
    if (formatKey != null) {
      _setError(formatKey, code: true);
      return;
    }

    setState(() => _loading = true);
    try {
      if (!await auth.accountExists(code)) {
        _setError('gate.noList', code: true);
        return;
      }

      final result = await auth.signIn(code, create: false);
      if (!result.ok) {
        _setError(result.errorKey, code: true);
        return;
      }

      await _completeAuth(result.session!, shareId: pendingShare);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = ref.watch(l10nProvider);
    final theme = Theme.of(context);
    final themeId = ref.watch(themeIdProvider);
    final isCreate = _mode == GateMode.create;
    final errorText = _errorKey == null ? null : l10n.message(_errorKey!);
    final pendingShareId = _activeShareId;
    final onSurface = theme.colorScheme.onSurface;
    final accent = theme.colorScheme.primary;

    return Scaffold(
      backgroundColor: Colors.transparent,
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 32),
          child: Column(
            children: [
              // ── Lang + theme controls ────────────────────────────────────
              Row(
                mainAxisAlignment: MainAxisAlignment.end,
                children: [
                  _LangButton(
                    label: 'E',
                    onTap: () => ref
                        .read(localeProvider.notifier)
                        .setLocale(const Locale('en')),
                  ),
                  const SizedBox(width: 6),
                  _LangButton(
                    label: 'ع',
                    onTap: () => ref
                        .read(localeProvider.notifier)
                        .setLocale(const Locale('ar')),
                  ),
                  const SizedBox(width: 8),
                  PopupMenuButton<AppThemeId>(
                    tooltip: 'Theme',
                    initialValue: themeId,
                    onSelected: (id) =>
                        ref.read(themeIdProvider.notifier).setTheme(id),
                    itemBuilder: (ctx) => AppThemeId.values
                        .map((id) => PopupMenuItem(
                              value: id,
                              child: Text(AppThemes.label(id)),
                            ))
                        .toList(),
                    child: Icon(Icons.palette_outlined,
                        size: 20, color: onSurface.withValues(alpha: 0.65)),
                  ),
                ],
              ),

              const SizedBox(height: 20),

              // ── Gate card ────────────────────────────────────────────────
              ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 360),
                child: DecoratedBox(
                  decoration: BoxDecoration(
                    color: theme.colorScheme.surface,
                    borderRadius: BorderRadius.circular(16),
                    border: Border.all(
                      color: onSurface.withValues(alpha: 0.1),
                    ),
                    boxShadow: [
                      BoxShadow(
                        color: Colors.black.withValues(alpha: 0.25),
                        blurRadius: 40,
                        offset: const Offset(0, 16),
                      ),
                    ],
                  ),
                  child: Padding(
                    padding: const EdgeInsets.fromLTRB(24, 28, 24, 24),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        // Brand
                        Text(
                          l10n.appTitle,
                          textAlign: TextAlign.center,
                          style: GoogleFonts.playfairDisplay(
                            fontSize: 26,
                            fontWeight: FontWeight.w700,
                            color: onSurface,
                            letterSpacing: -0.5,
                          ),
                        ),
                        const SizedBox(height: 6),
                        Text(
                          l10n.appDescription,
                          textAlign: TextAlign.center,
                          style: theme.textTheme.bodySmall?.copyWith(
                            color: onSurface.withValues(alpha: 0.6),
                          ),
                        ),

                        // Pending share note
                        if (pendingShareId != null &&
                            pendingShareId.isNotEmpty) ...[
                          const SizedBox(height: 16),
                          _InfoBox(
                            text: l10n.gatePendingShare,
                            color: accent,
                          ),
                        ],

                        // Mode switcher
                        const SizedBox(height: 20),
                        _ModeSwitcher(
                          mode: _mode,
                          l10n: l10n,
                          accent: accent,
                          theme: theme,
                          onChanged: (m) {
                            setState(() => _mode = m);
                            _clearErrors();
                          },
                        ),

                        const SizedBox(height: 16),

                        // Recovery warning (create mode)
                        if (isCreate) ...[
                          _InfoBox(
                            text: l10n.gateRecoveryWarning,
                            color: accent,
                          ),
                          const SizedBox(height: 14),
                        ],

                        // Code field
                        TextField(
                          controller: _codeController,
                          focusNode: _codeFocus,
                          obscureText: _obscureCode,
                          enabled: !_loading,
                          onChanged: (_) {
                            _clearErrors();
                            if (isCreate) setState(() {});
                          },
                          onSubmitted: isCreate ? null : (_) => _submit(),
                          decoration: InputDecoration(
                            labelText: isCreate
                                ? l10n.gateChooseCode
                                : l10n.gateCodeLabel,
                            errorText: _invalidCode ? ' ' : null,
                            suffixIcon: IconButton(
                              onPressed: () =>
                                  setState(() => _obscureCode = !_obscureCode),
                              tooltip: _obscureCode
                                  ? l10n.gateShowCode
                                  : l10n.gateHideCode,
                              icon: Icon(
                                _obscureCode
                                    ? Icons.visibility
                                    : Icons.visibility_off,
                              ),
                            ),
                          ),
                        ),

                        // Create extras
                        if (isCreate) ...[
                          const SizedBox(height: 10),
                          GateCodeRules(code: _codeController.text, l10n: l10n),
                          const SizedBox(height: 10),
                          TextField(
                            controller: _confirmController,
                            focusNode: _confirmFocus,
                            obscureText: _obscureCode,
                            enabled: !_loading,
                            onSubmitted: (_) => _submit(),
                            decoration: InputDecoration(
                              labelText: l10n.gateConfirmCode,
                              errorText: _invalidConfirm ? ' ' : null,
                            ),
                          ),
                        ],

                        // Error
                        if (errorText != null) ...[
                          const SizedBox(height: 10),
                          Text(
                            errorText,
                            style: theme.textTheme.bodySmall?.copyWith(
                              color: theme.colorScheme.error,
                            ),
                          ),
                        ],

                        const SizedBox(height: 20),

                        // Submit
                        FilledButton(
                          onPressed: _loading ? null : _submit,
                          child: _loading
                              ? SizedBox(
                                  height: 20,
                                  width: 20,
                                  child: CircularProgressIndicator(
                                    strokeWidth: 2,
                                    color: theme.colorScheme.onPrimary,
                                  ),
                                )
                              : Text(
                                  isCreate
                                      ? l10n.gateSubmitCreate
                                      : l10n.gateSubmitLogin,
                                ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

class _ModeSwitcher extends StatelessWidget {
  const _ModeSwitcher({
    required this.mode,
    required this.l10n,
    required this.accent,
    required this.theme,
    required this.onChanged,
  });

  final GateMode mode;
  final L10n l10n;
  final Color accent;
  final ThemeData theme;
  final ValueChanged<GateMode> onChanged;

  @override
  Widget build(BuildContext context) {
    final bg = theme.colorScheme.surface;
    final border = theme.colorScheme.onSurface.withValues(alpha: 0.1);

    return DecoratedBox(
      decoration: BoxDecoration(
        color: theme.colorScheme.onSurface.withValues(alpha: 0.05),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: border),
      ),
      child: Padding(
        padding: const EdgeInsets.all(4),
        child: Row(
          children: [
            _ModeTab(
              label: l10n.gateLogin,
              isActive: mode == GateMode.login,
              accent: accent,
              bg: bg,
              onTap: () => onChanged(GateMode.login),
            ),
            _ModeTab(
              label: l10n.gateCreate,
              isActive: mode == GateMode.create,
              accent: accent,
              bg: bg,
              onTap: () => onChanged(GateMode.create),
            ),
          ],
        ),
      ),
    );
  }
}

class _ModeTab extends StatelessWidget {
  const _ModeTab({
    required this.label,
    required this.isActive,
    required this.accent,
    required this.bg,
    required this.onTap,
  });

  final String label;
  final bool isActive;
  final Color accent;
  final Color bg;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Expanded(
      child: GestureDetector(
        onTap: onTap,
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 150),
          padding: const EdgeInsets.symmetric(vertical: 9),
          decoration: BoxDecoration(
            color:
                isActive ? accent.withValues(alpha: 0.14) : Colors.transparent,
            borderRadius: BorderRadius.circular(6),
          ),
          child: Text(
            label,
            textAlign: TextAlign.center,
            style: TextStyle(
              fontSize: 13,
              fontWeight: isActive ? FontWeight.w600 : FontWeight.w500,
              color: isActive
                  ? theme.colorScheme.onSurface
                  : theme.colorScheme.onSurface.withValues(alpha: 0.55),
            ),
          ),
        ),
      ),
    );
  }
}

class _InfoBox extends StatelessWidget {
  const _InfoBox({required this.text, required this.color});

  final String text;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.1),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: color.withValues(alpha: 0.28)),
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        child: Text(
          text,
          style: TextStyle(
            fontSize: 13,
            color: color,
            height: 1.45,
          ),
        ),
      ),
    );
  }
}

class _LangButton extends StatelessWidget {
  const _LangButton({required this.label, required this.onTap});

  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final onSurface = Theme.of(context).colorScheme.onSurface;
    return GestureDetector(
      onTap: onTap,
      child: Container(
        width: 34,
        height: 34,
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          border: Border.all(color: onSurface.withValues(alpha: 0.15)),
          color: onSurface.withValues(alpha: 0.04),
        ),
        child: Center(
          child: Text(
            label,
            style: TextStyle(
              fontWeight: FontWeight.w700,
              fontSize: 14,
              color: onSurface.withValues(alpha: 0.7),
            ),
          ),
        ),
      ),
    );
  }
}
