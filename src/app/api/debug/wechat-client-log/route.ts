import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { checkRateLimit } from "@/lib/rate-limit";

const clientLogBodySchema = z.object({
  level: z.string().trim().max(20).optional(),
  message: z.string().trim().max(1_000).optional(),
  detail: z.unknown().optional(),
});

/**
 * Optional: forward Mini Program console errors to Vercel Function logs.
 * Set WECHAT_CLIENT_LOG=1 on Vercel to enable in production.
 */
export async function POST(request: NextRequest) {
  if (
    process.env.WECHAT_CLIENT_LOG !== "1" &&
    process.env.NODE_ENV === "production"
  ) {
    return NextResponse.json({ ok: false }, { status: 404 });
  }

  const rateLimited = checkRateLimit(request, {
    namespace: "debug:wechat-client-log",
    limit: 60,
    windowMs: 60_000,
  });
  if (rateLimited) return rateLimited;

  try {
    const parsed = clientLogBodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: "Invalid request body" }, { status: 400 });
    }
    const body = parsed.data;
    const line = JSON.stringify({
      level: body.level ?? "info",
      message: body.message ?? "",
      detail: body.detail,
    }).slice(0, 4000);
    console.warn("[wechat-client]", line);
  } catch {
    console.warn("[wechat-client] invalid body");
  }

  return NextResponse.json({ ok: true });
}
