# Anime offline index ETL

Populates `anime_title_index` from the **official archived** [anime-offline-database](https://github.com/manami-project/anime-offline-database) GitHub release.

> **Upstream is archived (read-only).** There are no expected future official releases. The ETL defaults to pinned release **`2026-27`** and refuses unverified forks or alternate tags unless manually approved.

Admin record: [`docs/ANIME-DATASET.md`](../../docs/ANIME-DATASET.md)  
Manifest: [`docs/anime-dataset-manifest.json`](../../docs/anime-dataset-manifest.json)

## License compliance

**Source:** anime-offline-database by manami-project (archived)  
**License:** [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1.0/) + [DbCL 1.0](https://opendatacommons.org/licenses/dbcl/1.0/)

**Attribution (required):**
> Anime identity data contains information from anime-offline-database by manami-project, available under ODbL 1.0 and DbCL 1.0.

**Share-alike:** See [`docs/ANIME-DATA-LICENSE.md`](../../docs/ANIME-DATA-LICENSE.md). User watchlist data stays separate.

## Pinned release (initial install)

| Field | Value |
|---|---|
| Tag | **`2026-27`** |
| Upstream `lastUpdate` | **2026-07-04** |
| Entry count | **41,537** |
| Artifact | `anime-offline-database.jsonl.zst` |
| SHA-256 | `9ed7e3fd8f0f47b63d977e915a555b7f6e552a7a25a465773451dbccd9cb8e03` |

## Prerequisites

1. Run `supabase/migrate-anime-title-index.sql` in Supabase SQL Editor.
2. Set environment variables:

```bash
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

Optional overrides (default = pinned release above):

```bash
ETL_BATCH_SIZE=400
ANIME_INDEX_SKIP_CHECKSUM=1          # dev only — skips SHA-256 verify
```

**Replacement / non-default source (manual approval required):**

```bash
ANIME_INDEX_APPROVED_REPLACEMENT=1
ANIME_INDEX_RELEASE=2026-27          # or another admin-approved tag
ANIME_INDEX_SOURCE_LABEL=my-replacement-v1
# OR
ANIME_INDEX_ARTIFACT_URL=https://... # HTTPS artifact URL you have reviewed
```

The ETL **never** auto-downloads from forks or `releases/latest` without explicit approval flags.

## Run

```bash
cd scripts/anime-index-etl
npm install
npm run etl
```

On success:

- Active index swapped atomically via `activate_anime_title_index()`
- `anime_dataset_meta` updated
- `docs/anime-dataset-manifest.json` → `installed` block updated

## Flow

1. Resolve **pinned** official release `2026-27` (or approved override).
2. Download only from `github.com/manami-project/anime-offline-database/releases/download/…`
3. Verify SHA-256 against pinned checksum.
4. Stream-parse JSONL (line 1 = metadata, rest = anime).
5. Insert into `anime_title_index_staging`.
6. Validate counts.
7. Atomic activate — **failed runs do not touch the active index**.

## AniList fallback

~20,691 entries include an AniList URL; ~20,846 rows may lack `anilist_id`. Those titles can still be found by title/synonym in the index, but **bulk verify** may require controlled live AniList fallback when no AniList ID is available for the card.

## Test titles

```bash
npm run test:titles
```

## No automatic updates

Do **not** schedule cron jobs expecting new upstream releases. Re-run ETL only when:

- First install, or
- You manually approve a replacement dataset (`ANIME_INDEX_APPROVED_REPLACEMENT=1`)

The installed index continues working indefinitely with no newer upstream release.
