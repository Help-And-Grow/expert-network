"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { Mic, MicOff, Phone, PhoneOff, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { isTelegramMiniApp } from "@/lib/telegram";

type IAgoraRTCClient = import("agora-rtc-sdk-ng").IAgoraRTCClient;
type IMicrophoneAudioTrack = import("agora-rtc-sdk-ng").IMicrophoneAudioTrack;

interface VoiceChatModalProps {
  expertId: string;
  expertName: string;
  onClose: () => void;
}

type CallState = "connecting" | "connected" | "ending" | "ended" | "error";

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

  const clientRef = useRef<IAgoraRTCClient | null>(null);
  const trackRef = useRef<IMicrophoneAudioTrack | null>(null);
  const channelRef = useRef<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const cleanup = useCallback(async () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
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

  const endCall = useCallback(async () => {
    if (callState === "ending" || callState === "ended") return;
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
  }, [callState, cleanup]);

  useEffect(() => {
    let cancelled = false;

    async function startCall() {
      try {
        const startRes = await fetch("/api/voice-chat/start", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ expertId }),
        });

        if (!startRes.ok) {
          const data = await startRes.json().catch(() => ({}));
          throw new Error(data.error || `Server error ${startRes.status}`);
        }

        const { channelName, token, uid, appId, maxDurationSeconds } =
          await startRes.json();

        if (cancelled) return;

        channelRef.current = channelName;
        if (maxDurationSeconds) setMaxDuration(maxDurationSeconds);

        const AgoraRTC = (await import("agora-rtc-sdk-ng")).default;

        if (cancelled) return;

        const client = AgoraRTC.createClient({ mode: "rtc", codec: "vp8" });
        clientRef.current = client;

        await client.join(appId, channelName, token, uid);
        if (cancelled) return;

        if (isTelegramMiniApp()) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const webApp = (window as any).Telegram?.WebApp;
          if (webApp?.requestWriteAccess) {
            await webApp.requestWriteAccess().catch(() => {});
          }
        }

        const micTrack = await AgoraRTC.createMicrophoneAudioTrack();
        trackRef.current = micTrack;
        if (cancelled) return;

        await client.publish([micTrack]);
        if (cancelled) return;

        client.on("user-published", async (user, mediaType) => {
          await client.subscribe(user, mediaType);
          if (mediaType === "audio") {
            user.audioTrack?.play();
          }
        });

        setCallState("connected");

        const startTime = Date.now();
        timerRef.current = setInterval(() => {
          const secs = Math.floor((Date.now() - startTime) / 1000);
          setElapsed(secs);
          if (secs >= (maxDurationSeconds || 300)) {
            endCall();
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

    startCall();

    return () => {
      cancelled = true;
      cleanup();
    };
    // Only run on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleMute = useCallback(() => {
    if (!trackRef.current) return;
    const newMuted = !muted;
    trackRef.current.setEnabled(!newMuted);
    setMuted(newMuted);
  }, [muted]);

  const remaining = Math.max(0, maxDuration - elapsed);
  const isLowTime = remaining <= 30;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-sm mx-4 rounded-2xl bg-background shadow-2xl overflow-hidden">
        {/* Header */}
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
                  : `AI ${expertName}`}
          </h3>
          <p className="mt-1 text-sm text-white/80">
            {callState === "connected"
              ? "Voice Chat · Free Preview"
              : callState === "connecting"
                ? "Setting up AI voice agent..."
                : callState === "error"
                  ? error
                  : "Thank you for chatting"}
          </p>
        </div>

        {/* Timer */}
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
            <p className="text-xs text-muted-foreground mt-1">remaining</p>

            {/* Audio wave animation */}
            <div className="mt-4 flex items-center justify-center gap-1">
              {Array.from({ length: 5 }).map((_, i) => (
                <div
                  key={i}
                  className={cn(
                    "w-1 rounded-full bg-indigo-500 transition-all",
                    muted ? "h-1" : "animate-pulse",
                  )}
                  style={{
                    height: muted ? 4 : `${12 + Math.random() * 20}px`,
                    animationDelay: `${i * 150}ms`,
                  }}
                />
              ))}
            </div>
          </div>
        )}

        {/* Connecting state */}
        {callState === "connecting" && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-8 w-8 animate-spin text-indigo-500" />
          </div>
        )}

        {/* Controls */}
        <div className="px-6 pb-6 flex items-center justify-center gap-6">
          {callState === "connected" && (
            <>
              <Button
                variant="outline"
                size="icon"
                className={cn(
                  "h-14 w-14 rounded-full",
                  muted && "bg-red-100 border-red-300 text-red-600",
                )}
                onClick={toggleMute}
              >
                {muted ? (
                  <MicOff className="h-5 w-5" />
                ) : (
                  <Mic className="h-5 w-5" />
                )}
              </Button>
              <Button
                variant="destructive"
                size="icon"
                className="h-14 w-14 rounded-full"
                onClick={endCall}
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
                cleanup();
                setCallState("ended");
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
