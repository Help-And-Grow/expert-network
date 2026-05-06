"use client";

import { useEffect, useState } from "react";

import { CheckCircle2, X } from "lucide-react";

/**
 * Phase 3 of the guest-booking rollout
 * (docs/exec-plans/active/guest-booking.md §6).
 *
 * One-time, dismissible welcome banner shown the first time a user lands on
 * /booking after they've signed in for the first time AND have at least one
 * booking on their account. The banner serves two purposes:
 *
 *   1. Reassures the user that the meetup they booked as a guest is now
 *      attached to the account they just authenticated with — closes a
 *      common "did my past booking get lost?" anxiety.
 *   2. Subtly explains the merge ("we matched your email") so it's not
 *      surprising or magical.
 *
 * State is kept in localStorage keyed by user id, so the banner shows once
 * per browser per account. No backend / schema change.
 */
const STORAGE_KEY = "hg.guestMergeBanner.acknowledged";

interface GuestMergeBannerProps {
  /** Currently signed-in user id (null = unauth, banner hidden). */
  userId: string | null | undefined;
  /** Number of bookings already on this account at first paint. 0 = hidden. */
  bookingCount: number;
}

export function GuestMergeBanner({ userId, bookingCount }: GuestMergeBannerProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!userId || bookingCount <= 0) {
      setVisible(false);
      return;
    }
    if (typeof window === "undefined") return;

    let acknowledged = false;
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Record<string, true>;
        acknowledged = parsed[userId] === true;
      }
    } catch {
      // Corrupt storage; treat as unacknowledged. The dismiss handler will rewrite cleanly.
    }
    setVisible(!acknowledged);
  }, [userId, bookingCount]);

  if (!visible) return null;

  const dismiss = () => {
    setVisible(false);
    if (typeof window === "undefined" || !userId) return;
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      const parsed = raw ? (JSON.parse(raw) as Record<string, true>) : {};
      parsed[userId] = true;
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
    } catch {
      // Best-effort. If localStorage is unavailable the banner stays dismissed for this paint.
    }
  };

  const label = bookingCount === 1 ? "your past meetup" : `your ${bookingCount} past meetups`;

  return (
    <div
      role="status"
      aria-live="polite"
      className="surface-success flex items-start gap-3 rounded-2xl border border-emerald-300/30 px-4 py-3 text-sm"
    >
      <CheckCircle2
        aria-hidden
        className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-300"
      />
      <div className="flex-1">
        <p className="font-medium text-foreground">Welcome back</p>
        <p className="mt-0.5 text-muted-foreground">
          We matched your email and linked {label} to this account. They&apos;ll show up below.
        </p>
      </div>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss welcome banner"
        className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
