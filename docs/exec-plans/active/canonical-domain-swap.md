# Canonical Domain Swap — `www.help-and-grow.com`

**Goal:** make `https://www.help-and-grow.com` the single source of truth for every URL, OAuth callback, webhook, deep link, share link, and meta tag the app emits. The `expert-network.vercel.app` alias keeps working but stops being authoritative.

**Status:** in-repo defaults updated (commit `<this PR>`); operator tasks below are the gates.

---

## In-repo (already done)

| Layer | File | Change |
|---|---|---|
| Next.js fallback URL | `src/app/layout.tsx` | `metadataBase` default → canonical |
| Origin helper fallback | `src/lib/app-origin.ts` | `getAppOrigin` default → canonical |
| Chat-engine deep links | `src/lib/chat-engine.ts` | `APP_BASE_URL` default → canonical |
| Telegram bot URLs | `src/lib/telegram-bot.ts` + `src/app/api/webhooks/telegram/route.ts` | fallback → canonical |
| WeChat Pay notify | `src/lib/wechat-pay.ts` | fallback → `https://www.help-and-grow.com/api/webhooks/wechat-pay` |
| TonConnect manifest | `src/components/ton-connect-provider.tsx` | manifest URL → canonical |
| WeChat client API base | `wechat/.env.production`, `wechat/build-config/intl.json`, `wechat/src/shared/auth.ts` | `TARO_APP_API_BASE` default → canonical |
| TCB proxy origins | `infra/tcb-proxy/cloudbaserc.{cn,intl}.json` | `ORIGIN_BASE_URL` → canonical (paused, ready for future CN MP) |
| Integration test | `scripts/integration-test.sh` | default `BASE` → canonical |
| Health endpoint comment | `src/app/api/health/origin/route.ts` | example curl → canonical |
| Health endpoint | `/api/health/origin` | canonical (Vercel runtime) |

The `expert-network.vercel.app` URL is no longer hard-coded anywhere in source. It only appears in docs as a documented alias and in the `err.json` log archive (historical only).

---

## Operator tasks (in order)

### 1. Vercel project — set `NEXTAUTH_URL`

**Why:** Auth.js builds OAuth callback URLs and signs JWT cookies with this. If it's stale, Google sign-in redirects to the wrong host.

```bash
# Pull current state (you should see the old value)
vercel env ls production | grep NEXTAUTH_URL

# Update — this prompts for the new value
vercel env rm NEXTAUTH_URL production
vercel env add NEXTAUTH_URL production
# paste: https://www.help-and-grow.com
```

Re-deploy or push a no-op commit; `NEXTAUTH_URL` is read at startup.

### 2. Google Cloud Console — OAuth redirect URIs

[https://console.cloud.google.com/apis/credentials](https://console.cloud.google.com/apis/credentials) → open the Help & Grow OAuth client.

Add to **Authorized redirect URIs**:
```
https://www.help-and-grow.com/api/auth/callback/google
```

Keep `https://expert-network.vercel.app/api/auth/callback/google` for now (during the cut-over, both work). Remove it after a week of clean logs on the canonical host.

Add to **Authorized JavaScript origins**:
```
https://www.help-and-grow.com
```

### 3. Stripe — webhook endpoint

Stripe Dashboard → Developers → Webhooks → the live-mode endpoint.

Update endpoint URL to:
```
https://www.help-and-grow.com/api/webhooks/stripe
```

(Or add a second endpoint and keep both during the cut-over. Same `STRIPE_WEBHOOK_SECRET`.)

### 4. Telegram — bot webhook

```bash
curl -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook?url=https://www.help-and-grow.com/api/webhooks/telegram&drop_pending_updates=false"
```

Verify:
```bash
curl "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getWebhookInfo"
```
Should show the new URL with `pending_update_count: 0`.

### 5. Telegram Mini App — TonConnect return URL

Set `NEXT_PUBLIC_TELEGRAM_TWA_RETURN_URL` on Vercel to a `tg://` deep link or your canonical URL — see `src/components/ton-connect-provider.tsx`. If unset, the manifest still works because the `manifestUrl` itself is now canonical.

### 6. WeChat — request allowlist + WeChat Pay notify

In `mp.weixin.qq.com` → **开发管理 → 服务器域名**:
- `request合法域名`: ensure `https://www.help-and-grow.com` is present.
- `uploadFile合法域名`, `downloadFile合法域名`: same.

If WeChat Pay is enabled (env `WECHAT_PAY_NOTIFY_URL` set), update it on Vercel:
```bash
vercel env rm WECHAT_PAY_NOTIFY_URL production
vercel env add WECHAT_PAY_NOTIFY_URL production
# paste: https://www.help-and-grow.com/api/webhooks/wechat-pay
```

### 7. WeChat client rebuild

```bash
cd wechat
npm run build:weapp:intl
# Then upload via WeChat DevTools or:
npm run wechat:upload:intl -- 1.0.4 "canonical domain swap"
```

### 8. Search Console / canonical tags

If you've registered the site with Google Search Console, add `https://www.help-and-grow.com` as a property and submit the sitemap (when you have one). Old `expert-network.vercel.app` searches will redirect once Vercel routes both to the same deployment.

### 9. Verify

```bash
# All three should now respond with the canonical host headers / cookies set against www.help-and-grow.com
bash scripts/integration-test.sh

# Manual smoke
curl -I https://www.help-and-grow.com/api/health
curl https://www.help-and-grow.com/api/health/origin   # → {"ok":true,"wechat":false,...}
```

Open the production site, sign out, sign in via Google. Cookie domain should be `.help-and-grow.com` (DevTools → Application → Cookies).

---

## Rollback

If anything breaks, the in-repo defaults are easy to revert (one commit) and the Vercel env vars (`NEXTAUTH_URL`, `WECHAT_PAY_NOTIFY_URL`, etc.) can be flipped back via `vercel env`. The `expert-network.vercel.app` alias remains live throughout — it never stops working — so a partial-rollback only requires updating the failing env var, no full revert.
