import { type NextRequest, NextResponse } from "next/server";

import type { SessionType } from "@/generated/prisma/client";
import { findParticipantBookingConflict } from "@/lib/booking-utils";
import { generateMeetingLink } from "@/lib/meeting";
import { prisma } from "@/lib/prisma";
import { resolveUserId } from "@/lib/request-auth";
import { calculateBookingAmount } from "@/lib/stripe";
import {
  createUnifiedOrder,
  createPartnerUnifiedOrder,
  buildPaymentParams,
  isWechatPayConfigured,
  isWechatPayPartnerMode,
  convertSGDToCNY,
} from "@/lib/wechat-pay";

export async function POST(request: NextRequest) {
  try {
    const userId = await resolveUserId(request);
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!isWechatPayConfigured()) {
      return NextResponse.json(
        { error: "WeChat Pay not configured" },
        { status: 500 }
      );
    }

    const {
      expertId,
      sessionType,
      startTime: startISO,
      endTime: endISO,
      slotId,
      timezone,
      meetingLink,
    } = await request.json();

    if (!expertId || !sessionType || !startISO || !endISO) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    const start = new Date(startISO);
    const end = new Date(endISO);
    if (isNaN(start.getTime()) || isNaN(end.getTime()) || end <= start) {
      return NextResponse.json(
        { error: "Invalid time range" },
        { status: 400 }
      );
    }

    const expert = await prisma.expert.findUnique({
      where: { id: expertId },
      include: { user: true },
    });

    if (!expert || !expert.isPublished) {
      return NextResponse.json(
        { error: "Expert not found" },
        { status: 404 }
      );
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

    if (!pricePerHour) {
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

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { wechatOpenId: true },
    });

    if (!user?.wechatOpenId) {
      return NextResponse.json(
        { error: "WeChat identity not found" },
        { status: 400 }
      );
    }

    const partner = isWechatPayPartnerMode();
    const subMchId = expert.wechatSubMchId?.trim();
    if (partner && !subMchId) {
      return NextResponse.json(
        {
          error:
            "WeChat partner mode requires expert wechatSubMchId (特约商户号)",
        },
        { status: 400 }
      );
    }

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
        status: "PENDING",
        totalAmountCents: totalCents,
        depositAmountCents: dueNowCents,
        currency: expert.currency,
        paymentMethod: "wechat_pay",
        paymentStatus: "pending",
      },
    });

    if (slotId) {
      await prisma.availableSlot
        .update({ where: { id: slotId }, data: { isBooked: true } })
        .catch(() => {});
    }

    const paymentCNY = convertSGDToCNY(dueNowCents);
    const expertName =
      expert.user.nickName ?? expert.user.name ?? "Expert";

    const { prepayId } = partner && subMchId
      ? await createPartnerUnifiedOrder({
          outTradeNo: booking.id,
          description: `Session with ${expertName}`,
          totalAmountCNY: paymentCNY,
          openid: user.wechatOpenId,
          subMchId,
        })
      : await createUnifiedOrder({
          outTradeNo: booking.id,
          description: `Session with ${expertName}`,
          totalAmountCNY: paymentCNY,
          openid: user.wechatOpenId,
        });

    const paymentParams = buildPaymentParams(prepayId);

    return NextResponse.json({
      bookingId: booking.id,
      paymentParams,
      paymentSGD: (dueNowCents / 100).toFixed(2),
      paymentCNY: (paymentCNY / 100).toFixed(2),
      depositSGD: (dueNowCents / 100).toFixed(2),
      depositCNY: (paymentCNY / 100).toFixed(2),
      totalSGD: (totalCents / 100).toFixed(2),
    });
  } catch (err) {
    console.error("[wechat-pay] error:", err);
    return NextResponse.json(
      { error: "Payment creation failed" },
      { status: 500 }
    );
  }
}
