import { type NextRequest, NextResponse } from "next/server";

import { triggerBookingEmails } from "@/lib/booking-emails";
import { creditTokens } from "@/lib/hg-token";
import { storeBookingEvent } from "@/lib/integrations/mem9-lifecycle";
import { extendMembership } from "@/lib/membership";
import {
  isMembershipOutTradeNo,
  parseMembershipOutTradeNo,
} from "@/lib/membership-tiers";
import { prisma } from "@/lib/prisma";
import {
  notifyExpertBooking,
  notifyFounderBooking,
} from "@/lib/telegram-bot";
import {
  convertSGDToCNY,
  computeWechatPlatformShareFen,
  decryptResource,
  isWechatPayPartnerMode,
  requestProfitSharing,
  wechatPlatformFeePercent,
} from "@/lib/wechat-pay";

interface WechatPayNotification {
  id: string;
  create_time: string;
  resource_type: string;
  event_type: string;
  resource: {
    original_type: string;
    algorithm: string;
    ciphertext: string;
    associated_data: string;
    nonce: string;
  };
}

interface DecryptedPayment {
  out_trade_no: string;
  transaction_id: string;
  trade_state: string;
  trade_state_desc: string;
  payer: { openid: string };
  amount: { total: number; payer_total: number; currency: string };
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.text();
    const notification: WechatPayNotification = JSON.parse(body);

    if (notification.event_type !== "TRANSACTION.SUCCESS") {
      return NextResponse.json({ code: "SUCCESS", message: "OK" });
    }

    const { ciphertext, nonce, associated_data } = notification.resource;

    let decrypted: DecryptedPayment;
    try {
      const plaintext = decryptResource(ciphertext, nonce, associated_data);
      decrypted = JSON.parse(plaintext);
    } catch (err) {
      console.error("[wechat-pay-webhook] decrypt error:", err);
      return NextResponse.json(
        { code: "FAIL", message: "Decrypt failed" },
        { status: 400 }
      );
    }

    if (decrypted.trade_state !== "SUCCESS") {
      console.log(
        "[wechat-pay-webhook] trade_state not SUCCESS:",
        decrypted.trade_state
      );
      return NextResponse.json({ code: "SUCCESS", message: "OK" });
    }

    const outTradeNo = decrypted.out_trade_no;

    // Membership orders carry an `m_` prefix and resolve via the plan
    // catalog, not the booking table. Keep this branch first so a stray
    // booking row with a colliding id never short-circuits a membership
    // renewal.
    if (isMembershipOutTradeNo(outTradeNo)) {
      const parsed = parseMembershipOutTradeNo(outTradeNo);
      if (!parsed) {
        console.error("[wechat-pay-webhook] unknown membership plan:", outTradeNo);
        return NextResponse.json({ code: "SUCCESS", message: "OK" });
      }

      const payerOpenId = decrypted.payer?.openid;
      if (!payerOpenId) {
        console.error("[wechat-pay-webhook] membership order missing openid:", outTradeNo);
        return NextResponse.json({ code: "SUCCESS", message: "OK" });
      }

      const payer = await prisma.user.findUnique({
        where: { wechatOpenId: payerOpenId },
        select: { id: true },
      });
      if (!payer) {
        console.error(
          "[wechat-pay-webhook] no user matched openid for membership order:",
          outTradeNo,
        );
        return NextResponse.json({ code: "SUCCESS", message: "OK" });
      }

      try {
        const result = await extendMembership({
          userId: payer.id,
          tier: parsed.plan.tier,
          durationDays: parsed.plan.durationDays,
          amountMinor: decrypted.amount?.total ?? parsed.plan.priceMinor,
          currency: parsed.plan.currency,
          source: "wechat-pay-cn",
          externalRef: decrypted.transaction_id,
          description: `${parsed.plan.label} (${outTradeNo})`,
        });
        console.log(
          "[wechat-pay-webhook] membership extended:",
          outTradeNo,
          "until",
          result.membershipUntil.toISOString(),
          result.alreadyApplied ? "(idempotent replay)" : "",
        );
      } catch (err) {
        console.error("[wechat-pay-webhook] extendMembership error:", err);
        // Non-zero return code asks WeChat to retry — appropriate for a
        // transient DB error during a successful payment.
        return NextResponse.json(
          { code: "FAIL", message: "membership update failed" },
          { status: 500 },
        );
      }

      return NextResponse.json({ code: "SUCCESS", message: "OK" });
    }

