# Event Revenue OS v3 — Claude Code guidance

## Governance (applies to every session)
- At the start of each session, invoke the `project-manager` subagent to open/update this
  session's charter in `governance/sessions/<branch>.md`. It approves decisions within the
  session's scope and logs them.
- Anything cross-session, shared, architectural, or high-risk is escalated to the
  `portfolio-manager` subagent, which decides portfolio-wide and logs to `governance/portfolio.md`.
- Production deploys, spend, secrets, legal commitments, and merges to `main` are recommended
  by the agents but decided by the human owner.
- Authority definitions: `.claude/agents/project-manager.md`, `.claude/agents/portfolio-manager.md`.
