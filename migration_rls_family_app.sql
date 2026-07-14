-- Homework Tracker: enable RLS while keeping the family app working
-- Project: homework-tracker (fpdlavhnhqrjgwjoiboe)
--
-- Why: Supabase security advisor rls_disabled_in_public
--   "Table publicly accessible" — RLS not enabled on public tables.
--
-- Approach (safe for THIS personal app):
--   1) Enable RLS on all app tables used by the PWA + APIs
--   2) Add explicit policies for roles `anon` and `authenticated`
--      that allow the same CRUD the app already does with the anon key
--
-- Notes:
--   - This clears the CRITICAL "RLS disabled" advisor.
--   - Policies are intentionally permissive because the client + serverless
--     functions all use the public anon key (no per-user auth yet).
--   - True multi-tenant lockdown would need Auth + tighter policies later.
--   - Idempotent: safe to re-run.
--
-- Apply once in Supabase Dashboard → SQL Editor → Run.

BEGIN;

-- ── helpers ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ht_enable_rls_and_family_policies(tbl regclass)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  t text := tbl::text;                 -- e.g. public.tasks
  short text := split_part(t, '.', 2); -- tasks
  pol text;
BEGIN
  IF to_regclass(t) IS NULL THEN
    RAISE NOTICE 'skip missing table %', t;
    RETURN;
  END IF;

  EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', t);
  EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', t);

  -- Drop previous versions of our policies (idempotent re-run)
  FOR pol IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = short
      AND policyname LIKE 'ht_family_%'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %s', pol, t);
  END LOOP;

  -- anon (browser + Vercel ANON key)
  EXECUTE format(
    'CREATE POLICY ht_family_anon_all ON %s FOR ALL TO anon USING (true) WITH CHECK (true)',
    t
  );
  -- authenticated (if anyone later signs in with Supabase Auth)
  EXECUTE format(
    'CREATE POLICY ht_family_auth_all ON %s FOR ALL TO authenticated USING (true) WITH CHECK (true)',
    t
  );
  -- service_role bypasses RLS by default; no policy needed
END;
$$;

-- ── app tables ───────────────────────────────────────────────────────
SELECT public.ht_enable_rls_and_family_policies('public.tasks');
SELECT public.ht_enable_rls_and_family_policies('public.exams');
SELECT public.ht_enable_rls_and_family_policies('public.exam_topics');
SELECT public.ht_enable_rls_and_family_policies('public.pending_intake');

-- Keep grants that PostgREST already expects (no-op if already granted)
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO anon, authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO anon, authenticated;

COMMIT;

-- Optional verification (run after):
-- SELECT c.relname AS table, c.relrowsecurity AS rls_enabled, c.relforcerowsecurity AS rls_forced
-- FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
-- WHERE n.nspname = 'public' AND c.relkind = 'r'
--   AND c.relname IN ('tasks','exams','exam_topics','pending_intake')
-- ORDER BY 1;
--
-- SELECT tablename, policyname, roles, cmd
-- FROM pg_policies
-- WHERE schemaname = 'public' AND policyname LIKE 'ht_family_%'
-- ORDER BY 1,2;
