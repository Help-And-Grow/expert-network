import { type NextRequest, NextResponse } from "next/server";

import { Prisma } from "@/generated/prisma/client";
import { z } from "zod";

import { hasActiveMembership } from "@/lib/membership";
import { prismaFull as prisma } from "@/lib/prisma";
import { resolveUserId } from "@/lib/request-auth";
import { isWeChatOriginatedRequest } from "@/lib/request-origin";
import {
  buildTrtcParticipantId,
  buildTrtcRoomIdCandidate,
  generateTrtcUserSig,
  getTrtcConfig,
  getTrtcWindow,
  isTrtcConfigured,
  type TrtcParticipantRole,
} from "@/lib/trtc";

export const maxDuration = 15;

const requestSchema = z.object({
  bookingId: z.string().min(1, "bookingId is required"),
});

const PREMIUM_LIVE_LEDGER_TYPE = "PREMIUM_LIVE_DEBIT";
const ROOM_ID_ALLOCATION_ATTEMPTS = 8;

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

async function ensureLiveRoomId(bookingId: string, currentLiveRoomId: string | null): Promise<string> {
  if (currentLiveRoomId) return currentLiveRoomId;

  for (let attempt = 0; attempt < ROOM_ID_ALLOCATION_ATTEMPTS; attempt += 1) {
    const candidate = buildTrtcRoomIdCandidate(bookingId, attempt);
    try {
      const result = await prisma.booking.updateMany({
        where: {
          id: bookingId,
          liveRoomId: null,
        },
        data: {
          liveRoomId: candidate,
        },
      });

      if (result.count === 1) return candidate;

      const existing = await prisma.booking.findUnique({
        where: { id: bookingId },
        select: { liveRoomId: true },
      });
      if (existing?.liveRoomId) return existing.liveRoomId;
    } catch (error) {
      if (isUniqueConstraintError(error)) continue;
      throw error;
    }
  }

  throw new Error("Failed to allocate a unique TRTC room ID for this booking.");
}

async function ensurePremiumLiveDebit(bookingId: string, founderId: string): Promise<void> {
  const { premiumLiveTokens } = getTrtcConfig();
  const chargedAt = new Date();

  await prisma.$transaction(async (tx) => {
    const claim = await tx.booking.updateMany({
      where: {
        id: bookingId,
        liveAccessChargedAt: null,
      },
      data: {
        liveAccessChargedAt: chargedAt,
      },
    });

    if (claim.count === 0) return;

    if (premiumLiveTokens <= 0) return;

    const debit = await tx.user.updateMany({
      where: {
        id: founderId,
        tokenBalance: { gte: premiumLiveTokens },
      },
      data: {
        tokenBalance: { decrement: premiumLiveTokens },
      },
    });

    if (debit.count !== 1) {
      throw new Error(`Premium live access requires ${premiumLiveTokens} H&G tokens.`);
    }

    await tx.tokenLedger.create({
      data: {
        userId: founderId,
        bookingId,
        type: PREMIUM_LIVE_LEDGER_TYPE,
        amount: -premiumLiveTokens,
        description: `Premium live consultation access for booking ${bookingId}`,
      },
    });
  });
}

export async function POST(request: NextRequest) {
  if (!isTrtcConfigured()) {
    return NextResponse.json(
      { error: "TRTC is not configured for this environment." },
      { status: 503 },
    );
  }

  const userId = await resolveUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Please sign in to enter a live consultation." }, { status: 401 });
  }

  let parsedBody: z.infer<typeof requestSchema>;
  try {
    parsedBody = requestSchema.parse(await request.json());
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid request body";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const booking = await prisma.booking.findUnique({
    where: { id: parsedBody.bookingId },
    select: {
      id: true,
      founderId: true,
      startTime: true,
      endTime: true,
      status: true,
      isPremiumLive: true,
      liveRoomId: true,
      expert: {
        select: {
          userId: true,
        },
      },
    },
  });

  if (!booking) {
    return NextResponse.json({ error: "Booking not found." }, { status: 404 });
  }

  let participantRole: TrtcParticipantRole | null = null;
  if (booking.founderId === userId) {
    participantRole = "founder";
  } else if (booking.expert.userId === userId) {
    participantRole = "expert";
  }

  if (!participantRole) {
    return NextResponse.json(
      { error: "You are not a participant in this booking." },
      { status: 403 },
    );
  }

  if (!booking.isPremiumLive) {
    return NextResponse.json(
      { error: "Premium live consultation is not enabled for this booking." },
      { status: 403 },
    );
  }

  if (booking.status !== "CONFIRMED" && booking.status !== "COMPLETED") {
    return NextResponse.json(
      { error: "This booking is not ready for live consultation yet." },
      { status: 409 },
    );
  }

  const window = getTrtcWindow(booking.startTime, booking.endTime);
  if (window.isTooEarly) {
    return NextResponse.json(
      {
        error: "This live consultation room is not open yet.",
        opensAt: window.opensAt.toISOString(),
      },
      { status: 403 },
    );
  }
  if (window.isExpired) {
    return NextResponse.json(
      {
        error: "This live consultation room has closed.",
        closesAt: window.closesAt.toISOString(),
      },
      { status: 410 },
    );
  }

  // Entitlement: WeChat-originated requests gate on an active membership.
  // Web/Telegram requests gate on H&G token balance via ensurePremiumLiveDebit.
  // The expert (host) is always allowed in — only the founder pays.
  const fromWeChat = isWeChatOriginatedRequest(request);

  if (fromWeChat && participantRole === "founder") {
    const membership = await prisma.membership.findUnique({
      where: { userId: booking.founderId },
      select: { currentUntil: true },
    });
    if (!hasActiveMembership(membership)) {
      return NextResponse.json(
        {
          error:
            "Premium live consultation requires an active membership. Please subscribe to continue.",
          reason: "MEMBERSHIP_REQUIRED",
        },
        { status: 402 },
      );
    }
  }

  try {
    const roomId = await ensureLiveRoomId(booking.id, booking.liveRoomId);
    if (!fromWeChat) {
      // Token-debit path stays for web/Telegram. Expert role joining a
      // WeChat booking shouldn't trigger a token charge against the founder
      // either — fromWeChat covers that case.
      await ensurePremiumLiveDebit(booking.id, booking.founderId);
    }

    const config = getTrtcConfig();
    const trtcUserId = buildTrtcParticipantId({
      bookingId: booking.id,
      userId,
      role: participantRole,
    });

    return NextResponse.json({
      sdkAppId: config.appId,
      roomId: Number(roomId),
      userId: trtcUserId,
      userSig: generateTrtcUserSig(trtcUserId, window.expiresInSeconds),
      expiresInSeconds: window.expiresInSeconds,
      expiresAt: window.expiresAt.toISOString(),
      participantRole,
      premiumLiveTokenCost: config.premiumLiveTokens,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to issue TRTC credentials.";
    const status = message.includes("requires") ? 402 : 500;
    console.error("[trtc/token POST]", message, error);
    return NextResponse.json({ error: message }, { status });
  }
}
