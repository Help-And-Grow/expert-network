import { createHmac, timingSafeEqual } from "crypto";

import { getAuthSecret } from "@/lib/auth-secret";

/**
 * Magic-link tokens for guest booking management — Phase 2 of the
 * guest-booking rollout (see docs/exec-plans/active/guest-booking.md §5.4).
 *
 * Goal: a guest who paid for a meetup can manage it (view, cancel,
 * reschedule) from the link in their confirmation email — without ever
 * creating an account or logging in. The token grants access to ONE
 * booking; it cannot be reused for any other booking, and it expires.
 *
 * Format: base64url-encoded payload `<bookingId>.<expirySeconds>.<sig>` where
 *   sig = HMAC-SHA256(`<bookingId>.<expirySeconds>`, AUTH_SECRET)
 *
 * - Verification is timing-safe (`crypto.timingSafeEqual`).
 * - The expiry is part of the signed payload, so a leaked token cannot be
 *   extended.
 * - Bound to a specific bookingId — a token for booking A is rejected if
 *   presented for booking B.
 * - TTL defaults to 90 days (long enough for a typical reschedule horizon
 *   plus generous buffer for the founder to act on the email).
 *
 * The shared secret is `AUTH_SECRET` so we don't introduce a new env var.
 * Auth.js v5 already requires this and the email-magic-link rotation policy
 * already covers it; rotating AUTH_SECRET invalidates outstanding booking
 * tokens, which is the right behavior.
 */

const DEFAULT_TTL_SECONDS = 90 * 24 * 60 * 60; // 90 days

function base64UrlEncode(input: Buffer | string): string {
  const buf = typeof input === "string" ? Buffer.from(input, "utf8") : input;
  return buf
    .toString("base64")
    .replace(/=+$/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function base64UrlDecode(input: string): Buffer {
  const padded = input + "=".repeat((4 - (input.length % 4)) % 4);
  return Buffer.from(padded.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

function getSecretOrThrow(): Buffer {
  const secret = getAuthSecret();
  if (!secret) {
    throw new Error(
      "AUTH_SECRET is not set — magic-link booking tokens cannot be signed.",
    );
  }
  return Buffer.from(secret, "utf8");
}

function sign(message: string, secret: Buffer): string {
  return createHmac("sha256", secret).update(message).digest("base64url");
}

/**
 * Create a magic-link token for `bookingId`. Default TTL is 90 days.
 */
export function signBookingToken(
  bookingId: string,
  ttlSeconds = DEFAULT_TTL_SECONDS,
): string {
  if (!bookingId || bookingId.length > 64) {
    throw new Error("bookingId is required and must be ≤ 64 chars.");
  }
  const expiry = Math.floor(Date.now() / 1000) + ttlSeconds;
  const message = `${bookingId}.${expiry}`;
  const sig = sign(message, getSecretOrThrow());
  // base64url-encode the whole envelope so it survives URL params unescaped.
  return base64UrlEncode(`${message}.${sig}`);
}

export type VerifyResult =
  | { ok: true; bookingId: string; expiresAt: Date }
  | { ok: false; reason: "malformed" | "expired" | "bad_signature" | "mismatch" };

/**
 * Verify a token. Returns `ok: true` only when:
 *   - it parses,
 *   - its embedded bookingId matches `expectedBookingId`,
 *   - the expiry hasn't elapsed,
 *   - the HMAC signature matches AUTH_SECRET.
 */
export function verifyBookingToken(
  token: string,
  expectedBookingId: string,
): VerifyResult {
  if (!token || typeof token !== "string") return { ok: false, reason: "malformed" };

  let decoded: string;
  try {
    decoded = base64UrlDecode(token).toString("utf8");
  } catch {
    return { ok: false, reason: "malformed" };
  }

  const parts = decoded.split(".");
  if (parts.length !== 3) return { ok: false, reason: "malformed" };

  const [bookingId, expiryStr, sig] = parts;
  const expiry = Number(expiryStr);
  if (!bookingId || !Number.isFinite(expiry)) {
    return { ok: false, reason: "malformed" };
  }

  if (bookingId !== expectedBookingId) {
    return { ok: false, reason: "mismatch" };
  }

  if (expiry * 1000 < Date.now()) {
    return { ok: false, reason: "expired" };
  }

  const expected = sign(`${bookingId}.${expiry}`, getSecretOrThrow());
  // timingSafeEqual requires equal lengths.
  const a = Buffer.from(sig, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: "bad_signature" };
  }

  return { ok: true, bookingId, expiresAt: new Date(expiry * 1000) };
}

/**
 * Build the canonical management URL for a booking. Pass an explicit `origin`
 * (e.g. from `getAppOrigin(request)`) so the URL respects the calling host;
 * defaults to the canonical production URL.
 */
export function buildManageUrl(
  bookingId: string,
  origin = "https://www.help-and-grow.com",
): string {
  const t = signBookingToken(bookingId);
  const trimmed = origin.replace(/\/$/, "");
  return `${trimmed}/bookings/${bookingId}/manage?t=${t}`;
}
