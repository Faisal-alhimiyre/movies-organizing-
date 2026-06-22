# Stage C & D Manual Test Checklist

Open `index.html` (via a local server or GitHub Pages) and verify each item.

## Stage C Verification Results (Code Review — Jun 22 2026)

**Bugs found and fixed during verification:**
1. `title-detail.js`: `window.WatchlistI18n?.onLangChange?.()` → `window.WatchlistI18n?.onChange?.()` — **FIXED**
2. `series-metadata.js`: `WatchlistI18n?.getLocale?.()` (non-existent) → `WatchlistI18n?.getLang?.()` — **FIXED**

**Theme count confirmed from source code (`themes.js`):**
- 5 themes: `dark`, `light`, `purple`, `brown`, `pink`
- Default: `dark`
- All selectable via `data-action="set-theme"` buttons
- CSS files: `theme.css`, `theme-light.css`, `theme-purple.css`, `theme-brown.css`, `theme-pink.css`

**JavaScript metadata tests:**
- Browser test page `test-series-metadata.html` created (28 test cases)
- Cannot auto-run without a browser session; execute manually in browser
- Core pure functions verified by code review: `_normalizeTmdbSeries`, `_normalizeTmdbSeasonSummary`,
  `_normalizeTmdbEpisode`, `_normalizeOmdbSeason`, `isAired`, `anilistDateStr`, `stripHtml` — all correct

---

## Viewport test sizes
Test at each of: 320px · 360px · 375px · 390px · 412px · 430px · 640px · 768px · 1024px · 1440px

---

## Card tap / click

- [ ] Mobile (≤640 px): tapping a card body opens the new detail bottom-sheet
- [ ] Desktop (≥641 px): clicking a card body opens the new centered panel
- [ ] Tapping the three-dot menu button does NOT open the detail
- [ ] Tapping a card rating button does NOT open the detail
- [ ] Tapping a card watchlist toggle does NOT open the detail
- [ ] Old `.mobile-card-focus` popup no longer appears on any breakpoint

---

## Detail surface — general

- [ ] Panel appears with a smooth slide-up animation on mobile
- [ ] Panel appears with a scale/fade animation on tablet/desktop
- [ ] Close button (×) is always visible at top of panel
- [ ] Pressing Escape closes the detail
- [ ] Clicking the backdrop closes the detail
- [ ] Body scroll is locked while detail is open
- [ ] Internal content scrolls without locking body
- [ ] No horizontal overflow inside the panel at any breakpoint
- [ ] No clipped buttons at any breakpoint

---

## Detail header

- [ ] Poster displays correctly (correct aspect ratio, no stretch)
- [ ] Missing poster shows 🎬 placeholder
- [ ] Broken poster shows broken-poster message
- [ ] Title displays correctly; alt-title shown when present
- [ ] Type badge (Movie / TV Series / Anime / Film Series) is correct
- [ ] Year badge appears when year is present
- [ ] Genre badges display
- [ ] Leads/cast line appears when present
- [ ] IMDb/external rating badges visible when present
- [ ] Compact title appears in topbar after scrolling past the main heading

---

## Watched state block

- [ ] Unwatched item shows "Not watched yet"
- [ ] Watched/unrated item shows "Watched — not rated yet" with a rating prompt
- [ ] Watched/rated item shows the rating and note

---

## Action buttons

- [ ] Open Link button opens item link in new tab
- [ ] Open Link button does NOT appear for items without a link
- [ ] Mark Watched button marks item as watched; label changes to "Mark unwatched"
- [ ] Mark Unwatched button unmarks; label changes back
- [ ] Edit button opens the edit modal on top of the detail
- [ ] After editing, detail refreshes with new values WITHOUT closing
- [ ] Move button opens list-picker modal (only shown when multiple lists exist)
- [ ] Delete button shows a confirmation dialog; confirming closes the detail
- [ ] Delete cancellation leaves the detail open

---

## Closing / focus restoration

- [ ] Escape closes the detail and focus returns to the card that was clicked
- [ ] Clicking the backdrop closes the detail
- [ ] Clicking the × button closes the detail
- [ ] Focus is trapped inside the panel while open (Tab cycles only within)

---

## Accessibility

- [ ] Panel has `role="dialog"` and `aria-modal="true"`
- [ ] `aria-labelledby` points to the title heading
- [ ] Overlay has `inert` attribute when closed
- [ ] Body has `overflow: hidden` while open
- [ ] Screen reader announces the dialog correctly

---

## Themes

Test ALL five themes (dark, light, purple, brown, pink):

- [ ] Dark theme — detail surface renders correctly
- [ ] Light theme — detail surface renders correctly (light backgrounds, dark text)
- [ ] Purple theme — detail surface renders correctly
- [ ] Brown theme — detail surface renders correctly
- [ ] Pink theme — detail surface renders correctly

---

## RTL (Arabic)

