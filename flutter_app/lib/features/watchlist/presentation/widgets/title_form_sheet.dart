import 'package:flutter/material.dart';

import '../../../../core/utils/watchlist_parser.dart';
import '../../../../l10n/l10n.dart';
import '../../../../models/watchlist_item.dart';

enum TitleFormMode { add, edit }

class TitleFormSheet extends StatefulWidget {
  const TitleFormSheet({
    super.key,
    required this.mode,
    required this.l10n,
    this.item,
    this.initialContentType = 'movies',
    this.watched,
    required this.onSave,
    this.onDelete,
  });

  final TitleFormMode mode;
  final L10n l10n;
  final WatchlistItem? item;
  final String initialContentType;
  final WatchEntry? watched;
  final Future<String?> Function(WatchlistItem item, TitleFormWatchState watch)
      onSave;
  final Future<String?> Function()? onDelete;

  @override
  State<TitleFormSheet> createState() => _TitleFormSheetState();
}

class TitleFormWatchState {
  const TitleFormWatchState({
    required this.markWatched,
    this.rating,
    this.note,
  });

  final bool markWatched;
  final double? rating;
  final String? note;
}

class _TitleFormSheetState extends State<TitleFormSheet> {
  final _formKey = GlobalKey<FormState>();
  late String _contentType;
  late String _genre;
  late final TextEditingController _titleController;
  late final TextEditingController _leadController;
  late final TextEditingController _summaryController;
  late final TextEditingController _linkController;
  late final TextEditingController _ratingController;
  late final TextEditingController _noteController;
  bool _markWatched = false;
  bool _saving = false;
  String? _errorKey;

  @override
  void initState() {
    super.initState();
    final item = widget.item;
    _contentType = item?.contentType ?? widget.initialContentType;
    _genre = item?.genre ?? standardGenres.first;
    _titleController = TextEditingController(text: item?.title ?? '');
    _leadController = TextEditingController(text: item?.lead ?? '');
    _summaryController = TextEditingController(text: item?.summary ?? '');
    _linkController = TextEditingController(text: item?.link ?? '');
    _markWatched = widget.watched != null;
    _ratingController = TextEditingController(
      text: widget.watched?.rating?.toString() ?? '',
    );
    _noteController = TextEditingController(text: widget.watched?.note ?? '');
  }

  @override
  void dispose() {
    _titleController.dispose();
    _leadController.dispose();
    _summaryController.dispose();
    _linkController.dispose();
    _ratingController.dispose();
    _noteController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_saving) return;
    if (!_formKey.currentState!.validate()) return;

    setState(() {
      _saving = true;
      _errorKey = null;
    });

    final title = _titleController.text.trim();
    final genre = normalizeGenre(_genre);
    final leads = _leadController.text
        .split(',')
        .map((e) => e.trim())
        .where((e) => e.isNotEmpty)
        .toList();
    final summary = _summaryController.text.trim();
    final linkRaw = _linkController.text.trim();
    final link = linkRaw.isEmpty
        ? null
        : (linkRaw.startsWith('http') ? linkRaw : 'https://$linkRaw');

    final existing = widget.item;
    final item = WatchlistItem(
      id: makeItemId(_contentType, genre, title),
      contentType: _contentType,
      genre: genre,
      title: title,
      lead: leads.join(', '),
      summary: summary,
      kind: normalizeKind(existing?.kind ?? '', _contentType),
      link: link,
      poster: existing?.poster,
      imdbRating: existing?.imdbRating,
      anilistRating: existing?.anilistRating,
      year: existing?.year,
      addedAt: existing?.addedAt ?? DateTime.now().millisecondsSinceEpoch,
      secondaryGenres: existing?.secondaryGenres ?? const [],
    );

    double? rating;
    if (_markWatched && _ratingController.text.trim().isNotEmpty) {
      rating = double.tryParse(_ratingController.text.trim().replaceAll(',', '.'));
      if (rating != null && (rating < 0 || rating > 10)) {
        setState(() {
          _saving = false;
          _errorKey = 'watchlist.invalidRating';
        });
        return;
      }
    }

    final errorKey = await widget.onSave(
      item,
      TitleFormWatchState(
        markWatched: _markWatched,
        rating: rating,
        note: _noteController.text.trim(),
      ),
    );

    if (!mounted) return;

    if (errorKey == null) {
      Navigator.of(context).pop(true);
      return;
    }

