"use client";

import { Suspense, useEffect, useState } from "react";

import { useSearchParams, useRouter } from "next/navigation";

import { CheckCircle, Loader2, ArrowRight, AlertCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

function CheckoutSuccessContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const sessionId = searchParams.get("session_id");
  const [status, setStatus] = useState<"verifying" | "success" | "error">(
    "verifying"
  );
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    if (!sessionId) {
      setStatus("error");
      setErrorMsg("No session ID found.");
      return;
    }

    fetch("/api/bookings/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId }),
    })
      .then(async (res) => {
        const data = await res.json();
        if (res.ok && (data.status === "created" || data.status === "already_created")) {
          setStatus("success");
        } else {
          setStatus("error");
          setErrorMsg(data.detail || data.error || "Verification failed");
        }
      })
      .catch(() => {
        setStatus("error");
        setErrorMsg("Network error — please check your meetups.");
      });
  }, [sessionId]);

  if (status === "verifying") {
    return (
      <div className="app-shell flex min-h-dvh items-center justify-center">
        <div className="text-center space-y-4">
          <Loader2 className="h-10 w-10 animate-spin text-indigo-600 mx-auto" />
          <p className="text-muted-foreground">Confirming your payment...</p>
        </div>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="app-shell flex min-h-dvh items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardContent className="pt-8 pb-6 text-center space-y-4">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-amber-500/15">
              <AlertCircle className="h-8 w-8 text-amber-300" />
            </div>
            <h1 className="text-xl font-bold">Verification Issue</h1>
            <p className="text-muted-foreground text-sm">
              {errorMsg || "We couldn't verify the meetup. Your payment was successful — please check your meetups."}
            </p>
            <Button
              onClick={() => router.push("/booking")}
              className="gap-2"
            >
              Go to Dashboard
              <ArrowRight className="h-4 w-4" />
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="app-shell flex min-h-dvh items-center justify-center p-4">
      <Card className="max-w-md w-full">
        <CardContent className="pt-8 pb-6 text-center space-y-4">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/15">
            <CheckCircle className="h-8 w-8 text-emerald-300" />
          </div>
          <h1 className="text-xl font-bold">Deposit Paid!</h1>
          <p className="text-muted-foreground text-sm">
            Your 50% deposit has been charged and the session is confirmed. The
            remaining balance will be automatically charged 24 hours after the
            session ends.
          </p>
          <div className="flex gap-3 pt-2">
            <Button
              onClick={() => router.push("/booking")}
              className="flex-1 gap-2"
            >
              My Meetups
              <ArrowRight className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              onClick={() => router.push("/discover")}
              className="flex-1"
            >
              Explore More
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function CheckoutSuccessPage() {
  return (
    <Suspense
      fallback={
        <div className="app-shell flex min-h-dvh items-center justify-center">
          <Loader2 className="h-10 w-10 animate-spin text-indigo-600" />
        </div>
      }
    >
      <CheckoutSuccessContent />
    </Suspense>
  );
}
