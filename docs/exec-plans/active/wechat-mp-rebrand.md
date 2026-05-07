# WeChat Mini Program Rebrand — Help & Grow 青年AI

**Status:** Phase 1 ✅ shipped 2026-05-07. Phase 2 + 3 deferred.

## Why

WeChat platform requires a **Chinese company entity** to provide commercial
services. We are a **Singapore company** (Help & Grow), so the existing
commercial expert-network framing of the WeChat MP cannot ship to mainland
mass-market users until a separate Chinese entity is provisioned (~Sep 2026+
per the parallel `tencent-cloud-rollout.md`).

Until then, we keep the WeChat MP **live** but reposition it as a
**non-commercial youth AI mentoring program** — a free public service offered
by Help & Grow as a Singapore social enterprise, focused on helping youth in
China and ASEAN learn AI and use AI for innovation. This:

- Sidesteps the commercial-services restriction (no payments, no paid
  bookings, no membership purchase, no premium-live ticketing)
- Keeps a real audience growing on WeChat for when the mainland-CN entity
  opens (the user base + content carries over)
- Aligns with Help & Grow's social-enterprise mission narrative
- Is small enough to ship as a **copy + branding rebuild** without a deep
  schema or backend rewrite

**Web and Telegram surfaces are unchanged** — they remain the commercial
expert-network marketplace for Singapore + global users.

## Scope split

| Phase | Scope | Status |
|---|---|---|
| **1 — copy + branding rebuild** | Brand strings (env + UI), tab labels, page copy, hide pricing UI, hide premium-live entry, add social-enterprise framing in profile / about | ✅ Shipped 2026-05-07 |
| **2 — server-side guardrails** | Force-free booking creation when `isWeChatOriginatedRequest` is true (override expert pricing); per-MP rate limit on free booking; dedicated mentoring-program privacy policy | ⏸ Deferred |
| **3 — mentor opt-in flow** | New `Expert.isYouthMentor: Boolean` field; opt-in checkbox in onboarding; MP discovery filters to opted-in mentors only; opt-in onboarding email | ⏸ Deferred |
| **4 — MP backend description** | Update `mp.weixin.qq.com` MP profile, category, description, and re-submit for review under the new positioning | ⏸ Deferred — operator task |

## Phase 1 — what shipped

### Brand strings (env-driven)

`wechat/build-config/intl.json`:
- `TARO_APP_BRAND_NAME` → `"Help & Grow 青年AI"`
- `TARO_APP_BRAND_SLOGAN` → `"免费的青年 AI 导师计划"`
- `TARO_APP_BRAND_PROVIDER` → `"新加坡社会企业 Help & Grow"` *(new)*
- `TARO_APP_BRAND_MISSION` → `"助力中国与东南亚青年 学AI · 用AI · 创新未来"` *(new)*
- `TARO_APP_DEFAULT_LANG` → `"zh-CN"` (was `en-US`; the actual content has been Chinese throughout)
- `TARO_APP_ENABLE_PAID_BOOKINGS` → `"false"` *(new — drives UI to hide price chips and pricing flows)*
- `TARO_APP_ENABLE_PREMIUM_LIVE` → `"false"` *(new — hides the consultation entry)*

These flow through `wechat/src/shared/brand.ts` which re-exports them so any
component can `import { BRAND_NAME, BRAND_PROVIDER, ... } from "../../shared/brand"`.

### Vocabulary swap

| Marketplace term | Mentoring term |
|---|---|
| 专家 (expert) | 导师 (mentor) |
| 发现专家 (find an expert) | 找一位导师 (find a mentor) |
| 成为专家 (become an expert) | 成为志愿导师 (become a volunteer mentor) |
| 见面 (meeting) | 学习见面 (learning meeting) — when context warrants |
| 预约 (book) | 免费预约 (book for free) — added "免费" prefix on relevant CTAs |

Server-side schema is unchanged (`Expert`, `Booking`, etc. keep their names);
this is a vocabulary shift in the WeChat MP UI only.

### Tab bar (`wechat/src/app.config.ts`)

| Old | New |
|---|---|
| 首页 | 首页 *(unchanged)* |
| 发现 | 找导师 |
| 见面 | 学习 |
| 我的 | 我的 *(unchanged)* |

Window title: `帮助与成长` → `Help & Grow 青年AI`.

### Pages updated