    setState(() {
      _saving = false;
      _errorKey = errorKey;
    });
  }

  Future<void> _confirmDelete() async {
    if (widget.onDelete == null) return;

    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(widget.l10n.deleteTitleTitle),
        content: Text(widget.l10n.deleteTitleConfirm(widget.item?.title ?? '')),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: Text(widget.l10n.btnCancel),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: Text(widget.l10n.btnDelete),
          ),
        ],
      ),
    );

    if (confirmed != true || !mounted) return;

    setState(() => _saving = true);
    final errorKey = await widget.onDelete!();
    if (!mounted) return;

    if (errorKey == null) {
      Navigator.of(context).pop(true);
      return;
    }

    setState(() {
      _saving = false;
      _errorKey = errorKey;
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
          padding: const EdgeInsets.fromLTRB(20, 12, 20, 24),
          child: Form(
            key: _formKey,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  widget.mode == TitleFormMode.add
                      ? l10n.addTitle
                      : l10n.editTitle,
                  style: Theme.of(context).textTheme.titleLarge,
                ),
                const SizedBox(height: 16),
                SegmentedButton<String>(
                  segments: [
                    ButtonSegment(value: 'movies', label: Text(l10n.typeMovies)),
                    ButtonSegment(value: 'tvSeries', label: Text(l10n.typeTv)),
                    ButtonSegment(value: 'anime', label: Text(l10n.typeAnime)),
                  ],
                  selected: {_contentType},
                  onSelectionChanged: (value) {
                    setState(() => _contentType = value.first);
                  },
                ),
                const SizedBox(height: 12),
                DropdownButtonFormField<String>(
                  value: _genre,
                  decoration: InputDecoration(labelText: l10n.fieldGenre),
                  items: standardGenres
                      .map((g) => DropdownMenuItem(value: g, child: Text(g)))
                      .toList(),
                  onChanged: (value) {
                    if (value != null) setState(() => _genre = value);
                  },
                ),
                const SizedBox(height: 12),
                TextFormField(
                  controller: _titleController,
                  decoration: InputDecoration(labelText: l10n.fieldTitle),
                  textInputAction: TextInputAction.next,
                  validator: (value) =>
                      value == null || value.trim().isEmpty ? ' ' : null,
                ),
                const SizedBox(height: 12),
                TextFormField(
                  controller: _leadController,
                  decoration: InputDecoration(labelText: l10n.fieldLead),
                  textInputAction: TextInputAction.next,
                  validator: (value) {
                    final parts = value
                            ?.split(',')
                            .map((e) => e.trim())
                            .where((e) => e.isNotEmpty) ??
                        [];
                    return parts.isEmpty ? ' ' : null;
                  },
                ),
                const SizedBox(height: 12),
                TextFormField(
                  controller: _summaryController,
                  decoration: InputDecoration(labelText: l10n.fieldSummary),
                  minLines: 2,
                  maxLines: 4,
                  validator: (value) =>
                      value == null || value.trim().isEmpty ? ' ' : null,
                ),
                const SizedBox(height: 12),
                TextFormField(
                  controller: _linkController,
                  decoration: InputDecoration(labelText: l10n.fieldLink),
                  keyboardType: TextInputType.url,
                ),
                const SizedBox(height: 16),
                SwitchListTile(
                  contentPadding: EdgeInsets.zero,
                  title: Text(l10n.fieldWatched),
                  value: _markWatched,
                  onChanged: (value) => setState(() => _markWatched = value),
                ),
                if (_markWatched) ...[
                  TextFormField(
                    controller: _ratingController,
                    decoration: InputDecoration(labelText: l10n.fieldRating),
                    keyboardType:
                        const TextInputType.numberWithOptions(decimal: true),
                  ),
                  const SizedBox(height: 12),
                  TextFormField(
                    controller: _noteController,
                    decoration: InputDecoration(labelText: l10n.fieldWatchNote),
                    minLines: 1,
                    maxLines: 3,
                  ),
                ],
                if (_errorKey != null) ...[
                  const SizedBox(height: 12),
                  Text(
                    l10n.message(_errorKey!),
                    style: TextStyle(color: Theme.of(context).colorScheme.error),
                  ),
                ],
                const SizedBox(height: 20),
                FilledButton(
                  onPressed: _saving ? null : _submit,
                  child: _saving
                      ? const SizedBox(
                          height: 20,
                          width: 20,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : Text(l10n.btnSave),
                ),
                if (widget.mode == TitleFormMode.edit) ...[
                  const SizedBox(height: 8),
                  TextButton(
                    onPressed: _saving ? null : _confirmDelete,
                    child: Text(
                      l10n.btnDelete,
                      style: TextStyle(
                        color: Theme.of(context).colorScheme.error,
                      ),
                    ),
                  ),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}

Future<bool?> showTitleFormSheet(
  BuildContext context, {
  required TitleFormMode mode,
  required L10n l10n,
  WatchlistItem? item,
  String initialContentType = 'movies',
  WatchEntry? watched,
  required Future<String?> Function(WatchlistItem item, TitleFormWatchState watch)
      onSave,
  Future<String?> Function()? onDelete,
}) {
  return showModalBottomSheet<bool>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    builder: (context) => TitleFormSheet(
      mode: mode,
      l10n: l10n,
      item: item,
      initialContentType: initialContentType,
      watched: watched,
      onSave: onSave,
      onDelete: onDelete,
    ),
  );
}
