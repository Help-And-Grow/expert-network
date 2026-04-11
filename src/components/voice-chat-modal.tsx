"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { Loader2, Mic, MicOff, Phone, PhoneOff } from "lucide-react";

import { Button } from "@/components/ui/button";
import { resumeSharedAudioContext } from "@/lib/audio-unlock";
import { cn } from "@/lib/utils";

type IAgoraRTCClient = import("agora-rtc-sdk-ng").IAgoraRTCClient;
type IMicrophoneAudioTrack = import("agora-rtc-sdk-ng").IMicrophoneAudioTrack;

interface VoiceChatModalProps {
  expertId: string;
  expertName: string;
  onClose: () => void;
}

type CallState = "connecting" | "connected" | "ending" | "ended" | "error";
type RealtimeBackend = "ten" | "agora";
type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  audioSrc?: string;
};

function formatTimer(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function VoiceChatModal({
  expertId,
  expertName,
  onClose,
}: VoiceChatModalProps) {
  const [callState, setCallState] = useState<CallState>("connecting");
  const [error, setError] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [maxDuration, setMaxDuration] = useState(300);
  const [backend, setBackend] = useState<RealtimeBackend>("ten");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [recording, setRecording] = useState(false);
  const [processingTurn, setProcessingTurn] = useState(false);
  const [turnInfo, setTurnInfo] = useState({ count: 0, max: 10 });
  const [tapToPlayMessageId, setTapToPlayMessageId] = useState<string | null>(null);

  const clientRef = useRef<IAgoraRTCClient | null>(null);
  const trackRef = useRef<IMicrophoneAudioTrack | null>(null);
  const channelRef = useRef<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const msgIdRef = useRef(0);
  const pendingAutoplayRef = useRef<{ src: string; msgId: string } | null>(null);
  const endingRef = useRef(false);
  const endCallRef = useRef<() => Promise<void>>(async () => {});

  const nextMessageId = useCallback(() => `rt-msg-${++msgIdRef.current}`, []);

  const cleanup = useCallback(async () => {
    if (recorderRef.current) {
      recorderRef.current.ondataavailable = null;
      recorderRef.current.onstop = null;
      if (recorderRef.current.state !== "inactive") {
        recorderRef.current.stop();
      }
      recorderRef.current = null;
    }

    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    if (audioRef.current) {
      audioRef.current.onended = null;
      audioRef.current.onpause = null;
      audioRef.current.onerror = null;
      audioRef.current.pause();
      audioRef.current.removeAttribute("src");
      audioRef.current.load();
      audioRef.current = null;
    }

    if (trackRef.current) {
      trackRef.current.close();
      trackRef.current = null;
    }

    if (clientRef.current) {
      await clientRef.current.leave().catch(() => {});
      clientRef.current = null;
    }
  }, []);

  const playAssistantAudio = useCallback((src: string, msgId: string) => {
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

    const clearPending = () => setTapToPlayMessageId(null);
    audio.onended = clearPending;
    audio.onpause = clearPending;
    audio.onerror = () => {
      pendingAutoplayRef.current = { src, msgId };
      setTapToPlayMessageId(msgId);
    };

    void audio
      .play()
      .then(() => {
        pendingAutoplayRef.current = null;
        setTapToPlayMessageId(null);
      })
      .catch(() => {
        pendingAutoplayRef.current = { src, msgId };
        setTapToPlayMessageId(msgId);
      });
  }, []);

  const fetchGreeting = useCallback(async () => {
    try {
      const res = await fetch("/api/voice-chat/greeting", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expertId }),
      });
      const data = (await res.json()) as {
        replyText?: string;
        replyAudio?: string;
      };
      if (!res.ok || !data.replyText) return;

      const id = nextMessageId();
      setMessages([{ id, role: "assistant", text: data.replyText, audioSrc: data.replyAudio }]);
      if (data.replyAudio) {
        playAssistantAudio(data.replyAudio, id);
      }
    } catch {
      // Greeting failure should not block the call UI.
    }
  }, [expertId, nextMessageId, playAssistantAudio]);

  const endCall = useCallback(async () => {
    if (endingRef.current) return;
    endingRef.current = true;
    setCallState("ending");

    const channelName = channelRef.current;
    await cleanup();

    if (channelName) {
      await fetch("/api/voice-chat/stop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channelName }),
      }).catch(() => {});
    }

    setCallState("ended");
  }, [cleanup]);

  useEffect(() => {
    endCallRef.current = endCall;
  }, [endCall]);

  useEffect(() => {
    let cancelled = false;

    async function startCall() {
      try {
        const startRes = await fetch("/api/voice-chat/start", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ expertId }),
        });

        const startData = (await startRes.json().catch(() => ({}))) as {
          error?: string;
          channelName?: string;
          token?: string;
          uid?: number;
          appId?: string;
          maxDurationSeconds?: number;
          backend?: RealtimeBackend;
        };

        if (!startRes.ok) {
          throw new Error(startData.error || `Server error ${startRes.status}`);
        }
        if (
          !startData.channelName ||
          !startData.token ||
          !startData.appId ||
          typeof startData.uid !== "number"
        ) {
          throw new Error("Voice session response was incomplete");
        }

        if (cancelled) return;

        const selectedBackend = startData.backend ?? "ten";
        setBackend(selectedBackend);
        channelRef.current = startData.channelName;
        if (startData.maxDurationSeconds) {
          setMaxDuration(startData.maxDurationSeconds);
        }

        const AgoraRTC = (await import("agora-rtc-sdk-ng")).default;
        if (cancelled) return;

        const client = AgoraRTC.createClient({ mode: "rtc", codec: "vp8" });
        clientRef.current = client;

        await client.join(
          startData.appId,
          startData.channelName,
          startData.token,
          startData.uid,
        );
        if (cancelled) return;

        const micTrack = await AgoraRTC.createMicrophoneAudioTrack();
        trackRef.current = micTrack;
        if (cancelled) return;

        client.on("user-published", async (user, mediaType) => {
          await client.subscribe(user, mediaType);
          if (mediaType === "audio") {
            user.audioTrack?.play();
          }
        });

        if (selectedBackend === "ten") {
          await client.publish([micTrack]);
          if (cancelled) return;
        } else {
          setMessages([]);
          void fetchGreeting();
        }

        setCallState("connected");

        const startTime = Date.now();
        timerRef.current = setInterval(() => {
          const secs = Math.floor((Date.now() - startTime) / 1000);
          setElapsed(secs);
          if (secs >= (startData.maxDurationSeconds || 300)) {
            void endCallRef.current();
          }
        }, 1000);
      } catch (err) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : "Connection failed";
        console.error("[voice-chat] Start failed:", msg);
        setError(msg);
        setCallState("error");
      }
    }

    void startCall();

    return () => {
      cancelled = true;
      void cleanup();
    };
  }, [cleanup, expertId, fetchGreeting]);

  const toggleMute = useCallback(() => {
    if (!trackRef.current) return;
    const newMuted = !muted;
    void trackRef.current.setEnabled(!newMuted);
    setMuted(newMuted);
  }, [muted]);

  const sendRecordedTurn = useCallback(
    async (blob: Blob) => {
      const userMsgId = nextMessageId();
      setProcessingTurn(true);
      setError(null);

      try {
        const form = new FormData();
        form.set("expertId", expertId);
        form.set("audio", blob, "voice-turn.webm");

        const res = await fetch("/api/voice-chat/message", {
          method: "POST",
          body: form,
        });
        const data = (await res.json()) as {
          error?: string;
          userText?: string;
          replyText?: string;
          replyAudio?: string;
          turnCount?: number;
          maxTurns?: number;
        };

        if (!res.ok) {
          throw new Error(data.error || `Server error ${res.status}`);
        }

        const assistantMsgId = nextMessageId();
        setMessages((prev) => [
          ...prev,
          { id: userMsgId, role: "user", text: data.userText || "Voice message" },
          {
            id: assistantMsgId,
            role: "assistant",
            text: data.replyText || "",
            audioSrc: data.replyAudio,
          },
        ]);
        if (typeof data.turnCount === "number" && typeof data.maxTurns === "number") {
          setTurnInfo({ count: data.turnCount, max: data.maxTurns });
        }
        if (data.replyAudio) {
          playAssistantAudio(data.replyAudio, assistantMsgId);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Could not process voice turn";
        console.error("[voice-chat] Agora turn failed:", msg);
        setError(msg);
      } finally {
        setProcessingTurn(false);
      }
    },
    [expertId, nextMessageId, playAssistantAudio],
  );

  const toggleRecording = useCallback(() => {
    if (backend !== "agora" || !trackRef.current) return;
    if (typeof MediaRecorder === "undefined") {
      setError("This browser does not support in-call voice capture.");
      return;
    }
    if (muted) {
      setError("Unmute the microphone before speaking.");
      return;
    }
    if (processingTurn) return;

    if (recording) {
      recorderRef.current?.stop();
      return;
    }

    const streamTrack = trackRef.current.getMediaStreamTrack();
    const mimeType =
      typeof MediaRecorder !== "undefined" &&
      MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : "";

    const recorder = mimeType
      ? new MediaRecorder(new MediaStream([streamTrack]), { mimeType })
      : new MediaRecorder(new MediaStream([streamTrack]));

    chunksRef.current = [];
    recorderRef.current = recorder;
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        chunksRef.current.push(event.data);
      }
    };
    recorder.onstop = () => {
      setRecording(false);
      const blob = new Blob(chunksRef.current, {
        type: recorder.mimeType || "audio/webm",
      });
      chunksRef.current = [];
      recorderRef.current = null;
      if (blob.size > 0) {
        void sendRecordedTurn(blob);
      }
    };

    recorder.start();
    setRecording(true);
    setError(null);
  }, [backend, muted, processingTurn, recording, sendRecordedTurn]);

  const onModalPointerDownCapture = useCallback(
    (event: React.PointerEvent) => {
      if ((event.target as HTMLElement).closest("button, a")) return;
      resumeSharedAudioContext();
      const pending = pendingAutoplayRef.current;
      if (pending) {
        playAssistantAudio(pending.src, pending.msgId);
      }
    },
    [playAssistantAudio],
  );

  const remaining = Math.max(0, maxDuration - elapsed);
  const isLowTime = remaining <= 30;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onPointerDownCapture={onModalPointerDownCapture}
    >
      <div className="surface-card mx-4 w-full max-w-md overflow-hidden">
        <div className="bg-gradient-to-r from-indigo-600 to-purple-600 px-6 py-5 text-center text-white">
          <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-white/20">
            <Phone className="h-7 w-7" />
          </div>
          <h3 className="text-lg font-semibold">
            {callState === "connecting"
              ? "Connecting..."
              : callState === "error"
                  ? "Connection Failed"
                  : callState === "ended" || callState === "ending"
                    ? "Call Ended"
                  : expertName}
          </h3>
          <p className="mt-1 text-sm text-white/80">
            {callState === "connected"
              ? backend === "agora"
                ? "Live Voice · Free Preview"
                : "Live Voice · Free Preview"
              : callState === "connecting"
                ? "Connecting voice session..."
                : callState === "error"
                  ? error
                  : "Thank you for chatting"}
          </p>
        </div>

        {callState === "connected" && (
          <div className="px-6 py-4 text-center">
            <div
              className={cn(
                "text-3xl font-mono font-bold tabular-nums",
                isLowTime ? "text-red-500" : "text-foreground",
              )}
            >
              {formatTimer(remaining)}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">remaining</p>

            <div className="mt-4 flex items-center justify-center gap-1">
              {Array.from({ length: 5 }).map((_, i) => (
                <div
                  key={i}
                  className={cn(
                    "w-1 rounded-full bg-indigo-500 transition-all",
                    muted || processingTurn ? "h-1" : "animate-pulse",
                  )}
                  style={{
                    height: muted || processingTurn ? 4 : `${12 + Math.random() * 20}px`,
                    animationDelay: `${i * 150}ms`,
                  }}
                />
              ))}
            </div>
          </div>
        )}

        {backend === "agora" && callState === "connected" && (
          <div className="border-t border-border/80 bg-card/70 px-4 py-4">
            <div className="mb-3 flex items-center justify-between text-xs text-muted-foreground">
              <span>
                Turns {turnInfo.count}/{turnInfo.max}
              </span>
              <span>{recording ? "Listening..." : processingTurn ? "Thinking..." : "Tap to speak"}</span>
            </div>

            <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
              {messages.map((message) => (
                <div
                  key={message.id}
                  className={cn(
                    "rounded-2xl px-3 py-2 text-sm shadow-sm",
                    message.role === "assistant"
                      ? "border border-border/80 bg-background/80 text-foreground"
                      : "bg-indigo-600 text-white",
                  )}
                >
                  <p>{message.text}</p>
                  {message.audioSrc && tapToPlayMessageId === message.id && (
                    <button
                      className="mt-2 rounded-full border border-current px-2 py-1 text-[11px]"
                      onClick={() => playAssistantAudio(message.audioSrc!, message.id)}
                    >
                      Tap to play audio
                    </button>
                  )}
                </div>
              ))}
              {messages.length === 0 && (
                <div className="rounded-2xl border border-border/80 bg-background/80 px-3 py-3 text-sm text-muted-foreground shadow-sm">
                  The expert avatar will greet you here and reply with voice plus transcript.
                </div>
              )}
            </div>

            {error && <p className="mt-3 text-xs text-red-600">{error}</p>}
          </div>
        )}

        {callState === "connecting" && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-8 w-8 animate-spin text-indigo-500" />
          </div>
        )}

        <div className="flex items-center justify-center gap-4 px-6 pb-6">
          {callState === "connected" && (
            <>
              <Button
                variant="outline"
                size="icon"
                className={cn(
                  "h-14 w-14 rounded-full",
                  muted && "border-red-300 bg-red-100 text-red-600",
                )}
                onClick={toggleMute}
              >
                {muted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
              </Button>

              {backend === "agora" && (
                <Button
                  variant={recording ? "default" : "outline"}
                  className={cn(
                    "h-14 rounded-full px-5",
                    recording && "bg-indigo-600 hover:bg-indigo-600/90",
                  )}
                  onClick={toggleRecording}
                  disabled={processingTurn}
                >
                  {processingTurn ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : recording ? (
                    "Stop & send"
                  ) : (
                    "Speak"
                  )}
                </Button>
              )}

              <Button
                variant="destructive"
                size="icon"
                className="h-14 w-14 rounded-full"
                onClick={() => void endCall()}
              >
                <PhoneOff className="h-5 w-5" />
              </Button>
            </>
          )}

          {(callState === "ended" || callState === "ending") && (
            <Button onClick={onClose} className="w-full">
              Close
            </Button>
          )}

          {callState === "error" && (
            <Button variant="outline" onClick={onClose} className="w-full">
              Close
            </Button>
          )}

          {callState === "connecting" && (
            <Button
              variant="outline"
              onClick={() => {
                void cleanup();
                onClose();
              }}
            >
              Cancel
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
