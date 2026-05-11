# Design Documents Index

Design docs capture significant architectural and product decisions. Each doc includes context, decisions made, and verification status.

## Documents

| Doc | Status | Date | Summary |
|-----|--------|------|---------|
| [Architecture](architecture.md) | Accepted | 2026-04 | Tri-cloud (GCP + Vercel + Tencent), AI stack with **Gemini-default** routing, storage abstraction, multi-platform auth |
| [Product Features](product-features.md) | Accepted (mixed phases) | 2026-04 | Payments (Stripe/TON/WeChat Pay), Premium Live Consultation (TRTC), Telegram profile sharing (self + friend-to-friend), pluggable expert avatar control plane |
| [Agent Memory and Search Stack](agent-memory-search-stack.md) | Accepted (phased) | 2026-05 | Lego-block architecture for Postgres, pgvector, mem9 v1alpha2, future Zilliz vector indexing, and DB9 agent workspaces |
| [Operations](operations.md) | Accepted (living) | 2026-04 | Engineering principles, mem9/Postgres data layer, background-job choices, Vercel defaults, dependency posture, live tech-debt punch list |

Open task tracker (PM-facing): [`../exec-plans/active/tech-stack-improvements-tasks.md`](../exec-plans/active/tech-stack-improvements-tasks.md).

## Status Legend

- **Accepted**: Decision made and implemented
- **Accepted (phased)**: Core implemented; follow-up items documented in the same file
- **Accepted (living)**: Decisions hold; specific punch-list items rotate
- **Draft**: Under discussion
- **Superseded**: Replaced by a newer decision

## Adding a New Design Doc

1. First — try to fit the change into one of the four existing docs. The folder is intentionally small.
2. If you genuinely need a new doc: include **Context**, **Decision**, **Consequences**, and link from this index.
3. Set status to `Draft` until editorial sign-off.
4. After implementation, add a **Status (verification)** block and update the index status.