- **`pages/index/index.tsx`** — landing rewritten: hero uses
  `BRAND_NAME / BRAND_SLOGAN / BRAND_MISSION`, CTAs are "找一位导师" and
  "成为志愿导师", three feature cards rewritten to "学AI · 动手实践",
  "用AI · 启发创新", "免费 · 公益项目", and a new `landing__about` block at
  the bottom with the social-enterprise framing.
- **`pages/discover/index.tsx`** — quick-tags rewritten to youth AI
  topics (学AI入门 / 用AI做项目 / 升学/求职 / AI产品创新). Hint copy: "找一位志愿导师 · 全部免费".
  Match rendering says "为你匹配到 N 位志愿导师".
- **`pages/book/index.tsx`** — copy rewritten to "免费预约学习见面" with
  "本项目对青年学员完全免费" disclaimer.
- **`pages/expert/index.tsx`** — vocabulary swap; price chips show
  `"免费"` instead of dollar amounts when `!ENABLE_PAID_BOOKINGS`; section
  title flips from "见面方式与价格" to "见面方式".
- **`pages/profile/index.tsx`** — "成为专家" → "成为志愿导师"; About-us
  modal rewritten with social-enterprise framing; footer credits Help & Grow
  as a Singapore social enterprise.
- **`pages/dashboard/index.tsx`** — empty state uses the mentoring
  vocabulary and points users to "找导师".
- **`pages/onboarding/index.tsx`** — welcome message reframed to
  volunteer-mentor recruitment; "专家主页" → "导师主页" globally.

### What stayed the same

- Server-side data model — no schema migration
- Booking, free booking, expert profile, AI matching, voice chat APIs
- Web + Telegram surfaces — fully commercial, unchanged
- WeChat MP `appid`, build/upload pipeline (`scripts/run-wechat-upload.cjs`),
  CI workflow

## Phase 2 — what to do next (server-side enforcement)

Phase 1 is a UI/branding rebrand. A determined user could still use a non-MP
client to hit `/api/bookings/checkout` with this expert and pay. To make the
non-commercial framing **enforceable** rather than aesthetic:

1. **Force-free WeChat-MP bookings** — in `/api/bookings/free`, `/checkout`,
   `/paynow`, when `isWeChatOriginatedRequest(request)` is true, override
   `pricePerHour` to `0` regardless of the expert's stored price. This means
   any booking *created from the MP* is free, even if the expert otherwise
   charges on Web/TG.
2. **Block paid endpoints from MP** — `/checkout`, `/paynow`, `/ton-payment`
   should reject `isWeChatOriginatedRequest === true` outright. The MP only
   uses `/free`. Defense-in-depth.
3. **Per-MP rate limit** — mentoring is one-to-one and we don't want a single
   account spamming dozens of mentor requests. Add a 5-bookings-per-week cap
   keyed by `(wechatOpenId, expertId)`.
4. **Per-MP privacy policy** — point the MP to a dedicated privacy notice
   that reflects the non-commercial framing (no payment processing, no
   marketing emails, etc.).

## Phase 3 — mentor opt-in

To avoid surfacing experts who genuinely want to be paid (and would be
annoyed by free WeChat MP requests), add an opt-in:

- New schema column: `Expert.isYouthMentor: Boolean @default(false)`
- New `/api/expert/profile` field: `youthMentorOptIn`
- WeChat MP discovery filters: `where: { isPublished: true, isYouthMentor: true }`
- Web onboarding adds a checkbox: *"作为志愿导师，免费帮助中国与东南亚青年学习 AI"*
- Onboarding-complete email (sent to mentors who opt in) explains:
  *"You'll receive WeChat MP booking requests from youth in China + ASEAN. All free. You can opt out at any time in /dashboard."*

## Phase 4 — operator task

Once Phase 2 + 3 are in place, log into `mp.weixin.qq.com` and:

1. Update the **app name** (subject to WeChat review): `Help & Grow 青年AI`
2. Update the **app description** (subject to WeChat review): "面向中国与东南亚青年的免费 AI 导师计划，由新加坡社会企业 Help & Grow 发起。"
3. Update the **app category** to *社交-社区* or *教育-在线教育* (WeChat will probably accept Education).
4. Re-submit for review.

Until that's done, the rebrand is in-app only — the WeChat directory listing
will still show the old name. That's acceptable since Phase 1 ships
significant in-app value immediately.
