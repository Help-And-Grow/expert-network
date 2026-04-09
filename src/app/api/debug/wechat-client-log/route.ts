import { type NextRequest, NextResponse } from "next/server";

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

  try {
    const body = (await request.json()) as {
      level?: string;
      message?: string;
      detail?: unknown;
    };
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
