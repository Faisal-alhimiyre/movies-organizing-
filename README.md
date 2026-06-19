# Our Movie Nights

A free personal watchlist web app for **movies**, **TV series**, and **anime** — bilingual (English / Arabic), with cloud sync via Supabase and list sharing by link.

Static HTML/CSS/JS. No build step required.

---

## Quick start (local)

1. Clone the repo.
2. Copy `web-files/js/config.example.js` → `web-files/js/config.js` and fill in your keys (see [Configuration](#configuration)).
3. Open with a local static server (required for service worker / PWA):
   - **VS Code / Cursor:** Live Server — open `web-files/gate.html` or the repo root `index.html` (redirects into `web-files/`). Port 5501 is set in `.vscode/settings.json`.
   - **Python:** `cd web-files` then `python -m http.server 8080` and open `http://localhost:8080/gate.html`

`web-files/js/config.js` is gitignored — never commit API keys.

---

## Configuration

Edit `web-files/js/config.js`:

| Key | Required | Purpose |
|-----|----------|---------|
| `omdbApiKey` | Recommended | Posters, ratings, search ([get key](https://www.omdbapi.com/apikey.aspx)) |
| `tmdbApiKey` | Optional | Better search when OMDb has no match ([get key](https://www.themoviedb.org/settings/api)) |
| `supabaseUrl` | For cloud sync | Supabase project URL |
| `supabaseAnonKey` | For cloud sync | Supabase anon/public key |
| `publicAppUrl` | For share links | Live site URL, e.g. `https://you.github.io/movies-organizing/` |

Leave Supabase empty for **local-only** mode (data stays in the browser).

---

## Supabase setup

Run in **Supabase → SQL Editor** (once per project):

1. **New project:** run `supabase/schema.sql`
2. **Existing project with accounts:** run `supabase/migrate-incremental.sql` only

Older upgrades:

- No `accounts` table yet → `supabase/migrate-to-accounts.sql` first, then incremental

Do **not** run the commented “wipe all data” block at the bottom of `schema.sql` on a live database.

---

## Deploy (GitHub Pages)

1. Push to GitHub.
2. **Settings → Pages →** deploy from `main` branch, folder **`/web-files`** (not repo root).
3. Set `publicAppUrl` in `web-files/js/config.js` to your Pages URL (e.g. `https://you.github.io/movies-organizing/`).
4. Redeploy after config changes (config is local — for Pages you either commit a private deploy workflow with secrets or set keys in the committed `config.js` on a private repo; **recommended:** keep repo private or use GitHub Actions secrets and generate `config.js` at deploy time).

For a public repo, use placeholder keys in a committed `config.js` only if you accept exposed anon keys (Supabase anon is designed for client use; still lock down RLS before scaling).

---

## Install as app (PWA)

The site includes `web-files/manifest.webmanifest` and `web-files/sw.js` for “Add to Home Screen” / install prompts.

- Icons: `web-files/assets/icons/icon.svg` (any size) and `web-files/assets/icons/icon-maskable.svg` (PWA safe zone). Export PNG 192×192 / 512×512 for Play Store later.
- Share preview image: `web-files/assets/og/og-image.svg` (1200×630). Some platforms prefer PNG — export from the SVG if link previews look wrong.
- Service worker caches the app shell; Supabase and metadata APIs stay network-first.

---

## Project layout

```
web-files/         Static website (HTML, CSS, JS, assets)
  gate.html        Log in / create account
  index.html       Main watchlist app
  js/              App logic
  css/             Styles (themes, RTL, mobile)
flutter_app/       Flutter migration (in progress)
supabase/          SQL schema & migrations
index.html         Redirects to web-files/gate.html
```

## Dev scripts

```bash
# Seed Supabase from web-files/data/watchlist.json (pass your account code)
python web-files/scripts/seed_supabase.py your-code-here
```

---

## Roadmap

See `ROADMAP.md` for phased plans (website polish → Flutter app → social features → auth/security).

---

## Flutter app (in progress)

The native/Web client lives in `flutter_app/`. See `flutter_app/README.md` for setup.

```powershell
cd flutter_app
.\setup.ps1   # requires Flutter SDK in PATH
```


---

## License

Personal project — add a license file if you open-source formally.
