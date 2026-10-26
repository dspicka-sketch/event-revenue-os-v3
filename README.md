# Protect 104 N. Main Street

A private workspace for moving 104 N. Main Street (Sebastopol, CA) into community nonprofit
ownership. It keeps evidence, decisions, tasks, risks, stakeholders, funding and governance in one
place, and runs a chief-of-staff agent with seven specialists that **propose** findings for you to
review. Nothing is ever sent, published, signed or paid by this system.

> Status: built and tested locally. **Not yet deployed and not yet connected to a live model.**
> See `docs/acceptance-results.md` for exactly what has and hasn't been verified.

## Everyday use
- **Overview** — what changed, what needs you (max three actions), what is blocked, last briefing.
- **Evidence** — upload documents (stored privately), see each claim with its exact source and
  page, and which inherited findings still need their original retrieved.
- **Decisions** — open questions with alternatives; only you (owner) record accept/reject/defer.
- **Runs** — "What needs my attention?" or a focused question. Runs keep going if you close the page.
- **Review queue** — agent proposals become records only when you apply them; drafts need an
  approval that is tied to the exact text, and approval is not sending.
- Unknown money shows **Not established**, never $0. Prices are always dated observations.

## Try the demo (synthetic data, local only)
```bash
npm install
DEMO_MODE=1 npm run build && DEMO_MODE=1 npm start   # http://localhost:3000
```
A yellow banner marks demo mode. Demo runs use a fixture model that only restates recorded claims.

## Set up for real
Follow `docs/operations.md`: dedicated Supabase project → migrations → invite Daniel → owner
membership → seed baseline → Vercel env vars (`.env.example`) → optional `AGENT_MODEL`.

## Development
```bash
npm test                     # unit + orchestration
sudo service postgresql start && npm run test:db   # RLS, triggers, concurrency (local Postgres)
BASE_URL=http://localhost:3000 EXPECT_DEMO=1 npm run test:e2e
npm run roles:check
```
Docs: `docs/mission.md`, `docs/architecture.md`, `docs/evidence-baseline.md`, `docs/operations.md`.
