import { type NextRequest, NextResponse } from "next/server";

import type { SessionType } from "@/generated/prisma/client";
import { apiLog } from "@/lib/api-logger";
import { triggerBookingEmails } from "@/lib/booking-emails";
import { findOverlappingBooking } from "@/lib/booking-utils";
import { generateMeetingLink } from "@/lib/meeting";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit";
import { resolveUserId } from "@/lib/request-auth";
import { notifyExpertBooking, notifyFounderBooking } from "@/lib/telegram-bot";
import { z } from "zod";

const freeBookingBodySchema = z.object({
  expertId: z.string().trim().min(1),
  sessionType: z.enum(["ONLINE", "OFFLINE"]),
  startTime: z.string().trim().min(1),
  endTime: z.string().trim().min(1),
  timezone: z.string().trim().min(1).optional(),
  meetingLink: z.string().optional().nullable(),
  offlineAddress: z.string().optional().nullable(),
});

export async function POST(request: NextRequest) {
  const startedAt = Date.now();
  try {
    const userId = await resolveUserId(request);
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const rateLimited = checkRateLimit(request, {
      namespace: "bookings:free",
      identifier: userId,
      limit: 12,
      windowMs: 5 * 60_000,
    });
    if (rateLimited) return rateLimited;

    const parsed = freeBookingBodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }
    const body = parsed.data;
    const { expertId, sessionType, startTime, endTime, timezone, meetingLink, offlineAddress } = body;

    const start = new Date(startTime);
    const end = new Date(endTime);
    if (isNaN(start.getTime()) || isNaN(end.getTime()) || end <= start) {
      return NextResponse.json({ error: "Invalid time range" }, { status: 400 });
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

    const pricePerHour =
      sessionType === "OFFLINE" ? expert.priceOfflineCents : expert.priceOnlineCents;

    if (pricePerHour !== 0) {
      return NextResponse.json(
        { error: "This endpoint is only for free sessions (price = 0)" },
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

    const founder = await prisma.user.findUnique({ where: { id: userId } });

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
        status: "CONFIRMED",
        totalAmountCents: 0,
        depositAmountCents: 0,
        currency: expert.currency,
        paymentMethod: "free",
        paymentStatus: "fully_paid",
      },
      include: {
        expert: { include: { user: true } },
        founder: true,
      },
    });

    triggerBookingEmails(booking);

    const expertName = expert.user.nickName ?? expert.user.name ?? "Expert";
    const founderName = founder?.nickName ?? founder?.name ?? "Client";

    notifyExpertBooking({
      expertTelegramId: expert.user.telegramId,
      expertTelegramUsername: expert.user.telegramUsername,
      founderName,
      sessionType,
      startTime: start,
      depositAmount: "Free",
      timezone: timezone || "Asia/Singapore",
    }).catch(() => {});

    notifyFounderBooking({
      founderTelegramId: founder?.telegramId,
      founderTelegramUsername: founder?.telegramUsername,
      expertName,
      sessionType,
      startTime: start,
      depositAmount: "Free",
      timezone: timezone || "Asia/Singapore",
    }).catch(() => {});

    apiLog("info", "bookings/free", "booking_created", request, {
      userId,
      expertId,
      sessionType,
      bookingId: booking.id,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json({ bookingId: booking.id });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    apiLog("error", "bookings/free", "failed", request, {
      durationMs: Date.now() - startedAt,
      error: message,
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
