"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";

import { format, parseISO } from "date-fns";
import {
  AlertTriangle,
  ArrowLeft,
  Calendar,
  CheckCircle2,
  Clock,
  Loader2,
  Monitor,
  MapPin,
  XCircle,
} from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * Magic-link booking management — Phase 2 of guest-booking.
 * URL: /bookings/{id}/manage?t={signed-token}
 *
 * The page accepts an HMAC-signed token (see `lib/booking-token.ts`) bound to
 * this specific bookingId. With a valid token the user can:
 *   - View the booking details (date, type, location)
 *   - Cancel the booking (subject to the same 2-hour-before guard as the
 *     dashboard cancel flow)
 *
 * Reschedule is supported by the API but the UI for it ships in a follow-up;
 * the design doc (§5.4) calls Phase 2 as cancel + view + reschedule, but
 * picking a new slot deserves the full slot-picker experience and we'd rather
 * land cancel cleanly first.
 */

interface Booking {
  id: string;
  status: "PENDING" | "CONFIRMED" | "COMPLETED" | "CANCELLED";
  sessionType: "ONLINE" | "OFFLINE";
  startTime: string;
  endTime: string;
  timezone: string;
  meetingLink: string | null;
  offlineAddress: string | null;
  totalAmountCents: number | null;
  currency: string;
  expert: {
    user: {
      name: string | null;
      nickName: string | null;
    };
  };
  founder: {
    name: string | null;
    nickName: string | null;
    email: string | null;
  };
}

function formatDuration(startISO: string, endISO: string): string {
  const minutes = Math.round(
    (new Date(endISO).getTime() - new Date(startISO).getTime()) / 60_000,
  );
  return `${minutes} min`;
}

