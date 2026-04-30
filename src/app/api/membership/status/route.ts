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
 *     active: boolean,           // hasActiveMembership(user)
 *     tier: "NONE" | "BASIC" | "PRO",
 *     membershipUntil: ISO | null,
 *     plans: MembershipPlan[]    // catalog for renewal buttons
 *   }
 */
export async function GET(request: NextRequest) {
  const userId = await resolveUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      membershipTier: true,
      membershipUntil: true,
    },
  });

  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  return NextResponse.json({
    active: hasActiveMembership(user),
    tier: user.membershipTier,
    membershipUntil: user.membershipUntil?.toISOString() ?? null,
    plans: MEMBERSHIP_PLANS_CN,
  });
}
