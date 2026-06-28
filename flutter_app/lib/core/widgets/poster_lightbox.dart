import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

/// Fullscreen poster viewer — mirrors web `openPosterLightbox`.
Future<void> showPosterLightbox(
  BuildContext context, {
  required String imageUrl,
  String? semanticsLabel,
  String? heroTag,
}) {
  if (imageUrl.trim().isEmpty) return Future.value();

  return showGeneralDialog<void>(
    context: context,
    barrierDismissible: true,
    barrierLabel: semanticsLabel ?? 'View poster',
    barrierColor: Colors.black.withValues(alpha: 0.92),
    pageBuilder: (context, animation, secondaryAnimation) {
      return _PosterLightbox(
        imageUrl: imageUrl,
        semanticsLabel: semanticsLabel,
        heroTag: heroTag,
      );
    },
    transitionBuilder: (context, animation, secondaryAnimation, child) {
      return FadeTransition(opacity: animation, child: child);
    },
  );
}

class _PosterLightbox extends StatelessWidget {
  const _PosterLightbox({
    required this.imageUrl,
    this.semanticsLabel,
    this.heroTag,
  });

  final String imageUrl;
  final String? semanticsLabel;
  final String? heroTag;

  @override
  Widget build(BuildContext context) {
    return Shortcuts(
      shortcuts: const {
        SingleActivator(LogicalKeyboardKey.escape): _ClosePosterIntent(),
      },
      child: Actions(
        actions: {
          _ClosePosterIntent: CallbackAction<_ClosePosterIntent>(
            onInvoke: (_) {
              Navigator.of(context).pop();
              return null;
            },
          ),
        },
        child: Focus(
          autofocus: true,
          child: Material(
            color: Colors.transparent,
            child: Stack(
              fit: StackFit.expand,
              children: [
                GestureDetector(
                  onTap: () => Navigator.of(context).pop(),
                  behavior: HitTestBehavior.opaque,
                  child: const SizedBox.expand(),
                ),
                Center(
                  child: Semantics(
                    image: true,
                    label: semanticsLabel,
                    child: Padding(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 20,
                        vertical: 48,
                      ),
                      child: heroTag != null
                          ? Hero(
                              tag: heroTag!,
                              child: _PosterImage(url: imageUrl),
                            )
                          : _PosterImage(url: imageUrl),
                    ),
                  ),
                ),
                Positioned(
                  top: MediaQuery.paddingOf(context).top + 8,
                  right: 12,
                  child: IconButton(
                    onPressed: () => Navigator.of(context).pop(),
                    icon: const Icon(Icons.close, color: Colors.white),
                    tooltip: MaterialLocalizations.of(context).closeButtonTooltip,
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

class _PosterImage extends StatelessWidget {
  const _PosterImage({required this.url});

  final String url;

  @override
  Widget build(BuildContext context) {
    return ClipRRect(
      borderRadius: BorderRadius.circular(8),
      child: CachedNetworkImage(
        imageUrl: url,
        fit: BoxFit.contain,
        errorWidget: (_, __, ___) => const Icon(
          Icons.broken_image_outlined,
          color: Colors.white54,
          size: 48,
        ),
      ),
    );
  }
}

class _ClosePosterIntent extends Intent {
  const _ClosePosterIntent();
}