- [ ] Switch to Arabic — detail text is right-aligned
- [ ] Genre badges flow right-to-left
- [ ] Action buttons are right-aligned
- [ ] Switching back to English restores LTR layout correctly

---

## Reduced motion

- [ ] With `prefers-reduced-motion: reduce` media enabled, no slide/scale animations play
- [ ] Detail still opens and closes immediately

---

## Responsive layout

At 320px:
- [ ] Detail fills width as bottom sheet
- [ ] Poster + title fit without overflow
- [ ] Actions are reachable

At 768px:
- [ ] Detail appears as centered panel
- [ ] Width is constrained

At 1440px:
- [ ] Detail stays centered with max-width
- [ ] Not stretched edge-to-edge

---

## Stage D: Seasons & Episodes Tests

### Season carousel

- [ ] TV series and anime show the seasons section
- [ ] Movies do NOT show the seasons section
- [ ] Loading spinner appears while fetching metadata
- [ ] Season cards render with poster, name, episode count
- [ ] Selected season is centered, larger, and has accent border
- [ ] Adjacent seasons are partially visible and slightly smaller
- [ ] Clicking an adjacent season centers it and loads its episodes
- [ ] Previous/next arrow buttons work
- [ ] Keyboard ArrowLeft/ArrowRight navigate seasons (while carousel is focused)
- [ ] Touch swipe scrolls the carousel on mobile
- [ ] Mouse drag scrolls the carousel on desktop
- [ ] Mouse wheel scrolls the carousel horizontally

### Specials

- [ ] Specials (Season 0) shows label "Specials" — NOT "Season 0"
- [ ] Selecting specials does NOT happen automatically when regular seasons exist

### Season info panel

- [ ] Selected season name appears below carousel
- [ ] Air year and episode count shown
- [ ] Season overview shown (collapsible when long)
- [ ] Progress shown as "N / M watched"
- [ ] "Mark season watched" / "Unmark" button works correctly

### Episode list

- [ ] Episodes load lazily when a season is selected
- [ ] Each row shows: still, episode number, title, overview, metadata, watched check
- [ ] Still image loads correctly; fallback to season/title poster when missing
- [ ] Broken image placeholder shows (no browser broken icon)
- [ ] Episode titles that are placeholders appear styled differently
- [ ] Long summaries truncate to 2 lines

### Episode toggles

- [ ] Clicking check marks episode as watched (immediate, no spinner)
- [ ] Clicking again unmarks
- [ ] Season progress counter updates immediately
- [ ] Season card in carousel updates progress bar immediately
- [ ] Header "watched" block updates immediately
- [ ] Filter / card in the main list updates (via updateCardInPlace)
- [ ] Carousel selection does NOT reset
- [ ] Detail scroll position does NOT reset

### Legacy-complete behavior

- [ ] Item watched with no granular progress shows ALL episodes as watched
- [ ] No granular progress is written merely by opening the detail
- [ ] Unchecking one episode materializes progress (others stay watched)
- [ ] Rating and note are preserved after materialization

### Whole-season mark/unmark

- [ ] "Mark season watched" marks all aired episodes in that season
- [ ] "Unmark season" unmarks all episodes in that season
- [ ] Future/unaired episodes are excluded
- [ ] Partial state is visually distinct from complete / unwatched

### Whole-title toggle integration

- [ ] "Mark watched" from the action bar works for TV/anime
- [ ] After marking, all episodes appear as watched (legacy-complete)
- [ ] "Mark unwatched" clears progress entirely
- [ ] For movies, binary behavior is unchanged

### Error / offline states

- [ ] API error shows error message with Retry button
- [ ] Offline with cache shows cached content + stale banner
- [ ] Offline without cache shows clear offline message with Retry
- [ ] Rate limited shows appropriate message
- [ ] Invalid ID shows non-retryable message
- [ ] Retry button actually retries
- [ ] No endless spinner

### Stale request safety

- [ ] Opening a second item quickly does not show first item's seasons
- [ ] Slow response for item A does not overwrite item B's detail

### RTL / Arabic

- [ ] Season names display in Arabic
- [ ] Episode titles display in Arabic
- [ ] Carousel arrows retain chronological meaning (left = lower season)
- [ ] No visual overflow from long Arabic text

### Themes (all five)

- [ ] Dark — carousel + episodes render correctly
- [ ] Light — carousel + episodes render correctly (light backgrounds)
- [ ] Purple — accent color visible on selected season
- [ ] Brown — accent color visible
- [ ] Pink — contrast correct, all elements visible

### Responsive

At 320px:
- [ ] At least one season card visible, adjacent partially visible
- [ ] Episode check buttons reachable
- [ ] No horizontal overflow

At 768px+:
- [ ] More seasons visible in carousel
- [ ] Episode stills are larger
- [ ] Comfortable reading

---

## Local persistence note

Stage D progress persists in `localStorage` only.
Cloud synchronization (`watch_progress` Supabase column) is **Stage E**.
Cross-device granular progress is not complete until Stage E.
