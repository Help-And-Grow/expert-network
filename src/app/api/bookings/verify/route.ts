import { type NextRequest, NextResponse } from "next/server";

import type { SessionType } from "@/generated/prisma/client";
import { triggerBookingEmails } from "@/lib/booking-emails";
import { storeBookingEvent } from "@/lib/integrations/mem9-lifecycle";
import { generateMeetingLink } from "@/lib/meeting";
import { prisma } from "@/lib/prisma";
import { resolveUserId } from "@/lib/request-auth";
import { retrieveCheckoutSession, retrievePaymentIntent } from "@/lib/stripe";
import { notifyExpertBooking, notifyFounderBooking } from "@/lib/telegram-bot";

/**
 * POST /api/bookings/verify
 * Called from the checkout success page to verify the Stripe session
 * and create the booking if the webhook hasn't done so yet.
 * This is Stripe's recommended pattern for reliable booking creation.
 */
export async function POST(request: NextRequest) {
  try {
    const userId = await resolveUserId(request);
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const sessionId = body.sessionId;
    if (!sessionId || typeof sessionId !== "string") {
      return NextResponse.json(
        { error: "Missing session_id" },
        { status: 400 }
      );
    }

    const existing = await prisma.booking.findFirst({
      where: { stripeCheckoutSessionId: sessionId },
      select: { id: true },
    });
    if (existing) {
      return NextResponse.json({
        status: "already_created",
        bookingId: existing.id,
      });
    }

    const checkoutSession = await retrieveCheckoutSession(sessionId);

    const bookingPaymentType = checkoutSession.metadata?.type;
    if (
      (bookingPaymentType !== "booking_full_payment" &&
        bookingPaymentType !== "booking_deposit") ||
      checkoutSession.metadata?.founderId !== userId
    ) {
      return NextResponse.json(
        { error: "Session not found or unauthorized" },
        { status: 403 }
      );
    }

    const pi =
      typeof checkoutSession.payment_intent === "string"
        ? checkoutSession.payment_intent
        : undefined;

    let paymentMethodId: string | undefined;
    let customerId: string | undefined;
    let piMeta: Record<string, string> = {};

    if (pi) {
      const paymentIntent = await retrievePaymentIntent(pi);
      paymentMethodId =
        typeof paymentIntent.payment_method === "string"
          ? paymentIntent.payment_method
          : undefined;
      customerId =
        typeof paymentIntent.customer === "string"
          ? paymentIntent.customer
          : undefined;
      piMeta = (paymentIntent.metadata as Record<string, string>) ?? {};
    }

    const meta = { ...(checkoutSession.metadata ?? {}), ...piMeta };
    const totalPaidCents = parseInt(meta.totalCents || "0", 10);
    const dueNowCents = parseInt(
      meta.dueNowCents || meta.depositCents || meta.totalCents || "0",
      10
    );
    const isLegacyDeposit =
      bookingPaymentType === "booking_deposit" && dueNowCents < totalPaidCents;

    const doubleCheck = await prisma.booking.findFirst({
      where: { stripeCheckoutSessionId: sessionId },
      select: { id: true },
    });
    if (doubleCheck) {
      return NextResponse.json({
        status: "already_created",
        bookingId: doubleCheck.id,
      });
    }

    const booking = await prisma.booking.create({
      data: {
        expertId: meta.expertId!,
        founderId: meta.founderId!,
        sessionType: (meta.sessionType || "ONLINE") as SessionType,
        startTime: new Date(meta.startTime!),
        endTime: new Date(meta.endTime!),
        timezone: meta.timezone || "Asia/Singapore",
        meetingLink: (meta.sessionType || "ONLINE") === "ONLINE"
          ? (meta.meetingLink || generateMeetingLink())
          : null,
        status: "CONFIRMED",
        totalAmountCents: totalPaidCents,
        depositAmountCents: dueNowCents,
        currency: meta.currency || "SGD",
        paymentMethod: "stripe",
        paymentStatus: isLegacyDeposit ? "deposit_paid" : "fully_paid",
        stripeCheckoutSessionId: sessionId,
        stripePaymentIntentId: pi || null,
        stripeCustomerId: customerId || null,
        stripePaymentMethodId: paymentMethodId || null,
        tokenDiscount: parseInt(meta.tokenDiscount || "0", 10) || 0,
        tokensRedeemed: parseInt(meta.tokensRedeemed || "0", 10) || 0,
      },
      include: {
        expert: { include: { user: true } },
        founder: true,
      },
    });

    triggerBookingEmails(booking);

    storeBookingEvent({
      expertId: booking.expertId,
      founderName:
        booking.founder.nickName ?? booking.founder.name ?? "Client",
      sessionType: booking.sessionType,
      startTime: booking.startTime,
      status: booking.status,
    }).catch(() => {});

    const paymentLabel = `${booking.currency} ${((booking.depositAmountCents || 0) / 100).toFixed(2)}`;

    notifyExpertBooking({
      expertTelegramId: booking.expert.user.telegramId,
      expertTelegramUsername: booking.expert.user.telegramUsername,
      founderName:
        booking.founder.nickName ?? booking.founder.name ?? "Client",
      sessionType: booking.sessionType,
      startTime: booking.startTime,
      depositAmount: paymentLabel,
      timezone: booking.timezone,
    }).catch(() => {});

    notifyFounderBooking({
      founderTelegramId: booking.founder.telegramId,
      founderTelegramUsername: booking.founder.telegramUsername,
      expertName:
        booking.expert.user.nickName ?? booking.expert.user.name ?? "Expert",
      sessionType: booking.sessionType,
      startTime: booking.startTime,
      depositAmount: paymentLabel,
      timezone: booking.timezone,
    }).catch(() => {});

    console.log(
      `[bookings/verify] Booking ${booking.id} created from checkout success page`
    );

    return NextResponse.json({
      status: "created",
      bookingId: booking.id,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[bookings/verify]", message, error);
    return NextResponse.json(
      { error: "Verification failed", detail: message },
      { status: 500 }
    );
  }
}
