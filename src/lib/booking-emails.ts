import { buildManageUrl } from "@/lib/booking-token";
import { sendBookingEmails } from "@/lib/email";

interface BookingWithRelations {
  id: string;
  sessionType: string;
  startTime: Date;
  endTime: Date;
  timezone: string;
  meetingLink: string | null;
  offlineAddress: string | null;
  expert: {
    user: {
      name: string | null;
      nickName: string | null;
      email: string | null;
    };
  };
  founder: {
    name: string | null;
    nickName: string | null;
    email: string | null;
  };
}

/**
 * Fire-and-forget: send confirmation + schedule reminder emails for a booking.
 * Call this after a booking is created/confirmed with expert.user and founder
 * included. The founder's confirmation email gets a magic-link "Manage" CTA so
 * guests (and signed-in users) can cancel/reschedule without re-authenticating.
 *
 * `originForLinks` defaults to the canonical production URL — pass an explicit
 * value (e.g. from `getAppOrigin(request)`) when calling from a route handler
 * if you want the email to use the request's origin instead.
 */
export function triggerBookingEmails(
  booking: BookingWithRelations,
  originForLinks?: string,
): void {
  let founderManageUrl: string | undefined;
  try {
    founderManageUrl = buildManageUrl(booking.id, originForLinks);
  } catch (err) {
    // AUTH_SECRET missing in dev / preview without env: just skip the CTA.
    // The rest of the email still goes out with meeting link / address.
    console.warn(
      "[booking-emails] could not build founderManageUrl — falling back to email without manage CTA:",
      err instanceof Error ? err.message : err,
    );
  }

  sendBookingEmails({
    bookingId: booking.id,
    expertName: booking.expert.user.nickName || booking.expert.user.name || "Expert",
    founderName: booking.founder.nickName || booking.founder.name || "Client",
    expertEmail: booking.expert.user.email,
    founderEmail: booking.founder.email,
    sessionType: booking.sessionType as "ONLINE" | "OFFLINE",
    startTime: booking.startTime instanceof Date ? booking.startTime : new Date(booking.startTime),
    endTime: booking.endTime instanceof Date ? booking.endTime : new Date(booking.endTime),
    timezone: booking.timezone,
    meetingLink: booking.meetingLink,
    offlineAddress: booking.offlineAddress,
    founderManageUrl,
  }).catch((err) => console.error("[booking-emails]", err));
}
