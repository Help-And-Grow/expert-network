import { type NextRequest, NextResponse } from "next/server";

import { hasActiveMembership } from "@/lib/membership";
import { MEMBERSHIP_PLANS_CN } from "@/lib/membership-tiers";
import { prisma } from "@/lib/prisma";
import { resolveUserId } from "@/lib/request-auth";

export const dynamic = "force-dynamic";

/**
 * Returns the caller's current membership status plus the available plans.
 * Powers the WeChat MP `我的会员` page.
 *
 * Response:
 *   {
 *     active: boolean,
 *     tier: "NONE" | "BASIC" | "PRO",   // "NONE" when there's no Membership row
 *     currentUntil: ISO | null,
 *     plans: MembershipPlan[]
 *   }
 */
export async function GET(request: NextRequest) {
  const userId = await resolveUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const membership = await prisma.membership.findUnique({
    where: { userId },
    select: { tier: true, currentUntil: true },
  });

  return NextResponse.json({
    active: hasActiveMembership(membership),
    tier: membership?.tier ?? "NONE",
    currentUntil: membership?.currentUntil.toISOString() ?? null,
    plans: MEMBERSHIP_PLANS_CN,
  });
}
