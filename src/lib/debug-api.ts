import { type NextRequest, NextResponse } from "next/server";

import { isErrorResponse, requireAdmin } from "@/lib/admin-auth";

type DebugAccess = { userId: string };

export function isDebugApiEnabled(): boolean {
  return process.env.NODE_ENV !== "production" || process.env.DEBUG_API_ENABLED === "1";
}

export async function requireDebugAccess(
  request: NextRequest,
  options: { mutation?: boolean } = {},
): Promise<DebugAccess | NextResponse> {
  if (!isDebugApiEnabled()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const auth = await requireAdmin(request);
  if (isErrorResponse(auth)) return auth;

  if (options.mutation && process.env.DEBUG_MUTATION_ENABLED !== "1") {
    return NextResponse.json(
      { error: "Debug mutation routes are disabled" },
      { status: 403 },
    );
  }

  return auth;
}

export function isDebugAccessDenied(
  result: DebugAccess | NextResponse,
): result is NextResponse {
  return result instanceof NextResponse;
}
