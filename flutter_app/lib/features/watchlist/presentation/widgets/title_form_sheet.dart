import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/config/environment.dart';
import '../../../../core/utils/rating_utils.dart';
import '../../../../core/utils/watchlist_parser.dart';
import '../../../../core/widgets/content_badges.dart';
import '../../../../core/widgets/metadata_preview_card.dart';
import '../../../../l10n/l10n.dart';
import '../../../../models/metadata_detail.dart';
import '../../../../models/watchlist_item.dart';
import '../../../../repositories/metadata/genre_mapper.dart';
import '../../../../repositories/metadata/metadata_service.dart';
import '../../../add_title/application/build_item_from_metadata.dart';
import 'star_rating_picker.dart';

enum TitleFormMode { add, edit }

class TitleFormSheet extends ConsumerStatefulWidget {
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
  ConsumerState<TitleFormSheet> createState() => _TitleFormSheetState();
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

class _ManualLinkMeta {
  const _ManualLinkMeta({
    this.poster,
    this.imdbRating,
    this.anilistRating,
    this.year,
    this.ageRating,
    this.runtime,
    this.seasonCount,
    this.episodeCount,
  });

  final String? poster;
  final String? imdbRating;
  final String? anilistRating;
  final int? year;
  final String? ageRating;
  final String? runtime;
  final int? seasonCount;
  final int? episodeCount;
}

class _TitleFormSheetState extends ConsumerState<TitleFormSheet> {
  final _formKey = GlobalKey<FormState>();
  late String _contentType;
  late String _genre;
  late List<String> _secondaryGenres;
  late final TextEditingController _titleController;
  late final TextEditingController _leadController;
  late final TextEditingController _summaryController;
  late final TextEditingController _linkController;
  late final TextEditingController _noteController;
  bool _markWatched = false;
  bool _ratingChosen = false;
  double? _ratingValue;
  bool _saving = false;
  String? _errorKey;
  Timer? _linkLookupTimer;
  bool _linkLookingUp = false;
  String? _linkStatusKey;
  bool _linkStatusError = false;
  MetadataDetail? _linkPreview;
  _ManualLinkMeta? _manualLinkMeta;
  int _linkLookupGeneration = 0;

  @override
  void initState() {
    super.initState();
    final item = widget.item;
    _contentType = item?.contentType ?? widget.initialContentType;
    _genre = item?.genre ?? standardGenres.first;
    _secondaryGenres = List<String>.from(item?.secondaryGenres ?? const []);
    _titleController = TextEditingController(text: item?.title ?? '');
    _leadController = TextEditingController(text: item?.lead ?? '');
    _summaryController = TextEditingController(text: item?.summary ?? '');
    _linkController = TextEditingController(text: item?.link ?? '');
    _markWatched = widget.watched != null;
    _ratingChosen = hasWatchRating(widget.watched);
    _ratingValue = widget.watched?.rating != null
        ? clampRatingValue(widget.watched!.rating!)
        : null;
    _noteController = TextEditingController(text: widget.watched?.note ?? '');
    _linkController.addListener(_queueLinkLookup);
  }

  @override
  void dispose() {
    _linkLookupTimer?.cancel();
    _linkController.removeListener(_queueLinkLookup);
    _titleController.dispose();
    _leadController.dispose();
    _summaryController.dispose();
    _linkController.dispose();
    _noteController.dispose();
    super.dispose();
  }

  void _queueLinkLookup() {
    _linkLookupTimer?.cancel();
    _linkLookupTimer =
        Timer(const Duration(milliseconds: 500), _handleLinkLookup);
  }

  Future<void> _handleLinkLookup() async {
    final link = MetadataService.normalizeLink(_linkController.text);
    if (link == null) {
      setState(() {
        _linkLookingUp = false;
        _linkStatusKey = null;
        _linkStatusError = false;
        _linkPreview = null;
        _manualLinkMeta = null;
      });
      return;
    }

    if (!MetadataService.isSupportedLink(link)) {
      setState(() {
        _linkLookingUp = false;
        _linkStatusKey = null;
        _linkStatusError = false;
        _linkPreview = null;
        _manualLinkMeta = null;
      });
      return;
    }

    final config = ref.read(appConfigProvider);
    final isAnimeLink =
        MetadataService.isAnilistLink(link) || MetadataService.isMalLink(link);
    if (!isAnimeLink && !config.hasOmdbKey && !config.hasTmdbKey) {
      setState(() {
        _linkLookingUp = false;
        _linkStatusKey = 'manual.needKey';
        _linkStatusError = true;
        _linkPreview = null;
        _manualLinkMeta = null;
      });
      return;
    }

    final generation = ++_linkLookupGeneration;
    setState(() {
      _linkLookingUp = true;
      _linkStatusKey = 'manual.lookingUp';
      _linkStatusError = false;
      _linkPreview = null;
    });

    final meta =
        await ref.read(metadataServiceProvider).resolveMetadataFromLink(link);

    if (!mounted || generation != _linkLookupGeneration) return;

    if (meta == null || meta.title.trim().isEmpty) {
      setState(() {
        _linkLookingUp = false;
        _linkStatusKey = isAnimeLink ? 'manual.animeFail' : 'manual.linkFail';
        _linkStatusError = true;
        _linkPreview = null;
        _manualLinkMeta = null;
      });
      return;
    }

    _applyMetadata(meta);
    setState(() {
      _linkLookingUp = false;
      _linkStatusKey = null;
      _linkStatusError = false;
      _linkPreview = meta;
      _manualLinkMeta = _manualLinkMetaFromDetails(meta);
    });
  }

