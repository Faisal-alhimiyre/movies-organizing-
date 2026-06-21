# UI Parity Audit — Flutter vs. Website Mobile

**Source of truth:** `web-files/` — HTML/CSS/JS mobile website  
**Target:** Flutter app at `flutter_app/`  
**Method:** Top-down, screen by screen, section by section  
**Statuses:** `Not inspected` | `Inspected` | `Mismatch identified` | `In progress` | `Implemented` | `Tested` | `Visually verified`

---

## Checkpoints

| # | Name | Status |
|---|------|--------|
| 1 | Foundation and header | Implemented — pending visual verification |
| 2 | Menu and list selector | Implemented — pending visual verification |
| 3 | Tabs | Implemented — pending visual verification |
| 4 | Search and filters | Implemented — pending visual verification |
| 5 | Section headers | Not inspected |
| 6 | Cards and grid | Not inspected |
| 7 | Themes | Not inspected |
| 8 | Dialogs and secondary screens | Not inspected |
| 9 | Arabic RTL | Not inspected |
| 10 | Final responsive and visual audit | Not inspected |

---

## Screen 1: Main Watchlist Screen

### Section 1 — Screen Foundation

**Status:** Mismatch identified

| Property | Website | Flutter | Problem |
|----------|---------|---------|---------|
| Scroll structure | `.app` is a normal-flow div; header + panel + sections all scroll | `Column(Header[fixed], Expanded(ListView))` | Header does not scroll away; structural mismatch |
| Safe area | Single CSS `env(safe-area-inset-*)` on `.app` | `Scaffold(body: SafeArea(child: ResponsiveBody))` — `ResponsiveBody` also wraps `SafeArea` | **Double SafeArea** — content is pushed down twice the status-bar height |
| Page horizontal padding | `1.5rem = 24px` (dark theme: `styles.css .app` + `theme.css .app` override) | `16px` (`ResponsiveBody` default) | **8px too narrow on each side** |
| Page top padding | `2.25rem = 36px` (dark, `theme.css .app`) | `12px` (`vertical: 12` in `ResponsiveBody`) | **24px too little** |
| Max content width | `1200px` (`styles.css .app { max-width: 1200px }`) | `960px` (`ResponsiveBody(maxWidth: 960)`) | Too narrow on large screens |
| Background | Per-theme CSS `body { background: ... }` | `DecoratedBox(gradient)` wrapping `MaterialApp.router` in `app.dart` | Gradient only applies to outer decoration; scaffold is `Colors.transparent` ✓ |
| Scroll physics | Native browser scroll | `ListView` default physics | Acceptable; no visual mismatch |

**Website CSS selectors:**
```css
/* styles.css */
.app {
  max-width: 1200px;
  margin: 0 auto;
  padding: max(2rem, env(safe-area-inset-top)) max(1.25rem, env(safe-area-inset-right))
    max(3rem, env(safe-area-inset-bottom)) max(1.25rem, env(safe-area-inset-left));
}
/* theme.css (dark override) */
.app { padding: 2.25rem 1.5rem 3.5rem; }
```

**Flutter files:** `responsive_layout.dart`, `watchlist_screen.dart`

**Required corrections:**
1. Remove `SafeArea` from inside `ResponsiveBody` — the Scaffold already provides it
2. Change `ResponsiveBody` default `padding` to `EdgeInsets.symmetric(horizontal: 24, vertical: 0)` — no top padding needed since the header provides its own spacing; top safe area comes from Scaffold
3. Change `ResponsiveBody` default `maxWidth` to `1200` to match `.app`
4. Keep `Scaffold(body: SafeArea(...))` as the single safe-area layer

**English:** Mismatch identified | **Arabic RTL:** Not inspected | **Themes:** Not inspected | **Responsive:** Not inspected | **Overflow:** Not inspected | **Verified:** No

---

### Section 2 — Main Header

**Status:** Mismatch identified

| Property | Website | Flutter | Problem |
|----------|---------|---------|---------|
| Header bottom margin | `1.35rem = 21.6px` (dark, `theme.css .header { margin-bottom }`) | `Padding(bottom: 12)` in `WatchlistHeader` | Too little spacing below header |
| Header bottom border | `1px solid var(--border)` | `BorderSide(color: onSurface × 0.12, width: 1)` | Color uses wrong formula; should use `theme.dividerColor` directly (now fixed) |
| Header padding-bottom | `0.85rem = 13.6px` (dark, `theme.css .header { padding-bottom }`) | `EdgeInsets.only(bottom: 12)` | Close but slightly off |
| Title font size | `clamp(1.75rem, 4.8vw, 2.35rem)` ≈ 28–37.6px | `24px` fixed | Too small; not responsive |
| Title weight | `700` | `700` ✓ | OK |
| Title color | `var(--title-accent)` — `#c4a882` dark | `tc?.titleAccent` — `Color(0xFFC4A882)` | ✓ correct |
| Title letter-spacing | `-0.01em` | `-0.24` px (absolute) | Should be relative `em` unit |
| Title line-height | `1.08` | `1.08` ✓ | OK |
| Add Title button — shape | `border-radius: 999px` pill (`header__toolbar .btn--primary`) | `BorderRadius.circular(8)` | Should be pill (999px radius) |
| Add Title button — bg | `linear-gradient(180deg, #d4b896 0%, #c4a882 100%)` (ALL themes via `html[data-theme]`) | Solid `Color(0xFF0095F6)` blue | **Completely wrong color** — ignores the website's warm gradient |
| Add Title button — fg | `#0c0c0d` dark | `Colors.white` | Wrong foreground color |
| Add Title button — padding | `0.55rem 1.1rem` at toolbar | `EdgeInsets.symmetric(horizontal: 11, vertical: 6)` | Close |
| Toolbar container | `border: 1px solid var(--border); border-radius: 999px; padding: 0.28rem` | `Border.all(×0.12); borderRadius: 999; padding: 3` | Close but border opacity differs |
| Account menu trigger | `border-radius: 8px; min-height: 34px` + icon | `DecoratedBox 7px padding + icon` | Missing `min-height` |
| Stats chips — padding | `0.28rem 0.62rem` = 4.5px 9.9px | `9px 3.5px` (horizontal/vertical reversed!) | Horizontal and vertical padding values are swapped |
| Stats chip — font-size value | `0.78rem` | `11.5px` | Close |
| Stats chip — border | `1px solid var(--border)` | `border: onSurface × 0.14` | Border opacity differs |
| Stats chip gap | `0.4rem = 6.4px` | `spacing: 6` | ✓ close |
| Header stats `.header__stats` gap | `gap: 0.4rem = 6.4px` | `Wrap(spacing: 6, runSpacing: 6)` | ✓ |

