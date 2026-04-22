# Tech Debt Tracker

Track known technical debt items, their impact, and resolution priority.

## Priority Legend
- **P0**: Blocking — must fix before next release
- **P1**: High — fix within current sprint
- **P2**: Medium — schedule for near-term
- **P3**: Low — fix when convenient

## Active Debt

| ID | Priority | Domain | Description | Impact | Created |
|----|----------|--------|-------------|--------|---------|
| TD-001 | P1 | Testing | Critical-path coverage is still thin despite Playwright smoke coverage | Voice/payment/booking regressions can still escape | 2026-03 |
| TD-002 | P1 | API | Zod validation is partial; high-risk booking, voice chat, Telegram auth, and WeChat auth routes are covered first | Lower-risk routes can still pass invalid data inward | 2026-03 |
| TD-003 | P2 | Observability | Structured request logs exist for selected booking/voice routes only | Debugging is still uneven outside critical paths | 2026-03 |
| TD-005 | P2 | Payments | TON payments require manual confirmation | Poor user experience | 2026-03 |
| TD-006 | P3 | WeChat Pay | Webhook not tested in production | May fail on real payments | 2026-03 |
| TD-007 | P3 | Frontend | No loading states on some web pages | Perceived performance issues | 2026-03 |
| TD-008 | P2 | API | Rate limiting is partial and in-memory; no durable/global limiter yet | Abuse/cost protection is incomplete on serverless scale-out | 2026-03 |

## Resolved Debt

| ID | Resolution | Date |
|----|-----------|------|
| TD-000 | Stripe webhook secret mismatch — fixed by correcting Vercel env var | 2026-03-19 |
| TD-004 | Debug routes now require admin auth; production debug reads require `DEBUG_API_ENABLED=1`; destructive debug mutations require `DEBUG_MUTATION_ENABLED=1` | 2026-04-22 |
