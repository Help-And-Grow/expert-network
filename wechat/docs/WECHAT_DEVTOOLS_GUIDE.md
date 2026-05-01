# WeChat DevTools Import Guide — Help & Grow Intl

## Prerequisites

1. **WeChat DevTools** (微信开发者工具) — [Download](https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html)
2. **WeChat Open Platform Account** with the overseas mini program registered
3. **AppID**: `wx09d0eb079596060d`

---

## Step 1: Import Project

1. Open WeChat DevTools
2. Click **"+"** → **Import Project**
3. Fill in:
   | Field | Value |
   |-------|-------|
   | Directory | `/Users/qiumiao/Downloads/expert-network/wechat` |
   | AppID | `wx09d0eb079596060d` |
   | Project Name | `Help & Grow Intl` |
4. Click **"Import"**

> **Important:** The `miniprogramRoot` in `project.config.json` is set to `./dist`, so DevTools will load the pre-built output.

---

## Step 2: Configure DevTools

After import, go to **Details → Local Settings**:

| Setting | Value |
|---------|-------|
| Verify domain name | ❌ Uncheck (for development) |
| ES6 → ES5 | ✅ Check |
| Enhance compilation | ❌ Uncheck |
| Upload on save | ❌ Optional |

Then go to **Details → Project Configuration**:

| Setting | Value |
|---------|-------|
| AppID | `wx09d0eb079596060d` |
| Backend Domain | `intl-expert-network-d4b0f027d012-1426868533.ap-shanghai.app.tcloudbaseapp.com` |

---

## Step 3: Preview

### Simulator Preview
Click **"Compile"** (Ctrl/Cmd + B) to preview in the built-in simulator.

### Real Device Preview
1. Connect your phone via USB or use QR code
2. Click **"Preview"** button in toolbar
3. Scan QR code with WeChat on your phone

> **Note:** For overseas WeChat (WeChat Intl), you need an overseas WeChat account to scan and preview.

---

## Step 4: Upload for Review

When ready for submission:

1. Click **"Upload"** in toolbar
2. Fill version info:
   - Version number: `1.0.0`
   - Description: `Help & Grow Intl - Initial Release`
3. Go to [WeChat MP Admin](https://mp.weixin.qq.com)
4. Navigate to **Version Management → Submit Review**
5. Wait for approval (typically 1-3 business days)

---

## Step 5: Deploy to TCB (Backend)

```bash
# Install TCB CLI
npm install -g @cloudbase/cli

# Login
tcb login

# Deploy
cd wechat && bash scripts/deploy-tcb-intl.sh
```

Or manually upload `wechat/dist/` contents to TCB Static Hosting at:
```
https://console.cloud.tencent.com/tcb/env/intl-expert-network-d4b0f027d012/hosting
```

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| "AppID invalid" | Ensure you're using the overseas AppID from WeChat Open Platform |
| "Domain not verified" | Uncheck "Verify domain name" in DevTools settings |
| Build fails | Run `npm run build:weapp:intl` first, then import |
| API requests fail | Check `TARO_APP_API_BASE` in `build-config/intl.json` matches your TCB URL |

---

## Architecture Overview

```
┌─────────────────────────────┐
│  WeChat Mini Program (Intl) │  ← AppID: wx09d0eb079596060d
│  wechat/dist/                │
└──────────┬──────────────────┘
           │ HTTPS
           ▼
┌─────────────────────────────┐
│  Tencent Cloud Base          │  ← Shanghai (ap-shanghai)
│  Environment: intl-expert-  │
│  network-d4b0f027d012       │
│                              │
│  ┌─────────────────────┐    │
│  │ Static Hosting      │    │  ← Mini program assets
│  └─────────────────────┘    │
│  ┌─────────────────────┐    │
│  │ Cloud Functions     │    │  ← Future: API endpoints
│  └─────────────────────┘    │
└─────────────────────────────┘
           │ Daily sync
           ▼
┌─────────────────────────────┐
│  Supabase (Primary DB)       │  ← Web + Telegram data source
└─────────────────────────────┘
```