  void _applyMetadata(MetadataDetail meta) {
    if (meta.title.isNotEmpty) {
      _titleController.text = meta.title;
    }
    if (meta.plot.isNotEmpty) {
      _summaryController.text = meta.plot;
    }
    if (meta.actors.isNotEmpty) {
      _leadController.text = meta.actors.join(', ');
    } else if (meta.director.isNotEmpty) {
      _leadController.text = meta.director;
    }

    final contentType = inferContentType(meta.contentType, meta.genres);
    _contentType = contentType;

    final suggested = suggestGenres(meta.genres, contentType);
    if (suggested.isNotEmpty) {
      _genre = suggested.first;
      _secondaryGenres = normalizeSecondaryGenres(
        _genre,
        suggested.skip(1).toList(),
      );
    }
  }

  _ManualLinkMeta _manualLinkMetaFromDetails(MetadataDetail meta) {
    String? imdbRating;
    String? anilistRating;
    if (meta.anilistRating.isNotEmpty ||
        meta.source == 'anilist' ||
        meta.anilistId != null) {
      anilistRating = meta.anilistRating.isNotEmpty ? meta.anilistRating : null;
    } else if (meta.rating.isNotEmpty) {
      imdbRating = meta.rating;
    }

    int? year;
    final yearRaw = meta.year.trim();
    if (yearRaw.length >= 4) {
      year = int.tryParse(yearRaw.substring(0, 4));
    }

    return _ManualLinkMeta(
      poster: meta.poster.isNotEmpty ? meta.poster : null,
      imdbRating: imdbRating,
      anilistRating: anilistRating,
      year: year,
      ageRating: meta.ageRating.isNotEmpty ? meta.ageRating : null,
      runtime: meta.runtime.isNotEmpty ? meta.runtime : null,
      seasonCount: meta.seasonCount,
      episodeCount: meta.episodeCount,
    );
  }

