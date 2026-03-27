# Tech stack improvements — task tracker (for a solo PM)

This file turns [tech-stack-improvements.md](../../design-docs/tech-stack-improvements.md) into **small steps** you can approve one at a time. You do **not** need to understand the technology — each row says **what it means for the product** and **status**.

**How to use:** Work top to bottom. When a row is “Done”, the risk called out in the design doc is reduced for that area. Larger rows (NextAuth v5, one database) deserve a **dedicated week** or help from a contractor — don’t rush them between launches.

---

## Legend

| Status | Meaning |
|--------|---------|
| **Done** | Implemented in the repo; still verify on staging when you deploy |
| **Next** | Recommended next piece of work |
| **Planned** | Agreed direction; not started |
| **Optional** | Nice to have; skip if time is tight |

---

## Tasks

| # | Task (technical name) | In plain English | Status |
|---|------------------------|------------------|--------|
| 3 | Startup env validation | **If production is missing critical settings** (database URL, auth secret), the app **fails immediately with a clear error** instead of random “500” errors later. Safer deploys for you as the only owner. | **Done** — see `src/lib/env.ts`, wired from `src/lib/prisma.ts` |
| 9 | npm audit / supply chain | **Reduce known security issues** in dependencies; separate WeChat build tools from the main app if needed so audits are honest. | Planned |
| 1 | NextAuth v4 → v5 | **Modern login stack** for Next.js; fewer edge cases as the framework evolves. **Medium risk** — needs a focused pass on “sign in with Google / email” after the change. | Planned |
| 2 | One PostgreSQL database | **One place for data** instead of MySQL (HiClaw) + Postgres (main app). Less confusion, fewer “wrong database” mistakes. **Requires** deciding: Supabase vs DB9 for agent sessions, then migrating HiClaw off TiDB. | Planned |
| 4 | Job queue (e.g. Inngest) | **Background work** (Stripe remainder charges, emails, minting) gets **retries and a dashboard** instead of “fire and forget” only. Better when something fails overnight. | Planned |
| 5 | DB9 HTTP SQL (HiClaw) | **Optional advanced path** for agents talking to the database over HTTP instead of a long-lived connection. Only matters once HiClaw runs on DB9 and you want that model. | Planned |
| 6 | React Query: all-in or remove | **Pick one pattern** for loading data in the browser — either use the tool everywhere it helps, or remove it to shrink the app. Stops “half adopted” complexity. | Planned |
| 7 | mem9 → pgvector on DB9 | **Long-term:** store expert memory embeddings **inside your own Postgres** instead of only an external service. Big migration; do after DB strategy is stable. | Optional |
| 8 | tRPC | **Stronger typing** between UI and API — fewer “frontend assumed wrong shape” bugs. Large refactor; low urgency early on. | Optional |
| 10 | WeChat shared package | **Same types** for web app and WeChat mini program so a backend change doesn’t silently break WeChat. | Optional |

---

## Progress log

| Date | Note |
|------|------|
| 2026-03-24 | **Task 3:** Added `src/lib/env.ts` — validates `DATABASE_URL`, `NEXTAUTH_URL`, `NEXTAUTH_SECRET` in **production** only; set `SKIP_ENV_VALIDATION=1` only if a host explicitly needs to bypass (not recommended on Vercel). |
| 2026-03-24 | Listed **agentic-methodology-best-practices.md** in design-docs `index.md`; created this tracker. |

---

## When you hire a developer or use Cursor

- Point them at **this file** + **tech-stack-improvements.md**.
- Ask for **one task per PR** when possible.
- After **Task 1 (NextAuth v5)** or **Task 2 (one DB)**, schedule **manual testing**: sign-in, one booking, one payment path.
