# Product roadmap

Decisions and phased plan. **Do not reorder phases without explicit discussion.**

---

## Current priority — Phase 1: UI / UX / design polish

**Focus now:** refine the app — all UI/UX features and design working smoothly before any security or auth overhaul.

- Polish existing flows (add, search, filters, ratings, share, import, mobile, RTL)
- Fix bugs and visual inconsistencies
- Complete i18n gaps (English + Arabic)
- PWA / installability prep when UX is stable
- **Defer:** Supabase RLS, Edge Functions, email auth migration

**Personal account codes** (private — each user creates their own; never shared with others or the developer) remain the auth model until Phase 4. **List sharing** uses the in-app share link / import flow, not account codes.

---

## Phase 2: App distribution

Launch on all three platforms (same codebase):

| Platform | Approach | Cost (approx.) |
|----------|----------|----------------|
| Web | GitHub Pages + optional custom domain | $0–15/yr |
| Android | Capacitor or TWA | $25 one-time (Play Console) |
| iOS | Capacitor | $99/yr (Apple Developer) |

**Year 1 infra budget:** ~$135–170 upfront; ~$0–10/mo early, ~$25/mo when Supabase Pro is needed.

---

## Phase 3: Social & community

Ultimate product vision:

- Profiles with public shared lists
- Community tab — discover lists, engage, rate, comment
- Lists as social objects (not just private notes)

Build after core UX is solid and app is shipped.

---

## Phase 4: Security & authentication (last)

**Explicitly deferred** until UI/UX polish and app launch are done.

### Planned auth model (replaces personal account codes)

1. **First registration:** user provides **email** (identity / recovery)
2. **Login:** **username or email** + **password**
3. Migrate from `account_id = hash(code)` to Supabase Auth (or equivalent)

### Security work bundled with Phase 4

- Lock down Supabase RLS (today: open `using (true)` policies)
- Proxy OMDb/TMDB/AniList keys via Edge Functions
- Privacy Policy, Terms, third-party API attribution
- Safer sync (upsert / versioning vs delete-all-then-insert)

---

## Monetization (free core, always)

App stays **free** for saving and using lists. Revenue paths (later):

- “Where to watch” affiliate links (best long-term fit)
- Optional supporter tier (no paywall on core features)
- Tips / Ko-fi
- Community-native sponsorships at scale

Not a priority until social features and traffic exist.

---

## Phase 1 checklist — website polish (current work)

Finish the website before Flutter. Two clients later; one Supabase backend.

### Done recently

- [x] Gate: **Log in** / **Create new account** (EN + AR)
- [x] Gate: code recovery warning on create account
- [x] Broken poster message (poster layout + mobile)
- [x] Anime: skip **Animation** as main genre (movies/TV unchanged)
- [x] Rating: fine-tune arrows only after selecting stars

### Sprint A — Language & clarity

- [x] **A1** Finish i18n gaps in `app.js` — wire to `i18n.js`:
  - Manage lists: Edit / Delete buttons
  - “Unnamed list” fallback label
  - Change-code errors (mismatch, code in use, cloud failed)
  - Create-list cloud sync failure message
  - Rating error (“Tap a star…”)
  - Bulk paste errors
- [x] **A3** Share modal copy — clarify share-link flow (not account codes); EN + AR

### Sprint B — First-run & empty states

- [x] **B1** Empty list state — CTA: “Add your first title” + short hints (search / link / bulk)
- [x] **B2** Empty filter results — friendly message + “Clear filters” button
- [x] **B3** First-time dismissible tips — private code, share via link, sync status
- [x] **B4** Share link arrival (`?share=…`) — clear banner + next step to import

### Sprint C — Sync & reliability (UX only)

- [x] **C1** Sync status upgrade — Saving / Saved / Offline / Failed + **Retry** button
- [x] **C2** Unify “saved locally, cloud failed” alerts (create list, change code, delete)
- [x] **C3** Loading skeleton or placeholder while list loads from cloud

### Sprint D — Core flows audit

- [x] **D1** Add title flow — search, manual link, bulk paste; mobile + RTL pass
- [x] **D2** Edit / delete title — dialogs, mobile card actions
- [x] **D3** Rating flow — keyboard, RTL stars, error states
- [x] **D4** Manage lists modal — create, rename, delete, switch; touch targets
- [x] **D5** Filters & sort — chips, aria-labels, RTL remove buttons

### Sprint E — Look & feel

- [x] **E1** Favicon + app icon asset
- [x] **E2** OG / Twitter meta tags for share previews
- [x] **E3** Visual consistency — buttons, modals, spacing, all 4 themes
- [x] **E4** `prefers-reduced-motion` for animations
- [x] **E5** Typography & RTL sweep — mixed EN/AR titles, numbers, ratings

### Sprint F — Accessibility & mobile

- [x] **F1** Skip to main content link
- [x] **F2** Focus visible on menus, filters, gate tabs
- [x] **F3** Mobile card mode audit (≤380px)
- [x] **F4** Safe area / notched phones — header/footer padding

### Sprint G — Pre-launch (after A–F feel good)

- [x] **G1** PWA manifest + installable from browser
- [x] **G2** About page — app description, TMDB attribution, support link
- [x] **G3** README — deploy, config, migrations (for you, not end users)

### Suggested order

```
A1 → A3 → B1 → B2 → C1 → C2 → D1 → D4 → E1 → E2 → E3
then B3 → B4 → D2 → D3 → D5 → F1–F4 → G1–G3
```

### Deferred (not Phase 1)

- Flutter iOS/Android app (after website polish)
- Supabase RLS, email auth, legal pages (Phase 4)
- Social community tab (Phase 3)

---

## Completed (earlier sprints)

- Search “already on list” badge + duplicate block
- Manual add preview parity with search
- Mobile + RTL polish
- Add flow polish (Esc, Enter, focus trap, loading states)
- Filters: secondary genre, recently added / oldest sort, `addedAt`
- Sync/import fixes, `migrate-incremental.sql`

---

## Ops checklist (when deploying)

- [ ] Run `supabase/migrate-incremental.sql` if not done
- [ ] Set `publicAppUrl` in `web-files/js/config.js`
- [ ] Deploy latest frontend to GitHub Pages
- [ ] Own OMDb API key (not demo `thewdb`)
