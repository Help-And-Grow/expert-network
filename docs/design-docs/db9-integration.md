# DB9 integration — superseded

**Date:** 2026-04  
**Status:** Superseded by Supabase/Postgres-only architecture

This repository no longer uses DB9 in runtime code or deployment setup.

## Current database model

- **`DATABASE_URL`** points to the main Supabase Postgres instance for the marketplace app.
- **`HICLAW_POSTGRES_URL`** is optional for HiClaw. If unset, HiClaw routes and workers reuse `DATABASE_URL`.
- **HiClaw** applies [`hiclaw/schema-postgres.sql`](../../hiclaw/schema-postgres.sql) on standard Postgres and does not use a DB9-specific HTTP SQL path.

## Where to look now

- [postgres-cutover-runbook.md](../exec-plans/active/postgres-cutover-runbook.md) — current operational setup
- [hiclaw/README.md](../../hiclaw/README.md) — worker configuration
- [ARCHITECTURE.md](../../ARCHITECTURE.md) — current system map

## Historical note

Older commits evaluated DB9 as a Postgres option for HiClaw. That guidance is kept only so older branch history remains understandable. Do not use `DB9_DATABASE_URL`, `TIDB_DATABASE_URL`, or DB9 provisioning steps for new deployments.
