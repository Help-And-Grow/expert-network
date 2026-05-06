import { z } from "zod";

import { isDisposableEmail } from "@/lib/disposable-email";
import { prisma } from "@/lib/prisma";

/**
 * Guest checkout helpers — no-login booking flow (Phase 1).
 *
 * The product decision: a user lands on an expert profile, picks a slot, and
 * pays without ever creating an account. We capture name + email at the
 * booking step and `upsert` a `User` row keyed by email. The booking's
 * `founderId` FK points at that row, so every existing query that joins on
 * the founder (notifications, token credits, POMP attestation, conflict
 * detection, dashboards) keeps working unchanged.
 *
 * When the same person later signs in via Google with the same email,
 * Auth.js v5 PrismaAdapter — which already has `allowDangerousEmailAccountLinking: true`
 * on the Google provider in `src/auth.ts` — attaches the OAuth `accounts`
 * row to the existing User. Their booking history, token balance, and any
 * pending POMP attestations are visible immediately. No merge code needed.
 *
 * See `docs/exec-plans/active/guest-booking.md` for the design.
 */

/** Body fields a Web client may send when booking without a session. */
export const guestContactSchema = z.object({
  guestEmail: z
    .string()
    .trim()
    .toLowerCase()
    .email("Please enter a valid email address")
    .max(254, "Email is too long")
    // Phase 4 hardening: block known disposable / throwaway mailboxes from
    // creating guest bookings. The expert needs a reachable email for the
    // meetup link, reminders, and any ad-hoc cancellation. Real users almost
    // never land on these domains; abusers do. See src/lib/disposable-email.ts
    // for the curated blocklist.
    .refine((email) => !isDisposableEmail(email), {
      message: "Please use a permanent email — disposable inboxes can't receive your meetup link.",
    }),
  guestName: z
    .string()
    .trim()
    .min(1, "Please enter your name")
    .max(120, "Name is too long"),
  /**
   * If true, after the booking the server triggers a magic-link sign-in email
   * so the user can later access /dashboard. If false, we still create the
   * User row (we have to — FK requirement) but no follow-up email is sent.
   * Defaults to true (matches the "Save my email for next time" checkbox
   * being checked-by-default in the UI).
   */
  saveEmail: z.coerce.boolean().optional().default(true),
});

export type GuestContact = z.infer<typeof guestContactSchema>;

/**
 * `upsert` a User row by email and return its id. Idempotent — repeat calls
 * with the same email return the same User. If the User already has OAuth
 * `accounts` rows (i.e. a returning signed-in user typing their own email
 * into the guest form), we DO NOT overwrite their `name` — that's their
 * data and they may have customized it.
 */
export async function upsertGuestUser(contact: GuestContact): Promise<{
  userId: string;
  isNew: boolean;
  isExistingAuthUser: boolean;
}> {
  const existing = await prisma.user.findUnique({
    where: { email: contact.guestEmail },
    select: {
      id: true,
      _count: { select: { accounts: true } },
    },
  });

  if (existing) {
    return {
      userId: existing.id,
      isNew: false,
      isExistingAuthUser: existing._count.accounts > 0,
    };
  }

  const created = await prisma.user.create({
    data: {
      email: contact.guestEmail,
      name: contact.guestName,
      // emailVerified intentionally null — guest, not verified. The next time
      // they sign in via Google/magic link, Auth.js will set this.
      role: "USER",
    },
    select: { id: true },
  });

  return { userId: created.id, isNew: true, isExistingAuthUser: false };
}
