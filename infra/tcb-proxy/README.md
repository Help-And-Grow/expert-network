# TCB Proxy: WeChat → GCP

Tencent CloudBase (TCB) HTTP-trigger function that bridges WeChat Mini Program traffic to the GCP Cloud Run origin in `asia-southeast1`. WeChat clients can only reach a small allowlist of mainland-China-fronting domains, so this proxy terminates inside that allowlist and forwards to GCP.

## Layout

```
infra/tcb-proxy/
├── index.js                # `main_handler` — request forwarder
├── package.json            # deploy/logs scripts
├── cloudbaserc.cn.json     # CN env manifest (mainland WeChat MP)
├── cloudbaserc.intl.json   # Intl env manifest (overseas WeChat MP)
└── README.md
```

Two TCB envs, one per WeChat audience. See [`docs/exec-plans/active/tencent-cloud-rollout.md`](../../docs/exec-plans/active/tencent-cloud-rollout.md) for the full rollout plan.

## Required environment variables (set on the function)

| Variable               | Purpose                                                                                    |
| ---------------------- | ------------------------------------------------------------------------------------------ |
| `ORIGIN_BASE_URL`      | Backend origin URL — Vercel today, SCF Web Function in the same region after Move 5        |
| `PROXY_REGION`         | `cn` or `intl`. Stamped to `x-forwarded-region` so the origin picks the right DB / COS / AI |
| `FORWARD_HEADERS`      | (Optional) comma-separated allowlist; defaults to a sensible WeChat-friendly set           |
| `PROXY_SHARED_SECRET`  | (Optional) require clients to send `x-tcb-secret: <value>`; rejected with 403 if mismatch  |

The function automatically stamps every forwarded request with:
- `x-forwarded-via: tcb-proxy`
- `x-forwarded-from: wechat`
- `x-forwarded-region: <PROXY_REGION>` (when set)

The Next.js origin reads these via `lib/request-origin.ts` to make region-aware decisions (storage routing, AI provider selection, eventually database selection).

## Deploy

```bash
# 1. Install Tencent CloudBase CLI globally (once)
npm install -g @cloudbase/cli

# 2. Authenticate against the matching account (intl vs CN — they're different consoles)
tcb login

# 3. From this directory, deploy each env separately:
cd infra/tcb-proxy

# Mainland CN env (CN account, cloud.tencent.com)
tcb framework deploy -c cloudbaserc.cn.json

# Overseas env (intl account, intl.cloud.tencent.com) — fill in envId first
tcb framework deploy -c cloudbaserc.intl.json
```

After deploy, the function is reachable at:

```
https://<envId>-<region>.tcloudbaseapp.com/<path>
# or via custom WeChat-allowlisted domain bound in the TCB console
```

Add the resulting URL to the WeChat Mini Program's `request` allowlist (业务域名 / request domain) and point the WeChat client base URL at it.

## Local smoke test

```bash
node -e '
  const { main_handler } = require("./index.js");
  process.env.ORIGIN_BASE_URL = "https://expert-network.example.run.app";
  main_handler({
    httpMethod: "GET",
    path: "/api/health",
    headers: { "content-type": "application/json" },
  }).then(console.log);
'
```

## Operational notes

- Cold start budget is ~250 MB / 30 s; revisit `cloudbaserc.json` if upstream latency from `asia-southeast1` requires a longer timeout.
- The function uses native `fetch` (Node 18+) — no extra dependencies beyond TCB's runtime.
- Binary responses (images, audio) are base64-encoded back through the API Gateway via `isBase64Encoded: true`.
