import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, isErrorResponse } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAdmin(request);
    if (isErrorResponse(auth)) return auth;

    const status = request.nextUrl.searchParams.get("status") || "";
    const where = status ? { status: status as never } : {};

    const bookings = await prisma.booking.findMany({
      where,
      select: {
        id: true,
        sessionType: true,
        startTime: true,
        endTime: true,
        status: true,
        paymentStatus: true,
        paymentMethod: true,
        paynowReference: true,
        paynowPayerReference: true,
        paynowSubmittedAt: true,
        paynowConfirmedAt: true,
        totalAmountCents: true,
        depositAmountCents: true,
        currency: true,
        createdAt: true,
        expert: {
          select: {
            user: { select: { name: true, nickName: true, email: true } },
          },
        },
        founder: {
          select: { name: true, nickName: true, email: true },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    });

    return NextResponse.json(bookings);
  } catch (error) {
    console.error("[admin/bookings GET]", error);
    return NextResponse.json({ error: "Failed to fetch bookings" }, { status: 500 });
  }
}