function ManagePageInner() {
  const params = useParams();
  const search = useSearchParams();
  const bookingId = params.id as string;
  const token = search.get("t");

  const [booking, setBooking] = useState<Booking | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelled, setCancelled] = useState(false);

  const fetchBooking = useCallback(async () => {
    if (!bookingId || !token) {
      setError(
        "This management link is missing its token. Reopen the link from your confirmation email.",
      );
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/bookings/${bookingId}?t=${encodeURIComponent(token)}`,
        { cache: "no-store" },
      );
      const data = await res.json();
      if (!res.ok) {
        throw new Error(
          data?.error ||
            (res.status === 401
              ? "This management link has expired or is invalid. Please request a new confirmation email or sign in."
              : "Could not load this booking"),
        );
      }
      setBooking(data as Booking);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load this booking");
    } finally {
      setLoading(false);
    }
  }, [bookingId, token]);

  useEffect(() => {
    void fetchBooking();
  }, [fetchBooking]);

  const handleCancel = async () => {
    if (!bookingId || !token) return;
    setCancelling(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/bookings/${bookingId}?t=${encodeURIComponent(token)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "cancel",
            reason: cancelReason.trim() || undefined,
          }),
        },
      );
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || "Could not cancel this booking");
      }
      setCancelled(true);
      setBooking(data as Booking);
      setShowCancelConfirm(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not cancel this booking");
    } finally {
      setCancelling(false);
    }
  };

  const expertName =
    booking?.expert.user.nickName ?? booking?.expert.user.name ?? "your expert";

  const startsSoon = useMemo(() => {
    if (!booking) return false;
    const ms = new Date(booking.startTime).getTime() - Date.now();
    return ms < 2 * 60 * 60 * 1000;
  }, [booking]);

  return (
    <div className="app-shell mx-auto min-h-screen max-w-lg bg-background">
      <header className="sticky top-0 z-10 border-b bg-background/95 px-4 py-4 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="flex items-center justify-between">
          <h1 className="text-base font-semibold">Manage your meetup</h1>
          <Link
            href="/"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Home
          </Link>
        </div>
      </header>

      <main className="space-y-4 px-4 py-6">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-12">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            <span className="text-sm text-muted-foreground">Loading…</span>
          </div>
        ) : error && !booking ? (
          <div className="surface-tint space-y-2 rounded-2xl p-5">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-5 w-5 text-amber-500" />
              <div>
                <h2 className="font-semibold">We couldn&apos;t open this link</h2>
                <p className="mt-1 text-sm text-muted-foreground">{error}</p>
              </div>
            </div>
            <p className="pt-2 text-xs text-muted-foreground">
              You can also{" "}
              <Link href="/auth/signin" className="font-medium text-primary underline">
                sign in
              </Link>{" "}
              with the email you used to book and manage from your dashboard.
            </p>
          </div>
        ) : booking ? (
          <>
            {cancelled || booking.status === "CANCELLED" ? (
              <div className="surface-tint flex items-start gap-2 rounded-2xl p-5">
                <CheckCircle2 className="mt-0.5 h-5 w-5 text-emerald-500" />
                <div>
                  <h2 className="font-semibold">This meetup is cancelled</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {booking.totalAmountCents && booking.totalAmountCents > 0
                      ? `If a refund applies, it will be processed automatically within 5–10 business days.`
                      : `Thanks for letting us know. ${expertName} has been notified.`}
                  </p>
                </div>
              </div>
            ) : null}

            <section className="surface-tint space-y-3 rounded-2xl p-5">
              <div className="space-y-1">
                <h2 className="text-base font-semibold">
                  Meetup with {expertName}
                </h2>
                <p className="text-xs text-muted-foreground">
                  Booking ID: {booking.id.slice(0, 12)}…
                </p>
              </div>
              <div className="grid gap-2 text-sm">
                <div className="flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-muted-foreground" />
                  <span>
                    {format(parseISO(booking.startTime), "EEEE, MMMM d, yyyy")}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4 text-muted-foreground" />
                  <span>
                    {format(parseISO(booking.startTime), "h:mm a")} —{" "}
                    {format(parseISO(booking.endTime), "h:mm a")} ·{" "}
                    {formatDuration(booking.startTime, booking.endTime)}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {booking.sessionType === "ONLINE" ? (
                    <Monitor className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <MapPin className="h-4 w-4 text-muted-foreground" />
                  )}
                  <span>
                    {booking.sessionType === "ONLINE"
                      ? booking.meetingLink || "Online"
                      : booking.offlineAddress || "Offline"}
                  </span>
                </div>
              </div>
            </section>

            {error && booking ? (
              <p className="rounded-lg bg-destructive/10 px-4 py-2 text-sm text-destructive">
                {error}
              </p>
            ) : null}

            {!cancelled &&
            booking.status !== "CANCELLED" &&
            booking.status !== "COMPLETED" ? (
              <section className="space-y-2">
                {showCancelConfirm ? (
                  <div className="surface-tint space-y-3 rounded-2xl p-5">
                    <div>
                      <h3 className="font-semibold text-sm">
                        Cancel this meetup?
                      </h3>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {expertName} will be notified. Tell them why if you&apos;d
                        like — it&apos;s optional.
                      </p>
                    </div>
                    <textarea
                      value={cancelReason}
                      onChange={(e) => setCancelReason(e.target.value)}
                      placeholder="Optional reason"
                      maxLength={500}
                      rows={3}
                      className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                    <div className="flex gap-2">
                      <Button
                        variant="ghost"
                        className="flex-1"
                        onClick={() => setShowCancelConfirm(false)}
                        disabled={cancelling}
                      >
                        Keep it
                      </Button>
                      <Button
                        variant="destructive"
                        className="flex-1"
                        onClick={handleCancel}
                        disabled={cancelling}
                      >
                        {cancelling ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          "Cancel meetup"
                        )}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <>
                    <Button
                      variant="outline"
                      className="w-full gap-2"
                      onClick={() => setShowCancelConfirm(true)}
                      disabled={startsSoon}
                    >
                      <XCircle className="h-4 w-4" />
                      Cancel meetup
                    </Button>
                    {startsSoon ? (
                      <p className="px-1 text-center text-xs text-muted-foreground">
                        Meetup starts within 2 hours and can no longer be
                        cancelled here. Reach out to {expertName} directly.
                      </p>
                    ) : (
                      <p className="px-1 text-center text-xs text-muted-foreground">
                        Need to reschedule? Reply to your confirmation email and
                        {" "}{expertName} can pick a new time with you.
                      </p>
                    )}
                  </>
                )}
              </section>
            ) : null}
          </>
        ) : null}
      </main>
    </div>
  );
}

export default function BookingManagePage() {
  // useSearchParams must live under a Suspense boundary in App Router.
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center gap-2">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          <span className="text-sm text-muted-foreground">Loading…</span>
        </div>
      }
    >
      <ManagePageInner />
    </Suspense>
  );
}
