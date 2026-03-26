# Expert Network (Help & Grow)

An AI-native expert network platform for Singapore & Southeast Asia. Users can book sessions, share expertise, and grow together.

## Architecture

- **Framework**: Next.js 15 (App Router)
- **Database ORM**: Prisma (supports PostgreSQL via Supabase, or MySQL via TiDB)
- **Auth**: NextAuth v4 with Prisma adapter
- **AI**: Google Gemini (default), OpenAI, or Qwen/DashScope
- **Blockchain**: Base chain + EAS attestations (POMP reputation)
- **Payments**: Stripe
- **Messaging**: Telegram, WeChat mini-program
- **Email**: Nodemailer / Resend

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
| `DATABASE_URL` | PostgreSQL (Supabase) or MySQL (TiDB) connection string |
| `NEXTAUTH_URL` | Full public URL of the app (e.g. `https://<repl>.replit.app`) |
| `NEXTAUTH_SECRET` | Random secret — generate with `openssl rand -base64 32` |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth (for sign-in) |
| `GEMINI_API_KEY` | Google AI Studio key (for AI features) |

Optional but used by features:
- `EMAIL_SERVER_*` / `EMAIL_FROM` — Magic link email auth
- `OPENAI_API_KEY` — If `AI_PROVIDER=openai`
- `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` — File storage
- `STRIPE_*` — Payments
- `POMP_ISSUER_PRIVATE_KEY`, `POMP_EAS_SCHEMA_UID` — Reputation attestations
- `ALCHEMY_WEBHOOK_SECRET` — On-chain webhook verification
- `TIDB_DATABASE_URL` / `HICLAW_POSTGRES_URL` — HiClaw sub-service

## Database

Switch between PostgreSQL and MySQL by setting `DB_PROVIDER` in `.env`:
- `DB_PROVIDER=supabase` (default) → PostgreSQL adapter
- `DB_PROVIDER=tidb` → MySQL/MariaDB adapter

Run `npm run db:switch` after changing the provider.
