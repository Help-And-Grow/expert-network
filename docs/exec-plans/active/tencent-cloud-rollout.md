# Tencent Cloud Rollout — Phased Plan

**Goal:** Fully host the WeChat path on Tencent Cloud to cut CN-region latency and prepare for scale.
**Owner:** PM (solo).
**Companion design:** [`docs/design-docs/architecture.md`](../../design-docs/architecture.md).

The 5 moves are listed in `architecture.md`. This file is the **operational checklist** — in order, with what unblocks what.

---

## Move 1 — TCB proxy + Tencent COS (provisioning only)

Code is already in-repo. This phase is pure ops.

### 1.1 Create the TCB environment

1. Sign in to [Tencent Cloud Console](https://console.cloud.tencent.com/) with an **enterprise-verified** account (personal accounts hit cap on TCB requests).
2. Open **CloudBase (云开发)** → **环境管理** → **新建环境**.
   - Plan: 按量计费 (pay-as-you-go) is fine for early stage.
   - Region: **`ap-shanghai`** or **`ap-guangzhou`** — pick whichever is closest to your WeChat user majority.
3. Note the `envId` (looks like `hg-prod-1g2x3y4z5`).

### 1.2 Deploy the TCB proxy function

```bash
# one-time
npm install -g @cloudbase/cli
tcb login

# every deploy
cd infra/tcb-proxy
# Edit cloudbaserc.json:
#   "envId": "<your envId>"
#   ORIGIN_BASE_URL: "https://expert-network.vercel.app"   # the Vercel origin for now
tcb framework deploy
```

Default function URL after deploy: `https://<envId>-<region>.tcloudbaseapp.com/`.

### 1.3 Verify the proxy stamps headers

```bash
curl https://<envId>-<region>.tcloudbaseapp.com/api/health/origin
# expected: {"ok":true,"wechat":true,"via":"tcb-proxy","from":"wechat"}
```

If `wechat` is `false`, the request didn't transit the proxy — confirm the `cloudbaserc.json` web trigger config and that your curl URL is the TCB function URL, not the Vercel one.

### 1.4 Provision Tencent COS

1. **CAM (访问管理)** → **API 密钥管理** → **新建密钥**. Copy `SecretId` + `SecretKey`.
2. **COS (对象存储)** → **存储桶列表** → **创建存储桶**.
   - Name: `hg-wechat-<random>` (the AppID suffix is auto-appended).
   - Region: same as TCB env above.
   - Permissions: **私有读写** (private). Public objects are served via temporary signed URLs from the storage provider.
3. Set Vercel env vars:
   ```
   TENCENT_COS_SECRET_ID=<SecretId>
   TENCENT_COS_SECRET_KEY=<SecretKey>
   TENCENT_COS_BUCKET=hg-wechat-1300000000   # full name with AppID suffix
   TENCENT_COS_REGION=ap-shanghai             # match COS bucket region
   ```
4. Redeploy the Next.js app on Vercel (`vercel --prod` or push to `main`).

### 1.5 Add the TCB domain to WeChat allowlists

In the WeChat Mini Program admin console (`mp.weixin.qq.com`):

- **开发管理 → 开发设置 → 服务器域名**:
  - `request合法域名`: add `https://<envId>-<region>.tcloudbaseapp.com`
  - `uploadFile合法域名`: add `https://<bucket>.cos.<region>.myqcloud.com`
  - `downloadFile合法域名`: same as uploadFile

### 1.6 Point the WeChat client at the TCB proxy

The Mini Program reads its API base from `process.env.TARO_APP_API_BASE` at build time (`wechat/src/shared/auth.ts:77`).

```bash
# wechat/.env.production (Taro consumes this on build)
TARO_APP_API_BASE=https://<envId>-<region>.tcloudbaseapp.com
```

Re-run `npm run build:weapp` and re-upload via `miniprogram-ci`.

### Verification

| Check | Expected |
|---|---|
| `curl <TCB url>/api/health/origin` from a CN IP | `{"ok":true,"wechat":true,...}` |
| WeChat client opens, hits Discover, sees experts | matches normal flow |
| Avatar upload from WeChat lands in COS bucket | inspect COS bucket — file present |
| Avatar upload from web (browser) lands in Vercel Blob/GCS | unchanged |

**Status target after Move 1:** WeChat asset uploads stay in CN; API still goes to Vercel sin1 (acceptable until Move 2).

---

## Move 2 — Backend on Tencent SCF Web Function

Largest latency win, also the biggest move. **Do not start until Move 1 is verified.**

Plan:

1. Build Next.js as `output: "standalone"`. Containerize with the Tencent SCF Node 18 base image.
2. Create a SCF Web Function in the same region as TCB env. Bind `ORIGIN_BASE_URL` of the TCB proxy to the SCF URL instead of the Vercel URL.
3. CI: GitHub Action that builds + uploads via `tcb fn deploy`. Mirror the existing Vercel deploy workflow.
4. Vercel stays the canonical origin for non-WeChat traffic; SCF is WeChat-only.
5. Migrate cron: replace Vercel Cron with **SCF Timer Trigger** for `/api/cron/charge-remainder` against the SCF URL.

ICP filing required only when binding a custom domain — `tcloudbaseapp.com` works without ICP.

---

## Move 3 — WeChat-origin AI routing

Picks Qwen (DashScope) for WeChat-originated requests instead of Gemini. Implemented in code.

Activation:
- Set `WECHAT_AI_PROVIDER=qwen` in Vercel + SCF env.
- Ensure `DASHSCOPE_API_KEY` is set.

No re-deploy needed beyond env push — provider resolution is per-request once the env var is read.

---

## Move 4 — WeChat consultation page

`wechat/src/pages/consultation/[bookingId]/` — mirrors the upcoming web `/consultation/[bookingId]`. Uses `trtc-wx` SDK. Backend is ready (`/api/trtc/token`).

Phased per `product-features.md §2`. Not a latency move; tracked here so the WeChat surface reaches feature parity.

---

## Move 5 — Database co-location

TencentDB for PostgreSQL in `ap-shanghai`, with read replica from Supabase. Or full migration. Open question; revisit after Move 2 traces show DB latency is the next bottleneck.

---

## Status board

| Move | Code | Provisioning | Verified |
|---|---|---|---|
| 1 — TCB + COS | ✅ done | ⬜ pending | ⬜ pending |
| 2 — SCF backend | ⬜ not started | ⬜ pending | ⬜ pending |
| 3 — CN-AI routing | ⬜ in progress | n/a | ⬜ pending |
| 4 — WeChat consultation page | ⬜ not started | ⬜ pending | ⬜ pending |
| 5 — DB co-location | ⬜ not started | ⬜ pending | ⬜ pending |

Update this table as each move lands.
