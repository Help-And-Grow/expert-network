"use client";

import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { Sparkles, Send, Loader2, ArrowLeft } from "lucide-react";
import { useSession } from "next-auth/react";

import { useTelegram } from "@/components/telegram-provider";
import { useInviteGuard } from "@/hooks/use-invite-guard";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { UserMenu } from "@/components/user-menu";
import { VoiceInputButton } from "@/components/voice-input-button";
import {
  type DiscoverMatchChatMessage,
  type DiscoverMatchRecommendation,
  discoverMatchMessagesToApiHistory,
  loadDiscoverMatchFromSessionStorage,
  saveDiscoverMatchToSessionStorage,
} from "@/lib/discover-match-storage";

interface MatchResponse {
  recommendations: DiscoverMatchRecommendation[];
  noMatchMessage?: string;
}

const MatchRecommendationCard = memo(function MatchRecommendationCard({
  rec,
}: {
  rec: DiscoverMatchRecommendation;
}) {
  const initials = rec.name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  return (
    <Card className="overflow-hidden border-indigo-400/20">
      <CardContent className="p-4">
        <div className="flex gap-4">
          <div
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 text-sm font-semibold text-white"
            aria-hidden
          >
            {initials}
          </div>
          <div className="min-w-0 flex-1">
            <h4 className="font-semibold text-foreground">{rec.name}</h4>
            <p className="mt-1 text-sm text-muted-foreground line-clamp-3">
              {rec.reason?.trim() || rec.summary}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button asChild size="sm">
                <Link href={`/experts/${rec.expertId}/book?from=match`}>Schedule meetup</Link>
              </Button>
              <Button asChild variant="outline" size="sm">
                <Link href={`/experts/${rec.expertId}`}>View Profile</Link>
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
});

export default function DiscoverPage() {
  return <DiscoverContent />;
}

function DiscoverContent() {
  const { status: sessionStatus } = useSession();
  const { isTelegram, ready: tgReady } = useTelegram();
  const { checked: inviteChecked, hasInvite } = useInviteGuard();
  const router = useRouter();
  const [chatInput, setChatInput] = useState("");
  const [chatMessages, setChatMessages] = useState<DiscoverMatchChatMessage[]>([]);
  const [chatLoading, setChatLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const [sessionRestored, setSessionRestored] = useState(false);

  useLayoutEffect(() => {
    const saved = loadDiscoverMatchFromSessionStorage();
    if (saved) {
      setChatMessages(saved.chatMessages);
      setChatInput(saved.chatInput);
    }
    setSessionRestored(true);
  }, []);

  useEffect(() => {
    if (!sessionRestored) return;
    saveDiscoverMatchToSessionStorage({ chatMessages, chatInput });
  }, [chatMessages, chatInput, sessionRestored]);

  useEffect(() => {
    if (tgReady && !isTelegram && sessionStatus === "unauthenticated") {
      router.push("/auth/signin?callbackUrl=/discover");
    }
  }, [sessionStatus, isTelegram, tgReady, router]);

  const runMatch = useCallback(
    async (query: string) => {
      const q = query.trim();
      if (!q || chatLoading) return;

      const withUser: DiscoverMatchChatMessage[] = [
        ...chatMessages,
        { role: "user", content: q },
      ];
      setChatMessages(withUser);
      setChatLoading(true);

      const history = discoverMatchMessagesToApiHistory(withUser);

      try {
        const res = await fetch("/api/experts/match", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: q, history }),
        });
        if (!res.ok) throw new Error("Match failed");
        const data: MatchResponse = await res.json();

        setChatMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            recommendations: data.recommendations,
            noMatchMessage: data.noMatchMessage,
          },
        ]);
      } catch {
        setChatMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            // `transientError: true` keeps this row out of sessionStorage so a
            // refresh after a network blip doesn't replay an orphan error.
            transientError: true,
            noMatchMessage:
              "Sorry, that didn't go through. Tap Retry or rephrase your question.",
          },
        ]);
      } finally {
        setChatLoading(false);
      }
    },
    [chatLoading, chatMessages],
  );

  const sendMatchQuery = async () => {
    const q = chatInput.trim();
    if (!q || chatLoading) return;
    setChatInput("");
    await runMatch(q);
  };

  /**
   * Re-runs the user's previous prompt after dropping the failed reply (and
   * the prompt itself, since `runMatch` re-appends it). Wired to the Retry
   * button on transient-error bubbles.
   */
  const retryLastQuery = useCallback(() => {
    const lastAssistantIdx = (() => {
      for (let i = chatMessages.length - 1; i >= 0; i--) {
        if (chatMessages[i].role === "assistant") return i;
      }
      return -1;
    })();
    if (lastAssistantIdx < 1) return;
    const userMsg = chatMessages[lastAssistantIdx - 1];
    if (userMsg.role !== "user" || !userMsg.content) return;
    const trimmed = chatMessages.slice(0, lastAssistantIdx - 1);
    setChatMessages(trimmed);
    void runMatch(userMsg.content);
  }, [chatMessages, runMatch]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages, chatLoading]);

  if (!inviteChecked || !hasInvite) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="app-shell min-h-screen w-full max-w-lg mx-auto flex flex-col pb-24">
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-b">
        <div className="px-4 pt-4 pb-3">
          <div className="flex items-center justify-between">
            <div>
              <button
                type="button"
                onClick={() => router.back()}
                className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors mb-1"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                Back
              </button>
              <h1 className="text-xl font-bold text-foreground">Discover</h1>
              <p className="text-sm text-muted-foreground mt-0.5">Chat to get matched with experts</p>
            </div>
            <UserMenu />
          </div>
        </div>
      </div>

      <div className="flex-1 flex flex-col px-4 min-h-0">
        <div className="flex-1 flex flex-col min-h-[min(70dvh,520px)] max-h-[calc(100dvh-12rem)]">
          <div className="flex-1 overflow-y-auto space-y-4 pr-2 py-4">
            {chatMessages.length === 0 && (
              <div className="py-8 text-center text-muted-foreground text-sm">
                <Sparkles className="h-10 w-10 mx-auto mb-3 text-indigo-500" />
                <p>Describe what you&apos;re looking for and we&apos;ll find the right match.</p>
                <p className="mt-1">e.g. &quot;I need help expanding my startup in Singapore&quot;</p>
              </div>
            )}
            {chatMessages.map((m, i) => (
              <div
                key={i}
                className={`chat-bubble-animate ${
                  m.role === "user" ? "ml-4 mr-0 text-right" : "mr-4 ml-0 text-left"
                }`}
                style={{ animationDelay: `${i * 50}ms` }}
              >
                {m.role === "user" && m.content && (
                  <div className="inline-block rounded-2xl bg-primary px-4 py-2 text-primary-foreground text-sm">
                    {m.content}
                  </div>
                )}
                {m.role === "assistant" && (
                  <div className="space-y-3">
                    {m.recommendations && m.recommendations.length > 0 ? (
                      m.recommendations.map((rec) => (
                        <MatchRecommendationCard key={rec.expertId} rec={rec} />
                      ))
                    ) : m.noMatchMessage ? (
                      <div className="rounded-2xl border border-border/80 bg-card/80 px-4 py-3 text-sm text-muted-foreground">
                        <p>{m.noMatchMessage}</p>
                        {m.transientError && i === chatMessages.length - 1 && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="mt-3"
                            onClick={retryLastQuery}
                            disabled={chatLoading}
                          >
                            Retry
                          </Button>
                        )}
                      </div>
                    ) : null}
                  </div>
                )}
              </div>
            ))}
            {chatLoading && (
              <div className="flex items-center gap-2 text-muted-foreground text-sm">
                <span className="typing-dots">Finding matches</span>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          <div className="sticky bottom-0 pt-3 pb-2 bg-background border-t border-border/60 shrink-0">
            <div className="flex gap-2">
              <Input
                placeholder="What are you looking for?"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void sendMatchQuery();
                  }
                }}
                disabled={chatLoading}
                className="flex-1"
              />
              <VoiceInputButton
                onTranscript={(text) => setChatInput((prev) => (prev ? `${prev} ${text}` : text))}
              />
              <Button size="icon" onClick={() => void sendMatchQuery()} disabled={!chatInput.trim() || chatLoading}>
                {chatLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
