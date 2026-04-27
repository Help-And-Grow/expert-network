# TCB Proxy: WeChat → GCP

Tencent CloudBase (TCB) HTTP-trigger function that bridges WeChat Mini Program traffic to the GCP Cloud Run origin in `asia-southeast1`. WeChat clients can only reach a small allowlist of mainland-China-fronting domains, so this proxy terminates inside that allowlist and forwards to GCP.

## Layout

```
infra/tcb-proxy/
├── index.js          # `main_handler` — request forwarder
├── package.json      # deploy/logs scripts
├── cloudbaserc.json  # @cloudbase/cli deployment manifest
└── README.md
```

## Required environment variables (set on the function)

| Variable               | Purpose                                                                                    |
| ---------------------- | ------------------------------------------------------------------------------------------ |
| `ORIGIN_BASE_URL`      | Cloud Run origin URL — e.g. `https://expert-network-xxxx-as.a.run.app`                     |
| `FORWARD_HEADERS`      | (Optional) comma-separated allowlist; defaults to a sensible WeChat-friendly set           |
| `PROXY_SHARED_SECRET`  | (Optional) require clients to send `x-tcb-secret: <value>`; rejected with 403 if mismatch  |

The function automatically stamps every forwarded request with:
- `x-forwarded-via: tcb-proxy`
- `x-forwarded-from: wechat`

The Next.js origin reads these via `lib/request-origin.ts` to make region-aware decisions (e.g. routing uploads to Tencent COS instead of GCS).

## Deploy

```bash
# 1. Install Tencent CloudBase CLI globally (once)
npm install -g @cloudbase/cli

# 2. Authenticate
tcb login

# 3. From this directory:
cd infra/tcb-proxy
# fill in REPLACE_WITH_TCB_ENV_ID and the ORIGIN_BASE_URL placeholder in cloudbaserc.json first
tcb framework deploy
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
