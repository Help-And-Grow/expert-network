import { type NextRequest, NextResponse } from "next/server";

import { triggerBookingEmails } from "@/lib/booking-emails";
import { creditTokens } from "@/lib/hg-token";
import { storeBookingEvent } from "@/lib/integrations/mem9-lifecycle";
import { prisma } from "@/lib/prisma";
import { requireAdmin, isErrorResponse } from "@/lib/admin-auth";
import { notifyExpertBooking, notifyFounderBooking } from "@/lib/telegram-bot";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAdmin(request);
    if (isErrorResponse(auth)) return auth;

    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: "Booking ID is required" }, { status: 400 });
    }

    const booking = await prisma.booking.findUnique({
      where: { id },
      include: {
        expert: { include: { user: true } },
        founder: true,
      },
    });

    if (!booking) {
      return NextResponse.json({ error: "Booking not found" }, { status: 404 });
    }

    if (booking.paymentMethod !== "paynow") {
      return NextResponse.json(
        { error: "Booking is not a PayNow payment" },
        { status: 400 }
      );
    }

    if (booking.paymentStatus === "fully_paid") {
      return NextResponse.json({ status: "already_confirmed", bookingId: booking.id });
    }

    if (booking.status !== "PENDING") {
      return NextResponse.json(
        { error: "Only pending PayNow bookings can be confirmed" },
        { status: 400 }
      );
    }

    if (booking.paymentStatus !== "submitted_paynow") {
      return NextResponse.json(
        { error: "Booking is not yet submitted for PayNow confirmation" },
        { status: 400 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const payerReference =
      typeof body.payerReference === "string" ? body.payerReference.trim() : "";

    const updated = await prisma.booking.update({
      where: { id: booking.id },
      data: {
        status: "CONFIRMED",
        paymentStatus: "fully_paid",
        paynowPayerReference: payerReference || null,
        paynowConfirmedAt: new Date(),
      },
      include: {
        expert: { include: { user: true } },
        founder: true,
      },
    });

    triggerBookingEmails(updated);

    if (updated.totalAmountCents && updated.totalAmountCents > 0) {
      creditTokens(updated.founderId, updated.id, updated.totalAmountCents).catch(
        (e) => console.error("[admin/paynow-confirm] token credit error:", e)
      );
    }

    storeBookingEvent({
      expertId: updated.expertId,
      founderName: updated.founder.nickName ?? updated.founder.name ?? "Client",
      sessionType: updated.sessionType,
      startTime: updated.startTime,
      status: updated.status,
    }).catch(() => {});

    const paymentLabel = `${updated.currency} ${((updated.depositAmountCents || 0) / 100).toFixed(2)}`;

    notifyExpertBooking({
      expertTelegramId: updated.expert.user.telegramId,
      expertTelegramUsername: updated.expert.user.telegramUsername,
      founderName: updated.founder.nickName ?? updated.founder.name ?? "Client",
      sessionType: updated.sessionType,
      startTime: updated.startTime,
      depositAmount: paymentLabel,
      timezone: updated.timezone,
    }).catch(() => {});

    notifyFounderBooking({
      founderTelegramId: updated.founder.telegramId,
      founderTelegramUsername: updated.founder.telegramUsername,
      expertName: updated.expert.user.nickName ?? updated.expert.user.name ?? "Expert",
      sessionType: updated.sessionType,
      startTime: updated.startTime,
      depositAmount: paymentLabel,
      timezone: updated.timezone,
    }).catch(() => {});

    return NextResponse.json({
      status: "confirmed",
      bookingId: updated.id,
      bookingStatus: updated.status,
      paymentStatus: updated.paymentStatus,
      paymentMethod: updated.paymentMethod,
      paynowConfirmedAt: updated.paynowConfirmedAt,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[admin/bookings/paynow-confirm POST]", message, error);
    return NextResponse.json(
      { error: "Failed to confirm PayNow booking", detail: message },
      { status: 500 }
    );
  }
}
