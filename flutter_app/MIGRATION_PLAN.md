# Flutter migration plan — Our Movie Nights

**Repository:** `our-movie-nights/` — static site lives in **`web-files/`**  
**Flutter root:** `flutter_app/`  
**Source of truth:** `web-files/` (HTML/CSS/JS website)  
**Backend:** Existing Supabase project (no new database)  
**Stage:** 1 — Analysis complete. Flutter project **not** created yet.

---

## Architecture decisions

### State management: **Riverpod**

| Option | Verdict |
|--------|---------|
| **Riverpod** ✓ | Compile-safe providers, easy async/sync repos, testable, scales with feature folders without Bloc boilerplate |
| Provider | Older; less ergonomic for async Supabase + debounced sync |
| Bloc | Heavy ceremony for ~15 feature areas and many modals |

**Usage:** `Provider`/`Notifier` per feature; `AsyncNotifier` for watchlist load/reconcile; global `syncStatusProvider`, `localeProvider`, `themeProvider`.

### Routing: **go_router**

| Requirement | Support |
|-------------|---------|
| Flutter Web URLs + refresh | ✓ `go_router` + path URL strategy |
| `/gate`, `/` (watchlist) | ✓ |
| `?share={id}` and `/share/{id}` | ✓ `redirect` + query parsing |
| Auth guard (no session → gate) | ✓ `redirect` on `WatchlistAuthRepository` |
| Android / iOS | ✓ same routes; deep links configured later in `AndroidManifest` / `Info.plist` |

**Routes (planned):**

```
/gate                          → GateScreen (login / create)
/                              → WatchlistScreen (requires session)
/lists/manage                  → ManageListsScreen (modal route or page)
/share?shareId=                → redirect: gate if no session, else watchlist + share banner
/about                         → AboutScreen
```

### Local storage: **Hive**

| Option | Web | Android | iOS | Structured data |
|--------|-----|---------|-----|-----------------|
| **Hive** ✓ | ✓ | ✓ | ✓ | Boxes + type adapters; mirrors JSON blobs |
| SharedPreferences | ✓ | ✓ | ✓ | Too flat for nested watchlist |
| Drift | ✓ (wasm) | ✓ | ✓ | Overkill for client-side filter/sort over full list |
| Isar | Limited web | ✓ | ✓ | Web story weaker |

**Boxes (mirror JS keys):**

- `session` — `watchlist-session-v2` equivalent
- `library_{accountId}` — list metadata array
- `data_{listId}` — nested watchlist JSON
- `watched_{listId}` — watched map
- `sync_meta_{listId}` — `{ localUpdated, syncedAt }`
- `prefs` — lang, theme, card layout, flags

**Web note:** Hive uses IndexedDB under the hood; test quota early.

### Other packages (planned)

```yaml
supabase_flutter: ^2.x
go_router: ^14.x
flutter_riverpod: ^2.x
hive_flutter: ^1.x
intl: ^0.19.x  # + flutter gen-l10n from ARB
cached_network_image: ^3.x
url_launcher: ^6.x
share_plus: ^10.x
connectivity_plus: ^6.x
```

---

## Current static architecture (analyzed)

```
web-files/gate.html ──session──► web-files/index.html
     │                              │
     │                              ├── js/app.js (UI + flows)
     │                              ├── js/auth.js (codes, lists, storage keys)
     │                              ├── js/sync.js (Supabase push/pull)
     │                              ├── js/metadata.js (OMDb/TMDb/AniList)
     │                              ├── js/i18n.js (~246 keys × en/ar)
     │                              ├── js/mobile.js (card focus overlay)
     │                              └── css/* (5 themes + RTL + mobile)
     │
     └── js/gate.js
```

**Pages:** 2 (`gate.html`, `index.html`)  
**Modals in index:** 10 + account menu + link preview popover + dialog overlay  
**Themes:** `dark`, `light`, `purple`, `brown`, `pink` (ROADMAP says “four”; code has **five**)  
**About page:** Removed from static site (`d4d88b6`); **recreate in Flutter** per product need.

---

## Supabase tables (from `supabase/schema.sql`)

| Table | Purpose |
|-------|---------|
| `accounts` | `account_id` PK, `updated_at` |
| `lists` | `list_id` PK, `account_id` FK, `name`, `description`, `updated_at` |
| `watchlist_items` | Composite PK `(list_id, item_id)` + title metadata + `watched`, `watch_rating`, `watch_note` |
| `list_snapshots` | `share_id` PK, `payload` jsonb, `expires_at` (30 days) |

---

## Local storage keys (from `js/auth.js`, `app.js`, etc.)

