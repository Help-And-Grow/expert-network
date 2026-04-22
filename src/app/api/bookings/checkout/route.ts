import { type NextRequest, NextResponse } from "next/server";

import { auth } from "@/auth";
import { apiLog } from "@/lib/api-logger";
import { findOverlappingBooking } from "@/lib/booking-utils";
import { redeemTokens } from "@/lib/hg-token";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit";
import { createCheckoutSession, calculateBookingAmount, getPlatformFeePercent } from "@/lib/stripe";
import { z } from "zod";

const checkoutBodySchema = z.object({
  expertId: z.string().trim().min(1),
  sessionType: z.enum(["ONLINE", "OFFLINE"]),
  startTime: z.string().trim().min(1),
  endTime: z.string().trim().min(1),
  timezone: z.string().trim().min(1).optional(),
  meetingLink: z.string().optional().nullable(),
  offlineAddress: z.string().optional().nullable(),
  redeemTokenCount: z.coerce.number().int().min(0).optional(),
});

export async function POST(request: NextRequest) {
  const startedAt = Date.now();
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const rateLimited = checkRateLimit(request, {
      namespace: "bookings:checkout",
      identifier: session.user.id,
      limit: 12,
      windowMs: 5 * 60_000,
    });
    if (rateLimited) return rateLimited;

    const parsed = checkoutBodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }
    const body = parsed.data;
    const { expertId, sessionType, startTime, endTime, timezone, meetingLink, offlineAddress, redeemTokenCount } =
      body;

    const start = new Date(startTime);
    const end = new Date(endTime);
    if (isNaN(start.getTime()) || isNaN(end.getTime()) || end <= start) {
      return NextResponse.json(
        { error: "Invalid time range" },
        { status: 400 }
      );
    }

    const expert = await prisma.expert.findUnique({
      where: { id: expertId, isPublished: true },
      include: { user: true },
    });

    if (!expert) {
      return NextResponse.json({ error: "Expert not found" }, { status: 404 });
    }

    if (expert.userId === session.user.id) {
      return NextResponse.json({ error: "You cannot book yourself" }, { status: 400 });
    }

    const overlap = await findOverlappingBooking(expertId, start, end);
    if (overlap) {
      return NextResponse.json(
        { error: "This time slot is already booked. Please choose a different time." },
        { status: 409 }
      );
    }

    const pricePerHour =
      sessionType === "OFFLINE"
        ? expert.priceOfflineCents
        : expert.priceOnlineCents;

    if (!pricePerHour || pricePerHour <= 0) {
      return NextResponse.json(
        { error: "Expert has not set pricing for this session type" },
        { status: 400 }
      );
    }

    const { totalCents, depositCents } = calculateBookingAmount(
      pricePerHour,
      start,
      end
    );

    let tokenDiscountCents = 0;
    let tokensDebited = 0;
    const parsedRedeemTokens = Math.max(0, Math.floor(Number(redeemTokenCount) || 0));

    if (parsedRedeemTokens > 0) {
      const result = await redeemTokens(session.user.id, "", parsedRedeemTokens);
      tokenDiscountCents = result.discountCents;
      tokensDebited = result.tokensDebited;
    }

    const adjustedDepositCents = Math.max(0, depositCents - tokenDiscountCents);
    const adjustedTotalCents = Math.max(0, totalCents - tokenDiscountCents);

    const origin =
      request.headers.get("origin") || process.env.NEXTAUTH_URL || "";

    const paymentIntentData: Record<string, unknown> = {
      metadata: {
        expertId,
        founderId: session.user.id,
        sessionType,
        startTime: start.toISOString(),
        endTime: end.toISOString(),
        timezone: timezone || "Asia/Singapore",
        meetingLink: meetingLink || "",
        offlineAddress: offlineAddress || "",
        totalCents: String(adjustedTotalCents),
        depositCents: String(adjustedDepositCents),
        currency: expert.currency,
        tokenDiscount: String(tokenDiscountCents),
        tokensRedeemed: String(tokensDebited),
      },
    };

    if (expert.stripeAccountId && expert.stripeAccountStatus === "active") {
      const feePercent = getPlatformFeePercent();
      const applicationFee = Math.round(adjustedDepositCents * (feePercent / 100));
      paymentIntentData.application_fee_amount = applicationFee;
      paymentIntentData.transfer_data = {
        destination: expert.stripeAccountId,
      };
    }

    if (adjustedDepositCents <= 0) {
      return NextResponse.json({
        freeCheckout: true,
        tokenDiscount: tokenDiscountCents,
        tokensRedeemed: tokensDebited,
        message: "Booking fully covered by H&G tokens. Use the free booking endpoint.",
      });
    }

    const paymentMethodOptions: Record<string, unknown> = {
      card: { setup_future_usage: "off_session" },
    };

    const checkoutSession = await createCheckoutSession({
      mode: "payment",
      line_items: [
        {
          price_data: {
            currency: expert.currency.toLowerCase(),
            unit_amount: adjustedDepositCents,
            product_data: {
              name: `Session Deposit — ${expert.user.nickName || expert.user.name || "Expert"}`,
              description: `${sessionType} session on ${start.toLocaleDateString()}. 50% deposit${tokensDebited > 0 ? ` (${tokensDebited} H&G tokens applied)` : ""}.`,
            },
          },
          quantity: 1,
        },
      ],
      payment_intent_data: paymentIntentData,
      payment_method_options: paymentMethodOptions,
      metadata: {
        type: "booking_deposit",
        expertId,
        founderId: session.user.id,
      },
      success_url: `${origin}/bookings/checkout-success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/experts/${expertId}/book?cancelled=true`,
    });

    apiLog("info", "bookings/checkout", "checkout_created", request, {
      userId: session.user.id,
      expertId,
      sessionType,
      amountCents: adjustedDepositCents,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json({ checkoutUrl: checkoutSession.url });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    apiLog("error", "bookings/checkout", "failed", request, {
      durationMs: Date.now() - startedAt,
      error: message,
    });
    return NextResponse.json(
      { error: "Failed to create checkout session", detail: message },
      { status: 500 }
    );
  }
}
