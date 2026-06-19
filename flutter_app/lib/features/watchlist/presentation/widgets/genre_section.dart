import 'package:flutter/material.dart';

import '../../../../l10n/l10n.dart';
import '../../../../models/watchlist_item.dart';
import 'title_card.dart';

class GenreSection extends StatelessWidget {
  const GenreSection({
    super.key,
    required this.group,
    required this.watched,
    required this.l10n,
    required this.onItemTap,
  });

  final GenreGroup group;
  final Map<String, WatchEntry> watched;
  final L10n l10n;
  final ValueChanged<WatchlistItem> onItemTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final typeLabel = group.contentType == null
        ? null
        : l10n.contentTypeLabel(group.contentType!);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (!group.isFlatSorted && group.genre.isNotEmpty)
          Row(
            children: [
              if (typeLabel != null) ...[
                Chip(
                  visualDensity: VisualDensity.compact,
                  label: Text(typeLabel),
                ),
                const SizedBox(width: 8),
              ],
              Expanded(
                child: Text(
                  group.isAllMatch ? group.genre : group.genre,
                  style: theme.textTheme.titleMedium?.copyWith(
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
              Text(
                l10n.titleCount(group.items.length),
                style: theme.textTheme.bodySmall,
              ),
            ],
          ),
        if (!group.isFlatSorted && group.genre.isNotEmpty)
          const SizedBox(height: 12),
        LayoutBuilder(
          builder: (context, constraints) {
            final width = constraints.maxWidth;
            final crossAxisCount = width >= 900
                ? 4
                : width >= 640
                    ? 3
                    : 2;
            return GridView.builder(
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
                crossAxisCount: crossAxisCount,
                childAspectRatio: 0.52,
                crossAxisSpacing: 12,
                mainAxisSpacing: 12,
              ),
              itemCount: group.items.length,
              itemBuilder: (context, index) {
                final item = group.items[index];
                return TitleCard(
                  item: item,
                  watched: watched[item.id],
                  l10n: l10n,
                  onTap: () => onItemTap(item),
                );
              },
            );
          },
        ),
        const SizedBox(height: 24),
      ],
    );
  }
}
