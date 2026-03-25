"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2, ShieldCheck, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";

export default function InvitePage() {
  return (
    <Suspense fallback={<div className="flex min-h-dvh items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>}>
      <InviteContent />
    </Suspense>
  );
}

function InviteContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirect = searchParams.get("redirect") || "/discover";

  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim()) return;

    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/invite/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: code.trim() }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Invalid invitation code");
        return;
      }

      router.replace(redirect);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-dvh items-center justify-center bg-gradient-to-b from-slate-50 to-slate-100 p-4">
      <Card className="w-full max-w-md">
        <CardContent className="pt-8 pb-6 space-y-6">
          <div className="text-center space-y-2">
            <div className="mx-auto w-14 h-14 rounded-full bg-indigo-100 flex items-center justify-center">
              <ShieldCheck className="h-7 w-7 text-indigo-600" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight">
              Welcome to Help &amp; Grow
            </h1>
            <p className="text-sm text-muted-foreground max-w-xs mx-auto">
              The AI Native Expert Network — invite-only for now. Enter your code to get started.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Input
                value={code}
                onChange={(e) => {
                  setCode(e.target.value.toUpperCase());
                  setError("");
                }}
                placeholder="Enter invitation code"
                className="min-h-[48px] text-center text-lg font-mono tracking-widest uppercase"
                maxLength={12}
                autoFocus
              />
              {error && (
                <p className="mt-2 text-sm text-destructive text-center">{error}</p>
              )}
            </div>

            <Button
              type="submit"
              size="lg"
              className="w-full min-h-[48px] text-base font-semibold gap-2"
              disabled={!code.trim() || loading}
            >
              {loading ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <>
                  <Sparkles className="h-5 w-5" />
                  Enter Platform
                </>
              )}
            </Button>
          </form>

          <p className="text-xs text-center text-muted-foreground">
            Don&apos;t have a code? Contact us to request access.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
