# Design Documents Index

Design docs capture significant architectural and product decisions. Each doc should include context, options considered, decision made, and verification status.

## Status Legend

- **Accepted**: Decision made and implemented
- **Accepted (phased)**: Core implemented; follow-up items documented in the same file
- **Draft**: Under discussion
- **Superseded**: Replaced by a newer decision

## Documents

| Doc | Status | Date | Summary |
|-----|--------|------|---------|
| [Core Beliefs](core-beliefs.md) | Accepted | 2026-03 | Agent-first operating principles |
| [Multi-Platform Auth](multi-platform-auth.md) | Accepted | 2026-03 | Unified auth across Web, Telegram, WeChat |
| [Payment Architecture](payment-architecture.md) | Accepted | 2026-03 | Stripe + TON + WeChat Pay with double-write pattern |
| [AI Provider Abstraction](ai-provider-abstraction.md) | Accepted | 2026-03 | Swappable AI providers via factory pattern |
| [HiClaw harness + Postgres](hiclaw-agent-harness-db9.md) | Accepted (phased) | 2026-04 | Generator/evaluator loop, handoffs, and the current Postgres-backed HiClaw store |
| [DB9 integration (historical)](db9-integration.md) | Superseded | 2026-04 | Archived background only; current deployments use Supabase/Postgres without DB9 |
| [Agentic methodology (best practices)](agentic-methodology-best-practices.md) | Accepted | 2026-03 | How HiClaw applies harness ideas (handoffs, evaluator, sprint contracts); companion to harness doc |
| [Tech Stack Improvements](tech-stack-improvements.md) | Accepted (phased) | 2026-04 | mem9 + Supabase/Postgres posture, Inngest vs FC, tRPC inventory, and operational follow-ups |
| [Pluggable expert avatar control plane](pluggable-expert-avatar-control-plane.md) | Accepted (phased) | 2026-04 | Capability fabric + HiClaw / Scion / local fallback routing model for future expert services |
| [npm audit (production)](npm-audit-production.md) | Accepted | 2026-03 | Triaged prod deps: overrides, EAS/Hardhat transitive risk, CI artifact — companion to tech-stack §3.2 |
| [Vercel best practices](vercel-best-practices.md) | Accepted | 2026-03 | Platform defaults for this repo (functions, regions, Cron, Blob, AI Gateway, OTEL, etc.); env CLI/checklist cross-linked from tech-stack doc §4 |
| [Tech stack tasks (PM tracker)](../exec-plans/active/tech-stack-improvements-tasks.md) | Active | 2026-03 | **Open tasks only** — links to main doc for strategy |

## Adding a New Design Doc

1. Create a new `.md` file in this directory
2. Include: **Context**, **Options Considered**, **Decision**, **Consequences**
3. Add an entry to this index
4. Set status to `Draft` until editorial sign-off
5. After implementation, add a **Status (verification)** block to the doc and update the index status
