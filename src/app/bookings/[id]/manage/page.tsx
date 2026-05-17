"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";

import { format, parseISO } from "date-fns";
import {
  AlertTriangle,
  ArrowLeft,
  Calendar,
  CalendarClock,
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
 *   - Reschedule the booking to a new slot via inline picker (same 2-hour guard)
 */

type WeeklyRange = { start: string; end: string };
type WeeklySchedule = Record<string, WeeklyRange[]>;

interface AvailableSlotDb {
  id: string;
  startTime: string;
  endTime: string;
  isBooked: boolean;
}

interface BookedSlot {
  startTime: string;
  endTime: string;
}

interface SlotItem {
  id: string;
  startTime: string;
  endTime: string;
}

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
  expertId: string;
  expert: {
    user: {
      name: string | null;
      nickName: string | null;
    };
    weeklySchedule?: WeeklySchedule | null;
  };
  founder: {
    name: string | null;
    nickName: string | null;
    email: string | null;
  };
}

type Mode = "view" | "slots" | "confirm" | "success";

const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

function formatDuration(startISO: string, endISO: string): string {
  const minutes = Math.round(
    (new Date(endISO).getTime() - new Date(startISO).getTime()) / 60_000,
  );
  return `${minutes} min`;
}

function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseDateStr(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d, 0, 0, 0, 0);
}

function formatTime(iso: string): string {
  return format(parseISO(iso), "h:mm a");
}

function isSlotBooked(slot: SlotItem, bookedSlots: BookedSlot[]): boolean {
  const sStart = new Date(slot.startTime).getTime();
  const sEnd = new Date(slot.endTime).getTime();
  return bookedSlots.some((b) => {
    const bStart = new Date(b.startTime).getTime();
    const bEnd = new Date(b.endTime).getTime();
    return sStart < bEnd && sEnd > bStart;
  });
}

function generateSlotsFromSchedule(
  date: Date,
  schedule: WeeklySchedule,
): SlotItem[] {
  const dayKey = DAY_KEYS[date.getDay()];
  const ranges = schedule[dayKey];
  if (!ranges || ranges.length === 0) return [];

  const dayStart = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    0,
    0,
    0,
    0,
  );
  const slots: SlotItem[] = [];
  let idx = 0;

  for (const range of ranges) {
    const [sh, sm] = range.start.split(":").map(Number);
    const [eh, em] = range.end.split(":").map(Number);
    let h = sh;
    let m = sm ?? 0;
    while (h < eh || (h === eh && m < em)) {
      const startMs = dayStart.getTime() + (h * 60 + m) * 60_000;
      const nextM = m + 30;
      const endH = h + Math.floor(nextM / 60);
      const endM = nextM % 60;
      const withinRange = endH < eh || (endH === eh && endM <= em);
      const endMs = withinRange
        ? dayStart.getTime() + (endH * 60 + endM) * 60_000
        : dayStart.getTime() + (eh * 60 + em) * 60_000;
      if (endMs > startMs) {
        slots.push({
          id: `sched-${idx++}`,
          startTime: new Date(startMs).toISOString(),
          endTime: new Date(endMs).toISOString(),
        });
      }
      h = endH;
      m = endM;
    }
  }
  return slots;
}

