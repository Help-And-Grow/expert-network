import { type NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

import { findOverlappingBooking } from "@/lib/booking-utils";
import { prisma } from "@/lib/prisma";
import { resolveUserId } from "@/lib/request-auth";
import { notifyCancellation, notifyReschedule, notifyLocationUpdate } from "@/lib/telegram-bot";
import { notifyWechatBookingCancelled, notifyWechatBookingRescheduled, notifyWechatLocationUpdated } from "@/lib/wechat-notify";

export async function GET(
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

    const isFounder = booking.founderId === userId;
    const isExpert = booking.expert.userId === userId;
    if (!isFounder && !isExpert) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
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
    const userId = await resolveUserId(request);
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

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

    const isFounder = booking.founderId === userId;
    const isExpert = booking.expert.userId === userId;
    if (!isFounder && !isExpert) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

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

      const updated = await prisma.booking.update({
        where: { id },
        data: {
          status: "CANCELLED",
          cancelledBy: userId,
          cancelReason: typeof body.reason === "string" ? body.reason.slice(0, 500) : null,
        },
        include: { expert: { include: { user: true } }, founder: true },
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

      const overlap = await findOverlappingBooking(booking.expertId, newStart, newEnd, id);
      if (overlap) {
        return NextResponse.json(
          { error: "New time slot conflicts with another booking" },
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
    const userId = await resolveUserId(request);
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const booking = await prisma.booking.findUnique({
      where: { id },
      include: { expert: true },
    });

    if (!booking) {
      return NextResponse.json({ error: "Booking not found" }, { status: 404 });
    }

    const isFounder = booking.founderId === userId;
    const isExpert = booking.expert.userId === userId;
    if (!isFounder && !isExpert) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
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
