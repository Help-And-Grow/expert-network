import { type NextRequest, NextResponse } from "next/server";

import type { SessionType } from "@/generated/prisma/client";
import { findParticipantBookingConflict } from "@/lib/booking-utils";
import { generateMeetingLink } from "@/lib/meeting";
import { prisma } from "@/lib/prisma";
import { resolveUserId } from "@/lib/request-auth";
import { calculateBookingAmount } from "@/lib/stripe";
const TON_RATE_API = "https://tonapi.io/v2/rates?tokens=ton&currencies=sgd";

async function getSGDToTONRate(): Promise<number> {
  try {
    const res = await fetch(TON_RATE_API, { next: { revalidate: 300 } });
    const data = await res.json();
    const sgdRate = data?.rates?.TON?.prices?.SGD;
    if (sgdRate && sgdRate > 0) return sgdRate;
  } catch (e) {
    console.error("[ton-payment] Rate fetch failed:", e);
  }
  return 3.5; // fallback rate
}

export async function POST(request: NextRequest) {
  try {
    const userId = await resolveUserId(request);
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { expertId, sessionType, startTime, endTime, timezone, meetingLink, offlineAddress } =
      body;

    if (!expertId || !sessionType || !startTime || !endTime) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    const platformWalletRaw = process.env.PLATFORM_TON_WALLET;
    if (!platformWalletRaw) {
      return NextResponse.json(
        { error: "TON payments not configured" },
        { status: 500 }
      );
    }
    // Sanitize: trim, strip quotes, convert URL-safe base64 to standard, ensure padding
    let walletAddr = platformWalletRaw.trim().replace(/^["']|["']$/g, "");
    walletAddr = walletAddr.replace(/-/g, "+").replace(/_/g, "/");
    while (walletAddr.length % 4 !== 0) walletAddr += "=";
    console.log("[ton-payment] raw env:", JSON.stringify(platformWalletRaw), "cleaned:", walletAddr, "len:", walletAddr.length);

    const start = new Date(startTime);
    const end = new Date(endTime);

    const expert = await prisma.expert.findUnique({
      where: { id: expertId, isPublished: true },
      include: { user: true },
    });

    if (!expert) {
      return NextResponse.json({ error: "Expert not found" }, { status: 404 });
    }

    if (expert.userId === userId) {
      return NextResponse.json({ error: "You cannot book yourself" }, { status: 400 });
    }

    const overlap = await findParticipantBookingConflict({
      expertId,
      expertUserId: expert.userId,
      founderId: userId,
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
        { error: "Expert has not set pricing" },
        { status: 400 }
      );
    }

    const { totalCents, dueNowCents } = calculateBookingAmount(
      pricePerHour,
      start,
      end
    );

    const tonRate = await getSGDToTONRate();
    const paymentSGD = dueNowCents / 100;
    const paymentTON = paymentSGD / tonRate;
    const paymentNanoTON = Math.ceil(paymentTON * 1e9);

    // PENDING holds the slot; user confirms after paying in wallet.
    // Unconfirmed PENDING bookings expire after 30 minutes (cleaned lazily).
    const booking = await prisma.booking.create({
      data: {
        expertId,
        founderId: userId,
        sessionType: sessionType as SessionType,
        startTime: start,
        endTime: end,
        timezone: timezone || "Asia/Singapore",
        meetingLink: sessionType === "ONLINE"
          ? (meetingLink || generateMeetingLink())
          : null,
        offlineAddress: offlineAddress || null,
        status: "PENDING",
        totalAmountCents: totalCents,
        depositAmountCents: dueNowCents,
        currency: expert.currency,
        paymentMethod: "ton",
        paymentStatus: "pending",
      },
    });

    const comment = `booking:${booking.id}`;

    return NextResponse.json({
      bookingId: booking.id,
      walletAddress: walletAddr,
      amountNanoTON: paymentNanoTON.toString(),
      comment,
      paymentTON: paymentTON.toFixed(4),
      paymentSGD: paymentSGD.toFixed(2),
      depositTON: paymentTON.toFixed(4),
      depositSGD: paymentSGD.toFixed(2),
      tonRate: tonRate.toFixed(2),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[bookings/ton-payment POST]", message, error);
    return NextResponse.json(
      { error: "Failed to create TON payment", detail: message },
      { status: 500 }
    );
  }
}
