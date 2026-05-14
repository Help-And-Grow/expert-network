# Telegram bot reference

Canonical operational + behavioural reference for `@helpAndGrowBot` and the Telegram Mini App attached to it. Last refreshed 2026-05-13.

The bot is one of three first-class clients (Web, Telegram, WeChat). It shares the same backend (`src/lib/chat-engine.ts`, `src/lib/telegram-bot.ts`, `/api/webhooks/telegram`) regardless of where it's deployed.

## 1. Identity & configuration

### Production bot

| Field | Value |
|---|---|
| Username | `@helpAndGrowBot` |
| Display name | "Help And Grow" |
| Mini App slug | `ExpertNetwork` (visible at `t.me/helpAndGrowBot/ExpertNetwork`) |
| Mini App Web URL | `https://www.help-and-grow.com/` |
| Privacy mode | **Disabled** (required — see §3) |
| Inline queries | Currently disabled on this bot; the inline-query handler in the webhook is dormant. Enable via BotFather `/setinline` if/when needed. |

### Required env vars (server side, set on Vercel)

| Env | Used by | Default |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | Outbound API calls, webhook handler | — (sensitive) |
| `TELEGRAM_BOT_USERNAME` | Group @-mention detection without a `getMe` round-trip | falls back to `getMe()` |
| `TELEGRAM_MINI_APP_SLUG` | Building `t.me/<bot>/<slug>?startapp=…` deep links from the webhook + outbound notifications | `"ExpertNetwork"` |

### Client mirrors (Next.js, exposed to the browser bundle)

| Env | Used by | Default |
|---|---|---|
| `NEXT_PUBLIC_TELEGRAM_BOT_USERNAME` | `telegramMiniAppLink()` in `src/lib/telegram.ts` (Share button etc.) | `"helpAndGrowBot"` |
| `NEXT_PUBLIC_TELEGRAM_MINI_APP_SLUG` | same | `"ExpertNetwork"` |

If you ever migrate to a new bot, set both server and client vars in lockstep — Vercel rebuild required for the `NEXT_PUBLIC_*` to propagate.

## 2. DM behaviour

When a user 1-on-1 DMs the bot, the webhook in `src/app/api/webhooks/telegram/route.ts` dispatches:

| Trigger | Handler | Effect |
|---|---|---|
| `/start` | Welcome message | 3 inline-keyboard buttons: **🚀 Open Help & Grow** (Mini App at `/`), **🔍 Discover Community** (Mini App at `/discover`), **✏️ Edit my profile** (deep link to `/profile` via `profile-edit` start_param). |
| `/help` | Help message | Lists commands. |
| `/browse` | Browse | Opens Mini App at `/discover`. |
| `/find <query>` | AI expert match | Calls `chat()` from `src/lib/chat-engine.ts`. Replies with up to 5 ranked experts + per-expert **View** / **Book** `web_app` buttons (open the Mini App at `/experts/<id>` and `/experts/<id>/book`). |
| Free text (anything not `/`) | Same AI expert match as `/find` |  |
| Inline query (`@helpAndGrowBot in any chat`) | Inline expert search | Returns expert cards as `InlineQueryResultArticle` (currently disabled at the bot level via BotFather). |

DM replies use `web_app:` buttons — the Telegram Mini App opens with `initData` auth context, theme sync, and safe-area handling.

## 3. Group behaviour

The bot only responds in a group when explicitly addressed:

- `/start@helpAndGrowBot`, `/find@helpAndGrowBot growth marketing`, etc. — Telegram's `/cmd@botname` convention; goes through the same DM handlers but reply is threaded.
- `@helpAndGrowBot <question>` — bare @-mention. Webhook strips the mention from the text and runs the residue through `chat()`.
- Replying to a bot message — counts as addressing the bot; same path as a free-text question.

**All other messages in the group are silently ignored** (the webhook still receives them when privacy mode is OFF — the gate in `route.ts` returns early without sending anything).

### Why privacy mode must be **disabled**

Counterintuitively, the default privacy-mode-ON setting prevents @-mention delivery for some bots due to a Telegram per-group cache that doesn't refresh reliably (observed during initial setup of `@helpAndGrowBot`). Disabling privacy mode means Telegram delivers every group message to the webhook, but our app-level gate keeps the behaviour the same — the bot only *replies* when @-mentioned, replied-to, or commanded.

