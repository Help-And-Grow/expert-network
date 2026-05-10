"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { Clock3, Loader2, Pause, Play, Send, Sparkles, Volume2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { resumeSharedAudioContext } from "@/lib/audio-unlock";
import { prepareAudioSourceForElement } from "@/lib/client-audio-source";
import { pickDeviceVoice } from "@/lib/device-voice";
import { cn } from "@/lib/utils";

interface VoiceChatModalProps {
  expertId: string;
  expertName: string;
  /** Expert gender — used to pick a matching device-voice fallback. */
  expertGender?: string | null;
  onClose: () => void;
}

type SessionState = "connecting" | "connected" | "ending" | "ended" | "error";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  audioSrc?: string | null;
};

function formatTimer(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function hasDeviceVoiceSupport(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

async function pickDeviceVoiceWhenReady(
  lang: string,
  gender?: string | null,
): Promise<SpeechSynthesisVoice | null> {
  const immediate = pickDeviceVoice(lang, gender);
  if (immediate) return immediate;
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return null;

  const synth = window.speechSynthesis;
  return await new Promise((resolve) => {
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      synth.removeEventListener("voiceschanged", onChanged);
      clearTimeout(timer);
      resolve(pickDeviceVoice(lang, gender));
    };
    const onChanged = () => finish();
    const timer = setTimeout(finish, 800);
    synth.addEventListener("voiceschanged", onChanged);
  });
}

function assignAudioSource(audio: HTMLAudioElement, src: string): boolean {
  try {
    audio.src = src;
    return true;
  } catch (error) {
    console.warn("[voice-chat-modal] Invalid audio source", error);
    return false;
  }
}

export function VoiceChatModal({
  expertId,
  expertName,
  expertGender,
  onClose,
}: VoiceChatModalProps) {
  const [sessionState, setSessionState] = useState<SessionState>("connecting");
  const [error, setError] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [maxDuration, setMaxDuration] = useState(180);
  const [turnInfo, setTurnInfo] = useState({ count: 0, max: 5 });
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [deviceVoiceSupported, setDeviceVoiceSupported] = useState(false);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const msgIdRef = useRef(0);
  const messagesRef = useRef<ChatMessage[]>([]);
  const stopSessionRef = useRef<() => Promise<void>>(async () => {});
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioSourceCleanupRef = useRef<(() => void) | null>(null);
  const pendingSessionIdRef = useRef<string | null>(null);
  const speechRef = useRef<SpeechSynthesisUtterance | null>(null);
  const playbackModeRef = useRef<"audio" | "device" | null>(null);
  const shouldStopAfterConnectRef = useRef(false);
  const pendingAutoPlayRef = useRef<{ src: string; msgId: string } | null>(null);

  const router = useRouter();
  const redirectToSignIn = useCallback(() => {
    if (typeof window === "undefined") return;
    const callbackUrl = `${window.location.pathname}${window.location.search}`;
    onClose();
    router.push(`/auth/signin?callbackUrl=${encodeURIComponent(callbackUrl)}`);
  }, [onClose, router]);

  messagesRef.current = messages;

  const nextMessageId = useCallback(() => `rt-chat-${++msgIdRef.current}`, []);

  const starterPrompts = useMemo(
    () => [
      `What should I ask you about first?`,
      `Give me a sharp take on my current situation.`,
      `What is the biggest mistake people make here?`,
    ],
    [],
  );

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior: "smooth",
      });
    });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  useEffect(() => {
    setDeviceVoiceSupported(hasDeviceVoiceSupport());
  }, []);

  const cleanupAudioSource = useCallback(() => {
    audioSourceCleanupRef.current?.();
    audioSourceCleanupRef.current = null;
  }, []);

  const stopGreetingPlayback = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.onended = null;
      audioRef.current.onpause = null;
      audioRef.current.onerror = null;
      audioRef.current.pause();
      audioRef.current.removeAttribute("src");
      audioRef.current.load();
      try {
        audioRef.current.remove();
      } catch {}
      audioRef.current = null;
    }
    cleanupAudioSource();

    if (hasDeviceVoiceSupport()) {
      window.speechSynthesis.cancel();
    }
    speechRef.current = null;
    playbackModeRef.current = null;
    setPlayingId(null);
  }, [cleanupAudioSource]);

  const playGreetingAudio = useCallback(
    async (src: string): Promise<boolean> => {
      stopGreetingPlayback();

      const audio = document.createElement("audio");
      audio.setAttribute("playsinline", "true");
      audio.setAttribute("webkit-playsinline", "true");
      audio.preload = "auto";
      try {
        audio.style.display = "none";
        document.body.appendChild(audio);
      } catch {}
      const preparedSource = prepareAudioSourceForElement(src);
      if (!preparedSource) {
        try {
          audio.remove();
        } catch {}
        return false;
      }
      if (!assignAudioSource(audio, preparedSource.src)) {
        preparedSource.revoke();
        try {
          audio.remove();
        } catch {}
        return false;
      }
      audioSourceCleanupRef.current = preparedSource.revoke;
      audioRef.current = audio;
      playbackModeRef.current = "audio";

      const clearPlaying = () => {
        if (playbackModeRef.current !== "audio") return;
        if (audioRef.current !== audio) return;
        audio.onended = null;
        audio.onpause = null;
        audio.onerror = null;
        audio.removeAttribute("src");
        audio.load();
        try {
          audio.remove();
        } catch {}
        audioRef.current = null;
        cleanupAudioSource();
        playbackModeRef.current = null;
      };

      audio.onended = clearPlaying;
      audio.onerror = clearPlaying;
      audio.onpause = clearPlaying;

      try {
        await audio.play();
        return true;
      } catch {
        stopGreetingPlayback();
        return false;
      }
    },
    [cleanupAudioSource, stopGreetingPlayback],
  );

  const playMessageAudio = useCallback(
    async (src: string, msgId: string): Promise<boolean> => {
      stopGreetingPlayback();

      const audio = document.createElement("audio");
      audio.setAttribute("playsinline", "true");
      audio.setAttribute("webkit-playsinline", "true");
      audio.preload = "auto";
      try {
        audio.style.display = "none";
        document.body.appendChild(audio);
      } catch {}
      const preparedSource = prepareAudioSourceForElement(src);
      if (!preparedSource) {
        try {
          audio.remove();
        } catch {}
        return false;
      }
      if (!assignAudioSource(audio, preparedSource.src)) {
        preparedSource.revoke();
        try {
          audio.remove();
        } catch {}
        return false;
      }
      audioSourceCleanupRef.current = preparedSource.revoke;
      audioRef.current = audio;
      playbackModeRef.current = "audio";
      setPlayingId(msgId);

      const clearPlaying = () => {
        if (playbackModeRef.current !== "audio") return;
        if (audioRef.current !== audio) return;
        audio.onended = null;
        audio.onpause = null;
        audio.onerror = null;
        audio.removeAttribute("src");
        audio.load();
        try {
          audio.remove();
        } catch {}
        audioRef.current = null;
        cleanupAudioSource();
        playbackModeRef.current = null;
        setPlayingId(null);
      };

      audio.onended = clearPlaying;
      audio.onpause = clearPlaying;
      audio.onerror = clearPlaying;

      try {
        await audio.play();
        return true;
      } catch {
        clearPlaying();
        return false;
      }
    },
    [cleanupAudioSource, stopGreetingPlayback],
  );

  const attemptPendingAutoplay = useCallback(() => {
    const pending = pendingAutoPlayRef.current;
    if (!pending || playingId) return;
    pendingAutoPlayRef.current = null;
    void playMessageAudio(pending.src, pending.msgId).then((ok) => {
      if (!ok) {
        pendingAutoPlayRef.current = pending;
      } else {
        setError(null);
      }
    });
  }, [playMessageAudio, playingId]);

  const speakGreetingWithDeviceVoice = useCallback(
    async (text: string): Promise<boolean> => {
      if (!hasDeviceVoiceSupport()) return false;

      stopGreetingPlayback();

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = /[\u3400-\u9fff]/.test(text) ? "zh-CN" : "en-US";
      const matched = await pickDeviceVoiceWhenReady(utterance.lang, expertGender);
      if (matched) utterance.voice = matched;
      speechRef.current = utterance;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(utterance);
      return true;
    },
    [stopGreetingPlayback, expertGender],
  );

  const speakWithDeviceVoice = useCallback(
    async (text: string, msgId: string): Promise<boolean> => {
      if (!hasDeviceVoiceSupport()) return false;

      stopGreetingPlayback();

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = /[\u3400-\u9fff]/.test(text) ? "zh-CN" : "en-US";
      const matched = await pickDeviceVoiceWhenReady(utterance.lang, expertGender);
      if (matched) utterance.voice = matched;
      utterance.onend = () => {
        if (playbackModeRef.current === "device") {
          playbackModeRef.current = null;
          speechRef.current = null;
          setPlayingId(null);
        }
      };
      utterance.onerror = () => {
        if (playbackModeRef.current === "device") {
          playbackModeRef.current = null;
          speechRef.current = null;
          setPlayingId(null);
        }
      };

      speechRef.current = utterance;
      playbackModeRef.current = "device";
      setPlayingId(msgId);
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(utterance);
      return true;
    },
    [expertGender, stopGreetingPlayback],
  );

  const autoPlayAssistantReply = useCallback(
    async (message: ChatMessage) => {
      resumeSharedAudioContext();
      if (message.audioSrc) {
        const played = await playMessageAudio(message.audioSrc, message.id);
        if (!played) {
          pendingAutoPlayRef.current = { src: message.audioSrc, msgId: message.id };
          setError("Voice playback was blocked. Tap once to enable sound, then tap play.");
        }
        return;
      }
      if (hasDeviceVoiceSupport()) {
        void speakWithDeviceVoice(message.text, message.id);
      }
    },
    [playMessageAudio, speakWithDeviceVoice],
  );

  const onModalPointerDownCapture = useCallback(
    (e: React.PointerEvent) => {
      if ((e.target as HTMLElement).closest("button, a, textarea, input")) return;
      resumeSharedAudioContext();
      attemptPendingAutoplay();
    },
    [attemptPendingAutoplay],
  );

  const togglePlayback = useCallback(
    (msg: ChatMessage) => {
      if (!msg.audioSrc) return;
      resumeSharedAudioContext();
      if (playingId === msg.id && playbackModeRef.current === "audio") {
        stopGreetingPlayback();
      } else {
        void playMessageAudio(msg.audioSrc, msg.id).then((ok) => {
          if (!ok) setError("Voice playback was blocked. Tap play again to listen.");
        });
      }
    },
    [playingId, playMessageAudio, stopGreetingPlayback],
  );

  const toggleDeviceVoice = useCallback(
    (msg: ChatMessage) => {
      if (!hasDeviceVoiceSupport()) return;
      resumeSharedAudioContext();
      if (playingId === msg.id && playbackModeRef.current === "device") {
        stopGreetingPlayback();
        return;
      }
      void speakWithDeviceVoice(msg.text, msg.id);
    },
    [playingId, speakWithDeviceVoice, stopGreetingPlayback],
  );

  useEffect(() => () => {
    stopGreetingPlayback();
  }, [stopGreetingPlayback]);

  const stopSessionById = useCallback(async (activeSessionId: string) => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    await fetch("/api/voice-chat/stop", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ sessionId: activeSessionId }),
    }).catch(() => {});
  }, []);

  const stopSession = useCallback(async () => {
    const activeSessionId = sessionId ?? pendingSessionIdRef.current;
    if (!activeSessionId) {
      shouldStopAfterConnectRef.current = true;
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      return;
    }

    shouldStopAfterConnectRef.current = false;
    pendingSessionIdRef.current = null;
    setSessionId(null);
    await stopSessionById(activeSessionId);
  }, [sessionId, stopSessionById]);

  useEffect(() => {
    stopSessionRef.current = stopSession;
  }, [stopSession]);

  useEffect(() => {
    return () => {
      void stopSessionRef.current();
    };
  }, []);

  const fetchGreeting = useCallback(async () => {
    try {
      resumeSharedAudioContext();
      const res = await fetch("/api/voice-chat/greeting", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ expertId }),
      });
      if (res.status === 401) {
        redirectToSignIn();
        return;
      }
      const data = (await res.json()) as { replyText?: string; replyAudio?: string | null };
      if (!res.ok || !data.replyText) return;
      if (messagesRef.current.length > 0) return;
      const greetingText = data.replyText;

      const greetingId = nextMessageId();
      setMessages((prev) =>
        prev.length === 0
          ? [
              {
                id: greetingId,
                role: "assistant",
                text: greetingText,
              },
            ]
          : prev,
      );

      let played = false;
      if (data.replyAudio) {
        played = await playGreetingAudio(data.replyAudio);
      }
      if (!played) {
        void speakGreetingWithDeviceVoice(greetingText);
      }
    } catch {
      // Greeting is non-blocking.
    }
  }, [
    expertId,
    nextMessageId,
    playGreetingAudio,
    speakGreetingWithDeviceVoice,
    redirectToSignIn,
  ]);

  useEffect(() => {
    let cancelled = false;

    async function startSession() {
      try {
        const res = await fetch("/api/voice-chat/start", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ expertId }),
        });
        if (res.status === 401) {
          if (!cancelled) redirectToSignIn();
          return;
        }
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
          sessionId?: string;
          maxDurationSeconds?: number;
        };

        if (!res.ok || !data.sessionId) {
          throw new Error(data.error || `Server error ${res.status}`);
        }
        pendingSessionIdRef.current = data.sessionId;
        if (cancelled || shouldStopAfterConnectRef.current) {
          await stopSessionById(data.sessionId);
          pendingSessionIdRef.current = null;
          return;
        }

        setSessionId(data.sessionId);
        setSessionState("connected");
        setMaxDuration(data.maxDurationSeconds ?? 180);

        const startedAt = Date.now();
        timerRef.current = setInterval(() => {
          const secs = Math.floor((Date.now() - startedAt) / 1000);
          setElapsed(secs);
          if (secs >= (data.maxDurationSeconds ?? 180)) {
            void (async () => {
              setSessionState("ending");
              await stopSessionRef.current();
              if (!cancelled) {
                setSessionState("ended");
              }
            })();
          }
        }, 1000);

        void fetchGreeting();
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : "Could not start AI chat.";
        setError(message);
        setSessionState("error");
      }
    }

    void startSession();

    return () => {
      cancelled = true;
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [expertId, fetchGreeting, stopSessionById, redirectToSignIn]);

  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || sending || sessionState !== "connected") return;

      resumeSharedAudioContext();
      setSending(true);
      setError(null);
      setInput("");

      const userId = nextMessageId();
      setMessages((prev) => [...prev, { id: userId, role: "user", text: trimmed }]);

      try {
        const res = await fetch("/api/voice-chat/message", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            expertId,
            sessionId,
            text: trimmed,
            includeAudio: true,
          }),
        });
        if (res.status === 401) {
          redirectToSignIn();
          return;
        }
        const data = (await res
          .json()
          .catch(async () => ({ error: (await res.text().catch(() => "")) || "Server error" }))) as {
          error?: string;
          replyText?: string;
          replyAudio?: string | null;
          turnCount?: number;
          maxTurns?: number;
        };
        if (!res.ok || !data.replyText) {
          throw new Error(data.error || `Server error ${res.status}`);
        }

        const aiMsg: ChatMessage = {
          id: nextMessageId(),
          role: "assistant",
          text: data.replyText ?? "",
          audioSrc: data.replyAudio,
        };
        setMessages((prev) => [...prev, aiMsg]);
        void autoPlayAssistantReply(aiMsg);
        if (typeof data.turnCount === "number" && typeof data.maxTurns === "number") {
          setTurnInfo({ count: data.turnCount, max: data.maxTurns });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Could not send message.";
        setError(message);
      } finally {
        setSending(false);
      }
    },
    [expertId, nextMessageId, sending, sessionId, sessionState, redirectToSignIn, autoPlayAssistantReply],
  );

  const handleClose = useCallback(async () => {
    stopGreetingPlayback();
    if (sessionState === "connected" || sessionState === "connecting") {
      setSessionState("ending");
      await stopSession();
    }
    onClose();
  }, [onClose, sessionState, stopGreetingPlayback, stopSession]);

  const remaining = Math.max(0, maxDuration - elapsed);
  const isLowTime = remaining <= 30;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onPointerDownCapture={onModalPointerDownCapture}
    >
      <div className="surface-card mx-4 flex w-full max-w-md flex-col overflow-hidden">
        <div className="bg-gradient-to-r from-indigo-600 to-purple-600 px-5 py-4 text-white">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="mb-2 flex items-center gap-2 text-white/90">
                <Sparkles className="h-4 w-4" />
                <span className="text-xs font-medium uppercase tracking-[0.2em]">
                  Realtime AI Chat
                </span>
              </div>
              <h3 className="truncate text-lg font-semibold">
                {sessionState === "connecting"
                  ? `Opening chat with ${expertName}`
                  : expertName}
              </h3>
              <p className="mt-1 text-sm text-white/80">
                {sessionState === "connected"
                  ? "Free preview with fast expert-style replies"
                  : sessionState === "error"
                    ? error
                    : sessionState === "ended"
                      ? "This preview has ended."
                      : "Preparing your session..."}
              </p>
            </div>
            <button
              type="button"
              onClick={() => void handleClose()}
              className="rounded-full p-1.5 text-white/80 transition-colors hover:bg-white/10 hover:text-white"
              aria-label="Close realtime chat"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="border-b border-border/70 bg-card/70 px-5 py-3">
          <div className="flex items-center justify-between text-sm">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Clock3 className="h-4 w-4" />
              <span
                className={cn(
                  "font-mono tabular-nums",
                  isLowTime && sessionState === "connected" && "text-red-500",
                )}
              >
                {formatTimer(remaining)}
              </span>
            </div>
            <span className="text-xs text-muted-foreground">
              Turns {turnInfo.count}/{turnInfo.max}
            </span>
          </div>
        </div>

        <div
          ref={scrollRef}
          className="max-h-[420px] min-h-[260px] space-y-3 overflow-y-auto px-5 py-4"
        >
          {messages.length === 0 && sessionState === "connecting" && (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="h-7 w-7 animate-spin text-indigo-500" />
            </div>
          )}

          {messages.length === 0 && sessionState === "connected" && (
            <div className="space-y-2">
              {starterPrompts.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  onClick={() => void sendMessage(prompt)}
                  className="w-full rounded-2xl border border-border/80 bg-background px-4 py-3 text-left text-sm text-foreground transition-colors hover:border-indigo-400/40 hover:bg-indigo-500/5"
                >
                  {prompt}
                </button>
              ))}
            </div>
          )}

          {messages.map((message) => (
            <div
              key={message.id}
              className={cn(
                "max-w-[88%] rounded-2xl px-4 py-3 text-sm shadow-sm",
                message.role === "assistant"
                  ? "mr-auto border border-border/80 bg-background text-foreground"
                  : "ml-auto bg-indigo-600 text-white",
              )}
            >
              <p className="whitespace-pre-wrap">{message.text}</p>

              {message.role === "assistant" && (
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {message.audioSrc && (
                    <button
                      type="button"
                      onClick={() => togglePlayback(message)}
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-indigo-500/15 text-indigo-600 transition-colors hover:bg-indigo-500/25"
                      aria-label={
                        playingId === message.id && playbackModeRef.current === "audio"
                          ? "Pause voice reply"
                          : "Play voice reply"
                      }
                      title={
                        playingId === message.id && playbackModeRef.current === "audio"
                          ? "Pause"
                          : "Play voice reply"
                      }
                    >
                      {playingId === message.id && playbackModeRef.current === "audio" ? (
                        <Pause className="h-3.5 w-3.5" />
                      ) : (
                        <Play className="h-3.5 w-3.5 ml-0.5" />
                      )}
                    </button>
                  )}

                  {deviceVoiceSupported && !message.audioSrc && (
                    <button
                      type="button"
                      onClick={() => toggleDeviceVoice(message)}
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-indigo-500/15 text-indigo-600 transition-colors hover:bg-indigo-500/25"
                      aria-label="Read aloud with device voice"
                      title="Read aloud with device voice"
                    >
                      {playingId === message.id && playbackModeRef.current === "device" ? (
                        <Pause className="h-3.5 w-3.5" />
                      ) : (
                        <Volume2 className="h-3.5 w-3.5" />
                      )}
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>

        {error && sessionState === "connected" && (
          <div className="px-5 pb-2">
            <p className="rounded-xl bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </p>
          </div>
        )}

        {sessionState === "connected" ? (
          <div className="border-t border-border/70 bg-card/50 px-5 py-4">
            <div className="flex items-end gap-3">
              <Textarea
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void sendMessage(input);
                  }
                }}
                placeholder={`Ask ${expertName.split(/\s+/)[0] || expertName} anything...`}
                className="min-h-[96px] resize-none"
                disabled={sending}
              />
              <Button
                size="icon"
                className="h-12 w-12 shrink-0 rounded-full"
                disabled={sending || !input.trim()}
                onClick={() => void sendMessage(input)}
              >
                {sending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>
        ) : (
          <div className="border-t border-border/70 px-5 py-4">
            <Button
              className="w-full"
              onClick={() => void handleClose()}
              variant={sessionState === "error" ? "outline" : "default"}
            >
              Close
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
