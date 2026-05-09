# WeChat Mini Program (Help & Grow)

Help & Grow operates **two separate WeChat Mini Programs** for different markets, with strict data residency controls.

## International App (Singapore Company)

**Positioning**: Free mentoring platform helping youth learn AI in building products.

| Item | Value |
|---|---|
| Build region | `intl` |
| AppID | `wx09d0eb079596060d` |
| Company | Registered in Singapore |
| API base | `https://www.help-and-grow.com` |
| Backend | Vercel Functions (same as Web + Telegram) |
| AI | Qwen / DashScope (primary) → Gemini (fallback) |
| Database posture | Same Cloud SQL for PostgreSQL as Web/Telegram (no Tencent-side replica) |

## China Mainland App (Future — Chinese Company)

**Positioning**: Localized expert network for China mainland users.

| Item | Value |
|---|---|
| Build region | `cn` |
| AppID | `PENDING_*` (requires China company registration) |
| Company | To be registered in China |
| Cloud infra | **China-local Tencent Cloud** (separate stack) |
| AI provider | **Hunyuan** (Tencent's LLM) |
| Data residency | 🔒 **All data stored and processed only within China mainland** |

### Data Residency Principle (China App)

- Separate Tencent Cloud account and infrastructure stack
- Separate database (no sync with international DB)
- Separate object storage (COS China region)
- AI processing via Hunyuan (data stays in China)
- **No cross-border data transfer** for China-app users

`build-config/cn.json` intentionally contains `PENDING_*` values until the China company, mainland AppID, and review path are ready.

## Build for WeChat DevTools

```bash
cd wechat
npm ci
npm run build:weapp:intl
```

Import `/Users/qiumiao/Downloads/expert-network/wechat` in WeChat DevTools. The root `project.config.json` points `miniprogramRoot` at `./dist-intl`, so DevTools loads the international build output.

## Domain Allowlist

In `mp.weixin.qq.com` for AppID `wx09d0eb079596060d`, configure:

| WeChat setting | Required domain |
|---|---|
| request合法域名 | `https://www.help-and-grow.com` |
| uploadFile合法域名 | `https://www.help-and-grow.com` |
| downloadFile合法域名 | `https://www.help-and-grow.com` |

For local simulator debugging only, DevTools can disable domain verification. Real-device preview and experience versions should use the allowlist above.

## Upload an Experience Version

From repo root:

```bash
npm run wechat:upload:intl -- 1.0.3 "intl user test"
```

or use the local helper:

```bash
npm run wechat:upload:local -- --region intl 1.0.3 "intl user test"
```

The upload key should be the WeChat code-upload PEM for AppID `wx09d0eb079596060d`, either:

- `wechat/private.wx09d0eb079596060d.key`
- or `WECHAT_CI_KEY_PATH=/absolute/path/to/key`

Upload does not publish to all users. Assign testers to the experience version or submit for review in the WeChat MP console.

## Debugging

Mini Program code runs in WeChat DevTools or on the user's phone. Client `console.log` output does not appear in Vercel logs.

Use:

- WeChat DevTools Console / Network for frontend errors.
- Vercel logs for `/api/*` backend errors (same backend as web).

Optional client log forwarding:

| Variable | Where | Purpose |
|---|---|---|
| `TARO_APP_CLIENT_LOG=1` | WeChat build env | Sends selected client errors to `/api/debug/wechat-client-log` |
| `WECHAT_CLIENT_LOG=1` | SCF runtime env | Allows that debug endpoint in production |

## Important Product Gaps for User Test

- Booking from the mini program currently uses the shared web booking flow rather than fully native WeChat Pay.
- The membership page is hidden until WeChat Pay is provisioned.
