import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/services/session_service.dart';
import '../../../l10n/l10n.dart';
import '../../../models/session.dart';
import '../../../repositories/auth_repository.dart';
import '../../gate/presentation/gate_code_rules.dart';

Future<bool> showChangeCodeSheet(
  BuildContext context,
  WidgetRef ref, {
  required L10n l10n,
}) {
  return showModalBottomSheet<bool>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    builder: (context) => ChangeCodeSheet(l10n: l10n),
  ).then((value) => value ?? false);
}

class ChangeCodeSheet extends ConsumerStatefulWidget {
  const ChangeCodeSheet({super.key, required this.l10n});

  final L10n l10n;

  @override
  ConsumerState<ChangeCodeSheet> createState() => _ChangeCodeSheetState();
}

class _ChangeCodeSheetState extends ConsumerState<ChangeCodeSheet> {
  final _newController = TextEditingController();
  final _confirmController = TextEditingController();
  var _obscureNew = true;
  var _obscureConfirm = true;
  String? _errorKey;
  var _submitting = false;

  @override
  void dispose() {
    _newController.dispose();
    _confirmController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_submitting) return;

    final session = ref.read(sessionProvider);
    if (session == null) return;

    setState(() {
      _errorKey = null;
      _submitting = true;
    });

    final auth = ref.read(authRepositoryProvider);
    final result = await auth.changeAccountCode(
      session: session,
      newCode: _newController.text,
      confirmCode: _confirmController.text,
    );

    if (!mounted) return;

    if (!result.ok) {
      setState(() {
        _errorKey = result.errorKey;
        _submitting = false;
      });
      return;
    }

    await ref.read(sessionProvider.notifier).setSession(
          Session(
            accountId: result.newAccountId!,
            listId: session.listId,
          ),
        );

    if (mounted) {
      Navigator.pop(context, true);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = widget.l10n;
    final bottomInset = MediaQuery.viewInsetsOf(context).bottom;

    return Padding(
      padding: EdgeInsets.fromLTRB(20, 0, 20, 24 + bottomInset),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            l10n.changeCodeTitle,
            style: Theme.of(context).textTheme.titleLarge,
          ),
          const SizedBox(height: 12),
          Text(l10n.changeCodeText),
          const SizedBox(height: 16),
          TextField(
            controller: _newController,
            enabled: !_submitting,
            obscureText: _obscureNew,
            decoration: InputDecoration(
              labelText: l10n.changeCodeNew,
              suffixIcon: IconButton(
                onPressed: () => setState(() => _obscureNew = !_obscureNew),
                icon:
                    Icon(_obscureNew ? Icons.visibility : Icons.visibility_off),
              ),
            ),
            onChanged: (_) {
              setState(() => _errorKey = null);
            },
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _confirmController,
            enabled: !_submitting,
            obscureText: _obscureConfirm,
            decoration: InputDecoration(
              labelText: l10n.changeCodeConfirm,
              suffixIcon: IconButton(
                onPressed: () =>
                    setState(() => _obscureConfirm = !_obscureConfirm),
                icon: Icon(
                  _obscureConfirm ? Icons.visibility : Icons.visibility_off,
                ),
              ),
            ),
            onChanged: (_) {
              setState(() => _errorKey = null);
            },
          ),
          const SizedBox(height: 12),
          GateCodeRules(code: _newController.text, l10n: l10n),
          if (_errorKey != null) ...[
            const SizedBox(height: 12),
            Text(
              l10n.message(_errorKey!),
              style: TextStyle(color: Theme.of(context).colorScheme.error),
            ),
          ],
          const SizedBox(height: 16),
          FilledButton(
            onPressed: _submitting ? null : _submit,
            child: _submitting
                ? const SizedBox(
                    width: 20,
                    height: 20,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : Text(l10n.btnUpdateCode),
          ),
          TextButton(
            onPressed: _submitting ? null : () => Navigator.pop(context, false),
            child: Text(l10n.btnCancel),
          ),
        ],
      ),
    );
  }
}
