# Backend recommendations — Our Movie Nights

**Status:** Documentation only. **Do not implement** unless Phase 4 is explicitly started.

This document describes known weaknesses and future improvements for the **existing** Supabase project. The Flutter migration must preserve current client behavior and the existing anon-key + personal-code model until Phase 4.

---

## Current architecture (unchanged during Flutter migration)

| Layer | Today |
|-------|--------|
| Identity | Personal account code → hashed `account_id` (`l` + djb2-style base36) |
| Client auth | No Supabase Auth; session in app storage |
| Database access | `supabase_flutter` with **anon key only** |
| Authorization | Client-side knowledge of `account_id` / `list_id` |
| Sharing | Opaque `share_id` in `list_snapshots` (30-day TTL) |

---

## Critical: open RLS on core tables

Tables `accounts`, `lists`, and `watchlist_items` use permissive policies for `anon` and `authenticated`:

```sql
using (true)
with check (true)
```

**Impact:** Anyone with the public anon key can SELECT, INSERT, UPDATE, and DELETE **all** rows. `account_id` is the only practical secret; the database does not enforce ownership.

**Flutter migration:** Keep using the same queries and anon key. Document this risk; do not “fix” silently.

---

## Critical: account ID as sole secret

- `account_id` is derived from the personal code (not stored server-side).
- No server validation that the caller owns an account.
- Enumeration or guessing IDs grants full CRUD via PostgREST.

**Phase 4 direction:** Supabase Auth, JWT claims, RLS tied to `auth.uid()` or a membership table.

---

## High: anon key in client

The anon key ships in every web/mobile build. With current RLS, it is effectively a master key for allowed operations.

**Mitigations (Phase 4+):**

- Edge Functions with service role for sensitive writes
- Narrow RPC surface instead of raw table CRUD
- Never ship service-role key in Flutter or web clients

---

## High: `list_snapshots` insert policy

```sql
create policy "list_snapshots_insert"
  on public.list_snapshots for insert to anon, authenticated with check (true);
```

**Risks:**

- Unbounded snapshot inserts (storage / abuse)
- Arbitrary `share_id` squatting if IDs are predictable
- No creator ownership or revoke path

**Select** is limited to `expires_at > now()` but not to knowing `share_id` at the SQL layer (client filters by `share_id`).

**Recommendations (later):**

- Server-side insert only (Edge Function)
- Cryptographically random `share_id` (already UUID in app)
- Optional `created_by` / rate limits
- Scheduled cleanup of expired rows
- DELETE or revoke policy for creator

---

## Medium: sync strategy (delete-all-then-insert)

Current JS (`sync.js` → `pushSnapshot`):

1. UPSERT `accounts` + `lists`
2. DELETE all `watchlist_items` for `list_id`
3. INSERT full item set

**Risks:**

- Last-write-wins across devices
- Brief empty list if insert fails mid-push
- No versioning or conflict resolution

**Recommendations (document only):**

- Per-item UPSERT with `updated_at` comparison
- Sync version column on `lists`
- Tombstone table for deletes
- Client-side merge rules for concurrent edits

**Flutter migration:** Reproduce delete-all-then-insert + timestamp reconcile from `reconcileWithCloud()` in `app.js`.

---

## Medium: `watch_note` privacy

SQL comment labels `watch_note` as private, but RLS allows global read. Notes are not private at the database layer.

---

## Medium: schema drift

- `schema.sql` omits `watchlist_items_watch_rating_range` CHECK (0–10); migrations add it.
- `schema.sql` drops `list_snapshots` on re-run (destructive).
- `addedAt` lives in JSON payload only, not a DB column (by design).

**Ops:** Prefer `migrate-incremental.sql` on live DB; align `schema.sql` when Phase 4 hardens backend.

---

## API key exposure (metadata)

| API | Key location today | Risk |
|-----|-------------------|------|
| OMDb | `config.js` / client | Key extractable from app |
| TMDb | `config.js` / client | Same |
| AniList | No key (public GraphQL) | Rate limits / abuse |

**Phase 4 direction:** Proxy OMDb/TMDb via Edge Functions; cache responses server-side.

---

## Future authentication (Phase 4)

Replace personal account codes with:

1. **Registration:** email (identity / recovery)
2. **Login:** username or email + password
3. **Migration:** map `account_id` → Supabase Auth user

Do **not** implement during Flutter migration.

---

## Future legal / launch (Phase 4)

Not in current website (About page was removed):

- Privacy Policy
- Terms of Service
- Third-party API attribution page (TMDb, OMDb, AniList) — recreate in Flutter About feature
- Data retention policy for `list_snapshots`

---

## Social / community (Phase 3) — database needs (future)

Not required for Flutter parity. If built later, likely tables:

- `profiles` (public display, avatar)
- `public_list_shares` (curated public lists, not ephemeral snapshots)
- `list_comments`, `list_reactions`

Current `list_snapshots` is **ephemeral import**, not a social graph.

---

## Sharing security summary

| Mechanism | Secret? | Purpose |
|-----------|---------|---------|
| Personal account code | **Yes — never share** | Login / sync |
| `share_id` in URL | No — shareable | One-time list import |
| Export JSON file | No | Offline backup |

Flutter must preserve: share links → `gate?share=` → login → import flow.

---

## Safer synchronization strategies (future)

1. Optimistic UI + debounced push (keep 900ms debounce behavior)
2. Row-level `updated_at` on items
3. Pull on app resume / periodic reconcile
4. Offline queue with retry (already partially modeled by sync status UX)

---

## Possible database constraints (future)

- `NOT NULL` on `lists.account_id` after migration audit
- FK from `list_snapshots` to optional `list_id` for audit (breaking change — discuss first)
- Unique index on `(account_id, name)` for list names (optional)

---

## Checklist before production hardening

- [ ] Supabase Auth enabled
- [ ] RLS policies scoped to owner
- [ ] Service role only on server
- [ ] Edge Functions for metadata APIs
- [ ] Snapshot insert rate limits
- [ ] Privacy Policy + Terms published
- [ ] `schema.sql` aligned with migrations
- [ ] Anon key rotation plan documented
