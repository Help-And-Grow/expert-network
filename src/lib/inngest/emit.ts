/**
 * Fire-and-forget events to Inngest Cloud when INNGEST_EVENT_KEY is set.
 * Falls back to the caller doing synchronous work when not configured.
 */
export async function emitBookingCompletedPomp(bookingId: string): Promise<boolean> {
  if (!process.env.INNGEST_EVENT_KEY?.trim()) {
    return false;
  }
  try {
    const { inngest } = await import("@/inngest/client");
    await inngest.send({
      name: "app/booking.completed",
      data: { bookingId },
    });
    return true;
  } catch (err) {
    console.warn(
      "[inngest] emit app/booking.completed failed:",
      err instanceof Error ? err.message : err,
    );
    return false;
  }
}
