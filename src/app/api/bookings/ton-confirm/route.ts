import { type NextRequest, NextResponse } from "next/server";

import { triggerBookingEmails } from "@/lib/booking-emails";
import { creditTokens } from "@/lib/hg-token";
import { storeBookingEvent } from "@/lib/integrations/mem9-lifecycle";
import { prisma } from "@/lib/prisma";
import { resolveUserId } from "@/lib/request-auth";
import { notifyExpertBooking, notifyFounderBooking } from "@/lib/telegram-bot";

/**
 * POST /api/bookings/ton-confirm
 * Called after TON Connect returns a successful transaction.
 * Accepts the BOC (transaction proof) from TON Connect, stores it,
 * and transitions the booking from PENDING → CONFIRMED.
 */
export async function POST(request: NextRequest) {
  try {
    const userId = await resolveUserId(request);
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { bookingId, boc } = await request.json();
    if (!bookingId) {
      return NextResponse.json({ error: "Missing bookingId" }, { status: 400 });
    }
    if (!boc) {
      return NextResponse.json({ error: "Missing transaction proof (boc)" }, { status: 400 });
    }

    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
    });

    if (!booking) {
      return NextResponse.json({ error: "Booking not found" }, { status: 404 });
    }
    if (booking.founderId !== userId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (booking.status !== "PENDING") {
      return NextResponse.json({ status: "already_confirmed", bookingId });
    }

    const updated = await prisma.booking.update({
      where: { id: bookingId },
      data: {
        status: "CONFIRMED",
        paymentStatus: "fully_paid",
        stripePaymentIntentId: boc.slice(0, 255),
      },
      include: {
        expert: { include: { user: true } },
        founder: true,
      },
    });

    triggerBookingEmails(updated);

    if (updated.totalAmountCents && updated.totalAmountCents > 0) {
      creditTokens(updated.founderId, updated.id, updated.totalAmountCents).catch(
        (e) => console.error("[ton-confirm] token credit error:", e)
      );
    }

    const paymentLabel = `${updated.currency} ${((updated.depositAmountCents || 0) / 100).toFixed(2)}`;

    storeBookingEvent({
      expertId: updated.expertId,
      founderName: updated.founder.nickName ?? updated.founder.name ?? "Client",
      sessionType: updated.sessionType,
      startTime: updated.startTime,
      status: updated.status,
    }).catch(() => {});

    notifyExpertBooking({
      expertTelegramId: updated.expert.user.telegramId,
      expertTelegramUsername: updated.expert.user.telegramUsername,
      founderName: updated.founder.nickName ?? updated.founder.name ?? "Client",
      sessionType: updated.sessionType,
      startTime: updated.startTime,
      depositAmount: paymentLabel,
      timezone: updated.timezone,
    }).catch((e) => console.error("[ton-confirm] expert notify error:", e));

    notifyFounderBooking({
      founderTelegramId: updated.founder.telegramId,
      founderTelegramUsername: updated.founder.telegramUsername,
      expertName: updated.expert.user.nickName ?? updated.expert.user.name ?? "Expert",
      sessionType: updated.sessionType,
      startTime: updated.startTime,
      depositAmount: paymentLabel,
      timezone: updated.timezone,
    }).catch((e) => console.error("[ton-confirm] founder notify error:", e));

    return NextResponse.json({ status: "confirmed", bookingId: updated.id });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[bookings/ton-confirm]", message, error);
    return NextResponse.json(
      { error: "Confirmation failed", detail: message },
      { status: 500 }
    );
  }
}
