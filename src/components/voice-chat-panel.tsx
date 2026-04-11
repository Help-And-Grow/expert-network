"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";

import {
  Mic,
  Square,
  Play,
  Pause,
  Loader2,
  X,
  Send,
  Calendar,
  ArrowLeft,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { resumeSharedAudioContext } from "@/lib/audio-unlock";
import { cn } from "@/lib/utils";

interface Message {
  id: string;
  role: "user" | "assistant";
  text: string;
  audioSrc?: string;
}

interface VoiceChatPanelProps {
  expertId: string;
  expertName: string;
  expertImage?: string | null;
  expertDomains?: string[];
  expertServices?: { title: string }[] | null;
  hasClonedVoice?: boolean;
  open: boolean;
  onClose: () => void;
}

function generateStarters(
  name: string,
  domains: string[],
  services?: { title: string }[] | null,
): string[] {
  const first = name.split(" ")[0];
  const chips: string[] = [];

  if (services && services.length > 0) {
    chips.push(`Tell me about your ${services[0].title.toLowerCase()} work`);
    if (services.length > 1)
      chips.push(`How does ${services[1].title.toLowerCase()} work with you?`);
  }

  if (domains.length > 0) {
    chips.push(`What makes you different in ${domains[0]}?`);
    if (domains.length > 1 && chips.length < 3)
      chips.push(`How do ${domains[0]} and ${domains[1]} connect in your practice?`);
  }

  if (chips.length < 3) chips.push(`${first}, what should I ask you about?`);
  if (chips.length < 3) chips.push(`What's a common mistake in your field?`);

  return chips.slice(0, 3);
}

function SpeakingWaveform() {
  return (
    <span className="inline-flex items-center gap-[3px] h-4 ml-1.5">
      {[0, 1, 2, 3, 4].map((i) => (
        <span
          key={i}
          className="inline-block w-[3px] rounded-full bg-indigo-500 animate-[wave_0.8s_ease-in-out_infinite_alternate]"
          style={{
            height: `${8 + Math.random() * 10}px`,
            animationDelay: `${i * 120}ms`,
          }}
        />
      ))}
      <style>{`@keyframes wave{0%{transform:scaleY(.4)}100%{transform:scaleY(1)}}`}</style>
    </span>
  );
}

export function VoiceChatPanel({
  expertId,
  expertName,
  expertImage,
  expertDomains = [],
  expertServices,
  hasClonedVoice = true,
  open,
  onClose,
}: VoiceChatPanelProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [processing, setProcessing] = useState(false);
  const [textInput, setTextInput] = useState("");
  const [turnInfo, setTurnInfo] = useState({ count: 0, max: 10 });
  const [error, setError] = useState<string | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [showStarters, setShowStarters] = useState(true);
  const [greetingLoading, setGreetingLoading] = useState(false);
  const [tapToPlayMessageId, setTapToPlayMessageId] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const pendingAutoplayRef = useRef<{ src: string; msgId: string } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const msgIdRef = useRef(0);

  const nextId = () => `msg-${++msgIdRef.current}`;
  const firstName = expertName.split(" ")[0];

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

  /** Browsers block Audio.play() after async fetch unless audio is "unlocked" by a gesture. */
  const unlockAudioPlayback = useCallback(() => {
    resumeSharedAudioContext();
  }, []);

  const playExpertAudio = useCallback((src: string, msgId: string) => {
    if (audioRef.current) {
      audioRef.current.onended = null;
      audioRef.current.onpause = null;
      audioRef.current.onerror = null;
      audioRef.current.pause();
      audioRef.current.removeAttribute("src");
      audioRef.current.load();
    }

    const audio = document.createElement("audio");
    audio.setAttribute("playsinline", "true");
    audio.setAttribute("webkit-playsinline", "true");
    audio.preload = "auto";
    audio.src = src;
    audioRef.current = audio;

    setPlayingId(msgId);
    const clearPlaying = () => setPlayingId(null);

    audio.onended = clearPlaying;
    audio.onpause = clearPlaying;

    const onFail = () => {
      clearPlaying();
      pendingAutoplayRef.current = { src, msgId };
      setTapToPlayMessageId(msgId);
    };

    audio.onerror = onFail;

    void audio
      .play()
      .then(() => {
        pendingAutoplayRef.current = null;
        setTapToPlayMessageId(null);
      })
      .catch(onFail);
  }, []);

  const onPanelPointerDownCapture = useCallback(
    (e: React.PointerEvent) => {
      // Avoid double-firing when user taps Play / Send (button handles playback).
      if ((e.target as HTMLElement).closest("button, a")) return;
      unlockAudioPlayback();
      const pending = pendingAutoplayRef.current;
      if (pending) {
        playExpertAudio(pending.src, pending.msgId);
      }
    },
    [unlockAudioPlayback, playExpertAudio],
  );

  const fallbackGreetingText = useMemo(
    () =>
      expertDomains.length > 0
        ? `Hi! I'm ${firstName}. I specialize in ${expertDomains.slice(0, 2).join(" & ")}. Ask me anything — this is a quick voice preview of how I think and respond.`
        : `Hi! I'm ${firstName}. Ask me anything about what I do — this is a quick voice preview of how I think and respond.`,
    [firstName, expertDomains],
  );

  // Reset when closed; fetch voice greeting when opened (proactive TTS)
  useEffect(() => {
    if (!open) {
      setMessages([]);
      setShowStarters(true);
      setError(null);
      setGreetingLoading(false);
      msgIdRef.current = 0;
      audioRef.current?.pause();
      setPlayingId(null);
      setTapToPlayMessageId(null);
      pendingAutoplayRef.current = null;
      return;
    }

    let cancelled = false;
    setGreetingLoading(true);

    void (async () => {
      try {
        const res = await fetch("/api/voice-chat/greeting", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ expertId }),
        });
        const data = (await res.json()) as {
          replyText?: string;
          replyAudio?: string;
          error?: string;
        };
        if (cancelled) return;

        if (res.ok && data.replyText && data.replyAudio) {
          const id = nextId();
          setMessages([
            {
              id,
              role: "assistant",
              text: data.replyText,
              audioSrc: data.replyAudio,
            },
          ]);
          if (!cancelled) playExpertAudio(data.replyAudio!, id);
        } else {
          const id = nextId();
          setMessages([
            { id, role: "assistant", text: fallbackGreetingText },
          ]);
        }
      } catch {
        if (!cancelled) {
          const id = nextId();
          setMessages([{ id, role: "assistant", text: fallbackGreetingText }]);
        }
      } finally {
        if (!cancelled) setGreetingLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, expertId, fallbackGreetingText, playExpertAudio]);

  const startRecording = useCallback(async () => {
    try {
      setError(null);
      unlockAudioPlayback();
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm";
      const recorder = new MediaRecorder(stream, { mimeType });
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: mimeType });
        sendVoice(blob);
      };

      mediaRecorderRef.current = recorder;
      recorder.start(250);
      setRecording(true);
      setElapsed(0);
      timerRef.current = setInterval(() => {
        setElapsed((p) => {
          if (p + 1 >= 30) {
            recorder.stop();
            clearInterval(timerRef.current!);
          }
          return p + 1;
        });
      }, 1000);
    } catch {
      setError("Microphone access denied");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unlockAudioPlayback]);

  const stopRecording = useCallback(() => {
    mediaRecorderRef.current?.stop();
    if (timerRef.current) clearInterval(timerRef.current);
    setRecording(false);
  }, []);

  const sendVoice = useCallback(
    async (blob: Blob) => {
      setProcessing(true);
      setError(null);
      setShowStarters(false);
      const userMsg: Message = { id: nextId(), role: "user", text: "..." };
      setMessages((prev) => [...prev, userMsg]);

      try {
        const formData = new FormData();
        formData.append("audio", blob);
        formData.append("expertId", expertId);

        const res = await fetch("/api/voice-chat/message", {
          method: "POST",
          body: formData,
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to send message");

        setMessages((prev) =>
          prev.map((m) =>
            m.id === userMsg.id ? { ...m, text: data.userText } : m,
          ),
        );

        const aiMsg: Message = {
          id: nextId(),
          role: "assistant",
          text: data.replyText,
          audioSrc: data.replyAudio,
        };
        setMessages((prev) => [...prev, aiMsg]);
        setTurnInfo({ count: data.turnCount, max: data.maxTurns });
        playExpertAudio(data.replyAudio, aiMsg.id);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Something went wrong";
        setError(msg);
        setMessages((prev) => prev.filter((m) => m.id !== userMsg.id));
      } finally {
        setProcessing(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [expertId, playExpertAudio],
  );

  const sendText = useCallback(async (overrideText?: string) => {
    const text = (overrideText ?? textInput).trim();
    if (!text || processing) return;
    unlockAudioPlayback();
    setTextInput("");
    setProcessing(true);
    setError(null);
    setShowStarters(false);

    const userMsg: Message = { id: nextId(), role: "user", text };
    setMessages((prev) => [...prev, userMsg]);

    try {
      const res = await fetch("/api/voice-chat/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expertId, text }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to send message");

      const aiMsg: Message = {
        id: nextId(),
        role: "assistant",
        text: data.replyText,
        audioSrc: data.replyAudio,
      };
      setMessages((prev) => [...prev, aiMsg]);
      setTurnInfo({ count: data.turnCount, max: data.maxTurns });
      playExpertAudio(data.replyAudio, aiMsg.id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Something went wrong";
      setError(msg);
    } finally {
      setProcessing(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expertId, textInput, processing, playExpertAudio, unlockAudioPlayback]);

  const togglePlayback = useCallback(
    (msg: Message) => {
      if (!msg.audioSrc) return;
      unlockAudioPlayback();
      if (playingId === msg.id) {
        audioRef.current?.pause();
        setPlayingId(null);
      } else {
        playExpertAudio(msg.audioSrc, msg.id);
      }
    },
    [playingId, playExpertAudio, unlockAudioPlayback],
  );

  const formatTime = (s: number) =>
    `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;

  if (!open) return null;

  const turnsRemaining = turnInfo.max - turnInfo.count;
  const starters = generateStarters(expertName, expertDomains, expertServices);

  return (
    <div
      className="app-shell fixed inset-0 z-50 flex flex-col bg-background"
      onPointerDownCapture={onPanelPointerDownCapture}
    >
      {/* Header with expert identity */}
      <div className="flex items-center justify-between border-b px-4 py-3 bg-gradient-to-r from-indigo-600 to-purple-600 text-white">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-1.5 hover:bg-white/20 transition-colors shrink-0"
            aria-label="Back to profile"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="flex items-center gap-3 min-w-0">
          {expertImage ? (
            <Image
              src={expertImage}
              alt={expertName}
              width={36}
              height={36}
              className="h-9 w-9 rounded-full object-cover ring-2 ring-white/30 shrink-0"
            />
          ) : (
            <div className="h-9 w-9 rounded-full bg-white/20 flex items-center justify-center text-sm font-bold shrink-0">
              {firstName.charAt(0)}
            </div>
          )}
          <div className="min-w-0">
            <h3 className="text-sm font-semibold leading-tight truncate">{expertName}</h3>
            <p className="text-[11px] text-white/70 leading-tight">
              {turnsRemaining > 0
                ? `${turnsRemaining} messages remaining · Free preview`
                : "Preview ended"}
            </p>
          </div>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-full p-1.5 hover:bg-white/20 transition-colors shrink-0"
          aria-label="Close"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {greetingLoading && messages.length === 0 && (
          <div className="flex items-center gap-2.5 mr-auto">
            <div className="shrink-0">
              {expertImage ? (
                <Image src={expertImage} alt="" width={28} height={28} className="h-7 w-7 rounded-full object-cover" />
              ) : (
                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-indigo-500/15 text-xs font-bold text-indigo-200">
                  {firstName.charAt(0)}
                </div>
              )}
            </div>
            <div className="bg-muted rounded-2xl rounded-tl-sm px-3.5 py-2.5 flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Preparing a voice hello…
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <div
            key={msg.id}
            className={cn(
              "flex gap-2.5 max-w-[85%]",
              msg.role === "user" ? "ml-auto flex-row-reverse" : "mr-auto",
            )}
          >
            {msg.role === "assistant" && (
              <div className="shrink-0 mt-0.5">
                {expertImage ? (
                  <Image
                    src={expertImage}
                    alt=""
                    width={28}
                    height={28}
                    className="h-7 w-7 rounded-full object-cover"
                  />
                ) : (
                  <div className="h-7 w-7 rounded-full bg-indigo-100 flex items-center justify-center text-xs font-bold text-indigo-600">
                    {firstName.charAt(0)}
                  </div>
                )}
              </div>
            )}
            <div
              className={cn(
                "rounded-2xl px-3.5 py-2.5 text-sm",
                msg.role === "user"
                  ? "bg-indigo-600 text-white rounded-tr-sm"
                  : "rounded-tl-sm border border-border/80 bg-card/80",
              )}
            >
              <p className="whitespace-pre-wrap">{msg.text}</p>

              {msg.audioSrc && (
                <button
                  onClick={() => togglePlayback(msg)}
                  className={cn(
                    "mt-1.5 flex items-center gap-1.5 text-xs rounded-full px-2.5 py-1 transition-colors",
                    msg.role === "user"
                      ? "bg-white/20 hover:bg-white/30 text-white"
                      : "bg-indigo-500/15 text-indigo-100 hover:bg-indigo-500/25",
                    tapToPlayMessageId === msg.id &&
                      "ring-2 ring-amber-400 ring-offset-1 animate-pulse",
                  )}
                >
                  {playingId === msg.id ? (
                    <>
                      <Pause className="h-3 w-3" />
                      Speaking
                      <SpeakingWaveform />
                    </>
                  ) : (
                    <>
                      <Play className="h-3 w-3" />
                      {hasClonedVoice ? `Play in ${firstName}'s voice` : "Play voice"}
                    </>
                  )}
                </button>
              )}
            </div>
          </div>
        ))}

        {/* Starter chips */}
        {showStarters && messages.length <= 1 && !processing && !greetingLoading && (
          <div className="flex flex-col gap-2 mt-2">
            <p className="text-xs text-muted-foreground font-medium">Try asking:</p>
            {starters.map((chip) => (
              <button
                key={chip}
                onClick={() => sendText(chip)}
                className="rounded-xl border border-indigo-400/20 bg-indigo-500/10 px-3.5 py-2.5 text-left text-sm text-indigo-100 transition-colors hover:bg-indigo-500/20"
              >
                {chip}
              </button>
            ))}
          </div>
        )}

        {processing && (
          <div className="flex items-center gap-2.5 mr-auto">
            <div className="shrink-0">
              {expertImage ? (
                <Image src={expertImage} alt="" width={28} height={28} className="h-7 w-7 rounded-full object-cover" />
              ) : (
                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-indigo-500/15 text-xs font-bold text-indigo-200">
                  {firstName.charAt(0)}
                </div>
              )}
            </div>
            <div className="bg-muted rounded-2xl rounded-tl-sm px-3.5 py-2.5 flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {firstName} is thinking...
            </div>
          </div>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="border-t border-rose-400/20 bg-rose-500/10 px-4 py-2">
          <p className="text-xs text-rose-200">{error}</p>
        </div>
      )}

      {tapToPlayMessageId && (
        <div className="border-t border-amber-400/20 bg-amber-500/10 px-4 py-2">
          <p className="text-center text-xs text-amber-100">
            Auto-play was blocked. Tap <strong>Play voice</strong> on the message above, or tap anywhere on this screen to try again.
          </p>
        </div>
      )}

      {/* Input / meetup CTA */}
      <div className="border-t bg-background px-4 py-3 safe-area-inset-bottom">
        {turnsRemaining <= 0 ? (
          <div className="text-center space-y-3 py-2">
            <p className="text-sm font-medium text-foreground">
              Enjoyed the preview? Go deeper in a full session.
            </p>
            <Button
              onClick={() => {
                onClose();
                window.location.href = `/book?expertId=${expertId}`;
              }}
              className="w-full bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700"
            >
              <Calendar className="h-4 w-4 mr-2" />
              Schedule a meetup with {firstName}
            </Button>
            <button
              onClick={onClose}
              className="text-xs text-muted-foreground underline underline-offset-2"
            >
              Maybe later
            </button>
          </div>
        ) : (
          <div className="flex items-end gap-2">
            <div className="flex-1 relative">
              <input
                type="text"
                value={textInput}
                onChange={(e) => setTextInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    sendText();
                  }
                }}
                placeholder={recording ? "Recording..." : `Ask ${firstName} anything...`}
                disabled={processing || recording}
                className="w-full rounded-full border bg-muted/50 px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50"
              />
            </div>

            {textInput.trim() && !recording && (
              <Button
                size="icon"
                onClick={() => sendText()}
                disabled={processing}
                className="h-10 w-10 rounded-full bg-indigo-600 hover:bg-indigo-700 shrink-0"
              >
                <Send className="h-4 w-4" />
              </Button>
            )}

            {!textInput.trim() && (
              <Button
                size="icon"
                onClick={recording ? stopRecording : startRecording}
                disabled={processing}
                className={cn(
                  "h-10 w-10 rounded-full shrink-0 transition-all",
                  recording
                    ? "bg-red-500 hover:bg-red-600 animate-pulse"
                    : "bg-indigo-600 hover:bg-indigo-700",
                )}
              >
                {recording ? (
                  <Square className="h-4 w-4" />
                ) : (
                  <Mic className="h-4 w-4" />
                )}
              </Button>
            )}
          </div>
        )}

        {recording && (
          <p className="text-center text-xs text-red-500 mt-1.5 tabular-nums">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-red-500 mr-1 animate-pulse" />
            Recording {formatTime(elapsed)}
          </p>
        )}
      </div>
    </div>
  );
}
