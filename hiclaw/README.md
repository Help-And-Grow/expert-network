# HiClaw integration (Help & Grow)

Separate **Node service** (`hiclaw/service/`) that runs the offline-expert **shadow** pipeline: route **player** queries (JSON field `menteeId`), optional **evaluator** loop, **session handoffs**, then **waiting room** for human expert **approval**. Deploy beside the full [HiClaw](https://hiclaw.io/) stack or standalone on ECS / a laptop. Product copy: [docs/BRAND.md](../docs/BRAND.md) (**meetup**, **appreciation**, coach/player).

**Code map:** `src/manager.js` (orchestration) · `shadowWorker.js` (generator) · `evaluatorWorker.js` (quality gate) · `plannerWorker.js` (optional sprint contract) · `store.js` (persistence) · `waitingRoom.js` · `mem9Client.js` · `index.js` (Express).

---

## Session store: PostgreSQL only

The service uses **`store.js`**:

1. If **`HICLAW_POSTGRES_URL`** is set, HiClaw uses that dedicated PostgreSQL connection string.
2. Otherwise it falls back to **`DATABASE_URL`** so the marketplace app and HiClaw share the same Supabase/Postgres database.

There is **no MySQL / mysql2** path in this service.

| Mode | Env var(s) | Schema |
|------|------------|--------|
| Dedicated Postgres | `HICLAW_POSTGRES_URL` | Apply [`schema-postgres.sql`](schema-postgres.sql) |
| Shared app Postgres | `DATABASE_URL` | Same |

**Next.js (Vercel)** uses the same logical database for HiClaw tables when syncing on-chain data and reputation: set **`HICLAW_POSTGRES_URL`** if you want isolation, otherwise let it reuse **`DATABASE_URL`**. Admin **HiClaw DB** is at `/admin/tidb`. See [postgres-cutover-runbook.md](../docs/exec-plans/active/postgres-cutover-runbook.md).

**Tables:** `expert_status`, `sessions`, `waiting_room`, **`evaluator_critiques`**. Session rows support **`conversation_messages`**, **`handoff_artifact`**, **`mem9_profile_summary`** for multi-turn and context reset.

---

## Configuration

Copy [`.env.example`](.env.example) to `hiclaw/service/.env` (or use repo root env for Compose).

| Variable | Purpose |
|----------|---------|
| `HICLAW_POSTGRES_URL` | Optional dedicated PostgreSQL URL for HiClaw |
| `DATABASE_URL` | Shared application PostgreSQL URL when `HICLAW_POSTGRES_URL` is unset |

Plus: `DASHSCOPE_API_KEY`, `MEM9_ENABLED`, evaluator and shadow tuning vars as in `.env.example`.

---

## HTTP API (`POST /query`, etc.)

**`POST /query`** body (JSON):

- **Required:** `menteeId`, `expertId`, `query`
- **Optional:** `mem9SpaceId`, `expertName`, `continueSessionId` (resume thread; same mentee + expert), `sprintContract` (vetting/coaching bounds text), `autoSprintContract` + `sprintMode` (`vetting` \| `coaching`) to let `plannerWorker` draft a contract

**Flow (offline expert):** mem9 context → optional sprint contract → shadow generate → optional context reset + handoff persisted on `sessions` → evaluator loop (scores logged to `evaluator_critiques`) → enqueue **`waiting_room`**. Expert approves via **`POST /review/:draftId`**. Online experts are **forwarded** without generation (same as before).

Player-facing Telegram/WeChat sends happen **after** expert approval in product flows; the evaluator runs **before** the draft is queued so quality is gated upstream of those channels.

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
- Doc maintenance checklist: [documentation-maintenance.md](../docs/references/documentation-maintenance.md)