  String? _resolvePoster(
    WatchlistItem? existing,
    _ManualLinkMeta? manualMeta,
    String? normalizedExistingLink,
    String? link,
  ) {
    if (existing != null && normalizedExistingLink != link) {
      return manualMeta?.poster;
    }
    return manualMeta?.poster ?? existing?.poster;
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
    final link = MetadataService.normalizeLink(linkRaw);

    if (linkRaw.isNotEmpty && link == null) {
      setState(() {
        _saving = false;
        _errorKey = 'manual.linkFail';
      });
      return;
    }

    final existing = widget.item;
    final manualMeta = _manualLinkMeta;
    final normalizedExistingLink =
        MetadataService.normalizeLink(existing?.link ?? '');

    final item = WatchlistItem(
      id: makeItemId(_contentType, genre, title),
      contentType: _contentType,
      genre: genre,
      title: title,
      lead: leads.join(', '),
      summary: summary,
      kind: normalizeKind(existing?.kind ?? '', _contentType),
      link: link,
      poster:
          _resolvePoster(existing, manualMeta, normalizedExistingLink, link),
      imdbRating: manualMeta?.imdbRating ?? existing?.imdbRating,
      anilistRating: manualMeta?.anilistRating ?? existing?.anilistRating,
      ageRating: manualMeta?.ageRating ?? existing?.ageRating,
      runtime: manualMeta?.runtime ?? existing?.runtime,
      seasonCount: manualMeta?.seasonCount ?? existing?.seasonCount,
      episodeCount: manualMeta?.episodeCount ?? existing?.episodeCount,
      year: manualMeta?.year ?? existing?.year,
      addedAt: existing?.addedAt ?? DateTime.now().millisecondsSinceEpoch,
      secondaryGenres: _secondaryGenres,
    );

    double? rating;
    if (_markWatched && _ratingChosen && _ratingValue != null) {
      rating = _ratingValue;
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
    final linkStatus = _linkStatusKey == null
        ? null
        : _linkStatusKey == 'manual.lookingUp'
            ? l10n.manualLookingUp
            : l10n.message(_linkStatusKey!);

    return Padding(
      padding: EdgeInsets.only(bottom: bottomInset),
      child: SafeArea(
        child: SingleChildScrollView(
          child: Form(
            key: _formKey,
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
                  title: widget.mode == TitleFormMode.add
                      ? l10n.addTitle
                      : l10n.editTitle,
                  onClose: () => Navigator.pop(context),
                ),
                Padding(
                  padding: const EdgeInsets.fromLTRB(20, 0, 20, 24),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Text(
                        l10n.manualLinkHint,
                        style: Theme.of(context).textTheme.bodySmall,
                      ),
                      const SizedBox(height: 12),
                      TextFormField(
                        controller: _linkController,
                        decoration: InputDecoration(
                          labelText: l10n.fieldLink,
                          hintText: l10n.manualLinkPlaceholder,
                          suffixIcon: _linkLookingUp
                              ? const Padding(
                                  padding: EdgeInsets.all(12),
                                  child: SizedBox(
                                    width: 18,
                                    height: 18,
                                    child: CircularProgressIndicator(
                                        strokeWidth: 2),
                                  ),
                                )
                              : null,
                        ),
                        keyboardType: TextInputType.url,
                        textInputAction: TextInputAction.next,
                        onEditingComplete: _handleLinkLookup,
                      ),
                      if (linkStatus != null) ...[
                        const SizedBox(height: 6),
                        Text(
                          linkStatus,
                          style: TextStyle(
                            color: _linkStatusError
                                ? Theme.of(context).colorScheme.error
                                : Theme.of(context)
                                    .colorScheme
                                    .onSurface
                                    .withValues(alpha: 0.7),
                            fontSize: 12,
                          ),
                        ),
                      ],
                      if (_linkPreview != null) ...[
                        const SizedBox(height: 12),
                        Text(
                          l10n.manualFilled,
                          style: Theme.of(context).textTheme.bodySmall,
                        ),
                        const SizedBox(height: 8),
                        MetadataPreviewCard(
                          details: _linkPreview!,
                          emptyPlotLabel: l10n.searchNoSummary,
                        ),
                      ],
                      const SizedBox(height: 16),
                      ContentTypePicker(
                        value: _contentType,
                        movies: l10n.typeMovies,
                        tv: l10n.typeTv,
                        anime: l10n.typeAnime,
                        onChanged: (value) =>
                            setState(() => _contentType = value),
                      ),
                      const SizedBox(height: 12),
                      DropdownButtonFormField<String>(
                        initialValue: _genre,
                        decoration: InputDecoration(labelText: l10n.fieldGenre),
                        items: standardGenres
                            .map((g) => DropdownMenuItem(
                                  value: g,
                                  child: Text(l10n.genreLabel(g)),
                                ))
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
                        decoration:
                            InputDecoration(labelText: l10n.fieldSummary),
                        minLines: 2,
                        maxLines: 4,
                        validator: (value) =>
                            value == null || value.trim().isEmpty ? ' ' : null,
                      ),
                      const SizedBox(height: 16),
                      SwitchListTile(
                        contentPadding: EdgeInsets.zero,
                        title: Text(l10n.fieldWatched),
                        value: _markWatched,
                        onChanged: (value) =>
                            setState(() => _markWatched = value),
                      ),
                      if (_markWatched) ...[
                        StarRatingPicker(
                          l10n: l10n,
                          chosen: _ratingChosen,
                          value: _ratingValue,
                          onChoose: (rating) => setState(() {
                            _ratingChosen = true;
                            _ratingValue = clampRatingValue(rating);
                          }),
                          onAdjust: (delta) {
                            if (!_ratingChosen || _ratingValue == null) return;
                            setState(() {
                              _ratingValue =
                                  clampRatingValue(_ratingValue! + delta);
                            });
                          },
                        ),
                        const SizedBox(height: 12),
                        TextFormField(
                          controller: _noteController,
                          decoration:
                              InputDecoration(labelText: l10n.fieldWatchNote),
                          minLines: 1,
                          maxLines: 3,
                        ),
                      ],
                      if (_errorKey != null) ...[
                        const SizedBox(height: 12),
                        Text(
                          l10n.message(_errorKey!),
                          style: TextStyle(
                              color: Theme.of(context).colorScheme.error),
                        ),
                      ],
                      const SizedBox(height: 20),
                      FilledButton(
                        onPressed: _saving ? null : _submit,
                        child: _saving
                            ? const SizedBox(
                                height: 20,
                                width: 20,
                                child:
                                    CircularProgressIndicator(strokeWidth: 2),
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
  required Future<String?> Function(
          WatchlistItem item, TitleFormWatchState watch)
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
