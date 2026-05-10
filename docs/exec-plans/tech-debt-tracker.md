# Tech Debt Tracker

Track known technical debt items, their impact, and resolution priority. Cross-references the canonical docs where the item is expanded — this file is the rolling registry, not the discussion.

## Priority Legend
- **P0**: Blocking — must fix before next release
- **P1**: High — fix within current sprint
- **P2**: Medium — schedule for near-term
- **P3**: Low — fix when convenient

## Active Debt

| ID | Priority | Domain | Description | Impact | Cross-ref | Created | Updated |
|----|----------|--------|-------------|--------|-----------|---------|---------|
| TD-001 | P1 | Testing | Critical-path coverage is still thin despite Playwright smoke coverage | Voice / payment / booking regressions can still escape | [QUALITY_SCORE.md](../QUALITY_SCORE.md#action-items), [API.md contracts](../API.md#contract-assertions) | 2026-03 | 2026-04-26 |
| TD-002 | P1 | API | Zod validation is partial; high-risk booking, voice chat, Telegram auth, and WeChat auth routes are covered first | Lower-risk routes can still pass invalid data inward | [QUALITY_SCORE.md](../QUALITY_SCORE.md#action-items) | 2026-03 | 2026-04-26 |
| TD-003 | P2 | Observability | Structured request logs exist for selected booking / voice routes only; OTel via `@vercel/otel` is wired but no metrics or trace backend | Debugging uneven outside critical paths | [RELIABILITY.md](../RELIABILITY.md#monitoring) | 2026-03 | 2026-04-26 |
| TD-005 | P2 | Payments | TON payments require manual confirmation, no refund flow | Poor user experience | [QUALITY_SCORE.md domain grades](../QUALITY_SCORE.md#domain-grades) | 2026-03 | — |
| TD-006 | P3 | WeChat Pay | Webhook not yet routinely tested in production | May fail on real payments | [QUALITY_SCORE.md domain grades](../QUALITY_SCORE.md#domain-grades) | 2026-03 | — |
| TD-007 | P3 | Frontend | No loading states on some web pages | Perceived performance issues | — | 2026-03 | — |
| TD-008 | P2 | API | Rate limiting is in-memory and per-instance; no durable / global limiter yet | Abuse / cost protection is incomplete on serverless scale-out | [SECURITY.md rate limiting](../SECURITY.md#rate-limiting) | 2026-03 | 2026-04-26 |
| TD-010 | P3 | Migrations | Production builds auto-resolve Prisma error **P3005** by applying baseline `20260424120000_baseline` from [`scripts/prisma-migrate-if-vercel.mjs`](../../../scripts/prisma-migrate-if-vercel.mjs) | Useful safety net for fresh Postgres deploys; shouldn't be load-bearing forever — masks drift if a real schema mismatch appears | [RELIABILITY.md migration safety net](../RELIABILITY.md#migration-safety-net), [postgres-cutover-runbook.md](active/postgres-cutover-runbook.md) | 2026-04-26 | 2026-04-26 |
| TD-011 | P2 | Migrations | The auto-baseline script hard-codes the baseline migration name (`20260424120000_baseline`) | Renaming or rebuilding the baseline silently breaks Vercel deploys | [`scripts/prisma-migrate-if-vercel.mjs`](../../../scripts/prisma-migrate-if-vercel.mjs) | 2026-04-26 | 2026-04-26 |
| TD-012 | P2 | API | `/api/v1/*` public namespace is auth-free by design — agent / skill consumption | PII or rate-cost leak risk if a non-GET or sensitive field is added without review | [SECURITY.md known gaps](../SECURITY.md#known-gaps), [API.md public](../API.md#public-api-apiv1--auth-free-get) | 2026-04-26 | 2026-04-26 |

## Resolved Debt

| ID | Resolution | Date |
|----|-----------|------|
| TD-000 | Stripe webhook secret mismatch — fixed by correcting Vercel env var | 2026-03-19 |
| TD-004 | Debug routes now require admin auth; production debug reads require `DEBUG_API_ENABLED=1`; destructive debug mutations require `DEBUG_MUTATION_ENABLED=1` | 2026-04-22 |
| TD-009 | GitHub Actions workflows re-enabled (commit `27f2570`) after the Action-minute quota window reset; `if: false` guards from commit `db60842` removed | 2026-05-05 |

## Conventions

- Add a row when the debt is real, named, and someone can recognize it without context.
- Cross-ref column points to the doc where the item is **expanded** — keep the description here short.
- Bump the **Updated** column whenever the description, priority, or cross-ref changes.
- Move items to **Resolved Debt** with a one-line resolution and date when closed.
