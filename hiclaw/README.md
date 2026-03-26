# HiClaw integration (Help & Grow)

Separate **Node service** (`hiclaw/service/`) that runs the offline-expert **shadow** pipeline: route mentee queries, optional **evaluator** loop, **session handoffs**, then **waiting room** for human expert review. Deploy beside the full [HiClaw](https://hiclaw.io/) stack or standalone on ECS / a laptop.

**Code map:** `src/manager.js` (orchestration) · `shadowWorker.js` (generator) · `evaluatorWorker.js` (quality gate) · `plannerWorker.js` (optional sprint contract) · `store.js` (persistence) · `waitingRoom.js` · `mem9Client.js` · `index.js` (Express).

---

## Session store: MySQL (TiDB) **or** PostgreSQL (DB9 / any Postgres)

The service uses **`store.js`**: if **`HICLAW_POSTGRES_URL`** or **`DB9_DATABASE_URL`** is set, it connects with **`pg`** (PostgreSQL). Otherwise it uses **`TIDB_DATABASE_URL`** with **mysql2**.

| Backend | Env var(s) | Schema file |
|--------|------------|-------------|
| PostgreSQL | `HICLAW_POSTGRES_URL` or `DB9_DATABASE_URL` | Apply [`schema-postgres.sql`](schema-postgres.sql) once on an empty DB |
| MySQL / TiDB | `TIDB_DATABASE_URL` | [`schema.sql`](schema.sql) and/or Vercel admin **Apply HiClaw schema** ([`src/lib/tidb-hiclaw-schema.ts`](../src/lib/tidb-hiclaw-schema.ts)) |

**TiDB Cloud Zero** (legacy path): instant MySQL-compatible DBs — [zero.tidbcloud.com](https://zero.tidbcloud.com/). Unclaimed instances expire (~30 days); **claim** for production. Same URL can feed this service and Vercel routes that touch HiClaw tables (`/admin/tidb`, `/api/webhook/onchain`, `/api/reputation/:expertId`) when you standardize on TiDB for those paths.

**DB9 / Postgres:** Prefer a Postgres URL from [db9.ai](https://db9.ai/) (or Supabase) for HiClaw-only storage to align with the core stack; provision DB9 via CLI/API without a browser claim step. The service uses the **standard Postgres driver**, not DB9’s HTTP SQL API (that remains an option for fully stateless agents).

**Tables:** `expert_status`, `sessions`, `waiting_room`, **`evaluator_critiques`**. Session rows support **`conversation_messages`**, **`handoff_artifact`**, **`mem9_profile_summary`** for multi-turn and context reset.

---

## Configuration

Copy [`.env.example`](.env.example) to `hiclaw/service/.env` (or use repo root env for Compose).

| Variable | Purpose |
|----------|---------|
| `TIDB_DATABASE_URL` | MySQL URL when Postgres vars are unset |
| `HICLAW_POSTGRES_URL` / `DB9_DATABASE_URL` | Postgres URL (either name; Postgres wins if set) |
| `DASHSCOPE_API_KEY` | Qwen-Max (shadow, evaluator, planner, handoff) |
| `MEM9_ENABLED` | Set `false` to skip mem9 fetches |
| `EVALUATOR_ENABLED` | Default on; `false` for single-pass drafts |
| `EVALUATOR_MIN_SCORE`, `EVALUATOR_MAX_ROUNDS` | Evaluator loop thresholds |
| `SHADOW_CONTEXT_WINDOW_TOKENS`, `SHADOW_CONTEXT_RESET_RATIO` | Token estimate and ~70% reset trigger |
| `HICLAW_EVALUATOR_TOOL_URL` | Optional POST `{ draft }` → `{ hint }` for evaluator context (e.g. MCP-style checks) |

---

## HTTP API (`POST /query`, etc.)

**`POST /query`** body (JSON):

- **Required:** `menteeId`, `expertId`, `query`
- **Optional:** `mem9SpaceId`, `expertName`, `continueSessionId` (resume thread; same mentee + expert), `sprintContract` (vetting/coaching bounds text), `autoSprintContract` + `sprintMode` (`vetting` \| `coaching`) to let `plannerWorker` draft a contract

**Flow (offline expert):** mem9 context → optional sprint contract → shadow generate → optional context reset + handoff persisted on `sessions` → evaluator loop (scores logged to `evaluator_critiques`) → enqueue **`waiting_room`**. Expert approves via **`POST /review/:draftId`**. Online experts are **forwarded** without generation (same as before).

Mentee-facing Telegram/WeChat sends happen **after** expert approval in product flows; the evaluator runs **before** the draft is queued so quality is gated upstream of those channels.

---

## Run locally

```bash
cd hiclaw/service
cp ../.env.example .env   # fill database URL + DASHSCOPE_API_KEY
npm install
npm start
```

Docker: [`docker-compose.yml`](docker-compose.yml) attaches to external network `hiclaw_default` when co-located with the HiClaw installer stack.

---

## Why on-chain reputation data may still use TiDB from Vercel

The **Next.js** app can keep using **`TIDB_DATABASE_URL`** for webhook/reputation paths while the **shadow service** uses **Postgres**—they are separate processes. For a **single** store, migrate both to the same DSN or consolidate tables into Supabase (product tradeoff). See original rationale below.

This is an **architecture choice**, not a requirement of TiDB or Postgres.

**Reasons the split existed:**

- **Separation of concerns** — Core marketplace in **Supabase**; agent sessions and chain-adjacent rows could evolve on MySQL.
- **Same engine as early HiClaw** — One SQL dialect for shadow + webhook updates.
- **Operational flexibility** — Move reputation sync to Postgres later if you want one DB.

---

## Links

- [TiDB Cloud Zero](https://zero.tidbcloud.com/)
- [HiClaw](https://hiclaw.io/)
- [db9.ai skill / API](https://db9.ai/skill.md)
- Design: [Harness + DB9 evaluation](../docs/design-docs/hiclaw-agent-harness-db9.md)
- Doc maintenance checklist: [documentation-maintenance.md](../docs/references/documentation-maintenance.md)
