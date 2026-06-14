# Onboarding — Help & Grow

Welcome. This is the doc to read first if you've just been handed access to the repo. It assumes nothing about your prior context: you're an intern, a new collaborator, a curious reader, or you just want to study how an AI-native product is wired together end-to-end.

Plan for ~25 minutes:

1. [What this product is](#1--what-this-product-is) (2 min)
2. [Architecture at a glance](#2--architecture-at-a-glance) (4 min)
3. [Why this codebase is worth studying](#3--why-this-codebase-is-worth-studying) (3 min)
4. [Run it locally](#4--run-it-locally) (5–15 min, optional)
5. [Codebase tour](#5--codebase-tour) (4 min)
6. [Reading order from here](#6--reading-order-from-here) (1 min)
7. [Glossary](#7--glossary) (2 min)
8. [Workflow & expectations](#8--workflow--expectations) (2 min)

---

## 1 · What this product is

**Help & Grow** is an **AI-native expert network**. Founders, operators, and learners book real consultations with experts in Singapore and Southeast Asia; alongside every booking, a **digital expert** — an AI agent trained on the human expert's content, meetings, and memos — stays online to answer follow-ups in the human's voice and style. The platform also tracks **proof-of-meet on-chain** so a coach's reputation accrues to a verifiable ledger.

In one sentence: **"Everyone is both expert and player."** People earn by helping; they grow by learning from someone slightly ahead of them; the digital expert is the long-lived artifact connecting both sides.

The full product narrative lives in [`docs/BRAND.md`](BRAND.md) (vision, voice) and [`docs/PRODUCT_SENSE.md`](PRODUCT_SENSE.md) (personas, principles).

---

## 2 · Architecture at a glance

One Next.js 15 app serves three clients (Web, Telegram Mini App, WeChat Mini Program), plus on-chain components on Base.

```
┌──────────────────────────────────────────────────────────────────────┐
│  Clients                                                              │
│  ┌────────────┐   ┌──────────────────┐   ┌─────────────────────┐    │
│  │ Web (SSR)  │   │ Telegram Mini App│   │ WeChat Mini Program │    │
│  │ React 18   │   │ initData HMAC    │   │ Taro 4 + React      │    │
│  └─────┬──────┘   └────────┬─────────┘   └──────────┬──────────┘    │
└────────┼───────────────────┼────────────────────────┼───────────────┘
         │                   │                        │
         └───────────┬───────┴────────────────────────┘
                     ▼
         ┌──────────────────────────────────────────────┐
         │  Next.js 15 App (the API)                    │
         │  ├ Auth.js v5  (Google OAuth + magic link)   │
         │  ├ tRPC v11    (typed APIs)                  │
         │  ├ Route Handlers  (REST endpoints)          │
         │  ├ MCP server  (/api/mcp — AI agent tools)   │
         │  └ Public namespace  (/api/v1/*)             │
         └──────┬────────────────────┬─────────────────┘
                │                    │
                ▼                    ▼
   ┌────────────────────┐  ┌─────────────────────────────┐
   │ PostgreSQL         │  │ AI providers (pluggable)    │
   │ Prisma 7           │  │ Qwen · Gemini · OpenAI ·    │
   │ pgvector for       │  │ Doubao (Volcengine/         │
   │ expert memory      │  │  ByteDance) · Hunyuan ·     │
   └────────────────────┘  │ Z.AI                        │
                           └─────────────────────────────┘
                ┌──────────────────────────────────────┐
                │ External / on-chain                  │
                │ Stripe · PayNow · TON · WeChat Pay   │
                │ Base mainnet (EAS attestations, H&G  │
                │ ERC-20 token) · Tencent TRTC live    │
                └──────────────────────────────────────┘
```

For domain layers, dependency rules, and per-subsystem deep-dives, read [`ARCHITECTURE.md`](../ARCHITECTURE.md) after this.

### Production deploy topology

> **Updated 2026-06-14 — single-source workflow.** Routine development and deploy-triggering pushes now happen only in `jlzxwt8/expert-network`. `Help-And-Grow/expert-network` remains as a frozen public mirror / historical reference. Full rationale in [`docs/references/multi-repo-strategy.md`](references/multi-repo-strategy.md).

| Repo | Role | Local remote | Vercel connection |
|---|---|---|---|
| `jlzxwt8/expert-network` | **Source of truth** — routine development and deploy-triggering pushes | `origin` (fetch + push) | Auto-deploys to www.help-and-grow.com via Vercel GitHub App |
| `Help-And-Grow/expert-network` | **Frozen mirror** — historical reference only | none required for routine work | No routine deploy target |

Routine push goes to `origin` only, and `origin` should point at `jlzxwt8/expert-network`. The Volcengine deployment path for IGA Pages CN is in [`docs/exec-plans/active/iga-pages-volcengine-deployment.md`](exec-plans/active/iga-pages-volcengine-deployment.md).

---

## 3 · Why this codebase is worth studying

A few patterns that are uncommon in tutorial-grade examples:

- **Provider abstraction over many AI vendors.** [`src/lib/ai/`](../src/lib/ai/) registers Qwen, Gemini, OpenAI, Z.AI, Doubao (via Volcengine for CN + BytePlus for overseas), and Hunyuan behind a single `BaseAIProvider` interface. Region-aware routing picks the right one per request (WeChat-CN → Hunyuan, web/Telegram → Qwen→Gemini chain). Admin UI at `/admin/providers` flips chains at runtime via `SystemConfig` — no redeploy.
- **One auth function, three platforms.** [`src/lib/request-auth.ts`](../src/lib/request-auth.ts) → `resolveUserId(request)` accepts a NextAuth cookie, a Telegram `initData` HMAC, or a WeChat `x-wechat-token` JWT and returns a unified user id. Every API route uses it.
- **Hybrid expert memory.** Long-term memory is stored either in hosted mem9 or local pgvector (or both) — toggle via `MEMORY_BACKEND`. The vector embeddings are written alongside the natural-language source so the agent can cite specific source snippets.
- **On-chain reputation that doesn't get in the way.** Completed bookings auto-issue EAS attestations on Base (one per role — expert + player); the `/reputation` page aggregates them and shows EASScan links. See [`src/lib/pomp-credential.ts`](../src/lib/pomp-credential.ts) and the `POMPCredential` model in [`prisma/schema.prisma`](../prisma/schema.prisma).
- **Real-time voice (two modes).** Async messaging (3-reply free cap) and timed live chat (3-min cap), both Qwen-backed. See [`src/lib/voice-chat-session.ts`](../src/lib/voice-chat-session.ts).
- **Single codebase, multi-cloud deploys.** Same `main` ships to Vercel/GCP overseas and IGA Pages/Volcengine for CN; the only difference is env vars at the deploy target.

Pick whichever of these sounds most interesting and dig into the linked files first.

---

## 4 · Run it locally

You can read the codebase without running it. If you want to run it:

### Prerequisites
- **Node.js 20.x** (see `.nvmrc`)
- **PostgreSQL 14+** — local install, Docker, or a free Supabase/Neon instance is fine
- Optional: Docker Desktop (for the all-in-one stack including pgvector)

### Five-minute setup

```bash
# 1. Clone
git clone https://github.com/jlzxwt8/expert-network.git
cd expert-network

# 2. Install (postinstall runs prisma generate automatically)
npm install

# 3. Configure env
cp .env.example .env
# Edit .env — at minimum set:
#   DATABASE_URL="postgresql://..."
#   NEXTAUTH_URL="http://localhost:5000"
#   AUTH_SECRET="$(openssl rand -base64 32)"
#   DASHSCOPE_API_KEY="..."                          # Qwen AI features
#   GOOGLE_CLOUD_PROJECT="..." + GOOGLE_SERVICE_ACCOUNT_KEY="..."  # Vertex Gemini fallback/search

# 4. Create schema
npm run db:push

# 5. Run
npm run dev
```

Open <http://localhost:5000>. Sign in with the local-dev shortcut (`DEV_AUTH_EMAIL=you@localhost` in `.env`) so you don't need to set up Google OAuth on day 1.

If anything fails, the most common stumbling block is the database URL — Prisma will refuse anything that isn't `postgresql://` or `postgres://`. See [`docs/CLI_SETUP.md`](CLI_SETUP.md) for a Cloud-SQL-proxy / Tencent-CloudBase / Volcengine-RDS tunnel walk-through.

### What if I want to run the WeChat Mini Program?
Separate setup — see [`wechat/README.md`](../wechat/README.md). Requires a WeChat developer account.

---

## 5 · Codebase tour

Top-level directories, sorted by how often you'll touch them:

| Directory | What lives here | First-time-reading suggestion |
|---|---|---|
| [`src/app/`](../src/app/) | Next.js App Router — pages, API routes, layouts | Start at [`src/app/page.tsx`](../src/app/page.tsx) for the landing page, then [`src/app/discover/page.tsx`](../src/app/discover/page.tsx) for the matching UI |
| [`src/app/api/`](../src/app/api/) | All HTTP endpoints (REST + tRPC + MCP + webhooks) | Read [`src/app/api/v1/match/route.ts`](../src/app/api/v1/match/route.ts) for a simple example, then [`src/app/api/bookings/route.ts`](../src/app/api/bookings/route.ts) for a complex one |
| [`src/lib/`](../src/lib/) | Business logic, integrations, all the smart parts | Browse the file names — `ai/`, `pomp-credential.ts`, `request-auth.ts`, `voice-chat-session.ts` are the headliners |
| [`src/lib/ai/`](../src/lib/ai/) | Pluggable AI provider implementations | Read `base-provider.ts` (the contract), `qwen.ts` (an example), `provider-catalog.ts` (the registry + chain resolver) |
| [`prisma/`](../prisma/) | Database schema (`schema.prisma`) and migrations | Open `schema.prisma`; the comment headers walk you through the domain models |
| [`src/components/`](../src/components/) | React components — shared UI primitives in `ui/` | Skim `ui/` for the design-system primitives (button, card, dialog…) |
| [`wechat/`](../wechat/) | WeChat Mini Program (Taro 4 + React) | Separate sub-project; read [`wechat/README.md`](../wechat/README.md) if relevant |
| [`ten-agent/`](../ten-agent/) | Realtime voice agent (Phase B of the voice stack) | Skip unless you're specifically working on voice |
| [`contracts/`](../contracts/) | Foundry smart contracts (`HelpGrowToken`) | Skip unless you're specifically working on web3 |
| [`e2e/`](../e2e/) | Playwright tests | Read [`e2e/README.md`](../e2e/README.md) before running anything against production |
| [`scripts/`](../scripts/) | Build / deploy helpers | Read on a need-to-know basis — they're glue, not business logic |
| [`docs/`](.) | Knowledge base — design docs, exec plans, runbooks | Use the [reading order below](#6--reading-order-from-here) |

---

## 6 · Reading order from here

After this onboarding, in priority order:

1. **[`ARCHITECTURE.md`](../ARCHITECTURE.md)** — the system map. Read end-to-end (it's ~200 lines).
2. **[`AGENTS.md`](../AGENTS.md)** — TOC + conventions + "where to look" table. The "Key Conventions" section is the rules of the road.
3. **[`docs/BRAND.md`](BRAND.md)** + **[`docs/PRODUCT_SENSE.md`](PRODUCT_SENSE.md)** — what the product is *for*, in plain words.
4. **[`docs/DESIGN.md`](DESIGN.md)** + **[`docs/FRONTEND.md`](FRONTEND.md)** — if you're working on UI.
5. **[`docs/design-docs/`](design-docs/)** — indexed design decisions per subsystem. Browse the [`index.md`](design-docs/index.md) and pull whichever subsystem you'll be working on.
6. **[`docs/exec-plans/active/`](exec-plans/active/)** — current rollout runbooks and active migrations. Most relevant if you'll be doing platform / infra work.
7. **[`docs/RELIABILITY.md`](RELIABILITY.md)** + **[`docs/SECURITY.md`](SECURITY.md)** — error handling, SLOs, secret handling.
8. **[`docs/PLANS.md`](PLANS.md)** — the roadmap. What's coming next.

When you're ready to write code: **[`CLAUDE.md`](../CLAUDE.md)** is the workflow spec for the project lead. As an intern, you're read-only until told otherwise — read it so you understand what *not* to do (see §8).

---

## 7 · Glossary

In-house terms you'll see in the code and docs:

| Term | Meaning |
|---|---|
| **POMP** | *Proof of Meet Protocol.* Every completed booking generates two EAS attestations on Base — one for the expert, one for the player. The `POMPCredential` Prisma model owns the on-chain status. |
| **H&G token** | An ERC-20 token (`HelpGrowToken.sol`) on Base. Players earn 1 token per SGD spent; redeem at 100 tokens = 1 SGD discount. |
| **Digital expert** | The AI agent paired 1:1 with a human expert. Trained on their content, meetings, and memos; stays online; answers in their voice. The "service-as-agent" pillar of the product vision. |
| **mem9 / pgvector** | The two memory backends for the digital expert. mem9 is hosted (per-expert key); pgvector is self-hosted (in our own Postgres). Toggle via `MEMORY_BACKEND=mem9 | pgvector | hybrid`. |
| **Coach / expert / player** | A booking has a *player* (the learner) and an *expert* (the human consultant). When a player turns around and shares what they learned, they're acting as a *coach*. "Everyone is both expert and player." |
| **ModelArk** | Volcengine/ByteDance's model gateway. Hosts Doubao (text) and Seedream (image) models. We hit it from `src/lib/ai/volcengine.ts` (CN endpoint) and `src/lib/ai/byteplus.ts` (overseas). |
| **Doubao** | ByteDance's family of foundation models. "Seed-1.6" is text; "Seedream-4.0" is image. |
| **Hunyuan** | Tencent Cloud's LLM. Used exclusively for WeChat-originated requests so inference stays inside Tencent's compliance boundary. |
| **IGA Pages** | Volcengine's web app hosting product (火山引擎全站加速). The future CN production deploy target. |
| **TRTC** | Tencent Real-Time Communication. Powers premium live consultation rooms (paid). |
| **Solo PM workflow** | The maintainer's working style — push directly to `main`, no PR review gate. Documented in [`CLAUDE.md`](../CLAUDE.md). Not the standard mode for interns. |
| **`/api/v1/*`** | The auth-free public namespace, designed for AI agents / external integrations to consume. Other endpoints under `/api/` require auth. |
| **`/api/mcp`** | The MCP server endpoint — exposes expert search/match/availability as tools for AI agents that speak the Model Context Protocol. |

---

## 8 · Workflow & expectations

### What you can do freely
- **Read everything.** All of the docs, all of the code, all of the design decisions are open for you.
- **Run the app locally.** Break things locally; the `.env.example` defaults won't touch production.
- **Ask questions.** The PM responds in person, in DMs, or via inline comments on a doc.
- **Take notes as you go.** A first-week intern's notes are often the best onboarding doc for the *next* intern. If you spot something confusing in the docs, propose an edit.

### What requires a heads-up first
- **Running anything against the production database** (`DATABASE_URL` pointing at Alibaba RDS). Don't.
- **Pushing to any branch on `jlzxwt8/expert-network`.** `jlzxwt8/main` auto-deploys to www.help-and-grow.com via Vercel, so one bad push to production has compounding effects. `Help-And-Grow/expert-network` is now a frozen mirror and should not be used for routine work either.
- **Touching env vars on Vercel or IGA Pages.** Those are the live production secrets.
- **Rotating any token, key, or password.** Even if you spot a leak (see the 2026-05-11 incident, summarized below) — flag it, don't fix it yourself.

### Where to write code
If you're given a task that involves shipping code, the project lead will create a feature branch for you (or ask you to create one named `interns/<your-name>/<topic>`). Push to that branch and request a review **before** any merge to `main`. The "commit and push straight to main" rule in CLAUDE.md is for the project lead specifically — not the default for interns.

### Recent security context (don't repeat this)
In May 2026 the repo had a `.env.production` and a `wechat/helpandgrow_data.sql` committed by accident, leaking production OAuth tokens and 45 Google refresh tokens. The history was rewritten and the files purged, but the lesson is permanent:

- **`.env*` files (except `.env.example`) are gitignored.** Don't `git add -f` them.
- **Database dumps belong outside the repo.** `*.dump`, `*_data.sql`, `*_backup.sql` are gitignored too.
- **GitHub Secret Scanning Push Protection may still be enabled on the public mirror.** Treat any push-protection block as a signal to stop and tell the project lead.

### Asking for help

Your best first move when stuck:

1. Search the codebase: `git grep <term>` is faster than guessing where something lives.
2. Search the docs: the [reading order](#6--reading-order-from-here) above is the priority list; `docs/design-docs/index.md` indexes the rest.
3. If still stuck after ~15 minutes, ask. Spinning your wheels is the wrong outcome — interrupting is the right one.

Welcome aboard. Have fun reading.