| Key | Purpose |
|-----|---------|
| `watchlist-session-v2` | Session: `{ accountId, listId, needsCodeUpgrade? }` |
| `watchlist-library-v2-{accountId}` | List library entries |
| `watchlist-last-list-{accountId}` | Last opened list |
| `watchlist-data-v2-{listId}` | Nested watchlist JSON |
| `watchlist-watched-v1-{listId}` | Watched/rating map |
| `watchlist-sync-meta-{listId}` | Sync timestamps |
| `watchlist-start-empty-{listId}` | New empty list flag |
| `watchlist-lang-v1` | `en` / `ar` |
| `watchlist-theme-v1` | Theme id |
| `watchlist-card-layout-v2` | `hover` / `poster` |
| `watchlist-metadata-cache-v3` | API metadata cache |
| `watchlist-pending-share` | Share id across gate → app |

---

## External APIs (from `js/metadata.js`)

| API | Auth | Used for |
|-----|------|----------|
| OMDb | API key | Search, IMDb lookup, ratings |
| TMDb | API key | Fallback details, search, posters |
| AniList GraphQL | None | Anime search, lookup, scores |

---

## Feature migration table

Migration status legend: `Not started` | `Analyzed` | `In progress` | `Implemented` | `Tested` | `Verified against old website`

