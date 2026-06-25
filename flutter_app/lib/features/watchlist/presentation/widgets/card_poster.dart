import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/config/environment.dart';
import '../../../../models/watchlist_item.dart';
import '../../../../repositories/metadata/metadata_service.dart';
import '../../application/poster_enrichment.dart';
import '../../application/watchlist_controller.dart';

final _posterLoadInFlight = <String>{};

/// Lazy-loads a poster from IMDb/AniList when the item has a link but no image.
class CardPoster extends ConsumerStatefulWidget {
  const CardPoster({
    super.key,
    required this.item,
    this.posterOverride,
  });

  final WatchlistItem item;

  /// Immediate poster URL (e.g. season select) before item sync catches up.
  final String? posterOverride;

  @override
  ConsumerState<CardPoster> createState() => _CardPosterState();
}

class _CardPosterState extends ConsumerState<CardPoster> {
  String? _posterUrl;
  bool _loading = false;

  String? _effectivePoster() {
    final override = _usablePoster(widget.posterOverride);
    if (override != null) return override;
    return _usablePoster(widget.item.displayPoster);
  }

  @override
  void initState() {
    super.initState();
    _posterUrl = _effectivePoster();
    if (_posterUrl == null && itemNeedsPosterBackfill(widget.item)) {
      WidgetsBinding.instance.addPostFrameCallback((_) => _hydratePoster());
    }
  }

  @override
  void didUpdateWidget(covariant CardPoster oldWidget) {
    super.didUpdateWidget(oldWidget);
    final nextPoster = _effectivePoster();
    if (nextPoster != null) {
      if (nextPoster != _posterUrl) {
        setState(() => _posterUrl = nextPoster);
      }
      return;
    }
    if (oldWidget.item.id != widget.item.id ||
        oldWidget.item.link != widget.item.link ||
        oldWidget.item.displayPoster != widget.item.displayPoster ||
        oldWidget.posterOverride != widget.posterOverride) {
      _posterUrl = null;
      if (itemNeedsPosterBackfill(widget.item)) {
        _hydratePoster();
      }
    }
  }

  String? _usablePoster(String? raw) {
    final poster = raw?.trim();
    if (poster != null && poster.startsWith('http')) return poster;
    return null;
  }

  Future<void> _hydratePoster() async {
    final item = widget.item;
    if (_loading || _posterLoadInFlight.contains(item.id)) return;
    if (!itemNeedsPosterBackfill(item)) return;

    final config = ref.read(appConfigProvider);
    if (posterBackfillNeedsMovieApiKeys([item], config)) return;

    _loading = true;
    _posterLoadInFlight.add(item.id);

    try {
      final metadata = ref.read(metadataServiceProvider);
      final enriched =
          await enrichItemWithPoster(metadata, item, config: config);
      if (!mounted) return;

      if (hasValidPoster(enriched)) {
        setState(() => _posterUrl = _usablePoster(enriched.displayPoster));
        await ref
            .read(watchlistControllerProvider.notifier)
            .patchEnrichedItem(enriched);
      }
    } finally {
      _posterLoadInFlight.remove(item.id);
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final poster = _posterUrl;

    if (poster != null) {
      return CachedNetworkImage(
        imageUrl: poster,
        fit: BoxFit.cover,
        errorWidget: (_, __, ___) => _placeholder(theme, widget.item.title),
        placeholder: (_, __) => ColoredBox(
          color: theme.colorScheme.surface,
          child: const Center(child: CircularProgressIndicator(strokeWidth: 2)),
        ),
      );
    }

    if (_loading) {
      return ColoredBox(
        color: theme.colorScheme.surface,
        child: const Center(child: CircularProgressIndicator(strokeWidth: 2)),
      );
    }

    return _placeholder(theme, widget.item.title);
  }

  Widget _placeholder(ThemeData theme, String title) {
    return ColoredBox(
      color: theme.colorScheme.surface,
      child: Center(
        child: Padding(
          padding: const EdgeInsets.all(8),
          child: Text(
            title,
            textAlign: TextAlign.center,
            maxLines: 4,
            overflow: TextOverflow.ellipsis,
            style: theme.textTheme.labelLarge,
          ),
        ),
      ),
    );
  }
}
