import 'package:flutter/material.dart';

import '../../../../l10n/l10n.dart';

Future<void> showListFormSheet(
  BuildContext context, {
  required L10n l10n,
  required bool isEdit,
  String initialName = '',
  String initialDescription = '',
  required Future<String?> Function(String name, String description) onSubmit,
}) async {
  final nameController = TextEditingController(text: initialName);
  final descriptionController = TextEditingController(text: initialDescription);
  final formKey = GlobalKey<FormState>();
  String? errorText;
  var submitting = false;

  await showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    builder: (context) {
      return StatefulBuilder(
        builder: (context, setModalState) {
          Future<void> submit() async {
            if (submitting) return;
            setModalState(() {
              errorText = null;
              submitting = true;
            });

            final errorKey = await onSubmit(
              nameController.text,
              descriptionController.text,
            );

            if (!context.mounted) return;

            if (errorKey == null) {
              Navigator.pop(context);
              return;
            }

            setModalState(() {
              errorText = l10n.message(errorKey);
              submitting = false;
            });
          }

          final bottomInset = MediaQuery.viewInsetsOf(context).bottom;

          return Padding(
            padding: EdgeInsets.fromLTRB(24, 0, 24, 24 + bottomInset),
            child: Form(
              key: formKey,
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text(
                    isEdit ? l10n.createEditList : l10n.createNewList,
                    style: Theme.of(context).textTheme.titleLarge,
                  ),
                  const SizedBox(height: 16),
                  TextField(
                    controller: nameController,
                    enabled: !submitting,
                    maxLength: 48,
                    decoration: InputDecoration(
                      labelText: l10n.createName,
                      hintText: l10n.createNamePlaceholder,
                    ),
                    textInputAction: TextInputAction.next,
                  ),
                  const SizedBox(height: 12),
                  TextField(
                    controller: descriptionController,
                    enabled: !submitting,
                    maxLength: 120,
                    minLines: 2,
                    maxLines: 3,
                    decoration: InputDecoration(
                      labelText: l10n.createAbout,
                      hintText: l10n.createAboutPlaceholder,
                    ),
                  ),
                  if (errorText != null) ...[
                    const SizedBox(height: 12),
                    Text(
                      errorText!,
                      style: Theme.of(context).textTheme.bodySmall?.copyWith(
                            color: Theme.of(context).colorScheme.error,
                          ),
                    ),
                  ],
                  const SizedBox(height: 20),
                  FilledButton(
                    onPressed: submitting ? null : submit,
                    child: submitting
                        ? const SizedBox(
                            height: 20,
                            width: 20,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : Text(isEdit ? l10n.btnSave : l10n.btnCreateList),
                  ),
                ],
              ),
            ),
          );
        },
      );
    },
  );

  nameController.dispose();
  descriptionController.dispose();
}
