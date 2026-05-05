# Tencent Cloud Rollout — Paused Until Mainland-CN MP

**Status (2026-05-05):** intl WeChat MP runs on **Vercel** alongside Web/Telegram. The Tencent CloudBase + SCF + Hunyuan + Tencent COS stack is **paused as a dev sandbox** for the future mainland-CN MP.

**Goal of this doc:** keep the SCF spike in the repo so it's a head-start when the Chinese company / mainland AppID / WeChat Pay merchant / ICP filing finally clear (~Sep 2026+). Until then, no production traffic should hit Tencent infrastructure.

**Companion design:** [`docs/design-docs/architecture.md`](../../design-docs/architecture.md).

---

## Current Decision

| Topic | Decision |
|---|---|
| Current intl WeChat backend | **Vercel** at canonical `https://www.help-and-grow.com` (alias: `expert-network.vercel.app`), same as Web + Telegram |
| Current intl WeChat AI | **Qwen → Gemini chain**, same as Web + Telegram (no Hunyuan) |
| Current intl WeChat database | Supabase Postgres now → Cloud SQL planned (same as Web) |
| Current intl WeChat storage | Vercel Blob (same as Web) |
| Current intl AppID | `wx09d0eb079596060d` (Singapore-company app) |
| Tencent CloudBase env `cn-wechat-d1gzncs8i34827c98` | **Paused dev sandbox** for the future mainland-CN MP |
| Mainland-CN MP | Future phase — separate AppID/company/review/payment/ICP |
| Mainland-CN target stack | Tencent CloudBase + SCF Web Function + Hunyuan + Tencent COS + TencentDB CN |

The `cn-wechat-*` env name was a 2026-04 historical experiment. It is no longer the active backend for the intl user test.

---

## Why the pivot away from Tencent for the intl MP

The 2026-04 plan put the intl WeChat MP on Tencent SCF + Hunyuan as a "data-residency / native-AI" win. Three reasons that no longer match reality:

1. **The intl MP audience is not in mainland CN.** It's HK / TW / SEA / global Chinese-speaking diaspora. They don't trigger PIPL, don't need a CN-resident database, and don't need a Sogou-grounded LLM.
2. **Operational cost of two stacks.** Maintaining a parallel SCF deployment for the intl MP doubled the surface area (deploy pipelines, env vars, secret rotation, observability, schema sync) for an audience that's < 5% of total traffic in this phase.
3. **The mainland-CN MP needs Tencent Cloud anyway.** Building it on the SCF spike (instead of trying to share the intl SCF) keeps the data-residency story crisp: mainland data → Tencent only; everything else → Vercel.

---

## Status Board (paused work, kept for the mainland-CN phase)

| # | Move | Status | Notes |
|---|---|---|---|
| 1 | SCF backend deployable to CloudBase env `cn-wechat-d1gzncs8i34827c98` | Done — paused | Re-purpose for mainland-CN dev sandbox |
| 2 | SCF runtime forced to Node 20.19 | Done | |
| 3 | Next.js 15 startup imports patched for SCF bundle pruning | Done | |
| 4 | CloudBase `/api` HTTP access route set as `WEB_SCF` with path passthrough | Done | |
| 5 | `/api/health/origin` returns 200 from CloudBase domain | Done — paused | |
| 6 | Hunyuan AI provider integration | Done | Live behind `WECHAT_AI_PROVIDER=hunyuan` flag, dormant today |
| 7 | Tencent COS storage driver | Done | Wired in `getStorageProvider`, dormant on intl path |
| 8 | TRTC entitlement branching (membership vs tokens) | Done | Active on Vercel today; gates membership when WeChat-CN traffic eventually arrives |
| 9 | Mainland-CN AppID registration | **Blocked on Chinese company** | |
| 10 | Mainland-CN ICP filing for custom domain | **Blocked on Chinese company** | |
| 11 | Mainland-CN WeChat Pay merchant | **Blocked on Chinese company** | |
| 12 | Mainland-CN MP review submission | **Blocked on Chinese company** | |

---

## Architecture today (intl phase)

```text
Web / Telegram users          WeChat-Intl Mini Program
       \                              /
        \                            /
         v                          v
                  Vercel Functions (sin1)
                          |
                          v
              Supabase Postgres (→ Cloud SQL planned)
                          |
                          v
                Vercel Blob + Qwen → Gemini AI chain
```

**One stack.** No Tencent infra on the production path.

---

## Architecture future (post-Sep 2026 mainland-CN phase)

```text
Web / Telegram + WeChat-Intl users          WeChat-CN Mini Program
              \                                       /
               v                                     v
                                    Tencent CloudBase / SCF (ap-shanghai)
        Vercel (sin1)                           |
              |                                  v
              v                          TencentDB CN + Tencent COS
   Supabase / Cloud SQL                          |
                                                 v
                                          Hunyuan + Tencent native search
```

**Two stacks.** Mainland-CN traffic stays inside Tencent Cloud. Global traffic stays on Vercel.

---

## What to keep working on now (independent of Tencent rollout)

These all live on the Vercel stack and benefit the intl MP today:

- **Supabase → Cloud SQL migration** ([`supabase-to-cloudsql-migration.md`](./supabase-to-cloudsql-migration.md)).
- **Semantic expert search** ([`semantic-expert-search.md`](./semantic-expert-search.md)) — Phase 3 hardening + Phase 4 production rollout.
- **WeChat-Intl client UX** — same backend as Web, so any improvement to onboarding / discover / booking ships everywhere.

---

## What's deferred until the Chinese company opens

- TencentDB CN provisioning (cross-region read replica or full primary; revisit at decision time).
- ICP filing for custom CN domain.
- Mainland WeChat Pay merchant + 分账 setup.
- Mainland AppID registration + 服务器域名 allowlist.
- Mainland MP review materials + privacy policy.
- TencentDB-CN-side Prisma migration parity.

When that work picks up again, the SCF spike (envId `cn-wechat-d1gzncs8i34827c98`, deploy script, Hunyuan provider, COS driver) is the head-start. None of it needs to be re-built.
