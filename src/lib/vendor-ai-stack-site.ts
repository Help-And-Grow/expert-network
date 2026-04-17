import type { NextRequest } from "next/server";

/**
 * Vercel projects used for Google / Alibaba / BytePlus–stack demos.
 * Canonical production: https://expert-network.vercel.app/
 */
const VENDOR_AI_STACK_HOST_RE =
  /^(.+\.)?expert-network-(googlecloud|alibabacloud|byteplus)\.vercel\.app$/i;

export function requestHostname(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-host");
  if (forwarded) {
    return forwarded.split(",")[0]?.trim()?.split(":")[0] ?? "";
  }
  const host = request.headers.get("host");
  if (host) return host.split(":")[0] ?? "";
  try {
    return new URL(request.url).hostname;
  } catch {
    return "";
  }
}

export function isVendorAiStackSiteHost(host: string): boolean {
  return VENDOR_AI_STACK_HOST_RE.test(host.trim().toLowerCase());
}

/**
 * True on the three vendor demo deployments (or when forced for local testing).
 */
function hostnameFromMaybeUrl(value: string): string {
  const t = value.trim();
  if (!t) return "";
  try {
    const withProto = t.includes("://") ? t : `https://${t}`;
    return new URL(withProto).hostname;
  } catch {
    return t.split("/")[0]?.split(":")[0] ?? "";
  }
}

export function isVendorAiStackSiteRequest(request: NextRequest | Request): boolean {
  if (process.env.NEXT_PUBLIC_VENDOR_AI_STACK_SITE === "1") {
    return true;
  }
  if (isVendorAiStackSiteHost(requestHostname(request))) {
    return true;
  }
  const prodHost = hostnameFromMaybeUrl(process.env.VERCEL_PROJECT_PRODUCTION_URL ?? "");
  if (prodHost && isVendorAiStackSiteHost(prodHost)) {
    return true;
  }
  return false;
}
