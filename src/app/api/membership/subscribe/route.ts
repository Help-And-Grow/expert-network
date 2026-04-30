import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { findPlanById, buildMembershipOutTradeNo } from "@/lib/membership-tiers";
import { prisma } from "@/lib/prisma";
import { resolveUserId } from "@/lib/request-auth";
import { isWeChatOriginatedRequest } from "@/lib/request-origin";
import {
  buildPaymentParams,
  createUnifiedOrder,
  isWechatPayConfigured,
} from "@/lib/wechat-pay";

export const dynamic = "force-dynamic";
export const maxDuration = 15;

const requestSchema = z.object({
  planId: z.string().min(1),
});

/**
 * Creates a WeChat Pay JSAPI order for a membership renewal. Each call is a
 * fresh one-shot purchase — there is no auto-renewal. The 我的会员 page
 * shows a "续费 1 个月" button that hits this route per renewal.
 *
 * Caller must:
 *   - be authenticated (resolveUserId)
 *   - have `wechatOpenId` set on their User row (collected at WeChat MP login)
 *   - request from inside the WeChat MP (TCB proxy origin) — the resulting
 *     payment params only work inside a WeChat WebView
 *
 * Response shape mirrors `/api/bookings/wechat-pay`:
 *   { outTradeNo, paymentParams }
 * where `paymentParams` is the JSAPI invoke object (timeStamp, nonceStr,
 * package, signType, paySign).
 */
export async function POST(request: NextRequest) {
  if (!isWechatPayConfigured()) {
    return NextResponse.json(
      { error: "WeChat Pay is not configured for this deployment." },
      { status: 503 },
    );
  }

  if (!isWeChatOriginatedRequest(request)) {
    return NextResponse.json(
      { error: "Membership purchases are only available inside the WeChat Mini Program." },
      { status: 403 },
    );
  }

  const userId = await resolveUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Please sign in to continue." }, { status: 401 });
  }

  let parsed: z.infer<typeof requestSchema>;
  try {
    parsed = requestSchema.parse(await request.json());
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid request body";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const plan = findPlanById(parsed.planId);
  if (!plan) {
    return NextResponse.json({ error: "Unknown membership plan." }, { status: 400 });
  }

  if (plan.currency !== "CNY") {
    return NextResponse.json(
      { error: "Only CNY plans are supported on this WeChat Pay deployment." },
      { status: 400 },
    );
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { wechatOpenId: true },
  });
  if (!user?.wechatOpenId) {
    return NextResponse.json(
      { error: "WeChat identity not found. Please sign in via the Mini Program." },
      { status: 400 },
    );
  }

  const outTradeNo = buildMembershipOutTradeNo(plan.id, userId);

  try {
    const { prepayId } = await createUnifiedOrder({
      outTradeNo,
      description: `Help & Grow ${plan.label}`,
      totalAmountCNY: plan.priceMinor,
      openid: user.wechatOpenId,
    });

    const paymentParams = buildPaymentParams(prepayId);

    return NextResponse.json({
      outTradeNo,
      planId: plan.id,
      tier: plan.tier,
      durationDays: plan.durationDays,
      amountMinor: plan.priceMinor,
      currency: plan.currency,
      paymentParams,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create membership order";
    console.error("[membership/subscribe POST]", message, error);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
