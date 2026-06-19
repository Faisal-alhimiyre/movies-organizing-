class ListLibraryEntry {
  const ListLibraryEntry({
    required this.listId,
    required this.accountId,
    required this.name,
    this.description = '',
    this.addedAt,
    this.updatedAt,
  });

  final String listId;
  final String accountId;
  final String name;
  final String description;
  final int? addedAt;
  final int? updatedAt;

  factory ListLibraryEntry.fromJson(Map<String, dynamic> json) {
    return ListLibraryEntry(
      listId: json['listId'] as String? ?? '',
      accountId: json['accountId'] as String? ?? '',
      name: json['name'] as String? ?? json['label'] as String? ?? 'My list',
      description: json['description'] as String? ?? '',
      addedAt: json['addedAt'] as int?,
      updatedAt: json['updatedAt'] as int?,
    );
  }

  Map<String, dynamic> toJson() => {
        'listId': listId,
        'accountId': accountId,
        'name': name,
        'description': description,
        if (addedAt != null) 'addedAt': addedAt,
        if (updatedAt != null) 'updatedAt': updatedAt,
      };

  ListLibraryEntry copyWith({
    String? name,
    String? description,
    int? updatedAt,
  }) {
    return ListLibraryEntry(
      listId: listId,
      accountId: accountId,
      name: name ?? this.name,
      description: description ?? this.description,
      addedAt: addedAt,
      updatedAt: updatedAt ?? this.updatedAt,
    );
  }
}
