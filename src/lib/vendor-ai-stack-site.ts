import type { NextRequest } from "next/server";

/**
 * Help-And-Grow showcase deployments standardized on Alibaba Cloud / Qwen.
 * Supported public aliases may be the canonical `expert-network` project or
 * the explicit `expert-network-alibabacloud` project.
 */
const VENDOR_AI_STACK_HOST_RE =
  /^(.+\.)?expert-network(?:-alibabacloud)?\.vercel\.app$/i;

const ALIBABACLOUD_VENDOR_HOST_RE =
  /^(.+\.)?expert-network(?:-alibabacloud)?\.vercel\.app$/i;

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

function matchesAnyVercelHostname(regex: RegExp): boolean {
  const candidates = [
    process.env.VERCEL_PROJECT_PRODUCTION_URL,
    process.env.VERCEL_URL,
    process.env.VERCEL_BRANCH_URL,
  ];
  for (const raw of candidates) {
    const host = hostnameFromMaybeUrl(raw ?? "");
    if (host && regex.test(host.trim().toLowerCase())) return true;
  }
  return false;
}

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
 * **expert-network-alibabacloud** Vercel demo — profile image / stack demos should use Alibaba (Qwen),
 * not a copied non-Qwen env file.
 *
 * Set `VENDOR_ALIBABACLOUD_DEMO=1` locally to mimic.
 */
export function isAlibabaCloudVendorDemoDeployment(): boolean {
  if (process.env.VENDOR_ALIBABACLOUD_DEMO === "1") return true;
  return matchesAnyVercelHostname(ALIBABACLOUD_VENDOR_HOST_RE);
}

/** True on the Alibaba showcase deployment (or when forced for local testing). */
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
