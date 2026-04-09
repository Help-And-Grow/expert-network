import { getApiBase } from "./auth";

/** Full URL to the web booking flow (PayNow / Stripe, including WeChat Pay via Stripe when enabled). */
export function buildWebBookUrl(expertId: string, sessionType: string): string {
  const base = getApiBase().replace(/\/$/, "");
  const type = sessionType === "OFFLINE" ? "OFFLINE" : "ONLINE";
  return `${base}/experts/${expertId}/book?type=${type}&from=wechat`;
}
