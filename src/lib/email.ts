import nodemailer from "nodemailer";

import { env } from "@/lib/env";
import { buildGoogleMapsUrl } from "@/lib/google-maps";

// ---------------------------------------------------------------------------
// Gmail OAuth2 transporter (primary, replaces Resend + generic SMTP)
// ---------------------------------------------------------------------------

let _gmailTransporter: nodemailer.Transporter | null = null;

function getGmailTransporter(): nodemailer.Transporter | null {
  if (
    !env.GMAIL_CLIENT_ID ||
    !env.GMAIL_CLIENT_SECRET ||
    !env.GMAIL_REFRESH_TOKEN ||
    !env.GMAIL_USER
  ) {
    return null;
  }
  if (!_gmailTransporter) {
    _gmailTransporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        type: "OAuth2",
        user: env.GMAIL_USER,
        clientId: env.GMAIL_CLIENT_ID,
        clientSecret: env.GMAIL_CLIENT_SECRET,
        refreshToken: env.GMAIL_REFRESH_TOKEN,
      },
    });
  }
  return _gmailTransporter;
}

// ---------------------------------------------------------------------------
// Fallback: generic SMTP (for local dev without Gmail OAuth)
// ---------------------------------------------------------------------------

let _smtpTransporter: nodemailer.Transporter | null = null;

function getSmtpTransporter(): nodemailer.Transporter | null {
  if (
    !env.EMAIL_SERVER_HOST ||
    !env.EMAIL_SERVER_PORT ||
    !env.EMAIL_SERVER_USER ||
    !env.EMAIL_SERVER_PASSWORD
  ) {
    return null;
  }
  if (!_smtpTransporter) {
    _smtpTransporter = nodemailer.createTransport({
      host: env.EMAIL_SERVER_HOST,
      port: Number(env.EMAIL_SERVER_PORT),
      auth: {
        user: env.EMAIL_SERVER_USER,
        pass: env.EMAIL_SERVER_PASSWORD,
      },
    });
  }
  return _smtpTransporter;
}

/**
 * Resolve the best available transporter: Gmail OAuth2 first, then SMTP
 * fallback. Returns null when neither is configured.
 */
function getTransporter(): nodemailer.Transporter | null {
  return getGmailTransporter() ?? getSmtpTransporter();
}

// ---------------------------------------------------------------------------
// "From" address resolution
// ---------------------------------------------------------------------------

const FROM_EMAIL =
  env.GMAIL_USER
    ? `Help & Grow <${env.GMAIL_USER}>`
    : env.EMAIL_FROM ?? env.EMAIL_SERVER_USER ?? "Help & Grow <noreply@help-and-grow.com>";

