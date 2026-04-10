import { getApiBase } from "./auth";

/** Full URL to the web booking flow (PayNow / Stripe, including WeChat Pay via Stripe when enabled). */
export function buildWebBookUrl(expertId: string, sessionType: string): string {
  const base = getApiBase().replace(/\/$/, "");
  const type = sessionType === "OFFLINE" ? "OFFLINE" : "ONLINE";
  return `${base}/experts/${expertId}/book?type=${type}&from=wechat`;
}

/** Login-first URL that returns the user to the public expert profile on web. */
export function buildWebProfileLoginUrl(expertId: string): string {
  const base = getApiBase().replace(/\/$/, "");
  const callbackUrl = encodeURIComponent(`/experts/${expertId}?from=wechat`);
  return `${base}/auth/signin?callbackUrl=${callbackUrl}`;
}
