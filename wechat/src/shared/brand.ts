/**
 * Brand configuration — populated at build time by `scripts/build-region.mjs`
 * which reads `build-config/<region>.json` and exports TARO_APP_* env vars.
 *
 * The overseas build (intl) can use a different brand name / logo / slogan
 * so the two mini-programs look and feel distinct.
 *
 * 2026-05-07 rebrand:
 *   The intl WeChat MP is positioned as a FREE youth career mentoring platform
 *   provided by the Singapore social enterprise Help & Grow, helping youth
 *   in China and ASEAN with career growth and skill development. WeChat platform
 *   requires a Chinese company for commercial services — until that's
 *   provisioned, this MP runs as a non-commercial mentoring program. Web
 *   and Telegram surfaces remain the commercial expert-network marketplace.
 *   See docs/exec-plans/active/wechat-mp-rebrand.md.
 */

export const REGION =
  (process.env.TARO_APP_REGION || "unknown") as "cn" | "intl" | "unknown";

export const BRAND_NAME =
  process.env.TARO_APP_BRAND_NAME || "Help & Grow 青年导师";

export const BRAND_LOGO =
  process.env.TARO_APP_BRAND_LOGO || "/images/logo.png";

export const BRAND_SLOGAN =
  process.env.TARO_APP_BRAND_SLOGAN || "免费的青年成长导师计划";

/**
 * The non-profit / social-enterprise providing this mini program.
 * Surfaced in the landing page footer + profile "About" block so users
 * understand who runs the platform and that it's free / non-commercial.
 */
export const BRAND_PROVIDER =
  process.env.TARO_APP_BRAND_PROVIDER || "新加坡社会企业 Help & Grow";

/**
 * One-line mission statement, shown under the brand name on the landing
 * page. Kept short and concrete: who, where, what.
 */
export const BRAND_MISSION =
  process.env.TARO_APP_BRAND_MISSION ||
  "助力中国与东南亚青年 职业成长 · 技能提升 · 创新未来";

/** Whether WeChat Pay is available in this region's build. */
export const ENABLE_WECHAT_PAY =
  (process.env.TARO_APP_ENABLE_WECHAT_PAY || "true") === "true";

/**
 * Whether the MP exposes paid-booking / commercial flows. False on the intl
 * social-enterprise build; the booking flow stays free across the surface.
 */
export const ENABLE_PAID_BOOKINGS =
  (process.env.TARO_APP_ENABLE_PAID_BOOKINGS || "true") === "true";

/**
 * Whether the MP exposes the Tencent TRTC premium live consultation entry.
 * Hidden on the social-enterprise build because the membership-gated
 * premium-live feature is a commercial offering. The TRTC route on the
 * server keeps its membership gate either way (defense-in-depth).
 */
export const ENABLE_PREMIUM_LIVE =
  (process.env.TARO_APP_ENABLE_PREMIUM_LIVE || "true") === "true";

/**
 * Whether the MP exposes AI voice features (语音提问 + 实时 AI 对话).
 * WeChat platform restricts AI Q&A services to mainland-CN entity apps;
 * the intl (Singapore-entity) build must hide all AI voice surfaces until
 * a mainland-CN company entity is provisioned.
 *
 * IMPORTANT: Set to FALSE for intl build to pass WeChat review.
 */
export const ENABLE_AI_VOICE =
  (process.env.TARO_APP_ENABLE_AI_VOICE || "true") === "true";

/**
 * Whether the MP exposes offline / in-person meetup flows.
 *
 * The intl WeChat MP is positioned as a FREE online-only youth mentoring
 * platform. The Singapore social enterprise has no offline-coordination
 * capacity for international users, so offline meetups are hidden from the
 * WeChat surface entirely. Defaults to `true` so non-intl builds (web, CN,
 * future variants) keep their existing offline support unchanged. The server
 * also filters OFFLINE-only experts out of WeChat responses, so the UI gate
 * and the server gate are symmetric.
 */
export const ENABLE_OFFLINE_BOOKINGS =
  (process.env.TARO_APP_ENABLE_OFFLINE_BOOKINGS || "true") === "true";

/** Default UI language for this build. */
export const DEFAULT_LANG =
  process.env.TARO_APP_DEFAULT_LANG || "zh-CN";
