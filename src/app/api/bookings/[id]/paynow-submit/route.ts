import { type NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { resolveUserId } from "@/lib/request-auth";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = await resolveUserId(request);
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const payerReference =
      typeof body.payerReference === "string" ? body.payerReference.trim() : "";

    const booking = await prisma.booking.findUnique({
      where: { id },
      include: { expert: true },
    });

    if (!booking) {
      return NextResponse.json({ error: "Booking not found" }, { status: 404 });
    }

    if (booking.founderId !== userId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    if (booking.paymentMethod !== "paynow" || booking.status !== "PENDING") {
      return NextResponse.json(
        { error: "Booking is not awaiting PayNow payment" },
        { status: 400 }
      );
    }

    const now = new Date();
    const expired = now.getTime() - booking.createdAt.getTime() > 30 * 60 * 1000;
    if (expired) {
      await prisma.booking.update({
        where: { id: booking.id },
        data: { status: "CANCELLED", cancelReason: "PayNow hold expired" },
      });
      return NextResponse.json(
        { error: "PayNow hold expired. Please start payment again." },
        { status: 410 }
      );
    }

    const updated = await prisma.booking.update({
      where: { id: booking.id },
      data: {
        paymentStatus: "submitted_paynow",
        paynowPayerReference: payerReference || null,
        paynowSubmittedAt: now,
      },
      select: {
        id: true,
        paymentStatus: true,
        paynowReference: true,
        paynowPayerReference: true,
      },
    });

    return NextResponse.json({
      status: "submitted",
      booking: updated,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[bookings/[id]/paynow-submit POST]", message, error);
    return NextResponse.json(
      { error: "Failed to submit PayNow payment", detail: message },
      { status: 500 }
    );
  }
}
