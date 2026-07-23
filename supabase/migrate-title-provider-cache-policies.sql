-- title_provider_cache RLS policies
-- Run once in: Supabase Dashboard -> SQL Editor
-- (table already created by migrate-anime-title-index.sql, but RLS was
-- enabled there with no policies — meaning every client request was
-- silently denied. This table holds no personal data: it's a shared,
-- app-owned cache of AniList details (poster/genres/badges) keyed by
-- provider + provider_id, used to avoid refetching the same title from
-- AniList across imports/users. Open policies here match the existing
-- security model used for lists/watchlist_items/accounts in schema.sql —
-- see the project-roadmap rule: auth/RLS hardening is deferred to Phase 4.

drop policy if exists "title_provider_cache_select" on public.title_provider_cache;
create policy "title_provider_cache_select"
  on public.title_provider_cache for select to anon, authenticated
  using (true);

drop policy if exists "title_provider_cache_insert" on public.title_provider_cache;
create policy "title_provider_cache_insert"
  on public.title_provider_cache for insert to anon, authenticated
  with check (true);

drop policy if exists "title_provider_cache_update" on public.title_provider_cache;
create policy "title_provider_cache_update"
  on public.title_provider_cache for update to anon, authenticated
  using (true) with check (true);
