import { type NextRequest, NextResponse } from "next/server";

import { isDebugAccessDenied, requireDebugAccess } from "@/lib/debug-api";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const access = await requireDebugAccess(request, { mutation: true });
    if (isDebugAccessDenied(access)) return access;

    const { userId } = await request.json();
    if (!userId) {
      return NextResponse.json({ error: "Missing userId" }, { status: 400 });
    }

    const log: string[] = [];

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { expert: true },
    });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    log.push(`Found user: ${user.name} (${user.nickName})`);

    if (user.expert) {
      const expertId = user.expert.id;

      const bookings = await prisma.booking.deleteMany({
        where: { OR: [{ founderId: userId }, { expertId }] },
      });
      log.push(`Deleted ${bookings.count} bookings`);

      const slots = await prisma.availableSlot.deleteMany({
        where: { expertId },
      });
      log.push(`Deleted ${slots.count} available slots`);

      await prisma.expert.delete({ where: { id: expertId } });
      log.push("Deleted expert profile");
    }

    await prisma.account.deleteMany({ where: { userId } });
    log.push("Deleted accounts");

    await prisma.session.deleteMany({ where: { userId } });
    log.push("Deleted sessions");

    await prisma.user.delete({ where: { id: userId } });
    log.push("Deleted user");

    return NextResponse.json({ status: "ok", log });
  } catch (e: unknown) {
    return NextResponse.json(
      { status: "error", error: (e as Error).message },
      { status: 500 }
    );
  }
}
