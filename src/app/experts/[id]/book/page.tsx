"use client";

import { useCallback, useEffect, useMemo, useState, startTransition } from "react";

import { useParams, useRouter, useSearchParams } from "next/navigation";

import { beginCell } from "@ton/core";
import { useTonConnectUI, useTonWallet } from "@tonconnect/ui-react";
import { format, isSameDay, parseISO, setHours, setMinutes, startOfDay } from "date-fns";
import {
  Monitor,
  MapPin,
  Loader2,
  ArrowLeft,
  Wallet,
  XCircle,
} from "lucide-react";

import { useTelegram } from "@/components/telegram-provider";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { AddressAutocompleteInput } from "@/components/address-autocomplete-input";
import { UserMenu } from "@/components/user-menu";
import { buildGoogleMapsUrl } from "@/lib/google-maps";
import { getTelegramInitData } from "@/lib/telegram";
import { cn } from "@/lib/utils";

type SessionType = "ONLINE" | "OFFLINE";

interface AvailableSlot {
  id: string;
  startTime: string;
  endTime: string;
  isBooked: boolean;
}

interface DefaultSlot {
  id: string;
  startTime: string;
  endTime: string;
}

interface BookedSlot {
  startTime: string;
  endTime: string;
}

type TimeRange = { start: string; end: string };
type WeeklySchedule = Record<string, TimeRange[]>;

function isSlotBooked(slot: { startTime: string; endTime: string }, bookedSlots: BookedSlot[]): boolean {
  const sStart = new Date(slot.startTime).getTime();
  const sEnd = new Date(slot.endTime).getTime();
  return bookedSlots.some((b) => {
    const bStart = new Date(b.startTime).getTime();
    const bEnd = new Date(b.endTime).getTime();
    return sStart < bEnd && sEnd > bStart;
  });
}

const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

function generateSlotsFromSchedule(date: Date, schedule: WeeklySchedule | null): DefaultSlot[] {
  if (!schedule) return [];

  const dayKey = DAY_KEYS[date.getDay()];
  const ranges = schedule?.[dayKey];
  if (!ranges || ranges.length === 0) return [];

  const day = startOfDay(date);
  const slots: DefaultSlot[] = [];
  let slotIdx = 0;

  for (const range of ranges) {
    const [sh, sm] = range.start.split(":").map(Number);
    const [eh, em] = range.end.split(":").map(Number);
    let h = sh;
    let m = sm || 0;

    while (h < eh || (h === eh && m < em)) {
      const start = setMinutes(setHours(day, h), m);
      const nextM = m + 30;
      const endH = h + Math.floor(nextM / 60);
      const endM = nextM % 60;
      const end = endH < eh || (endH === eh && endM <= em)
        ? setMinutes(setHours(day, endH), endM)
        : setMinutes(setHours(day, eh), em);

      if (end > start) {
        slots.push({
          id: `sched-${slotIdx++}`,
          startTime: start.toISOString(),
          endTime: end.toISOString(),
        });
      }

      h = endH;
      m = endM;
    }
  }

  return slots;
}

