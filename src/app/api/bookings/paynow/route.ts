import { type NextRequest, NextResponse } from "next/server";

import type { SessionType } from "@/generated/prisma/client";
import { findOverlappingBooking } from "@/lib/booking-utils";
import { generateMeetingLink } from "@/lib/meeting";
import {
  buildPayNowQrDataUrl,
  getPayNowConfig,
  supportsPayNowForCurrency,
} from "@/lib/paynow";
import { prisma } from "@/lib/prisma";
import { resolveUserId } from "@/lib/request-auth";
import { calculateBookingAmount } from "@/lib/stripe";

function parseSessionType(value: unknown): SessionType | null {
  return value === "ONLINE" || value === "OFFLINE" ? (value as SessionType) : null;
}

function generatePayNowReference(): string {
  const ts = Date.now().toString(36).toUpperCase().slice(-6);
  const rand = Math.random().toString(36).toUpperCase().slice(2, 6);
  return `HG-${ts}-${rand}`;
}

export async function POST(request: NextRequest) {
  try {
    const userId = await resolveUserId(request);
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const payNowConfig = getPayNowConfig();
    if (!payNowConfig) {
      return NextResponse.json(
        { error: "PayNow is not configured for this environment" },
        { status: 503 }
      );
    }

    const body = await request.json();
    const { expertId, startTime, endTime, timezone, meetingLink, offlineAddress } = body;
    const sessionType = parseSessionType(body.sessionType);

    if (!expertId || !sessionType || !startTime || !endTime) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

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

    if (expert.userId === userId) {
      return NextResponse.json({ error: "You cannot book yourself" }, { status: 400 });
    }

    if (!supportsPayNowForCurrency(expert.currency)) {
      return NextResponse.json(
        { error: "PayNow is available for SGD bookings only" },
        { status: 400 }
      );
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

    if (depositCents <= 0) {
      return NextResponse.json(
        { error: "No payment due. Please use free booking flow." },
        { status: 400 }
      );
    }

    const paynowReference = generatePayNowReference();
    const { payload, qrDataUrl } = await buildPayNowQrDataUrl({
      uen: payNowConfig.uen,
      companyName: payNowConfig.companyName,
      amountCents: depositCents,
      reference: paynowReference,
      editableAmount: payNowConfig.editableAmount,
    });

    const holdExpiresAt = new Date(Date.now() + 30 * 60 * 1000);

    const booking = await prisma.booking.create({
      data: {
        expertId,
        founderId: userId,
        sessionType,
        startTime: start,
        endTime: end,
        timezone: timezone || "Asia/Singapore",
        meetingLink: sessionType === "ONLINE"
          ? (meetingLink || generateMeetingLink())
          : null,
        offlineAddress: offlineAddress || null,
        status: "PENDING",
        totalAmountCents: totalCents,
        depositAmountCents: depositCents,
        currency: expert.currency,
        paymentMethod: "paynow",
        paymentStatus: "pending_paynow",
        paynowReference,
      },
    });

    return NextResponse.json({
      bookingId: booking.id,
      paynowReference,
      amountCents: depositCents,
      amountLabel: `${expert.currency} ${(depositCents / 100).toFixed(2)}`,
      qrDataUrl,
      payload,
      receiver: {
        companyName: payNowConfig.companyName,
        uen: payNowConfig.uen,
      },
      holdExpiresAt: holdExpiresAt.toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[bookings/paynow POST]", message, error);
    return NextResponse.json(
      { error: "Failed to create PayNow payment", detail: message },
      { status: 500 }
    );
  }
}
