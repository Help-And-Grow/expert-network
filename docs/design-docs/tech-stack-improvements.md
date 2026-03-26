# Tech Stack Improvement Suggestions

**Scope:** Help & Grow — AI Native Expert Network  
**Date:** 2026-03  
**Status:** Open for review

---

## Context

This document captures architectural and tech stack improvement suggestions based on a review of the current codebase. Items are ordered by priority: high-impact / low-risk changes first, then medium-term improvements, then longer-term considerations.

---

## 1. Upgrade NextAuth v4 → v5 (Auth.js)  ★ High Priority

**Current state:** The app uses `next-auth@4.x`, which is in maintenance mode. It has known friction points with the Next.js App Router (session access in Server Components requires a workaround through `getServerSession`), and it does not support Edge Runtime.

**Recommendation:** Migrate to `next-auth@5` (Auth.js). Benefits:
- First-class App Router support — `auth()` works in Server Components and Route Handlers without `getServerSession`
- Edge-compatible sessions (useful for middleware-level auth checks)
- Cleaner config structure with type-safe providers

**Risk / effort:** Medium. The API surface changes meaningfully — provider config, callbacks, and session typing all shift. The existing `resolveUserId()` multi-platform auth layer in `src/lib/request-auth.ts` is a clean abstraction that will contain the blast radius. Plan a dedicated migration sprint rather than doing it incrementally.