**Website CSS selectors:**
```css
/* theme.css */
.header { margin-bottom: 1.35rem; padding-bottom: 0.85rem; border-bottom: 1px solid var(--border); }
.header__title { font-size: clamp(1.75rem, 4.8vw, 2.35rem); font-weight: 700; color: var(--title-accent); letter-spacing: -0.01em; line-height: 1.08; }
.header__toolbar { border: 1px solid var(--border); border-radius: 999px; padding: 0.28rem; gap: 0.3rem; }
.header__toolbar .btn--primary { border-radius: 999px; padding: 0.55rem 1.1rem; color: #0c0c0d; background: linear-gradient(180deg, #d4b896 0%, #c4a882 100%); }
.header__stat-chip { padding: 0.28rem 0.62rem; font-size: 0.78rem; border: 1px solid var(--border); border-radius: 999px; }
/* mobile.css ≤420px */
.header__title { font-size: clamp(1.45rem, 4vw, 1.75rem); }
.header__stat-chip { padding: 0.18rem 0.4rem; font-size: 0.66rem; }
```

**Flutter file:** `watchlist_header.dart`

**Required corrections:**
1. Title: use `clamp` via `MediaQuery` — `fontSize` = `lerpDouble(23, 38, (vw - 320) / (640 - 320)).clamp(23, 38)` for mobile
2. Title: `letterSpacing: -0.01 * fontSize` (relative)
3. Add Title button: gradient `LinearGradient(colors: [Color(0xFFD4B896), Color(0xFFC4A882)])` on ALL themes, pill shape, fg = `Color(0xFF0C0C0D)`
4. Stats chip padding: fix to `EdgeInsets.symmetric(horizontal: 9.9, vertical: 4.5)` → `EdgeInsets.symmetric(horizontal: 10, vertical: 4.5)` — horizontal is the larger dimension
5. Header bottom padding/margin: update to match website (13.6px bottom padding on header)

**English:** Mismatch identified | **Arabic RTL:** Not inspected | **Themes:** Mismatch identified | **Responsive:** Not inspected | **Overflow:** No | **Verified:** No

---

### Section 3 — Overflow Menu

**Status:** Implemented — pending visual verification

