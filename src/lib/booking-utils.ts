import { prisma } from "@/lib/prisma";

const BOOKING_OVERLAP_SELECT = {
  id: true,
  expertId: true,
  startTime: true,
  endTime: true,
  status: true,
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
