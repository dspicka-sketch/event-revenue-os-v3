# Escalations (project-manager → portfolio-manager)

| ID | Date | Session/branch | Subject | Requested by | Status | Resolution |
|----|------|----------------|---------|--------------|--------|------------|
| E-001 | 2026-10-26 | claude/project-portfolio-managers-eynpup | CLAUDE.md conflicts with revos branch | project-manager | RESOLVED | Merge after revos; append governance section |
| E-004 | 2026-11-16 | claude/autorev-sprint-1 | AutoRev (D19) pulls scheduled sync ahead of the adopted sprint order and edits `src/server/app.ts`, `vercel.json` and shared docs that PR #5 and the On The Stage branch also edit. Decision numbers D17/D18 exist only on those branches. | session (no PM agent available) | OPEN | Needs a merge order from the portfolio-manager and the owner |
| E-005 | 2026-11-25 | claude/candidates-screen | Owner-approved preview environment: paid Supabase project `revos`, new server secrets and accounts, and Vercel env vars set on the production target as well as preview, so production would read the preview database if deployed. Also add this branch to E-004 (stacked on `claude/autorev-sprint-1`). | project-manager | OPEN | Awaiting portfolio-manager; no production deploy or merge until decided |