| Existing feature | Source files | HTML | JS | CSS | Supabase | Local keys | APIs | Flutter screen | Service / repo | Model | Shared widgets | Web | Android | iOS | Migration | Testing |
|------------------|-------------|------|-----|-----|----------|------------|------|----------------|----------------|-------|----------------|-----|---------|-----|-----------|---------|
| Gate — log in | `gate.html`, `gate.js` | gate | auth, gate, i18n | styles, theme*, rtl | `accounts` (exists check) | session | — | `GateScreen` | `AuthRepository` | `Session` | `CodeInput`, `GateRules` | URL `/gate` | same | same | Analyzed | Not started |
| Gate — create account | same | gate | auth, gate | same | `accounts`, `lists` (on first sync) | session, library, empty flag | — | `GateScreen` (create tab) | `AuthRepository` | `Account` | same | same | same | same | Analyzed | Not started |
| Code recovery warning | `gate.html`, `i18n.js` | gate | gate | gate styles | — | — | — | `GateScreen` | — | — | `WarningBanner` | — | — | — | Analyzed | Not started |
| Session restore / sign out | `auth.js`, `app.js` | index | auth, app | — | — | session | — | App bootstrap | `AuthRepository` | `Session` | — | refresh | cold start | cold start | Analyzed | Not started |
| Change account code | `index.html` modal, `app.js` | index | auth, sync, app | modals | `accounts`, all lists/items (migrate) | library, session | — | `ChangeCodeScreen` | `AuthRepository`, `SyncRepository` | — | `ConfirmDialog` | — | — | — | Analyzed | Not started |
| Delete account | menu, `app.js` | index | auth, sync | — | DELETE `accounts` cascade | purge keys | — | `Settings` flow | `AuthRepository` | — | `ConfirmDialog` | — | — | — | Analyzed | Not started |
| Legacy code upgrade prompt | `app.js`, `auth.js` | index | auth, app | — | — | session.needsCodeUpgrade | — | Dialog on home | `AuthRepository` | — | — | — | — | — | Analyzed | Not started |
| Main watchlist grid | `index.html`, `app.js` | index | app, i18n | styles, mobile, rtl | `watchlist_items` | data, watched | — | `WatchlistScreen` | `WatchlistRepository` | `WatchlistItem` | `TitleCard`, `GenreSection` | grid | grid | grid | Analyzed | Not started |
| Type tabs (all/movies/TV/anime) | `index.html`, `app.js` | index | app | type-tabs | — | — | — | `WatchlistScreen` | `FilterNotifier` | — | `TypeTabBar` | — | — | — | Analyzed | Not started |
| Search filter (toolbar) | `app.js` | index | app | search | — | — | — | `WatchlistScreen` | `FilterNotifier` | — | `SearchField` | — | — | — | Analyzed | Not started |
| Genre multi-filter + chips | `app.js` | index | app, genres | chips, rtl | — | — | — | `WatchlistScreen` | `FilterNotifier` | — | `GenreChipBar` | — | — | — | Analyzed | Not started |
| Watched filter | `app.js` | index | app | — | — | watched | — | `WatchlistScreen` | `FilterNotifier` | `WatchEntry` | — | — | — | — | Analyzed | Not started |
| Rating / added sort | `app.js` | index | app | — | — | items.addedAt in JSON | — | `WatchlistScreen` | `FilterNotifier` | — | `SortDropdown` | — | — | — | Analyzed | Not started |
| Empty list state | `app.js`, `i18n.js` | index | app | empty-state | — | — | — | `WatchlistScreen` | — | — | `EmptyState` | — | — | — | Analyzed | Not started |
| Empty filter state | `app.js` | index | app | — | — | — | — | `WatchlistScreen` | — | — | `EmptyState` | — | — | — | Analyzed | Not started |
| Card layouts (hover/poster) | `app.js`, `themes` | index | app | styles, mobile | — | card-layout | — | `WatchlistScreen` | `SettingsRepository` | — | `TitleCard` | hover | touch | touch | Analyzed | Not started |
| Mobile card focus overlay | `mobile.js`, `app.js` | index | mobile, app | mobile.css | — | data, watched | — | `ItemDetailSheet` | — | — | `DraggableSheet` | N/A | bottom sheet | bottom sheet | Analyzed | Not started |
| Add — search | `itemModal`, `app.js` | index | app, metadata | add-modal, mobile | — | — | OMDb,TMDb,AniList | `AddTitleFlow` | `MetadataService` | `SearchResult` | `SearchResultTile` | keyboard | touch | touch | Analyzed | Not started |
| Add — search confirm | `app.js` | index | app, metadata | title-search-confirm | — | — | same | `AddTitleFlow` step 2 | `MetadataService` | — | `MetadataPreview` | — | — | — | Analyzed | Not started |
| Add — manual link | `itemModal`, `app.js` | index | app, metadata | form-link-preview | — | — | same | `AddTitleFlow` | `MetadataService` | — | same | — | — | — | Analyzed | Not started |
| Add — bulk paste | `bulk-titles.js`, `app.js` | index | bulk, app | bulk | — | — | — | `AddTitleFlow` | `BulkImportService` | — | — | — | — | — | Analyzed | Not started |
| Duplicate / on-list detection | `app.js` | index | app | search badge | — | — | — | `AddTitleFlow` | `WatchlistRepository` | — | `Badge` | — | — | — | Analyzed | Not started |
| Anime skip Animation main genre | `app.js`, `metadata.js` | index | app | — | — | — | — | `AddTitleFlow` | `GenreService` | — | — | — | — | — | Analyzed | Not started |
| Edit title | `itemModal`, `app.js` | index | app | modals | items | data, watched | — | `EditTitleScreen` | `WatchlistRepository` | `WatchlistItem` | — | — | — | — | Analyzed | Not started |
| Delete title | `app.js`, `dialog.js` | index | app, dialog | — | items | data, watched | — | `WatchlistScreen` | `WatchlistRepository` | — | `ConfirmDialog` | — | — | — | Analyzed | Not started |
| Mark watched / unwatched | `app.js` | index | app | card | items.watched | watched | — | `WatchlistScreen` | `WatchlistRepository` | `WatchEntry` | — | — | — | — | Analyzed | Not started |
| Rating modal (stars + fine-tune) | `ratingModal`, `app.js` | index | app | rating-picker, rtl | watch_rating, watch_note | watched | — | `RatingSheet` | `WatchlistRepository` | `WatchEntry` | `StarRatingPicker` | keyboard | touch | touch | Analyzed | Not started |
| Ratings backfill banner | `app.js`, `metadata.js` | index | app | banner | items imdb/anilist cols | data | OMDb,AniList | `WatchlistScreen` | `MetadataService` | — | `ProgressBanner` | — | — | — | Analyzed | Not started |
| Manage lists modal | `manageListsModal`, `app.js` | index | app, auth | modals | lists | library | — | `ManageListsScreen` | `ListRepository` | `WatchlistList` | — | — | — | — | Analyzed | Not started |
| Create / rename list | `createListModal`, `auth.js` | index | auth, sync | — | lists | library, data | — | `CreateListScreen` | `ListRepository` | — | — | — | — | — | Analyzed | Not started |
| Switch list | `listSwitcher`, `auth.js` | index | auth, app | menu | — | session, last-list | — | `AccountMenu` | `ListRepository` | — | — | reload | reload | Analyzed | Not started |
| Move title to list | `moveListModal`, `app.js` | index | app, auth | — | items | data (copy) | — | `MoveListSheet` | `ListRepository` | — | — | — | — | — | Analyzed | Not started |
| Share — publish link | `shareModal`, `sync.js` | index | sync, app | share | list_snapshots | — | — | `ShareScreen` | `ShareRepository` | `SharePayload` | — | copy URL | share_plus | share_plus | Analyzed | Not started |
| Share — JSON export fallback | `app.js` | index | app | — | — | — | — | `ShareScreen` | `ShareRepository` | — | — | download | file | file | Analyzed | Not started |
| Import — file JSON | `app.js` | index | app | import modals | — | — | — | `ImportFlow` | `ImportService` | — | — | file picker | file picker | file picker | Analyzed | Not started |
| Import — share link arrival | `app.js`, `gate.js` | both | app, gate, sync | banner | list_snapshots | pending-share | — | `ShareArrivalBanner` | `ShareRepository` | — | — | `?share=` | deep link later | deep link later | Analyzed | Not started |
| Import — new list | `importNewListModal`, `app.js` | index | app, auth | — | lists, items | all list keys | — | `ImportFlow` | `ImportService` | — | — | — | — | — | Analyzed | Not started |
| Import — merge | `app.js` | index | app | — | items | data, watched | — | `ImportFlow` | `ImportService` | — | — | — | — | — | Analyzed | Not started |
| Import — merge with ratings | `app.js` | index | app | — | items | watched | — | `ImportFlow` | `ImportService` | — | — | — | — | — | Analyzed | Not started |
| Cloud sync push/pull | `sync.js`, `app.js` | index | sync, auth | sync chip | all tables | sync-meta | — | Global | `SyncRepository` | `SyncStatus` | `SyncChip` | online | online | online | Analyzed | Not started |
| Sync status UX | `app.js`, `i18n.js` | index | app | header | — | — | — | `WatchlistScreen` | `SyncRepository` | — | `SyncChip` | — | — | — | Analyzed | Not started |
| Offline / retry | `app.js` | index | app | — | — | — | — | Global | `SyncRepository` | — | — | — | — | — | Analyzed | Not started |
| Local-only mode (no Supabase) | `app.js`, `data.js` | index | app, auth | — | — | all local | — | Global | `WatchlistRepository` | — | — | — | — | — | Analyzed | Not started |
| Themes (5) | `themes.js`, `theme-*.css` | both | themes | 5 theme CSS | — | theme pref | — | `ThemeScreen` | `ThemeRepository` | `AppTheme` | — | — | — | — | Analyzed | Not started |
| EN / AR + RTL | `i18n.js`, `rtl.css` | both | i18n | rtl, typography | — | lang | — | App root | `LocaleRepository` | — | `Directionality` | dir=rtl | same | same | Analyzed | Not started |
| Account menu | `index.html`, `app.js` | index | app | header | — | — | — | `AccountMenu` | — | — | — | — | — | — | Analyzed | Not started |
| Theme modal | `themeModal` | index | themes | theme | — | theme | — | `ThemeScreen` | `ThemeRepository` | — | — | — | — | — | Analyzed | Not started |
| PWA install note | `pwa.js` | both | pwa | — | — | ios note key | — | Optional web | — | — | — | install | — | — | Analyzed | Not started |
| About + API attribution | removed from static | — | — | — | — | — | — | `AboutScreen` | — | — | — | page | page | page | Analyzed | Not started |
| Skip link / a11y | `accessibility.js`, css | both | a11y | a11y | — | — | — | Semantics | — | — | `Semantics` | focus | talkback | voiceover | Analyzed | Not started |
| Dialogs (alert/confirm) | `dialog.js` | both | dialog | dialog | — | — | — | `AppDialog` | — | — | — | — | — | — | Analyzed | Not started |
| Link preview popover | `app.js` | index | app, metadata | popover | — | — | metadata | Desktop only | `MetadataService` | — | — | hover | skip | skip | Analyzed | Not started |
| Onboarding tips | `app.js` (if present) | index | app | banner | — | — | — | `OnboardingBanner` | `PrefsRepository` | — | — | — | — | — | Analyzed | Not started |

