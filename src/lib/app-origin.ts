import { env } from "@/lib/env";

function normalizeOrigin(origin: string): string {
  return origin.replace(/\/$/, "");
}

export function getAppOrigin(request?: Request): string {
  if (request) {
    const host =
      request.headers.get("x-forwarded-host") ||
      request.headers.get("host");
    if (host) {
      const proto =
        request.headers.get("x-forwarded-proto") ||
        (host.includes("localhost") ? "http" : "https");
      return normalizeOrigin(`${proto}://${host}`);
    }
    try {
      return normalizeOrigin(new URL(request.url).origin);
    } catch {
      // Fall through to env/default.
    }
  }

  return normalizeOrigin(env.NEXTAUTH_URL || "https://expert-network.vercel.app");
}

export function absoluteAppUrl(path: string, request?: Request): string {
  const origin = getAppOrigin(request);
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${origin}${normalizedPath}`;
}
