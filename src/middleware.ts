import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

function resolveCanonicalHost(): string | null {
  const raw = process.env.NEXTAUTH_URL;
  if (!raw) return null;
  try {
    return new URL(raw).host;
  } catch {
    return null;
  }
}

export function middleware(request: NextRequest) {
  if (request.method !== "GET" && request.method !== "HEAD") return NextResponse.next();

  const canonicalHost = resolveCanonicalHost();
  if (!canonicalHost) return NextResponse.next();

  const currentHost = request.headers.get("host");
  if (!currentHost || currentHost === canonicalHost) return NextResponse.next();

  const url = request.nextUrl.clone();
  url.host = canonicalHost;
  url.protocol = "https:";
  url.port = "";
  return NextResponse.redirect(url, 308);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
