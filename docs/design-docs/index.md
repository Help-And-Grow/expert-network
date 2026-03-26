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
| [HiClaw harness + DB9](hiclaw-agent-harness-db9.md) | Accepted (phased) | 2026-03 | Generator/evaluator loop, handoffs, Postgres store option; Anthropic harness patterns |

## Adding a New Design Doc

1. Create a new `.md` file in this directory
2. Include: **Context**, **Options Considered**, **Decision**, **Consequences**
3. Add an entry to this index
4. Set status to `Draft` until reviewed
5. After implementation, add a **Status (verification)** block to the doc and update the index status
