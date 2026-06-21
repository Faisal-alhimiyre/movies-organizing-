import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';

import '../../models/metadata_detail.dart';
import '../../core/utils/title_meta_format.dart';
import 'content_badges.dart';

/// Compact metadata preview — mirrors web `renderTitlePreview`.
class MetadataPreviewCard extends StatelessWidget {
  const MetadataPreviewCard({
    super.key,
    required this.details,
    this.emptyPlotLabel = 'No summary available.',
  });

  final MetadataDetail details;
  final String emptyPlotLabel;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final actors = details.actors.isNotEmpty
        ? details.actors.take(4).toList()
        : details.director.isNotEmpty
            ? [details.director]
            : const <String>[];
    final rating = _formatRating(details);

    return Card(
      margin: EdgeInsets.zero,
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _Poster(posterUrl: details.poster),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    details.title,
                    style: theme.textTheme.titleSmall?.copyWith(
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  if (details.year.isNotEmpty ||
                      rating.isNotEmpty ||
                      actors.isNotEmpty ||
                      titleMetaBadgesFromDetail(details).isNotEmpty) ...[
                    const SizedBox(height: 6),
                    Wrap(
                      spacing: 8,
                      runSpacing: 4,
                      crossAxisAlignment: WrapCrossAlignment.center,
                      children: [
                        if (details.year.isNotEmpty)
                          ContentYearBadge(label: details.year),
                        ContentTitleMetaBadges(
                          contentType: details.contentType,
                          ageRating: details.ageRating,
                          runtime: details.runtime,
                          seasonCount: details.seasonCount,
                          episodeCount: details.episodeCount,
                        ),
                        if (rating.isNotEmpty)
                          Text(
                            rating,
                            style: theme.textTheme.bodySmall,
                          ),
                        ...actors.map(
                          (name) => Text(
                            name,
                            style: theme.textTheme.bodySmall?.copyWith(
                              color: theme.colorScheme.onSurface
                                  .withValues(alpha: 0.75),
                            ),
                          ),
                        ),
                      ],
                    ),
                  ],
                  const SizedBox(height: 8),
                  Text(
                    details.plot.isNotEmpty ? details.plot : emptyPlotLabel,
                    maxLines: 4,
                    overflow: TextOverflow.ellipsis,
                    style: theme.textTheme.bodySmall,
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  static String _formatRating(MetadataDetail details) {
    if (details.anilistRating.isNotEmpty) {
      return 'AniList ${details.anilistRating}';
    }
    if (details.rating.isNotEmpty) {
      return 'IMDb ${details.rating}';
    }
    return '';
  }
}

class _Poster extends StatelessWidget {
  const _Poster({required this.posterUrl});

  final String posterUrl;

  @override
  Widget build(BuildContext context) {
    const size = 72.0;
    if (posterUrl.startsWith('http')) {
      return ClipRRect(
        borderRadius: BorderRadius.circular(8),
        child: CachedNetworkImage(
          imageUrl: posterUrl,
          width: size,
          height: size * 1.45,
          fit: BoxFit.cover,
        ),
      );
    }

    return Container(
      width: size,
      height: size * 1.45,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surfaceContainerHighest,
        borderRadius: BorderRadius.circular(8),
      ),
      child: const Text('🎬', style: TextStyle(fontSize: 28)),
    );
  }
}
