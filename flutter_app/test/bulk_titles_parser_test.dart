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

  test('buildBulkTemplate includes genre list', () {
    final template = buildBulkTemplate(['Action', 'Drama']);
    expect(template, contains('Action, Drama'));
    expect(template, contains('JSON array'));
  });
}
