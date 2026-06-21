import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../models/metadata_detail.dart';
import '../../../models/watchlist_item.dart';
import '../../../repositories/metadata/metadata_service.dart';
import 'link_preview_meta.dart';

class LinkPreviewState {
  const LinkPreviewState({
    this.visible = false,
    this.itemId,
    this.anchor,
    this.loading = false,
    this.details,
    this.item,
  });

  final bool visible;
  final String? itemId;
  final Rect? anchor;
  final bool loading;
  final MetadataDetail? details;
  final WatchlistItem? item;

  LinkPreviewState copyWith({
    bool? visible,
    String? itemId,
    Rect? anchor,
    bool? loading,
    MetadataDetail? details,
    WatchlistItem? item,
    bool clearDetails = false,
  }) {
    return LinkPreviewState(
      visible: visible ?? this.visible,
      itemId: itemId ?? this.itemId,
      anchor: anchor ?? this.anchor,
      loading: loading ?? this.loading,
      details: clearDetails ? null : (details ?? this.details),
      item: item ?? this.item,
    );
  }
}

class LinkPreviewController extends Notifier<LinkPreviewState> {
  Timer? _showTimer;
  Timer? _hideTimer;
  int _fetchGeneration = 0;

  @override
  LinkPreviewState build() {
    ref.onDispose(() {
      _showTimer?.cancel();
      _hideTimer?.cancel();
    });
    return const LinkPreviewState();
  }

  void scheduleShow(WatchlistItem item, Rect anchor) {
    _hideTimer?.cancel();
    _showTimer?.cancel();
    _showTimer = Timer(const Duration(milliseconds: 280), () {
      unawaited(_show(item, anchor));
    });
  }

  void scheduleHide() {
    _showTimer?.cancel();
    _hideTimer?.cancel();
    _hideTimer = Timer(const Duration(milliseconds: 120), hide);
  }

  void cancelHide() {
    _hideTimer?.cancel();
  }

  void hide() {
    _showTimer?.cancel();
    _hideTimer?.cancel();
    _fetchGeneration++;
    state = const LinkPreviewState();
  }

  Future<void> _show(WatchlistItem item, Rect anchor) async {
    final generation = ++_fetchGeneration;
    state = LinkPreviewState(
      visible: true,
      itemId: item.id,
      anchor: anchor,
      loading: true,
      item: item,
    );

    final details = await fetchLinkPreviewMeta(
      item,
      ref.read(metadataServiceProvider),
    );

    if (generation != _fetchGeneration || state.itemId != item.id) return;

    state = state.copyWith(
      loading: false,
      details: details ?? previewDetailsFromItem(item),
    );
  }
}

final linkPreviewControllerProvider =
    NotifierProvider<LinkPreviewController, LinkPreviewState>(
  LinkPreviewController.new,
);
