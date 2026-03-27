"use client";

import { Suspense, useEffect, useState } from "react";

import { useSearchParams, useRouter } from "next/navigation";

import { Mail, Chrome, Loader2 } from "lucide-react";
import { signIn, useSession } from "next-auth/react";

import { useTelegram } from "@/components/telegram-provider";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";

function SignInForm() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { status } = useSession();
  const { isTelegram } = useTelegram();
  const role = searchParams.get("role");
  const isExpert = role === "expert";
  const callbackUrl =
    searchParams.get("callbackUrl") ?? (isExpert ? "/onboarding" : "/");

  const [email, setEmail] = useState("");
  const [emailLoading, setEmailLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isTelegram) {
      router.replace(callbackUrl);
      return;
    }
    if (status === "authenticated") {
      router.replace(callbackUrl);
    }
  }, [status, callbackUrl, router, isTelegram]);

  const handleMagicLink = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!email.trim()) {
      setError("Please enter your email address.");
      return;
    }
    setEmailLoading(true);
    try {
      const result = await signIn("email", {
        email: email.trim(),
        callbackUrl,
        redirect: false,
      });
      if (result?.error) {
        setError("Failed to send magic link. Please try again.");
      } else if (result?.ok) {
        router.push("/auth/verify");
      }
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setEmailLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setError(null);
    setGoogleLoading(true);
    try {
      await signIn("google", { callbackUrl });
    } catch {
      setError("Failed to sign in with Google. Please try again.");
      setGoogleLoading(false);
    }
  };

  return (
    <Card className="w-full max-w-md border-0 bg-white/95 shadow-xl backdrop-blur sm:border">
      <CardHeader className="space-y-1 text-center pb-4">
        <CardTitle className="text-2xl font-bold tracking-tight">
          Help &amp; Grow
        </CardTitle>
        <CardDescription className="text-base space-y-1">
          <span className="block text-xs font-medium text-muted-foreground uppercase tracking-wide">
            AI Native Expert Network
          </span>
          <span className="block">{isExpert ? "Join the community" : "Sign in"}</span>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {error && (
          <div
            className="rounded-lg border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            role="alert"
          >
            {error}
          </div>
        )}

        <form onSubmit={handleMagicLink} className="space-y-3">
          <div className="relative">
            <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={emailLoading}
              className="pl-9"
              autoComplete="email"
            />
          </div>
          <Button
            type="submit"
            className="w-full"
            disabled={emailLoading}
          >
            {emailLoading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Sending...
              </>
            ) : (
              <>
                <Mail className="h-4 w-4" />
                Send Magic Link
              </>
            )}
          </Button>
        </form>

        <div className="relative">
          <Separator className="my-4" />
          <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-white px-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            or
          </span>
        </div>

        <Button
          type="button"
          variant="outline"
          className="w-full"
          onClick={handleGoogleSignIn}
          disabled={googleLoading}
        >
          {googleLoading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Connecting...
            </>
          ) : (
            <>
              <Chrome className="h-4 w-4" />
              Continue with Google
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  );
}

function SignInFallback() {
  return (
    <Card className="w-full max-w-md border-0 bg-white/95 shadow-xl backdrop-blur sm:border">
      <CardHeader className="space-y-1 text-center pb-4">
        <CardTitle className="text-2xl font-bold tracking-tight">
          Help &amp; Grow
        </CardTitle>
        <CardDescription className="text-base">AI Native Expert Network · Sign in</CardDescription>
      </CardHeader>
      <CardContent className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </CardContent>
    </Card>
  );
}

export default function SignInPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-br from-slate-50 via-white to-indigo-50 p-4">
      <Suspense fallback={<SignInFallback />}>
        <SignInForm />
      </Suspense>
    </div>
  );
}
