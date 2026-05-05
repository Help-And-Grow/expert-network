# API Reference

Generated from [`src/app/api/**`](../src/app/api/). All endpoints are Next.js Route Handlers (Vercel Functions). Authentication is unified by [`resolveUserId(request)`](../src/lib/request-auth.ts) — Auth.js cookie, `x-telegram-init-data`, or `x-wechat-token` — unless explicitly noted as **public** or **webhook**.

Error shape across the app is `NextResponse.json({ error: string }, { status })`. Long-running routes set `export const maxDuration` per Vercel best practice.

The contract test that anchors this doc is [`e2e/smoke/api-contracts.spec.ts`](../e2e/smoke/api-contracts.spec.ts).

---

## Health

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/health` | public | App liveness |
| GET | `/api/db-health` | public | Prisma + DB connectivity (returns Prisma error code on failure) |

## Auth

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET / POST | `/api/auth/[...nextauth]` | Auth.js | Auth.js v5 session, signin/signout, callbacks |
| POST | `/api/auth/telegram` | Telegram initData (rate-limited) | Verify initData → set `tg_user_id` cookie |
| POST | `/api/auth/wechat` | WeChat code (rate-limited) | `code2session` → return `x-wechat-token` JWT |

## User & profile

| Method | Path | Purpose |
|---|---|---|
| GET / PATCH / DELETE | `/api/user` | Read / update / delete current user |
| GET | `/api/user/tokens` | H&G token balance + ledger for player |
| GET | `/api/profile` | Profile bundle for the authenticated user |
| GET / PATCH | `/api/expert/profile` | Read / update the caller's expert record |

## Experts

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/experts` | optional | List / browse experts (filters in query) |
| GET | `/api/experts/[id]` | optional | Expert detail incl. `experienceCapabilities` |
| GET | `/api/experts/[id]/audio` | optional | Voice intro audio |
| GET | `/api/experts/[id]/avatar` | optional | Avatar asset |
| GET | `/api/experts/[id]/document` | optional | Public document |
| GET | `/api/experts/[id]/memories` | required | Expert memories (mem9 / pgvector) |
| GET / POST / DELETE | `/api/experts/[id]/slots` | required (owner) | Manage `AvailableSlot` rows |
| POST | `/api/experts/match` | required | AI-matched recommendations |

## Expert tools

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/expert/improve` | AI-rewrite of an expert profile field |
| POST | `/api/expert/generate-audio` | Generate voice intro (DashScope TTS) |
| POST | `/api/expert/regenerate-image` | Regenerate hero image |
| POST | `/api/expert/voice-clone` | (Out-of-MVP UI) voice clone job |
| GET / POST | `/api/expert/wallet` | Stripe Connect wallet status / actions |

## Onboarding

| Method | Path | Purpose |
|---|---|---|
| GET / POST | `/api/onboarding` | Read / save onboarding draft |
| POST | `/api/onboarding/generate` | AI generation step (bio, services) |
| POST | `/api/onboarding/publish` | Finalize and publish expert profile |
| POST | `/api/onboarding/upload` | Upload onboarding assets |

## Bookings (product copy: meetups)

| Method | Path | Purpose |
|---|---|---|
| GET / POST | `/api/bookings` | List player's meetups / create one |
| GET / PATCH / DELETE | `/api/bookings/[id]` | Read / update / cancel meetup |
| POST | `/api/bookings/checkout` | Stripe Checkout session (rate-limited) |
| POST | `/api/bookings/free` | Zero-price meetup creation (rate-limited) |
| POST | `/api/bookings/paynow` | PayNow QR + reference (SG primary) |
| POST | `/api/bookings/[id]/paynow-submit` | Player submits PayNow proof |
| POST | `/api/bookings/[id]/pay-remainder` | Charge stored card for remainder |
| POST | `/api/bookings/telegram-payment` | Telegram Pay invoice creation |
| POST | `/api/bookings/ton-payment` | TonConnect payment intent |
| POST | `/api/bookings/ton-confirm` | Mark TON payment confirmed |
| POST | `/api/bookings/ton-retry` | Retry TON payment for stuck booking |
| POST | `/api/bookings/wechat-pay` | WeChat Pay JSAPI handoff |
| POST | `/api/bookings/verify` | Post-checkout double-write verification |

## Reviews (product copy: appreciations + coach follow-up)

| Method | Path | Purpose |
|---|---|---|
| GET / POST / PATCH | `/api/reviews` | List / submit appreciation / coach follow-up |

## Voice chat

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/voice-chat/config` | Mode (`async` / `realtime` / `both`) and quotas |
| POST | `/api/voice-chat/greeting` | Opening voice greeting (TTS) |
| POST | `/api/voice-chat/message` | Send turn (rate-limited) — async (with audio) or realtime (text only) |
| POST | `/api/voice-chat/start` | Begin realtime session (rate-limited, 3-min cap) |
| POST | `/api/voice-chat/stop` | End realtime session (rate-limited) |

## Realtime media (premium live consultation)

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/trtc/token` | Issue Tencent TRTC user signature; debits H&G tokens once per booking |

## Discovery & utilities

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/chat` | Generic AI chat (uses `AI_PROVIDER`) |
| POST | `/api/places/autocomplete` | Google Places (New) autocomplete for offline meetup address |
| POST | `/api/places/details` | Place detail lookup |
| POST | `/api/speech-to-text` | DashScope ASR endpoint |

