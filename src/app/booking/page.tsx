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
  Star,
  MessageSquarePlus,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar as CalendarPicker } from "@/components/ui/calendar";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { UserMenu } from "@/components/user-menu";
import { useAuth } from "@/hooks/use-auth";
import { getTelegramInitData } from "@/lib/telegram";
import { cn } from "@/lib/utils";

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
        <p className="text-sm text-muted-foreground">Loading bookings…</p>
      </div>
    );
  }

  if (!isTelegram && sessionStatus === "unauthenticated") {
    return (
      <div className="mx-auto flex min-h-screen max-w-lg items-center justify-center p-6">
        <Link href="/auth/signin" className="text-sm text-muted-foreground underline">
          Please sign in to view your bookings
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
    <div className="mx-auto min-h-screen max-w-lg bg-background">
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
            <h1 className="text-xl font-bold">My Bookings</h1>
          </div>
          <UserMenu />
        </div>
      </header>

      <main className="space-y-6 p-4 pb-12">
        {/* Upcoming Bookings */}
        <section>
          <h2 className="mb-3 text-sm font-medium text-muted-foreground">Upcoming</h2>
          {activeBookings.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center text-sm text-muted-foreground">
                <p className="mb-4">No upcoming bookings</p>
                <Button asChild><Link href="/discover">Chat &amp; match</Link></Button>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {activeBookings.map((b) => {
                const isMenteeForThis = b.founderId === userData?.id;
                return (
                  <BookingCard key={b.id} booking={b} showFounder={!isMenteeForThis} statusVariant={statusVariant} onUpdate={loadDashboard} currentUserId={userData?.id} isExpert={!isMenteeForThis} roleLabel={isMenteeForThis ? "Learner" : "Mentor"} />
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
                    key={b.id} booking={b} showFounder={!isMenteeForThis} statusVariant={statusVariant}
                    showLeaveReview={isMenteeForThis && b.status === "COMPLETED" && !b.review}
                    isExpert={!isMenteeForThis}
                    onUpdate={loadDashboard}
                    currentUserId={userData?.id}
                    roleLabel={isMenteeForThis ? "Learner" : "Mentor"}
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
  booking, showFounder, showLeaveReview, statusVariant, onUpdate, currentUserId, isExpert, roleLabel,
}: {
  booking: Booking;
  showFounder?: boolean;
  showLeaveReview?: boolean;
  isExpert?: boolean;
  statusVariant: (s: string) => "default" | "secondary" | "destructive" | "outline";
  onUpdate: () => Promise<void>;
  currentUserId?: string;
  roleLabel?: string;
}) {
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

  const name = showFounder
    ? booking.founder?.nickName || booking.founder?.name || "Founder"
    : booking.expert?.user?.nickName || booking.expert?.user?.name || "Expert";
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

  const isRemainderDue = booking.paymentStatus === "remainder_due" && booking.founderId === currentUserId;

  const handlePayRemainder = async () => {
    setPaying(true);
    setActionError(null);
    try {
      const tgHeaders = getHeaders();
      const res = await fetch(`/api/bookings/${booking.id}/pay-remainder`, {
        method: "POST",
        headers: { ...(tgHeaders || {}) },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || data.error || "Failed to create payment");
      if (data.alreadyPaid) {
        await onUpdate();
        return;
      }
      if (data.checkoutUrl) {
        window.location.href = data.checkoutUrl;
      }
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setPaying(false);
    }
  };

  const handleRetryTONPayment = async () => {
    setPaying(true);
    setActionError(null);
    try {
      if (!tonWallet) {
        await tonConnectUI.openModal();
        setPaying(false);
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

      const result = await tonConnectUI.sendTransaction(transaction);

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
    setActionError(null);
    try {
      const tgHeaders = getHeaders();
      const res = await fetch(`/api/bookings/${booking.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...(tgHeaders || {}) },
        body: JSON.stringify({ action: "cancel", reason: cancelReason }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setActionError(d.error || "Cancel failed");
        return;
      }
      setShowCancel(false);
      await onUpdate();
    } catch {
      setActionError("Network error — please try again");
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

    fetch(`/api/experts/${booking.expert.id}/slots`)
      .then((r) => r.json())
      .then((data) => {
        const list = Array.isArray(data) ? data : data?.slots ?? [];
        const booked: { startTime: string; endTime: string }[] = data?.bookedSlots ?? [];

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
  }, [rescheduleDate, booking.expert?.id, expertSchedule]);

  const handleReschedule = async () => {
    if (!selectedRescheduleSlot) return;
    setRescheduling(true);
    setActionError(null);
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
        setActionError(d.error || "Reschedule failed");
        return;
      }
      setShowReschedule(false);
      await onUpdate();
    } catch {
      setActionError("Network error — please try again");
    } finally { setRescheduling(false); }
  };

  const handleSaveLocation = async () => {
    setSavingLocation(true);
    setActionError(null);
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
        setActionError(d.error || "Save failed");
        return;
      }
      setShowLocation(false);
      await onUpdate();
    } catch {
      setActionError("Network error — please try again");
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
            <p className="font-medium">{name}</p>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <span className="flex items-center gap-1"><Calendar className="h-3.5 w-3.5" />{format(start, "MMM d, yyyy")}</span>
              <span className="flex items-center gap-1"><Clock className="h-3.5 w-3.5" />{format(start, "h:mm a")}</span>
              <span className="flex items-center gap-1">
                {isOnline ? <Monitor className="h-3.5 w-3.5" /> : <MapPin className="h-3.5 w-3.5" />}
                {isOnline ? "Online" : "Offline"}
              </span>
            </div>
            {!isOnline && (booking.offlineAddress || booking.meetingLink) && (
              <p className="mt-1.5 text-xs text-muted-foreground flex items-start gap-1">
                <MapPin className="h-3 w-3 mt-0.5 shrink-0" /><span>{booking.offlineAddress || booking.meetingLink}</span>
              </p>
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
            {booking.cancelReason && <p className="mt-1.5 text-xs text-red-500">Reason: {booking.cancelReason}</p>}
          </div>
          <div className="flex flex-col items-end gap-1">
            <Badge variant={statusVariant(booking.status)}>{booking.status}</Badge>
            {roleLabel && (
              <span className={cn(
                "text-[10px] font-medium px-1.5 py-0.5 rounded-full",
                roleLabel === "Mentor"
                  ? "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300"
                  : "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
              )}>
                {roleLabel}
              </span>
            )}
          </div>
        </div>

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
                onClick={() => { setShowCancel(!showCancel); setShowReschedule(false); setShowLocation(false); }}
              >
                <X className="mr-1 h-3.5 w-3.5" />Cancel
              </Button>
            </div>
          </>
        )}

        {isRemainderDue && (
          <>
            <Separator className="my-3" />
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                className="gap-1"
                disabled={paying}
                onClick={handlePayRemainder}
              >
                {paying ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <>
                    <Wallet className="h-3.5 w-3.5" />
                    Pay Remainder
                    {booking.totalAmountCents != null && booking.depositAmountCents != null && (
                      <span className="ml-1 text-xs opacity-80">
                        ({booking.currency || "SGD"}{" "}
                        {((booking.totalAmountCents - booking.depositAmountCents) / 100).toFixed(2)})
                      </span>
                    )}
                  </>
                )}
              </Button>
              <span className="text-xs text-amber-600 dark:text-amber-400">
                Remainder payment due
              </span>
            </div>
          </>
        )}

        {canModify && !isPendingTON && (canRescheduleOrCancel || canChangeLocation) && (
          <>
            <Separator className="my-3" />
            <div className="flex flex-wrap gap-2">
              {canRescheduleOrCancel && (
                <Button variant="outline" size="sm" onClick={() => { setShowReschedule(!showReschedule); setShowCancel(false); setShowLocation(false); }}>
                  <RotateCcw className="mr-1 h-3.5 w-3.5" />Reschedule
                </Button>
              )}
              {canChangeLocation && (
                <Button variant="outline" size="sm" onClick={() => { setShowLocation(!showLocation); setShowCancel(false); setShowReschedule(false); }}>
                  <MapPinned className="mr-1 h-3.5 w-3.5" />{isOnline ? "Meeting Link" : "Location"}
                </Button>
              )}
              {canRescheduleOrCancel && (
                <Button variant="outline" size="sm" className="text-red-600 hover:text-red-700" onClick={() => { setShowCancel(!showCancel); setShowReschedule(false); setShowLocation(false); }}>
                  <X className="mr-1 h-3.5 w-3.5" />Cancel
                </Button>
              )}
            </div>
            {!canRescheduleOrCancel && (
              <p className="mt-1 text-xs text-muted-foreground">Reschedule & cancel disabled — booking starts within 2 hours</p>
            )}
            {!canChangeLocation && !isOnline && (
              <p className="mt-1 text-xs text-muted-foreground">Location change disabled — booking starts within 1 hour</p>
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

        {showCancel && (
          <div className="mt-3 space-y-2 rounded-lg border border-red-200 bg-red-50 dark:bg-red-950/20 dark:border-red-900 p-3">
            <p className="text-sm font-medium text-red-700 dark:text-red-400">Cancel this booking?</p>
            <Input placeholder="Reason (optional)" value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} />
            <div className="flex gap-2">
              <Button size="sm" variant="destructive" onClick={handleCancel} disabled={cancelling}>
                {cancelling ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Confirm Cancel"}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setShowCancel(false)}>Back</Button>
            </div>
          </div>
        )}

        {showReschedule && (
          <div className="mt-3 space-y-3 rounded-lg border p-3">
            <p className="text-sm font-medium">Pick a new date & time</p>
            <CalendarPicker mode="single" selected={rescheduleDate} onSelect={setRescheduleDate} disabled={disablePastDates} className="rounded-md border" />
            {rescheduleDate && (
              slotsLoading ? (
                <div className="flex items-center gap-2 py-3 justify-center">
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">Loading slots...</span>
                </div>
              ) : rescheduleSlots.length === 0 ? (
                <p className="text-sm text-muted-foreground py-2">No available slots for this date.</p>
              ) : (
                <div className="grid grid-cols-3 gap-1.5">
                  {rescheduleSlots.map((slot) => (
                    <button
                      key={slot.id}
                      type="button"
                      onClick={() => setSelectedRescheduleSlot(slot)}
                      className={`rounded-md border px-2 py-1.5 text-xs font-medium transition-colors ${
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
            <div className="flex gap-2">
              <Button size="sm" onClick={handleReschedule} disabled={!selectedRescheduleSlot || rescheduling}>
                {rescheduling ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Confirm Reschedule"}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setShowReschedule(false)}>Back</Button>
            </div>
          </div>
        )}

        {showLocation && (
          <div className="mt-3 space-y-2 rounded-lg border p-3">
            <p className="text-sm font-medium">{isOnline ? "Meeting Link" : "Address"}</p>
            <Input placeholder={isOnline ? "https://zoom.us/j/..." : "123 Main St, Singapore"} value={locationValue} onChange={(e) => setLocationValue(e.target.value)} />
            <div className="flex gap-2">
              <Button size="sm" onClick={handleSaveLocation} disabled={savingLocation}>
                {savingLocation ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Save"}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setShowLocation(false)}>Back</Button>
            </div>
          </div>
        )}

        {showLeaveReview && (
          <><Separator className="my-3" /><Button variant="outline" size="sm" asChild><Link href={`/reviews/${booking.id}`}><Star className="mr-1 h-3.5 w-3.5" />Leave Review</Link></Button></>
        )}

        {booking.status === "COMPLETED" && booking.review && (
          <ReviewSuggestionSection review={booking.review} isExpert={!!isExpert} bookingId={booking.id} onUpdate={onUpdate} />
        )}

        {isExpert && booking.status === "COMPLETED" && !booking.review && (
          <ExpertSuggestionForm bookingId={booking.id} onUpdate={onUpdate} />
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
}: {
  review: BookingReview;
  isExpert: boolean;
  bookingId: string;
  onUpdate: () => Promise<void>;
}) {
  const hasRating = review.rating > 0;

  return (
    <>
      <Separator className="my-3" />

      {hasRating && (
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">Mentee Review</p>
          <div className="flex items-center gap-1">
            {[1, 2, 3, 4, 5].map((i) => (
              <Star
                key={i}
                className={cn(
                  "h-3.5 w-3.5",
                  i <= review.rating ? "fill-amber-400 text-amber-400" : "text-muted-foreground/40"
                )}
              />
            ))}
          </div>
          {review.comment && (
            <p className="text-sm text-muted-foreground">{review.comment}</p>
          )}
        </div>
      )}

      {review.expertSuggestion && (
        <div className={cn("space-y-1.5", hasRating && "mt-3")}>
          <p className="text-xs font-medium text-muted-foreground">Mentor&apos;s Next-Step Suggestion</p>
          <div className="rounded-lg bg-blue-50 dark:bg-blue-950/30 px-3 py-2">
            <p className="text-sm text-foreground">{review.expertSuggestion}</p>
          </div>
        </div>
      )}

      {isExpert && !review.expertSuggestion && (
        <ExpertSuggestionForm bookingId={bookingId} onUpdate={onUpdate} />
      )}
    </>
  );
}

/* ============= Expert Suggestion Form ============= */

function ExpertSuggestionForm({
  bookingId,
  onUpdate,
}: {
  bookingId: string;
  onUpdate: () => Promise<void>;
}) {
  const [showForm, setShowForm] = useState(false);
  const [suggestion, setSuggestion] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!suggestion.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const tgHeaders = getHeaders();
      const res = await fetch("/api/reviews", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...(tgHeaders || {}) },
        body: JSON.stringify({ bookingId, expertSuggestion: suggestion.trim() }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to save suggestion");
      }
      setShowForm(false);
      await onUpdate();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  };

  if (!showForm) {
    return (
      <>
        <Separator className="my-3" />
        <Button variant="outline" size="sm" onClick={() => setShowForm(true)}>
          <MessageSquarePlus className="mr-1 h-3.5 w-3.5" />
          Add Next-Step Suggestion
        </Button>
      </>
    );
  }

  return (
    <div className="mt-3 space-y-2 rounded-lg border p-3">
      <p className="text-sm font-medium">Next-Step Suggestion for Mentee</p>
      <Textarea
        placeholder="Share recommended next steps, resources, or action items..."
        value={suggestion}
        onChange={(e) => setSuggestion(e.target.value)}
        className="min-h-[80px] resize-none"
        rows={3}
      />
      {error && (
        <p className="text-xs text-destructive">{error}</p>
      )}
      <div className="flex gap-2">
        <Button size="sm" onClick={handleSubmit} disabled={!suggestion.trim() || submitting}>
          {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Save Suggestion"}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setShowForm(false)}>Cancel</Button>
      </div>
    </div>
  );
}
