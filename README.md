# Our Movie Nights

A free personal watchlist web app for **movies**, **TV series**, and **anime** — bilingual (English / Arabic), with cloud sync via Supabase and list sharing by link.

Static HTML/CSS/JS. No build step required.

---

## Quick start (local)

1. Clone the repo.
2. Copy `js/config.example.js` → `js/config.js` and fill in your keys (see [Configuration](#configuration)).
3. Open with a local static server (required for service worker / PWA):
   - **VS Code / Cursor:** Live Server on the project folder (port 5501 is set in `.vscode/settings.json`).
   - **Python:** `python -m http.server 8080` then open `http://localhost:8080/gate.html`

`js/config.js` is gitignored — never commit API keys.

---

## Configuration

Edit `js/config.js`:

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
2. **Settings → Pages →** deploy from `main` branch, root `/`.
3. Set `publicAppUrl` in `js/config.js` to your Pages URL (with trailing slash optional).
4. Redeploy after config changes (config is local — for Pages you either commit a private deploy workflow with secrets or set keys in the committed `config.js` on a private repo; **recommended:** keep repo private or use GitHub Actions secrets and generate `config.js` at deploy time).

For a public repo, use placeholder keys in a committed `config.js` only if you accept exposed anon keys (Supabase anon is designed for client use; still lock down RLS before scaling).

---

## Install as app (PWA)

The site includes `manifest.webmanifest` and `sw.js` for “Add to Home Screen” / install prompts.

- Icons: `assets/icons/icon.svg` (any size) and `assets/icons/icon-maskable.svg` (PWA safe zone). Export PNG 192×192 / 512×512 for Play Store later.
- Share preview image: `assets/og/og-image.svg` (1200×630). Some platforms prefer PNG — export from the SVG if link previews look wrong.
- Service worker caches the app shell; Supabase and metadata APIs stay network-first.

---

## Project layout

```
gate.html          Log in / create account
index.html         Main watchlist app
js/                App logic
css/               Styles (themes, RTL, mobile)
supabase/          SQL schema & migrations
scripts/           Dev utilities (seed, posters)
```

---

## Dev scripts

```bash
# Seed Supabase from data/watchlist.json (pass your account code)
python scripts/seed_supabase.py your-code-here
```

---

## Roadmap

See `ROADMAP.md` for phased plans (website polish → app stores → social features → auth/security).

---

## License

Personal project — add a license file if you open-source formally.
