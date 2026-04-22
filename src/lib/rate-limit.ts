import { NextResponse } from "next/server";

type RequestLike = {
  headers: Headers;
};

type RateLimitOptions = {
  namespace: string;
  limit: number;
  windowMs: number;
  identifier?: string | null;
  message?: string;
};

type RateBucket = {
  count: number;
  resetAt: number;
};

const buckets = new Map<string, RateBucket>();

function getClientIp(request: RequestLike): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) return forwardedFor.split(",")[0]?.trim() || "unknown";
  return (
    request.headers.get("x-real-ip") ||
    request.headers.get("cf-connecting-ip") ||
    "unknown"
  );
}

function cleanupExpiredBuckets(now: number): void {
  if (buckets.size < 1_000) return;
  for (const [key, bucket] of buckets.entries()) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

export function checkRateLimit(
  request: RequestLike,
  options: RateLimitOptions,
): NextResponse | null {
  const now = Date.now();
  cleanupExpiredBuckets(now);

  const identifier = options.identifier || getClientIp(request);
  const key = `${options.namespace}:${identifier}`;
  const existing = buckets.get(key);
  const bucket =
    existing && existing.resetAt > now
      ? existing
      : { count: 0, resetAt: now + options.windowMs };

  bucket.count += 1;
  buckets.set(key, bucket);

  if (bucket.count <= options.limit) return null;

  const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
  const response = NextResponse.json(
    { error: options.message ?? "Too many requests. Please try again later." },
    { status: 429 },
  );
  response.headers.set("Retry-After", String(retryAfterSeconds));
  return response;
}
