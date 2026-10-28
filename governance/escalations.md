# Escalations (project-manager → portfolio-manager)

| ID | Date | Session/branch | Subject | Requested by | Status | Resolution |
|----|------|----------------|---------|--------------|--------|------------|
| E-001 | 2026-10-26 | claude/project-portfolio-managers-eynpup | CLAUDE.md conflicts with revos branch | project-manager | RESOLVED | Merge after revos; append governance section |
| E-002 | 2026-10-28 | claude/gemini-api-integration-1kmvul | New third-party service (Google Gemini via `@google/genai`) and new secret (`GEMINI_API_KEY`, server env only) for server-side show-insight narrative | project-manager | CONDITIONAL (resolved 2026-10-28; key provisioning + merge AWAITING OWNER) | Dependency `@google/genai` ^2.31.0 (Apache-2.0, server-side only) and secret *name* `GEMINI_API_KEY` in `.env.example` (empty value) and docs APPROVED with conditions C1–C7 in `governance/portfolio.md` Decision Log. Owner-reserved: provisioning any real key / accepting Google API terms, any spend beyond free tier, merge to `main`. |
