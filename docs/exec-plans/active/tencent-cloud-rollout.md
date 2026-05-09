# Tencent Cloud Rollout — Current WeChat Intl First

**Goal:** ship the current international WeChat Mini Program for user testing on Tencent CloudBase + Hunyuan, while keeping the mainland-CN mini program as a later, separate app after the China company and AppID are ready.

**Companion design:** [`docs/design-docs/architecture.md`](../../design-docs/architecture.md).

## Current Decision

| Topic | Decision |
|---|---|
| Current WeChat app | International Mini Program registered through the Singapore company |
| Current AppID | `wx09d0eb079596060d` |
| Current build region | `intl` |
| Current CloudBase env | `cn-wechat-d1gzncs8i34827c98` |
| Current backend URL | `https://cn-wechat-d1gzncs8i34827c98-1426867475.ap-shanghai.app.tcloudbase.com` |
| Current AI provider | Tencent Hunyuan |
| Current database posture | Tencent-side DB synced from Supabase today; future source may be Google Cloud DB |
| Mainland CN app | Future phase, separate AppID/company/review/payment path |

The `cn-wechat` env name is historical. It is the active Tencent CloudBase backend for the current international user test.

## Tencent Cloud International Singapore Cleanup

Status on 2026-05-05: the separate Tencent Cloud International Singapore experiment is **removed**. This was the CodeBuddy/IDE-created `infra/tencent-intl/` path, not a new required phase-1 dependency.

| Resource | ID / path | Status |
|---|---|---|
| PostgreSQL | `postgres-8bqbytbh` | Deleted |
| COS bucket | `sg-expert-network-1424085034` | Deleted |
| Subnets | `subnet-lrcgprpg`, `subnet-91o4zq0c` | Deleted |
| VPC | `vpc-2ari99bl` | Deleted |
| Local config | `infra/tencent-intl/`, `.cos.conf` | Cleaned |

Do not recreate this Singapore Tencent stack unless the product decision explicitly changes back to Tencent Cloud International infrastructure. For phase-1 Web/Telegram work, continue to use Vercel plus the current global Postgres posture tracked in [`supabase-to-cloudsql-migration.md`](supabase-to-cloudsql-migration.md).

## Status Board

| # | Move | Status |
|---|---|---|
| 1 | SCF backend deployed to CloudBase env `cn-wechat-d1gzncs8i34827c98` | Done |
| 2 | SCF runtime forced to Node 20.19 | Done |
| 3 | Next.js 15 startup imports patched for SCF bundle pruning | Done |
| 4 | CloudBase `/api` HTTP access route set as `WEB_SCF` with path passthrough | Done |
| 5 | `/api/health/origin` returns 200 from CloudBase domain | Done |
| 6 | WeChat intl client config points at current CloudBase backend | Done |
| 7 | Mini program initializes CloudBase env on launch | Done |
| 8 | MP legal domains configured in WeChat admin | Manual |
| 9 | Real-device smoke test | Pending |
| 10 | Experience version upload and tester assignment | Pending |
| 11 | Exposed secret rotation | Required before broader testing |

## Current Architecture

```text
Web / Telegram onboarding
        |
        v
Global primary DB (Supabase today; future Google Cloud DB candidate)
        |
        | sync
        v
Tencent-side WeChat DB
        |
        v
CloudBase / SCF backend (Hunyuan + Tencent COS)
        |
        v
International WeChat Mini Program (intl build)
```

This gives the current mini program visibility into experts onboarded from Web and Telegram while keeping WeChat runtime dependencies on Tencent infrastructure.

## Backend Deploy

Run from the Tencent Cloud Lighthouse instance:

```bash
cd /root/expert-network
git fetch --no-tags origin main
git merge --ff-only FETCH_HEAD
npm run cn:deploy
```

Despite the `cn:*` script name, this currently deploys the backend used by the international mini program. The generated SCF runtime env sets:

```text
IS_WECHAT=true
PROXY_REGION=intl
AI_PROVIDER=hunyuan
STORAGE_PROVIDER=tencent-cos
```

Verify:

```bash
curl -i https://cn-wechat-d1gzncs8i34827c98-1426867475.ap-shanghai.app.tcloudbase.com/api/health/origin
```

After redeploy from this plan, expected body:

```json
{"ok":true,"wechat":true,"region":"intl","via":null,"from":null}
```

The SCF runtime must also set:

```bash
NEXTAUTH_URL_CN=https://cn-wechat-d1gzncs8i34827c98-1426867475.ap-shanghai.app.tcloudbase.com
```

`deploy.sh` maps this to `NEXTAUTH_URL` in `cloudbaserc.json`; without it, production env validation can fail while loading DB-backed routes such as `/api/auth/wechat`.

## Mini Program Build

From repo root or local workstation:

```bash
cd wechat
npm ci
npm run build:weapp:intl
```

Then import `/Users/qiumiao/Downloads/expert-network/wechat` into WeChat DevTools. `project.config.json` points DevTools at `./dist-intl`.

## Upload Experience Version

From repo root:

```bash
npm run wechat:upload:intl -- 1.0.3 "intl user test"
```

or:

```bash
npm run wechat:upload:local -- --region intl 1.0.3 "intl user test"
```

The upload key must belong to AppID `wx09d0eb079596060d`.

## WeChat Admin Manual Tasks

For AppID `wx09d0eb079596060d`:

| Setting | Value |
|---|---|
| request合法域名 | `https://cn-wechat-d1gzncs8i34827c98-1426867475.ap-shanghai.app.tcloudbase.com` |
| uploadFile合法域名 | same CloudBase domain; plus COS domain if direct COS upload/download is exposed |
| downloadFile合法域名 | same CloudBase domain; plus COS domain for direct audio/doc/avatar URLs |
| Experience members | Add the user-test accounts |

## Real-Device Smoke Test

- Launch app: no CloudBase init error.
- Login: `/api/auth/wechat` returns 200.
- Discover: experts synced from Web/Telegram appear.
- Expert detail: profile, avatar, audio/document links work.
- Onboarding: upload and publish path works.
- Voice: greeting and question flow work.
- Booking: shared web booking handoff works.

## Future Mainland CN Phase

Do not use `build-config/cn.json` for the current user test. It is intentionally blocked with `PENDING_*` placeholders until:

- Chinese company is ready.
- Mainland AppID exists.
- Mainland WeChat Pay/merchant path is chosen.
- Separate mainland legal domains and review materials are ready.