| Property | Website | Flutter (after CP2) | Status |
|----------|---------|---------------------|--------|
| Switch list in menu | Hidden in menu when title dropdown used (user req.) | ✓ Not in overflow menu | OK |
| Menu items order | Manage lists, Share, Theme, Language, hr, Change code, Delete, Sign out | ✓ Matches (single divider only) | OK |
| Share label | `menu.share` = "Share" | `l10n.menuShare` = "Share" / "مشاركة" | Fixed |
| Theme label | `menu.theme` = "Theme" | `l10n.menuTheme` | Fixed |
| Language section | Label + inline pill buttons (English / العربية) | `_LanguageSection` with pill buttons | Fixed |
| Language active style | Per-theme (dark: blue #0095f6, light: #1c1c20, purple/brown/pink: gradients) | `menuLangActiveBg/Fg` in `AppTypeColors` | Fixed |
| Menu width | `min-width: 12.5rem = 200px` | `panelWidth = 200` | OK |
| Menu panel bg (dark) | `#262626` | `menuPanelBg: #262626` | Fixed |
| Menu panel bg (light) | `#ffffff` | `menuPanelBg: #ffffff` | Fixed |
| Menu panel bg (purple) | `#140a26` | `menuPanelBg: #140a26` | Fixed |
| Menu panel bg (brown) | gradient `#322018 → #261810` | `menuPanelBg` + `menuPanelBgEnd` | Fixed |
| Menu panel bg (pink) | gradient `#7f2146 → #6a1839` | `menuPanelBg` + `menuPanelBgEnd` | Fixed |
| Menu panel border-radius | `12px` (dark `theme.css`) | `BorderRadius.circular(12)` | OK |
| Menu panel border | `var(--border)` | `theme.dividerColor` | OK |
| Menu item padding | `0.5rem 0.65rem` = 8px 10.4px | `EdgeInsets.symmetric(h:10.4, v:8)` | OK |
| Menu item font-size | `0.84rem = 13.44px` | `13.44` | OK |
| Menu item border-radius | `8px` | `BorderRadius.circular(8)` | OK |
| Delete item color | `color: #f87171` | `menuDangerColor: #f87171` | Fixed |
| Delete hover bg | `rgba(248, 113, 113, 0.1)` | `menuDangerColor × 0.1` | OK |
| Divider count | **One** divider (after Language, before Change code) | Single `_MenuDivider` | Fixed (was 2) |
| Divider margin | `0.3rem 0.35rem` | `symmetric(h:5.6, v:4.8)` | OK |
| Box shadow | `0 12px 28px rgba(0,0,0,0.65)` (dark) | `blurRadius:28, offset:(0,12), alpha:0.45` | Close |
| RTL panel position | `right:auto; left:0` | Anchored from left in RTL | Fixed |
| RTL text align | `text-align: right` | `TextAlign.start` (respects direction) | OK |
| Theme action | Opens `#themeModal` | `showThemePickerDialog` (SimpleDialog) | OK |
| List title dropdown | Website uses h1; user requires header dropdown | `_ListTitleDropdown` in header only | OK |

**Website HTML source:** `web-files/index.html` lines 129–188 (`.account-menu__panel`)  
**Website CSS:** `styles.css` `.account-menu__*`, `theme.css` dark overrides, per-theme `theme-*.css`  
**RTL CSS:** `rtl.css` `.account-menu__panel`, `.account-menu__lang-row`  
**JavaScript:** `app.js` `data-action` handlers for manage-lists, share, open-theme, set-language, change-code, delete-account, sign-out  

**Flutter files:** `account_menu_panel.dart` (new), `watchlist_header.dart` (`_AccountMenu`, `_ListTitleDropdown`)

**Removed from overflow menu:** Switch list, About, Send my list (was `shareSend`), Import JSON — none belong in this menu per website + user requirements.

**English:** Implemented | **Arabic RTL:** Implemented | **Themes:** Implemented (all 5) | **Responsive:** Implemented (320–430 clamp) | **Overflow:** No | **Verified:** No

---

### Section 3b — List Title Dropdown (header control)

**Status:** Implemented — pending visual verification

| Property | Website | Flutter | Status |
|----------|---------|---------|--------|
| Location | Plain `h1.header__title` (switch list in menu when >1 list) | Inline dropdown on title when >1 list | Per user spec |
| Duplicate in overflow menu | Yes on website when >1 list | ✓ Removed from overflow menu | OK |
| Dropdown panel width | `min-width: 12.5rem` | `minWidth: 200` | OK |
| Dropdown panel styling | Same as account menu panel | Uses `menuPanelBg` + `dividerColor` border | OK |

**Flutter file:** `watchlist_header.dart` (`_ListTitleDropdown`)

---

### Section 4 — Media-type Tabs

**Status:** Implemented (Checkpoint 3) — pending visual verification

| Property | Website | Flutter (after CP3) | Status |
|----------|---------|---------------------|--------|
| Tab layout | Horizontal flex: icon · label · count | `Row` per tab (was vertical `Column`) | ✓ Fixed |
| Tab padding (mobile ≤640) | `0.35rem 0.25rem` | `5.6×4` px | ✓ |
| Tab padding (≤420) | `0.3rem 0.42rem` | `4.8×6.72` px | ✓ |
| Tab min-height (mobile) | `2.35rem` (37.6px) | `37.6` px | ✓ |
| Tab font-size (mobile) | `0.72rem` | `11.52` px | ✓ |
| Tab font-weight (desktop) | `600` + `letter-spacing: 0.03em` | `w600` + `0.38` | ✓ |
| Tab font-weight (mobile) | `500` | `w500` | ✓ |
| Label uppercase (EN) | `text-transform: uppercase` | `label.toUpperCase()` when not Arabic | ✓ |
| Icon size (mobile) | `0.95rem` | `15.2` px | ✓ |
| Icon size (desktop) | `1rem` | `16` px | ✓ |
| Hide label on mobile icon tabs | `.type-tab:has(.type-tab__icon) .type-tab__label { display:none }` | `showLabel = icon == null \|\| !isMobile` | ✓ |
| Active underline | `border-bottom: 2px solid var(--tab-active-fg)` | `BorderSide(width: 2)` on tab `Ink` | ✓ |
| Active color | `var(--tab-active-fg)` per theme | `AppTypeColors.tabActiveFg` | ✓ Fixed |
| Inactive color | `var(--text-muted)` / pink `rgba(255,255,255,0.75)` | `textMuted` / pink override | ✓ |
| Count inactive | `var(--text)` @ `0.75` opacity | `onSurface` @ `0.75` | ✓ Fixed |
| Count active | `var(--text-muted)` full opacity | `textMuted` | ✓ Fixed |
| Count RTL | `direction: ltr; unicode-bidi: isolate` | `Directionality(ltr)` on count | ✓ |
| Tab container gap (mobile) | `0.25rem` | `Row(spacing: 4)` | ✓ |
| Tab container padding (mobile) | `0.35rem` | `5.6` px all sides | ✓ |
| Tab container bg (light) | `rgba(0,0,0,0.04)` | `tabBarBg` | ✓ |
| Tab container bg (purple) | `rgba(0,0,0,0.35)` | `tabBarBg` | ✓ |
| Tab container bg (brown/pink) | gradient | `tabBarBg` + `tabBarBgEnd` | ✓ |
| Tab container bg (dark) | transparent | none | ✓ |
| Panel wrapper around tabs+filters | `.panel` container | `WatchlistPanel` wraps tabs + filters | ✓ Fixed (CP4) |

**Flutter files:** `type_tab_bar.dart`, `theme_extensions.dart` (`tabBarBg`/`tabBarBgEnd`), `app_themes.dart`

**English:** Implemented | **Arabic RTL:** Count LTR isolated; labels not uppercased | **Themes:** `tabActiveFg` per theme | **Responsive:** 640/420 breakpoints | **Verified:** Pending user review

---

### Checkpoint 3 implementation results

**Root cause — wrong tab layout:** Flutter stacked icon, label, and count in a `Column`; website uses horizontal `display: flex` with `align-items: center`.

**Root cause — wrong active color:** Used `colorScheme.onSurface` instead of `--tab-active-fg` (purple showed white instead of gold `#e8c078`).

**`dart analyze`:** 0 issues on changed files ✓  
**`flutter test`:** 87/87 passed (includes 2 new `type_tab_bar_test.dart` cases) ✓  
**Hot restart required:** Yes — `AppTypeColors` gained `tabBarBg` / `tabBarBgEnd`

### Checkpoint 3 success criteria
- [x] Horizontal icon · label · count layout
- [x] `tabActiveFg` for active text and 2px underline
- [x] Correct count colors (inactive 75% text, active muted)
- [x] Mobile icon-only tabs (Movies/TV/Anime hide label ≤640px)
- [x] Mobile/desktop padding, font sizes, min-heights per `mobile.css` / `theme.css`
- [x] Theme-specific tab bar backgrounds (light/purple/brown/pink)
- [x] RTL count isolation
- [x] Filtering logic unchanged (`WatchlistTypeFilterNotifier` untouched)
- [ ] Visually verified 320–430px, all 5 themes, EN + AR — **pending your review**

### What changed (Checkpoint 3)
| File | Change |
|------|--------|
| `type_tab_bar.dart` | Full rewrite: horizontal tabs, breakpoints, `tabActiveFg`, theme backgrounds |
| `theme_extensions.dart` | Added `tabBarBg`, `tabBarBgEnd` |
| `app_themes.dart` | Tab bar background colors for light/purple/brown/pink |
| `l10n.dart` | Added public `isArabic` getter |
| `test/type_tab_bar_test.dart` | **New** — mobile label hiding + purple active color |
| `UI_PARITY_AUDIT.md` | Section 4 + Checkpoint 3 report |

### What remains after Checkpoint 3
- Visual verification at all widths/themes/locales (tabs)

### Section 5 — Search and Filter Area

**Status:** Implemented (Checkpoint 4) — pending visual verification

| Property | Website | Flutter (after CP4) | Status |
|----------|---------|---------------------|--------|
| Panel outer container | `.panel { bg-elevated; border; overflow hidden }` | `WatchlistPanel` `DecoratedBox` | ✓ Fixed |
| Panel border-radius | `0` dark desktop; `10px` mobile; `14px` other desktop | Per theme + breakpoint | ✓ |
| Panel margin-bottom | `2rem` desktop / `0.75rem` mobile | `32px` / `12px` | ✓ |
| Filter area padding (mobile) | `0.4rem = 6.4px` all sides | `EdgeInsets.all(6.4)` | ✓ Fixed |
| Filter area padding (desktop) | `0.75rem = 12px` (dark theme.css) | `12px` | ✓ |
| Filter area gap (mobile) | `0.35rem = 5.6px` | `5.6` px | ✓ |
| Filter grid (mobile) | 3-column grid | `Row` with 3 `Expanded` children | ✓ |
| Search field height (mobile) | `2.65rem = 42.4px` | `42.4` px | ✓ |
| Search field bg (dark) | `#262626` | `searchFieldBg` in `AppTypeColors` | ✓ Fixed |
| Search field border | `1px solid var(--border)` | `theme.dividerColor` | ✓ |
| Search font-size (mobile) | `16px` | `16` px | ✓ Fixed |
| Filter dropdowns bg (dark) | `#1a1a1a` | `filterFieldBg` | ✓ Fixed |
| Filter dropdown height (mobile) | `2.35rem = 37.6px` | `37.6` px | ✓ |
| Sort direction button | Separate `2.25rem × 2.25rem` button | `_SortDirectionButton` `36×36` | ✓ Fixed |
| Genre chips placement | Inside `.genre-filter` below select | `_GenreFilterBlock` column | ✓ Fixed |
| Selected genre chips | Per-theme warm gradient | `filterChip*` colors + gradient | ✓ Fixed |
| Clear filters position | Row 3 end-aligned on mobile | `Align(centerEnd)` after filter row | ✓ |
| Clear filters style | `btn--ghost` | `TextButton` with border + `bgElevated` | ✓ |
| Backfill banner | Inside `.panel__filters` full width | `MetadataBackfillBanner(inPanel: true)` | ✓ |
| Desktop layout | `flex-wrap` | `Wrap` with constrained search width | ✓ |

**Flutter files:** `watchlist_panel.dart`, `watchlist_filter_bar.dart`, `theme_extensions.dart`, `app_themes.dart`, `metadata_backfill_banner.dart`, `watchlist_screen.dart`

**English:** Implemented | **Arabic RTL:** `EdgeInsetsDirectional` / `AlignmentDirectional` | **Themes:** `searchFieldBg`, `filterFieldBg`, chip gradients per theme | **Responsive:** 640px mobile grid vs desktop wrap | **Verified:** Pending user review

---

### Checkpoint 4 implementation results

**Root cause — missing panel:** Tabs and filters floated on page background without `.panel` grouping.

**Root cause — wrong field colors:** Search/filters used `onSurface × 0.05` instead of per-theme `--search-field-bg` / `--filter-field-bg`.

**Root cause — chips separated from genre column:** Chips were in a separate row below the 3-col grid instead of inside `.genre-filter`.

**`dart analyze`:** 0 issues on changed files ✓  
**`flutter test`:** 89/89 passed (includes 2 new `watchlist_filter_bar_test.dart` cases) ✓  
**Hot restart required:** Yes — `AppTypeColors` gained filter/search/chip fields

### Checkpoint 4 success criteria
- [x] `.panel` wrapper around tabs + filters
- [x] Theme-aware search/filter field backgrounds and borders
- [x] Mobile search `16px` font / `42.4px` height (iOS zoom prevention)
- [x] Mobile filter `37.6px` height / `12.48px` font
- [x] Separate `36×36` sort-direction button
- [x] Genre chips inside genre column with per-theme gradient
- [x] Clear filters end-aligned (mobile row 3)
- [x] Backfill banner inside panel filters
- [x] Filter/search/sort logic unchanged
- [ ] Visually verified 320–430px, all 5 themes, EN + AR — **pending your review**

### What changed (Checkpoint 4)
| File | Change |
|------|--------|
| `watchlist_panel.dart` | **New** — `.panel` container wrapping tabs + filters |
| `watchlist_filter_bar.dart` | Full rewrite: mobile grid, desktop wrap, theme fields, chips, sort btn |
| `theme_extensions.dart` | Added `searchFieldBg`, `filterFieldBg`, `filterChip*` colors |
| `app_themes.dart` | Per-theme search/filter/chip values for all 5 themes |
| `metadata_backfill_banner.dart` | `inPanel` mode; matches `.ratings-backfill-banner` sizing |
| `watchlist_screen.dart` | Uses `WatchlistPanel`; banner moved inside filter bar |
| `test/watchlist_filter_bar_test.dart` | **New** — 320px overflow + Arabic RTL smoke tests |
| `UI_PARITY_AUDIT.md` | Section 5 + Checkpoint 4 report |

### What remains after Checkpoint 4
- Visual verification at all widths/themes/locales (search/filters)
- Checkpoint 5+: Section headers, cards, layout toggle (Section 6), etc.

### Section 5 (archived audit notes — pre-CP4)

**Status:** Superseded by implementation above

| Property | Website | Flutter (before CP4) | Problem |
|----------|---------|---------|---------|
| Panel outer container | `.panel { background: var(--bg-elevated); border: 1px solid var(--border); overflow: hidden }` | Not present | **Missing entirely** |
| Filter area padding (mobile) | `0.4rem = 6.4px` all sides | `Padding(vertical: 8)` only — no horizontal padding | Wrong; filter area floats at full width |
| Filter area gap (mobile) | `0.35rem = 5.6px` | `SizedBox(height: 6)` and `width: 6` | Close |
| Filter grid (mobile) | `grid-template-columns: repeat(3, minmax(0, 1fr))` | `Row(Expanded, Expanded, Expanded)` | ✓ equivalent |
| Search field height | `2.65rem = 42.4px` | `contentPadding: vertical: 10` (natural height ~42px) | Close |
| Search field bg (dark) | `var(--search-field-bg)` = `#262626` | `onSurface × 0.05` ≈ `rgba(255,255,255,0.05)` | **Wrong** — should be `#262626` solid |
| Search field border | `1px solid var(--border)` = `#363636` | `border: onSurface × 0.1` | Color correct but opacity approach differs |
| Search field border-radius | `8px` | `BorderRadius.circular(8)` ✓ | OK |
| Search font-size | `16px` (mobile, prevents iOS zoom) | `14px` | **Too small; will trigger iOS zoom** |
| Filter dropdowns bg (dark) | `var(--filter-field-bg)` = `#1a1a1a` | `onSurface × 0.05` | Wrong color |
| Filter dropdown height | `2.35rem = 37.6px` | Natural `DropdownButton` height | Not measured |
| Sort direction button | Separate `2.25rem × 2.25rem` standalone button | Inline `GestureDetector` inside sort dropdown | Close but sizing differs |
| Selected genre chips | `--accent` gradient bg (dark: gold gradient `#d4b896→#c4a882`) | `primary × 0.12` bg | **Wrong** — should use same warm gradient as Add Title button |
| Clear filters position | `grid-column: 1/-1; grid-row: 3; justify-self: end` | `Align(end)` | Positioning close but not exact |

**Website CSS selectors:**
```css
/* styles.css */
.panel { margin-bottom: 2rem; background: var(--bg-elevated); border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; }
/* mobile.css ≤640px */
.panel__filters { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 0.35rem; padding: 0.4rem; }
.search__input { height: 2.65rem; padding-inline-start: 2.35rem; font-size: 16px; border-radius: 8px; }
.genre-filter__select, .watched-filter__select, .rating-filter__select { height: 2.35rem; font-size: 0.78rem; }
/* theme.css (dark) */
.search__input { background-color: var(--search-field-bg) = #262626; border: 1px solid var(--border); }
.genre-filter__select, .watched-filter__select, .rating-filter__select { background-color: var(--filter-field-bg) = #1a1a1a; }
.genre-chip--filter { background: linear-gradient(180deg, #d4b896 0%, #c4a882 100%); color: #0c0c0d; }
```

**Flutter file:** `watchlist_filter_bar.dart`, `app_themes.dart`

**Required corrections:**
1. Wrap filter bar in a panel `DecoratedBox` with theme-appropriate background and border (part of Checkpoint 4 — filter section)
2. Search font-size: `16px` to prevent iOS zoom
3. Search field bg: needs per-theme `searchFieldBg` color from theme extension
4. Genre chips: use warm gradient matching Add Title button

**English:** Mismatch identified | **Arabic RTL:** Not inspected | **Themes:** Mismatch identified | **Responsive:** Not inspected | **Overflow:** No | **Verified:** No

---

### Section 6 — View Controls (Layout Toggle)

**Status:** Mismatch identified

| Property | Website | Flutter | Problem |
|----------|---------|---------|---------|
| Toggle container | `.layout-bar { padding: 0.2rem; background: var(--bg-elevated); border: 1px solid var(--border); border-radius: 999px; gap: 0.15rem; }` | No outer container; two loose buttons | Missing pill container |
| Toggle position | Inside `.page-toolbar { margin: -0.75rem 0 1.5rem }` below panel | `Align(centerStart)` below filter bar with `SizedBox(height: 8)` | No negative margin; not inside toolbar |
| Active button | `background: #262626; border-color: var(--border-strong)` | `accent × 0.08 bg; accent × 0.45 border` | Website uses neutral dark, Flutter uses accent tint |
| Active icon color | `var(--text)` = white | `accent` color | Website uses white, Flutter uses accent (gold/blue) |
| Button size | Not specified (icon-based) | `36×36` | Acceptable |
| Button border-radius | `999px` (part of bar) | `BorderRadius.circular(8)` | Mismatch |

**Website CSS selectors (dark):**
```css
.layout-bar { padding: 0.2rem; background: var(--bg-elevated); border: 1px solid var(--border); border-radius: 999px; gap: 0.15rem; }
.layout-toggle--active { color: var(--text); background: #262626; border-color: var(--border-strong); }
.layout-toggle { border-radius: 999px; border-color: transparent; background: transparent; }
```

**Flutter file:** `card_layout_toggle.dart`

**Required corrections:**
1. Wrap buttons in pill container matching `.layout-bar`
2. Active state: use neutral surface color, not accent
3. Buttons: `border-radius: 999px`

**English:** Mismatch identified | **Arabic RTL:** Not inspected | **Themes:** Not inspected | **Responsive:** Not inspected | **Overflow:** No | **Verified:** No

---

### Section 7 — Genre Section Headers

**Status:** Mismatch identified

| Property | Website | Flutter | Problem |
|----------|---------|---------|---------|
| Bar background (dark) | `var(--bg-elevated)` = `#121212` | `theme.colorScheme.surface` = `#121212` | ✓ same for dark |
| Bar background (purple) | `linear-gradient(135deg, rgba(140,80,220,0.1) 0%, rgba(30,12,50,0.5) 100%)` | `theme.colorScheme.surface` = `#1a0f30` flat | Missing gradient for purple |
| Bar border-radius (dark) | `0` (theme.css override: `border-radius: 0`) | `BorderRadius.circular(8)` | **Wrong** — dark theme is 0, mobile is 8px |
| Bar padding (mobile) | `0.32rem 0.5rem` = 5.1px 8px | `EdgeInsets.symmetric(horizontal: 8, vertical: 5)` | ✓ close |
| Genre-section margin-bottom (mobile) | `0.85rem = 13.6px` | `SizedBox(height: 28)` | Too much space |
| Genre-section margin-bottom (mobile, header-to-grid) | `0.35rem = 5.6px` | `SizedBox(height: 6)` | ✓ close |
| Title font-size (mobile) | `0.88rem = 14.08px` | `14px` ✓ | OK |
| Count pill font-size | `0.56rem = 8.96px` | `9px` ✓ | OK |
| Count pill padding | `0.12rem 0.38rem` = 1.9px 6.1px | `EdgeInsets.symmetric(horizontal: 6, vertical: 2)` | ✓ close |

**Website CSS selectors:**
```css
/* theme.css (dark) */
.genre-section { margin-bottom: 2.75rem; }
.genre-section__bar { background: var(--bg-elevated); border: 1px solid var(--border); border-radius: 0; padding: 0.7rem 1rem; }
/* mobile.css ≤640px */
.genre-section { margin-bottom: 0.85rem; }
.genre-section__bar { padding: 0.32rem 0.5rem; border-radius: 8px; }
.genre-section__title { font-size: 0.88rem; }
.genre-section__count { font-size: 0.56rem; padding: 0.12rem 0.38rem; }
```

**Flutter file:** `genre_section.dart`

**Required corrections:**
1. `border-radius: 0` for dark theme (currently 8 always) — use `AppBreakpoints.isMobile` vs desktop approach? Actually this should match the mobile viewport which IS 8px. The dark theme CSS sets 0 for DESKTOP but mobile.css overrides to 8px. Since Flutter is targeting mobile, `8px` is correct for mobile.
2. `SizedBox(height: 28)` → `SizedBox(height: 14)` (0.85rem mobile margin-bottom for genre-section)

**English:** Mismatch identified | **Arabic RTL:** Not inspected | **Themes:** Partially | **Responsive:** Not inspected | **Overflow:** No | **Verified:** No

---

### Section 8 — Watchlist Cards

**Status:** Mismatch identified

#### Grid

| Property | Website | Flutter | Problem |
|----------|---------|---------|---------|
| Hover grid (desktop) | `repeat(auto-fill, minmax(280px, 1fr))` | `floor(contentWidth/280).clamp(2,5)` cols | Equivalent |
| Poster grid (desktop) | `repeat(auto-fill, minmax(220px, 1fr))` | `floor(contentWidth/220).clamp(4,7)` cols | Equivalent |
| Hover grid (mobile ≤640px) | `repeat(2, minmax(0, 1fr))` | `cols=2` ✓ | OK |
| Poster grid (mobile ≤640px) | `repeat(3, minmax(0, 1fr))` | `cols=3` ✓ | OK |
| Hover grid (mobile ≤420px) | `repeat(1, minmax(0, 1fr))` | `cols=1` ✓ | OK |
| Poster grid (mobile ≤420px) | `repeat(2, minmax(0, 1fr))` | `cols=2` ✓ | OK |
| Hover grid gap (mobile) | `0.4rem = 6.4px` | `gap=7.2` | Slightly off (6.4 needed) |
| Poster grid gap (mobile) | `0.4rem = 6.4px` | `gap=6.4` ✓ | OK |
| Hover grid gap (≤420px) | `0.4rem` same | `gap=6.4` ✓ | OK |
| Card height (hover) | Content-driven (natural CSS height) | Fixed `childAspectRatio: 1.35` | Can overflow if content exceeds ratio |

#### Hover Card

| Property | Website (mobile) | Flutter | Problem |
|----------|---------|---------|---------|
| Card bg (dark) | `var(--bg-card)` = `#121212` | `theme.colorScheme.surface` = `#121212` ✓ | OK |
| Card border-radius (dark) | `0` (theme.css override) | `BorderRadius.circular(8)` | Wrong for dark; mobile.css doesn't override this, so dark hover cards have 0 radius |
| Card border-radius (mobile poster) | `14px` (`app[data-layout="poster"] .card`) | `BorderRadius.circular(8)` | Wrong; poster should be 14px |
| Card padding (hover, mobile) | `0.42rem 0.38rem` ≤420px, otherwise custom | `EdgeInsets.fromLTRB(8, 8, 8, 7)` | Not matching |
| Footer overflow | `display: none` for `.card__rating` | Rating hidden in poster ✓; hover still shows | Hover card overflow at small widths possible |

#### Card menu button (overflow issue)

| Property | Issue |
|----------|-------|
| M3 `iconButtonTheme` | Fixed in recent session — `iconButtonTheme` with `minimumSize: Size(28,28)` |
| `mainAxisExtent` calculation | `cardWidth * 1.5 + 40` — footer was 40px; now button is 26px + 10px padding = 36px — correct |

**Website CSS selectors:**
```css
/* styles.css */
.cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 1rem; }
.card { border-radius: var(--radius)=14px; border: 1px solid var(--border); }
/* theme.css (dark) */
.card { border-radius: 0; }
.app[data-layout="poster"] .card { border-radius: 14px; }
/* mobile.css ≤640px */
.cards { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 0.4rem; } /* poster */
.app[data-layout="hover"] .cards { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0.4rem; }
/* mobile.css ≤420px */
.app[data-layout="poster"] .cards { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0.35rem; }
.app[data-layout="hover"] .cards { grid-template-columns: 1fr; gap: 0.4rem; }
```

**Flutter file:** `genre_section.dart`, `title_card.dart`

**Required corrections:**
1. Dark theme hover card: `borderRadius: 0` (same as website) — actually, mobile.css doesn't override this, the base is `0` from theme.css for dark. BUT mobile.css ≤640px section says `.card { position: relative; cursor: pointer; overflow: hidden; }` — no border-radius override. So dark hover cards should have radius 0.
2. Poster card: `BorderRadius.circular(14)` (from `app[data-layout="poster"] .card { border-radius: 14px }`)
3. Hover card gap: `6.4` instead of `7.2`
4. Fix `childAspectRatio` overflow: use `mainAxisExtent` with calculated height

**English:** Mismatch identified | **Arabic RTL:** Not inspected | **Themes:** Mismatch identified | **Responsive:** Mismatch identified | **Overflow:** Mismatch identified | **Verified:** No

---

## Root Causes: Why the App Looks Dated and Unaligned

After comparing every section, the core architectural problems causing the unaligned, floating look are:

### 1. Double SafeArea
`WatchlistScreen` wraps the body in `SafeArea`, then `ResponsiveBody` wraps AGAIN in `SafeArea`. This pushes content down twice the status bar height, misaligning everything from the very first pixel.

**Fix location:** `responsive_layout.dart` — remove `SafeArea` from `ResponsiveBody`

### 2. Wrong page padding
Horizontal padding is `16px` in Flutter vs `24px` on the website. This makes the app feel cramped and misaligned with cards/sections appearing at different horizontal positions than expected.

**Fix location:** `responsive_layout.dart` — change to `horizontal: 24`

### 3. Missing panel container
The website wraps media tabs + filters in a `.panel` box with background and border. Without this, the tabs and filter dropdowns float against the raw page background with no visual grouping. This is the single biggest reason the filter area looks "floating."

**Fix location:** `watchlist_screen.dart` + `watchlist_panel.dart` — ~~add panel wrapper~~ **Done (CP4)**

### 4. Add Title button wrong color
The button uses solid blue `#0095f6` instead of the warm gold gradient `#d4b896→#c4a882` used by the website on ALL themes. This is immediately noticeable and breaks visual coherence.

**Fix location:** `watchlist_header.dart` (`_AddButton`)

### 5. Tab active color using wrong theme variable
Purple theme tabs show white instead of gold (`#e8c078`). `--tab-active-fg` is theme-specific but not tracked in the Flutter theme extension.

**Fix location:** `app_themes.dart` + `type_tab_bar.dart` — add `tabActiveFg` to `AppTypeColors`

### 6. Card border-radius wrong
Dark theme hover cards should have `borderRadius: 0`; poster cards should have `14px`. Currently all cards use `8px`.

**Fix location:** `title_card.dart`

### 7. Card overflow (exact source)
The overflow is NOT from a single cause. There are two sources:
- **Hover card:** `childAspectRatio: 1.35` gives a fixed height. If badge rows wrap (long genre names, multiple badges), the fixed content above `Expanded(summary)` exceeds available height. Use `mainAxisExtent` with a generous fixed height (120–140px) instead.
- **Poster card footer (FIXED):** The compact `PopupMenuButton` with M3 was 48px; now fixed via `iconButtonTheme`.

**Fix location:** `genre_section.dart` — change hover card from `childAspectRatio` to `mainAxisExtent`

---

## Why Themes Differ from Website

The Flutter themes capture main background, card surface, and accent color but miss several critical values:

| Missing | Website | Flutter |
|---------|---------|---------|
| `--bg-elevated` (panel, popup bg) | Per-theme distinct value | Not stored; only `surface` available |
| `--filter-field-bg` (input bg) | Per-theme e.g. `#1a1a1a` dark | `filterFieldBg` in `AppTypeColors` ✓ (CP4) |
| `--search-field-bg` | Per-theme e.g. `#262626` dark | `searchFieldBg` in `AppTypeColors` ✓ (CP4) |
| `--tab-active-fg` | Per-theme e.g. `#e8c078` purple | `tabActiveFg` ✓ (CP3) |
| Add Title button gradient | `#d4b896 → #c4a882` ALL themes | Hardcoded blue `#0095f6` |
| Card `--bg-card-hover` | Per-theme distinct hover state | Not used in Flutter (InkWell handles) |
| Genre-section bar gradient (purple) | `linear-gradient(135deg, ...)` | Flat surface color |

**Fix:** Add `bgElevated`, `searchFieldBg`, `filterFieldBg`, `tabActiveFg` to `AppTypeColors` (or a new `AppSpaceColors` extension). This requires updating all 5 theme definitions in `app_themes.dart`.

---

## Checkpoint 1: Foundation and Header — Implementation Plan

**Goal:** Fix the foundational layout so the app is correctly padded, single safe-area, and the header matches the website precisely.

**Scope:** DO NOT touch cards, tabs, filters, or genre sections.

### Files that will change in Checkpoint 1

| File | Change |
|------|--------|
| `flutter_app/lib/core/widgets/responsive_layout.dart` | Remove `SafeArea`; change default padding to `horizontal: 24, vertical: 0`; change `maxWidth` to `1200` |
| `flutter_app/lib/features/watchlist/presentation/watchlist_screen.dart` | Remove outer `SafeArea` (now handled by Scaffold alone), let `ResponsiveBody` use updated padding |
| `flutter_app/lib/features/watchlist/presentation/widgets/watchlist_header.dart` | Fix `_AddButton` (warm gradient, pill shape, dark fg); fix stat chip padding; fix header bottom-padding |
| `flutter_app/lib/app/theme/app_themes.dart` | Add `bgElevated` field to pass-through; add `popupMenuTheme`; keep existing changes |
| `flutter_app/lib/app/theme/theme_extensions.dart` | Add `bgElevated`, `searchFieldBg`, `filterFieldBg`, `tabActiveFg` to `AppTypeColors` |

### Step-by-step for Checkpoint 1

**Step 1 — Fix double SafeArea and padding (`responsive_layout.dart`)**
- Remove `SafeArea` wrapper — `Scaffold` provides it
- `padding: const EdgeInsets.symmetric(horizontal: 24)` (no top/bottom; each section manages its own vertical rhythm)
- `maxWidth: 1200`

**Step 2 — Fix scaffold structure (`watchlist_screen.dart`)**
- Remove `SafeArea` wrapping `ResponsiveBody` in the scaffold body — `ResponsiveBody` no longer has `SafeArea` so this outer one is now the only one
- Keep `Scaffold(body: SafeArea(...))` — this is the one that stays

Actually: current code is `Scaffold(body: SafeArea(child: ResponsiveBody(...)))`. Since we're removing SafeArea from ResponsiveBody, the one at Scaffold level stays. No change needed to `watchlist_screen.dart` for this.

**Step 3 — Fix Add Title button (`watchlist_header.dart`)**
- `_AddButton`: replace solid blue with warm gradient `LinearGradient(colors: [Color(0xFFD4B896), Color(0xFFC4A882)])` on ALL themes
- Change `color: Colors.white` → `color: Color(0xFF0C0C0D)` (near-black)
- Change `BorderRadius.circular(8)` → `BorderRadius.circular(999)` (pill)

**Step 4 — Fix stat chip padding (`watchlist_header.dart`)**
- Change `padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 3.5)` → `EdgeInsets.symmetric(horizontal: 10, vertical: 4.5)` to match website `0.28rem 0.62rem` = 4.5px 9.9px

**Step 5 — Add theme extension fields (`theme_extensions.dart` + `app_themes.dart`)**
- Add `bgElevated` and `tabActiveFg` to `AppTypeColors`
- Populate all 5 themes:

| Theme | `bgElevated` | `tabActiveFg` |
|-------|-------------|---------------|
| Dark | `#121212` | `#fafafa` |
| Light | `#ffffff` | `#1c1c20` |
| Purple | `#120a22` | `#e8c078` |
| Brown | `#261810` | `#f5ead8` |
| Pink | `#8a1e47` | `#ffffff` |

**Step 6 — Fix popup menu theme (`app_themes.dart`)**
- Add `popupMenuTheme: PopupMenuThemeData(color: bgElevated, shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12), side: BorderSide(color: border)))` to `ThemeData`

### Checkpoint 2 implementation results (complete)

**Root cause — detached list popup:** `_ListTitleDropdown` used `PopupMenuButton`, which renders a Material menu overlay centered relative to the anchor and visually detached from the title.

**List dropdown fix:** New `list_title_dropdown.dart` uses `CompositedTransformTarget` + `CompositedTransformFollower` + `OverlayEntry`. Menu opens directly beneath the bordered title box, matches its width, sorts active list first with checkmark, closes on outside tap or selection, 150ms fade/scale animation, RTL-aware anchoring.

**Root cause — theme switching:** Theme menu called `showThemePickerDialog(context, ref)` with the account-menu dialog `context` after `onClose()` disposed that overlay — theme dialog never opened reliably.

**Theme fix:** Pass `parentContext` (watchlist screen) to the account menu; defer theme dialog with `addPostFrameCallback`. Theme picker is a `Consumer` dialog watching `themeIdProvider` so selection updates immediately and persists via Hive `StorageKeys.theme`.

**Default list storage:** `watchlist-default-list-{accountId}` in localStorage (web) / Hive (Flutter). Migrates from legacy `watchlist-last-list-{accountId}` when no default is set. Login opens default list; header dropdown switches current list without changing default. `switchList` no longer writes `lastList`.

**Genre localization:** Centralized in `L10n.genreLabel()` — stored values stay English; display translated in filters, chips, cards, section headers, add/edit forms.

**`dart analyze`:** 0 errors on changed files (pre-existing warnings elsewhere) ✓  
**`flutter test`:** 85/85 passed ✓  
**Hot restart required:** Yes — new widget file + storage key

### Checkpoint 2 success criteria
- [x] List dropdown anchored to title box (not centered modal/dialog)
- [x] Active list first in dropdown with checkmark
- [x] Overflow menu: Manage lists, Share, Theme, Language, Change code, Delete account, Sign out — all wired (no placeholders)
- [x] Theme switching changes app immediately and persists
- [x] Manage Lists: "Assign as default" (EN + AR) replaces "Open list" (website + Flutter)
- [x] Default list persisted; badge in Manage Lists; safe fallback on delete
- [x] Genres translated via centralized `L10n.genreLabel()`
- [ ] Visually verified at 320, 360, 375, 390, 412, 430 px (all 5 themes, EN + AR) — **pending your review**

### What changed (Checkpoint 2)
| File | Change |
|------|--------|
| `list_title_dropdown.dart` | **New** — anchored overlay dropdown from title box |
| `watchlist_header.dart` | Uses `ListTitleDropdown`; passes `parentContext` to account menu |
| `account_menu_panel.dart` | Theme dialog uses parent context + live `themeIdProvider` watch |
| `storage_keys.dart` | Added `defaultList(accountId)` key |
| `local_storage_repository.dart` | `get/set/clearDefaultListId`; purge/migrate default list |
| `auth_repository.dart` | Login uses default list; `assignDefaultList()`; delete fallback |
| `session_service.dart` | `switchList` updates session only (not default) |
| `manage_lists_sheet.dart` | Assign as default + default badge |
| `l10n.dart` | `genreLabel`, `themeName`, `manageAssignDefault`, `manageDefaultList` |
| Genre display widgets | `genre_section`, `title_card`, `item_detail_sheet`, `watchlist_filter_bar`, `title_form_sheet`, `add_title_sheet` |
| `web-files/js/auth.js` | Default list key, `assignDefaultList`, login/signup/migrate/purge |
| `web-files/js/app.js` | Manage lists UI + `assign-default-list` handler |
| `web-files/js/i18n.js` | `manage.assignDefault`, `manage.defaultList` (EN + AR) |

### What remains after Checkpoint 2
- Your visual verification at all widths/themes/locales
- Checkpoint 3: Tabs + panel container wrapper (not started)

**`dart analyze`:** 29 pre-existing warnings, 0 new issues ✓  
**`flutter test`:** 85/85 passed ✓  
**`flutter build web`:** Succeeded ✓  
**Hot restart required:** Yes — theme extension const fields changed

### Checkpoint 1 success criteria
- [ ] No double SafeArea (verify with Flutter DevTools)
- [ ] 24px horizontal page padding visible (cards aligned correctly)
- [ ] Add Title button shows warm gold gradient on ALL themes
- [ ] Stat chips have correct padding (not too squashed vertically)
- [ ] Popup menus use theme `bgElevated` background and rounded 12px corners
- [ ] No new overflow warnings introduced
- [ ] Tested at 320px, 375px, 390px, 412px widths

### What changed
| File | Change |
|------|--------|
| `responsive_layout.dart` | Removed double `SafeArea`; padding → `fromLTRB(24,36,24,0)`; maxWidth → `1200` |
| `theme_extensions.dart` | Added `bgElevated` + `tabActiveFg` to `AppTypeColors` |
| `app_themes.dart` | Populated new fields for all 5 themes; added `popupMenuTheme` with `bgElevated` bg and 12px rounded border |
| `watchlist_header.dart` | `_AddButton`: warm gold gradient pill, dark `#0c0c0d` text; header border now uses `theme.dividerColor`; stat chip padding fixed to `(h:10, v:4.5)` |

---

## Remaining Checkpoints (planned, not yet detailed)

| Checkpoint | Key work |
|-----------|----------|
| 2 | List selector dropdown polish; menu width/border |
| 3 | Tabs: horizontal layout, `tabActiveFg`, theme tab-bar backgrounds | **Done** — pending visual verification |
| 4 | Filter bar: add panel container; fix search field bg/size; fix field heights; fix chips |
| 5 | Genre bar: fix spacing (28→14px); purple gradient bg |
| 6 | Cards: fix border-radius per theme; fix hover grid gap; fix `childAspectRatio` overflow |
| 7 | Themes: add `searchFieldBg`, `filterFieldBg` to extension; audit all 5 themes |
| 8 | Gate screen, dialogs, detail sheets, manage lists, add title |
| 9 | RTL: test Arabic direction for all corrected sections |
| 10 | Final 320px–1024px responsive pass; screenshot comparison |
