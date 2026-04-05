import { type NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { resolveUserId } from "@/lib/request-auth";
import { createCheckoutSession, calculateBookingAmount, getPlatformFeePercent } from "@/lib/stripe";

/**
 * POST /api/bookings/[id]/pay-remainder
 * Creates a Stripe Checkout Session for the remainder amount on a booking
 * that was originally paid with a single-use method (PayNow, GrabPay, etc.).
 */
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

    if (booking.founderId !== userId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    if (booking.paymentStatus !== "remainder_due") {
      return NextResponse.json(
        { error: "Remainder payment is not due for this booking" },
        { status: 400 }
      );
    }

    const { totalCents, depositCents } = calculateBookingAmount(
      booking.sessionType === "OFFLINE"
        ? (booking.expert.priceOfflineCents || 0)
        : (booking.expert.priceOnlineCents || 0),
      booking.startTime,
      booking.endTime
    );

    const remainderCents = totalCents - depositCents;
    if (remainderCents <= 0) {
      await prisma.booking.update({
        where: { id: booking.id },
        data: { paymentStatus: "fully_paid", remainderChargedAt: new Date() },
      });
      return NextResponse.json({ alreadyPaid: true });
    }

    const origin =
      request.headers.get("origin") || process.env.NEXTAUTH_URL || "";

    const expertName =
      booking.expert.user.nickName || booking.expert.user.name || "Expert";

    const paymentIntentData: Record<string, unknown> = {
      metadata: {
        type: "booking_remainder",
        bookingId: booking.id,
        expertId: booking.expertId,
        founderId: booking.founderId,
      },
    };

    if (booking.expert.stripeAccountId && booking.expert.stripeAccountStatus === "active") {
      const feePercent = getPlatformFeePercent();
      const applicationFee = Math.round(remainderCents * (feePercent / 100));
      paymentIntentData.application_fee_amount = applicationFee;
      paymentIntentData.transfer_data = {
        destination: booking.expert.stripeAccountId,
      };
    }

    const checkoutSession = await createCheckoutSession({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: (booking.currency || "SGD").toLowerCase(),
            unit_amount: remainderCents,
            product_data: {
              name: `Session Remainder — ${expertName}`,
              description: `Remaining 50% for ${booking.sessionType} session on ${booking.startTime.toLocaleDateString()}.`,
            },
          },
          quantity: 1,
        },
      ],
      payment_intent_data: paymentIntentData,
      payment_method_options: {},
      metadata: {
        type: "booking_remainder",
        bookingId: booking.id,
        expertId: booking.expertId,
        founderId: booking.founderId,
      },
      success_url: `${origin}/booking?remainder_paid=${booking.id}`,
      cancel_url: `${origin}/booking?remainder_cancelled=${booking.id}`,
    });

    return NextResponse.json({ checkoutUrl: checkoutSession.url });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[bookings/pay-remainder POST]", message, error);
    return NextResponse.json(
      { error: "Failed to create remainder checkout", detail: message },
      { status: 500 }
    );
  }
}