\* theme CSS files: `theme.css`, `theme-light.css`, `theme-purple.css`, `theme-brown.css`, `theme-pink.css`, `theme-consistency.css`

---

## Proposed Flutter structure

```
flutter_app/lib/
├── main.dart
├── app/
│   ├── app.dart
│   ├── router.dart
│   ├── theme/
│   │   ├── app_themes.dart          # dark, light, purple, brown, pink
│   │   └── theme_extensions.dart
│   └── l10n/                        # app_en.arb, app_ar.arb (from i18n.js)
├── core/
│   ├── config/app_config.dart       # --dart-define
│   ├── storage/hive_boxes.dart
│   ├── widgets/                     # buttons, dialogs, loading, empty
│   └── utils/                       # id hashing, genre normalize
├── models/
│   ├── session.dart
│   ├── watchlist_list.dart
│   ├── watchlist_data.dart
│   ├── watchlist_item.dart
│   ├── watch_entry.dart
│   ├── share_payload.dart
│   └── sync_status.dart
├── repositories/
│   ├── auth_repository.dart
│   ├── watchlist_repository.dart    # abstract
│   ├── local_watchlist_repository.dart
│   ├── supabase_watchlist_repository.dart
│   ├── sync_repository.dart
│   ├── share_repository.dart
│   └── metadata/
│       ├── metadata_service.dart
│       ├── omdb_service.dart
│       ├── tmdb_service.dart
│       └── anilist_service.dart
└── features/
    ├── gate/
    ├── watchlist/
    ├── add_title/
    ├── item_detail/
    ├── ratings/
    ├── lists/
    ├── sharing/
    ├── importing/
    ├── settings/
    └── about/
```