function getSlotsForDate(
  dateStr: string,
  allDbSlots: AvailableSlotDb[],
  bookedSlots: BookedSlot[],
  schedule: WeeklySchedule | null | undefined,
): SlotItem[] {
  const date = parseDateStr(dateStr);
  const now = new Date();

  const explicit: SlotItem[] = allDbSlots
    .filter((s) => {
      const sd = new Date(s.startTime);
      return (
        sd.getFullYear() === date.getFullYear() &&
        sd.getMonth() === date.getMonth() &&
        sd.getDate() === date.getDate() &&
        !s.isBooked
      );
    })
    .map((s) => ({ id: s.id, startTime: s.startTime, endTime: s.endTime }));

  const source: SlotItem[] =
    explicit.length > 0
      ? explicit
      : schedule
        ? generateSlotsFromSchedule(date, schedule)
        : [];

  return source.filter(
    (s) => new Date(s.startTime) > now && !isSlotBooked(s, bookedSlots),
  );
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

  // Reschedule state machine
  const [mode, setMode] = useState<Mode>("view");
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [slotsError, setSlotsError] = useState<string | null>(null);
  const [dbSlots, setDbSlots] = useState<AvailableSlotDb[]>([]);
  const [bookedSlots, setBookedSlots] = useState<BookedSlot[]>([]);
  const [selectedDate, setSelectedDate] = useState<string>(() =>
    toDateStr(new Date()),
  );
  const [selectedSlot, setSelectedSlot] = useState<SlotItem | null>(null);
  const [rescheduling, setRescheduling] = useState(false);
  const [rescheduleError, setRescheduleError] = useState<string | null>(null);

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

  // Slot fetch — runs when entering "slots" mode for the first time
  const loadSlots = useCallback(async () => {
    if (!booking) return;
    setSlotsLoading(true);
    setSlotsError(null);
    try {
      const res = await fetch(`/api/experts/${booking.expertId}/slots`, {
        cache: "no-store",
      });
      if (!res.ok) {
        throw new Error("Could not load available slots");
      }
      const data = (await res.json()) as {
        slots: AvailableSlotDb[];
        bookedSlots: BookedSlot[];
      };
      setDbSlots(data.slots ?? []);
      // Exclude the current booking's own slot from "booked" so it appears
      // selectable (otherwise rescheduling shows it as booked-against-itself).
      // Compare in milliseconds rather than as raw strings — Prisma+Vercel
      // JSON sometimes drops milliseconds from the booking detail response
      // (`...:00Z`) while keeping them on the slots-API response
      // (`...:00.000Z`), making string `!==` miss the match and leaving the
      // current booking incorrectly *included* in the booked list, which in
      // turn was masking other bookings' overlaps in a confusing way.
      const myStartMs = new Date(booking.startTime).getTime();
      const filtered = (data.bookedSlots ?? []).filter(
        (b) => new Date(b.startTime).getTime() !== myStartMs,
      );
      setBookedSlots(filtered);
    } catch (e) {
      setSlotsError(
        e instanceof Error ? e.message : "Could not load available slots",
      );
    } finally {
      setSlotsLoading(false);
    }
  }, [booking]);

  const handleStartReschedule = useCallback(() => {
    setRescheduleError(null);
    setSelectedSlot(null);
    setSelectedDate(toDateStr(new Date()));
    setMode("slots");
    void loadSlots();
  }, [loadSlots]);

  // Reset selected slot when date changes
  useEffect(() => {
    setSelectedSlot(null);
  }, [selectedDate]);

  const daySlots = useMemo(() => {
    if (!booking) return [];
    return getSlotsForDate(
      selectedDate,
      dbSlots,
      bookedSlots,
      booking.expert.weeklySchedule,
    );
  }, [selectedDate, dbSlots, bookedSlots, booking]);

  const minDateStr = useMemo(() => toDateStr(new Date()), []);

  const handleConfirmReschedule = useCallback(async () => {
    if (!booking || !selectedSlot || !token) return;
    setRescheduling(true);
    setRescheduleError(null);
    try {
      const res = await fetch(
        `/api/bookings/${booking.id}?t=${encodeURIComponent(token)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "reschedule",
            startTime: selectedSlot.startTime,
            endTime: selectedSlot.endTime,
            timezone: booking.timezone,
          }),
        },
      );
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || "Could not reschedule this booking");
      }
      setBooking(data as Booking);
      setMode("success");
    } catch (e) {
      setRescheduleError(
        e instanceof Error ? e.message : "Could not reschedule this booking",
      );
    } finally {
      setRescheduling(false);
    }
  }, [booking, selectedSlot, token]);

  // After success, refresh the booking after 2s and return to view mode
  useEffect(() => {
    if (mode !== "success") return;
    const t = setTimeout(() => {
      void fetchBooking();
    }, 2000);
    return () => clearTimeout(t);
  }, [mode, fetchBooking]);

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
                {mode === "view" && showCancelConfirm ? (
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
                ) : mode === "view" ? (
                  <>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        className="flex-1 gap-2"
                        onClick={handleStartReschedule}
                        disabled={startsSoon}
                      >
                        <CalendarClock className="h-4 w-4" />
                        Reschedule meetup
                      </Button>
                      <Button
                        variant="destructive"
                        className="flex-1 gap-2"
                        onClick={() => setShowCancelConfirm(true)}
                        disabled={startsSoon}
                      >
                        <XCircle className="h-4 w-4" />
                        Cancel meetup
                      </Button>
                    </div>
                    {startsSoon ? (
                      <p className="px-1 text-center text-xs text-muted-foreground">
                        Meetup starts within 2 hours — reach out to{" "}
                        {expertName} directly.
                      </p>
                    ) : null}
                  </>
                ) : mode === "slots" ? (
                  <div className="surface-tint space-y-4 rounded-2xl p-5">
                    <div className="space-y-1">
                      <h3 className="text-sm font-semibold">Pick a new time</h3>
                      <div className="rounded-lg bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                        <span className="font-medium text-foreground">
                          Current:
                        </span>{" "}
                        {format(
                          parseISO(booking.startTime),
                          "EEE, MMM d · h:mm a",
                        )}{" "}
                        — {format(parseISO(booking.endTime), "h:mm a")}
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <label
                        htmlFor="reschedule-date"
                        className="block text-xs font-medium text-muted-foreground"
                      >
                        Date
                      </label>
                      <input
                        id="reschedule-date"
                        type="date"
                        value={selectedDate}
                        min={minDateStr}
                        onChange={(e) => setSelectedDate(e.target.value)}
                        className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <span className="block text-xs font-medium text-muted-foreground">
                        Available 30-minute slots
                      </span>
                      {slotsLoading ? (
                        <div className="flex items-center justify-center gap-2 py-6">
                          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                          <span className="text-xs text-muted-foreground">
                            Loading slots…
                          </span>
                        </div>
                      ) : slotsError ? (
                        <div className="space-y-2 rounded-lg bg-destructive/10 px-3 py-3 text-sm">
                          <p className="text-destructive">{slotsError}</p>
                          <Link
                            href="/auth/signin?callbackUrl=/dashboard"
                            className="block text-xs font-medium text-primary underline"
                          >
                            Sign in to reschedule from your dashboard
                          </Link>
                        </div>
                      ) : daySlots.length === 0 ? (
                        <p className="rounded-lg bg-muted/40 px-3 py-3 text-center text-xs text-muted-foreground">
                          No open slots on this date. Try a different day.
                        </p>
                      ) : (
                        <div className="grid grid-cols-3 gap-2">
                          {daySlots.map((slot) => {
                            const active = selectedSlot?.id === slot.id;
                            return (
                              <button
                                key={slot.id}
                                type="button"
                                onClick={() =>
                                  setSelectedSlot(active ? null : slot)
                                }
                                className={
                                  active
                                    ? "rounded-lg border border-primary bg-primary px-2 py-2 text-xs font-medium text-primary-foreground shadow-sm"
                                    : "rounded-lg border border-input bg-background px-2 py-2 text-xs font-medium text-foreground hover:border-primary/40 hover:bg-muted/40"
                                }
                              >
                                {formatTime(slot.startTime)}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    {rescheduleError ? (
                      <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
                        {rescheduleError}
                      </p>
                    ) : null}

                    <div className="flex gap-2 pt-1">
                      <Button
                        variant="ghost"
                        className="flex-1"
                        onClick={() => {
                          setMode("view");
                          setSelectedSlot(null);
                          setRescheduleError(null);
                        }}
                      >
                        Back
                      </Button>
                      <Button
                        className="flex-1"
                        disabled={!selectedSlot || Boolean(slotsError)}
                        onClick={() => setMode("confirm")}
                      >
                        Continue
                      </Button>
                    </div>
                  </div>
                ) : mode === "confirm" && selectedSlot ? (
                  <div className="surface-tint space-y-4 rounded-2xl p-5">
                    <div>
                      <h3 className="text-sm font-semibold">
                        Confirm reschedule
                      </h3>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {expertName} will be notified once you confirm.
                      </p>
                    </div>

                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div className="space-y-1">
                        <p className="text-xs text-muted-foreground">Original</p>
                        <p className="font-medium text-muted-foreground line-through">
                          {format(parseISO(booking.startTime), "EEE, MMM d")}
                        </p>
                        <p className="text-xs text-muted-foreground line-through">
                          {formatTime(booking.startTime)} —{" "}
                          {formatTime(booking.endTime)}
                        </p>
                      </div>
                      <div className="space-y-1">
                        <p className="text-xs text-muted-foreground">New</p>
                        <p className="font-medium text-foreground">
                          {format(
                            parseISO(selectedSlot.startTime),
                            "EEE, MMM d",
                          )}
                        </p>
                        <p className="text-xs text-foreground">
                          {formatTime(selectedSlot.startTime)} —{" "}
                          {formatTime(selectedSlot.endTime)}
                        </p>
                      </div>
                    </div>

                    {rescheduleError ? (
                      <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
                        {rescheduleError}
                      </p>
                    ) : null}

                    <div className="flex gap-2">
                      <Button
                        variant="ghost"
                        className="flex-1"
                        onClick={() => {
                          setMode("slots");
                          setRescheduleError(null);
                        }}
                        disabled={rescheduling}
                      >
                        Pick a different slot
                      </Button>
                      <Button
                        className="flex-1"
                        onClick={handleConfirmReschedule}
                        disabled={rescheduling}
                      >
                        {rescheduling ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          "Confirm reschedule"
                        )}
                      </Button>
                    </div>
                  </div>
                ) : mode === "success" ? (
                  <div className="surface-tint space-y-4 rounded-2xl p-5">
                    <div className="flex items-start gap-3">
                      <CheckCircle2 className="mt-0.5 h-5 w-5 text-emerald-500" />
                      <div>
                        <h3 className="text-sm font-semibold">
                          Reschedule confirmed!
                        </h3>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {format(
                            parseISO(booking.startTime),
                            "EEEE, MMMM d · h:mm a",
                          )}{" "}
                          — {format(parseISO(booking.endTime), "h:mm a")}
                        </p>
                      </div>
                    </div>
                    <Button
                      className="w-full"
                      onClick={() => {
                        setMode("view");
                        setSelectedSlot(null);
                      }}
                    >
                      Done
                    </Button>
                  </div>
                ) : null}
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