export default function BookSessionPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { isTelegram } = useTelegram();
  const expertId = params.id as string;

  const [sessionType, setSessionType] = useState<SessionType>("ONLINE");
  const [selectedDate, setSelectedDate] = useState<Date | undefined>();
  const [selectedSlots, setSelectedSlots] = useState<(DefaultSlot | AvailableSlot)[]>([]);
  const [slots, setSlots] = useState<(DefaultSlot | AvailableSlot)[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [offlineAddress, setOfflineAddress] = useState("");
  const [expertPricing, setExpertPricing] = useState<{
    priceOnlineCents: number | null;
    priceOfflineCents: number | null;
    currency: string;
    expertName: string;
  } | null>(null);
  const [weeklySchedule, setWeeklySchedule] = useState<WeeklySchedule | null>(null);
  const [tonConnectUI] = useTonConnectUI();
  const tonWallet = useTonWallet();
  const [tonPending, setTonPending] = useState<{
    bookingId: string;
    depositTON: string;
    depositSGD: string;
  } | null>(null);
  const telegramInitData = getTelegramInitData();
  const isTelegramSurface = isTelegram || Boolean(telegramInitData);

  const timezone =
    typeof Intl !== "undefined"
      ? Intl.DateTimeFormat().resolvedOptions().timeZone
      : "UTC";

  const todayStart = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);
  const isDateDisabled = useCallback(
    (date: Date) => date < todayStart,
    [todayStart]
  );

  useEffect(() => {
    if (!expertId) return;
    fetch(`/api/experts/${expertId}`)
      .then((r) => r.json())
      .then((data) => {
        setExpertPricing({
          priceOnlineCents: data.priceOnlineCents ?? null,
          priceOfflineCents: data.priceOfflineCents ?? null,
          currency: data.currency ?? "SGD",
          expertName: data.user?.nickName || data.user?.name || "Expert",
        });
        if (data.weeklySchedule) {
          setWeeklySchedule(data.weeklySchedule as WeeklySchedule);
        }
      })
      .catch(() => {});
  }, [expertId]);

  const pricePerHour =
    sessionType === "OFFLINE"
      ? expertPricing?.priceOfflineCents
      : expertPricing?.priceOnlineCents;

  const sortedSelected = [...selectedSlots].sort(
    (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
  );
  const mergedStart = sortedSelected.length > 0 ? sortedSelected[0].startTime : null;
  const mergedEnd = sortedSelected.length > 0 ? sortedSelected[sortedSelected.length - 1].endTime : null;

  const slotDurationMinutes = mergedStart && mergedEnd
    ? Math.max(30, Math.round((new Date(mergedEnd).getTime() - new Date(mergedStart).getTime()) / (60 * 1000)))
    : 30;

  const totalCents = pricePerHour ? Math.round(pricePerHour * slotDurationMinutes / 60) : 0;
  const depositCents = Math.ceil(totalCents / 2);
  const remainderCents = totalCents - depositCents;

  const typeFromUrl = searchParams.get("type");
  useEffect(() => {
    if (typeFromUrl === "ONLINE" || typeFromUrl === "OFFLINE") {
      setSessionType(typeFromUrl);
    }
  }, [typeFromUrl]);

  const updateTypeParam = useCallback(
    (type: SessionType) => {
      const url = new URL(window.location.href);
      url.searchParams.set("type", type);
      window.history.replaceState({}, "", url.toString());
    },
    []
  );

  const handleSessionTypeChange = (type: SessionType) => {
    setSessionType(type);
    setSelectedSlots([]);
    updateTypeParam(type);
  };

  useEffect(() => {
    if (!expertId || !selectedDate) {
      setSlots([]);
      return;
    }
    let cancelled = false;
    setSlotsLoading(true);
    setSlots([]);
    setSelectedSlots([]);

    fetch(`/api/experts/${expertId}/slots`)
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        const list = Array.isArray(data) ? data : data?.slots ?? [];
        const booked: BookedSlot[] = data?.bookedSlots ?? [];
        const now = new Date();

        // Explicit AvailableSlot records for this date
        const explicitSlots = list.filter(
          (s: AvailableSlot) => isSameDay(parseISO(s.startTime), selectedDate) && !s.isBooked
        );

        if (explicitSlots.length > 0) {
          setSlots(explicitSlots.filter((s: AvailableSlot) => !isSlotBooked(s, booked)));
        } else {
          const schedSlots = generateSlotsFromSchedule(selectedDate, weeklySchedule).filter(
            (s) => new Date(s.startTime) > now && !isSlotBooked(s, booked)
          );
          setSlots(schedSlots);
        }
      })
      .catch(() => {
        if (!cancelled) {
          const now = new Date();
          const schedSlots = generateSlotsFromSchedule(selectedDate, weeklySchedule).filter(
            (s) => new Date(s.startTime) > now
          );
          setSlots(schedSlots);
        }
      })
      .finally(() => {
        if (!cancelled) setSlotsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [expertId, selectedDate, weeklySchedule]);

  const bookingPayload = () => ({
    expertId,
    sessionType,
    startTime: mergedStart!,
    endTime: mergedEnd!,
    timezone,
    ...(sessionType === "OFFLINE" && offlineAddress.trim() && { offlineAddress: offlineAddress.trim() }),
  });

  const handleStripeCheckout = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/bookings/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(bookingPayload()),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || data.error || "Failed to create checkout");
      if (data.checkoutUrl) {
        window.location.href = data.checkoutUrl;
      } else {
        throw new Error("No checkout URL returned");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      setSubmitting(false);
    }
  };

  const handleTONPayment = async () => {
    setSubmitting(true);
    setError(null);
    let createdBookingId: string | null = null;
    try {
      // Connect wallet if not already connected
      if (!tonWallet) {
        await tonConnectUI.openModal();
        setSubmitting(false);
        return;
      }

      const res = await fetch("/api/bookings/ton-payment", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(telegramInitData ? { "x-telegram-init-data": telegramInitData } : {}),
        },
        body: JSON.stringify(bookingPayload()),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || data.error || "Failed to create TON payment");

      createdBookingId = data.bookingId;
      setTonPending({
        bookingId: data.bookingId,
        depositTON: data.depositTON,
        depositSGD: data.depositSGD,
      });

      const commentCell = beginCell()
        .storeUint(0, 32)
        .storeStringTail(data.comment)
        .endCell();

      console.log("[TON] walletAddress from API:", JSON.stringify(data.walletAddress), "len:", data.walletAddress?.length);

      const payload = commentCell.toBoc().toString("base64");
      const transaction = {
        validUntil: Math.floor(Date.now() / 1000) + 300,
        messages: [
          {
            address: data.walletAddress,
            amount: data.amountNanoTON,
            payload,
          },
        ],
      };
      console.log("[TON] transaction:", JSON.stringify(transaction));

      const result = await tonConnectUI.sendTransaction(transaction);

      // Transaction signed — confirm booking with BOC proof
      const confirmRes = await fetch("/api/bookings/ton-confirm", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(telegramInitData ? { "x-telegram-init-data": telegramInitData } : {}),
        },
        body: JSON.stringify({
          bookingId: data.bookingId,
          boc: result.boc,
        }),
      });
      const confirmData = await confirmRes.json();
      if (!confirmRes.ok) throw new Error(confirmData.error ?? "Confirmation failed");

      router.push("/booking");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Something went wrong";
      if (msg.includes("declined") || msg.includes("cancel")) {
        if (createdBookingId) {
          fetch(`/api/bookings/${createdBookingId}`, {
            method: "PATCH",
            headers: {
              "Content-Type": "application/json",
              ...(telegramInitData ? { "x-telegram-init-data": telegramInitData } : {}),
            },
            body: JSON.stringify({ action: "cancel", reason: "Wallet declined" }),
          }).catch(() => {});
        }
        setError("Payment was cancelled");
        setTonPending(null);
      } else {
        setError(msg);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleTonCancel = async () => {
    if (!tonPending) return;
    try {
      await fetch(`/api/bookings/${tonPending.bookingId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...(telegramInitData ? { "x-telegram-init-data": telegramInitData } : {}),
        },
        body: JSON.stringify({ action: "cancel", reason: "Payment not completed" }),
      });
    } catch {
      // best-effort cancel
    }
    setTonPending(null);
  };

  const handleFreeBooking = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/bookings/free", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(telegramInitData ? { "x-telegram-init-data": telegramInitData } : {}),
        },
        body: JSON.stringify(bookingPayload()),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to schedule meetup");
      router.push("/booking");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  };

  const handleConfirm = () => {
    if (selectedSlots.length === 0 || !expertId) return;
    if (pricePerHour == null) {
      setError("This advisor has not set pricing for this session type.");
      return;
    }
    if (totalCents === 0) {
      handleFreeBooking();
      return;
    }
    if (!isTelegramSurface) {
      handleStripeCheckout();
    }
  };

  const canConfirm =
    !!selectedDate &&
    selectedSlots.length > 0 &&
    !submitting;

  return (
    <div className="app-shell mx-auto min-h-screen max-w-lg bg-background">
      <header className="sticky top-0 z-10 border-b bg-background/95 px-4 py-4 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="flex items-center justify-between">
          <div>
            <button
              onClick={() => router.back()}
              className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors mb-1"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Back
            </button>
            <h1 className="text-lg font-semibold">Schedule a meetup</h1>
          </div>
          <UserMenu />
        </div>
      </header>

      <main className="space-y-6 p-4 pb-8">
        <section>
          <h2 className="mb-3 text-sm font-medium text-muted-foreground">
            Session type
          </h2>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => handleSessionTypeChange("ONLINE")}
              className={cn(
                "flex min-h-[48px] flex-1 items-center justify-center gap-2 rounded-lg border text-sm font-medium transition-colors",
                sessionType === "ONLINE"
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-input bg-muted/50 text-muted-foreground hover:bg-muted"
              )}
            >
              <Monitor className="h-4 w-4" />
              Online
            </button>
            <button
              type="button"
              onClick={() => handleSessionTypeChange("OFFLINE")}
              className={cn(
                "flex min-h-[48px] flex-1 items-center justify-center gap-2 rounded-lg border text-sm font-medium transition-colors",
                sessionType === "OFFLINE"
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-input bg-muted/50 text-muted-foreground hover:bg-muted"
              )}
            >
              <MapPin className="h-4 w-4" />
              Offline
            </button>
          </div>
        </section>

        {sessionType === "ONLINE" && (
          <section>
            <div className="surface-tint rounded-lg px-4 py-3 text-sm">
              <Monitor className="inline h-4 w-4 mr-1.5 -mt-0.5" />
              A video meeting link will be generated automatically when your meetup is confirmed.
            </div>
          </section>
        )}

        {sessionType === "OFFLINE" && (
          <section>
            <h2 className="mb-3 text-sm font-medium text-muted-foreground">
              Meeting address <span className="text-xs text-muted-foreground/70">(optional — can add later)</span>
            </h2>
            <AddressAutocompleteInput
              value={offlineAddress}
              onChange={setOfflineAddress}
              placeholder="Type at least 4 characters (e.g. postal code or street), then pick a suggestion"
              className="min-h-[44px]"
            />
            {offlineAddress.trim() && (
              <a
                href={buildGoogleMapsUrl(offlineAddress.trim())}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 inline-flex items-center gap-1 text-xs text-primary hover:underline"
              >
                <MapPin className="h-3.5 w-3.5" />
                Preview in Google Maps
              </a>
            )}
          </section>
        )}

        <section>
          <h2 className="mb-3 text-sm font-medium text-muted-foreground">
            Select date
          </h2>
          <div className="flex justify-center">
            <Calendar
              mode="single"
              selected={selectedDate}
              onSelect={(d) => startTransition(() => setSelectedDate(d))}
              disabled={isDateDisabled}
            />
          </div>
        </section>

        <section>
          <h2 className="mb-3 text-sm font-medium text-muted-foreground">
            Available times
          </h2>
          <p className="mb-2 text-xs text-muted-foreground">
            Times shown in {timezone} · 30 min per slot · select consecutive slots for longer meetups
          </p>
          {!selectedDate ? (
            <p className="rounded-lg border border-dashed border-muted-foreground/30 py-8 text-center text-sm text-muted-foreground">
              Select a date to see available slots
            </p>
          ) : slotsLoading ? (
            <div className="flex items-center justify-center gap-2 py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              <span className="text-sm text-muted-foreground">
                Loading slots...
              </span>
            </div>
          ) : slots.length === 0 ? (
            <p className="rounded-lg border border-dashed border-muted-foreground/30 py-8 text-center text-sm text-muted-foreground">
              No available slots for this date. Try another date.
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {slots.map((slot) => {
                const isSelected = selectedSlots.some((s) => s.id === slot.id);
                return (
                  <button
                    key={slot.id}
                    type="button"
                    onClick={() => startTransition(() => {
                      setSelectedSlots((prev) => {
                        if (isSelected) {
                          const without = prev.filter((s) => s.id !== slot.id);
                          if (without.length === 0) return [];
                          const sorted = [...without].sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
                          const contiguous: typeof sorted = [sorted[0]];
                          for (let i = 1; i < sorted.length; i++) {
                            if (new Date(sorted[i].startTime).getTime() === new Date(sorted[i - 1].endTime).getTime()) {
                              contiguous.push(sorted[i]);
                            } else break;
                          }
                          return contiguous;
                        }
                        const next = [...prev, slot].sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
                        for (let i = 1; i < next.length; i++) {
                          if (new Date(next[i].startTime).getTime() !== new Date(next[i - 1].endTime).getTime()) {
                            return [slot];
                          }
                        }
                        return next;
                      });
                    })}
                    className={cn(
                      "min-h-[48px] rounded-lg border text-sm font-medium transition-colors",
                      isSelected
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-input bg-muted/50 hover:bg-muted"
                    )}
                  >
                    {format(parseISO(slot.startTime), "h:mm a")}
                  </button>
                );
              })}
            </div>
          )}
        </section>

        {selectedSlots.length > 0 && (
          <section className="surface-tint space-y-2 p-4">
            <h3 className="font-semibold text-sm">
              {totalCents > 0 ? "Payment Summary" : "Meetup summary"}
            </h3>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">
                {totalCents > 0
                  ? `${expertPricing?.currency || "SGD"} ${((pricePerHour || 0) / 100).toFixed(2)}/hr × ${slotDurationMinutes} min`
                  : `${slotDurationMinutes} min meetup`}
              </span>
              <span className="font-medium">
                {totalCents > 0
                  ? `${expertPricing?.currency || "SGD"} ${(totalCents / 100).toFixed(2)}`
                  : "Free"}
              </span>
            </div>
            {totalCents > 0 && (
              <>
                <hr className="border-indigo-300/20" />
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Deposit (50%) — due now</span>
                  <span className="font-bold text-indigo-100">
                    {expertPricing?.currency || "SGD"} {(depositCents / 100).toFixed(2)}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Remainder — charged 24h after meetup</span>
                  <span className="text-muted-foreground">
                    {expertPricing?.currency || "SGD"} {(remainderCents / 100).toFixed(2)}
                  </span>
                </div>
              </>
            )}
            {totalCents === 0 && (
              <div className="surface-success rounded-lg px-3 py-2 text-sm">
                This meetup is free. We skip deposit language here and confirm it directly.
              </div>
            )}
          </section>
        )}

        {error && (
          <p className="rounded-lg bg-destructive/10 px-4 py-2 text-sm text-destructive">
            {error}
          </p>
        )}

        {tonPending && !submitting ? (
          <div className="surface-tint space-y-3 rounded-lg p-4">
            <div className="text-center space-y-1">
              <Loader2 className="h-8 w-8 mx-auto text-indigo-600 animate-spin" />
              <h3 className="font-semibold text-base">Waiting for payment</h3>
              <p className="text-sm text-muted-foreground">
                <span className="font-mono font-bold">{tonPending.depositTON} TON</span>{" "}
                (≈ SGD {tonPending.depositSGD})
              </p>
              <p className="text-xs text-muted-foreground">
                Approve the transaction in your wallet
              </p>
            </div>
            <Button variant="ghost" size="sm" className="w-full text-muted-foreground gap-1" onClick={handleTonCancel}>
              <XCircle className="h-4 w-4" />
              Cancel
            </Button>
          </div>
        ) : isTelegramSurface && totalCents > 0 && !submitting ? (
          <div className="space-y-2">
            <Button
              size="lg"
              className="w-full min-h-[52px] text-base font-semibold gap-2"
              disabled={!canConfirm}
              onClick={handleTONPayment}
            >
              {submitting ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : !tonWallet ? (
                <>
                  <Wallet className="h-5 w-5" />
                  Connect Wallet to Pay
                </>
              ) : (
                <>
                  <Wallet className="h-5 w-5" />
                  Pay with TON — {expertPricing?.currency || "SGD"}{" "}
                  {(depositCents / 100).toFixed(2)}
                </>
              )}
            </Button>
          </div>
        ) : (
          <div className="space-y-2">
            <Button
              size="lg"
              className="w-full min-h-[52px] text-base font-semibold"
              disabled={!canConfirm}
              onClick={handleConfirm}
            >
              {submitting ? (
                <>
                  <Loader2 className="h-5 w-5 animate-spin" />
                  {totalCents === 0
                    ? "Confirming meetup..."
                    : isTelegramSurface
                      ? "Preparing TON payment..."
                      : "Opening Stripe Checkout..."}
                </>
              ) : totalCents > 0 ? (
                `Pay with Stripe Checkout — ${expertPricing?.currency || "SGD"} ${(depositCents / 100).toFixed(2)}`
              ) : (
                "Confirm meetup"
              )}
            </Button>
            {!isTelegramSurface && totalCents > 0 && (
              <p className="text-center text-xs text-muted-foreground px-1">
                PayNow and other supported payment methods are handled inside Stripe Checkout.
              </p>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
