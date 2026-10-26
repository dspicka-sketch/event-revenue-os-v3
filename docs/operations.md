# Operations

## First-time setup (live)
1. Create a **dedicated** Supabase project (do not reuse existing projects). Apply migrations in order:
   `supabase db push` or paste `supabase/migrations/*.sql` into the SQL editor.
2. Auth → disable public sign-ups; enable email OTP/magic link; set Site URL and redirect
   `https://<app>/auth/callback`.
3. Auth → Invite Daniel. After he signs in once, as the SQL editor (service) run:
   ```sql
   insert into public.projects (id, name, mission) values (gen_random_uuid(), 'Protect 104 N. Main Street', '<mission text from docs/mission.md>') returning id;
   insert into public.project_members (project_id, user_id, role) values ('<project id>', '<daniel user id>', 'owner');
   select public.seed_protect104_baseline('<project id>');
   ```
   (Or: owner opens Settings → "Seed inherited baseline".)
4. Vercel project env: see `.env.example`. Enable **Deployment Protection** for previews.
5. Agent runs: set `AGENT_MODEL` after evaluating candidate models; on Vercel the AI Gateway can use OIDC.
   No paid provider is enabled without Daniel's approval.

## Inviting others
Supabase Auth → Invite user, then Settings → Members with their user id (editor/viewer).
Editors cannot manage membership, record decisions or approve.

## Run recovery
- A run whose request was terminated keeps its completed jobs. The cron (`/api/worker/tick`,
  daily on Hobby; raise frequency on Pro) or the "Resume" button continues it.
- "Retry failed specialists only" re-queues failed/budget-skipped jobs; completed work is kept.
- Cancel sets `cancel_requested`; no new model or tool calls start.

## Backups and export
Supabase daily backups (plan dependent). Settings → Download export (JSON without signed URLs,
storage keys, extracted text or secrets). Re-import with `public.import_rows` (owner only).

## Security notes
- Browser never sees the service role. `DATABASE_URL` is server-only and used by the worker, which
  checks membership before acting and tags its audit rows `agent`.
- Set `DATABASE_CA_CERT` for verified TLS to Supabase Postgres.
- Uploads: allowlisted types, magic-byte checks, 25 MB cap, sha256 dedupe, private bucket, in-process
  text extraction only (no OCR; image PDFs fail visibly).
- No URL fetching is implemented, so there is no SSRF surface; any future web research tool must
  resolve and block private/internal addresses and re-check redirects.
