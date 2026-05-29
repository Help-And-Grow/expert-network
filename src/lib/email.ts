import nodemailer from "nodemailer";
import { Resend } from "resend";

import { env } from "@/lib/env";
import { buildGoogleMapsUrl } from "@/lib/google-maps";

// ---------------------------------------------------------------------------
// Transport 1: Gmail OAuth2 (primary, recommended for production)
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
// Transport 2: Resend SDK (configured on Vercel, fallback when no Gmail)
// ---------------------------------------------------------------------------

let _resend: Resend | null = null;

function getResend(): Resend | null {
  if (!env.RESEND_API_KEY) return null;
  if (!_resend) _resend = new Resend(env.RESEND_API_KEY);
  return _resend;
}

// ---------------------------------------------------------------------------
// Transport 3: Generic SMTP (local dev / self-hosted fallback)
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

// ---------------------------------------------------------------------------
// "From" address resolution
// ---------------------------------------------------------------------------

const FROM_EMAIL =
  env.GMAIL_USER
    ? `Help & Grow <${env.GMAIL_USER}>`
    : env.RESEND_EMAIL_FROM ?? env.EMAIL_FROM ?? env.EMAIL_SERVER_USER ?? "Help & Grow <noreply@help-and-grow.com>";

// ---------------------------------------------------------------------------
// Email content generators
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
// Internal: send a single email via the best available transport
// ---------------------------------------------------------------------------

async function sendSingleEmail(to: string, subject: string, html: string): Promise<string> {
  // Priority: Gmail OAuth2 → Resend SDK → SMTP
  const gmail = getGmailTransporter();
  if (gmail) {
    await gmail.sendMail({ from: FROM_EMAIL, to, subject, html });
    return "Gmail OAuth2";
  }

  const resend = getResend();
  if (resend) {
    const { error } = await resend.emails.send({
      from: FROM_EMAIL,
      to,
      subject,
      html,
    });
    if (error) throw error;
    return "Resend";
  }

  const smtp = getSmtpTransporter();
  if (smtp) {
    await smtp.sendMail({ from: FROM_EMAIL, to, subject, html });
    return "SMTP";
  }

  throw new Error("No email transporter configured (need GMAIL_* or RESEND_API_KEY or EMAIL_SERVER_*)");
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Send meetup confirmation emails to both expert and founder,
 * and schedule reminder emails for 1 hour before the meetup.
 *
 * Transport priority: Gmail OAuth2 → Resend SDK → generic SMTP.
 * When none is configured, logs a warning and returns silently.
 */
export async function sendBookingEmails(params: BookingEmailParams): Promise<void> {
  const recipients: { email: string; role: "expert" | "founder" }[] = [];
  if (params.expertEmail) recipients.push({ email: params.expertEmail, role: "expert" });
  if (params.founderEmail) recipients.push({ email: params.founderEmail, role: "founder" });

  if (recipients.length === 0) {
    console.warn("[email] No email addresses available, skipping");
    return;
  }

  // --- Confirmations (immediate) ---
  const confirmationResults = await Promise.allSettled(
    recipients.map(async (r) => {
      const transport = await sendSingleEmail(
        r.email,
        `Meetup confirmed — ${params.sessionType === "ONLINE" ? "Online" : "In-person"}`,
        confirmationHtml(params, r.role),
      );
      return { email: r.email, transport };
    }),
  );

  for (const result of confirmationResults) {
    if (result.status === "fulfilled") {
      console.log(`[email] Sent confirmation to ${result.value.email} via ${result.value.transport}`);
    } else {
      console.error(`[email] Failed to send confirmation:`, result.reason);
    }
  }

  // --- Reminders (1 hour before, if in the future) ---
  const reminderTime = new Date(params.startTime.getTime() - 60 * 60 * 1000);
  if (reminderTime > new Date()) {
    const reminderResults = await Promise.allSettled(
      recipients.map(async (r) => {
        const transport = await sendSingleEmail(
          r.email,
          `Reminder: Meetup with ${r.role === "expert" ? params.founderName : params.expertName} in 1 hour`,
          reminderHtml(params, r.role),
        );
        return { email: r.email, transport };
      }),
    );

    for (const result of reminderResults) {
      if (result.status === "fulfilled") {
        console.log(`[email] Sent reminder to ${result.value.email} via ${result.value.transport}`);
      } else {
        console.error(`[email] Failed to send reminder:`, result.reason);
      }
    }
  }
}
