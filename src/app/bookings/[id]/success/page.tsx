"use client";

import { useEffect, useState } from "react";

import Link from "next/link";
import { useParams } from "next/navigation";

import { format, parseISO } from "date-fns";
import {
  CheckCircle,
  Calendar,
  Clock,
  Monitor,
  MapPin,
  Download,
  ExternalLink,
  Loader2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { openExternalUrl } from "@/lib/telegram";

interface Booking {
  id: string;
  sessionType: string;
  startTime: string;
  endTime: string;
  timezone: string;
  meetingLink?: string | null;
  expert: {
    user: {
      name: string | null;
      nickName: string | null;
    };
  };
}

export default function BookingSuccessPage() {
  const params = useParams();
  const bookingId = params.id as string;

  const [booking, setBooking] = useState<Booking | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/bookings")
      .then((res) => {
        if (!res.ok) throw new Error("Failed to fetch");
        return res.json();
      })
      .then((data) => {
        const list = data?.bookings ?? [];
        const found = list.find((b: { id: string }) => b.id === bookingId);
        setBooking(found ?? null);
        if (!found) setError("Booking not found");
      })
      .catch(() => setError("Failed to load booking"))
      .finally(() => setLoading(false));
  }, [bookingId]);

  const addToCalendar = () => {
    if (!booking) return;
    const start = parseISO(booking.startTime);
    const end = parseISO(booking.endTime);
    const expertName =
      booking.expert?.user?.nickName ||
      booking.expert?.user?.name ||
      "Expert";
    const title = `Session with ${expertName}`;
    const details = `Help & Grow session — ${booking.sessionType}`;

    const formatForGoogle = (d: Date) =>
      d.toISOString().replace(/-|:|\.\d{3}/g, "").slice(0, 15);
    const startStr = formatForGoogle(start);
    const endStr = formatForGoogle(end);

    const googleUrl = new URL("https://calendar.google.com/calendar/render");
    googleUrl.searchParams.set("action", "TEMPLATE");
    googleUrl.searchParams.set("text", title);
    googleUrl.searchParams.set("dates", `${startStr}/${endStr}`);
    googleUrl.searchParams.set("details", details);
    if (booking.timezone) {
      googleUrl.searchParams.set("ctz", booking.timezone);
    }

    openExternalUrl(googleUrl.toString());
  };

  if (loading) {
    return (
      <div className="mx-auto flex min-h-screen max-w-lg flex-col items-center justify-center gap-4 p-6">
        <Loader2 className="h-10 w-10 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Loading booking…</p>
      </div>
    );
  }

  if (error || !booking) {
    return (
      <div className="mx-auto flex min-h-screen max-w-lg flex-col items-center justify-center gap-4 p-6">
        <p className="text-center text-muted-foreground">
          {error ?? "Booking not found"}
        </p>
        <Button asChild>
          <Link href="/booking">View My Bookings</Link>
        </Button>
      </div>
    );
  }

  const expertName =
    booking.expert?.user?.nickName || booking.expert?.user?.name || "Expert";
  const start = parseISO(booking.startTime);
  const end = parseISO(booking.endTime);
  const isOnline = booking.sessionType === "ONLINE";

  return (
    <div className="mx-auto min-h-screen max-w-lg bg-background">
      <main className="flex flex-col items-center px-6 py-12">
        <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-green-500/20">
          <CheckCircle className="h-10 w-10 text-green-600 dark:text-green-400" />
        </div>
        <h1 className="mb-2 text-2xl font-bold">Booking Confirmed!</h1>
        <p className="mb-8 text-muted-foreground">
          Your session has been successfully booked.
        </p>

        <Card className="w-full max-w-md">
          <CardContent className="space-y-4 p-6">
            <div className="flex items-center gap-3">
              <span className="font-medium">Expert</span>
              <span className="text-muted-foreground">{expertName}</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="font-medium">Session type</span>
              <span className="flex items-center gap-1.5 text-muted-foreground">
                {isOnline ? (
                  <>
                    <Monitor className="h-4 w-4" />
                    Online
                  </>
                ) : (
                  <>
                    <MapPin className="h-4 w-4" />
                    Offline
                  </>
                )}
              </span>
            </div>
            <div className="flex items-center gap-3">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              <span>{format(start, "EEEE, MMMM d, yyyy")}</span>
            </div>
            <div className="flex items-center gap-3">
              <Clock className="h-4 w-4 text-muted-foreground" />
              <span>
                {format(start, "h:mm a")} – {format(end, "h:mm a")}
              </span>
            </div>
            <div className="flex items-center gap-3">
              <span className="font-medium">Timezone</span>
              <span className="text-muted-foreground">{booking.timezone}</span>
            </div>
            {isOnline && (
              <div className="flex items-center gap-3">
                <ExternalLink className="h-4 w-4 text-muted-foreground" />
                <span className="text-muted-foreground">
                  Link will be sent via email
                </span>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="mt-8 flex w-full max-w-md flex-col gap-3">
          <Button
            variant="outline"
            size="lg"
            className="w-full"
            onClick={addToCalendar}
          >
            <Download className="h-4 w-4" />
            Add to Calendar
          </Button>
          <Button asChild variant="secondary" size="lg" className="w-full">
            <Link href="/discover">Back to Discovery</Link>
          </Button>
          <Button asChild size="lg" className="w-full">
            <Link href="/booking">View My Bookings</Link>
          </Button>
        </div>
      </main>
    </div>
  );
}
