/**
 * Brand configuration — populated at build time by `scripts/build-region.mjs`
 * which reads `build-config/<region>.json` and exports TARO_APP_* env vars.
 *
 * The overseas build (intl) can use a different brand name / logo / slogan
 * so the two mini-programs look and feel distinct.
 *
 * 2026-05-07 rebrand:
 *   The intl WeChat MP is positioned as a FREE youth AI mentoring platform
 *   provided by the Singapore social enterprise Help & Grow, helping youth
 *   in China and ASEAN learn AI and use AI for innovation. WeChat platform
 *   requires a Chinese company for commercial services — until that's
 *   provisioned, this MP runs as a non-commercial mentoring program. Web
 *   and Telegram surfaces remain the commercial expert-network marketplace.
 *   See docs/exec-plans/active/wechat-mp-rebrand.md.
 */

export const REGION =
  (process.env.TARO_APP_REGION || "unknown") as "cn" | "intl" | "unknown";

export const BRAND_NAME =
  process.env.TARO_APP_BRAND_NAME || "Help & Grow 青年AI";

export const BRAND_LOGO =
  process.env.TARO_APP_BRAND_LOGO || "/images/logo.png";

export const BRAND_SLOGAN =
  process.env.TARO_APP_BRAND_SLOGAN || "免费的青年 AI 导师计划";

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
  "助力中国与东南亚青年 学AI · 用AI · 创新未来";

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

/** Default UI language for this build. */
export const DEFAULT_LANG =
  process.env.TARO_APP_DEFAULT_LANG || "zh-CN";
