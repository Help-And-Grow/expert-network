"use client";

import { memo, useCallback, useEffect, useRef, useState } from "react";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { beginCell } from "@ton/core";
import { useTonConnectUI, useTonWallet } from "@tonconnect/ui-react";
import { format, parseISO, isSameDay, startOfDay, setHours, setMinutes } from "date-fns";
import {
  Calendar,
  Clock,
  Monitor,
  MapPin,
  Loader2,
  ArrowLeft,
  X,
  RotateCcw,
  MapPinned,
  Trash2,
  Wallet,
  ExternalLink,
  MessageSquarePlus,
  Heart,
  MessageSquareHeart,
  CheckCircle2,
  AlertCircle,
  Video,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar as CalendarPicker } from "@/components/ui/calendar";
import { Card, CardContent } from "@/components/ui/card";
import { AddressAutocompleteInput } from "@/components/address-autocomplete-input";
import { GuestMergeBanner } from "@/components/guest-merge-banner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { UserMenu } from "@/components/user-menu";
import { useAuth } from "@/hooks/use-auth";
import { buildGoogleMapsUrl } from "@/lib/google-maps";
import { getTelegramInitData } from "@/lib/telegram";
import { cn } from "@/lib/utils";

const TELEGRAM_TWA_RETURN_URL = process.env.NEXT_PUBLIC_TELEGRAM_TWA_RETURN_URL?.trim() as
  | `${string}://${string}`
  | undefined;

interface UserData {
  id: string;
  role: string;
  expert?: { id: string; isPublished: boolean } | null;
}

interface BookingReview {
  id: string;
  rating: number;
  comment: string | null;
  expertSuggestion: string | null;
  suggestionAt: string | null;
  createdAt: string;
}

/** Optimistic rows use this id until the server response replaces them. */
const PENDING_REVIEW_ID_PREFIX = "pending:";

/**
 * Mirror server-side TRTC window: opens 15 min before startTime, closes 15
 * min after endTime. Hides the "Join live" link outside that window.
 * Status must be CONFIRMED or COMPLETED (the server enforces this too).
 */
const TRTC_PREJOIN_MS = 15 * 60 * 1000;
const TRTC_POST_END_GRACE_MS = 15 * 60 * 1000;
function isLiveRoomOpen(booking: {
  status: string;
  startTime: string;
  endTime: string;
}): boolean {
  if (booking.status !== "CONFIRMED" && booking.status !== "COMPLETED") return false;
  const start = new Date(booking.startTime).getTime();
  const end = new Date(booking.endTime).getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) return false;
  const now = Date.now();
  return now >= start - TRTC_PREJOIN_MS && now <= end + TRTC_POST_END_GRACE_MS;
}

/** Normalize a Review JSON body from POST/PATCH so we can update the dashboard without a full refetch. */
function parseBookingReviewFromApi(raw: unknown): BookingReview | null {
  if (typeof raw !== "object" || raw === null) return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.id !== "string") return null;
  if (typeof o.rating !== "number" || !Number.isInteger(o.rating)) return null;
  const comment = o.comment === null || typeof o.comment === "string" ? o.comment : null;
  const expertSuggestion =
    o.expertSuggestion === null || typeof o.expertSuggestion === "string"
      ? o.expertSuggestion
      : null;
  const suggestionAt =
    o.suggestionAt === null || typeof o.suggestionAt === "string" ? o.suggestionAt : null;
  if (typeof o.createdAt !== "string") return null;
  return {
    id: o.id,
    rating: o.rating,
    comment,
    expertSuggestion,
    suggestionAt,
    createdAt: o.createdAt,
  };
}

type BookingAction = "cancel" | "reschedule" | "location";

type ActionFeedback = {
  kind: "success" | "error" | "info";
  message: string;
};

function ModalFeedback({ feedback }: { feedback: ActionFeedback | null }) {
  if (!feedback) return null;

  const Icon =
    feedback.kind === "success"
      ? CheckCircle2
      : feedback.kind === "error"
        ? AlertCircle
        : Loader2;

  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-md border px-3 py-2 text-sm",
        feedback.kind === "success" &&
          "border-emerald-500/30 bg-emerald-500/10 text-emerald-100",
        feedback.kind === "error" &&
          "border-destructive/30 bg-destructive/10 text-destructive",
        feedback.kind === "info" &&
          "border-indigo-500/30 bg-indigo-500/10 text-indigo-100",
      )}
      role={feedback.kind === "error" ? "alert" : "status"}
    >
      <Icon
        className={cn(
          "mt-0.5 h-4 w-4 shrink-0",
          feedback.kind === "info" && "animate-spin",
        )}
      />
      <span>{feedback.message}</span>
    </div>
  );
}

interface Booking {
  id: string;
  sessionType: string;
  startTime: string;
  endTime: string;
  status: string;
  meetingLink?: string | null;
  offlineAddress?: string | null;
  cancelledBy?: string | null;
  cancelReason?: string | null;
  paymentMethod?: string | null;
  paymentStatus?: string | null;
  depositAmountCents?: number | null;
  totalAmountCents?: number | null;
  currency?: string | null;
  isPremiumLive?: boolean;
  expert?: {
    id: string;
    userId?: string;
    user: { id?: string; name: string | null; nickName: string | null };
  };
  founderId?: string;
  founder?: {
    id: string;
    name: string | null;
    nickName: string | null;
    expert?: { id: string; isPublished: boolean } | null;
  };
  review?: BookingReview | null;
}

function getHeaders() {
  const initData = getTelegramInitData();
  return initData ? { "x-telegram-init-data": initData } : undefined;
}

