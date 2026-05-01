/**
 * Brand configuration — populated at build time by `scripts/build-region.mjs`
 * which reads `build-config/<region>.json` and exports TARO_APP_* env vars.
 *
 * The overseas build (intl) can use a different brand name / logo / slogan
 * so the two mini-programs look and feel distinct.
 */

export const REGION =
  (process.env.TARO_APP_REGION || "unknown") as "cn" | "intl" | "unknown";

export const BRAND_NAME =
  process.env.TARO_APP_BRAND_NAME || "Help & Grow";

export const BRAND_LOGO =
  process.env.TARO_APP_BRAND_LOGO || "/images/logo.png";

export const BRAND_SLOGAN =
  process.env.TARO_APP_BRAND_SLOGAN || "AI Native Expert Network";

/** Whether WeChat Pay is available in this region's build. */
export const ENABLE_WECHAT_PAY =
  (process.env.TARO_APP_ENABLE_WECHAT_PAY || "true") === "true";

/** Default UI language for this build. */
export const DEFAULT_LANG =
  process.env.TARO_APP_DEFAULT_LANG || "zh-CN";
