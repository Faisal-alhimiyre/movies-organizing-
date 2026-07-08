# Anime offline database — license and attribution

## Attribution (shown in app)

> Anime identity data contains information from [anime-offline-database](https://github.com/manami-project/anime-offline-database) by [manami-project](https://github.com/manami-project), available under [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1.0/) and [DbCL 1.0](https://opendatacommons.org/licenses/dbcl/1.0/).

## Source

| Item | Value |
|---|---|
| Repository | https://github.com/manami-project/anime-offline-database |
| Status | **Archived (read-only)** — no future official releases expected |
| Pinned release | **`2026-27`** (2026-07-04) |
| License file | https://github.com/manami-project/anime-offline-database/blob/2026-27/LICENSE |
| Entry count | **41,537** titles (upstream README, week 27 2026) |
| Admin record | [`ANIME-DATASET.md`](ANIME-DATASET.md) |

We download **official GitHub release artifacts from manami-project only**. We do **not** crawl AniList, mirror the live AniList API, or auto-download unverified forks.

## What we import

Identity fields used for bulk-import matching:

- Canonical title, English/Romaji/native variants (inferred from title + synonyms)
- Synonyms
- Start year, format
- AniList / MAL IDs when present in `sources` URLs
- Normalized search terms (derivative field for lookup)
- Poster URL from dataset (optional display during import)

We do **not** import user-specific data into this table.

## Data separation

| Store | Contents | License |
|---|---|---|
| `anime_title_index` | Licensed identity metadata (ODbL derivative) | ODbL + DbCL |
| `watchlist_items` | Private user lists, progress, ratings, notes | App / user data |
| `title_provider_cache` | Canonical metadata for titles users actually added | App cache |

User watchlist data is never merged into `anime_title_index`.

## Share-alike obligations (ODbL)

The searchable Postgres table `anime_title_index` — especially `normalized_search_terms` and the staging/activation pipeline — is a **Derivative Database** produced from the ODbL-licensed source.

If you redistribute this derivative database (e.g. publish a Postgres dump, public API exposing the full index, or ship the normalized term set):

1. **Attribute** manami-project / anime-offline-database.
2. **Share alike** — make the derivative available under ODbL 1.0.
3. **Keep separate** — DbCL applies to contents; ODbL to the database structure/collection.

Our deployment model keeps the index **server-side** behind `anime-index-search`, returning only small candidate sets per query — not the full dataset. This reduces redistribution surface while still requiring attribution in the product.

## Making the derivative available

If required, the ODbL-compliant export would include:

- `anime_title_index` table contents for the active `dataset_version`
- This documentation, `ANIME-DATASET.md`, and `scripts/anime-index-etl/` (transformation script)
- Source release tag and checksum recorded in `anime_dataset_meta` and `anime-dataset-manifest.json`

Contact the project maintainer before publishing a full dump publicly.

## Updates and replacements

The upstream repository is **archived**. Do **not** assume weekly or monthly releases.

- **Initial install:** pinned release `2026-27` via `scripts/anime-index-etl`.
- **Later replacement:** only with manual admin approval (`ANIME_INDEX_APPROVED_REPLACEMENT=1`) and documented attribution/license review.
- **Active index:** remains valid indefinitely until a successful replacement ETL run; failed imports never overwrite the active dataset.

Activation is atomic via `activate_anime_title_index()`.

## AniList fallback

When an offline match has **no AniList ID**, or offline search finds no high-confidence match, bulk import uses **controlled live AniList** as fallback only — not as the primary path for indexed titles with AniList IDs.
