import 'package:flutter/foundation.dart';

/// User-facing error with optional localized message key fallback.
class AppException implements Exception {
  const AppException(this.message, {this.cause, this.debugDetails});

  final String message;
  final Object? cause;
  final String? debugDetails;

  @override
  String toString() => message;
}

void logAppError(Object error, [StackTrace? stackTrace]) {
  if (kDebugMode) {
    debugPrint('[OurMovieNights] $error');
    if (stackTrace != null) debugPrint(stackTrace.toString());
  }
}

Future<T> guardAsync<T>(Future<T> Function() run,
    {String? fallbackMessage}) async {
  try {
    return await run();
  } catch (error, stackTrace) {
    logAppError(error, stackTrace);
    throw AppException(fallbackMessage ?? error.toString(), cause: error);
  }
}