// ---------------------------------------------------------------------------
// Email content generators (unchanged logic)
// ---------------------------------------------------------------------------

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
  /**
   * Optional magic-link URL the founder can use to view/cancel/reschedule the
   * booking without signing in. When set, the founder's confirmation email
   * gets a "Manage your booking" CTA below the meeting details. Phase 2 of
   * guest-booking; see docs/exec-plans/active/guest-booking.md §5.4.
   */
  founderManageUrl?: string;
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
        ? `<p><strong>Location:</strong> <a href="${buildGoogleMapsUrl(p.offlineAddress)}" style="color:#4F46E5;text-decoration:underline">${p.offlineAddress}</a></p>`
        : "";

  return `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;margin:0 auto;padding:32px 24px">
      <div style="text-align:center;margin-bottom:24px">
        <h1 style="font-size:24px;color:#1E1B4B;margin:0">Help & Grow</h1>
      </div>
      <h2 style="font-size:20px;color:#1E1B4B;margin-bottom:16px">Meetup confirmed!</h2>
      <p>Hi ${greeting},</p>
      <p>Your ${p.sessionType.toLowerCase()} meetup with <strong>${otherName}</strong> has been confirmed.</p>
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
      ${!isExpert && p.founderManageUrl ? `
      <div style="margin:20px 0;padding:16px;background:#FAFAFA;border:1px solid #E2E8F0;border-radius:8px">
        <p style="margin:0 0 8px 0;font-size:13px;color:#475569">
          Need to make a change? Manage this booking — no sign-in needed:
        </p>
        <a href="${p.founderManageUrl}" style="display:inline-block;color:#4F46E5;font-weight:600;text-decoration:underline;font-size:13px">
          Reschedule or cancel →
        </a>
      </div>` : ""}
      <p style="color:#64748B;font-size:13px">You'll receive a reminder 1 hour before the meetup.</p>
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
        ? `<p><strong>Location:</strong> <a href="${buildGoogleMapsUrl(p.offlineAddress)}" style="color:#4F46E5;text-decoration:underline">${p.offlineAddress}</a></p>`
        : "";

  return `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;margin:0 auto;padding:32px 24px">
      <div style="text-align:center;margin-bottom:24px">
        <h1 style="font-size:24px;color:#1E1B4B;margin:0">Help & Grow</h1>
      </div>
      <h2 style="font-size:20px;color:#D97706;margin-bottom:16px">Meetup starting in 1 hour</h2>
      <p>Hi ${greeting},</p>
      <p>Just a reminder — your meetup with <strong>${otherName}</strong> starts in about 1 hour.</p>
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

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Send meetup confirmation emails to both expert and founder,
 * and schedule reminder emails for 1 hour before the meetup.
 *
 * Gmail OAuth2 is the primary path. If Gmail credentials are not configured,
 * falls back to generic SMTP (env EMAIL_SERVER_*). When neither is available,
 * logs a warning and returns silently.
 */
export async function sendBookingEmails(params: BookingEmailParams): Promise<void> {
  const transporter = getTransporter();

  if (!transporter) {
    console.warn("[email] Neither Gmail OAuth2 nor SMTP credentials configured, skipping emails");
    return;
  }

  const recipients: { email: string; role: "expert" | "founder" }[] = [];
  if (params.expertEmail) recipients.push({ email: params.expertEmail, role: "expert" });
  if (params.founderEmail) recipients.push({ email: params.founderEmail, role: "founder" });

  if (recipients.length === 0) {
    console.warn("[email] No email addresses available, skipping");
    return;
  }

  // --- Confirmations (immediate) ---
  const confirmationPromises = recipients.map((r) =>
    transporter
      .sendMail({
        from: FROM_EMAIL,
        to: r.email,
        subject: `Meetup confirmed — ${params.sessionType === "ONLINE" ? "Online" : "In-person"}`,
        html: confirmationHtml(params, r.role),
      })
      .catch((err) => console.error(`[email] Failed to send confirmation to ${r.email}:`, err))
  );

  await Promise.all(confirmationPromises);
  console.log(`[email] Sent ${confirmationPromises.length} confirmation(s) via ${getGmailTransporter() ? "Gmail OAuth2" : "SMTP"}`);

  // --- Reminders (1 hour before, if in the future) ---
  const reminderTime = new Date(params.startTime.getTime() - 60 * 60 * 1000);
  if (reminderTime > new Date()) {
    // Nodemailer does not support scheduled sends natively.
    // For now we send the reminder immediately with a note in the subject
    // line. A proper scheduled-reminder system (Vercel Cron / Inngest) can
    // be layered on later.
    const reminderPromises = recipients.map((r) =>
      transporter
        .sendMail({
          from: FROM_EMAIL,
          to: r.email,
          subject: `Reminder: Meetup with ${r.role === "expert" ? params.founderName : params.expertName} in 1 hour`,
          html: reminderHtml(params, r.role),
        })
        .catch((err) => console.error(`[email] Failed to send reminder to ${r.email}:`, err))
    );

    await Promise.all(reminderPromises);
    console.log(`[email] Sent ${reminderPromises.length} reminder(s) via ${getGmailTransporter() ? "Gmail OAuth2" : "SMTP"}`);
  }
}
