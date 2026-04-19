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
    <div className="app-shell min-h-screen w-full max-w-lg mx-auto flex flex-col">
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
            An expert network for real conversations and trusted sessions
          </p>
          <h1 className="text-3xl md:text-4xl font-bold text-white leading-tight mb-4">
            Learn by doing. Grow by helping.
          </h1>
          <p className="text-lg text-slate-300 mb-8 max-w-md">
            Everyone is both a <span className="text-white font-medium">coach</span> and a{" "}
            <span className="text-white font-medium">player</span>. Share what you know, learn
            what you need, and build trusted relationships through expert conversations and real
            sessions across Singapore &amp; Southeast Asia.
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
                    Find your match
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
                    <Link href="/booking">My Meetups</Link>
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
                    Explore experts
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </Button>
              </>
            )}
          </div>
        </div>
      </section>

      {/* Use Cases Section */}
      <section className="border-t border-white/5 bg-transparent px-6 py-16 md:py-20">
        <h2 className="mb-2 text-center text-2xl font-bold text-white">
          Why Help &amp; Grow
        </h2>
        <p className="mb-8 text-center text-sm text-slate-400">
          One network for finding help, sharing expertise, and building trust
        </p>
        <div className="grid gap-6">
          <div className="surface-card p-6">
            <div className="flex items-start gap-4">
              <div className="rounded-lg bg-indigo-500/15 p-3">
                <Users className="h-6 w-6 text-indigo-300" />
              </div>
              <div>
                <h3 className="mb-1 font-semibold text-white">
                  One network for both sides of the table
                </h3>
                <p className="text-sm text-slate-300">
                  You bring expertise that others need, and you learn from people who&apos;ve
                  already solved the problems in front of you. Offer what you know as a service,
                  and learn from others when you need support. We build a culture of learning by
                  doing and growing by helping.
                </p>
              </div>
            </div>
          </div>
          <div className="surface-card p-6">
            <div className="flex items-start gap-4">
              <div className="rounded-lg bg-amber-500/15 p-3">
                <Sparkles className="h-6 w-6 text-amber-300" />
              </div>
              <div>
                <h3 className="mb-1 font-semibold text-white">
                  Service as agent (our north star)
                </h3>
                <p className="text-sm text-slate-300">
                  We&apos;re building toward a digital version of each expert that keeps learning
                  from social context, meetings, reflections, and memos; stays online; evolves
                  with the human expert; answers questions on the platform; and helps facilitate
                  real sessions.
                </p>
              </div>
            </div>
          </div>
          <div className="surface-card p-6">
            <div className="flex items-start gap-4">
              <div className="rounded-lg bg-emerald-500/15 p-3">
                <TrendingUp className="h-6 w-6 text-emerald-300" />
              </div>
              <div>
                <h3 className="mb-1 font-semibold text-white">
                  Human expertise, rooted in Southeast Asia
                </h3>
                <p className="text-sm text-slate-300">
                  Describe what you need in plain language, and we route you to the right people.
                  Founders, operators, and investors use the same network for localization,
                  talent, business development, fundraising, and more across Singapore &amp;
                  Southeast Asia.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="border-t border-white/5 bg-transparent px-6 py-16 md:py-20">
        <h2 className="mb-8 text-center text-2xl font-bold text-white">
          How It Works
        </h2>
        <div className="space-y-8">
          <div className="flex gap-4">
            <div className="flex-shrink-0 w-10 h-10 rounded-full bg-indigo-500 text-white flex items-center justify-center font-bold">
              1
            </div>
            <div>
              <h3 className="mb-1 flex items-center gap-2 font-semibold text-white">
                <Users className="h-4 w-4 text-indigo-500" />
                Chat to find the right expert
              </h3>
              <p className="text-sm text-slate-300">
                Describe what you need, and we&apos;ll match you with people who offer relevant
                expertise across Singapore and Southeast Asia.
              </p>
            </div>
          </div>
          <div className="flex gap-4">
            <div className="flex-shrink-0 w-10 h-10 rounded-full bg-indigo-500 text-white flex items-center justify-center font-bold">
              2
            </div>
            <div>
              <h3 className="mb-1 flex items-center gap-2 font-semibold text-white">
                <MessageSquare className="h-4 w-4 text-indigo-500" />
                Schedule a meetup
              </h3>
              <p className="text-sm text-slate-300">
                Pick a time for an online or in-person meeting. Choose from flexible 30-minute
                slots, from free introductions to paid expert advice.
              </p>
            </div>
          </div>
          <div className="flex gap-4">
            <div className="flex-shrink-0 w-10 h-10 rounded-full bg-indigo-500 text-white flex items-center justify-center font-bold">
              3
            </div>
            <div>
              <h3 className="mb-1 flex items-center gap-2 font-semibold text-white">
                <CheckCircle className="h-4 w-4 text-indigo-500" />
                Keep the momentum going
              </h3>
              <p className="text-sm text-slate-300">
                Turn each session into usable momentum: insights you can act on, relationships
                that compound over time, and visible proof of the help you give across the network.
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
      <footer className="mt-auto border-t border-white/5 bg-transparent px-6 py-8">
        <p className="text-center text-sm text-slate-400">
          <span className="font-semibold text-slate-200">
            Help &amp; Grow
          </span>{" "}
          — Expert Network · Singapore &amp; Southeast Asia
        </p>
      </footer>
    </div>
  );
}
