import { describe, it, expect, vi, beforeEach } from "vitest";

const sendMailMock = vi.fn().mockResolvedValue({ messageId: "test-id" });

vi.mock("nodemailer", () => ({
  default: {
    createTransport: vi.fn(() => ({
      sendMail: sendMailMock,
    })),
  },
}));

vi.mock("@/lib/env", () => ({
  env: {
    GMAIL_CLIENT_ID: "test-client-id",
    GMAIL_CLIENT_SECRET: "test-client-secret",
    GMAIL_REFRESH_TOKEN: "test-refresh-token",
    GMAIL_USER: "hello@test.com",
    EMAIL_SERVER_HOST: undefined,
    EMAIL_SERVER_PORT: undefined,
    EMAIL_SERVER_USER: undefined,
    EMAIL_SERVER_PASSWORD: undefined,
    EMAIL_FROM: undefined,
  },
}));

vi.mock("@/lib/google-maps", () => ({
  buildGoogleMapsUrl: (addr: string) => `https://maps.google.com/?q=${encodeURIComponent(addr)}`,
}));

import { sendBookingEmails } from "@/lib/email";

describe("email (Gmail OAuth2)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const baseParams = {
    expertName: "Alice",
    founderName: "Bob",
    expertEmail: "alice@test.com",
    founderEmail: "bob@test.com",
    sessionType: "ONLINE" as const,
    startTime: new Date("2026-06-15T10:00:00Z"),
    endTime: new Date("2026-06-15T11:00:00Z"),
    timezone: "Asia/Singapore",
    meetingLink: "https://meet.google.com/test",
    offlineAddress: null,
    bookingId: "booking-123",
  };

  it("sends confirmation emails to both expert and founder via Gmail", async () => {
    await sendBookingEmails(baseParams);

    // 2 confirmations + 0 reminders (reminder time is in the past relative to the test)
    expect(sendMailMock.mock.calls.length).toBeGreaterThanOrEqual(2);

    const recipients = sendMailMock.mock.calls.map((c: any[]) => c[0].to);
    expect(recipients).toContain("alice@test.com");
    expect(recipients).toContain("bob@test.com");

    const froms = sendMailMock.mock.calls.map((c: any[]) => c[0].from);
    expect(froms[0]).toContain("hello@test.com");
  });

  it("sends confirmation + reminder when start time is in the future", async () => {
    const futureStart = new Date();
    futureStart.setHours(futureStart.getHours() + 2);

    await sendBookingEmails({
      ...baseParams,
      startTime: futureStart,
      endTime: new Date(futureStart.getTime() + 60 * 60 * 1000),
    });

    // 2 confirmations + 2 reminders
    expect(sendMailMock).toHaveBeenCalledTimes(4);
  });

  it("uses Gmail OAuth2 from address", async () => {
    await sendBookingEmails(baseParams);

    const firstCall = sendMailMock.mock.calls[0][0];
    expect(firstCall.from).toContain("hello@test.com");
  });
});
