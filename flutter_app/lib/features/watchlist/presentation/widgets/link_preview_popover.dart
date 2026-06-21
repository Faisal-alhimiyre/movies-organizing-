import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';

import '../../../../core/widgets/content_badges.dart';
import '../../../../core/utils/title_meta_format.dart';
import '../../../../l10n/l10n.dart';
import '../../../../models/metadata_detail.dart';
import '../../../../models/watchlist_item.dart';
import '../../application/link_preview_meta.dart';

class LinkPreviewPopover extends StatelessWidget {
  const LinkPreviewPopover({
    super.key,
    required this.loading,
    required this.details,
    required this.item,
    required this.l10n,
  });

  final bool loading;
  final MetadataDetail? details;
  final WatchlistItem item;
  final L10n l10n;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    if (loading || details == null) {
      return Padding(
        padding: const EdgeInsets.all(16),
        child: Text(
          l10n.linkPreviewLoading,
          style: theme.textTheme.bodySmall,
        ),
      );
    }

    final meta = details!;
    final title = meta.title.isNotEmpty ? meta.title : item.title;
    final plot = meta.plot.isNotEmpty ? meta.plot : item.summary;
    final metaParts = linkPreviewMetaParts(meta, item);
    final year = meta.year.isNotEmpty ? meta.year : (item.year?.toString() ?? '');
    final contentType =
        meta.contentType.isNotEmpty ? meta.contentType : item.contentType;
    final poster = meta.poster.isNotEmpty ? meta.poster : (item.poster ?? '');

    return Padding(
      padding: const EdgeInsets.all(12),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _Poster(url: poster),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: theme.textTheme.titleSmall?.copyWith(
                    fontWeight: FontWeight.w700,
                  ),
                ),
                if (year.isNotEmpty ||
                    titleMetaBadgesFromDetail(meta).isNotEmpty ||
                    metaParts.isNotEmpty) ...[
                  const SizedBox(height: 6),
                  Wrap(
                    spacing: 8,
                    runSpacing: 4,
                    crossAxisAlignment: WrapCrossAlignment.center,
                    children: [
                      if (year.isNotEmpty) ContentYearBadge(label: year),
                      ContentTitleMetaBadges(
                        contentType: contentType,
                        ageRating: meta.ageRating.isNotEmpty
                            ? meta.ageRating
                            : item.ageRating,
                        runtime: meta.runtime.isNotEmpty
                            ? meta.runtime
                            : item.runtime,
                        seasonCount: meta.seasonCount ?? item.seasonCount,
                        episodeCount: meta.episodeCount ?? item.episodeCount,
                      ),
                      ...metaParts
                          .where((part) => part.contains('IMDb') || part.contains('AniList'))
                          .map(
                            (part) => Text(
                              part,
                              style: theme.textTheme.bodySmall?.copyWith(
                                color: theme.colorScheme.onSurface
                                    .withValues(alpha: 0.75),
                              ),
                            ),
                          ),
                    ],
                  ),
                ],
                if (plot.isNotEmpty) ...[
                  const SizedBox(height: 8),
                  Text(
                    plot,
                    maxLines: 4,
                    overflow: TextOverflow.ellipsis,
                    style: theme.textTheme.bodySmall,
                  ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _Poster extends StatelessWidget {
  const _Poster({required this.url});

  final String url;

  @override
  Widget build(BuildContext context) {
    const width = 72.0;
    const height = 104.0;

    if (url.startsWith('http')) {
      return ClipRRect(
        borderRadius: BorderRadius.circular(8),
        child: CachedNetworkImage(
          imageUrl: url,
          width: width,
          height: height,
          fit: BoxFit.cover,
        ),
      );
    }

    return Container(
      width: width,
      height: height,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surfaceContainerHighest,
        borderRadius: BorderRadius.circular(8),
      ),
      child: const Text('🎬', style: TextStyle(fontSize: 28)),
    );
  }
}
