class Session {
  const Session({
    required this.accountId,
    required this.listId,
    this.needsCodeUpgrade = false,
  });

  final String accountId;
  final String listId;
  final bool needsCodeUpgrade;

  bool get isAuthenticated => accountId.isNotEmpty && listId.isNotEmpty;

  factory Session.fromJson(Map<String, dynamic> json) {
    return Session(
      accountId: json['accountId'] as String? ?? '',
      listId: json['listId'] as String? ?? '',
      needsCodeUpgrade: json['needsCodeUpgrade'] == true,
    );
  }

  Map<String, dynamic> toJson() => {
        'accountId': accountId,
        'listId': listId,
        if (needsCodeUpgrade) 'needsCodeUpgrade': true,
      };
}
