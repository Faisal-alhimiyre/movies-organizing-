import 'package:flutter/material.dart';

import '../../../../core/utils/list_name_validator.dart';
import '../../../../l10n/l10n.dart';

Future<({String name, String description})?> showImportNewListSheet(
  BuildContext context, {
  required L10n l10n,
  required String initialName,
  required String initialDescription,
}) {
  return showModalBottomSheet<({String name, String description})>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    builder: (context) => ImportNewListSheet(
      l10n: l10n,
      initialName: initialName,
      initialDescription: initialDescription,
    ),
  );
}

class ImportNewListSheet extends StatefulWidget {
  const ImportNewListSheet({
    super.key,
    required this.l10n,
    required this.initialName,
    required this.initialDescription,
  });

  final L10n l10n;
  final String initialName;
  final String initialDescription;

  @override
  State<ImportNewListSheet> createState() => _ImportNewListSheetState();
}

class _ImportNewListSheetState extends State<ImportNewListSheet> {
  late final TextEditingController _nameController;
  late final TextEditingController _descriptionController;
  String? _errorKey;

  @override
  void initState() {
    super.initState();
    _nameController = TextEditingController(text: widget.initialName);
    _descriptionController =
        TextEditingController(text: widget.initialDescription);
  }

  @override
  void dispose() {
    _nameController.dispose();
    _descriptionController.dispose();
    super.dispose();
  }

  void _submit() {
    final name = _nameController.text.trim();
    final error = validateListNameKey(name);
    if (error != null) {
      setState(() => _errorKey = error);
      return;
    }

    final description = _descriptionController.text.trim();
    Navigator.pop(
      context,
      (
        name: name,
        description: description.length > 120
            ? description.substring(0, 120)
            : description,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final l10n = widget.l10n;

    return Padding(
      padding: EdgeInsets.only(
        left: 20,
        right: 20,
        top: 0,
        bottom: MediaQuery.viewInsetsOf(context).bottom + 24,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            l10n.importNewListFormTitle,
            style: Theme.of(context).textTheme.titleLarge,
          ),
          const SizedBox(height: 8),
          Text(l10n.importNewListFormHint),
          const SizedBox(height: 16),
          TextField(
            controller: _nameController,
            decoration: InputDecoration(
              labelText: l10n.createName,
              errorText: _errorKey == null ? null : l10n.message(_errorKey!),
            ),
            textInputAction: TextInputAction.next,
            onChanged: (_) {
              if (_errorKey != null) setState(() => _errorKey = null);
            },
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _descriptionController,
            decoration: InputDecoration(
              labelText: l10n.createAbout,
            ),
            maxLength: 120,
            maxLines: 2,
          ),
          const SizedBox(height: 16),
          FilledButton(
            onPressed: _submit,
            child: Text(l10n.importNewListSubmit),
          ),
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: Text(l10n.btnCancel),
          ),
        ],
      ),
    );
  }
}
