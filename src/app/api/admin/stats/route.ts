import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, isErrorResponse } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAdmin(request);
    if (isErrorResponse(auth)) return auth;

    const [
      totalUsers,
      totalExperts,
      publishedExperts,
      totalBookings,
      confirmedBookings,
      totalRevenueCents,
      totalInviteCodes,
      usedInviteCodes,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.expert.count(),
      prisma.expert.count({ where: { isPublished: true } }),
      prisma.booking.count(),
      prisma.booking.count({ where: { status: "CONFIRMED" } }),
      prisma.booking
        .aggregate({ _sum: { totalAmountCents: true }, where: { paymentStatus: "fully_paid" } })
        .then((r) => r._sum.totalAmountCents || 0),
      prisma.invitationCode.count(),
      prisma.invitationCode.count({ where: { usedCount: { gt: 0 } } }),
    ]);

    return NextResponse.json({
      totalUsers,
      totalExperts,
      publishedExperts,
      totalBookings,
      confirmedBookings,
      totalRevenueCents,
      totalInviteCodes,
      usedInviteCodes,
    });
  } catch (error) {
    console.error("[admin/stats GET]", error);
    return NextResponse.json({ error: "Failed to fetch stats" }, { status: 500 });
  }
}
