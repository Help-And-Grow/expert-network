import { type NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

import { verifyBookingToken } from "@/lib/booking-token";
import { findParticipantBookingConflict } from "@/lib/booking-utils";
import { prisma } from "@/lib/prisma";
import { resolveUserId } from "@/lib/request-auth";
import { notifyCancellation, notifyReschedule, notifyLocationUpdate } from "@/lib/telegram-bot";
import { notifyWechatBookingCancelled, notifyWechatBookingRescheduled, notifyWechatLocationUpdated } from "@/lib/wechat-notify";

/**
 * Authorization for booking management — Phase 2 of guest-booking.
 *
 * Three valid identities, in priority order:
 *   1. Session (Auth.js cookie / Telegram initData / WeChat token) → returns
 *      the userId and the role they play on the booking (founder / expert).
 *   2. Magic-link token in `?t=...` for THIS booking — grants founder-equivalent
 *      access (view / cancel / reschedule). Token is bound to the bookingId
 *      and signed with AUTH_SECRET; see `lib/booking-token.ts`.
 *   3. Otherwise: not authorized. The caller can render a hint asking the
 *      guest to use the link in their confirmation email.
 *
 * Returns the role for the booking (used by the cancel / reschedule branches
 * to decide which party to notify). For magic-link callers the role is always
 * "founder" because that's whose email the link was emailed to.
 */
async function authorizeBookingAccess(
  request: NextRequest,
  bookingId: string,
  booking: { founderId: string; expert: { userId: string } },
): Promise<{ ok: true; userId: string; role: "founder" | "expert" } | { ok: false; status: 401 | 403 }> {
  const sessionUserId = await resolveUserId(request);
  if (sessionUserId) {
    if (sessionUserId === booking.founderId) {
      return { ok: true, userId: sessionUserId, role: "founder" };
    }
    if (sessionUserId === booking.expert.userId) {
      return { ok: true, userId: sessionUserId, role: "expert" };
    }
    return { ok: false, status: 403 };
  }

  const token = new URL(request.url).searchParams.get("t");
  if (token) {
    const verified = verifyBookingToken(token, bookingId);
    if (verified.ok) {
      return { ok: true, userId: booking.founderId, role: "founder" };
    }
  }

  return { ok: false, status: 401 };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
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

    const auth = await authorizeBookingAccess(request, id, booking);
    if (!auth.ok) {
      return NextResponse.json(
        { error: auth.status === 401 ? "Unauthorized" : "Forbidden" },
        { status: auth.status }
      );
    }

    return NextResponse.json(booking);
  } catch (error) {
    console.error("[bookings/[id] GET]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: "Booking ID is required" }, { status: 400 });
    }

    const body = await request.json().catch(() => ({}));
    if (typeof body !== "object" || body === null) {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }

    const booking = await prisma.booking.findUnique({
      where: { id },
      include: { expert: { include: { user: true } }, founder: true },
    });

    if (!booking) {
      return NextResponse.json({ error: "Booking not found" }, { status: 404 });
    }

    const auth = await authorizeBookingAccess(request, id, booking);
    if (!auth.ok) {
      return NextResponse.json(
        { error: auth.status === 401 ? "Unauthorized" : "Forbidden" },
        { status: auth.status }
      );
    }

    const userId = auth.userId;
    const isFounder = auth.role === "founder";

    const action = typeof body.action === "string" ? body.action : null;

    const msUntilStart = booking.startTime.getTime() - Date.now();
    const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
    const ONE_HOUR_MS = 60 * 60 * 1000;

    // === CANCEL ===
    if (action === "cancel" || body.status === "CANCELLED") {
      if (booking.status === "CANCELLED") {
        return NextResponse.json({ error: "Booking is already cancelled" }, { status: 400 });
      }
      if (booking.status === "COMPLETED") {
        return NextResponse.json({ error: "Cannot cancel a completed booking" }, { status: 400 });
      }
      if (msUntilStart < TWO_HOURS_MS) {
        return NextResponse.json(
          { error: "Cannot cancel a booking that starts within 2 hours" },
          { status: 400 }
        );
      }

      const cancelReason =
        typeof body.reason === "string" ? body.reason.slice(0, 500) : null;

      const updated = await prisma.$transaction(async (tx) => {
        const cancelled = await tx.booking.update({
          where: { id },
          data: {
            status: "CANCELLED",
            cancelledBy: userId,
            cancelReason,
          },
          include: { expert: { include: { user: true } }, founder: true },
        });

        // Refund any premium-live H&G token debit. The /api/trtc/token route
        // sets `liveAccessChargedAt` only when a debit succeeded, and writes a
        // PREMIUM_LIVE_DEBIT ledger row tied to this booking. If a matching
        // refund row already exists (re-cancel attempt) we skip — the unique
        // booking+type pair makes this idempotent in practice because a
        // cancelled booking can't be re-cancelled (guarded above).
        if (cancelled.isPremiumLive && cancelled.liveAccessChargedAt) {
          const debit = await tx.tokenLedger.findFirst({
            where: {
              bookingId: id,
              userId: cancelled.founderId,
              type: "PREMIUM_LIVE_DEBIT",
            },
            orderBy: { createdAt: "desc" },
          });

          if (debit && debit.amount < 0) {
            const refundAmount = -debit.amount;
            await tx.user.update({
              where: { id: cancelled.founderId },
              data: { tokenBalance: { increment: refundAmount } },
            });
            await tx.tokenLedger.create({
              data: {
                userId: cancelled.founderId,
                bookingId: id,
                type: "PREMIUM_LIVE_REFUND",
                amount: refundAmount,
                description: `Premium live consultation refund for cancelled booking ${id}`,
              },
            });
            await tx.booking.update({
              where: { id },
              data: { liveAccessChargedAt: null },
            });
          }
        }

        return cancelled;
      });

      const cancellerName = isFounder
        ? (updated.founder.nickName ?? updated.founder.name ?? "Client")
        : (updated.expert.user.nickName ?? updated.expert.user.name ?? "Expert");
      const founderName = updated.founder.nickName ?? updated.founder.name ?? "Client";
      const expertName = updated.expert.user.nickName ?? updated.expert.user.name ?? "Expert";

      // Notify the other party (Telegram + WeChat)
      if (isFounder) {
        notifyCancellation({
          telegramId: updated.expert.user.telegramId,
          telegramUsername: updated.expert.user.telegramUsername,
          otherPartyName: founderName,
          cancelledByName: cancellerName,
          sessionType: updated.sessionType,
          startTime: updated.startTime,
          reason: updated.cancelReason,
          timezone: updated.timezone,
        }).catch(() => {});
        notifyWechatBookingCancelled({
          userId: updated.expert.userId,
          otherPartyName: founderName,
          sessionType: updated.sessionType,
          startTime: updated.startTime,
          reason: updated.cancelReason ?? undefined,
          timezone: updated.timezone,
        }).catch(() => {});
      } else {
        notifyCancellation({
          telegramId: updated.founder.telegramId,
          telegramUsername: updated.founder.telegramUsername,
          otherPartyName: expertName,
          cancelledByName: cancellerName,
          sessionType: updated.sessionType,
          startTime: updated.startTime,
          reason: updated.cancelReason,
          timezone: updated.timezone,
        }).catch(() => {});
        notifyWechatBookingCancelled({
          userId: updated.founderId,
          otherPartyName: expertName,
          sessionType: updated.sessionType,
          startTime: updated.startTime,
          reason: updated.cancelReason ?? undefined,
          timezone: updated.timezone,
        }).catch(() => {});
      }

      return NextResponse.json(updated);
    }

    // === RESCHEDULE ===
    if (action === "reschedule") {
      if (booking.status === "CANCELLED" || booking.status === "COMPLETED") {
        return NextResponse.json(
          { error: `Cannot reschedule a ${booking.status.toLowerCase()} booking` },
          { status: 400 }
        );
      }
      if (msUntilStart < TWO_HOURS_MS) {
        return NextResponse.json(
          { error: "Cannot reschedule a booking that starts within 2 hours" },
          { status: 400 }
        );
      }

      const newStart = body.startTime ? new Date(body.startTime) : null;
      const newEnd = body.endTime ? new Date(body.endTime) : null;

      if (!newStart || isNaN(newStart.getTime()) || !newEnd || isNaN(newEnd.getTime())) {
        return NextResponse.json(
          { error: "Valid startTime and endTime are required for rescheduling" },
          { status: 400 }
        );
      }
      if (newEnd <= newStart) {
        return NextResponse.json({ error: "endTime must be after startTime" }, { status: 400 });
      }

      const overlap = await findParticipantBookingConflict({
        expertId: booking.expertId,
        expertUserId: booking.expert.userId,
        founderId: booking.founderId,
        startTime: newStart,
        endTime: newEnd,
        excludeBookingId: id,
      });
      if (overlap) {
        return NextResponse.json(
          { error: "One participant already has a meetup during this time. Please choose a different slot." },
          { status: 409 }
        );
      }

      const oldStartTime = booking.startTime;

      const updated = await prisma.booking.update({
        where: { id },
        data: {
          startTime: newStart,
          endTime: newEnd,
          timezone: typeof body.timezone === "string" ? body.timezone : undefined,
        },
        include: { expert: { include: { user: true } }, founder: true },
      });

      const reschedulerName = isFounder
        ? (updated.founder.nickName ?? updated.founder.name ?? "Client")
        : (updated.expert.user.nickName ?? updated.expert.user.name ?? "Expert");
      const rFounderName = updated.founder.nickName ?? updated.founder.name ?? "Client";
      const rExpertName = updated.expert.user.nickName ?? updated.expert.user.name ?? "Expert";

      // Notify the other party (Telegram + WeChat)
      if (isFounder) {
        notifyReschedule({
          telegramId: updated.expert.user.telegramId,
          telegramUsername: updated.expert.user.telegramUsername,
          otherPartyName: rFounderName,
          rescheduledByName: reschedulerName,
          sessionType: updated.sessionType,
          oldStartTime,
          newStartTime: newStart,
          timezone: updated.timezone,
        }).catch(() => {});
        notifyWechatBookingRescheduled({
          userId: updated.expert.userId,
          otherPartyName: rFounderName,
          sessionType: updated.sessionType,
          oldTime: oldStartTime,
          newTime: newStart,
          timezone: updated.timezone,
        }).catch(() => {});
      } else {
        notifyReschedule({
          telegramId: updated.founder.telegramId,
          telegramUsername: updated.founder.telegramUsername,
          otherPartyName: rExpertName,
          rescheduledByName: reschedulerName,
          sessionType: updated.sessionType,
          oldStartTime,
          newStartTime: newStart,
          timezone: updated.timezone,
        }).catch(() => {});
        notifyWechatBookingRescheduled({
          userId: updated.founderId,
          otherPartyName: rExpertName,
          sessionType: updated.sessionType,
          oldTime: oldStartTime,
          newTime: newStart,
          timezone: updated.timezone,
        }).catch(() => {});
      }

      return NextResponse.json(updated);
    }

    // === UPDATE LOCATION ===
    if (action === "update_location") {
      if (booking.sessionType !== "ONLINE" && msUntilStart < ONE_HOUR_MS) {
        return NextResponse.json(
          { error: "Cannot change location for an offline booking that starts within 1 hour" },
          { status: 400 }
        );
      }

      const offlineAddress = typeof body.offlineAddress === "string" ? body.offlineAddress.trim() : null;
      const meetingLink = typeof body.meetingLink === "string" ? body.meetingLink.trim() : null;

      const updated = await prisma.booking.update({
        where: { id },
        data: {
          ...(offlineAddress !== null ? { offlineAddress } : {}),
          ...(meetingLink !== null ? { meetingLink } : {}),
        },
        include: { expert: { include: { user: true } }, founder: true },
      });

      const isOnline = updated.sessionType === "ONLINE";
      const location = isOnline
        ? (meetingLink || updated.meetingLink || "")
        : (offlineAddress || updated.offlineAddress || "");
      const updaterName = isFounder
        ? (updated.founder.nickName ?? updated.founder.name ?? "Client")
        : (updated.expert.user.nickName ?? updated.expert.user.name ?? "Expert");

      // Notify the other party (Telegram + WeChat)
      if (isFounder) {
        notifyLocationUpdate({
          telegramId: updated.expert.user.telegramId,
          telegramUsername: updated.expert.user.telegramUsername,
          otherPartyName: updated.founder.nickName ?? updated.founder.name ?? "Client",
          updatedByName: updaterName,
          sessionType: updated.sessionType,
          startTime: updated.startTime,
          isOnline,
          location,
          timezone: updated.timezone,
        }).catch(() => {});
        notifyWechatLocationUpdated({
          userId: updated.expert.userId,
          otherPartyName: updated.founder.nickName ?? updated.founder.name ?? "Client",
          startTime: updated.startTime,
          location,
          timezone: updated.timezone,
        }).catch(() => {});
      } else {
        notifyLocationUpdate({
          telegramId: updated.founder.telegramId,
          telegramUsername: updated.founder.telegramUsername,
          otherPartyName: updated.expert.user.nickName ?? updated.expert.user.name ?? "Expert",
          updatedByName: updaterName,
          sessionType: updated.sessionType,
          startTime: updated.startTime,
          isOnline,
          location,
          timezone: updated.timezone,
        }).catch(() => {});
        notifyWechatLocationUpdated({
          userId: updated.founderId,
          otherPartyName: updated.expert.user.nickName ?? updated.expert.user.name ?? "Expert",
          startTime: updated.startTime,
          location,
          timezone: updated.timezone,
        }).catch(() => {});
      }

      return NextResponse.json(updated);
    }

    // === STATUS UPDATE (legacy) ===
    const validStatuses = ["PENDING", "CONFIRMED", "COMPLETED", "CANCELLED"];
    if (typeof body.status === "string" && validStatuses.includes(body.status)) {
      const updated = await prisma.booking.update({
        where: { id },
        data: { status: body.status },
        include: { expert: { include: { user: true } }, founder: true },
      });

      if (body.status === "COMPLETED") {
        try {
          const { emitBookingCompletedPomp } = await import("@/lib/inngest/emit");
          const queued = await emitBookingCompletedPomp(updated.id);
          if (!queued) {
            const { issuePOMPCredentials } = await import("@/lib/pomp-credential");
            issuePOMPCredentials(updated.id).catch(console.error);
          }
        } catch (err) {
          console.error("[POMP] Credential issuance failed to load:", err);
        }
      }

      return NextResponse.json(updated);
    }

    return NextResponse.json({ error: "No valid action or status provided" }, { status: 400 });
  } catch (error) {
    console.error("[bookings/[id] PATCH]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const booking = await prisma.booking.findUnique({
      where: { id },
      include: { expert: { include: { user: true } } },
    });

    if (!booking) {
      return NextResponse.json({ error: "Booking not found" }, { status: 404 });
    }

    // DELETE is intentionally narrower than PATCH: only the founder via session
    // OR a magic-link token can hard-delete a cancelled booking. We pass a
    // fabricated `founder` that satisfies the helper's shape requirement.
    const auth = await authorizeBookingAccess(
      request,
      id,
      { founderId: booking.founderId, expert: { userId: booking.expert.userId } },
    );
    if (!auth.ok) {
      return NextResponse.json(
        { error: auth.status === 401 ? "Unauthorized" : "Forbidden" },
        { status: auth.status }
      );
    }

    if (booking.status !== "CANCELLED") {
      return NextResponse.json(
        { error: "Only cancelled bookings can be deleted" },
        { status: 400 }
      );
    }

    await prisma.booking.delete({ where: { id } });
    return NextResponse.json({ deleted: true });
  } catch (error) {
    console.error("[bookings/[id] DELETE]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
