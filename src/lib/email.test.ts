import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mock fns for verifying calls
// ---------------------------------------------------------------------------

const emailsSendMock = vi.hoisted(() => vi.fn().mockResolvedValue({ data: { id: "resend-id" }, error: null }));
const sendMailMock = vi.hoisted(() => vi.fn().mockResolvedValue({ messageId: "test-id" }));

// Use a real class so `new Resend()` works inside the module under test
vi.mock("resend", () => {
  class MockResend {
    constructor(_apiKey: string) {}
    emails = { send: emailsSendMock };
  }
  return { Resend: MockResend };
});

vi.mock("nodemailer", () => ({
  default: {
    createTransport: () => ({ sendMail: sendMailMock }),
  },
}));

vi.mock("@/lib/env", () => ({
  env: {
    GMAIL_CLIENT_ID: "",
    GMAIL_CLIENT_SECRET: "",
    GMAIL_REFRESH_TOKEN: "",
    GMAIL_USER: "",
    RESEND_API_KEY: "re_test_key",
    RESEND_EMAIL_FROM: "Help & Grow <test@resend.dev>",
    EMAIL_SERVER_HOST: "",
    EMAIL_SERVER_PORT: "",
    EMAIL_SERVER_USER: "",
    EMAIL_SERVER_PASSWORD: "",
    EMAIL_FROM: "",
  },
}));

vi.mock("@/lib/google-maps", () => ({
  buildGoogleMapsUrl: (addr: string) => `https://maps.google.com/?q=${encodeURIComponent(addr)}`,
}));

import { sendBookingEmails } from "@/lib/email";

describe("sendBookingEmails", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sends confirmation to both expert and founder via Resend fallback", async () => {
    await sendBookingEmails({
      expertName: "Dr. Smith",
      founderName: "Alice",
      expertEmail: "expert@test.com",
      founderEmail: "founder@test.com",
      sessionType: "ONLINE",
      startTime: new Date("2026-06-01T10:00:00Z"),
      endTime: new Date("2026-06-01T11:00:00Z"),
      timezone: "Asia/Singapore",
      meetingLink: "https://meet.google.com/abc",
      offlineAddress: null,
      bookingId: "booking-1",
    });

    // 2 confirmations + 2 reminders (startTime - 1hr is in the future)
    expect(emailsSendMock).toHaveBeenCalledTimes(4);
  });

  it("skips reminders when meetup is less than 1 hour away", async () => {
    await sendBookingEmails({
      expertName: "Dr. Smith",
      founderName: "Alice",
      expertEmail: "expert@test.com",
      founderEmail: "founder@test.com",
      sessionType: "ONLINE",
      startTime: new Date(Date.now() + 30 * 60 * 1000), // 30 min from now
      endTime: new Date(Date.now() + 90 * 60 * 1000),
      timezone: "Asia/Singapore",
      meetingLink: "https://meet.google.com/abc",
      offlineAddress: null,
      bookingId: "booking-2",
    });

    // Only 2 confirmations, no reminders (reminder time is in the past)
    expect(emailsSendMock).toHaveBeenCalledTimes(2);
  });

  it("uses correct from address from RESEND_EMAIL_FROM", async () => {
    await sendBookingEmails({
      expertName: "Dr. Smith",
      founderName: "Alice",
      expertEmail: "expert@test.com",
      founderEmail: null,
      sessionType: "ONLINE",
      startTime: new Date(Date.now() + 2 * 60 * 60 * 1000),
      endTime: new Date(Date.now() + 3 * 60 * 60 * 1000),
      timezone: "Asia/Singapore",
      meetingLink: null,
      offlineAddress: null,
      bookingId: "booking-3",
    });

    const call = emailsSendMock.mock.calls[0][0];
    expect(call.from).toBe("Help & Grow <test@resend.dev>");
  });
});