BotFather: `/mybots → @helpAndGrowBot → Bot Settings → Group Privacy → Turn off`. After toggling, **remove and re-add the bot to existing groups** so Telegram picks up the change.

### Group reply structure

Inline-keyboard buttons in groups must be `url:` (not `web_app:`), so we use `t.me/<bot>/<slug>?startapp=…` deep links — recipient taps → Mini App opens with the right start_param → `<TelegramStartParamRouter>` routes internally. See §4.

## 4. Mini App deep links

Convention: `https://t.me/<bot>/<slug>?startapp=<prefix-id>`. Telegram clients on every platform (iOS, Android, Desktop, Web) open the Mini App with `Telegram.WebApp.initDataUnsafe.start_param` set.

### Supported prefixes

| start_param | Routes to | Used by |
|---|---|---|
| `expert-<id>` | `/experts/<id>` | Group reply "View" buttons; Share button on profile page |
| `book-<id>` | `/experts/<id>/book` | Group reply "Book" buttons |
| `review-<id>` | `/reviews/<bookingId>` | `notifyReviewRequest()` DM on booking COMPLETED |
| `profile-edit` | `/profile` | `/start` welcome "Edit my profile" button |
| *(none)* | `/` | "Discover More" button; default Mini App entry |

### Where the routing happens

`src/components/telegram-start-param-router.tsx` (client component, mounted in `src/app/layout.tsx` inside `<Providers>`). On Mini-App boot it:

