import 'package:flutter_test/flutter_test.dart';
import 'package:our_movie_nights/repositories/metadata/metadata_service.dart';

void main() {
  group('MetadataService link helpers', () {
    test('isSupportedLink accepts IMDb, AniList, and MAL URLs', () {
      expect(
        MetadataService.isSupportedLink(
          'https://www.imdb.com/title/tt0944947/',
        ),
        isTrue,
      );
      expect(
        MetadataService.isSupportedLink('https://anilist.co/anime/21/'),
        isTrue,
      );
      expect(
        MetadataService.isSupportedLink(
          'https://myanimelist.net/anime/21/One_Piece',
        ),
        isTrue,
      );
      expect(
        MetadataService.isSupportedLink('https://example.com/movie'),
        isFalse,
      );
    });

    test('normalizeLink adds https scheme', () {
      expect(
        MetadataService.normalizeLink('www.imdb.com/title/tt1234567/'),
        'https://www.imdb.com/title/tt1234567/',
      );
      expect(MetadataService.normalizeLink(''), isNull);
    });
  });
}
