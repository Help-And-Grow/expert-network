# IGA Pages × Volcengine deployment runbook

Target: deploy [`Help-And-Grow/expert-network`](https://github.com/Help-And-Grow/expert-network) on Volcengine **IGA Pages** with the full Volcengine tech stack — **Doubao Seed** (text), **Seedream** (image), **Volcengine RDS for PostgreSQL** (database), **Volcengine TOS** (file storage). Both mainland and overseas regions covered by the same repo via region-aware env vars.

Source of truth stays at [`jlzxwt8/expert-network`](https://github.com/jlzxwt8/expert-network) on Vercel; Help-And-Grow is a one-way mirror.

## Architecture at a glance

| Concern | Vercel build (jlzxwt8) | IGA Pages build (Help-And-Grow) |
|---|---|---|
| Compute | Vercel serverless | IGA Pages |
| DB | Google Cloud SQL `hg-postgres-prod` (asia-southeast1) | Volcengine RDS for PostgreSQL |
| Storage | Vercel Blob / GCS / Tencent COS | Volcengine TOS *(not yet wired in code — see §6)* |
| Text LLM | Qwen → Gemini | **volcengine** (CN) or **byteplus** (overseas) — both Doubao-Seed-1.6 |
| Image LLM | Qwen → Gemini | **volcengine** / **byteplus** — Doubao-Seedream-4.0 |
| Build trigger | git push (Vercel GitHub App) | git push (IGA Pages GitHub App) |
| Migration trigger | `postinstall` → `prisma migrate deploy` when `VERCEL=1` | same script, when `IGA_PAGES=1` or `IGA_BUILD_REGION` is set |

The codebase is shared. Switching providers is **env-var-only** at the platform level — no code fork.

## §1 · ModelArk endpoint provisioning (one-time)

1. Volcengine Console → **方舟 / ModelArk** → 在线推理 → 创建推理接入点.
2. Create one **text** endpoint: choose `Doubao-Seed-1.6` (or `Seed-1.6-Flash`). Copy the endpoint id (`ep-2026xxxxxx-yyyy`).
3. Create one **image** endpoint: choose `Doubao-Seedream-4.0` (or `Seedream-4.0-Flash`). Copy the endpoint id.
4. Create an **API key** with access to both endpoints. Copy the key.

For the overseas build, repeat the same in BytePlus console (`https://console.byteplus.com/ark`). Endpoints there serve from `ap-southeast`.

## §2 · Volcengine RDS for PostgreSQL

1. Console → **关系型数据库 / RDS** → PostgreSQL → 创建实例.
2. Engine: PostgreSQL 16. Storage: SSD. VPC: place it in the same VPC as IGA Pages' build runtime (avoids cross-region egress + lets you whitelist IGA Pages' IP ranges).
3. Create database `helpgrow` and user `hg_app` with `CREATEDB`, `CREATEROLE`, and access to that DB.
4. Enable the **pgvector** extension (required for `expert_memory_embeddings`):
   ```sql
   CREATE EXTENSION IF NOT EXISTS vector;
   ```
   If RDS denies it for the unprivileged role, ask Volcengine support to enable it project-wide (it's a built-in Volcengine RDS extension).
5. Construct the connection URL:
   ```
   postgresql://hg_app:<password>@<rds-endpoint>:5432/helpgrow?sslmode=require&sslaccept=accept_invalid_certs
   ```
   The `sslaccept=accept_invalid_certs` is needed for Prisma's Rust query engine to accept the managed-CA chain (same as Cloud SQL).

### Data migration from Cloud SQL → Volcengine RDS

Only do this if you want Help-And-Grow to share production data. For a fresh hackathon DB, skip — let `prisma migrate deploy` create empty tables on first build.

```bash
# Dump from Cloud SQL (via gcloud auth proxy):
cloud-sql-proxy expert-network-489508:asia-southeast1:hg-postgres-prod &
pg_dump --no-owner --no-acl --format=custom \
  "postgresql://hg_app:<cloudsql-pass>@localhost:5432/helpgrow" \
  > helpgrow.dump

# Restore to Volcengine RDS:
pg_restore --no-owner --no-acl --dbname \
  "postgresql://hg_app:<rds-pass>@<rds-endpoint>:5432/helpgrow?sslmode=require" \
  helpgrow.dump
```

Do **not** commit `helpgrow.dump` to git — `.gitignore` blocks `*.dump` post the 2026-05-11 history rewrite.

## §3 · Volcengine TOS bucket

1. Console → **对象存储 / TOS** → 创建桶.
2. Name: `hg-prod-cn-<random>` (CN) or `hg-prod-intl-<random>` (overseas). Bucket names are globally unique within Volcengine.
3. Region: same as IGA Pages / RDS.
4. Access permission: **私有** (private). Profile images are served via signed URLs or by routing through Next.js API routes.
5. CAM keys: console.volcengine.com/iam → AccessKey → create a sub-account key scoped to TOS read/write on this bucket. Copy `AccessKeyId` and `SecretAccessKey`.

**Note: the `volcengine-tos` STORAGE_PROVIDER is not yet wired in code.** Until it lands (tracked as a follow-up), use `STORAGE_PROVIDER=db` (stores blobs in Postgres `Storage` table — works but inefficient for >1 MB files) or temporarily point at Tencent COS / GCS. The TOS bucket is still worth provisioning now so it's ready when the code lands.

## §4 · IGA Pages project setup

1. Console → **全站加速 / IGA Pages** → 创建项目 → 选择 GitHub 仓库.
2. Authorize the IGA Pages GitHub App and select `Help-And-Grow/expert-network`.
3. Framework: Next.js (15+) — IGA Pages auto-detects via `package.json`.
4. Build command: `npm run build` (default — runs `switch-db.mjs && prisma generate && next build`).
5. Output: leave as Next.js default (`.next` for SSR + `app/api/*` for routes).
6. Node version: **20.x** (matches `engines.node` in `package.json`).
7. Production branch: `main`.
8. Region(s): pick **中国大陆** for the CN build OR **海外 (Singapore)** for the overseas build. To serve both, create two IGA Pages projects pointing at the same repo with different env vars (see §5).

For mainland custom domains: ICP 备案 must be completed before binding. Until then, use the auto-assigned `*.iga-cdn-edge.com` (or whatever IGA Pages issues) domain.

## §5 · Environment variables to set in IGA Pages

These are the **non-default** values for the Help-And-Grow deployment. Anything not listed inherits from `.env.example` defaults.

### Required (both regions)

```bash
# Build platform detection — triggers prisma migrate deploy in postinstall
IGA_PAGES=1

# Database
DATABASE_URL=postgresql://hg_app:<pass>@<rds-endpoint>:5432/helpgrow?sslmode=require&sslaccept=accept_invalid_certs

# Auth
NEXTAUTH_URL=https://<your-iga-pages-domain>
AUTH_SECRET=<openssl rand -base64 32>

# Google OAuth (sign-in)
GOOGLE_CLIENT_ID=<from GCP Console>
GOOGLE_CLIENT_SECRET=<from GCP Console>

# Storage — see §3; until volcengine-tos lands, use "db" for hackathon demos
STORAGE_PROVIDER=db
```

### CN build (mainland, deployed to ark.cn-beijing.volces.com)

```bash
VOLCENGINE_API_KEY=<ModelArk API key>
VOLCENGINE_MODEL_ID=ep-2026xxxxxx-yyyy        # Doubao-Seed-1.6 endpoint
VOLCENGINE_IMAGE_MODEL=ep-2026xxxxxx-zzzz     # Doubao-Seedream-4.0 endpoint
AI_PROVIDER=volcengine
AI_TEXT_PROVIDER_CHAIN=volcengine             # no fallback — single-cloud
IMAGE_PROVIDER_CHAIN=volcengine
```

### Overseas build (ap-southeast)

```bash
BYTEPLUS_API_KEY=<BytePlus ModelArk API key>
BYTEPLUS_MODEL_ID=ep-2026xxxxxx-yyyy
BYTEPLUS_IMAGE_MODEL=ep-2026xxxxxx-zzzz
AI_PROVIDER=byteplus
AI_TEXT_PROVIDER_CHAIN=byteplus
IMAGE_PROVIDER_CHAIN=byteplus
```

### Optional (skip unless used)

`STRIPE_*`, `TELEGRAM_*`, `WECHAT_*`, `RESEND_API_KEY`, `EMAIL_*`, `BASE_RPC_URL`, `POMP_*`, `TRTC_*` — copy values from your Vercel project if you want those features active. Note: rotated secrets only — the historical leak from 2026-05-11 means every secret in the old `.env.production` is considered compromised.

## §6 · Code follow-ups not yet shipped

These are needed for full Volcengine parity but were deferred from the initial change so the LLM swap could land independently:

- [ ] **`volcengine-tos` storage provider.** Add `src/lib/storage/volcengine-tos.ts` implementing the `StorageProvider` interface using `@volcengine/tos-sdk`. Extend `STORAGE_PROVIDER` enum in `src/lib/storage/types.ts` and the resolver in `src/lib/storage/index.ts`. Add `VOLCENGINE_TOS_*` env vars (region, bucket, access key id, access key secret). ~150 lines + a new dep.
- [ ] **WeChat profile-image routing for IGA Pages CN.** Today, WeChat-originated requests force `hunyuan` (Tencent Cloud) for text. If the CN deployment also wants to keep image generation on Doubao Seedream regardless of WeChat origin, add a routing scope entry `wechat-cn → [volcengine]` for the image category in `provider-registry-seed.ts`.
- [ ] **ICP filing**, if binding a custom CN domain. Operational, not code.

## §7 · Smoke tests after first deploy

1. `curl https://<iga-pages-domain>/api/health` → 200 (or `/api/v1/health` depending on what's defined).
2. `curl https://<iga-pages-domain>/api/v1/match?q=growth%20marketing` → 401 (auth-gated as expected). With a signed-in cookie → 200 with `recommendations`.
3. Sign in via Google OAuth → land on `/discover` → send a chat message → reply should come from Doubao Seed.
4. Trigger profile image generation (e.g. create an expert profile) → image should be data-URL with Seedream-generated bytes.
5. Check IGA Pages build logs for `[prisma-migrate-if-vercel] Build platform: iga-pages` and a successful `migrate deploy`.

## §8 · Rollback

The mirror is one-way. To revert Help-And-Grow to an earlier state, force-push the desired SHA from `jlzxwt8/main`. The Vercel deployment of jlzxwt8 is independent and continues serving production traffic regardless.