---

## Configuration (`--dart-define`)

Mirror `js/config.example.js`:

| Define | Purpose |
|--------|---------|
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_ANON_KEY` | Public anon key only |
| `OMDB_API_KEY` | Search / lookup |
| `TMDB_API_KEY` | Fallback |
| `PUBLIC_APP_URL` | Share links (required for local dev) |

Document in `flutter_app/README.md` when project is created. Do not commit real keys.

---

## Migration stages (ordered)

| Stage | Scope | Status |
|-------|--------|--------|
| **1** | Repository analysis + this doc + BACKEND_RECOMMENDATIONS | **Complete** |
| **2** | `flutter create`, deps, config, Hive, Supabase init, Riverpod, go_router, themes, l10n shell, RTL, error handling, responsive shell | **In progress** (scaffolded — run `setup.ps1` locally) |
| **3** | Gate + auth + session | Not started |
| **4** | Main watchlist + cards + sync status | Not started |
| **5** | List management | Not started |
| **6** | Add / edit / delete / rating | Not started |
| **7** | Filters + sort | Not started |
| **8** | Share + import + share arrival | Not started |
| **9** | Themes + a11y + responsive parity | Not started |
| **10** | Web + Android + iOS verification | Not started |

---

## Manual parity checklist (per feature)

When testing each feature, verify:

- [ ] Static website behavior (reference)
- [ ] Flutter Web
- [ ] Flutter Android
- [ ] Flutter iOS (when available)
- [ ] English
- [ ] Arabic RTL
- [ ] Local-only (no Supabase config)
- [ ] Supabase cloud

---

## Risks and unclear behaviors

| # | Risk | Mitigation |
|---|------|------------|
| 1 | **Two codebases** during migration — drift | Feature table + parity checklist; website frozen unless explicit fix |
| 2 | **Primary listId === accountId** vs `lst_*` ids | Port `auth.js` logic exactly; test multi-list |
| 3 | **Full-replace sync** race conditions | Match debounce + reconcile timestamps |
| 4 | **Change code** partial local key cleanup | Document; optional fix in Phase 4 |
| 5 | **Hive web storage limits** | Test large lists early |
| 6 | **246 i18n keys** — migration effort | Script ARB generation from `i18n.js` in Stage 2 |
| 7 | **ROADMAP says Capacitor / Flutter mixed** | User decision: **Flutter** — update ROADMAP when approved |
| 8 | **About page** removed from web but requested in Flutter prompt | Build `AboutScreen` in Flutter only |
| 9 | **Share URL** uses `gate.html?share=` today | Flutter Web: `/gate?share=` or redirect shim for old links |
| 10 | **No service worker in Flutter** | Separate PWA under `flutter_app/web`; do not touch `web-files/sw.js` |

---

## Roadmap alignment

- **Phase 1** (website polish): Treat as complete in static site; Flutter is new client work.
- **Phase 2** (distribution): Flutter Web + Android + iOS replaces Capacitor plan — **document change, do not auto-edit ROADMAP.md** until user approves.
- **Phase 3–4**: Do not implement during migration.

---

## Existing website

**Confirmed:** Static website files are under `web-files/`. Repo root holds `flutter_app/`, `supabase/`, and docs. Root `index.html` redirects to `web-files/gate.html`.

---

## Next step (Stage 2 — on your machine)

1. Install [Flutter SDK](https://docs.flutter.dev/get-started/install) and add to PATH
2. `cd flutter_app` → `.\setup.ps1` (runs `flutter create`, `pub get`, `test`)
3. Copy assets from `web-files/assets/` into `flutter_app/assets/`
4. `flutter run -d chrome` with `--dart-define` keys (see `flutter_app/README.md`)

**Stage 3** (when ready): real gate auth, session, watchlist load — parity with `web-files/js/auth.js` + `gate.js`.
