import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/services/session_service.dart';
import '../../../core/storage/hive_boxes.dart';
import '../../../core/utils/code_validator.dart';
import '../../../core/utils/pending_share.dart';
import '../../../core/utils/pending_share_storage.dart';
import '../../../core/widgets/app_shell.dart';
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
    final l10n = ref.read(l10nProvider);
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
    final isCreate = _mode == GateMode.create;
    final errorText =
        _errorKey == null ? null : l10n.message(_errorKey!);
    final pendingShareId = _activeShareId;

    return AppShell(
      title: l10n.appTitle,
      showLangTheme: true,
      body: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(l10n.appDescription, style: theme.textTheme.bodyMedium),
          if (pendingShareId != null && pendingShareId.isNotEmpty) ...[
            const SizedBox(height: 16),
            Card(
              child: Padding(
                padding: const EdgeInsets.all(12),
                child: Text(
                  l10n.gatePendingShare,
                  style: theme.textTheme.bodyMedium,
                ),
              ),
            ),
          ],
          const SizedBox(height: 20),
          SegmentedButton<GateMode>(
            segments: [
              ButtonSegment(value: GateMode.login, label: Text(l10n.gateLogin)),
              ButtonSegment(
                value: GateMode.create,
                label: Text(l10n.gateCreate),
              ),
            ],
            selected: {_mode},
            onSelectionChanged: (value) {
              setState(() => _mode = value.first);
              _clearErrors();
            },
          ),
          const SizedBox(height: 20),
          if (isCreate)
            Card(
              child: Padding(
                padding: const EdgeInsets.all(12),
                child: Text(
                  l10n.gateRecoveryWarning,
                  style: theme.textTheme.bodySmall?.copyWith(
                    color: theme.colorScheme.secondary,
                  ),
                ),
              ),
            ),
          if (isCreate) const SizedBox(height: 12),
          TextField(
            controller: _codeController,
            focusNode: _codeFocus,
            obscureText: _obscureCode,
            enabled: !_loading,
            onChanged: (_) {
              _clearErrors();
              if (isCreate) setState(() {});
            },
            decoration: InputDecoration(
              labelText: isCreate ? l10n.gateChooseCode : l10n.gateCodeLabel,
              errorText: _invalidCode ? ' ' : null,
              suffixIcon: IconButton(
                onPressed: () => setState(() => _obscureCode = !_obscureCode),
                tooltip: _obscureCode ? l10n.gateShowCode : l10n.gateHideCode,
                icon: Icon(
                  _obscureCode ? Icons.visibility : Icons.visibility_off,
                ),
              ),
            ),
          ),
          if (isCreate) ...[
            const SizedBox(height: 12),
            GateCodeRules(code: _codeController.text, l10n: l10n),
            const SizedBox(height: 12),
            TextField(
              controller: _confirmController,
              focusNode: _confirmFocus,
              obscureText: _obscureCode,
              enabled: !_loading,
              onChanged: (_) => _clearErrors(),
              decoration: InputDecoration(
                labelText: l10n.gateConfirmCode,
                errorText: _invalidConfirm ? ' ' : null,
              ),
            ),
          ],
          if (errorText != null) ...[
            const SizedBox(height: 12),
            Text(
              errorText,
              style: theme.textTheme.bodySmall?.copyWith(
                color: theme.colorScheme.error,
              ),
            ),
          ],
          const SizedBox(height: 20),
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
                    isCreate ? l10n.gateSubmitCreate : l10n.gateSubmitLogin,
                  ),
          ),
        ],
      ),
    );
  }
}
