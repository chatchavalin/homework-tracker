# Apply Supabase RLS fix (security advisor)

## What the email said
Critical: `rls_disabled_in_public` on project **homework-tracker**  
Anyone with the project URL + anon key could access tables because RLS was off.

## What we do
Run `migration_rls_family_app.sql` once in the SQL Editor.

It:
1. Enables (and forces) RLS on `tasks`, `exams`, `exam_topics`, `pending_intake`
2. Adds family-app policies for `anon` + `authenticated` so the existing PWA + Vercel functions keep working with the anon key

## Steps
1. Open: https://supabase.com/dashboard/project/fpdlavhnhqrjgwjoiboe/sql/new  
2. Paste the full contents of `migration_rls_family_app.sql`
3. Click **Run**
4. Re-check: https://supabase.com/dashboard/project/fpdlavhnhqrjgwjoiboe/advisors/security  
   The critical “RLS disabled” items for those tables should clear.

## Smoke test the app after
- Open https://ryujis-homework-tracker.vercel.app  
- Tasks still load  
- Toggle a task done  
- Open exam popup / edit an exam  

If anything fails with a permission error, re-run the migration (idempotent) and confirm policies exist.

## Honest security note
This fixes the **advisor critical** and is the correct first step.  
The anon key is still in the client (by design today), so the DB is still a **family shared key** model, not multi-user Auth. Tighter policies need Supabase Auth later.
