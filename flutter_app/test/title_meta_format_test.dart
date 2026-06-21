import 'package:flutter_test/flutter_test.dart';
import 'package:our_movie_nights/core/utils/title_meta_format.dart';
import 'package:our_movie_nights/models/metadata_detail.dart';

void main() {
  test('formatEpisodeDurationLabel formats minutes per episode', () {
    expect(formatEpisodeDurationLabel('23 min'), '~23 min/ep');
    expect(formatEpisodeDurationLabel('~23 min/ep'), '~23 min/ep');
  });

  test('buildTitleMetaBadges for movies shows age and duration', () {
    final badges = buildTitleMetaBadges(
      contentType: 'movies',
      ageRating: 'PG-13',
      runtime: '142 min',
    );
    expect(badges.map((b) => b.label).toList(), ['PG-13', '142 min']);
    expect(badges.map((b) => b.kind).toList(), [
      TitleMetaBadgeKind.age,
      TitleMetaBadgeKind.duration,
    ]);
  });

  test('buildTitleMetaBadges for tv series shows age, seasons, and ep length', () {
    final badges = buildTitleMetaBadges(
      contentType: 'tvSeries',
      ageRating: 'TV-MA',
      runtime: '45 min',
      seasonCount: 3,
    );
    expect(
      badges.map((b) => b.label).toList(),
      ['TV-MA', '3 seasons', '~45 min/ep'],
    );
  });

  test('buildTitleMetaBadges for anime prefers seasons over episodes', () {
    final badges = buildTitleMetaBadges(
      contentType: 'anime',
      seasonCount: 1,
      episodeCount: 12,
      runtime: '24 min',
    );
    expect(
      badges.map((b) => b.label).toList(),
      ['1 season', '~24 min/ep'],
    );
  });

  test('buildTitleMetaBadges for anime falls back to episode count', () {
    final badges = buildTitleMetaBadges(
      contentType: 'anime',
      episodeCount: 12,
      runtime: '23 min',
    );
    expect(
      badges.map((b) => b.label).toList(),
      ['12 episodes', '~23 min/ep'],
    );
  });

  test('formatTitleMetaParts mirrors badge labels', () {
    expect(
      formatTitleMetaParts(
        contentType: 'movies',
        ageRating: 'PG-13',
        runtime: '148 min',
      ),
      ['PG-13', '148 min'],
    );
  });

  test('titleMetaPartsFromDetail uses content type', () {
    final parts = titleMetaPartsFromDetail(
      const MetadataDetail(
        source: 'omdb',
        title: 'Inception',
        contentType: 'movies',
        ageRating: 'PG-13',
        runtime: '148 min',
      ),
    );
    expect(parts, ['PG-13', '148 min']);
  });
}
