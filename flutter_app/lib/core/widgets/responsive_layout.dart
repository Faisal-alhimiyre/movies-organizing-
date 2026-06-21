import 'package:flutter/material.dart';

/// Layout breakpoints aligned with the static site (`mobile.css` uses 640px).
abstract final class AppBreakpoints {
  static const mobile = 640.0;
  static const tablet = 900.0;
  static const desktop = 1100.0;

  static bool isMobile(BuildContext context) =>
      MediaQuery.sizeOf(context).width < mobile;

  static bool isTablet(BuildContext context) {
    final w = MediaQuery.sizeOf(context).width;
    return w >= mobile && w < desktop;
  }

  static bool isDesktop(BuildContext context) =>
      MediaQuery.sizeOf(context).width >= desktop;
}

/// Centers content with max width on large screens.
///
/// Does NOT apply SafeArea — the enclosing Scaffold is responsible for that.
/// Default padding matches the website `.app` dark-theme spacing:
///   horizontal: 1.5rem (24 px), top: 2.25rem (36 px), bottom: 0
///   (scrollable lists manage their own bottom clearance).
class ResponsiveBody extends StatelessWidget {
  const ResponsiveBody({
    super.key,
    required this.child,
    this.maxWidth = 1200,
    this.padding = const EdgeInsets.fromLTRB(24, 36, 24, 0),
  });

  final Widget child;
  final double maxWidth;
  final EdgeInsets padding;

  @override
  Widget build(BuildContext context) {
    return Align(
      alignment: Alignment.topCenter,
      child: ConstrainedBox(
        constraints: BoxConstraints(maxWidth: maxWidth),
        child: Padding(padding: padding, child: child),
      ),
    );
  }
}