1. Calls `Telegram.WebApp.ready()` + `expand()`.
2. Reads `initDataUnsafe.start_param`.
3. Pattern-matches the prefix and calls `router.replace(…)` (only when `pathname === "/"` so a deep-link inside an already-routed Mini App doesn't yank the user back to root).

### Adding a new prefix

Two-line change. Suppose you want `room-<bookingId>` to open the TRTC live room:

1. **Emit it** wherever you currently send a web URL — e.g. when the meetup window opens. Use the helper from `src/lib/telegram.ts`:
   ```ts
   const url = telegramMiniAppLink(`room-${bookingId}`);
   ```

2. **Parse it** in `src/components/telegram-start-param-router.tsx`:
   ```ts
   if (param.startsWith("room-")) {
     const id = param.slice("room-".length);
     if (EXPERT_ID_RE.test(id)) router.replace(`/consultation/${id}`);
     return;
   }
   ```

Rebuild + redeploy. No other changes.

### Builder helpers

- Server: `telegramMiniAppLink(botUsername, startParam?)` in `src/app/api/webhooks/telegram/route.ts` (in-file helper).
- Client: `telegramMiniAppLink(startParam?)` exported from `src/lib/telegram.ts`.

The duplication exists because the webhook reads `process.env.TELEGRAM_*` and the client reads `process.env.NEXT_PUBLIC_TELEGRAM_*`. Keep both in sync if you change defaults.

## 5. Outbound notifications

All helpers in `src/lib/telegram-bot.ts`. Each one resolves a chat ID from `User.telegramId` (preferred) or falls back to looking up `User.telegramUsername` in Prisma. Failures are logged and swallowed — booking flow shouldn't break because a DM didn't deliver.

| Helper | Fires when | Contents |
|---|---|---|
| `notifyExpertBooking` | New meetup scheduled (`/api/bookings/verify`) | "📅 New meetup!" + `web_app` button to `/booking` |
| `notifyFounderBooking` | Founder's meetup confirmed (same trigger) | "✅ Meetup confirmed!" + `web_app` button to `/booking` |
| `notifyCancellation` | Booking cancelled | "❌ Meetup cancelled" |
| `notifyReschedule` | Booking rescheduled | "📅 Meetup rescheduled" |
| `notifyLocationUpdate` | Venue changed | "📍 Location updated" |
| `sendSessionReminder` | 1h before meetup | Reminder DM |
| `notifyReviewRequest` | `PATCH /api/bookings/[id]` with `status: COMPLETED` | "🌟 How was your meetup?" + `url` button using `review-<bookingId>` deep link. Idempotent: skips if the booking already has a `Review` row. |

### Constraint to keep in mind

Telegram requires every recipient user to have DM'd the bot **at least once** before the bot can DM them. After a token rotation or bot-identity swap, all existing users need to re-`/start` the new bot before they receive notifications again. (See `docs/references/multi-repo-strategy.md` for context on the May 13 bot migration.)

## 6. Share button (Mini App)

`/experts/<id>` page → **Share** → `shareLink()` in `src/lib/telegram.ts`:

- **Inside Mini App**: shares the `t.me/helpAndGrowBot/ExpertNetwork?startapp=expert-<id>` deep link via `openTelegramLink("https://t.me/share/url?…")`. Recipient taps → lands in the Mini App at that profile.
- **Outside Mini App** (regular web): uses the Web Share API or falls back to clipboard, sharing the bare web URL.

### Known Telegram-client behaviour

On **Telegram mobile (iOS / Android)**: `openTelegramLink("t.me/share/url?…")` shows a "Forward to…" chat picker — the expected UX.

On **Telegram Web**: same call routes content into Saved Messages without a picker. This is a Telegram-client quirk, not a bug in our code. Since the product is mobile-first, the current behaviour is acceptable for MVP.

If we ever want picker parity on Web, the Telegram-recommended path is `WebApp.switchInlineQuery(query, ['users', 'groups'])` — requires enabling inline mode in BotFather + a `share-<id>` branch in the inline-query handler (already exists for expert search, would be additive).

## 7. Operational runbook

### Token rotation

```bash
export TELEGRAM_BOT_TOKEN="<new-token-from-BotFather>"
npm run vercel:env:telegram
```

The script (`scripts/sync-telegram-bot-token.mjs`) pushes the token to Vercel preview + production AND re-registers the webhook at `https://www.help-and-grow.com/api/webhooks/telegram` via Telegram's `setWebhook` API. Verifies with `getWebhookInfo` afterwards.

### Bot username / Mini App slug change

If you rename the bot or the Mini App slug (rare):

```bash
vercel env rm TELEGRAM_BOT_USERNAME production --yes
echo -n "newBotName" | vercel env add TELEGRAM_BOT_USERNAME production --yes
vercel env rm NEXT_PUBLIC_TELEGRAM_BOT_USERNAME production --yes
echo -n "newBotName" | vercel env add NEXT_PUBLIC_TELEGRAM_BOT_USERNAME production --yes
# repeat for TELEGRAM_MINI_APP_SLUG / NEXT_PUBLIC_TELEGRAM_MINI_APP_SLUG if renamed too
vercel --prod --yes
```

Server-side reads are picked up on the next cold start; `NEXT_PUBLIC_*` requires a fresh build.

### Debugging silent group behaviour

If `@helpAndGrowBot …` in a group does nothing:

1. Confirm the bot is **a member of the group** (group settings → members).
2. Confirm Privacy Mode is **disabled** in BotFather.
3. Kick + re-add the bot (refreshes Telegram's per-group privacy cache).
4. Tail `vercel logs https://www.help-and-grow.com --follow` while testing, look for `POST /api/webhooks/telegram` lines.
5. If you don't see any POST line, Telegram isn't delivering. Re-add the bot.
6. If you see POSTs but no reply, the handler is filtering. Add `console.log` calls or open a fresh issue.

### Webhook health

```bash
curl "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getWebhookInfo"
```

Healthy response: non-empty `url`, `pending_update_count: 0`, no `last_error_message` field.

## 8. Where the source lives

| Concern | File |
|---|---|
| Webhook entrypoint | `src/app/api/webhooks/telegram/route.ts` |
| Outbound helpers | `src/lib/telegram-bot.ts` |
| Client-side helpers (share, deep-link, isMiniApp) | `src/lib/telegram.ts` |
| Mini App start_param router | `src/components/telegram-start-param-router.tsx` |
| Mini App auth (initData HMAC) | `src/lib/telegram-server.ts` |
| Layout integration | `src/app/layout.tsx` |
| Token rotation script | `scripts/sync-telegram-bot-token.mjs` |
| Booking → review trigger | `src/app/api/bookings/[id]/route.ts` (PATCH handler, `status: COMPLETED` branch) |

## See also

- [docs/references/multi-repo-strategy.md](./multi-repo-strategy.md) — how `jlzxwt8/expert-network` and `Help-And-Grow/expert-network` stay in sync.
- [docs/design-docs/architecture.md](../design-docs/architecture.md) §Auth — Telegram Mini App initData HMAC verification.
- [docs/design-docs/product-features.md](../design-docs/product-features.md) — product-side notes on the bot's role.
- [docs/ENV.md](../ENV.md) — full env-var matrix.
