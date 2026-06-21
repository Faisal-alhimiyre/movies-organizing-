import 'package:flutter_test/flutter_test.dart';
import 'package:our_movie_nights/features/add_title/application/build_item_from_metadata.dart';
import 'package:our_movie_nights/models/metadata_detail.dart';

void main() {
  test('buildItemFromMetadata applies imdb rating for movies', () {
    final item = buildItemFromMetadata(
      details: const MetadataDetail(
        source: 'omdb',
        title: 'The Godfather',
        plot: 'A crime saga.',
        rating: '9.2',
        ageRating: 'R',
        runtime: '175 min',
        actors: ['Marlon Brando'],
        genres: ['Crime', 'Drama'],
        contentType: 'movies',
        year: '1972',
        link: 'https://www.imdb.com/title/tt0068646/',
      ),
      contentType: 'movies',
      genre: 'Crime',
    );

    expect(item.title, 'The Godfather');
    expect(item.imdbRating, '9.2');
    expect(item.ageRating, 'R');
    expect(item.runtime, '175 min');
    expect(item.year, 1972);
    expect(item.genre, 'Crime');
    expect(item.secondaryGenres, contains('Drama'));
  });

  test('buildItemFromMetadata applies anilist rating for anime', () {
    final item = buildItemFromMetadata(
      details: const MetadataDetail(
        source: 'anilist',
        title: 'Naruto',
        plot: 'A ninja story.',
        anilistRating: '82',
        runtime: '23 min',
        episodeCount: 220,
        actors: ['Junko Takeuchi'],
        genres: ['Action', 'Adventure'],
        contentType: 'anime',
        anilistId: 20,
      ),
      contentType: 'anime',
      genre: 'Action',
    );

    expect(item.anilistRating, '82');
    expect(item.episodeCount, 220);
    expect(item.runtime, '23 min');
    expect(item.link, contains('anilist.co'));
  });
}