**References:** [Auth.js v5 migration guide](https://authjs.dev/getting-started/migrating-to-v5)

---

## 2. Consolidate to a Single Database (PostgreSQL)  ★ High Priority

**Current state:** The stack runs two databases that can diverge:
- **Supabase PostgreSQL** — core marketplace (Users, Experts, Bookings, Reviews, etc.)
- **TiDB Cloud Zero (MySQL)** — HiClaw agent sessions (`sessions`, `waiting_room`, `evaluator_critiques`, `expert_status`)
- **DB9 (Postgres)** — supported as an alternative for HiClaw via `HICLAW_POSTGRES_URL` / `DB9_DATABASE_URL`, but not yet default

This split means:
- Two SQL dialects (MySQL `ON DUPLICATE KEY UPDATE` vs Postgres `ON CONFLICT ... DO UPDATE`) in `store.js`
- The `switch-db.mjs` script patches `schema.prisma` at build time — fragile
- Schema drift risk between the two stores
- Higher cognitive load for AI agents operating across the stack

**Recommendation:** Standardize everything on PostgreSQL:

1. **HiClaw → DB9 or Supabase:** Set `DB9_DATABASE_URL` or `HICLAW_POSTGRES_URL` and apply `hiclaw/schema-postgres.sql`. The driver selection in `store.js` already supports this.
2. **Retire TiDB:** Once HiClaw is on Postgres, remove the `mysql2` path from `store.js`, the `switch-db.mjs` script, and the `@prisma/adapter-mariadb` dependency.
3. **Single Prisma schema:** With one dialect, the runtime adapter switching in `src/lib/prisma.ts` simplifies to a single `@prisma/adapter-pg` path.

### Why DB9 specifically for the agent layer

DB9 is worth evaluating as the dedicated store for the HiClaw / agent subsystem beyond just being "another Postgres":

| Feature | Relevance |
|---|---|
| **HTTP SQL API** (`POST /databases/{id}/sql`) | Agents query and mutate data statelessly over HTTP — no TCP connection pool management, works in serverless and edge functions |
| **Autonomous provisioning** (REST API) | Agents can spin up, branch, and tear down databases programmatically without a browser "claim" step (unlike TiDB Cloud Zero) |
| **`pgvector` built-in** | Directly replaces or augments mem9 for storing expert memory embeddings natively in the same DB — no external vector store needed |
| **`fs9` extension** | Agents can query JSONL/CSV files or write structured output from SQL — useful for batch evaluation result storage |
| **`pg_cron`** | Background tasks (session cleanup, scheduled evaluations) without a separate job runner |

The driver wiring is already done in `store.js` — it's an environment variable away.

**References:** `hiclaw/README.md`, `docs/design-docs/hiclaw-agent-harness-db9.md`, [db9.ai](https://db9.ai/skill.md)

---

## 3. Add Startup Environment Validation  ★ High Priority

**Current state:** Missing environment variables surface as cryptic runtime errors mid-request (a database query fails with a connection error, an AI call 500s, a Stripe webhook silently drops). There is no fail-fast mechanism.

**Recommendation:** Add a `src/lib/env.ts` module that validates all required environment variables at startup using Zod:

```ts
// src/lib/env.ts
import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  NEXTAUTH_URL: z.string().url(),
  NEXTAUTH_SECRET: z.string().min(32),
  // ... other required vars
});

export const env = envSchema.parse(process.env);
```

Import `env` from this module everywhere instead of using `process.env` directly. Startup fails immediately with a clear message listing every missing variable rather than a mystery 500 at runtime.

**Effort:** Low. Zod is already transitively available. One module, one import sweep.

---

## 4. Replace Ad-hoc Cron with a Proper Job Queue  ★ Medium Priority

**Current state:** Background work is handled in two ways:
- `/api/cron` — called by Vercel Cron (not called by anything on Replit)
- Fire-and-forget `.catch(() => {})` calls for mem9 writes, POMP attestations, and email sends

Both approaches lack retries, visibility, and rate limiting.

**Recommendation:** Adopt [Inngest](https://www.inngest.com/) or [Trigger.dev](https://trigger.dev/). Both:
- Work with Next.js API routes natively (one endpoint, all jobs routed through it)
- Provide retries, dead-letter queues, and a dashboard
- Replace Vercel Cron with their own scheduler (works on any host, including Replit)
- Are free at low volume

Move the following into managed jobs:
- Stripe remainder charging (currently in `/api/cron`)
- POMP attestation minting (currently fire-and-forget in booking completion)
- mem9 lifecycle writes (currently fire-and-forget throughout)
- Email send retries

**Effort:** Medium. The logic already exists — it's a routing and wrapper change.

---

## 5. Wire the DB9 HTTP SQL API for Stateless Agent Queries  ★ Medium Priority

**Current state:** `store.js` uses the standard `pg` connection pool driver even when pointed at DB9. This works, but means agents managing long-running async sessions must hold or re-establish TCP connections.

**Recommendation:** Add an optional HTTP SQL execution path to `store.js`:

```js
// If DB9_DATABASE_HTTP_URL is set, use the REST API instead of pg pool
async function executeHttp(sql, params) {
  const res = await fetch(`${process.env.DB9_DATABASE_HTTP_URL}/sql`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${process.env.DB9_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql, params }),
  });
  const { rows } = await res.json();
  return rows;
}
```

This is the design described but not yet implemented in `docs/design-docs/hiclaw-agent-harness-db9.md` ("DB9 HTTP SQL API only (stateless) — Not implemented"). It's the correct end state for agents that spawn asynchronously and cannot own a connection pool.

**Effort:** Low. The store abstraction is already there — it's a new execution branch.

---

## 6. Adopt React Query Consistently or Remove It  ★ Medium Priority

**Current state:** `@tanstack/react-query` is installed and `QueryClientProvider` is in the providers tree, but the majority of data fetching uses `fetch` directly in `useEffect` hooks or Server Components. React Query is only used in a few places.

**Recommendation:** Make a deliberate choice:

- **Go all-in:** Migrate client-side data fetching to `useQuery` / `useMutation`. You get caching, background refetch, optimistic updates, and loading/error states for free. Particularly valuable for the booking flow and expert discovery page where stale data causes UX bugs.
- **Remove it:** If Server Components handle most data, remove the package to reduce bundle size and the `QueryClientProvider` wrapper.

The hybrid state is the worst of both worlds — the bundle weight without the benefit.

---

## 7. Replace `mem9` with Native `pgvector` on DB9  ★ Medium Priority (longer-term)

**Current state:** Expert memory is stored in an external service ([mem9.ai](https://mem9.ai)). All calls are fire-and-forget to avoid blocking primary flows. This introduces:
- An external dependency with its own uptime, rate limits, and API changes
- Latency on memory search injected into AI prompts
- No visibility into what's stored (no query UI)

**Recommendation:** Since DB9 ships with `pgvector` natively, expert memory embeddings could live in the same database as the rest of the agent data:

```sql
-- In hiclaw/schema-postgres.sql
CREATE TABLE expert_memories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  expert_id TEXT NOT NULL,
  content TEXT NOT NULL,
  embedding vector(1536),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX ON expert_memories USING ivfflat (embedding vector_cosine_ops);
```

Memory search becomes a `SELECT ... ORDER BY embedding <-> $1 LIMIT 10` query — no external API, no rate limit, no additional latency hop.

This is a meaningful architectural simplification, but requires generating embeddings (Gemini / OpenAI embeddings API) and migrating existing mem9 data. Treat as a follow-up once DB9 is confirmed as the agent store.

---

## 8. Add tRPC for the API Layer  ★ Lower Priority

**Current state:** API routes follow a consistent pattern (parse → validate → call service → return JSON), but the shape of responses is inferred by the frontend using manual type casting or implicit assumptions. Type drift between server and client is a recurring source of bugs.

**Recommendation:** Adopt [tRPC](https://trpc.io/). It provides:
- End-to-end TypeScript type safety between API and UI — no code generation step
- Input validation via Zod (which the codebase already uses in places)
- Eliminates the manual `fetch` + type assertion pattern across client components

The service layer (`src/lib/`) is already framework-agnostic (as per the architecture rules), which makes it straightforward to wrap in tRPC procedures without restructuring business logic.

**Effort:** Medium-high. A significant portion of the API surface would need migrating, best done domain by domain.

---

## 9. Address npm Vulnerability Backlog  ★ Lower Priority (but do soon)

**Current state:** `npm install` reports 108 vulnerabilities (18 low, 20 moderate, 30 high, 40 critical). Many are likely transitive from build tooling (particularly `miniprogram-ci` for WeChat).

**Recommendation:**
1. Run `npm audit --json > audit.json` and categorize: build-time-only vs runtime-reachable
2. Fix all runtime-reachable high/critical issues immediately (`npm audit fix`)
3. For `miniprogram-ci` transitive issues: consider isolating WeChat tooling into a separate `package.json` in the `wechat/` directory so it doesn't pollute the main app's audit surface
4. Add `npm audit --audit-level=high` to CI to prevent regressions

---

## 10. Formalize the WeChat Mini Program as a Proper Sub-package  ★ Lower Priority

**Current state:** The WeChat Mini Program lives in `wechat/` with its own `package.json` but shares types and constants informally with the main app (copy-paste rather than imports).

**Recommendation:** Extract shared types (expert profile shape, booking response, etc.) into a `packages/shared` workspace that both the Next.js app and WeChat build can import. This prevents drift where a backend API change breaks the WeChat client silently because the types were copied rather than shared.

**Effort:** Medium. Requires setting up an npm workspace or turborepo structure.

---

## Summary Table

| # | Suggestion | Priority | Effort |
|---|---|---|---|
| 1 | NextAuth v4 → v5 | High | Medium |
| 2 | Consolidate to single PostgreSQL (DB9 for agent layer) | High | Medium |
| 3 | Startup env validation (Zod) | High | Low |
| 4 | Job queue for async work (Inngest / Trigger.dev) | Medium | Medium |
| 5 | DB9 HTTP SQL API for stateless agent queries | Medium | Low |
| 6 | React Query: go all-in or remove | Medium | Low–Medium |
| 7 | Replace mem9 with native pgvector on DB9 | Medium | High |
| 8 | tRPC for end-to-end type safety | Lower | High |
| 9 | npm vulnerability audit & fix | Lower (urgent) | Low |
| 10 | WeChat as a proper shared-types sub-package | Lower | Medium |
