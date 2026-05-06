import { type NextRequest, NextResponse } from "next/server";

import type { SessionType } from "@/generated/prisma/client";
import { apiLog } from "@/lib/api-logger";
import { triggerBookingEmails } from "@/lib/booking-emails";
import { guestContactSchema, upsertGuestUser } from "@/lib/booking-guest";
import { findParticipantBookingConflict } from "@/lib/booking-utils";
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
  /** Opt-in for the in-app TRTC live consultation room. */
  isPremiumLive: z.coerce.boolean().optional(),
  // Guest checkout fields — only used when there is no resolved session
  // (Web no-login flow). Telegram/WeChat callers ignore these because they
  // already have platform identity via initData / openId.
  guestEmail: z.string().optional(),
  guestName: z.string().optional(),
  saveEmail: z.coerce.boolean().optional(),
});

export async function POST(request: NextRequest) {
  const startedAt = Date.now();
  try {
    const sessionUserId = await resolveUserId(request);

    const parsed = freeBookingBodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }
    const body = parsed.data;
    const {
      expertId,
      sessionType,
      startTime,
      endTime,
      timezone,
      meetingLink,
      offlineAddress,
      isPremiumLive,
    } = body;

    // Resolve the booker. Logged-in callers (Web/TG/WeChat) use their session
    // user. Anonymous Web callers must provide name + email — we upsert a
    // User row keyed by email so every existing FK / notification / token
    // path keeps working unchanged.
    let userId: string;
    let isGuest = false;
    if (sessionUserId) {
      userId = sessionUserId;
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
      userId = guest.userId;
      isGuest = true;
    }

    // Per-IP rate limit applies to everyone. Identifier is the userId for
    // signed-in callers, or email-keyed for guests so a single bad actor
    // can't churn through experts.
    const rateLimited = checkRateLimit(request, {
      namespace: "bookings:free",
      identifier: isGuest ? `guest:${userId}` : userId,
      limit: isGuest ? 5 : 12,
      windowMs: isGuest ? 24 * 60 * 60_000 : 5 * 60_000,
    });
    if (rateLimited) return rateLimited;

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
        isPremiumLive: !!isPremiumLive,
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