    const bookingId = outTradeNo;

    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      include: {
        expert: { include: { user: true } },
        founder: true,
      },
    });

    if (!booking) {
      console.error("[wechat-pay-webhook] booking not found:", bookingId);
      return NextResponse.json({ code: "SUCCESS", message: "OK" });
    }

    if (booking.status !== "PENDING") {
      console.log(
        "[wechat-pay-webhook] booking already processed:",
        bookingId,
        booking.status
      );
      return NextResponse.json({ code: "SUCCESS", message: "OK" });
    }

    const updated = await prisma.booking.update({
      where: { id: bookingId },
      data: {
        status: "CONFIRMED",
        paymentStatus: "fully_paid",
        wechatTransactionId: decrypted.transaction_id,
      },
      include: {
        expert: { include: { user: true } },
        founder: true,
      },
    });

    triggerBookingEmails(updated);

    const subMchId = updated.expert.wechatSubMchId?.trim();
    const paymentCnyFen = convertSGDToCNY(updated.depositAmountCents ?? 0);
    const platformFen = computeWechatPlatformShareFen(
      paymentCnyFen,
      wechatPlatformFeePercent()
    );
    if (
      isWechatPayPartnerMode() &&
      subMchId &&
      platformFen > 0
    ) {
      const outOrderNo = `ps-${updated.id}`.slice(0, 64);
      void requestProfitSharing({
        subMchId,
        transactionId: decrypted.transaction_id,
        outOrderNo,
        platformAmountFen: platformFen,
      }).then((r) =>
        prisma.booking
          .update({
            where: { id: updated.id },
            data: {
              wechatProfitShareStatus: r.ok
                ? "success"
                : r.skippedReason === "missing_platform_encrypt_env"
                  ? "skipped"
                  : "failed",
            },
          })
          .catch((e: unknown) =>
            console.error("[wechat-pay-webhook] profit share status error:", e)
          )
      );
    } else if (isWechatPayPartnerMode()) {
      void prisma.booking
        .update({
          where: { id: updated.id },
          data: { wechatProfitShareStatus: "skipped" },
        })
        .catch((e: unknown) =>
          console.error("[wechat-pay-webhook] profit share skip persist:", e)
        );
    }

    if (updated.totalAmountCents && updated.totalAmountCents > 0) {
      creditTokens(updated.founderId, updated.id, updated.totalAmountCents).catch(
        (e: unknown) => console.error("[wechat-pay-webhook] token credit error:", e)
      );
    }

    const paymentLabel = updated.depositAmountCents
      ? `${updated.currency} ${(updated.depositAmountCents / 100).toFixed(2)}`
      : "payment";

    storeBookingEvent({
      expertId: updated.expertId,
      founderName: updated.founder.nickName ?? updated.founder.name ?? "Client",
      sessionType: updated.sessionType,
      startTime: updated.startTime,
      status: updated.status,
    }).catch((e: unknown) =>
      console.error("[wechat-pay-webhook] mem9 error:", e)
    );

    notifyExpertBooking({
      expertTelegramId: updated.expert.user.telegramId,
      expertTelegramUsername: updated.expert.user.telegramUsername,
      founderName:
        updated.founder.nickName ?? updated.founder.name ?? "Client",
      sessionType: updated.sessionType,
      startTime: updated.startTime,
      depositAmount: paymentLabel,
      timezone: updated.timezone,
    }).catch((e: unknown) =>
      console.error("[wechat-pay-webhook] expert notify error:", e)
    );

    notifyFounderBooking({
      founderTelegramId: updated.founder.telegramId,
      founderTelegramUsername: updated.founder.telegramUsername,
      expertName:
        updated.expert.user.nickName ??
        updated.expert.user.name ??
        "Expert",
      sessionType: updated.sessionType,
      startTime: updated.startTime,
      depositAmount: paymentLabel,
      timezone: updated.timezone,
    }).catch((e: unknown) =>
      console.error("[wechat-pay-webhook] founder notify error:", e)
    );

    // WeChat Subscribe Message notifications
    const { notifyWechatBookingConfirmed } = await import("@/lib/wechat-notify");
    notifyWechatBookingConfirmed({
      userId: updated.expert.userId,
      expertName: updated.founder.nickName ?? updated.founder.name ?? "Client",
      sessionType: updated.sessionType,
      startTime: updated.startTime,
      depositAmount: paymentLabel,
      timezone: updated.timezone,
    }).catch(() => {});
    notifyWechatBookingConfirmed({
      userId: updated.founderId,
      expertName: updated.expert.user.nickName ?? updated.expert.user.name ?? "Expert",
      sessionType: updated.sessionType,
      startTime: updated.startTime,
      depositAmount: paymentLabel,
      timezone: updated.timezone,
    }).catch(() => {});

    return NextResponse.json({ code: "SUCCESS", message: "OK" });
  } catch (err) {
    console.error("[wechat-pay-webhook] error:", err);
    return NextResponse.json(
      { code: "FAIL", message: "Internal error" },
      { status: 500 }
    );
  }
}
