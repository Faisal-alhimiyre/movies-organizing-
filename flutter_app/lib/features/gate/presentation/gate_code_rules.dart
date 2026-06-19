import 'package:flutter/material.dart';

import '../../../core/utils/code_validator.dart';
import '../../../l10n/l10n.dart';

class GateCodeRules extends StatelessWidget {
  const GateCodeRules({super.key, required this.code, required this.l10n});

  final String code;
  final L10n l10n;

  @override
  Widget build(BuildContext context) {
    final checks = evaluateCodeRules(code);
    final theme = Theme.of(context);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          l10n.gateRulesLabel,
          style: theme.textTheme.labelLarge,
        ),
        const SizedBox(height: 8),
        _RuleRow(met: checks.length, label: l10n.gateRuleLength),
        _RuleRow(met: checks.alnum, label: l10n.gateRuleChars),
        _RuleRow(met: checks.spaces, label: l10n.gateRuleSpaces),
        _RuleRow(met: code.isNotEmpty, label: l10n.gateRuleCaps),
      ],
    );
  }
}

class _RuleRow extends StatelessWidget {
  const _RuleRow({required this.met, required this.label});

  final bool met;
  final String label;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final color = met ? theme.colorScheme.primary : theme.colorScheme.outline;

    return Padding(
      padding: const EdgeInsets.only(bottom: 4),
      child: Row(
        children: [
          Icon(
            met ? Icons.check_circle : Icons.radio_button_unchecked,
            size: 18,
            color: color,
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              label,
              style: theme.textTheme.bodySmall?.copyWith(color: color),
            ),
          ),
        ],
      ),
    );
  }
}
