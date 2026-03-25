# HiClaw integration (Help & Grow)

## Database: TiDB Cloud Zero

HiClaw session data (`expert_status`, `sessions`, `waiting_room`) is designed to run on **[TiDB Cloud Zero](https://zero.tidbcloud.com/)** — instant MySQL-compatible databases for agents and prototypes.

**Important lifecycle (Zero vs permanent):**

1. **Provision** — Via [zero.tidbcloud.com](https://zero.tidbcloud.com/) (browser), [CLI/API](https://zero.tidbcloud.com/) (`POST https://zero.tidbapi.com/v1beta1/instances`), or your automation.
2. **TTL** — Each unclaimed Zero instance lasts **up to ~30 days**; then credentials are revoked and data is removed (see [Zero FAQ](https://zero.tidbcloud.com/)).
3. **Claim (production)** — Open the **claim URL** from the API response, sign in to TiDB Cloud, and attach the database to your org so it **does not disappear** after the trial window.
   - **Cannot be fully automated for you:** claiming binds the database to **your** TiDB Cloud org and requires an interactive browser sign-in. This repo does not store TiDB Cloud OAuth tokens. **Your one-time action:** follow the claim link from the Zero API/email and finish the flow; then keep `TIDB_DATABASE_URL` on Vercel and HiClaw in sync.
4. **Connection string** — Use the MySQL URL as `TIDB_DATABASE_URL` for:
   - This **`hiclaw/service`** on your home machine / ECS
   - **Vercel** (same variable) if you also use `/admin/tidb`, `/api/webhook/onchain`, and `/api/reputation/:expertId` against the same cluster

For a **production** Help & Grow deployment, treat Zero as **“provision → claim → then use the stable connection string”**, not as an unclaimed disposable instance.

## Run the shadow service locally

```bash
cd hiclaw/service
cp ../.env.example .env   # fill TIDB_DATABASE_URL, DASHSCOPE_API_KEY
npm install
npm start
```

Docker Compose under `hiclaw/docker-compose.yml` is intended for deployment alongside the full [HiClaw](https://hiclaw.io/) stack on a host that can reach TiDB.

---

## Why on-chain reputation data is in TiDB today (not Supabase)

This is an **architecture choice**, not a requirement of TiDB or Postgres.

**Reasons it was split:**

- **Separation of concerns** — Core marketplace (users, bookings, payments) stays in **Supabase**; **agent sessions** and **blockchain-adjacent aggregates** were kept in a separate MySQL-compatible store so HiClaw and webhook workers could evolve without touching the main Prisma schema on every experiment.
- **Same engine as HiClaw** — One connection string and SQL style for the **shadow worker / waiting room** and for **rows updated from chain events** (e.g. session verified, token id).
- **Operational flexibility** — You can tune, reset, or later **move** reputation sync to Supabase (new tables + webhook writing to Postgres) if you prefer a **single** database for everything.

**You could use Supabase instead** for reputation mirrors: store `on_chain_verified`, `eas_attestation_uid`, `tx_hash`, and aggregates in PostgreSQL and drop TiDB for that path only — it would be a product/engineering tradeoff (one DB to operate vs two).

---

## Links

- [TiDB Cloud Zero](https://zero.tidbcloud.com/)
- [HiClaw](https://hiclaw.io/)
