import { prismaFull as prisma } from "@/lib/prisma";

import type { MembershipTier } from "@/generated/prisma/client";

export const MEMBERSHIP_GRACE_MS = 5 * 60 * 1000;

/**
 * Returns whether the user has an active premium-live membership right now.
 * Used by `/api/trtc/token` to gate premium-live access on the WeChat MP
 * path (where H&G tokens are unavailable). A 5-minute grace window past
 * `membershipUntil` keeps mid-meeting cutoffs from happening if a
 * subscription expires while a session is in progress.
 */
export function hasActiveMembership(user: {
  membershipTier: MembershipTier | null;
  membershipUntil: Date | null;
}): boolean {
  if (!user.membershipTier || user.membershipTier === "NONE") return false;
  if (!user.membershipUntil) return false;
  return user.membershipUntil.getTime() + MEMBERSHIP_GRACE_MS > Date.now();
}

/**
 * Extend a user's membership by `durationDays` and write a ledger row. The
 * extension is anchored on the later of (now, current membershipUntil), so
 * stacking renewals never loses unused days. Idempotent against
 * `externalRef` — re-running with the same WeChat Pay transaction id is a
 * no-op.
 */
export async function extendMembership(params: {
  userId: string;
  tier: Exclude<MembershipTier, "NONE">;
  durationDays: number;
  amountMinor: number;
  currency: string;
  source: string;
  externalRef?: string;
  description?: string;
}): Promise<{ membershipUntil: Date; alreadyApplied: boolean }> {
  const {
    userId,
    tier,
    durationDays,
    amountMinor,
    currency,
    source,
    externalRef,
    description,
  } = params;

  if (durationDays <= 0) {
    throw new Error("durationDays must be positive");
  }

  return prisma.$transaction(async (tx) => {
    if (externalRef) {
      const existing = await tx.membershipLedger.findUnique({
        where: { externalRef },
        select: { membershipUntil: true },
      });
      if (existing?.membershipUntil) {
        return { membershipUntil: existing.membershipUntil, alreadyApplied: true };
      }
    }

    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { membershipUntil: true },
    });
    if (!user) {
      throw new Error(`User ${userId} not found`);
    }

    const now = Date.now();
    const anchorMs = Math.max(now, user.membershipUntil?.getTime() ?? 0);
    const newUntil = new Date(anchorMs + durationDays * 24 * 60 * 60 * 1000);

    await tx.user.update({
      where: { id: userId },
      data: {
        membershipTier: tier,
        membershipUntil: newUntil,
      },
    });

    await tx.membershipLedger.create({
      data: {
        userId,
        tier,
        durationDays,
        amountMinor,
        currency,
        source,
        externalRef,
        description,
        membershipUntil: newUntil,
      },
    });

    return { membershipUntil: newUntil, alreadyApplied: false };
  });
}
