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

  int? get _runtimeSeconds {
    final minutes = _runtimeMinutes;
    if (minutes == null || minutes <= 0) return null;
    return minutes * 60;
  }

  double get _fraction {
    if (_dragFraction != null) return _dragFraction!;
    return getMoviePosition(widget.entry);
  }

  @override
  Widget build(BuildContext context) {
    final runtimeSec = _runtimeSeconds;
    if (runtimeSec == null || runtimeSec <= 0) return const SizedBox.shrink();

    final theme = Theme.of(context);
    final accent = theme.colorScheme.primary;
    final watchedSec = (_fraction * runtimeSec).round().clamp(0, runtimeSec);

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
              value: watchedSec.toDouble(),
              min: 0,
              max: runtimeSec.toDouble(),
              label: widget.l10n.detailMovieProgressLabel,
              onChanged: (value) {
                setState(() {
                  _dragFraction = value.round().clamp(0, runtimeSec) / runtimeSec;
                });
              },
              onChangeEnd: (value) {
                final seconds = value.round().clamp(0, runtimeSec);
                final fraction = seconds / runtimeSec;
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
                _formatMovieClock(watchedSec),
                style: theme.textTheme.labelSmall?.copyWith(
                  fontFeatures: const [FontFeature.tabularFigures()],
                ),
              ),
              Text(
                _formatMovieClock(runtimeSec),
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

  /// Format a duration in seconds as m:ss or h:mm:ss (matches web).
  String _formatMovieClock(int totalSeconds) {
    final total = totalSeconds.clamp(0, 999999);
    final h = total ~/ 3600;
    final m = (total % 3600) ~/ 60;
    final s = total % 60;
    if (h > 0) {
      return '$h:${m.toString().padLeft(2, '0')}:${s.toString().padLeft(2, '0')}';
    }
    return '$m:${s.toString().padLeft(2, '0')}';
  }
}
