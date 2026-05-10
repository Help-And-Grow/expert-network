# Plans & Roadmap

**Product:** [Help & Grow](BRAND.md) — **AI Native Expert Network** (vision: *service as agent*; community: everyone **expert + player + coach**, learning by doing / growing by helping).

## Current Priorities

1. **Stability**: Ensure Stripe webhooks, payment flows, and notifications are reliable across all platforms
2. **Feature + integration testing**: Web app + **Telegram** flows (WeChat polish **on hold**)
3. **AI matching**: Improve expert recommendation quality with richer context
4. **Growth**: SEO, sharing features, referral mechanics

## Upcoming Work

- [x] **Next.js 15 upgrade** — [completed plan](exec-plans/completed/nextjs-15-upgrade.md) (run manual QA on preview before prod)
- [x] **AI Voice Chat** — Feature-toggled (`VOICE_CHAT_MODE`): async voice messaging (default, 5-reply free cap) + realtime AI chat; Web, Telegram, WeChat
- [ ] **AI Voice Chat — Realtime deployment** — Realtime readiness depends on DashScope/Qwen (`DASHSCOPE_API_KEY`); verify the timed chat UX on web and Telegram when `VOICE_CHAT_MODE` includes `realtime`
- [ ] WeChat Mini Program public release (**on hold** — Web + Telegram testing first)
- [x] **Web/Telegram DB cutover from Supabase to Google Cloud SQL** — completed 2026-05-03; archived [migration record](exec-plans/archive/supabase-to-cloudsql-migration.md)
- [ ] Expert earnings dashboard (view payouts, transaction history)
- [ ] Group sessions / workshop meetup support
- [ ] Avatar language switching quality (English, Chinese, Malay) — keep chat UI free of translation buttons
- [ ] Push notifications for meetup reminders

## Recently Completed

- [x] POMP (Proof of Meet Protocol): on-chain proof for expert + player each completed meetup (EAS on Base)
- [x] H&G Token (ERC-20): 1:1 SGD earn ratio, 100:1 SGD redemption for meetup discounts
- [x] MCP server exposing Help & Grow for AI agent integration
- [x] OpenClaw/QClaw skill for agent-based expert discovery
- [x] Invitation code system for platform quality control
- [x] Admin dashboard (overview, users, meetups / `Booking` admin, invites)
- [x] Jitsi Meet auto-generated meeting links
- [x] Email notifications via Resend (confirmation + 1hr reminder)
- [x] Stripe live mode integration with Connected Accounts
- [x] WeChat Mini Program MVP with full feature parity
- [x] Multi-provider AI system (Qwen, Gemini, Hunyuan, OpenAI, Z.AI, BytePlus, Volcengine)
- [x] Two-way appreciation flow (player rates expert, coach follow-up)
- [x] Free meetup flow for experts with zero pricing
- [x] Stripe webhook fix (secret mismatch on Vercel)

## Decision Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-03 | POMP via **EAS** (Ethereum Attestation Service) on Base for every meeting | No protocol subscription; pay Base gas only; standard tooling + EASScan |
| 2026-03 | H&G ERC-20 token for player rewards | Incentivize meetups, redeemable for discounts |
| 2026-03 | MCP + OpenClaw skill for agent integration | Platform-as-a-service for AI agents |
| 2026-03 | Jitsi Meet for video calls | Free, no API key needed, auto-generated links |
| 2026-03 | Resend for transactional email | Free tier sufficient, scheduled send support |
| 2026-03 | Switch primary DB to Supabase PostgreSQL | TiDB cold-start timeouts in serverless |
| 2026-03 | Use Qwen as primary AI in production | Better Chinese language support for SEA market |
| 2026-03 | Remove WhatsApp integration | Low adoption, maintenance burden |
| 2026-03 | Stripe Express Connect for experts | Simplest marketplace payout model |
| 2026-04 | AI voice chat with feature toggle | `VOICE_CHAT_MODE`: async, realtime, or both; public voice stack is DashScope/Qwen with a 5-reply async cap |

See [docs/exec-plans/](exec-plans/) for detailed execution plans.
