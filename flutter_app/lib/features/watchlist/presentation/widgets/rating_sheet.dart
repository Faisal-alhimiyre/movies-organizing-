import 'package:flutter/material.dart';

import '../../../../core/utils/rating_utils.dart';
import '../../../../core/widgets/content_badges.dart';
import '../../../../l10n/l10n.dart';
import '../../../../models/watchlist_item.dart';
import 'star_rating_picker.dart';

Future<bool?> showRatingSheet(
  BuildContext context, {
  required L10n l10n,
  required WatchlistItem item,
  required WatchEntry? watched,
  required Future<String?> Function({
    required double rating,
    String? note,
  }) onSave,
  required Future<String?> Function() onRateLater,
}) {
  return showModalBottomSheet<bool>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    builder: (context) => RatingSheet(
      l10n: l10n,
      item: item,
      watched: watched,
      onSave: onSave,
      onRateLater: onRateLater,
    ),
  );
}

class RatingSheet extends StatefulWidget {
  const RatingSheet({
    super.key,
    required this.l10n,
    required this.item,
    required this.watched,
    required this.onSave,
    required this.onRateLater,
  });

  final L10n l10n;
  final WatchlistItem item;
  final WatchEntry? watched;
  final Future<String?> Function({
    required double rating,
    String? note,
  }) onSave;
  final Future<String?> Function() onRateLater;

  @override
  State<RatingSheet> createState() => _RatingSheetState();
}

class _RatingSheetState extends State<RatingSheet> {
  late final TextEditingController _noteController;
  late final bool _hadScore;
  late bool _chosen;
  double? _value;
  bool _saving = false;
  String? _errorMessage;

  @override
  void initState() {
    super.initState();
    _hadScore = hasWatchRating(widget.watched);
    _chosen = _hadScore;
    _value = widget.watched?.rating != null
        ? clampRatingValue(widget.watched!.rating!)
        : null;
    _noteController = TextEditingController(text: widget.watched?.note ?? '');
  }

  @override
  void dispose() {
    _noteController.dispose();
    super.dispose();
  }

  void _choose(double rating) {
    setState(() {
      _chosen = true;
      _value = clampRatingValue(rating);
      _errorMessage = null;
    });
  }

  void _adjust(double delta) {
    if (!_chosen || _value == null) return;
    setState(() => _value = clampRatingValue(_value! + delta));
  }

  Future<void> _dismissLater() async {
    if (_saving) return;

    if (_hadScore) {
      if (mounted) Navigator.pop(context);
      return;
    }

    setState(() => _saving = true);
    final errorKey = await widget.onRateLater();
    if (!mounted) return;

    if (errorKey == null) {
      Navigator.pop(context, true);
      return;
    }

    setState(() {
      _saving = false;
      _errorMessage = widget.l10n.message(errorKey);
    });
  }

  Future<void> _submit() async {
    if (_saving) return;

    if (!_chosen || _value == null) {
      setState(() => _errorMessage = widget.l10n.ratingChooseStarFirst);
      return;
    }

    setState(() {
      _saving = true;
      _errorMessage = null;
    });

    final note = _noteController.text.trim();
    final errorKey = await widget.onSave(
      rating: _value!,
      note: note.isEmpty ? null : note,
    );

    if (!mounted) return;

    if (errorKey == null) {
      Navigator.pop(context, true);
      return;
    }

    setState(() {
      _saving = false;
      _errorMessage = widget.l10n.message(errorKey);
    });
  }

  @override
  Widget build(BuildContext context) {
    final l10n = widget.l10n;
    final bottomInset = MediaQuery.viewInsetsOf(context).bottom;

    return Padding(
      padding: EdgeInsets.only(bottom: bottomInset),
      child: SafeArea(
        child: SingleChildScrollView(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            mainAxisSize: MainAxisSize.min,
            children: [
              // drag handle
              Center(
                child: Container(
                  margin: const EdgeInsets.only(top: 10, bottom: 4),
                  width: 36,
                  height: 4,
                  decoration: BoxDecoration(
                    color: Theme.of(context)
                        .colorScheme
                        .onSurface
                        .withValues(alpha: 0.2),
                    borderRadius: BorderRadius.circular(2),
                  ),
                ),
              ),
              ModalHeader(
                title: l10n.ratingRateItem(widget.item.title),
                onClose: () => Navigator.pop(context),
              ),
              Padding(
                padding: const EdgeInsets.fromLTRB(20, 4, 20, 24),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    StarRatingPicker(
                      l10n: l10n,
                      chosen: _chosen,
                      value: _value,
                      onChoose: _choose,
                      onAdjust: _adjust,
                    ),
                    const SizedBox(height: 16),
                    TextField(
                      controller: _noteController,
                      decoration: InputDecoration(
                        labelText: l10n.ratingNote,
                        hintText: l10n.ratingNotePlaceholder,
                      ),
                      minLines: 2,
                      maxLines: 4,
                    ),
                    if (_errorMessage != null) ...[
                      const SizedBox(height: 12),
                      Text(
                        _errorMessage!,
                        style: TextStyle(
                            color: Theme.of(context).colorScheme.error),
                      ),
                    ],
                    const SizedBox(height: 20),
                    Row(
                      children: [
                        TextButton(
                          onPressed: _saving ? null : _dismissLater,
                          child: Text(
                              _hadScore ? l10n.btnCancel : l10n.btnRateLater),
                        ),
                        const Spacer(),
                        FilledButton(
                          onPressed: _saving ? null : _submit,
                          child: _saving
                              ? const SizedBox(
                                  width: 20,
                                  height: 20,
                                  child:
                                      CircularProgressIndicator(strokeWidth: 2),
                                )
                              : Text(_hadScore
                                  ? l10n.btnSave
                                  : l10n.btnSaveRating),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
