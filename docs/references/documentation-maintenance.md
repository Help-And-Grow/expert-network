# Documentation maintenance (key changes)

Use this checklist when a change is **user-visible**, **operational**, or **architectural**. Goal: keep [AGENTS.md](../../AGENTS.md) accurate as a map, and keep domain docs honest—without turning every README into an encyclopedia.

## When to update docs (triggers)

Update documentation in the same change (or immediately after) if you:

| Trigger | Typical updates |
|--------|------------------|
| **New or removed env vars** | `.env.example`, `hiclaw/.env.example`, relevant README, optional [AGENTS.md](../../AGENTS.md) if widely used |
| **API or HTTP contract** | Route comments, domain README, product spec if one exists |
| **Database / DDL** | `prisma/` notes if applicable, `hiclaw/schema*.sql`, `src/lib/tidb-hiclaw-schema.ts`, admin tools that apply schema |
| **New services, workers, or boundaries** | [ARCHITECTURE.md](../../ARCHITECTURE.md), [AGENTS.md](../../AGENTS.md) “Where to look” / conventions |
| **Design decision implemented or superseded** | Matching file under [docs/design-docs/](../design-docs/) — add **Status** and **Implemented in** (paths, dates) |
| **Security / auth / secrets** | [docs/SECURITY.md](../SECURITY.md) if behavior changes |

You can **skip** doc updates for pure refactors, renames with no behavior change, or typo-only fixes—unless they affect agent navigation (e.g. moved entry points).

## Where to update (minimal sufficient set)

1. **[AGENTS.md](../../AGENTS.md)** — Table of contents only: new pointers, corrected facts, “Where to look” rows. Keep it short.
2. **Domain README** — e.g. `hiclaw/README.md` for the shadow service; `contracts/README` for Foundry if you touch deploy.
3. **[ARCHITECTURE.md](../../ARCHITECTURE.md)** — When system boundaries, data stores, or major flows change.
4. **Design doc** — Mark decisions **Proposed** / **Implemented** / **Superseded** with links to code.
5. **`docs/references/`** — Durable playbooks (like this file) you want other repos or future agents to reuse.

## Conventions

- **Progressive disclosure**: AGENTS.md links outward; deep detail lives in `docs/` or package READMEs.
- **Single source of truth**: Prefer one authoritative README per deployable (e.g. HiClaw under `hiclaw/`), not scattered duplicates.
- **Verification**: For design docs, add a short “Verification / status” block after implementation so agents do not re-plan completed work.

## Reuse in other projects

Copy this file to `docs/references/documentation-maintenance.md` (or your repo’s equivalent) and add one bullet to the project’s agent entry file (e.g. `AGENTS.md` or `CONTRIBUTING.md`) pointing here. Optionally add a Cursor rule (see `.cursor/rules/documentation-maintenance.mdc` in this repo) so editors remind agents to update docs with key changes.
