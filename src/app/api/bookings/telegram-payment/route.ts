import { type NextRequest, NextResponse } from "next/server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { calculateBookingAmount } from "@/lib/stripe";

/**
 * Creates a Telegram Bot API invoice link for card payment inside Telegram.
 * Uses the Stripe provider token configured via BotFather.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { expertId, sessionType, startTime, endTime, timezone, meetingLink } =
      body;

    if (!expertId || !sessionType || !startTime || !endTime) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const providerToken = process.env.TELEGRAM_PAYMENT_PROVIDER_TOKEN;

    if (!botToken || !providerToken) {
      return NextResponse.json(
        { error: "Telegram payments not configured" },
        { status: 500 }
      );
    }

    const start = new Date(startTime);
    const end = new Date(endTime);

    const expert = await prisma.expert.findUnique({
      where: { id: expertId, isPublished: true },
      include: { user: true },
    });

    if (!expert) {
      return NextResponse.json({ error: "Expert not found" }, { status: 404 });
    }

    const pricePerHour =
      sessionType === "OFFLINE"
        ? expert.priceOfflineCents
        : expert.priceOnlineCents;

    if (!pricePerHour || pricePerHour <= 0) {
      return NextResponse.json(
        { error: "Expert has not set pricing" },
        { status: 400 }
      );
    }

    const { totalCents, depositCents } = calculateBookingAmount(
      pricePerHour,
      start,
      end
    );

    const payload = JSON.stringify({
      expertId,
      founderId: session.user.id,
      sessionType,
      startTime: start.toISOString(),
      endTime: end.toISOString(),
      timezone: timezone || "Asia/Singapore",
      meetingLink: meetingLink || "",
      totalCents,
      depositCents,
      currency: expert.currency,
    });

    const expertName =
      expert.user.nickName || expert.user.name || "Expert";

    // Create invoice link via Telegram Bot API
    const tgRes = await fetch(
      `https://api.telegram.org/bot${botToken}/createInvoiceLink`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: `Session with ${expertName}`,
          description: `${sessionType} session deposit (50%). Remainder charged 24h after session.`,
          payload,
          provider_token: providerToken,
          currency: expert.currency,
          prices: [
            {
              label: "Session Deposit (50%)",
              amount: depositCents,
            },
          ],
        }),
      }
    );

    const tgData = await tgRes.json();

    if (!tgData.ok) {
      console.error("[telegram-payment] Bot API error:", tgData);
      return NextResponse.json(
        { error: "Failed to create Telegram invoice" },
        { status: 500 }
      );
    }

    return NextResponse.json({ invoiceUrl: tgData.result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[bookings/telegram-payment POST]", message, error);
    return NextResponse.json(
      { error: "Failed to create payment", detail: message },
      { status: 500 }
    );
  }
}
