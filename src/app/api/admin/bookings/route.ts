import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, isErrorResponse } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

/**
 * Auto-complete ended CONFIRMED bookings on every admin bookings load.
 * Fire-and-forget — the hourly cron handles POMP credential issuance.
 */
async function autoCompletePastBookings() {
  try {
    const r = await prisma.booking.updateMany({
      where: { status: "CONFIRMED", endTime: { lt: new Date() } },
      data: { status: "COMPLETED" },
    });
    if (r.count > 0)
      console.log(`[admin/bookings] Auto-completed ${r.count} bookings`);
  } catch (e) {
    console.error("[admin/bookings] Auto-complete failed:", e);
  }
}

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAdmin(request);
    if (isErrorResponse(auth)) return auth;

    const status = request.nextUrl.searchParams.get("status") || "";
    const where = status ? { status: status as never } : {};

    const bookings = await prisma.booking.findMany({
      where,
      select: {
        id: true,
        sessionType: true,
        startTime: true,
        endTime: true,
        status: true,
        paymentStatus: true,
        paymentMethod: true,
        paynowReference: true,
        paynowPayerReference: true,
        paynowSubmittedAt: true,
        paynowConfirmedAt: true,
        totalAmountCents: true,
        depositAmountCents: true,
        currency: true,
        createdAt: true,
        expert: {
          select: {
            user: { select: { name: true, nickName: true, email: true } },
          },
        },
        founder: {
          select: { name: true, nickName: true, email: true },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    });

    // Fire-and-forget: auto-complete past bookings so admin always sees fresh status
    autoCompletePastBookings();

    return NextResponse.json(bookings);
  } catch (error) {
    console.error("[admin/bookings GET]", error);
    return NextResponse.json({ error: "Failed to fetch bookings" }, { status: 500 });
  }
}

/**
 * POST /api/admin/bookings — explicitly trigger auto-completion (with POMP issuance).
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await requireAdmin(request);
    if (isErrorResponse(auth)) return auth;

    const { runChargeRemainderCron } = await import(
      "@/lib/jobs/charge-remainder-cron"
    );
    const result = await runChargeRemainderCron();
    return NextResponse.json(result);
  } catch (error) {
    console.error("[admin/bookings POST]", error);
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: "Auto-complete failed", detail: message },
      { status: 500 },
    );
  }
}
