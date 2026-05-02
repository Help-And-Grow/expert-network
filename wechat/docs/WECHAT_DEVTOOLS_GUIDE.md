# WeChat DevTools Guide — Current International MP

This guide is for the **current international WeChat Mini Program** registered through the Singapore company. The future mainland-CN mini program will use a separate AppID and separate release process after the China company is ready.

## 1. Build

```bash
cd /Users/qiumiao/Downloads/expert-network/wechat
npm ci
npm run build:weapp:intl
```

Current build config:

| Field | Value |
|---|---|
| Region | `intl` |
| AppID | `wx09d0eb079596060d` |
| CloudBase env | `cn-wechat-d1gzncs8i34827c98` |
| API base | `https://cn-wechat-d1gzncs8i34827c98-1426867475.ap-shanghai.app.tcloudbase.com` |

The CloudBase env name contains `cn-wechat` for historical reasons. It is the active Tencent CloudBase backend for the current international user test.

## 2. Import in WeChat DevTools

1. Open WeChat DevTools.
2. Import project directory:
   `/Users/qiumiao/Downloads/expert-network/wechat`
3. Use AppID:
   `wx09d0eb079596060d`
4. Project name:
   `Help & Grow Intl`

`project.config.json` uses:

```json
{
  "miniprogramRoot": "./dist/intl",
  "appid": "wx09d0eb079596060d"
}
```

So DevTools loads the latest `build:weapp:intl` output.

## 3. CloudBase Connection

The mini program initializes CloudBase on launch:

```ts
Taro.cloud.init({
  env: "cn-wechat-d1gzncs8i34827c98",
  traceUser: true
});
```

This matches the CloudBase Access Guide screenshot. The app still calls the shared backend through HTTPS:

```text
https://cn-wechat-d1gzncs8i34827c98-1426867475.ap-shanghai.app.tcloudbase.com/api/...
```

This keeps Web, Telegram, and WeChat aligned against the same synchronized expert data.

## 4. DevTools Settings

For local simulator debugging:

| Setting | Recommended |
|---|---|
| Verify domain name | Off for local debugging; on for real-device validation |
| ES6 to ES5 | On |
| Enhanced compilation | On if DevTools is stable; turn off if simulator behaves strangely |
| Upload on save | Off |

For real-device preview and experience versions, configure legal domains in `mp.weixin.qq.com` instead of relying on disabled verification.

## 5. Legal Domains

In WeChat MP Admin for AppID `wx09d0eb079596060d`:

| Domain list | Required value |
|---|---|
| request合法域名 | `https://cn-wechat-d1gzncs8i34827c98-1426867475.ap-shanghai.app.tcloudbase.com` |
| uploadFile合法域名 | same CloudBase domain; add COS domain if files upload directly to COS |
| downloadFile合法域名 | same CloudBase domain; add COS domain if audio/docs/avatar URLs are direct COS URLs |

## 6. Smoke Test Checklist

Use DevTools Network plus a real WeChat device:

- Launch app and confirm no CloudBase init error.
- Confirm `/api/auth/wechat` returns 200 after login.
- Confirm Discover loads experts synchronized from Supabase.
- Open expert detail and verify avatar/audio/document fetches.
- Test onboarding upload.
- Test voice greeting / voice question flow.
- Test booking handoff to the shared web booking flow.

Backend health:

```bash
curl -i https://cn-wechat-d1gzncs8i34827c98-1426867475.ap-shanghai.app.tcloudbase.com/api/health/origin
```

Expected status: `200 OK`.

## 7. Upload Experience Version

From repo root:

```bash
npm run wechat:upload:intl -- 1.0.3 "intl user test"
```

or:

```bash
npm run wechat:upload:local -- --region intl 1.0.3 "intl user test"
```

Then assign testers to the experience version in WeChat MP Admin. Public release still requires WeChat review.
