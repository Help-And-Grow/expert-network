import { type NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { resolveUserId } from "@/lib/request-auth";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: expertId } = await params;
    if (!expertId) {
      return NextResponse.json({ error: "Expert ID is required" }, { status: 400 });
    }

    const now = new Date();

    // Auto-cancel payment holds older than 30 minutes.
    const expiryThreshold = new Date(now.getTime() - 30 * 60 * 1000);
    await prisma.booking.updateMany({
      where: {
        expertId,
        status: "PENDING",
        OR: [
          { paymentMethod: "ton", paymentStatus: "pending" },
          { paymentMethod: "paynow", paymentStatus: "pending_paynow" },
        ],
        createdAt: { lt: expiryThreshold },
      },
      data: { status: "CANCELLED", cancelReason: "Payment not confirmed within 30 minutes" },
    });

    const slots = await prisma.availableSlot.findMany({
      where: { expertId, isBooked: false, endTime: { gt: now } },
      orderBy: { startTime: "asc" },
    });

    const bookedSlots = await prisma.booking.findMany({
      where: {
        expertId,
        status: { in: ["PENDING", "CONFIRMED"] },
        endTime: { gt: now },
      },
      select: { startTime: true, endTime: true },
      orderBy: { startTime: "asc" },
    });

    return NextResponse.json({ slots, bookedSlots });
  } catch (error) {
    console.error("[experts/[id]/slots GET]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = await resolveUserId(request);
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: expertId } = await params;
    if (!expertId) {
      return NextResponse.json({ error: "Expert ID is required" }, { status: 400 });
    }

    const expert = await prisma.expert.findUnique({ where: { id: expertId } });
    if (!expert) {
      return NextResponse.json({ error: "Expert not found" }, { status: 404 });
    }
    if (expert.userId !== userId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    const slotsInput = Array.isArray(body.slots) ? body.slots : [];

    if (slotsInput.length === 0) {
      return NextResponse.json(
        { error: "slots array is required and must not be empty" },
        { status: 400 }
      );
    }

    const now = new Date();
    const validSlots: { startTime: Date; endTime: Date }[] = [];

    for (const slot of slotsInput) {
      if (
        typeof slot !== "object" || slot === null ||
        typeof slot.startTime !== "string" || typeof slot.endTime !== "string"
      ) continue;

      const start = new Date(slot.startTime);
      const end = new Date(slot.endTime);
      if (!isNaN(start.getTime()) && !isNaN(end.getTime()) && end > start && start >= now) {
        validSlots.push({ startTime: start, endTime: end });
      }
    }

    if (validSlots.length === 0) {
      return NextResponse.json(
        { error: "No valid future slots provided" },
        { status: 400 }
      );
    }

    await prisma.availableSlot.createMany({
      data: validSlots.map((s) => ({ expertId, ...s })),
    });

    const slots = await prisma.availableSlot.findMany({
      where: { expertId, startTime: { in: validSlots.map((s) => s.startTime) } },
      orderBy: { startTime: "asc" },
    });

    return NextResponse.json({ created: slots.length, slots });
  } catch (error) {
    console.error("[experts/[id]/slots POST]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = await resolveUserId(request);
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: expertId } = await params;
    const { searchParams } = new URL(request.url);
    const slotId = searchParams.get("slotId");

    if (!slotId) {
      return NextResponse.json({ error: "slotId query param is required" }, { status: 400 });
    }

    const expert = await prisma.expert.findUnique({ where: { id: expertId } });
    if (!expert || expert.userId !== userId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const slot = await prisma.availableSlot.findUnique({ where: { id: slotId } });
    if (!slot || slot.expertId !== expertId) {
      return NextResponse.json({ error: "Slot not found" }, { status: 404 });
    }
    if (slot.isBooked) {
      return NextResponse.json({ error: "Cannot delete a booked slot" }, { status: 400 });
    }

    await prisma.availableSlot.delete({ where: { id: slotId } });
    return NextResponse.json({ deleted: true });
  } catch (error) {
    console.error("[experts/[id]/slots DELETE]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
