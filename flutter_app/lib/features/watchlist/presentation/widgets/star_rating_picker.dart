import 'package:flutter/material.dart';

import '../../../../core/utils/rating_utils.dart';
import '../../../../l10n/l10n.dart';

/// Star rating picker that mirrors the website's `.rating-picker` component:
/// - Bordered card container
/// - Large gold score display
/// - Single-row 10 stars (transparent outline → gold filled)
/// - Fine-tune +/- section with square ghost buttons (hidden when idle)
class StarRatingPicker extends StatelessWidget {
  const StarRatingPicker({
    super.key,
    required this.l10n,
    required this.chosen,
    required this.value,
    required this.onChoose,
    required this.onAdjust,
  });

  final L10n l10n;
  final bool chosen;
  final double? value;
  final ValueChanged<double> onChoose;
  final ValueChanged<double> onAdjust;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final onSurface = theme.colorScheme.onSurface;
    final accent = theme.colorScheme.primary;
    final muted = onSurface.withValues(alpha: 0.45);

    final display = chosen && value != null ? formatWatchRating(value!) : '—';

    return DecoratedBox(
      decoration: BoxDecoration(
        color: onSurface.withValues(alpha: 0.03),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: onSurface.withValues(alpha: 0.12)),
      ),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(14, 16, 14, 14),
        child: Column(
          children: [
            // ── Score display ──────────────────────────────────────────
            Text.rich(
              TextSpan(
                children: [
                  TextSpan(
                    text: display,
                    style: TextStyle(
                      fontSize: 32,
                      fontWeight: FontWeight.w700,
                      color: chosen ? accent : muted,
                      height: 1,
                    ),
                  ),
                  TextSpan(
                    text: ' / 10',
                    style: TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.w500,
                      color: muted,
                    ),
                  ),
                ],
              ),
              textAlign: TextAlign.center,
            ),

            const SizedBox(height: 14),

            // ── 10-star row ────────────────────────────────────────────
            Semantics(
              label: l10n.ratingStarsGroup,
              child: Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: List.generate(10, (index) {
                  final star = index + 1;
                  final filled = chosen &&
                      value != null &&
                      star <= (value! + 0.001).floor();
                  return _StarButton(
                    filled: filled,
                    accent: accent,
                    tooltip: l10n.ratingStar(star),
                    onTap: () => onChoose(star.toDouble()),
                  );
                }),
              ),
            ),

            // ── Fine-tune section (hidden while idle) ──────────────────
            if (chosen) ...[
              const SizedBox(height: 10),
              DecoratedBox(
                decoration: BoxDecoration(
                  border: Border(
                    top: BorderSide(color: onSurface.withValues(alpha: 0.1)),
                  ),
                ),
                child: Padding(
                  padding: const EdgeInsets.only(top: 12),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      _StepButton(
                        label: '−',
                        tooltip: l10n.ratingLower,
                        onTap: () => onAdjust(-0.1),
                      ),
                      const SizedBox(width: 12),
                      Text(
                        l10n.ratingFineTune,
                        style: TextStyle(
                          fontSize: 12,
                          fontWeight: FontWeight.w500,
                          color: muted,
                        ),
                      ),
                      const SizedBox(width: 12),
                      _StepButton(
                        label: '+',
                        tooltip: l10n.ratingRaise,
                        onTap: () => onAdjust(0.1),
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

// ── Single star button ────────────────────────────────────────────────────────

class _StarButton extends StatelessWidget {
  const _StarButton({
    required this.filled,
    required this.accent,
    required this.tooltip,
    required this.onTap,
  });

  final bool filled;
  final Color accent;
  final String tooltip;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final onSurface = Theme.of(context).colorScheme.onSurface;
    return Tooltip(
      message: tooltip,
      child: GestureDetector(
        onTap: onTap,
        child: SizedBox(
          width: 28,
          height: 28,
          child: Icon(
            filled ? Icons.star_rounded : Icons.star_outline_rounded,
            size: 22,
            color: filled ? accent : onSurface.withValues(alpha: 0.28),
          ),
        ),
      ),
    );
  }
}

// ── Fine-tune ± button ────────────────────────────────────────────────────────

class _StepButton extends StatelessWidget {
  const _StepButton({
    required this.label,
    required this.tooltip,
    required this.onTap,
  });

  final String label;
  final String tooltip;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final onSurface = Theme.of(context).colorScheme.onSurface;
    return Tooltip(
      message: tooltip,
      child: Material(
        color: Colors.transparent,
        borderRadius: BorderRadius.circular(8),
        child: InkWell(
          borderRadius: BorderRadius.circular(8),
          onTap: onTap,
          child: DecoratedBox(
            decoration: BoxDecoration(
              color: onSurface.withValues(alpha: 0.04),
              borderRadius: BorderRadius.circular(8),
              border: Border.all(color: onSurface.withValues(alpha: 0.15)),
            ),
            child: SizedBox(
              width: 38,
              height: 38,
              child: Center(
                child: Text(
                  label,
                  style: TextStyle(
                    fontSize: 20,
                    fontWeight: FontWeight.w600,
                    color: onSurface.withValues(alpha: 0.8),
                    height: 1,
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
