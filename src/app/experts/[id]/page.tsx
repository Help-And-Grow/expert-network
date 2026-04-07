"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";

import {
  Star,
  Shield,
  Sparkles,
  Link2,
  MapPin,
  Monitor,
  Loader2,
  Linkedin,
  Twitter,
  FileDown,
  ArrowLeft,
  Globe,
  Play,
  Pause,
} from "lucide-react";

import { AudioPlayer } from "@/components/audio-player";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { UserMenu } from "@/components/user-menu";
import { VoiceChatModal } from "@/components/voice-chat-modal";
import { VoiceChatPanel } from "@/components/voice-chat-panel";
import { openExternalUrl } from "@/lib/telegram";

interface ExpertUser {
  id: string;
  name: string | null;
  nickName: string | null;
  image: string | null;
  email: string | null;
}

interface ServiceItem {
  title: string;
  description: string;
}

interface Expert {
  id: string;
  domains: string[];
  sessionType: string;
  bio: string | null;
  servicesOffered: ServiceItem[] | null;
  isVerified: boolean;
  avgRating: number;
  reviewCount: number;
  linkedIn: string | null;
  website: string | null;
  twitter: string | null;
  substack: string | null;
  instagram: string | null;
  xiaohongshu: string | null;
  hasAvatar: boolean;
  hasAudio: boolean;
  hasClonedVoice: boolean;
  avatarScript: string | null;
  documentName: string | null;
  priceOnlineCents: number | null;
  priceOfflineCents: number | null;
  currency: string;
  user: ExpertUser;
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

const socialConfig = [
  { key: "linkedIn" as const, label: "LinkedIn", icon: Linkedin, getUrl: (e: Expert) => e.linkedIn },
  { key: "website" as const, label: "Website", icon: Globe, getUrl: (e: Expert) => e.website },
  { key: "twitter" as const, label: "X", icon: Twitter, getUrl: (e: Expert) => e.twitter },
  { key: "substack" as const, label: "Substack", icon: Link2, getUrl: (e: Expert) => e.substack },
  { key: "instagram" as const, label: "Instagram", icon: Link2, getUrl: (e: Expert) => e.instagram },
  { key: "xiaohongshu" as const, label: "XiaoHongShu", icon: Link2, getUrl: (e: Expert) => e.xiaohongshu },
];

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
  const id = params.id as string;
  const [expert, setExpert] = useState<Expert | null>(null);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [reviewsTotal, setReviewsTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [reviewsLoading, setReviewsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isAudioPlaying, setIsAudioPlaying] = useState(false);
  const [showVoiceChat, setShowVoiceChat] = useState(false);
  const [showRealtimeChat, setShowRealtimeChat] = useState(false);
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
        if (!res.ok) throw new Error("Failed to fetch reviews");
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

  const loadMoreReviews = () => {
    fetchReviews(true);
  };

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
  const services = (expert.servicesOffered as ServiceItem[] | null) ?? [];
  const socialLinks = socialConfig.filter((c) => {
    const url = c.getUrl(expert);
    return url && url.trim() !== "";
  });
  const hasMoreReviews = reviews.length < reviewsTotal;

  return (
    <div className="min-h-screen w-full max-w-lg mx-auto pb-28">
      <header className="sticky top-0 z-10 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-b px-4 py-3">
        <div className="flex items-center justify-between">
          <button
            onClick={() => router.back()}
            className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back
          </button>
          <UserMenu />
        </div>
      </header>

      <div className="px-4">
      {/* Hero - Profile Image with speaking avatar */}
      <section className="pt-4">
        {expert.hasAudio && (
          <audio
            ref={audioRef}
            src={`/api/experts/${id}/audio`}
            preload="none"
            onPlay={() => setIsAudioPlaying(true)}
            onPause={() => setIsAudioPlaying(false)}
            onEnded={() => setIsAudioPlaying(false)}
          />
        )}
        <div className="relative">
          <div className={`aspect-square rounded-xl overflow-hidden bg-gradient-to-br from-indigo-100 to-purple-100 flex items-center justify-center transition-all duration-300 ${isAudioPlaying ? "ring-4 ring-indigo-400/50 ring-offset-2" : ""}`}>
            {expert.hasAvatar ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={`/api/experts/${id}/avatar`}
                alt={`${name}'s avatar`}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="flex flex-col items-center justify-center text-indigo-300">
                <Sparkles className="h-16 w-16 mb-2" />
                <span className="text-sm">Avatar coming soon</span>
              </div>
            )}
          </div>

          {expert.hasAudio && (
            <button
              onClick={() => {
                const audio = audioRef.current;
                if (!audio) return;
                if (isAudioPlaying) {
                  audio.pause();
                } else {
                  audio.play();
                }
              }}
              className={`absolute bottom-3 right-3 flex items-center gap-2 rounded-full px-4 py-2.5 text-sm font-medium shadow-lg transition-all ${
                isAudioPlaying
                  ? "bg-indigo-600 text-white"
                  : "bg-white/90 text-slate-800 backdrop-blur hover:bg-white"
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
          <div className="mt-2 flex flex-wrap gap-2">
            {expert.domains.map((d) => (
              <Badge key={d} variant="secondary">
                {d}
              </Badge>
            ))}
          </div>
          <div className="mt-2 flex items-center gap-2">
            <div className="flex">
              {[1, 2, 3, 4, 5].map((i) => (
                <Star
                  key={i}
                  className={`h-4 w-4 ${
                    i <= Math.round(expert.avgRating)
                      ? "fill-amber-400 text-amber-400"
                      : "text-muted-foreground/40"
                  }`}
                />
              ))}
            </div>
            <span className="text-sm text-muted-foreground">
              {expert.reviewCount} review{expert.reviewCount !== 1 ? "s" : ""}
            </span>
          </div>
          {expert.isVerified && (
            <Badge
              className="mt-2 gap-1 bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30"
            >
              <Shield className="h-3 w-3" />
              Verified Community Member
            </Badge>
          )}
        </div>
      </section>

      {/* Voice Introduction */}
      {expert.hasAudio && (
        <section className="mt-6">
          <AudioPlayer
            src={`/api/experts/${id}/audio`}
            label={`${name}'s voice introduction`}
          />
        </section>
      )}

      {/* AI Voice Chat */}
      {expert.hasClonedVoice && (vcConfig.asyncEnabled || vcConfig.realtimeReady) && (
        <section className="mt-4 space-y-2">
          {vcConfig.asyncEnabled && (
            <Button
              variant="outline"
              className="w-full h-11 text-sm font-medium bg-gradient-to-r from-indigo-50 to-purple-50 border-indigo-200 hover:from-indigo-100 hover:to-purple-100"
              onClick={() => setShowVoiceChat(true)}
            >
              <Sparkles className="h-4 w-4 mr-2" />
              Chat with AI {name.split(" ")[0]}
            </Button>
          )}
          {vcConfig.realtimeReady && (
            <Button
              variant="outline"
              className="w-full h-11 text-sm font-medium bg-gradient-to-r from-emerald-50 to-teal-50 border-emerald-200 hover:from-emerald-100 hover:to-teal-100"
              onClick={() => setShowRealtimeChat(true)}
            >
              <Play className="h-4 w-4 mr-2" />
              Live call with AI {name.split(" ")[0]}
            </Button>
          )}
          <p className="text-xs text-muted-foreground text-center">
            {vcConfig.asyncEnabled && vcConfig.realtimeReady
              ? `Free AI voice chat — message or call ${name}`
              : vcConfig.realtimeReady
                ? `Free 5-min live call with AI ${name}`
                : `Free voice chat — AI responds in ${name}'s voice`}
          </p>
        </section>
      )}

      {showVoiceChat && (
        <VoiceChatPanel
          expertId={expert.id}
          expertName={name}
          open={showVoiceChat}
          onClose={() => setShowVoiceChat(false)}
        />
      )}

      {showRealtimeChat && (
        <VoiceChatModal
          expertId={expert.id}
          expertName={name}
          onClose={() => setShowRealtimeChat(false)}
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

      {/* Services */}
      {services.length > 0 && (
        <section className="mt-8">
          <h2 className="text-lg font-semibold text-foreground mb-3">
            Services Offered
          </h2>
          <div className="space-y-3">
            {services.map((s, i) => (
              <Card key={i}>
                <CardContent className="p-4">
                  <h3 className="font-medium text-foreground">{s.title}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {s.description}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      )}

      {/* Social Links */}
      {socialLinks.length > 0 && (
        <section className="mt-8">
          <h2 className="text-lg font-semibold text-foreground mb-3">Connect</h2>
          <div className="flex flex-wrap gap-3">
            {socialLinks.map(({ label, icon: Icon, getUrl }) => {
              const url = getUrl(expert);
              if (!url) return null;
              const href = url.startsWith("http") ? url : `https://${url}`;
              return (
                <button
                  key={label}
                  onClick={() => openExternalUrl(href)}
                  className="flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium hover:bg-accent transition-colors"
                >
                  <Icon className="h-4 w-4" />
                  {label}
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* Document Download */}
      {expert.documentName && (
        <section className="mt-8">
          <h2 className="text-lg font-semibold text-foreground mb-3">Document</h2>
          <a
            href={`/api/experts/${id}/document`}
            download
            className="flex items-center gap-3 rounded-lg border px-4 py-3 text-sm font-medium hover:bg-accent transition-colors"
          >
            <FileDown className="h-5 w-5 text-muted-foreground" />
            <span className="truncate flex-1">{expert.documentName}</span>
            <span className="text-xs text-muted-foreground shrink-0">Download</span>
          </a>
        </section>
      )}

      {/* Session Pricing */}
      {(expert.priceOnlineCents != null || expert.priceOfflineCents != null) && (
        <section className="mt-8">
          <h2 className="text-lg font-semibold text-foreground mb-3">Session Rates</h2>
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
            50% deposit due at booking. Remainder charged 24h after the session.
          </p>
        </section>
      )}

      {/* Reviews */}
      <section className="mt-8">
        <h2 className="text-lg font-semibold text-foreground mb-3">
          Reviews ({reviewsTotal})
        </h2>
        {reviews.length === 0 ? (
          <p className="text-muted-foreground py-4">No reviews yet</p>
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
                      <div className="mt-0.5 flex">
                        {[1, 2, 3, 4, 5].map((i) => (
                          <Star
                            key={i}
                            className={`h-3.5 w-3.5 ${
                              i <= r.rating
                                ? "fill-amber-400 text-amber-400"
                                : "text-muted-foreground/40"
                            }`}
                          />
                        ))}
                      </div>
                      {r.comment && (
                        <p className="mt-1 text-sm text-muted-foreground">
                          {r.comment}
                        </p>
                      )}
                      {r.expertSuggestion && (
                        <div className="mt-2 rounded-lg bg-blue-50 dark:bg-blue-950/30 px-3 py-2">
                          <p className="text-xs font-medium text-blue-700 dark:text-blue-400 mb-0.5">Mentor&apos;s Suggestion</p>
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
      <div className="fixed bottom-0 left-0 right-0 z-20 bg-background/95 backdrop-blur border-t safe-area-inset-bottom">
        <div className="max-w-lg mx-auto px-4 py-4 flex gap-3">
          <Button asChild className="flex-1 h-12 text-base font-semibold" size="lg">
            <Link href={`/experts/${id}/book?type=ONLINE&from=profile`} className="flex items-center justify-center gap-2">
              <Monitor className="h-5 w-5" />
              Book Online
            </Link>
          </Button>
          <Button asChild variant="outline" className="flex-1 h-12 text-base font-semibold" size="lg">
            <Link href={`/experts/${id}/book?type=OFFLINE&from=profile`} className="flex items-center justify-center gap-2">
              <MapPin className="h-5 w-5" />
              Book Offline
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
