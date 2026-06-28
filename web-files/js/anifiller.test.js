/**
 * @jest-environment jsdom
 */
const { readFileSync } = require("fs");
const { join } = require("path");

function loadAniFiller() {
  const src = readFileSync(join(__dirname, "anifiller.js"), "utf8");
  eval(src);
  return global.window.WatchlistAniFiller;
}

describe("WatchlistAniFiller", () => {
  test("_buildIndex maps anilist episodes", () => {
    const AF = loadAniFiller();
    const { byAnilist } = AF._buildIndex([
      {
        mappings: { anilist_id: 6213, mal_id: 6213 },
        episodes: [
          { episode: 1, type: "manga-canon" },
          { episode: 3, type: "filler" },
          { episode: 4, type: "mixed-manga" },
        ],
      },
    ]);
    expect(byAnilist.get(6213).epMap.get(3)).toBe("filler");
    const enriched = AF.enrichEpisodes(6213, null, [
      { episodeNumber: 1 },
      { episodeNumber: 3 },
      { episodeNumber: 4 },
    ]);
    expect(enriched.episodes[0].fillerKind).toBeUndefined();
    expect(enriched.episodes[1].fillerKind).toBe("filler");
    expect(enriched.episodes[2].fillerKind).toBeUndefined();
    expect(AF.shouldHideEpisode(enriched.episodes[1], true)).toBe(true);
    expect(AF.shouldHideEpisode(enriched.episodes[2], true)).toBe(false);
  });
});
