# Help & Grow — AI Native Expert Network

**Help & Grow** connects people as **both expert and player** (and **coach** when sharing): book real meetups, get AI-assisted matches, and grow with a **digital expert** that learns from each human counterpart. Strong roots in **Singapore & Southeast Asia**.

Canonical brand copy: [`docs/BRAND.md`](docs/BRAND.md). System map: [`ARCHITECTURE.md`](ARCHITECTURE.md). Agent / contributor TOC: [`AGENTS.md`](AGENTS.md).

---

## What's in this repo

A monorepo around one Next.js API layer that serves three clients plus on-chain components.

| Folder | What it is |
|---|---|
| [`src/`](src/) | Next.js 15 App Router app (web UI, API routes, tRPC, Inngest, instrumentation) |
| [`prisma/`](prisma/) | Postgres schema and migrations |
| [`wechat/`](wechat/) | WeChat Mini Program (Taro 4 + React) |
| [`ten-agent/`](ten-agent/) | Realtime voice agent (Phase B of the voice stack) |
| [`contracts/`](contracts/) | Foundry smart contracts (`HelpGrowToken`, deploy scripts) |
| [`e2e/`](e2e/) | Playwright tests — `smoke/`, `booking/`, `auth/` |
| [`scripts/`](scripts/) | Build / deploy helpers (DB switch, auto-baseline, WeChat upload, env sync) |
| [`docs/`](docs/) | Knowledge base — see the [documentation map](AGENTS.md#documentation-map) |
| [`packages/`](packages/) | Shared workspace packages (e.g. `@expert-network/shared-api`) |

## Tech stack

- **Web framework:** Next.js 15 (App Router) · React 18 · TypeScript 5 · Tailwind CSS · shadcn/ui (Radix)
- **API layer:** Next.js Route Handlers · tRPC v11 · MCP server (`/api/mcp`) · public auth-free namespace `/api/v1/*`
- **Database:** PostgreSQL only · Prisma 7 with `@prisma/adapter-pg` · optional `pgvector` for expert memory
- **Auth:** Auth.js v5 (`next-auth ^5.0.0-beta.30`) — Google OAuth + Nodemailer magic link · Telegram initData HMAC · WeChat `code2session` JWT — unified by [`src/lib/request-auth.ts`](src/lib/request-auth.ts)
- **AI:** Pluggable providers via `AI_PROVIDER` (default `qwen`): DashScope/Qwen, Gemini (AI Studio or Vertex), OpenAI, Z.ai (Vertex Model Garden), BytePlus ModelArk, Volcengine ModelArk, Tencent Hunyuan. Memory backend (`MEMORY_BACKEND`): `mem9 | pgvector | hybrid`.
- **Voice:** Async voice chat (5-reply free cap) and realtime AI chat (3-min cap), both DashScope/Qwen-backed (`VOICE_CHAT_MODE=async|realtime|both`)
- **Realtime media:** Tencent TRTC for premium live consultation
- **Payments:** Stripe Connect (Express) · PayNow (SG, primary web) · TON · WeChat Pay (JSAPI + service-provider mode) · free flow for zero-priced experts
- **On-chain:** Base mainnet/Sepolia · POMP (Proof of Meet Protocol) via EAS attestations · `HelpGrowToken` ERC-20 (1:1 SGD earn, 100:1 SGD redeem) · `viem` + `wagmi`
- **Background jobs:** Inngest (`/api/inngest`) and Vercel cron (`/api/cron/charge-remainder`) — toggle with `CRON_DELEGATED_TO_INNGEST`
- **Email:** Nodemailer (magic link) + Resend (booking confirmation + reminders)
- **Observability:** `@vercel/otel` instrumentation · structured request logs on high-risk routes · health endpoints `/api/health` and `/api/db-health`
- **Hosting:** Vercel (Functions). Local stack via Docker Compose (Postgres + pgvector + Next.js)
- **Testing:** Playwright e2e (`playwright.config.ts`, `playwright.prod.config.ts`)

Full stack rationale and dependency layering: [`ARCHITECTURE.md`](ARCHITECTURE.md).

## Multi-platform clients

| Client | Path | Auth | Notes |
|---|---|---|---|
| Web (SSR) | [`src/app/`](src/app/) | Auth.js v5 cookie | Primary surface, shadcn/ui dark theme |
| Telegram Mini App | shares `src/app/` + `x-telegram-init-data` | initData HMAC | Mini App URL set in @BotFather |
| WeChat Mini Program | [`wechat/`](wechat/) (Taro) | `x-wechat-token` JWT | Premium voice-first UX; built/uploaded via `miniprogram-ci` |

## Getting started

### Prerequisites
- Node.js 20.x (see `.nvmrc` and `engines.node`)
- PostgreSQL 14+ (local or hosted)
- Optional: Docker Desktop (for the local full-stack)

### 1. Install
```bash
npm install
```
`postinstall` runs [`scripts/switch-db.mjs`](scripts/switch-db.mjs) (enforces `provider = "postgresql"` in `prisma/schema.prisma`), `prisma generate`, and [`scripts/prisma-migrate-if-vercel.mjs`](scripts/prisma-migrate-if-vercel.mjs) (auto-baselines on Vercel when the DB has tables but no migration history).

### 2. Configure environment
```bash
cp .env.example .env
```
Minimum to boot the web app: `DATABASE_URL`, `NEXTAUTH_URL`, `AUTH_SECRET` (32+ chars). For features, see the [grouped env reference](docs/ENV.md) (created in this revamp; until then `.env.example` is heavily commented).

### 3. Provision the database
```bash
npm run db:push        # prisma db push (dev convenience)
# or
npx prisma migrate dev # for tracked migrations
```

### 4. Run the dev server
```bash
npm run dev            # next dev -p 5000 -H 0.0.0.0
# or for port 3000:
npm run dev:3000
```
Open [http://localhost:5000](http://localhost:5000). Local sign-in shortcut on `/auth/signin` is enabled by `DEV_AUTH_EMAIL` (and optional `DEV_AUTH_ROLE`).

### 5. (Optional) Run subsystems locally with Docker
- ten-agent realtime voice: `cd ten-agent && docker compose up`

## Common tasks

| Task | Command / file |
|---|---|
| Type-check | `npm run typecheck` (runs `prisma generate` + `tsc --noEmit`) |
| Lint | `npm run lint` |
| Build | `npm run build` (DB switch → `prisma generate` → `next build`) |
| E2E (local) | `npm run test:e2e` |
| E2E (CI subset) | `npm run test:e2e:ci` — `e2e/smoke e2e/booking e2e/auth/signin-page.spec.ts` |
| E2E (prod URL) | `npm run test:ui:prod` |
| Smoke public endpoints | `npm run smoke:public` |
| WeChat build | `npm run wechat:build` |
| WeChat upload | `npm run wechat:upload` (needs `WECHAT_CI_KEY_PATH` or `WECHAT_CI_PRIVATE_KEY`) |
| Vercel env pull | `npm run vercel:env:pull:dev` / `:preview` / `:production` |

## Deployment

Production canonical URL: **`https://www.help-and-grow.com`** (the `expert-network.vercel.app` alias still resolves to the same deployment as a fallback). The live Vercel project is owned by the **Help And Grow** team; default Git iteration follows **`jlzxwt8/expert-network`**. Push to `main` triggers Vercel build (`npm run build`), which auto-baselines the migration history when needed.

GitHub Actions workflows: [`.github/workflows/`](.github/workflows/) — `ci.yml` (lint + Playwright against canonical production URL), `deploy-smoke.yml`, `playwright-e2e.yml`, `wechat-ci.yml`, `npm-audit.yml`. The `ui-smoke.yml` workflow + ephemeral CI Postgres were removed 2026-05-06; live prod is the single source of truth for browser smoke. (Workflows were re-enabled in commit `27f2570` after the Action-minute quota window reset.)

Vercel + env handling: [`docs/references/vercel-environments-solo-pm.md`](docs/references/vercel-environments-solo-pm.md), [`vercel-env-and-secret-rotation.md`](docs/references/vercel-env-and-secret-rotation.md).

## Where to dig deeper

- **System & domain map:** [`ARCHITECTURE.md`](ARCHITECTURE.md)
- **Conventions, key files, and "where to look" table:** [`AGENTS.md`](AGENTS.md)
- **Roadmap + decision log:** [`docs/PLANS.md`](docs/PLANS.md)
- **Brand / product copy:** [`docs/BRAND.md`](docs/BRAND.md), [`docs/PRODUCT_SENSE.md`](docs/PRODUCT_SENSE.md)
- **Design tokens:** [`docs/DESIGN.md`](docs/DESIGN.md)
- **Frontend layout:** [`docs/FRONTEND.md`](docs/FRONTEND.md)
- **Reliability / SLOs:** [`docs/RELIABILITY.md`](docs/RELIABILITY.md)
- **Security posture:** [`docs/SECURITY.md`](docs/SECURITY.md)
- **E2E:** [`e2e/README.md`](e2e/README.md)

## License

Private — internal use only unless otherwise stated. Brand and product copy under [`docs/BRAND.md`](docs/BRAND.md) is canonical.
