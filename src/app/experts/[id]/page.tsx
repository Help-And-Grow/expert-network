"use client";

import { type MouseEvent, useCallback, useEffect, useRef, useState } from "react";

import Link from "next/link";
import Image from "next/image";
import { useParams, useRouter } from "next/navigation";

import {
  Shield,
  Sparkles,
  MapPin,
  Monitor,
  MessageSquareText,
  Loader2,
  FileDown,
  ArrowLeft,
  Play,
  Pause,
  Share2,
  Check,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { UserMenu } from "@/components/user-menu";
import { VoiceChatModal } from "@/components/voice-chat-modal";
import { VoiceChatPanel } from "@/components/voice-chat-panel";
import { useAuth } from "@/hooks/use-auth";
import { resumeSharedAudioContext } from "@/lib/audio-unlock";
import { openExternalUrl, shareLink } from "@/lib/telegram";

interface ExpertUser {
  id: string;
  name: string | null;
  nickName: string | null;
  image: string | null;
}

interface ServiceItem {
  title: string;
}

interface Expert {
  id: string;
  sessionType: string;
  bio: string | null;
  servicesOffered: ServiceItem[] | null;
  isVerified: boolean;
  avgRating: number;
  reviewCount: number;
  hasAvatar: boolean;
  hasAudio: boolean;
  hasClonedVoice: boolean;
  hasVoiceChat: boolean;
  viewerIsOwner?: boolean;
  avatarScript: string | null;
  documentName: string | null;
  priceOnlineCents: number | null;
  priceOfflineCents: number | null;
  currency: string;
  user: ExpertUser;
  learnedFromCount: number;
  offeredHelpCount: number;
}

interface ReviewFounder {
  id: string;
  name: string | null;
  nickName: string | null;
  image: string | null;
}

interface Review {
  id: string;
  rating: number;
  comment: string | null;
  expertSuggestion: string | null;
  createdAt: string;
  founder: ReviewFounder;
}

interface ReviewsResponse {
  reviews: Review[];
  total: number;
  skip: number;
  take: number;
}

function HeroSkeleton() {
  return (
    <div className="space-y-4">
      <div className="aspect-square rounded-xl bg-muted animate-pulse" />
      <div className="h-8 w-48 rounded bg-muted animate-pulse" />
      <div className="flex gap-2">
        <div className="h-6 w-20 rounded bg-muted animate-pulse" />
        <div className="h-6 w-20 rounded bg-muted animate-pulse" />
      </div>
    </div>
  );
}

function ReviewSkeleton() {
  return (
    <div className="space-y-2 py-4">
      <div className="flex gap-3">
        <div className="h-10 w-10 rounded-full bg-muted animate-pulse" />
        <div className="flex-1 space-y-2">
          <div className="h-4 w-32 rounded bg-muted animate-pulse" />
          <div className="h-3 w-full rounded bg-muted animate-pulse" />
        </div>
      </div>
    </div>
  );
}

export default function ExpertProfilePage() {
  const params = useParams();
  const router = useRouter();
  const { status: authStatus } = useAuth();
  const id = params.id as string;
  const [expert, setExpert] = useState<Expert | null>(null);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [reviewsTotal, setReviewsTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [reviewsLoading, setReviewsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const introObjectUrlRef = useRef<string | null>(null);
  const [isAudioPlaying, setIsAudioPlaying] = useState(false);
  const [introSrc, setIntroSrc] = useState<string | null>(null);
  const [introLoading, setIntroLoading] = useState(true);
  const [showVoiceChat, setShowVoiceChat] = useState(false);
  const [showRealtimeChat, setShowRealtimeChat] = useState(false);
  const [shareFeedback, setShareFeedback] = useState<"copied" | null>(null);
  const [vcConfig, setVcConfig] = useState<{
    asyncEnabled: boolean;
    realtimeEnabled: boolean;
    realtimeReady: boolean;
  }>({ asyncEnabled: true, realtimeEnabled: false, realtimeReady: false });
  const reviewsRef = useRef<Review[]>([]);
  reviewsRef.current = reviews;

  const fetchExpert = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/experts/${id}`);
      if (!res.ok) {
        if (res.status === 404) setError("Profile not found");
        else setError("Failed to load profile");
        setExpert(null);
        return;
      }
      const data = await res.json();
      setExpert(data);
    } catch {
      setError("Failed to load profile");
      setExpert(null);
    } finally {
      setLoading(false);
    }
  }, [id]);

  const fetchReviews = useCallback(
    async (append = false) => {
      if (!id) return;
      if (append) setReviewsLoading(true);
      const skip = append ? reviewsRef.current.length : 0;
      try {
        const res = await fetch(
          `/api/reviews?expertId=${id}&skip=${skip}&take=5`
        );
        if (!res.ok) throw new Error("Failed to load appreciations");
        const data: ReviewsResponse = await res.json();
        if (append) {
          setReviews((prev) => [...prev, ...data.reviews]);
        } else {
          setReviews(data.reviews);
        }
        setReviewsTotal(data.total);
      } catch {
        if (!append) setReviews([]);
      } finally {
        setReviewsLoading(false);
      }
    },
    [id]
  );

  useEffect(() => {
    fetchExpert();
    fetch("/api/voice-chat/config")
      .then((r) => r.json())
      .then((data) => setVcConfig(data))
      .catch(() => {});
  }, [fetchExpert]);

  useEffect(() => {
    if (expert?.id) {
      fetchReviews(false);
    }
  }, [expert?.id, fetchReviews]);

  useEffect(() => {
    const revoke = () => {
      if (introObjectUrlRef.current) {
        URL.revokeObjectURL(introObjectUrlRef.current);
        introObjectUrlRef.current = null;
      }
    };

    if (!expert?.hasAudio) {
      revoke();
      setIntroSrc(null);
      return;
    }

    const directSrc = `${window.location.origin}/api/experts/${id}/audio?t=${Date.now()}`;

    let cancelled = false;
    revoke();
    setIntroSrc(null);
    setIntroLoading(true);

    void (async () => {
      try {
        const res = await fetch(directSrc, {
          cache: "no-store",
          credentials: "include",
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        if (cancelled) return;
        const objectUrl = URL.createObjectURL(blob);
        introObjectUrlRef.current = objectUrl;
        setIntroSrc(objectUrl);
      } catch (e) {
        console.warn("[page] intro audio fetch failed", e);
        if (!cancelled) {
          setIntroSrc(directSrc);
        }
      } finally {
        if (!cancelled) {
          setIntroLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      revoke();
    };
  }, [expert?.hasAudio, id]);

  const pausePublicIntroAudio = useCallback(() => {
    audioRef.current?.pause();
  }, []);

  useEffect(() => {
    if (showVoiceChat || showRealtimeChat) pausePublicIntroAudio();
  }, [showVoiceChat, showRealtimeChat, pausePublicIntroAudio]);

  useEffect(() => {
    if (authStatus !== "authenticated") {
      setShowVoiceChat(false);
      setShowRealtimeChat(false);
    }
  }, [authStatus]);

  useEffect(() => {
    const onPopState = () => {
      setShowVoiceChat(false);
      setShowRealtimeChat(false);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const pushVoiceChatHistory = useCallback(() => {
    window.history.pushState(
      { ...window.history.state, voiceChatOverlay: true },
      "",
      window.location.href,
    );
  }, []);

  const closeVoiceChatOverlay = useCallback(() => {
    const st = window.history.state as { voiceChatOverlay?: boolean } | null;
    if (st?.voiceChatOverlay) window.history.back();
    else setShowVoiceChat(false);
  }, []);

  const closeRealtimeVoiceOverlay = useCallback(() => {
    const st = window.history.state as { voiceChatOverlay?: boolean } | null;
    if (st?.voiceChatOverlay) window.history.back();
    else setShowRealtimeChat(false);
  }, []);

  const requireLoginForVoiceChat = useCallback(() => {
    if (typeof window === "undefined") return;
    const callbackUrl = `${window.location.pathname}${window.location.search}`;
    router.push(`/auth/signin?callbackUrl=${encodeURIComponent(callbackUrl)}`);
  }, [router]);

  const openVoiceChat = useCallback(
    (mode: "async" | "realtime") => {
      pausePublicIntroAudio();
      resumeSharedAudioContext();

      if (authStatus !== "authenticated") {
        if (authStatus !== "loading") {
          requireLoginForVoiceChat();
        }
        return;
      }

      pushVoiceChatHistory();
      if (mode === "realtime") setShowRealtimeChat(true);
      else setShowVoiceChat(true);
    },
    [
      authStatus,
      pausePublicIntroAudio,
      pushVoiceChatHistory,
      requireLoginForVoiceChat,
    ],
  );

  const loadMoreReviews = () => {
    fetchReviews(true);
  };

  const openServiceDocument = useCallback(
    (event: MouseEvent<HTMLAnchorElement>) => {
      event.preventDefault();
      openExternalUrl(`/api/experts/${id}/document`);
    },
    [id],
  );

  const handleShare = useCallback(async () => {
    if (!expert) return;
    const displayName = expert.user.nickName ?? expert.user.name ?? "an expert";
    const result = await shareLink({
      url: `/experts/${expert.id}`,
      text: `Meet ${displayName} on Help & Grow — book a meetup or voice-chat for free.`,
    });
    if (result === "copied") {
      setShareFeedback("copied");
      setTimeout(() => setShareFeedback(null), 2000);
    }
  }, [expert]);

  if (!id) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-muted-foreground">Invalid profile ID</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen w-full max-w-lg mx-auto px-4 py-6 pb-28">
        <HeroSkeleton />
        <div className="mt-8 space-y-4">
          <div className="h-6 w-24 rounded bg-muted animate-pulse" />
          <div className="h-4 w-full rounded bg-muted animate-pulse" />
          <div className="h-4 w-3/4 rounded bg-muted animate-pulse" />
        </div>
        <div className="mt-8">
          <div className="h-6 w-32 rounded bg-muted animate-pulse mb-4" />
          <ReviewSkeleton />
          <ReviewSkeleton />
        </div>
      </div>
    );
  }

  if (error || !expert) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-4">
        <p className="text-muted-foreground mb-4">{error ?? "Profile not found"}</p>
        <Button variant="outline" onClick={() => router.push("/discover")}>
          Back to Discover
        </Button>
      </div>
    );
  }

  const name = expert.user.nickName ?? expert.user.name ?? "Expert";
  const hasMoreReviews = reviews.length < reviewsTotal;
  const visibleRates = [expert.priceOnlineCents, expert.priceOfflineCents].filter(
    (value): value is number => value != null,
  );
  const hasFreeMeetup = visibleRates.some((value) => value === 0);
  const hasPaidMeetup = visibleRates.some((value) => value > 0);

  return (
    <div className="app-shell min-h-screen w-full max-w-lg mx-auto pb-28">
      <header className="sticky top-0 z-10 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-b px-4 py-3">
        <div className="flex items-center justify-between">
          <button
            onClick={() => router.back()}
            className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleShare}
              aria-label="Share this profile"
              className="flex items-center gap-1.5 rounded-full border border-white/10 bg-card/60 px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-card"
            >
              {shareFeedback === "copied" ? (
                <>
                  <Check className="h-3.5 w-3.5 text-emerald-400" />
                  Copied
                </>
              ) : (
                <>
                  <Share2 className="h-3.5 w-3.5" />
                  Share
                </>
              )}
            </button>
            <UserMenu />
          </div>
        </div>
      </header>

      <div className="px-4">
      {/* Hero - Profile Image with speaking avatar */}
      <section className="pt-4">
        {expert.hasAudio && (
          <audio
            ref={audioRef}
            src={introSrc ?? undefined}
            preload="auto"
            playsInline
            onPlay={() => setIsAudioPlaying(true)}
            onPause={() => setIsAudioPlaying(false)}
            onEnded={() => setIsAudioPlaying(false)}
            onError={() => setIsAudioPlaying(false)}
          />
        )}
        <div className="relative">
          <div className={`aspect-square rounded-xl overflow-hidden bg-gradient-to-br from-indigo-500/20 to-violet-500/20 flex items-center justify-center transition-all duration-300 ${isAudioPlaying ? "ring-4 ring-indigo-400/50 ring-offset-2 ring-offset-background" : ""}`}>
            {expert.hasAvatar ? (
              <Image
                src={`/api/experts/${id}/avatar`}
                alt={`${name}'s avatar`}
                fill
                sizes="(max-width: 768px) 100vw, 448px"
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="flex flex-col items-center justify-center text-indigo-200">
                <Sparkles className="h-16 w-16 mb-2" />
                <span className="text-sm">Avatar coming soon</span>
              </div>
            )}
          </div>

          {expert.hasAudio && (
            <button
              disabled={introLoading}
              onClick={() => {
                const audio = audioRef.current;
                if (!audio) return;
                if (isAudioPlaying) {
                  audio.pause();
                } else {
                  void audio.play().catch((e) => {
                    console.warn("Public profile audio play error", e);
                    // Fallback to reload and try once more if not already playing
                    const fallbackSrc = `${window.location.origin}/api/experts/${id}/audio?t=${Date.now()}`;
                    audio.src = fallbackSrc;
                    audio.load();
                    void audio.play().catch(() => {});
                  });
                }
              }}
              className={`absolute bottom-3 right-3 flex items-center gap-2 rounded-full px-4 py-2.5 text-sm font-medium shadow-lg transition-all ${
                isAudioPlaying
                  ? "bg-indigo-600 text-white"
                  : introLoading
                    ? "border border-white/10 bg-card/50 text-foreground/50 backdrop-blur cursor-not-allowed"
                    : "border border-white/10 bg-card/85 text-foreground backdrop-blur hover:bg-card"
              }`}
            >
              {isAudioPlaying ? (
                <>
                  <Pause className="h-4 w-4" />
                  <span className="flex gap-0.5 items-center">
                    <span className="inline-block h-3 w-0.5 bg-white rounded-full animate-pulse" />
                    <span className="inline-block h-4 w-0.5 bg-white rounded-full animate-pulse [animation-delay:150ms]" />
                    <span className="inline-block h-2 w-0.5 bg-white rounded-full animate-pulse [animation-delay:300ms]" />
                  </span>
                </>
              ) : introLoading ? (
                <>
                  <Loader2 className="h-4 w-4 ml-0.5 animate-spin" />
                  Loading
                </>
              ) : (
                <>
                  <Play className="h-4 w-4 ml-0.5" />
                  Listen
                </>
              )}
            </button>
          )}
        </div>
        <div className="mt-4">
          <h1 className="text-2xl font-bold text-foreground">{name}</h1>
          <div className="mt-3 flex flex-col gap-1">
            <div className="flex items-center gap-1.5 text-sm font-medium text-indigo-300">
              <Sparkles className="h-4 w-4" />
              <span>Offered help to {expert.offeredHelpCount}+ players</span>
            </div>
          </div>
          {expert.isVerified && (
            <Badge
              className="mt-2 gap-1 border-emerald-400/20 bg-emerald-500/10 text-emerald-100"
            >
              <Shield className="h-3 w-3" />
              Verified Community Member
            </Badge>
          )}
        </div>
      </section>

      {/* Voice preview — vivid entry */}
      {!expert.viewerIsOwner && expert.hasVoiceChat && (vcConfig.asyncEnabled || vcConfig.realtimeReady) && (
        <section className="mt-5">
          <div
            onClick={() => openVoiceChat(vcConfig.asyncEnabled ? "async" : "realtime")}
            className="group relative w-full cursor-pointer rounded-2xl bg-gradient-to-r from-indigo-600 to-purple-600 p-[1px] transition-shadow hover:shadow-lg hover:shadow-indigo-950/50"
          >
            <div className="flex items-center gap-3.5 rounded-2xl bg-slate-950/85 px-4 py-3.5">
              <div className="relative shrink-0">
                {expert.user.image ? (
                  <Image
                    src={expert.user.image}
                    alt=""
                    width={44}
                    height={44}
                    className="h-11 w-11 rounded-full object-cover ring-2 ring-indigo-300/20"
                  />
                ) : (
                  <div className="h-11 w-11 rounded-full bg-gradient-to-br from-indigo-400 to-purple-500 flex items-center justify-center text-white font-bold text-sm">
                    {name.split(" ")[0].charAt(0)}
                  </div>
                )}
                <span className="absolute -bottom-0.5 -right-0.5 flex h-4 w-4">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-50" />
                  <span className="relative inline-flex rounded-full h-4 w-4 bg-indigo-500 items-center justify-center">
                    <Sparkles className="h-2.5 w-2.5 text-white" />
                  </span>
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-foreground leading-tight">
                  Chat with {name.split(" ")[0]}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5 leading-tight">
                  {vcConfig.asyncEnabled && vcConfig.realtimeReady
                    ? "Send a quick voice note or switch to realtime AI chat"
                    : vcConfig.asyncEnabled
                      ? "Free expert preview with voice notes and concise replies"
                      : "Free realtime AI chat preview"}
                </p>
              </div>
              <div className="shrink-0 flex items-center gap-1.5 text-indigo-300">
                <MessageSquareText className="h-4 w-4 group-hover:animate-pulse" />
              </div>
            </div>
          </div>

          {vcConfig.asyncEnabled && vcConfig.realtimeReady && (
            <button
              onClick={() => openVoiceChat("realtime")}
              className="mt-2 w-full text-center text-xs text-muted-foreground transition-colors hover:text-indigo-300"
            >
              Or switch to{" "}
              <span className="font-medium underline underline-offset-2">
                realtime AI chat
              </span>{" "}
              (3 min free)
            </button>
          )}
        </section>
      )}

      {showVoiceChat && (
        <VoiceChatPanel
          expertId={expert.id}
          expertName={name}
          expertImage={expert.user.image}
          expertServices={null}
          open={showVoiceChat}
          onClose={closeVoiceChatOverlay}
        />
      )}

      {showRealtimeChat && (
        <VoiceChatModal
          expertId={expert.id}
          expertName={name}
          onClose={closeRealtimeVoiceOverlay}
        />
      )}

      {/* About / Introduction Script */}
      <section className="mt-8">
        <h2 className="text-lg font-semibold text-foreground mb-3">About</h2>
        {expert.avatarScript ? (
          <p className="text-sm text-muted-foreground whitespace-pre-wrap">
            {expert.avatarScript}
          </p>
        ) : (
          <p className="text-muted-foreground">No introduction available.</p>
        )}
      </section>

      {/* Service introduction document (in-platform; no external social links on this page) */}
      {expert.documentName && (
        <section className="surface-tint mt-8 p-4">
          <h2 className="text-lg font-semibold text-foreground mb-1">
            Service introduction
          </h2>
          <p className="text-xs text-muted-foreground mb-3">
            Read how this expert structures their offering before you book.
          </p>
          <a
            href={`/api/experts/${id}/document`}
            download
            target="_blank"
            rel="noopener noreferrer"
            onClick={openServiceDocument}
            className="flex items-center gap-3 rounded-lg border border-white/10 bg-slate-950/70 px-4 py-3 text-sm font-medium transition-colors hover:bg-slate-900"
          >
            <FileDown className="h-5 w-5 text-muted-foreground shrink-0" />
            <span className="truncate flex-1">{expert.documentName}</span>
            <span className="text-xs text-muted-foreground shrink-0">Download</span>
          </a>
        </section>
      )}

      {/* Session Pricing */}
      {(expert.priceOnlineCents != null || expert.priceOfflineCents != null) && (
        <section className="mt-8">
          <h2 className="text-lg font-semibold text-foreground mb-3">Meetup rates</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {expert.priceOnlineCents != null && expert.sessionType !== "OFFLINE" && (
              <Card>
                <CardContent className="flex items-center justify-between p-4">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Monitor className="h-4 w-4" />
                    Online
                  </div>
                  <span className="text-lg font-bold">
                    {expert.priceOnlineCents > 0 ? (
                      <>{expert.currency} {(expert.priceOnlineCents / 100).toFixed(0)}<span className="text-sm font-normal text-muted-foreground">/hr</span></>
                    ) : "Free"}
                  </span>
                </CardContent>
              </Card>
            )}
            {expert.priceOfflineCents != null && expert.sessionType !== "ONLINE" && (
              <Card>
                <CardContent className="flex items-center justify-between p-4">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <MapPin className="h-4 w-4" />
                    Offline
                  </div>
                  <span className="text-lg font-bold">
                    {expert.priceOfflineCents > 0 ? (
                      <>{expert.currency} {(expert.priceOfflineCents / 100).toFixed(0)}<span className="text-sm font-normal text-muted-foreground">/hr</span></>
                    ) : "Free"}
                  </span>
                </CardContent>
              </Card>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            {hasFreeMeetup
              ? "Free meetups are confirmed directly."
              : hasPaidMeetup
                ? "Full payment is required when you schedule."
                : ""}
          </p>
        </section>
      )}

      <section className="mt-8">
        <h2 className="text-lg font-semibold text-foreground mb-3">
          Appreciations ({reviewsTotal})
        </h2>
        {reviews.length === 0 ? (
          <p className="text-muted-foreground py-4">No appreciations yet</p>
        ) : (
          <>
            <div className="space-y-0">
              {reviews.map((r) => (
                <div key={r.id} className="py-4">
                  <div className="flex gap-3">
                    <div
                      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-slate-400 to-slate-600 text-sm font-medium text-white"
                      aria-hidden
                    >
                      {(r.founder.nickName ?? r.founder.name ?? "F")
                        .charAt(0)
                        .toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-foreground text-sm">
                          {r.founder.nickName ?? r.founder.name ?? "Anonymous"}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {new Date(r.createdAt).toLocaleDateString()}
                        </span>
                      </div>
                      <div className="mt-0.5" />
                      {r.comment && (
                        <p className="mt-1 text-sm text-muted-foreground">
                          {r.comment}
                        </p>
                      )}
                      {r.expertSuggestion && (
                        <div className="mt-2 rounded-lg border border-indigo-400/20 bg-indigo-500/10 px-3 py-2">
                          <p className="mb-0.5 text-xs font-bold uppercase tracking-wide text-indigo-200">Coach follow-up</p>
                          <p className="text-sm text-foreground">{r.expertSuggestion}</p>
                        </div>
                      )}
                    </div>
                  </div>
                  <Separator className="mt-4" />
                </div>
              ))}
            </div>
            {hasMoreReviews && (
              <Button
                variant="outline"
                className="mt-4 w-full"
                onClick={loadMoreReviews}
                disabled={reviewsLoading}
              >
                {reviewsLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading...
                  </>
                ) : (
                  "Load more"
                )}
              </Button>
            )}
          </>
        )}
      </section>

      </div>

      {/* Sticky Bottom Bar */}
      {!expert.viewerIsOwner && (
        <div className="fixed bottom-0 left-0 right-0 z-20 bg-background/95 backdrop-blur border-t safe-area-inset-bottom">
          <div className="max-w-lg mx-auto px-4 py-4 flex gap-3">
            <Button asChild className="flex-1 h-12 text-base font-semibold" size="lg">
              <Link href={`/experts/${id}/book?type=ONLINE&from=profile`} className="flex items-center justify-center gap-2">
                <Monitor className="h-5 w-5" />
                Meet online
              </Link>
            </Button>
            <Button asChild variant="outline" className="flex-1 h-12 text-base font-semibold" size="lg">
              <Link href={`/experts/${id}/book?type=OFFLINE&from=profile`} className="flex items-center justify-center gap-2">
                <MapPin className="h-5 w-5" />
                Meet in person
              </Link>
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
