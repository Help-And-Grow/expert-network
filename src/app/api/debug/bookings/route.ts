import { type NextRequest, NextResponse } from "next/server";

import { isDebugAccessDenied, requireDebugAccess } from "@/lib/debug-api";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  const access = await requireDebugAccess(request);
  if (isDebugAccessDenied(access)) return access;

  const q = request.nextUrl.searchParams.get("q");

  if (q === "users") {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        name: true,
        nickName: true,
        email: true,
        telegramUsername: true,
        telegramId: true,
        expert: { select: { id: true, isPublished: true } },
      },
    });
    return NextResponse.json({ total: users.length, users });
  }

  const bookings = await prisma.booking.findMany({
    select: {
      id: true,
      status: true,
      paymentStatus: true,
      sessionType: true,
      startTime: true,
      totalAmountCents: true,
      depositAmountCents: true,
      currency: true,
      stripeCheckoutSessionId: true,
      createdAt: true,
      founder: {
        select: { name: true, telegramUsername: true, telegramId: true },
      },
      expert: {
        select: {
          user: { select: { name: true, telegramUsername: true, telegramId: true } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ total: bookings.length, bookings });
}
