import { prismaFull as prisma } from "@/lib/prisma";

import type { MembershipTier } from "@/generated/prisma/client";

export const MEMBERSHIP_GRACE_MS = 5 * 60 * 1000;

/**
 * Returns whether the given Membership row represents an active entitlement
 * right now. Used by `/api/trtc/token` to gate premium-live access on the
 * WeChat MP path (where H&G tokens are unavailable). A 5-minute grace window
 * past `currentUntil` keeps mid-meeting cutoffs from happening if a
 * subscription expires while a session is in progress.
 *
 * Pass `null` when the user has no Membership row — that's the canonical
 * "no membership" signal in this design.
 */
export function hasActiveMembership(
  membership: { currentUntil: Date } | null,
): boolean {
  if (!membership) return false;
  return membership.currentUntil.getTime() + MEMBERSHIP_GRACE_MS > Date.now();
}

/**
 * Extend a user's membership by `durationDays` and write a ledger row. The
 * extension is anchored on the later of (now, current Membership.currentUntil),
 * so stacking renewals never loses unused days. Idempotent against
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
}): Promise<{ currentUntil: Date; alreadyApplied: boolean }> {
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
        select: { currentUntil: true },
      });
      if (existing?.currentUntil) {
        return { currentUntil: existing.currentUntil, alreadyApplied: true };
      }
    }

    const current = await tx.membership.findUnique({
      where: { userId },
      select: { currentUntil: true },
    });

    const now = Date.now();
    const anchorMs = Math.max(now, current?.currentUntil.getTime() ?? 0);
    const newUntil = new Date(anchorMs + durationDays * 24 * 60 * 60 * 1000);

    await tx.membership.upsert({
      where: { userId },
      update: {
        tier,
        currentUntil: newUntil,
      },
      create: {
        userId,
        tier,
        currentUntil: newUntil,
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
        currentUntil: newUntil,
      },
    });

    return { currentUntil: newUntil, alreadyApplied: false };
  });
}
