# HiClaw integration (Help & Grow)

Separate **Node service** (`hiclaw/service/`) that runs the offline-expert **shadow** pipeline: route mentee queries, optional **evaluator** loop, **session handoffs**, then **waiting room** for human expert review. Deploy beside the full [HiClaw](https://hiclaw.io/) stack or standalone on ECS / a laptop.

**Code map:** `src/manager.js` (orchestration) · `shadowWorker.js` (generator) · `evaluatorWorker.js` (quality gate) · `plannerWorker.js` (optional sprint contract) · `store.js` (persistence) · `waitingRoom.js` · `mem9Client.js` · `index.js` (Express).

---

## Session store: PostgreSQL (HTTP SQL or TCP `pg`)

The service uses **`store.js`**:

1. If **`DB9_HTTP_SQL_URL`** and a bearer token (**`DB9_HTTP_SQL_TOKEN`**, or `DB9_API_KEY`) are set, all queries go through that HTTP SQL API.
2. Otherwise it uses a **`pg`** pool with **`DB9_DATABASE_URL`** or **`HICLAW_POSTGRES_URL`**.

There is **no MySQL / mysql2** path in this service.

| Mode | Env var(s) | Schema |
|------|------------|--------|
| HTTP SQL | `DB9_HTTP_SQL_URL` + `DB9_HTTP_SQL_TOKEN` (or `DB9_API_KEY`) | Apply [`schema-postgres.sql`](schema-postgres.sql) on the backing Postgres |
| TCP Postgres | `DB9_DATABASE_URL` or `HICLAW_POSTGRES_URL` | Same |

**Next.js (Vercel)** uses the same logical database for HiClaw tables when syncing on-chain data and reputation: set **`HICLAW_POSTGRES_URL`** or **`DB9_DATABASE_URL`** (or a postgres-shaped **`TIDB_DATABASE_URL`** legacy name). Admin **HiClaw DB** is at `/admin/tidb`. See [postgres-cutover-runbook.md](../docs/exec-plans/active/postgres-cutover-runbook.md).

**Tables:** `expert_status`, `sessions`, `waiting_room`, **`evaluator_critiques`**. Session rows support **`conversation_messages`**, **`handoff_artifact`**, **`mem9_profile_summary`** for multi-turn and context reset.

---

## Configuration

Copy [`.env.example`](.env.example) to `hiclaw/service/.env` (or use repo root env for Compose).

| Variable | Purpose |
|----------|---------|
| `DB9_HTTP_SQL_URL` | Optional; HTTP SQL endpoint (with token) |
| `DB9_HTTP_SQL_TOKEN` / `DB9_API_KEY` | Bearer token for HTTP SQL |
| `HICLAW_POSTGRES_URL` / `DB9_DATABASE_URL` | TCP Postgres when not using HTTP SQL |

Plus: `DASHSCOPE_API_KEY`, `MEM9_ENABLED`, evaluator and shadow tuning vars as in `.env.example`.

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

## Links

- [HiClaw](https://hiclaw.io/)
- [db9.ai skill / API](https://db9.ai/skill.md)
- Design: [Harness + DB9 evaluation](../docs/design-docs/hiclaw-agent-harness-db9.md)
- Doc maintenance checklist: [documentation-maintenance.md](../docs/references/documentation-maintenance.md)
