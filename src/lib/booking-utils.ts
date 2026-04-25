import { prisma } from "@/lib/prisma";

const BOOKING_OVERLAP_SELECT = {
  id: true,
  expertId: true,
  founderId: true,
  startTime: true,
  endTime: true,
  status: true,
  expert: {
    select: {
      userId: true,
    },
  },
} as const;

/**
 * Check if an expert already has a non-cancelled booking overlapping the given time range.
 * Returns the conflicting booking if found, null otherwise.
 */
export async function findOverlappingBooking(
  expertId: string,
  startTime: Date,
  endTime: Date,
  excludeBookingId?: string
) {
  const where: Record<string, unknown> = {
    expertId,
    status: { in: ["PENDING", "CONFIRMED"] },
    startTime: { lt: endTime },
    endTime: { gt: startTime },
  };

  if (excludeBookingId) {
    where.id = { not: excludeBookingId };
  }

  return prisma.booking.findFirst({
    where,
    // Avoid selecting drifted optional columns when we only need conflict metadata.
    select: BOOKING_OVERLAP_SELECT,
  });
}

/**
 * Check whether either meetup participant already has a non-cancelled booking
 * overlapping the given time range, regardless of whether they are coach or player.
 */
export async function findParticipantBookingConflict(params: {
  expertId: string;
  founderId: string;
  startTime: Date;
  endTime: Date;
  excludeBookingId?: string;
  expertUserId?: string | null;
}) {
  const expertUserId =
    params.expertUserId ??
    (await prisma.expert.findUnique({
      where: { id: params.expertId },
      select: { userId: true },
    }))?.userId ??
    null;

  const participantClauses: Record<string, unknown>[] = [
    { expertId: params.expertId },
    { founderId: params.founderId },
    { expert: { userId: params.founderId } },
  ];

  if (expertUserId) {
    participantClauses.push(
      { founderId: expertUserId },
      { expert: { userId: expertUserId } },
    );
  }

  const where: Record<string, unknown> = {
    status: { in: ["PENDING", "CONFIRMED"] },
    startTime: { lt: params.endTime },
    endTime: { gt: params.startTime },
    OR: participantClauses,
  };

  if (params.excludeBookingId) {
    where.id = { not: params.excludeBookingId };
  }

  return prisma.booking.findFirst({
    where,
    select: BOOKING_OVERLAP_SELECT,
  });
}
