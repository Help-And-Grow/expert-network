import { type NextRequest, NextResponse } from "next/server";

import { resolveUserId } from "@/lib/request-auth";

/**
 * POST /api/bookings/[id]/pay-remainder
 * Legacy endpoint kept for clients that still probe it. New bookings require
 * full payment upfront, so there is no remainder checkout to create.
 */
export async function POST(
  request: NextRequest,
  _context: { params: Promise<{ id: string }> }
) {
  const userId = await resolveUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json(
    {
      error: "Remainder payments have been retired. Bookings now require full payment upfront.",
    },
    { status: 410 }
  );
}
