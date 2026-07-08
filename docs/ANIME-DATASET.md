# Anime offline index — admin dataset record

This document records the **installed** anime identity index used for bulk-import matching. It is separate from private user watchlist data (`watchlist_items`).

Machine-readable manifest: [`anime-dataset-manifest.json`](anime-dataset-manifest.json)  
License & ODbL obligations: [`ANIME-DATA-LICENSE.md`](ANIME-DATA-LICENSE.md)

---

## Upstream status (archived)

The official source repository **[manami-project/anime-offline-database](https://github.com/manami-project/anime-offline-database)** is **archived and read-only** (confirmed via GitHub API).

- **Do not assume** future weekly or monthly releases from upstream.
- **Do not** auto-download from unverified forks.
- The pinned release below remains valid **indefinitely** for matching until a **manually approved** replacement is imported.

---

## Pinned initial dataset (official archived release)

| Field | Value |
|---|---|
| Release tag | **`2026-27`** |
| Published | 2026-07-04T15:39:29Z |
| Upstream `lastUpdate` (dataset header) | **2026-07-04** |
| Upstream entry count (README statistics) | **41,537** |
| Preferred artifact | `anime-offline-database.jsonl.zst` |
| SHA-256 (`.jsonl.zst`) | `9ed7e3fd8f0f47b63d977e915a555b7f6e552a7a25a465773451dbccd9cb8e03` |
| SHA-256 (`.jsonl` uncompressed) | `8a63189782176fe19e00eca275288ba855ce54d6cb4d7ae97ec71450f861b1aa` |
| Download URL | https://github.com/manami-project/anime-offline-database/releases/download/2026-27/anime-offline-database.jsonl.zst |

License: **ODbL 1.0** (database) + **DbCL 1.0** (contents).

---

## Installed index (update after ETL)

Query live status from Supabase:

```sql
select
  active_version,
  upstream_release,
  upstream_last_update,
  downloaded_at,
  checksum_sha256,
  imported_rows,
  accepted_rows,
  rejected_rows,
  previous_version,
  notes,
  updated_at
from public.anime_dataset_meta
where id = 1;

select count(*) as active_rows from public.anime_title_index;
select pg_size_pretty(pg_total_relation_size('public.anime_title_index')) as table_size;
```

Or invoke the edge function meta action (service role / app Credits screen):

```json
{ "action": "meta" }
```

After a successful ETL run, `docs/anime-dataset-manifest.json` → `installed` block is updated automatically.

| Installed field | Where stored |
|---|---|
| Active version | `anime_dataset_meta.active_version` |
| Last upstream update | `anime_dataset_meta.upstream_last_update` |
| Row counts | `imported_rows`, `accepted_rows`, `rejected_rows` |
| Checksum | `anime_dataset_meta.checksum_sha256` |
| Download time | `anime_dataset_meta.downloaded_at` |

**App UI:** Menu → **Credits & data sources** shows the active version when Supabase is configured.

---

## Matching behaviour

Search order for bulk anime import:

1. Canonical provider cache (`title_provider_cache` / local preview cache)
2. Server-side `anime_title_index` (offline, ODbL derivative)
3. **Live AniList** — controlled fallback only when:
   - no high-confidence offline match, or
   - matched offline row has **no AniList ID** (cannot create a stable AniList-backed card)

~20,691 of 41,537 upstream entries include an AniList URL; the remainder rely on title/synonym search in the index but may still need AniList fallback at verify time if no `anilist_id` is stored.

---

## Replacing the dataset later

The ETL **defaults to the pinned release** above. To import a different source:

1. Document the replacement in this file and `ANIME-DATA-LICENSE.md` (attribution + license).
2. Set **`ANIME_INDEX_APPROVED_REPLACEMENT=1`**.
3. Provide **`ANIME_INDEX_RELEASE`** (tag) or **`ANIME_INDEX_ARTIFACT_URL`** (HTTPS URL to an admin-approved artifact).
4. Optionally set **`ANIME_INDEX_SOURCE_LABEL`** for `anime_dataset_meta.notes`.
5. Run `scripts/anime-index-etl` — activation remains atomic via `activate_anime_title_index()`.

Never enable auto-updates from forks or unverified mirrors.

---

## Attribution (product)

> Anime identity data contains information from anime-offline-database by manami-project, available under ODbL 1.0 and DbCL 1.0.
