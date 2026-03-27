import { inngest } from "../client";

export const pompIssueOnBookingCompleted = inngest.createFunction(
  {
    id: "pomp-issue-on-booking-completed",
    name: "Issue POMP credentials (booking completed)",
    triggers: [{ event: "app/booking.completed" }],
  },
  async ({ event, step }) => {
    const bookingId = (event.data as { bookingId?: string }).bookingId;
    if (!bookingId) {
      throw new Error("app/booking.completed missing bookingId");
    }
    return step.run("issue-pomp-credentials", async () => {
      const { issuePOMPCredentials } = await import("@/lib/pomp-credential");
      return issuePOMPCredentials(bookingId);
    });
  },
);
