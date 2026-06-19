# Our Movie Nights — Flutter app

Stage 2 foundation. Mirrors the static site in `../web-files/`.

## Prerequisites

1. [Flutter SDK](https://docs.flutter.dev/get-started/install) (stable, 3.24+)
2. Enable platforms: `flutter config --enable-web`

## First-time setup

From this folder (`flutter_app/`):

```bash
# Generate android/, ios/, web/ platform folders (keeps existing lib/)
flutter create . --org com.ourmovienights --project-name our_movie_nights --platforms=web,android,ios

flutter pub get
```

Copy brand assets from the website (once):

```bash
# From repo root — PowerShell
New-Item -ItemType Directory -Force -Path flutter_app/assets/icons, flutter_app/assets/brand
Copy-Item web-files/assets/icons/* flutter_app/assets/icons/
Copy-Item web-files/assets/brand/* flutter_app/assets/brand/
```

## Run with configuration

Pass keys via `--dart-define` (same values as `web-files/js/config.js`):

```bash
flutter run -d chrome \
  --dart-define=SUPABASE_URL=https://YOUR_PROJECT.supabase.co \
  --dart-define=SUPABASE_ANON_KEY=your_anon_key \
  --dart-define=OMDB_API_KEY=your_omdb_key \
  --dart-define=TMDB_API_KEY=your_tmdb_key \
  --dart-define=PUBLIC_APP_URL=https://you.github.io/movies-organizing/
```

Windows PowerShell (single line):

```powershell
flutter run -d chrome --dart-define=SUPABASE_URL=https://YOUR_PROJECT.supabase.co --dart-define=SUPABASE_ANON_KEY=your_key
```

Local-only (no Supabase): omit `SUPABASE_URL` and `SUPABASE_ANON_KEY`.

## Project docs

- `MIGRATION_PLAN.md` — feature parity checklist
- `BACKEND_RECOMMENDATIONS.md` — Phase 4 security notes (do not implement yet)
