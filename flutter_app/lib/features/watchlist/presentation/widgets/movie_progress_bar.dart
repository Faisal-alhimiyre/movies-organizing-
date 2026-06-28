import 'package:flutter/material.dart';

import '../../../core/utils/title_meta_format.dart';
import '../../../core/utils/watch_progress.dart';
import '../../../l10n/l10n.dart';
import '../../../models/watchlist_item.dart';

/// Movie playback scrubber — mirrors web `.td-movie-progress` in `title-detail.js`.
class MovieProgressBar extends StatefulWidget {
  const MovieProgressBar({
    super.key,
    required this.l10n,
    required this.item,
    required this.entry,
    required this.onChanged,
  });

  final L10n l10n;
  final WatchlistItem item;
  final WatchEntry? entry;
  final ValueChanged<WatchEntry?> onChanged;

  @override
  State<MovieProgressBar> createState() => _MovieProgressBarState();
}

class _MovieProgressBarState extends State<MovieProgressBar> {
  double? _dragFraction;

  int? get _runtimeMinutes => parseRuntimeMinutes(widget.item.runtime);

  double get _fraction {
    if (_dragFraction != null) return _dragFraction!;
    return getMoviePosition(widget.entry);
  }

  @override
  Widget build(BuildContext context) {
    final runtime = _runtimeMinutes;
    if (runtime == null || runtime <= 0) return const SizedBox.shrink();

    final theme = Theme.of(context);
    final accent = theme.colorScheme.primary;
    final watchedMin = (_fraction * runtime).round().clamp(0, runtime);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          widget.l10n.detailMovieProgressHint,
          style: theme.textTheme.bodySmall?.copyWith(
            color: theme.colorScheme.onSurface.withValues(alpha: 0.72),
            fontSize: 12,
          ),
        ),
        const SizedBox(height: 8),
        Directionality(
          textDirection: TextDirection.ltr,
          child: SliderTheme(
            data: SliderTheme.of(context).copyWith(
              activeTrackColor: accent,
              inactiveTrackColor: theme.colorScheme.outline.withValues(alpha: 0.35),
              thumbColor: accent,
              overlayColor: accent.withValues(alpha: 0.12),
              trackHeight: 4,
            ),
            child: Slider(
              value: watchedMin.toDouble(),
              min: 0,
              max: runtime.toDouble(),
              divisions: runtime,
              label: widget.l10n.detailMovieProgressLabel,
              onChanged: (value) {
                setState(() {
                  _dragFraction = value / runtime;
                });
              },
              onChangeEnd: (value) {
                final fraction = value / runtime;
                setState(() => _dragFraction = null);
                widget.onChanged(setMoviePosition(widget.entry, fraction));
              },
            ),
          ),
        ),
        Directionality(
          textDirection: TextDirection.ltr,
          child: Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                _formatMovieClock(watchedMin),
                style: theme.textTheme.labelSmall?.copyWith(
                  fontFeatures: const [FontFeature.tabularFigures()],
                ),
              ),
              Text(
                _formatMovieClock(runtime),
                style: theme.textTheme.labelSmall?.copyWith(
                  fontFeatures: const [FontFeature.tabularFigures()],
                  color: theme.colorScheme.onSurface.withValues(alpha: 0.6),
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }

  String _formatMovieClock(int minutes) {
    final total = minutes.clamp(0, 9999);
    final h = total ~/ 60;
    final m = total % 60;
    if (h > 0) {
      return '$h:${m.toString().padLeft(2, '0')}';
    }
    return formatRuntimeMinutes(total, arabic: widget.l10n.isArabic);
  }
}
