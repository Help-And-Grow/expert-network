import { Resend } from "resend";

let _resend: Resend | null = null;
function getResend(): Resend | null {
  if (!process.env.RESEND_API_KEY) return null;
  if (!_resend) _resend = new Resend(process.env.RESEND_API_KEY);
  return _resend;
}

const FROM_EMAIL = process.env.EMAIL_FROM || "Help & Grow <onboarding@resend.dev>";

interface BookingEmailParams {
  expertName: string;
  founderName: string;
  expertEmail: string | null;
  founderEmail: string | null;
  sessionType: "ONLINE" | "OFFLINE";
  startTime: Date;
  endTime: Date;
  timezone: string;
  meetingLink: string | null;
  offlineAddress: string | null;
  bookingId: string;
}

function formatTime(date: Date, tz: string): string {
  return date.toLocaleString("en-SG", {
    timeZone: tz,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function confirmationHtml(p: BookingEmailParams, recipientRole: "expert" | "founder"): string {
  const isExpert = recipientRole === "expert";
  const otherName = isExpert ? p.founderName : p.expertName;
  const greeting = isExpert ? p.expertName : p.founderName;

  const locationBlock =
    p.sessionType === "ONLINE" && p.meetingLink
      ? `<p><strong>Meeting Link:</strong> <a href="${p.meetingLink}" style="color:#4F46E5">${p.meetingLink}</a></p>`
      : p.sessionType === "OFFLINE" && p.offlineAddress
        ? `<p><strong>Location:</strong> ${p.offlineAddress}</p>`
        : "";

  return `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;margin:0 auto;padding:32px 24px">
      <div style="text-align:center;margin-bottom:24px">
        <h1 style="font-size:24px;color:#1E1B4B;margin:0">Help & Grow</h1>
      </div>
      <h2 style="font-size:20px;color:#1E1B4B;margin-bottom:16px">Booking Confirmed!</h2>
      <p>Hi ${greeting},</p>
      <p>Your ${p.sessionType.toLowerCase()} session with <strong>${otherName}</strong> has been confirmed.</p>
      <div style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:12px;padding:20px;margin:20px 0">
        <p style="margin:4px 0"><strong>Date:</strong> ${formatTime(p.startTime, p.timezone)}</p>
        <p style="margin:4px 0"><strong>Duration:</strong> ${Math.round((p.endTime.getTime() - p.startTime.getTime()) / 60000)} minutes</p>
        <p style="margin:4px 0"><strong>Type:</strong> ${p.sessionType === "ONLINE" ? "Online (Video Call)" : "In-Person"}</p>
        ${locationBlock}
      </div>
      ${p.sessionType === "ONLINE" && p.meetingLink ? `
      <div style="text-align:center;margin:24px 0">
        <a href="${p.meetingLink}" style="display:inline-block;background:#4F46E5;color:#fff;font-weight:600;padding:12px 32px;border-radius:8px;text-decoration:none;font-size:16px">
          Join Meeting
        </a>
      </div>` : ""}
      <p style="color:#64748B;font-size:13px">You'll receive a reminder 1 hour before the session.</p>
      <hr style="border:none;border-top:1px solid #E2E8F0;margin:24px 0" />
      <p style="color:#94A3B8;font-size:12px;text-align:center">Help & Grow — AI Native Expert Network</p>
    </div>`;
}

function reminderHtml(p: BookingEmailParams, recipientRole: "expert" | "founder"): string {
  const isExpert = recipientRole === "expert";
  const otherName = isExpert ? p.founderName : p.expertName;
  const greeting = isExpert ? p.expertName : p.founderName;

  const locationBlock =
    p.sessionType === "ONLINE" && p.meetingLink
      ? `<p><strong>Meeting Link:</strong> <a href="${p.meetingLink}" style="color:#4F46E5">${p.meetingLink}</a></p>`
      : p.sessionType === "OFFLINE" && p.offlineAddress
        ? `<p><strong>Location:</strong> ${p.offlineAddress}</p>`
        : "";

  return `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;margin:0 auto;padding:32px 24px">
      <div style="text-align:center;margin-bottom:24px">
        <h1 style="font-size:24px;color:#1E1B4B;margin:0">Help & Grow</h1>
      </div>
      <h2 style="font-size:20px;color:#D97706;margin-bottom:16px">Session Starting in 1 Hour</h2>
      <p>Hi ${greeting},</p>
      <p>Just a reminder — your session with <strong>${otherName}</strong> starts in about 1 hour.</p>
      <div style="background:#FFFBEB;border:1px solid #FDE68A;border-radius:12px;padding:20px;margin:20px 0">
        <p style="margin:4px 0"><strong>Time:</strong> ${formatTime(p.startTime, p.timezone)}</p>
        <p style="margin:4px 0"><strong>Type:</strong> ${p.sessionType === "ONLINE" ? "Online (Video Call)" : "In-Person"}</p>
        ${locationBlock}
      </div>
      ${p.sessionType === "ONLINE" && p.meetingLink ? `
      <div style="text-align:center;margin:24px 0">
        <a href="${p.meetingLink}" style="display:inline-block;background:#4F46E5;color:#fff;font-weight:600;padding:14px 36px;border-radius:8px;text-decoration:none;font-size:16px">
          Join Meeting Now
        </a>
      </div>` : ""}
      <hr style="border:none;border-top:1px solid #E2E8F0;margin:24px 0" />
      <p style="color:#94A3B8;font-size:12px;text-align:center">Help & Grow — AI Native Expert Network</p>
    </div>`;
}

/**
 * Send booking confirmation emails to both expert and founder,
 * and schedule reminder emails for 1 hour before the session.
 */
export async function sendBookingEmails(params: BookingEmailParams): Promise<void> {
  const resend = getResend();
  if (!resend) {
    console.warn("[email] RESEND_API_KEY not set, skipping emails");
    return;
  }

  const recipients: { email: string; role: "expert" | "founder" }[] = [];
  if (params.expertEmail) recipients.push({ email: params.expertEmail, role: "expert" });
  if (params.founderEmail) recipients.push({ email: params.founderEmail, role: "founder" });

  if (recipients.length === 0) {
    console.warn("[email] No email addresses available, skipping");
    return;
  }

  const confirmationPromises = recipients.map((r) =>
    resend.emails
      .send({
        from: FROM_EMAIL,
        to: r.email,
        subject: `Booking Confirmed — ${params.sessionType === "ONLINE" ? "Online" : "In-Person"} Session`,
        html: confirmationHtml(params, r.role),
      })
      .catch((err) => console.error(`[email] Failed to send confirmation to ${r.email}:`, err))
  );

  const reminderTime = new Date(params.startTime.getTime() - 60 * 60 * 1000);
  const shouldScheduleReminder = reminderTime > new Date();

  const reminderPromises = shouldScheduleReminder
    ? recipients.map((r) =>
        resend.emails
          .send({
            from: FROM_EMAIL,
            to: r.email,
            subject: `Reminder: Session with ${r.role === "expert" ? params.founderName : params.expertName} in 1 hour`,
            html: reminderHtml(params, r.role),
            scheduledAt: reminderTime.toISOString(),
          })
          .catch((err) => console.error(`[email] Failed to schedule reminder for ${r.email}:`, err))
      )
    : [];

  await Promise.all([...confirmationPromises, ...reminderPromises]);

  console.log(
    `[email] Sent ${confirmationPromises.length} confirmations` +
      (shouldScheduleReminder ? `, scheduled ${reminderPromises.length} reminders for ${reminderTime.toISOString()}` : "")
  );
}
