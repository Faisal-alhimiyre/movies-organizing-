-- Fix import_jobs / import_items: meta column + RLS policies
-- Run once in: Supabase Dashboard → SQL Editor
-- (after migrate-import-jobs.sql; supersedes migrate-import-jobs-v2.sql)

-- 1) import_items.meta — extended row fields (type correction, retries, commit claims)
alter table public.import_items
  add column if not exists meta jsonb not null default '{}'::jsonb;

create index if not exists import_items_list_dup_idx
  on public.import_items (list_id, status)
  where status = 'duplicate';

-- 2) import_jobs RLS — mirror lists / watchlist_items (anon + authenticated, list-scoped)
drop policy if exists "import_jobs_select" on public.import_jobs;
drop policy if exists "import_jobs_insert" on public.import_jobs;
drop policy if exists "import_jobs_update" on public.import_jobs;
drop policy if exists "import_jobs_delete" on public.import_jobs;

create policy "import_jobs_select"
  on public.import_jobs for select to anon, authenticated
  using (true);

create policy "import_jobs_insert"
  on public.import_jobs for insert to anon, authenticated
  with check (
    exists (
      select 1
      from public.lists l
      where l.list_id = import_jobs.list_id
        and l.account_id = import_jobs.account_id
    )
  );

create policy "import_jobs_update"
  on public.import_jobs for update to anon, authenticated
  using (
    exists (
      select 1
      from public.lists l
      where l.list_id = import_jobs.list_id
        and l.account_id = import_jobs.account_id
    )
  )
  with check (
    exists (
      select 1
      from public.lists l
      where l.list_id = import_jobs.list_id
        and l.account_id = import_jobs.account_id
    )
  );

create policy "import_jobs_delete"
  on public.import_jobs for delete to anon, authenticated
  using (
    exists (
      select 1
      from public.lists l
      where l.list_id = import_jobs.list_id
        and l.account_id = import_jobs.account_id
    )
  );

-- 3) import_items RLS — child rows allowed when parent list exists
drop policy if exists "import_items_select" on public.import_items;
drop policy if exists "import_items_insert" on public.import_items;
drop policy if exists "import_items_update" on public.import_items;
drop policy if exists "import_items_delete" on public.import_items;

create policy "import_items_select"
  on public.import_items for select to anon, authenticated
  using (
    exists (
      select 1 from public.lists l where l.list_id = import_items.list_id
    )
  );

create policy "import_items_insert"
  on public.import_items for insert to anon, authenticated
  with check (
    exists (
      select 1 from public.lists l where l.list_id = import_items.list_id
    )
  );

create policy "import_items_update"
  on public.import_items for update to anon, authenticated
  using (
    exists (
      select 1 from public.lists l where l.list_id = import_items.list_id
    )
  )
  with check (
    exists (
      select 1 from public.lists l where l.list_id = import_items.list_id
    )
  );

create policy "import_items_delete"
  on public.import_items for delete to anon, authenticated
  using (
    exists (
      select 1 from public.lists l where l.list_id = import_items.list_id
    )
  );

-- Refresh PostgREST schema cache after column add
notify pgrst, 'reload schema';

-- Verify:
-- select column_name, data_type
-- from information_schema.columns
-- where table_schema = 'public' and table_name = 'import_items'
-- order by ordinal_position;