## Invitations

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/invite/status` | Whether the caller has a usable invite code |
| POST | `/api/invite/validate` | Validate an invite code |

## Reputation & on-chain

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/reputation/[expertId]` | Aggregated POMP stats from HiClaw store |
| GET | `/tonconnect-manifest` | TonConnect manifest (browser-fetched) |

## Stripe Connect

| Method | Path | Purpose |
|---|---|---|
| GET / POST | `/api/stripe/connect` | Onboard expert or fetch link |
| GET | `/api/stripe/connect/callback` | OAuth callback |
| GET | `/api/stripe/connect/refresh` | Refresh expired onboarding link |

## Telegram surface

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/telegram/notify` | Internal notification helper |

## Webhooks

All webhooks return `200` whenever possible to prevent provider retry storms.

| Method | Path | Sender | Verify |
|---|---|---|---|
| POST | `/api/webhooks/stripe` | Stripe | HMAC-SHA256 with `STRIPE_WEBHOOK_SECRET` (300s tolerance), `maxDuration=30` |
| POST | `/api/webhooks/telegram` | Telegram | Bot token HMAC |
| POST | `/api/webhooks/wechat-pay` | WeChat Pay | WeChat Pay APIv3 signature |
| POST | `/api/webhook/onchain` | Alchemy Custom Webhook | HMAC `ALCHEMY_WEBHOOK_SECRET`; ingests EAS `Attested` logs |

## Background

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/cron/charge-remainder` | Vercel cron (UTC) — daily remainder charging. Skips when `CRON_DELEGATED_TO_INNGEST=1` |
| GET / POST / PUT | `/api/inngest` | Inngest serve handler (`maxDuration=300`) — registers `chargeRemainderScheduled`, `pompIssueOnBookingCompleted` |

## tRPC

| Method | Path | Purpose |
|---|---|---|
| GET / POST | `/api/trpc/[trpc]` | tRPC v11 fetch adapter — procedures in [`src/trpc/root.ts`](../src/trpc/root.ts) |

## MCP server

| Method | Path | Purpose |
|---|---|---|
| GET / POST / DELETE | `/api/mcp` | Model Context Protocol — exposes expert search / match / availability as tools for AI agents |

## Public API (`/api/v1/*`) — auth-free GET

These are intentionally auth-free and scoped to non-sensitive read paths for agent / skill consumption.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/v1/domains` | Available expertise domains |
| GET | `/api/v1/experts` | Public expert listing |
| GET | `/api/v1/match` | AI-match by query |

## Admin (`/api/admin/*`) — admin role required

| Method | Path | Purpose |
|---|---|---|
| GET / POST | `/api/admin/ai-provider` | Switch `AI_PROVIDER` on Vercel and trigger redeploy |
| GET | `/api/admin/bookings` | Admin meetup overview |
| POST | `/api/admin/bookings/[id]/paynow-confirm` | Confirm PayNow payment manually |
| GET / POST | `/api/admin/invite-codes` | List / mint invite codes |
| POST | `/api/admin/migrate` | Run admin SQL (e.g. pgvector setup) |
| POST | `/api/admin/pgvector-backfill` | Backfill `expert_memory_embeddings` |
| GET | `/api/admin/stats` | Platform stats |
| GET / POST | `/api/admin/tidb` | Legacy TiDB console (kept for HiClaw schema operations) |
| GET / PATCH | `/api/admin/users` | List / update users |

## Debug (`/api/debug/*`) — admin + env-gated

Requires `DEBUG_API_ENABLED=1` for reads in production. Destructive routes additionally require `DEBUG_MUTATION_ENABLED=1`.

| Method | Path | Mutation? |
|---|---|---|
| GET | `/api/debug/bookings` | no |
| POST | `/api/debug/clean` | **yes** |
| POST | `/api/debug/db-push` | **yes** |
| GET | `/api/debug/db-test` | no |
| POST | `/api/debug/delete-user` | **yes** |
| GET | `/api/debug/stripe-test` | no |
| GET | `/api/debug/telegram-users` | no |
| GET | `/api/debug/users` | no |
| POST | `/api/debug/wechat-client-log` | no (rate-limited; requires `WECHAT_CLIENT_LOG=1` in production) |

---

## Conventions

- All routes return `NextResponse.json()` with consistent error shapes.
- Notification calls (Telegram, WeChat) are fire-and-forget: `.catch(() => {})`.
- Use `export const maxDuration` for long-running serverless functions (LLM calls, webhooks, Inngest).
- Inputs validated at boundary with Zod or runtime checks; rollout is incremental — see [`docs/QUALITY_SCORE.md`](QUALITY_SCORE.md).
- Auth resolution order in [`resolveUserId`](../src/lib/request-auth.ts): WeChat → Telegram → Auth.js cookie.

## Contract assertions

Pinned by [`e2e/smoke/api-contracts.spec.ts`](../e2e/smoke/api-contracts.spec.ts):

| Endpoint | Contract |
|---|---|
| `GET /api/health` | 200 with body `{ ok: true, service: "expert-network" }` |
| `GET /api/v1/experts?limit=N` | 200 with body `{ experts: [...] }` |
| `POST /api/bookings/checkout` (no session) | 401 |
| `POST /api/bookings/wechat-pay` (no session) | 401 |
| `POST /api/bookings/[id]/pay-remainder` (no session) | 401 |

When changing any of these, update both the route and the spec — they are co-located by intent.