export default function DashboardPage() {
  const router = useRouter();
  const { status: sessionStatus, isTelegram } = useAuth();
  const [userData, setUserData] = useState<UserData | null>(null);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);

  const loadDashboard = useCallback(async () => {
    const tgHeaders = getHeaders();
    const noCache = { cache: "no-store" as RequestCache };
    const fetchUser = () => fetch("/api/user", { headers: tgHeaders, ...noCache });
    let userRes = await fetchUser();

    if (userRes.status === 401 && getTelegramInitData()) {
      await fetch("/api/auth/telegram", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ initData: getTelegramInitData() }),
      }).catch(() => {});
      userRes = await fetchUser();
    }

    const user = userRes.ok ? await userRes.json() : null;
    setUserData(user);

    if (!user) {
      setBookings([]);
      setLoading(false);
      return;
    }

    const bookingsRes = await fetch("/api/bookings", { headers: tgHeaders, ...noCache }).catch(() => null);
    const bookingsData = bookingsRes?.ok ? await bookingsRes.json() : { bookings: [] };
    setBookings(bookingsData?.bookings ?? []);

    setLoading(false);
  }, []);

  const applyReviewFromApi = useCallback((bookingId: string, raw: unknown) => {
    const review = parseBookingReviewFromApi(raw);
    if (!review) return;
    setBookings((prev) =>
      prev.map((b) => (b.id === bookingId ? { ...b, review } : b))
    );
  }, []);

  const applyOptimisticAppreciation = useCallback((bookingId: string, commentText: string) => {
    const optimistic: BookingReview = {
      id: `${PENDING_REVIEW_ID_PREFIX}${bookingId}`,
      rating: 5,
      comment: commentText,
      expertSuggestion: null,
      suggestionAt: null,
      createdAt: new Date().toISOString(),
    };
    setBookings((prev) =>
      prev.map((b) => (b.id === bookingId ? { ...b, review: optimistic } : b))
    );
  }, []);

  const revertPendingReviewIfAny = useCallback((bookingId: string) => {
    setBookings((prev) =>
      prev.map((b) =>
        b.id === bookingId && b.review?.id.startsWith(PENDING_REVIEW_ID_PREFIX)
          ? { ...b, review: null }
          : b
      )
    );
  }, []);

  const applyOptimisticExpertSuggestion = useCallback((bookingId: string, text: string) => {
    const now = new Date().toISOString();
    setBookings((prev) =>
      prev.map((b) => {
        if (b.id !== bookingId) return b;
        if (!b.review) {
          return {
            ...b,
            review: {
              id: `${PENDING_REVIEW_ID_PREFIX}${bookingId}`,
              rating: 0,
              comment: null,
              expertSuggestion: text,
              suggestionAt: now,
              createdAt: now,
            },
          };
        }
        return {
          ...b,
          review: {
            ...b.review,
            expertSuggestion: text,
            suggestionAt: now,
          },
        };
      })
    );
  }, []);

  useEffect(() => {
    if (sessionStatus === "loading") return;
    if (!isTelegram && sessionStatus !== "authenticated") {
      setLoading(false);
      return;
    }
    loadDashboard().catch(() => {
      setUserData(null);
      setBookings([]);
      setLoading(false);
    });
  }, [sessionStatus, isTelegram, loadDashboard]);

  if (sessionStatus === "loading" || loading) {
    return (
      <div className="mx-auto flex min-h-screen max-w-lg flex-col items-center justify-center gap-4 p-6">
        <Loader2 className="h-10 w-10 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Loading meetups…</p>
      </div>
    );
  }

  if (!isTelegram && sessionStatus === "unauthenticated") {
    return (
      <div className="mx-auto flex min-h-screen max-w-lg items-center justify-center p-6">
        <Link href="/auth/signin" className="text-sm text-muted-foreground underline">
          Please sign in to view your meetups
        </Link>
      </div>
    );
  }

  const statusVariant = (status: string) => {
    switch (status) {
      case "CONFIRMED": return "default" as const;
      case "COMPLETED": return "secondary" as const;
      case "CANCELLED": return "destructive" as const;
      default: return "outline" as const;
    }
  };

  const now = new Date();
  const activeBookings = bookings
    .filter((b) => b.status !== "CANCELLED" && b.status !== "COMPLETED" && new Date(b.startTime) >= now)
    .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
  const pastBookings = bookings
    .filter((b) => b.status === "CANCELLED" || b.status === "COMPLETED" || new Date(b.startTime) < now)
    .sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());

  return (
    <div className="app-shell mx-auto min-h-screen max-w-lg bg-background">
      <header className="border-b px-4 py-4">
        <div className="flex items-center justify-between">
          <div>
            <button
              onClick={() => router.back()}
              className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors mb-1"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Back
            </button>
            <h1 className="text-xl font-bold">My Meetups</h1>
          </div>
          <UserMenu />
        </div>
      </header>

      <main className="space-y-6 p-4 pb-12">
        {/* One-time merge notice — first visit after signing in with the
            same email a guest booking used. Hidden when bookings.length === 0
            or after the user dismisses it. See src/components/guest-merge-banner.tsx. */}
        <GuestMergeBanner userId={userData?.id} bookingCount={bookings.length} />

        {/* Upcoming Bookings */}
        <section>
          <h2 className="mb-3 text-sm font-medium text-muted-foreground">Upcoming</h2>
          {activeBookings.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center text-sm text-muted-foreground">
                <p className="mb-4">No upcoming meetups</p>
                <Button asChild><Link href="/discover">Chat &amp; match</Link></Button>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {activeBookings.map((b) => {
                const isMenteeForThis = b.founderId === userData?.id;
                return (
                  <BookingCard
                    key={b.id}
                    booking={b}
                    allBookings={bookings}
                    showFounder={!isMenteeForThis}
                    statusVariant={statusVariant}
                    onUpdate={loadDashboard}
                    applyReviewFromApi={applyReviewFromApi}
                    applyOptimisticAppreciation={applyOptimisticAppreciation}
                    revertPendingReviewIfAny={revertPendingReviewIfAny}
                    applyOptimisticExpertSuggestion={applyOptimisticExpertSuggestion}
                    isExpert={!isMenteeForThis}
                    roleLabel={isMenteeForThis ? "Player" : "Coach"}
                  />
                );
              })}
            </div>
          )}
        </section>

        {/* Past Bookings */}
        {pastBookings.length > 0 && (
          <section>
            <h2 className="mb-3 text-sm font-medium text-muted-foreground">Past</h2>
            <div className="space-y-3">
              {pastBookings.map((b) => {
                const isMenteeForThis = b.founderId === userData?.id;
                return (
                  <BookingCard
                    key={b.id}
                    booking={b}
                    allBookings={bookings}
                    showFounder={!isMenteeForThis}
                    statusVariant={statusVariant}
                    showLeaveAppreciation={isMenteeForThis && b.status === "COMPLETED" && !b.review}
                    isExpert={!isMenteeForThis}
                    onUpdate={loadDashboard}
                    applyReviewFromApi={applyReviewFromApi}
                    applyOptimisticAppreciation={applyOptimisticAppreciation}
                    revertPendingReviewIfAny={revertPendingReviewIfAny}
                    applyOptimisticExpertSuggestion={applyOptimisticExpertSuggestion}
                    roleLabel={isMenteeForThis ? "Player" : "Coach"}
                  />
                );
              })}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

/* ============= Booking Card ============= */

const BookingCard = memo(function BookingCard({
  booking,
  allBookings,
  showFounder,
  showLeaveAppreciation,
  statusVariant,
  onUpdate,
  applyReviewFromApi,
  applyOptimisticAppreciation,
  revertPendingReviewIfAny,
  applyOptimisticExpertSuggestion,
  isExpert,
  roleLabel,
}: {
  booking: Booking;
  allBookings: Booking[];
  showFounder?: boolean;
  showLeaveAppreciation?: boolean;
  isExpert?: boolean;
  statusVariant: (s: string) => "default" | "secondary" | "destructive" | "outline";
  onUpdate: () => Promise<void>;
  applyReviewFromApi: (bookingId: string, raw: unknown) => void;
  applyOptimisticAppreciation: (bookingId: string, commentText: string) => void;
  revertPendingReviewIfAny: (bookingId: string) => void;
  applyOptimisticExpertSuggestion: (bookingId: string, text: string) => void;
  roleLabel?: string;
}) {
  const [reviewSyncError, setReviewSyncError] = useState<string | null>(null);
  const dismissReviewSyncError = useCallback(() => setReviewSyncError(null), []);

  const [tonConnectUI] = useTonConnectUI();
  const tonWallet = useTonWallet();
  const [showCancel, setShowCancel] = useState(false);
  const [showReschedule, setShowReschedule] = useState(false);
  const [showLocation, setShowLocation] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [paying, setPaying] = useState(false);
  const [rescheduling, setRescheduling] = useState(false);
  const [rescheduleDate, setRescheduleDate] = useState<Date | undefined>();
  const [rescheduleSlots, setRescheduleSlots] = useState<{ id: string; startTime: string; endTime: string }[]>([]);
  const [selectedRescheduleSlot, setSelectedRescheduleSlot] = useState<{ startTime: string; endTime: string } | null>(null);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [expertSchedule, setExpertSchedule] = useState<Record<string, { start: string; end: string }[]> | null>(null);
  const [savingLocation, setSavingLocation] = useState(false);
  const [locationValue, setLocationValue] = useState(booking.offlineAddress || booking.meetingLink || "");
  const [modalFeedback, setModalFeedback] = useState<ActionFeedback | null>(null);
  const [confirmAction, setConfirmAction] = useState<BookingAction | null>(null);

  const name = showFounder
    ? booking.founder?.nickName || booking.founder?.name || "Founder"
    : booking.expert?.user?.nickName || booking.expert?.user?.name || "Expert";
  const profileExpertId = showFounder
    ? booking.founder?.expert?.id ?? null
    : booking.expert?.id ?? null;
  const isOnline = booking.sessionType === "ONLINE";
  const start = parseISO(booking.startTime);
  const msUntilStart = start.getTime() - Date.now();
  const canModify = booking.status === "PENDING" || booking.status === "CONFIRMED";
  const canRescheduleOrCancel = canModify && msUntilStart >= 2 * 60 * 60 * 1000;
  const canChangeLocation = canModify && (isOnline || msUntilStart >= 60 * 60 * 1000);

  const [actionError, setActionError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const todayRef = useRef(new Date());
  const disablePastDates = useCallback((date: Date) => date < todayRef.current, []);
  const activeModalAction: BookingAction | null = showCancel
    ? "cancel"
    : showReschedule
      ? "reschedule"
      : showLocation
        ? "location"
        : null;
  const selectedRescheduleSummary = selectedRescheduleSlot
    ? `${format(parseISO(selectedRescheduleSlot.startTime), "MMM d, yyyy, h:mm a")} - ${format(parseISO(selectedRescheduleSlot.endTime), "h:mm a")}`
    : "";
  const locationLabel = isOnline ? "meeting link" : "location";
  const resetModalState = () => {
    setModalFeedback(null);
    setConfirmAction(null);
  };
  const openActionDialog = (action: BookingAction) => {
    setActionError(null);
    resetModalState();
    setShowCancel(action === "cancel");
    setShowReschedule(action === "reschedule");
    setShowLocation(action === "location");
  };
  const closeActionDialog = () => {
    setShowCancel(false);
    setShowReschedule(false);
    setShowLocation(false);
    resetModalState();
  };

  const handleDelete = async () => {
    setDeleting(true);
    setActionError(null);
    try {
      const tgHeaders = getHeaders();
      const res = await fetch(`/api/bookings/${booking.id}`, {
        method: "DELETE",
        headers: { ...(tgHeaders || {}) },
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setActionError(d.error || "Delete failed");
        return;
      }
      await onUpdate();
    } catch {
      setActionError("Network error — please try again");
    } finally { setDeleting(false); }
  };

  const isPendingTON =
    booking.status === "PENDING" &&
    booking.paymentMethod === "ton" &&
    booking.paymentStatus === "pending";

  const isPendingPayNow =
    booking.status === "PENDING" &&
    booking.paymentMethod === "paynow" &&
    (booking.paymentStatus === "pending_paynow" ||
      booking.paymentStatus === "submitted_paynow");

  const handleRetryTONPayment = async () => {
    setPaying(true);
    setActionError(null);
    try {
      if (!tonWallet) {
        const connectPromise = tonConnectUI.connectWallet();
        setPaying(false);
        void connectPromise.catch((err) => {
          const message = err instanceof Error ? err.message : "Could not open TON wallet.";
          if (/cancel/i.test(message)) {
            setActionError("Wallet connection was cancelled");
            return;
          }
          setActionError(message);
        });
        return;
      }

      const tgHeaders = getHeaders();
      const res = await fetch("/api/bookings/ton-retry", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(tgHeaders || {}) },
        body: JSON.stringify({ bookingId: booking.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || data.error || "Failed to prepare payment");

      const commentCell = beginCell()
        .storeUint(0, 32)
        .storeStringTail(data.comment)
        .endCell();

      const transaction = {
        validUntil: Math.floor(Date.now() / 1000) + 300,
        messages: [
          {
            address: data.walletAddress,
            amount: data.amountNanoTON,
            payload: commentCell.toBoc().toString("base64"),
          },
        ],
      };

      const result = await tonConnectUI.sendTransaction(
        transaction,
        TELEGRAM_TWA_RETURN_URL && tgHeaders
          ? { twaReturnUrl: TELEGRAM_TWA_RETURN_URL }
          : undefined,
      );

      const confirmRes = await fetch("/api/bookings/ton-confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(tgHeaders || {}) },
        body: JSON.stringify({ bookingId: booking.id, boc: result.boc }),
      });
      const confirmData = await confirmRes.json();
      if (!confirmRes.ok) throw new Error(confirmData.error ?? "Confirmation failed");

      await onUpdate();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Something went wrong";
      if (msg.includes("declined") || msg.includes("cancel")) {
        setActionError("Payment was cancelled");
      } else {
        setActionError(msg);
      }
    } finally {
      setPaying(false);
    }
  };

  const handleCancel = async () => {
    setCancelling(true);
    setModalFeedback({ kind: "info", message: "Cancelling this meetup..." });
    try {
      const tgHeaders = getHeaders();
      const res = await fetch(`/api/bookings/${booking.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...(tgHeaders || {}) },
        body: JSON.stringify({ action: "cancel", reason: cancelReason }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setModalFeedback({ kind: "error", message: d.error || "Cancel failed" });
        return;
      }
      setConfirmAction(null);
      setModalFeedback({ kind: "success", message: "Meetup cancelled. The other party has been notified." });
      await onUpdate();
    } catch {
      setModalFeedback({ kind: "error", message: "Network error — please try again" });
    } finally { setCancelling(false); }
  };

  useEffect(() => {
    if (!showReschedule || !booking.expert?.id) return;
    fetch(`/api/experts/${booking.expert.id}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.weeklySchedule) setExpertSchedule(data.weeklySchedule);
      })
      .catch(() => {});
  }, [showReschedule, booking.expert?.id]);

  useEffect(() => {
    if (!rescheduleDate || !booking.expert?.id) {
      setRescheduleSlots([]);
      setSelectedRescheduleSlot(null);
      return;
    }
    setSlotsLoading(true);
    setSelectedRescheduleSlot(null);

    // Collect the user's other active bookings (both as player and coach) to block those slots
    const userOtherBookings = allBookings.filter(
      (b) =>
        b.id !== booking.id &&
        (b.status === "PENDING" || b.status === "CONFIRMED")
    );

    fetch(`/api/experts/${booking.expert.id}/slots`)
      .then((r) => r.json())
      .then((data) => {
        const list = Array.isArray(data) ? data : data?.slots ?? [];
        // bookedSlots from API covers the expert's side; merge with user's own bookings
        const apiBooked: { startTime: string; endTime: string }[] = data?.bookedSlots ?? [];
        const booked: { startTime: string; endTime: string }[] = [
          ...apiBooked,
          ...userOtherBookings.map((b) => ({ startTime: b.startTime, endTime: b.endTime })),
        ];

        const isOverlapping = (slot: { startTime: string; endTime: string }) => {
          const sS = new Date(slot.startTime).getTime();
          const sE = new Date(slot.endTime).getTime();
          return booked.some((b) => {
            const bS = new Date(b.startTime).getTime();
            const bE = new Date(b.endTime).getTime();
            return sS < bE && sE > bS;
          });
        };

        const forDate = list.filter(
          (s: { startTime: string; endTime: string; isBooked: boolean }) =>
            isSameDay(parseISO(s.startTime), rescheduleDate) && !s.isBooked && !isOverlapping(s)
        );
        if (forDate.length > 0) {
          setRescheduleSlots(forDate);
        } else if (expertSchedule) {
          const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
          const dayKey = DAY_KEYS[rescheduleDate.getDay()];
          const ranges = expertSchedule[dayKey];
          if (ranges && ranges.length > 0) {
            const day = startOfDay(rescheduleDate);
            const now = new Date();
            const generated: typeof rescheduleSlots = [];
            let idx = 0;
            for (const range of ranges) {
              const [sh, sm] = range.start.split(":").map(Number);
              const [eh, em] = range.end.split(":").map(Number);
              let h = sh, m = sm || 0;
              while (h < eh || (h === eh && m < em)) {
                const s = setMinutes(setHours(day, h), m);
                const nextM = m + 30;
                const eH = h + Math.floor(nextM / 60);
                const eM = nextM % 60;
                const e = eH < eh || (eH === eh && eM <= em)
                  ? setMinutes(setHours(day, eH), eM)
                  : setMinutes(setHours(day, eh), em);
                const slot = { id: `rs-${idx++}`, startTime: s.toISOString(), endTime: e.toISOString() };
                if (e > s && s > now && !isOverlapping(slot)) {
                  generated.push(slot);
                }
                h = eH; m = eM;
              }
            }
            setRescheduleSlots(generated);
          } else {
            setRescheduleSlots([]);
          }
        } else {
          setRescheduleSlots([]);
        }
      })
      .catch(() => setRescheduleSlots([]))
      .finally(() => setSlotsLoading(false));
  }, [rescheduleDate, booking.expert?.id, expertSchedule, allBookings, booking.id]);

  const handleReschedule = async () => {
    if (!selectedRescheduleSlot) return;
    setRescheduling(true);
    setModalFeedback({ kind: "info", message: "Rescheduling this meetup..." });
    try {
      const tgHeaders = getHeaders();
      const res = await fetch(`/api/bookings/${booking.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...(tgHeaders || {}) },
        body: JSON.stringify({
          action: "reschedule",
          startTime: selectedRescheduleSlot.startTime,
          endTime: selectedRescheduleSlot.endTime,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setModalFeedback({ kind: "error", message: d.error || "Reschedule failed" });
        return;
      }
      setConfirmAction(null);
      setModalFeedback({ kind: "success", message: "Meetup rescheduled. The other party has been notified." });
      await onUpdate();
    } catch {
      setModalFeedback({ kind: "error", message: "Network error — please try again" });
    } finally { setRescheduling(false); }
  };

  const handleSaveLocation = async () => {
    setSavingLocation(true);
    setModalFeedback({ kind: "info", message: `Saving the ${locationLabel}...` });
    try {
      const tgHeaders = getHeaders();
      const res = await fetch(`/api/bookings/${booking.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...(tgHeaders || {}) },
        body: JSON.stringify({
          action: "update_location",
          ...(isOnline ? { meetingLink: locationValue } : { offlineAddress: locationValue }),
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setModalFeedback({ kind: "error", message: d.error || "Save failed" });
        return;
      }
      setConfirmAction(null);
      setModalFeedback({ kind: "success", message: `${isOnline ? "Meeting link" : "Location"} updated. The other party has been notified.` });
      await onUpdate();
    } catch {
      setModalFeedback({ kind: "error", message: "Network error — please try again" });
    } finally { setSavingLocation(false); }
  };

  return (
    <Card>
      <CardContent className="p-4">
        {actionError && (
          <div className="mb-3 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive flex items-center justify-between">
            <span>{actionError}</span>
            <button onClick={() => setActionError(null)} className="ml-2 text-xs underline">dismiss</button>
          </div>
        )}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="font-medium">
              {profileExpertId ? (
                <Link
                  href={`/experts/${profileExpertId}`}
                  className="inline-flex items-center gap-1 text-primary underline underline-offset-2 decoration-primary/40 hover:decoration-primary focus:outline-none focus:decoration-primary"
                >
                  {name}
                  <ExternalLink className="h-3 w-3 shrink-0 opacity-70" />
                </Link>
              ) : (
                name
              )}
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <span className="flex items-center gap-1"><Calendar className="h-3.5 w-3.5" />{format(start, "MMM d, yyyy")}</span>
              <span className="flex items-center gap-1"><Clock className="h-3.5 w-3.5" />{format(start, "h:mm a")}</span>
              <span className="flex items-center gap-1">
                {isOnline ? <Monitor className="h-3.5 w-3.5" /> : <MapPin className="h-3.5 w-3.5" />}
                {isOnline ? "Online" : "Offline"}
              </span>
            </div>
            {!isOnline && (booking.offlineAddress || booking.meetingLink) && (
              <a
                href={buildGoogleMapsUrl(booking.offlineAddress || booking.meetingLink || "")}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1.5 inline-flex items-start gap-1 text-xs text-primary hover:underline"
              >
                <MapPin className="h-3 w-3 mt-0.5 shrink-0" />
                <span>{booking.offlineAddress || booking.meetingLink}</span>
                <ExternalLink className="mt-0.5 h-3 w-3 shrink-0" />
              </a>
            )}
            {isOnline && booking.meetingLink && (
              <a
                href={booking.meetingLink}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1.5 text-xs text-primary hover:underline flex items-center gap-1"
              >
                <Monitor className="h-3 w-3 shrink-0" />
                <span className="truncate">Join Meeting</span>
                <ExternalLink className="h-3 w-3 shrink-0" />
              </a>
            )}
            {booking.isPremiumLive && isLiveRoomOpen(booking) && (
              <Link
                href={`/consultation/${booking.id}`}
                className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-indigo-300 hover:text-indigo-200"
              >
                <Video className="h-3 w-3 shrink-0" />
                <span className="truncate">Join live consultation</span>
                <ExternalLink className="h-3 w-3 shrink-0" />
              </Link>
            )}
            {booking.cancelReason && <p className="mt-1.5 text-xs text-red-500">Reason: {booking.cancelReason}</p>}
          </div>
          <div className="flex flex-col items-end gap-1">
            <Badge variant={statusVariant(booking.status)}>{booking.status}</Badge>
            {roleLabel && (
              <span className={cn(
                "text-[10px] font-medium px-1.5 py-0.5 rounded-full",
                roleLabel === "Coach"
                  ? "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300"
                  : "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
              )}>
                {roleLabel}
              </span>
            )}
          </div>
        </div>

        {isPendingPayNow && (
          <>
            <Separator className="my-3" />
            <div className="surface-warning rounded-md p-3 text-sm">
              <p className="font-medium text-amber-100">PayNow payment pending confirmation</p>
              <p className="mt-1 text-amber-200/85">
                We are verifying your transfer. Your slot is temporarily held.
              </p>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                className="text-red-600 hover:text-red-700"
                onClick={() => openActionDialog("cancel")}
              >
                <X className="mr-1 h-3.5 w-3.5" />Cancel
              </Button>
            </div>
          </>
        )}

        {isPendingTON && (
          <>
            <Separator className="my-3" />
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                className="gap-1"
                disabled={paying}
                onClick={handleRetryTONPayment}
              >
                {paying ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : !tonWallet ? (
                  <>
                    <Wallet className="h-3.5 w-3.5" />
                    Connect Wallet to Pay
                  </>
                ) : (
                  <>
                    <Wallet className="h-3.5 w-3.5" />
                    Pay Now
                    {booking.depositAmountCents != null && (
                      <span className="ml-1 text-xs opacity-80">
                        ({booking.currency || "SGD"} {(booking.depositAmountCents / 100).toFixed(2)})
                      </span>
                    )}
                  </>
                )}
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="text-red-600 hover:text-red-700"
                onClick={() => openActionDialog("cancel")}
              >
                <X className="mr-1 h-3.5 w-3.5" />Cancel
              </Button>
            </div>
          </>
        )}

        {canModify && !isPendingTON && !isPendingPayNow && (canRescheduleOrCancel || canChangeLocation) && (
          <>
            <Separator className="my-3" />
            <div className="flex flex-wrap gap-2">
              {canRescheduleOrCancel && (
                <Button variant="outline" size="sm" onClick={() => openActionDialog("reschedule")}>
                  <RotateCcw className="mr-1 h-3.5 w-3.5" />Reschedule
                </Button>
              )}
              {canChangeLocation && (
                <Button variant="outline" size="sm" onClick={() => openActionDialog("location")}>
                  <MapPinned className="mr-1 h-3.5 w-3.5" />{isOnline ? "Meeting Link" : "Location"}
                </Button>
              )}
              {canRescheduleOrCancel && (
                <Button variant="outline" size="sm" className="text-red-600 hover:text-red-700" onClick={() => openActionDialog("cancel")}>
                  <X className="mr-1 h-3.5 w-3.5" />Cancel
                </Button>
              )}
            </div>
            {!canRescheduleOrCancel && (
              <p className="mt-1 text-xs text-muted-foreground">Reschedule & cancel disabled — meetup starts within 2 hours</p>
            )}
            {!canChangeLocation && !isOnline && (
              <p className="mt-1 text-xs text-muted-foreground">Location change disabled — meetup starts within 1 hour</p>
            )}
          </>
        )}

        {booking.status === "CANCELLED" && (
          <>
            <Separator className="my-3" />
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:text-red-600"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Trash2 className="mr-1 h-3.5 w-3.5" />}
              Delete
            </Button>
          </>
        )}

        <Dialog open={activeModalAction !== null} onOpenChange={(open) => { if (!open) closeActionDialog(); }}>
          <DialogContent className="max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>
                {activeModalAction === "cancel"
                  ? "Cancel meetup"
                  : activeModalAction === "reschedule"
                    ? "Reschedule meetup"
                    : "Update meetup details"}
              </DialogTitle>
              <DialogDescription>
                {activeModalAction === "cancel"
                  ? "Review the cancellation before it is sent."
                  : activeModalAction === "reschedule"
                    ? "Choose a new available slot, then confirm the change."
                    : `Change the ${locationLabel}, then confirm the update.`}
              </DialogDescription>
            </DialogHeader>

            <ModalFeedback feedback={modalFeedback} />

            {activeModalAction === "cancel" && (
              <div className="space-y-3">
                <Input
                  placeholder="Reason (optional)"
                  value={cancelReason}
                  onChange={(e) => {
                    setCancelReason(e.target.value);
                    resetModalState();
                  }}
                  disabled={cancelling || modalFeedback?.kind === "success"}
                />
                {confirmAction === "cancel" && modalFeedback?.kind !== "success" && (
                  <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                    This will cancel the meetup and notify the other party.
                  </div>
                )}
              </div>
            )}

            {activeModalAction === "reschedule" && (
              <div className="space-y-3">
                <CalendarPicker
                  mode="single"
                  selected={rescheduleDate}
                  onSelect={(date) => {
                    setRescheduleDate(date);
                    resetModalState();
                  }}
                  disabled={disablePastDates}
                  className="rounded-md border"
                />
                {rescheduleDate && (
                  slotsLoading ? (
                    <div className="flex items-center justify-center gap-2 py-3">
                      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                      <span className="text-sm text-muted-foreground">Loading slots...</span>
                    </div>
                  ) : rescheduleSlots.length === 0 ? (
                    <p className="py-2 text-sm text-muted-foreground">No available slots for this date.</p>
                  ) : (
                    <div className="grid grid-cols-3 gap-1.5">
                      {rescheduleSlots.map((slot) => (
                        <button
                          key={slot.id}
                          type="button"
                          disabled={rescheduling || modalFeedback?.kind === "success"}
                          onClick={() => {
                            setSelectedRescheduleSlot(slot);
                            resetModalState();
                          }}
                          className={`rounded-md border px-2 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                            selectedRescheduleSlot?.startTime === slot.startTime
                              ? "border-primary bg-primary text-primary-foreground"
                              : "border-input bg-muted/50 hover:bg-muted"
                          }`}
                        >
                          {format(parseISO(slot.startTime), "h:mm a")}
                        </button>
                      ))}
                    </div>
                  )
                )}
                {confirmAction === "reschedule" && selectedRescheduleSlot && modalFeedback?.kind !== "success" && (
                  <div className="rounded-md border bg-muted/50 p-3 text-sm">
                    Confirm moving this meetup to {selectedRescheduleSummary}?
                  </div>
                )}
              </div>
            )}

            {activeModalAction === "location" && (
              <div className="space-y-3">
                {isOnline ? (
                  <Input
                    placeholder="https://zoom.us/j/..."
                    value={locationValue}
                    onChange={(e) => {
                      setLocationValue(e.target.value);
                      resetModalState();
                    }}
                    disabled={savingLocation || modalFeedback?.kind === "success"}
                  />
                ) : (
                  <AddressAutocompleteInput
                    placeholder="Type 4+ characters (e.g. postal code), then choose an exact address"
                    value={locationValue}
                    onChange={(value) => {
                      setLocationValue(value);
                      resetModalState();
                    }}
                    disabled={savingLocation || modalFeedback?.kind === "success"}
                  />
                )}
                {confirmAction === "location" && modalFeedback?.kind !== "success" && (
                  <div className="rounded-md border bg-muted/50 p-3 text-sm">
                    Confirm this {locationLabel}: {locationValue.trim() || "empty value"}?
                  </div>
                )}
              </div>
            )}

            <DialogFooter>
              {modalFeedback?.kind === "success" ? (
                <Button size="sm" onClick={closeActionDialog}>Done</Button>
              ) : (
                <>
                  <Button size="sm" variant="ghost" onClick={closeActionDialog}>Back</Button>
                  {activeModalAction === "cancel" && (
                    confirmAction === "cancel" ? (
                      <Button size="sm" variant="destructive" onClick={handleCancel} disabled={cancelling}>
                        {cancelling ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Confirm cancel"}
                      </Button>
                    ) : (
                      <Button size="sm" variant="destructive" onClick={() => setConfirmAction("cancel")}>
                        Review cancel
                      </Button>
                    )
                  )}
                  {activeModalAction === "reschedule" && (
                    confirmAction === "reschedule" ? (
                      <Button size="sm" onClick={handleReschedule} disabled={!selectedRescheduleSlot || rescheduling}>
                        {rescheduling ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Confirm reschedule"}
                      </Button>
                    ) : (
                      <Button size="sm" onClick={() => setConfirmAction("reschedule")} disabled={!selectedRescheduleSlot}>
                        Review reschedule
                      </Button>
                    )
                  )}
                  {activeModalAction === "location" && (
                    confirmAction === "location" ? (
                      <Button size="sm" onClick={handleSaveLocation} disabled={savingLocation || locationValue.trim().length === 0}>
                        {savingLocation ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Confirm update"}
                      </Button>
                    ) : (
                      <Button size="sm" onClick={() => setConfirmAction("location")} disabled={locationValue.trim().length === 0}>
                        Review update
                      </Button>
                    )
                  )}
                </>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {showLeaveAppreciation && (
          <PlayerAppreciationForm
            bookingId={booking.id}
            onUpdate={onUpdate}
            onReviewFromApi={(data) => {
              dismissReviewSyncError();
              applyReviewFromApi(booking.id, data);
            }}
            onOptimisticAppreciation={(commentText) =>
              applyOptimisticAppreciation(booking.id, commentText)
            }
            onSubmitFailed={(msg) => {
              revertPendingReviewIfAny(booking.id);
              setReviewSyncError(msg);
            }}
            onDismissReviewSyncError={dismissReviewSyncError}
          />
        )}

        {booking.status === "COMPLETED" && booking.review && (
          <ReviewSuggestionSection
            review={booking.review}
            isExpert={!!isExpert}
            bookingId={booking.id}
            onUpdate={onUpdate}
            onReviewFromApi={(data) => {
              dismissReviewSyncError();
              applyReviewFromApi(booking.id, data);
            }}
            onOptimisticExpertSuggestion={(text) =>
              applyOptimisticExpertSuggestion(booking.id, text)
            }
            onExpertSubmitFailed={(msg) => {
              revertPendingReviewIfAny(booking.id);
              void onUpdate();
              setReviewSyncError(msg);
            }}
            onDismissReviewSyncError={dismissReviewSyncError}
          />
        )}

        {isExpert && booking.status === "COMPLETED" && !booking.review && (
          <ExpertSuggestionForm
            bookingId={booking.id}
            onUpdate={onUpdate}
            onReviewFromApi={(data) => {
              dismissReviewSyncError();
              applyReviewFromApi(booking.id, data);
            }}
            onOptimisticExpertSuggestion={(text) =>
              applyOptimisticExpertSuggestion(booking.id, text)
            }
            onSubmitFailed={(msg) => {
              revertPendingReviewIfAny(booking.id);
              void onUpdate();
              setReviewSyncError(msg);
            }}
            onDismissReviewSyncError={dismissReviewSyncError}
          />
        )}

        {reviewSyncError && (
          <p role="alert" className="mt-3 text-xs text-destructive">
            {reviewSyncError}
          </p>
        )}
      </CardContent>
    </Card>
  );
});

/* ============= Review + Suggestion Section (shown when review exists) ============= */

function ReviewSuggestionSection({
  review,
  isExpert,
  bookingId,
  onUpdate,
  onReviewFromApi,
  onOptimisticExpertSuggestion,
  onExpertSubmitFailed,
  onDismissReviewSyncError,
}: {
  review: BookingReview;
  isExpert: boolean;
  bookingId: string;
  onUpdate: () => Promise<void>;
  onReviewFromApi: (raw: unknown) => void;
  onOptimisticExpertSuggestion: (text: string) => void;
  onExpertSubmitFailed: (msg: string) => void;
  onDismissReviewSyncError: () => void;
}) {
  const hasAppreciation = !!review.comment;
  const reviewSyncPending = review.id.startsWith(PENDING_REVIEW_ID_PREFIX);

  return (
    <>
      <Separator className="my-3" />

      {hasAppreciation && (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <Heart className="h-3.5 w-3.5 shrink-0 text-pink-400" aria-hidden />
              <p className="text-xs font-semibold uppercase tracking-wide text-pink-200/90">
                Player appreciation
              </p>
            </div>
            {reviewSyncPending && review.comment && (
              <span className="text-[10px] font-medium text-muted-foreground">Saving…</span>
            )}
          </div>
          <div
            className={cn(
              "rounded-xl border border-pink-400/25 bg-pink-500/[0.12] px-3 py-2.5 backdrop-blur-sm",
              reviewSyncPending && review.comment && "border-pink-400/35"
            )}
          >
            <p className="text-sm leading-relaxed text-foreground whitespace-pre-wrap">
              {review.comment}
            </p>
          </div>
        </div>
      )}

      {review.expertSuggestion && (
        <div className={cn("space-y-2", hasAppreciation && "mt-4")}>
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <MessageSquarePlus className="h-3.5 w-3.5 shrink-0 text-indigo-400" aria-hidden />
              <p className="text-xs font-semibold uppercase tracking-wide text-indigo-200/90">
                Coach shared follow-up
              </p>
            </div>
            {reviewSyncPending && review.expertSuggestion && (
              <span className="text-[10px] font-medium text-muted-foreground">Saving…</span>
            )}
          </div>
          <div
            className={cn(
              "rounded-xl border border-indigo-400/25 bg-indigo-500/[0.12] px-3 py-2.5 backdrop-blur-sm",
              reviewSyncPending && review.expertSuggestion && "border-indigo-400/35"
            )}
          >
            <p className="text-sm leading-relaxed text-foreground whitespace-pre-wrap">
              {review.expertSuggestion}
            </p>
          </div>
        </div>
      )}

      {isExpert && !review.expertSuggestion && (
        <ExpertSuggestionForm
          bookingId={bookingId}
          onUpdate={onUpdate}
          onReviewFromApi={onReviewFromApi}
          onOptimisticExpertSuggestion={onOptimisticExpertSuggestion}
          onSubmitFailed={onExpertSubmitFailed}
          onDismissReviewSyncError={onDismissReviewSyncError}
        />
      )}
    </>
  );
}

/* ============= Expert Suggestion Form ============= */

function ExpertSuggestionForm({
  bookingId,
  onUpdate,
  onReviewFromApi,
  onOptimisticExpertSuggestion,
  onSubmitFailed,
  onDismissReviewSyncError,
}: {
  bookingId: string;
  onUpdate: () => Promise<void>;
  onReviewFromApi: (raw: unknown) => void;
  onOptimisticExpertSuggestion: (text: string) => void;
  onSubmitFailed: (msg: string) => void;
  onDismissReviewSyncError: () => void;
}) {
  const [showForm, setShowForm] = useState(false);
  const [suggestion, setSuggestion] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!suggestion.trim()) return;
    const trimmed = suggestion.trim();
    setSubmitting(true);
    setError(null);
    onOptimisticExpertSuggestion(trimmed);
    setShowForm(false);
    try {
      const tgHeaders = getHeaders();
      const res = await fetch("/api/reviews", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...(tgHeaders || {}) },
        body: JSON.stringify({ bookingId, expertSuggestion: trimmed }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          typeof data === "object" && data !== null && "error" in data && typeof (data as { error: unknown }).error === "string"
            ? (data as { error: string }).error
            : "Failed to save suggestion"
        );
      }
      onReviewFromApi(data);
      void onUpdate();
    } catch (e) {
      onSubmitFailed(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  };

  if (!showForm) {
    return (
      <>
        <Separator className="my-3" />
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            onDismissReviewSyncError();
            setShowForm(true);
          }}
        >
          <MessageSquarePlus className="mr-1 h-3.5 w-3.5" />
          Share follow-up ideas
        </Button>
      </>
    );
  }

  return (
    <div className="surface-tint mt-3 space-y-2 p-3">
      <p className="text-sm font-medium text-indigo-100">Share follow-up ideas for your player</p>
      <Textarea
        placeholder="Share recommended next steps, resources, or action items..."
        value={suggestion}
        onChange={(e) => setSuggestion(e.target.value)}
        className="min-h-[80px] resize-none bg-background"
        rows={3}
      />
      {error && (
        <p className="text-xs text-destructive">{error}</p>
      )}
      <div className="flex gap-2">
        <Button size="sm" onClick={handleSubmit} disabled={!suggestion.trim() || submitting}>
          {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Save"}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            onDismissReviewSyncError();
            setShowForm(false);
          }}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}

/* ============= Player appreciation (post-meetup) ============= */

function PlayerAppreciationForm({
  bookingId,
  onUpdate,
  onReviewFromApi,
  onOptimisticAppreciation,
  onSubmitFailed,
  onDismissReviewSyncError,
}: {
  bookingId: string;
  onUpdate: () => Promise<void>;
  onReviewFromApi: (raw: unknown) => void;
  onOptimisticAppreciation: (commentText: string) => void;
  onSubmitFailed: (msg: string) => void;
  onDismissReviewSyncError: () => void;
}) {
  const [showForm, setShowForm] = useState(false);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!comment.trim()) return;
    const trimmed = comment.trim();
    setSubmitting(true);
    setError(null);
    onOptimisticAppreciation(trimmed);
    setShowForm(false);
    try {
      const tgHeaders = getHeaders();
      const res = await fetch("/api/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(tgHeaders || {}) },
        body: JSON.stringify({ bookingId, comment: trimmed, rating: 5 }), // Default 5 for appreciation
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          typeof data === "object" && data !== null && "error" in data && typeof (data as { error: unknown }).error === "string"
            ? (data as { error: string }).error
            : "Failed to save appreciation"
        );
      }
      onReviewFromApi(data);
      void onUpdate();
    } catch (e) {
      onSubmitFailed(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  };

  if (!showForm) {
    return (
      <div className="mt-2">
        <Separator className="my-3" />
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            onDismissReviewSyncError();
            setShowForm(true);
          }}
          className="border-pink-400/20 text-pink-200 hover:bg-pink-500/10 hover:text-pink-100"
        >
          <Heart className="mr-1 h-3.5 w-3.5 fill-pink-600" />
          Send Appreciation
        </Button>
      </div>
    );
  }

  return (
    <div className="mt-3 space-y-2 rounded-xl border border-pink-400/25 bg-pink-500/[0.12] p-3 backdrop-blur-sm">
      <div className="flex items-center gap-2">
        <MessageSquareHeart className="h-4 w-4 text-pink-500" />
        <p className="text-sm font-medium text-pink-100">Show your appreciation</p>
      </div>
      <Textarea
        placeholder="What stood out from this meetup? A few words of appreciation go a long way…"
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        className="min-h-[100px] resize-none border-pink-400/20 bg-background/80 focus-visible:ring-pink-400"
        rows={3}
      />
      {error && (
        <p className="text-xs text-destructive">{error}</p>
      )}
      <div className="flex gap-2">
        <Button size="sm" onClick={handleSubmit} disabled={!comment.trim() || submitting} className="bg-pink-600 hover:bg-pink-700 text-white border-none">
          {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Send Appreciation"}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            onDismissReviewSyncError();
            setShowForm(false);
          }}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}
