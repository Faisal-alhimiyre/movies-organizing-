# Usability checklist (phone / cold open)

Use before committing list/backfill/poster/season changes. Goal: commercially acceptable on a mid-range phone with 100+ titles.

## Web (`web-files/`)

- [ ] **Cold open** — first screen paints quickly; first ~18 posters fill without a long black grid
- [ ] **Type-tab bounce** — Movies ↔ Series ↔ Anime does not re-download / blank posters (type DOM cache)
- [ ] **Backfill under sort** — with Release or IMDb sort active, idle year/rating backfill must **not** call full `render()` or wipe poster `<img>`s (card patch / reorder only)
- [ ] **Search typing** — list search is debounced; no flash of empty/black cards on every keystroke
- [ ] **Season open** — episodes show first; OMDb season call skipped when TMDB already has ratings + air/titles; specials/related deferred
- [ ] **Empty console** — load + scroll + type tabs ≈ quiet without `watchlist-debug-*` flags (keep `[sync:data-loss-prevented]`)

## Flutter (`flutter_app/`)

- [ ] **Type tab** — switching types does not remount every poster (viewport-lazy sliver grid + stable keys)
- [ ] **Merge preserve** — year / ratings / title-meta backfill keep `cardPoster`, season selection, `imdbLink`
- [ ] **Backfill thrash** — progress banner isolated; `replaceItems` batched (not every few titles)
- [ ] **Season open** — episodes paint first; TMDB rating enrich patches afterward

## Manual gate

- [ ] Phone (or remote debug) with **100+ titles** before shipping list/poster/backfill changes

See also: `.cursor/rules/usability-first.mdc`
