import 'package:flutter_test/flutter_test.dart';
import 'package:our_movie_nights/features/add_title/application/bulk_titles_parser.dart';

void main() {
  test('extractJsonArray parses plain JSON array', () {
    final rows = extractJsonArray('[{"title":"A"}]');
    expect(rows, isNotNull);
    expect(rows!.length, 1);
  });

  test('extractJsonArray extracts array from markdown fence', () {
    const raw = '''
Here you go:
```json
[{"type":"movies","genre":"Action","title":"Test","kind":"movie","lead":"Actor","summary":"A test.","link":""}]
```
''';
    final rows = extractJsonArray(raw);
    expect(rows, isNotNull);
    expect(rows!.length, 1);
  });

  test('parseBulkPaste accepts valid entry', () {
    const raw = '''
[
  {
    "type": "movies",
    "genre": "Action",
    "title": "Carry-On",
    "kind": "movie",
    "lead": "Taron Egerton",
    "secondaryGenres": ["Thriller"],
    "summary": "Airport security drama.",
    "link": "https://www.imdb.com/title/tt21382296/"
  }
]
''';
    final result = parseBulkPaste(raw);
    expect(result.ok, isTrue);
    expect(result.items.length, 1);
    expect(result.items.first.title, 'Carry-On');
    expect(result.items.first.secondaryGenres, contains('Thriller'));
  });

  test('parseBulkPaste rejects invalid type', () {
    const raw =
        '[{"type":"podcast","genre":"Drama","title":"Show","lead":"Host","summary":"Notes."}]';
    final result = parseBulkPaste(raw);
    expect(result.ok, isFalse);
    expect(result.error, isNotNull);
  });

  test('parseBulkPaste unwraps markdown links into valid URLs', () {
    const raw = '''
[
  {
    "type": "movies",
    "genre": "Action",
    "title": "Linked",
    "kind": "movie",
    "lead": "Actor",
    "summary": "Summary.",
    "link": "[IMDb](https://www.imdb.com/title/tt1234567/)"
  }
]
''';
    final result = parseBulkPaste(raw);
    expect(result.ok, isTrue);
    expect(result.items.first.link, contains('imdb.com'));
  });

  test('normalizeBulkLink adds https scheme', () {
    expect(normalizeBulkLink('www.imdb.com/title/tt1234567/'), isNotNull);
  });

  test('sanitizeBulkLinkRaw unwraps markdown links', () {
    expect(
      sanitizeBulkLinkRaw('[IMDb](https://www.imdb.com/title/tt1234567/)'),
      'https://www.imdb.com/title/tt1234567/',
    );
  });

  test('parseBulkPaste skips broken JSON rows and adds valid ones', () {
    const raw = '''
[
  {
    "type": "movies",
    "genre": "Action",
    "title": "Good One",
    "kind": "movie",
    "lead": "Actor A",
    "summary": "Works fine.",
    "link": ""
  },
  {
    "type": "movies",
    "genre": "Action",
    "title": "Broken",
    "kind": movie,
    "lead": "Actor B",
    "summary": "Unquoted kind value.",
    "link": ""
  },
  {
    "type": "movies",
    "genre": "Drama",
    "title": "Good Two",
    "kind": "movie",
    "lead": "Actor C",
    "summary": "Also works.",
    "link": ""
  }
]
''';
    final result = parseBulkPaste(raw);
    expect(result.ok, isTrue);
    expect(result.items.length, 2);
    expect(result.items.map((e) => e.title), ['Good One', 'Good Two']);
    expect(result.errors.length, 1);
    expect(result.errors.first, contains('Row 2'));
    expect(result.errors.first, contains('invalid JSON'));
  });

  test('parseBulkPaste tolerates trailing comma via lenient parse', () {
    const raw = '''
[
  {
    "type": "movies",
    "genre": "Action",
    "title": "Trailing Comma",
    "kind": "movie",
    "lead": "Actor",
    "summary": "Summary.",
    "link": ""
  },
]
''';
    final result = parseBulkPaste(raw);
    expect(result.ok, isTrue);
    expect(result.items.length, 1);
    expect(result.items.first.title, 'Trailing Comma');
  });
  test('buildBulkTemplate includes genre list', () {
    final template = buildBulkTemplate(['Action', 'Drama']);
    expect(template, contains('Action, Drama'));
    expect(template, contains('JSON array'));
  });
}
