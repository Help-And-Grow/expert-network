import { type NextRequest, NextResponse } from "next/server";

import { auth } from "@/auth";
import { apiLog } from "@/lib/api-logger";
import { guestContactSchema, upsertGuestUser } from "@/lib/booking-guest";
import { findParticipantBookingConflict } from "@/lib/booking-utils";
import { redeemTokens } from "@/lib/hg-token";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit";
import { isWeChatOriginatedRequest } from "@/lib/request-origin";
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
  /** Opt-in for the in-app TRTC live consultation room. */
  isPremiumLive: z.coerce.boolean().optional(),
  // Guest checkout fields — only used when there is no Auth.js session
  // (Web no-login flow). Stripe Checkout's `customer_email` will be pre-filled
  // with `guestEmail` so the user types it once.
  guestEmail: z.string().optional(),
  guestName: z.string().optional(),
  saveEmail: z.coerce.boolean().optional(),
});

export async function POST(request: NextRequest) {
  const startedAt = Date.now();
  try {
    const session = await auth();

    const parsed = checkoutBodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }
    const body = parsed.data;

    // WeChat Mini Program is online-only — reject offline attempts. The MP is
    // also currently positioned as FREE so this endpoint shouldn't be hit by
    // WeChat traffic at all, but the guard is defense-in-depth in case paid
    // bookings get enabled in the WeChat MP later.
    if (isWeChatOriginatedRequest(request) && body.sessionType === "OFFLINE") {
      return NextResponse.json(
        { error: "WeChat Mini Program supports online meetups only." },
        { status: 400 },
      );
    }
    const {
      expertId,
      sessionType,
      startTime,
      endTime,
      timezone,
      meetingLink,
      offlineAddress,
      redeemTokenCount,
      isPremiumLive,
    } = body;

    // Resolve booker. Logged-in: use session. Anonymous: require name + email,
    // upsert User by email. The Stripe Checkout session below pre-fills
    // `customer_email` from this so the user types their email once.
    let founderId: string;
    let stripePrefillEmail: string | undefined;
    let isGuest = false;
    if (session?.user?.id) {
      founderId = session.user.id;
    } else {
      const contactParsed = guestContactSchema.safeParse({
        guestEmail: body.guestEmail,
        guestName: body.guestName,
        saveEmail: body.saveEmail,
      });
      if (!contactParsed.success) {
        return NextResponse.json(
          {
            error: "Please sign in or provide your name and email to book.",
            details: contactParsed.error.flatten().fieldErrors,
          },
          { status: 400 }
        );
      }
      const guest = await upsertGuestUser(contactParsed.data);
      founderId = guest.userId;
      stripePrefillEmail = contactParsed.data.guestEmail;
      isGuest = true;
    }

    const rateLimited = checkRateLimit(request, {
      namespace: "bookings:checkout",
      identifier: isGuest ? `guest:${founderId}` : founderId,
      limit: isGuest ? 6 : 12,
      windowMs: isGuest ? 24 * 60 * 60_000 : 5 * 60_000,
    });
    if (rateLimited) return rateLimited;

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

    if (expert.userId === founderId) {
      return NextResponse.json({ error: "You cannot book yourself" }, { status: 400 });
    }

    const overlap = await findParticipantBookingConflict({
      expertId,
      expertUserId: expert.userId,
      founderId: founderId,
      startTime: start,
      endTime: end,
    });
    if (overlap) {
      return NextResponse.json(
        { error: "One participant already has a meetup during this time. Please choose a different slot." },
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

    const { totalCents, dueNowCents } = calculateBookingAmount(
      pricePerHour,
      start,
      end
    );

    let tokenDiscountCents = 0;
    let tokensDebited = 0;
    const parsedRedeemTokens = Math.max(0, Math.floor(Number(redeemTokenCount) || 0));

    if (parsedRedeemTokens > 0) {
      const result = await redeemTokens(founderId, "", parsedRedeemTokens);
      tokenDiscountCents = result.discountCents;
      tokensDebited = result.tokensDebited;
    }

    const adjustedDueNowCents = Math.max(0, dueNowCents - tokenDiscountCents);
    const adjustedTotalCents = Math.max(0, totalCents - tokenDiscountCents);

    const origin =
      request.headers.get("origin") || process.env.NEXTAUTH_URL || "";

    const paymentIntentData: Record<string, unknown> = {
      metadata: {
        expertId,
        founderId: founderId,
        sessionType,
        startTime: start.toISOString(),
        endTime: end.toISOString(),
        timezone: timezone || "Asia/Singapore",
        meetingLink: meetingLink || "",
        offlineAddress: offlineAddress || "",
        totalCents: String(adjustedTotalCents),
        dueNowCents: String(adjustedDueNowCents),
        depositCents: String(adjustedDueNowCents),
        currency: expert.currency,
        tokenDiscount: String(tokenDiscountCents),
        tokensRedeemed: String(tokensDebited),
        isPremiumLive: isPremiumLive ? "1" : "0",
      },
    };

    if (expert.stripeAccountId && expert.stripeAccountStatus === "active") {
      const feePercent = getPlatformFeePercent();
      const applicationFee = Math.round(adjustedDueNowCents * (feePercent / 100));
      paymentIntentData.application_fee_amount = applicationFee;
      paymentIntentData.transfer_data = {
        destination: expert.stripeAccountId,
      };
    }

    if (adjustedDueNowCents <= 0) {
      return NextResponse.json({
        freeCheckout: true,
        tokenDiscount: tokenDiscountCents,
        tokensRedeemed: tokensDebited,
        message: "Booking fully covered by H&G tokens. Use the free booking endpoint.",
      });
    }

    const checkoutSession = await createCheckoutSession({
      mode: "payment",
      // Pre-fill the email field so guests don't have to type it twice.
      // For signed-in users we leave Stripe to use whatever's on the
      // customer record (or fall back to the user's profile email if any).
      ...(stripePrefillEmail ? { customer_email: stripePrefillEmail } : {}),
      line_items: [
        {
          price_data: {
            currency: expert.currency.toLowerCase(),
            unit_amount: adjustedDueNowCents,
            product_data: {
              name: `Session — ${expert.user.nickName || expert.user.name || "Expert"}`,
              description: `${sessionType} session on ${start.toLocaleDateString()}. Full payment due now${tokensDebited > 0 ? ` (${tokensDebited} H&G tokens applied)` : ""}.`,
            },
          },
          quantity: 1,
        },
      ],
      payment_intent_data: paymentIntentData,
      payment_method_options: {},
      metadata: {
        type: "booking_full_payment",
        expertId,
        founderId: founderId,
      },
      success_url: `${origin}/bookings/checkout-success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/experts/${expertId}/book?cancelled=true`,
    });

    apiLog("info", "bookings/checkout", "checkout_created", request, {
      userId: founderId,
      expertId,
      sessionType,
      amountCents: adjustedDueNowCents,
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
