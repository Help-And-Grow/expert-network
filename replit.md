# Expert Network (Help & Grow)

An AI-native expert network platform for Singapore & Southeast Asia. Users can book sessions, share expertise, and grow together.

## Architecture

- **Framework**: Next.js 15 (App Router) + React 18 + TypeScript 5
- **Database ORM**: Prisma 7 with `@prisma/adapter-pg` — PostgreSQL only
- **Auth**: Auth.js v5 (`next-auth ^5.0.0-beta.30`) with Prisma adapter; unified multi-platform resolver in `src/lib/request-auth.ts`
- **AI**: Pluggable via `AI_PROVIDER` (default `qwen`) — DashScope/Qwen, Gemini (AI Studio or Vertex), OpenAI, Z.ai (Vertex), Tencent Hunyuan, BytePlus, Volcengine
- **Blockchain**: Base chain + EAS attestations (POMP reputation), `HelpGrowToken` ERC-20
- **Payments**: Stripe Connect, PayNow (SG), TON, WeChat Pay, free flow
- **Messaging**: Telegram Mini App, WeChat Mini Program (Taro)
- **Email**: Nodemailer (magic link) / Resend (notifications)
- **Voice**: DashScope/Qwen for async + realtime voice chat (`VOICE_CHAT_MODE`)

## Project Structure

- `src/app/` — Next.js App Router pages and API routes
- `src/components/` — Shared UI components (Radix UI + Tailwind)
- `src/lib/` — Utilities, Prisma client, auth config
- `src/generated/prisma/` — Prisma generated client
- `prisma/schema.prisma` — Database schema
- `scripts/` — DB switch script, EAS schema registration, WeChat upload
- `hiclaw/` — HiClaw session sync sub-service
- `wechat/` — WeChat mini-program

## Running on Replit

- **Dev server**: `npm run dev` (port 5000, 0.0.0.0)
- **Workflow**: "Start application" → `npm run dev`
- The `postinstall` script automatically switches the DB provider and generates the Prisma client.

## Key Environment Variables

See `.env.example` for the full list. Minimum required to start:

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string for the main app |
| `NEXTAUTH_URL` | Full public URL of the app (e.g. `https://<repl>.replit.app`) |
| `NEXTAUTH_SECRET` | Random secret — generate with `openssl rand -base64 32` |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth (for sign-in) |
| `GEMINI_API_KEY` | Google AI Studio key (for AI features) |

Optional but used by features:
- `EMAIL_SERVER_*` / `EMAIL_FROM` — Magic link email auth
- `OPENAI_API_KEY` — If `AI_PROVIDER=openai`
- `STRIPE_*` — Payments
- `POMP_ISSUER_PRIVATE_KEY`, `POMP_EAS_SCHEMA_UID` — Reputation attestations
- `ALCHEMY_WEBHOOK_SECRET` — On-chain webhook verification
- `HICLAW_POSTGRES_URL` — Optional dedicated PostgreSQL URL for HiClaw; otherwise it reuses `DATABASE_URL`
- `VOICE_CHAT_MODE`, `DASHSCOPE_API_KEY` — Voice chat features
- `TRTC_*` — Premium live consultation
- `ZAI_API_KEY` — Required if `AI_PROVIDER=zai`

## Database

This repo is PostgreSQL-only. `scripts/switch-db.mjs` keeps Prisma on
`provider = "postgresql"` before client generation and deployment builds.
