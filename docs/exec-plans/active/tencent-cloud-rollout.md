# Tencent Cloud Rollout — Phased Plan

**Goal:** Two regionally isolated WeChat stacks on Tencent Cloud — mainland CN data stays in CN, overseas data stays in `ap-singapore`. Web users keep the existing Vercel + Supabase path.
**Owner:** PM (solo).
**Companion design:** [`docs/design-docs/architecture.md`](../../design-docs/architecture.md).

The architecture is three stacks, not one with three roles. This file is the **operational checklist** — in order, with what unblocks what.

```
                       ┌──────────────────────────────────────────────────┐
WeChat-Mainland MP  ──→ │ CN TCB proxy ──→ CN SCF ──→ TencentDB CN (ap-shanghai) │
                       │                  └──→ Tencent COS CN                   │
                       │                  └──→ DashScope (Qwen)                 │
                       └──────────────────────────────────────────────────┘
                       ┌──────────────────────────────────────────────────┐
WeChat-Overseas MP  ──→ │ Intl TCB proxy ─→ Intl SCF ─→ TencentDB Intl (ap-singapore) │
                       │                   └─→ Tencent COS Intl                       │
                       │                   └─→ Gemini                                  │
                       └──────────────────────────────────────────────────┘
Browser / Telegram  ──→ Vercel (sin1) ──→ Supabase (AWS ap-southeast-1) ──→ Gemini
```

---

## Status board

| # | Move | Code | Provisioning | Verified |
|---|---|---|---|---|
| 1a | CN TCB proxy deploy | ✅ done | ⬜ pending | ⬜ pending |
| 1b | Intl TCB proxy deploy | ✅ done | ⬜ pending | ⬜ pending |
| 2a | Tencent COS — Intl bucket | ✅ done | ⬜ pending | ⬜ pending |
| 2b | Tencent COS — CN bucket | ✅ done | ⬜ pending | ⬜ pending |
| 3 | WeChat region-aware AI routing | ✅ done | n/a | ⬜ pending |
| 4a | TencentDB Postgres — Intl (`ap-singapore`) | n/a | ⬜ pending | ⬜ pending |
| 4b | TencentDB Postgres — CN (`ap-shanghai`) | n/a | ⬜ pending | ⬜ pending |
| 5a | SCF Web Function — Intl deploy | ⬜ not started | ⬜ pending | ⬜ pending |
| 5b | SCF Web Function — CN deploy | ⬜ not started | ⬜ pending | ⬜ pending |
| 6a | WeChat MP appId — Overseas | n/a | ⬜ pending | ⬜ pending |
| 6b | WeChat MP appId — Mainland | n/a | ⬜ pending | ⬜ pending |
| 7 | ICP filing for CN custom domain | n/a | ⬜ pending | ⬜ pending |
| 8 | WeChat consultation page (TRTC) | ⬜ not started | n/a | ⬜ pending |

Update this table as each row lands.

---

## Solo-PM blockers to know about

- **ICP 备案** is needed only for binding a custom CN domain. `production-wechat-i8ddngeb5eafed-<region>.tcloudbaseapp.com` works without ICP; this unblocks rows 1–5.
- **Two WeChat Mini Program appIds** must be registered separately at `mp.weixin.qq.com`:
  - **Mainland appId** — registered to a mainland-CN business entity, supports WeChat Pay 直连 / 服务商 mode.
  - **Overseas appId** — registered as 海外小程序 (Hong Kong / global business entity), supports WeChat Pay HK or alternative payment rails.
- **TencentDB region must match SCF region** — co-locate to keep query latency under 5ms.

---

## Phase 1 — TCB proxies (CN + Intl)

Both TCB proxies forward to the Vercel origin as a transitional baseline. Once SCFs are deployed (Phase 5), `ORIGIN_BASE_URL` flips to the SCF URL.

### 1.1 Deploy CN TCB proxy

```bash
cd infra/tcb-proxy
# cloudbaserc.cn.json already targets envId=production-wechat-i8ddngeb5eafed (CN)
# adjust ORIGIN_BASE_URL only if the Vercel URL changes
tcb framework deploy -c cloudbaserc.cn.json
```

### 1.2 Deploy Intl TCB proxy

```bash
# Edit cloudbaserc.intl.json with the Intl envId:
#   "envId": "<your intl envId>"
tcb framework deploy -c cloudbaserc.intl.json
```

### 1.3 Verify both proxies stamp headers

```bash
curl https://<cn-envId>-<region>.tcloudbaseapp.com/api/health/origin
# expected: {"ok":true,"wechat":true,"via":"tcb-proxy","from":"wechat","region":"cn"}

curl https://<intl-envId>-<region>.tcloudbaseapp.com/api/health/origin
# expected: {"ok":true,"wechat":true,"via":"tcb-proxy","from":"wechat","region":"intl"}
```

