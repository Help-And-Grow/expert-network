# WeChat Mini Program (Help & Grow)

## Current User-Test Target

The active user-test app is the **international WeChat Mini Program** registered through the Singapore company.

| Item | Current value |
|---|---|
| Build region | `intl` |
| AppID | `wx09d0eb079596060d` |
| CloudBase env | `cn-wechat-d1gzncs8i34827c98` |
| API base | `https://cn-wechat-d1gzncs8i34827c98-1426867475.ap-shanghai.app.tcloudbase.com` |
| Backend | Tencent CloudBase / SCF Web Function |
| AI | Tencent Hunyuan for WeChat-originated backend traffic |
| Database posture | Tencent-side database is synchronized from Supabase today; future source may move to Google Cloud DB |

The mainland China mini program is future work. `build-config/cn.json` intentionally contains `PENDING_*` values until the China company, mainland AppID, and review path are ready.

## Build for WeChat DevTools

```bash
cd wechat
npm ci
npm run build:weapp:intl
```

Import `/Users/qiumiao/Downloads/expert-network/wechat` in WeChat DevTools. The root `project.config.json` points `miniprogramRoot` at `./dist/intl`, so DevTools loads the international build output.

The app calls `Taro.cloud.init({ env: "cn-wechat-d1gzncs8i34827c98" })` on launch so DevTools and future native CloudBase capabilities bind to the same CloudBase env. Product API calls still use HTTPS through `TARO_APP_API_BASE`.

## Domain Allowlist

In `mp.weixin.qq.com` for AppID `wx09d0eb079596060d`, configure:

| WeChat setting | Required domain |
|---|---|
| request合法域名 | `https://cn-wechat-d1gzncs8i34827c98-1426867475.ap-shanghai.app.tcloudbase.com` |
| uploadFile合法域名 | same CloudBase domain; add Tencent COS domain too if direct COS URLs are returned |
| downloadFile合法域名 | same CloudBase domain; add Tencent COS domain too for audio/docs/avatar downloads |

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
- Tencent CloudBase function logs for `/api/*` backend errors.
- `curl https://cn-wechat-d1gzncs8i34827c98-1426867475.ap-shanghai.app.tcloudbase.com/api/health/origin` for backend reachability.

Optional client log forwarding:

| Variable | Where | Purpose |
|---|---|---|
| `TARO_APP_CLIENT_LOG=1` | WeChat build env | Sends selected client errors to `/api/debug/wechat-client-log` |
| `WECHAT_CLIENT_LOG=1` | SCF runtime env | Allows that debug endpoint in production |

## Important Product Gaps for User Test

- Booking from the mini program currently uses the shared web booking flow rather than fully native WeChat Pay.
- The membership page is hidden until WeChat Pay is provisioned.
- The international user test depends on database sync from Supabase so experts onboarded through Web/Telegram appear in WeChat.
