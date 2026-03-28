"use client";

import { useEffect, useState } from "react";

import Link from "next/link";

import {
  Rocket,
  Sparkles,
  TrendingUp,
  ArrowRight,
  Users,
  MessageSquare,
  CheckCircle,
  Loader2,
} from "lucide-react";

import { useTelegram } from "@/components/telegram-provider";
import { Button } from "@/components/ui/button";
import { UserMenu } from "@/components/user-menu";
import { useAuth } from "@/hooks/use-auth";
import { getTelegramInitData } from "@/lib/telegram";

export function HomeContent() {
  const { isTelegram } = useTelegram();
  const { status, user } = useAuth();
  const [hasExpert, setHasExpert] = useState<boolean | null>(null);
  const [expertLoading, setExpertLoading] = useState(false);

  useEffect(() => {
    if (status === "loading") return;
    if (status !== "authenticated" && !isTelegram) return;

    setExpertLoading(true);
    const headers: Record<string, string> = {};
    const initData = getTelegramInitData();
    if (initData) headers["x-telegram-init-data"] = initData;

    fetch("/api/user", { headers })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => setHasExpert(!!data?.expert))
      .catch(() => setHasExpert(false))
      .finally(() => setExpertLoading(false));
  }, [status, isTelegram, user?.id]);

  const isLoggedIn = status === "authenticated" || isTelegram;
  const showExpertLoading = expertLoading || (isLoggedIn && hasExpert === null);

  return (
    <div className="min-h-screen w-full max-w-lg mx-auto flex flex-col">
      {/* Hero Section */}
      <section className="relative overflow-hidden bg-gradient-to-br from-slate-900 via-slate-800 to-indigo-900 px-6 pt-12 pb-16 md:pt-16 md:pb-24">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-indigo-500/20 via-transparent to-transparent" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom_left,_var(--tw-gradient-stops))] from-slate-500/10 via-transparent to-transparent" />
        <div className="relative z-10">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-2">
              <Rocket className="h-5 w-5 text-indigo-400" />
              <span className="text-sm font-medium text-indigo-300 uppercase tracking-wider">
                Help &amp; Grow
              </span>
            </div>
            <UserMenu variant="light" />
          </div>
          <p className="text-sm font-medium text-indigo-200/90 mb-2">
            AI Native Expert Network
          </p>
          <h1 className="text-3xl md:text-4xl font-bold text-white leading-tight mb-4">
            Learn by doing. Grow by helping.
          </h1>
          <p className="text-lg text-slate-300 mb-8 max-w-md">
            Everyone is both <span className="text-white font-medium">expert</span> and{" "}
            <span className="text-white font-medium">learner</span>—offer what you know, learn
            what you need. An AI-native network rooted in Singapore &amp; Southeast Asia, building
            toward always-on digital experts that learn beside you and facilitate real sessions.
          </p>
          <div className="flex flex-col sm:flex-row gap-3">
            {isTelegram || isLoggedIn ? (
              <>
                <Button
                  asChild
                  size="lg"
                  className="bg-indigo-500 hover:bg-indigo-600 text-white shadow-lg shadow-indigo-500/25 font-semibold"
                >
                  <Link href="/discover" className="flex items-center gap-2">
                    Chat &amp; match
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </Button>
                {showExpertLoading ? (
                  <Button
                    variant="outline"
                    size="lg"
                    disabled
                    className="border-slate-500/50 bg-slate-800/50 text-white font-semibold"
                  >
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    Loading...
                  </Button>
                ) : (
                  <Button
                    asChild
                    variant="outline"
                    size="lg"
                    className="border-slate-500/50 bg-slate-800/50 text-white hover:bg-slate-700/50 hover:text-white font-semibold"
                  >
                    <Link href="/booking">My Bookings</Link>
                  </Button>
                )}
              </>
            ) : (
              <>
                <Button
                  asChild
                  size="lg"
                  className="bg-indigo-500 hover:bg-indigo-600 text-white shadow-lg shadow-indigo-500/25 font-semibold"
                >
                  <Link href="/auth/signin" className="flex items-center gap-2">
                    Get Started
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </Button>
                <Button
                  asChild
                  variant="outline"
                  size="lg"
                  className="border-slate-500/50 bg-slate-800/50 text-white hover:bg-slate-700/50 hover:text-white font-semibold"
                >
                  <Link href="/discover" className="flex items-center gap-2">
                    Chat to match
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </Button>
              </>
            )}
          </div>
        </div>
      </section>

      {/* Use Cases Section */}
      <section className="px-6 py-16 md:py-20 bg-slate-50 dark:bg-slate-900/50">
        <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-2 text-center">
          Why Help &amp; Grow
        </h2>
        <p className="text-sm text-slate-500 dark:text-slate-400 mb-8 text-center">
          One network for expertise—whether you&apos;re booking help or offering it
        </p>
        <div className="grid gap-6">
          <div className="rounded-xl bg-white dark:bg-slate-800/80 p-6 shadow-lg shadow-slate-200/50 dark:shadow-slate-900/50 border border-slate-100 dark:border-slate-700/50">
            <div className="flex items-start gap-4">
              <div className="rounded-lg bg-indigo-100 dark:bg-indigo-900/30 p-3">
                <Users className="h-6 w-6 text-indigo-600 dark:text-indigo-400" />
              </div>
              <div>
                <h3 className="font-semibold text-slate-900 dark:text-white mb-1">
                  Expert and learner, together
                </h3>
                <p className="text-slate-600 dark:text-slate-400 text-sm">
                  You bring expertise others need—and you learn from people who&apos;ve been there.
                  Export part of what you know as a service; buy insight when you need it. We brew a
                  culture of learning by doing and growing by helping.
                </p>
              </div>
            </div>
          </div>
          <div className="rounded-xl bg-white dark:bg-slate-800/80 p-6 shadow-lg shadow-slate-200/50 dark:shadow-slate-900/50 border border-slate-100 dark:border-slate-700/50">
            <div className="flex items-start gap-4">
              <div className="rounded-lg bg-amber-100 dark:bg-amber-900/30 p-3">
                <Sparkles className="h-6 w-6 text-amber-600 dark:text-amber-400" />
              </div>
              <div>
                <h3 className="font-semibold text-slate-900 dark:text-white mb-1">
                  Service as agent (our north star)
                </h3>
                <p className="text-slate-600 dark:text-slate-400 text-sm">
                  We&apos;re building toward a digital version of you that keeps learning—from
                  social context, meetings, reflections, and memos—stays online, evolves with you,
                  answers questions on the platform, and helps you facilitate real sessions.
                </p>
              </div>
            </div>
          </div>
          <div className="rounded-xl bg-white dark:bg-slate-800/80 p-6 shadow-lg shadow-slate-200/50 dark:shadow-slate-900/50 border border-slate-100 dark:border-slate-700/50">
            <div className="flex items-start gap-4">
              <div className="rounded-lg bg-emerald-100 dark:bg-emerald-900/30 p-3">
                <TrendingUp className="h-6 w-6 text-emerald-600 dark:text-emerald-400" />
              </div>
              <div>
                <h3 className="font-semibold text-slate-900 dark:text-white mb-1">
                  AI-native, rooted in SEA
                </h3>
                <p className="text-slate-600 dark:text-slate-400 text-sm">
                  Describe what you need in plain language; AI matches you to the right people.
                  Founders, operators, and investors use the same rails—localisation, talent, BD,
                  fundraising, and more across Singapore &amp; Southeast Asia.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="px-6 py-16 md:py-20 bg-white dark:bg-slate-900">
        <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-8 text-center">
          How It Works
        </h2>
        <div className="space-y-8">
          <div className="flex gap-4">
            <div className="flex-shrink-0 w-10 h-10 rounded-full bg-indigo-500 text-white flex items-center justify-center font-bold">
              1
            </div>
            <div>
              <h3 className="font-semibold text-slate-900 dark:text-white mb-1 flex items-center gap-2">
                <Users className="h-4 w-4 text-indigo-500" />
                Chat to find the right expert
              </h3>
              <p className="text-slate-600 dark:text-slate-400 text-sm">
                Describe what you need; our AI matches you with people offering relevant expertise
                across Singapore and Southeast Asia—learners and experts in one network.
              </p>
            </div>
          </div>
          <div className="flex gap-4">
            <div className="flex-shrink-0 w-10 h-10 rounded-full bg-indigo-500 text-white flex items-center justify-center font-bold">
              2
            </div>
            <div>
              <h3 className="font-semibold text-slate-900 dark:text-white mb-1 flex items-center gap-2">
                <MessageSquare className="h-4 w-4 text-indigo-500" />
                Book a Session
              </h3>
              <p className="text-slate-600 dark:text-slate-400 text-sm">
                Pick a time for an online or in-person meeting. Flexible 30-min
                slots, from free to paid.
              </p>
            </div>
          </div>
          <div className="flex gap-4">
            <div className="flex-shrink-0 w-10 h-10 rounded-full bg-indigo-500 text-white flex items-center justify-center font-bold">
              3
            </div>
            <div>
              <h3 className="font-semibold text-slate-900 dark:text-white mb-1 flex items-center gap-2">
                <CheckCircle className="h-4 w-4 text-indigo-500" />
                Grow Together
              </h3>
              <p className="text-slate-600 dark:text-slate-400 text-sm">
                Turn sessions into momentum—insights you can apply, relationships that compound,
                and proof of help that travels with you on the network.
              </p>
            </div>
          </div>
        </div>
        <div className="mt-10 text-center">
          <Button asChild size="lg" className="font-semibold">
            <Link href="/discover" className="flex items-center gap-2">
              Start matching
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        </div>
      </section>

      {/* Footer */}
      <footer className="mt-auto px-6 py-8 bg-slate-100 dark:bg-slate-900/80 border-t border-slate-200 dark:border-slate-800">
        <p className="text-center text-sm text-slate-500 dark:text-slate-400">
          <span className="font-semibold text-slate-700 dark:text-slate-300">
            Help &amp; Grow
          </span>{" "}
          — AI Native Expert Network · Singapore &amp; Southeast Asia
        </p>
      </footer>
    </div>
  );
}
