import type { NextRequest } from "next/server";

import { handlers } from "@/auth";

/** Only POST is logged — GET /session would spam logs from client polling. */
export async function GET(request: NextRequest) {
  return handlers.GET(request);
}

export async function POST(request: NextRequest) {
  const path = request.nextUrl.pathname;
  console.log("[auth] POST", path);
  return handlers.POST(request);
}