If `region` is missing, the proxy isn't yet stamping `x-forwarded-region`. Verify the corresponding `cloudbaserc.*.json` includes the env var.

---

## Phase 2 — Tencent COS buckets (CN + Intl)

Provision two buckets — one per region — both configured as **私有读写 (private)** with signed-URL access from the SCF Web Function.

| Item | CN | Intl |
|---|---|---|
| Region | `ap-shanghai` | `ap-singapore` |
| Bucket name | `hg-cn-<random>` | `hg-intl-<random>` |
| Used by | CN SCF | Intl SCF |
| Vercel env var (transition) | `TENCENT_COS_*` | n/a (kept on Vercel only for non-WeChat) |

CAM keys at https://console.cloud.tencent.com/cam/capi. The same `SecretId/SecretKey` can read both buckets if the policy allows it; for blast-radius reasons, prefer **two separate sub-account keys**, one per bucket.

---

## Phase 3 — WeChat region-aware AI routing (already shipped)

Code is in `src/lib/ai/index.ts → resolveAIProvider({ request })`. Activation is one env var per stack:

```bash
# Vercel (no change — Gemini default)
# Intl SCF env: keep WECHAT_AI_PROVIDER unset → falls through to AI_PROVIDER (Gemini)
# CN SCF env: WECHAT_AI_PROVIDER=qwen (or hunyuan when supported)
```

---

## Phase 4 — TencentDB Postgres (CN + Intl)

For each region:

1. Tencent Cloud console → **TencentDB for PostgreSQL** → **Create Instance**.
2. Region matches the SCF region (`ap-shanghai` / `ap-singapore`).
3. Network: same VPC + subnet as the SCF will deploy to.
4. Apply the Prisma schema: `prisma migrate deploy` against the new DATABASE_URL.
5. Seed admin / system_config rows as needed.

**Schema parity rule**: every PR that adds a Prisma migration must apply to all three DBs (Supabase, TencentDB CN, TencentDB Intl) before the SCF deploy runs. CI step recommended.

---

## Phase 5 — SCF Web Function (CN + Intl)

Build:
```bash
# next.config.js: output: "standalone"
npm run build
# tar the .next/standalone + .next/static + public into a deployable zip
```

Deploy (per region):
```bash
cd <build dir>
tcb fn deploy --envId <cn or intl envId> --runtime Nodejs18.15 \
  --memory 512 --timeout 60 \
  --env DATABASE_URL=<TencentDB url for that region> \
        STORAGE_PROVIDER=tencent-cos \
        TENCENT_COS_BUCKET=<region bucket> \
        TENCENT_COS_REGION=<region> \
        AI_PROVIDER=<gemini for intl, qwen for cn> \
        NEXTAUTH_URL=<scf custom domain or tcloudbaseapp url>
```

After both SCFs are live, edit each `cloudbaserc.*.json` to point `ORIGIN_BASE_URL` at the SCF URL instead of Vercel, then `tcb framework deploy` again.

---

## Phase 6 — WeChat client builds (CN + Intl)

Two WeChat Mini Program builds, two appIds, two `mp.weixin.qq.com` consoles.

```bash
cd wechat
npm run build:weapp:cn      # writes dist/cn/, sets TARO_APP_API_BASE to CN TCB URL
npm run build:weapp:intl    # writes dist/intl/, sets TARO_APP_API_BASE to Intl TCB URL
```

Each build is uploaded via `miniprogram-ci` (or the WeChat DevTool) using the appId for that region.

WeChat allowlist (per appId):
- **Mainland appId**: `request合法域名` = CN TCB URL; `uploadFile合法域名` = `hg-cn-<random>.cos.ap-shanghai.myqcloud.com`
- **Overseas appId**: `request合法域名` = Intl TCB URL; `uploadFile合法域名` = `hg-intl-<random>.cos.ap-singapore.myqcloud.com`

---

## Phase 7 — ICP filing (CN only, can run in parallel)

Required only to bind a non-`*.tcloudbaseapp.com` domain on the CN side. Process at https://console.cloud.tencent.com/beian. 2–4 weeks. Until it clears, the CN stack uses the `tcloudbaseapp.com` URL.

---

## Phase 8 — WeChat consultation page (TRTC)

Lower priority. Mirrors the upcoming web `/consultation/[bookingId]` using `trtc-wx`. Backend (`/api/trtc/token/`) is ready. Tracked here for completeness; doesn't affect the regional data-isolation rollout.
