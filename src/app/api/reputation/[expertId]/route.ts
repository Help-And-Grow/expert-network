import { type NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * GET /api/reputation/:expertId
 *
 * Aggregated reputation derived from POMPCredential rows that have been
 * `onChainVerified` (set by `issuePOMPCredentials` after `tx.wait()`
 * succeeds, or by the Alchemy webhook in the redundant/external path).
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ expertId: string }> },
) {
  try {
    const { expertId } = await params;
    if (!expertId) {
      return NextResponse.json({ error: "expertId required" }, { status: 400 });
    }

    const credentials = await prisma.pOMPCredential.findMany({
      where: { expertId, onChainVerified: true },
      select: {
        attestationUID: true,
        bookingId: true,
        booking: { select: { founderId: true, sessionType: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    const verifiedBookingIds = new Set(credentials.map((c) => c.bookingId));
    const uniqueMentees = new Set(credentials.map((c) => c.booking.founderId));
    // sessionType is an enum (CHAT/VIDEO/MEETUP…), so the topic-breakdown
    // chart will be sparse — that's fine; the reputation page hides the
    // panel when topics is empty.
    const topics = Array.from(
      new Set(credentials.map((c) => String(c.booking.sessionType))),
    ).filter(Boolean);

    return NextResponse.json({
      // Verified meetups: one Booking can have multiple POMPCredentials (one
      // per recipient role), but counts as a single meetup.
      totalSBTs: verifiedBookingIds.size,
      menteeCount: uniqueMentees.size,
      topics,
      // Every verified attestation UID — used to render the EASScan link
      // list. Length here is the per-attestation count, intentionally
      // distinct from totalSBTs (per-booking).
      attestationUidList: credentials.map((c) => c.attestationUID),
    });
  } catch (error) {
    console.error("[reputation]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
