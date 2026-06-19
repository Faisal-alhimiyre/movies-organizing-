import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';

import '../../../../l10n/l10n.dart';
import '../../../../models/watchlist_item.dart';

class TitleCard extends StatelessWidget {
  const TitleCard({
    super.key,
    required this.item,
    required this.watched,
    required this.l10n,
    this.onTap,
  });

  final WatchlistItem item;
  final WatchEntry? watched;
  final L10n l10n;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final isWatched = watched != null;
    final personalRating = watched?.rating;

    return Card(
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            AspectRatio(
              aspectRatio: 2 / 3,
              child: _Poster(poster: item.poster, title: item.title),
            ),
            Expanded(
              child: Padding(
                padding: const EdgeInsets.all(10),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      item.title,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: theme.textTheme.titleSmall?.copyWith(
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    if (item.lead.isNotEmpty) ...[
                      const SizedBox(height: 4),
                      Text(
                        item.lead,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: theme.textTheme.bodySmall?.copyWith(
                          color: theme.colorScheme.onSurface.withValues(alpha: 0.7),
                        ),
                      ),
                    ],
                    const Spacer(),
                    Wrap(
                      spacing: 6,
                      runSpacing: 4,
                      children: [
                        if (isWatched)
                          Chip(
                            visualDensity: VisualDensity.compact,
                            label: Text(
                              personalRating != null
                                  ? '${l10n.cardWatched} · ${personalRating.toStringAsFixed(personalRating.truncateToDouble() == personalRating ? 0 : 1)}'
                                  : l10n.cardWatched,
                            ),
                          )
                        else
                          Chip(
                            visualDensity: VisualDensity.compact,
                            label: Text(l10n.cardUnwatched),
                          ),
                        if (item.imdbRating != null && item.imdbRating!.isNotEmpty)
                          Chip(
                            visualDensity: VisualDensity.compact,
                            label: Text('IMDb ${item.imdbRating}'),
                          ),
                      ],
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _Poster extends StatelessWidget {
  const _Poster({required this.poster, required this.title});

  final String? poster;
  final String title;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    if (poster != null && poster!.startsWith('http')) {
      return CachedNetworkImage(
        imageUrl: poster!,
        fit: BoxFit.cover,
        errorWidget: (_, __, ___) => _placeholder(theme),
        placeholder: (_, __) => ColoredBox(
          color: theme.colorScheme.surface,
          child: const Center(child: CircularProgressIndicator(strokeWidth: 2)),
        ),
      );
    }
    return _placeholder(theme);
  }

  Widget _placeholder(ThemeData theme) {
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
