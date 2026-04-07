"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  Mic,
  Square,
  Play,
  Pause,
  Loader2,
  X,
  Send,
  MessageCircle,
} from "lucide-react";

import { Button } from "@/components/ui/button";
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
  /** When false, TTS uses a built-in default voice while the persona stays this expert. */
  hasClonedVoice?: boolean;
  open: boolean;
  onClose: () => void;
}

export function VoiceChatPanel({
  expertId,
  expertName,
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

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const msgIdRef = useRef(0);

  const nextId = () => `msg-${++msgIdRef.current}`;

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

  const startRecording = useCallback(async () => {
    try {
      setError(null);
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
  }, []);

  const stopRecording = useCallback(() => {
    mediaRecorderRef.current?.stop();
    if (timerRef.current) clearInterval(timerRef.current);
    setRecording(false);
  }, []);

  const sendVoice = useCallback(
    async (blob: Blob) => {
      setProcessing(true);
      setError(null);
      const userMsg: Message = {
        id: nextId(),
        role: "user",
        text: "...",
      };
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

        playAudio(data.replyAudio, aiMsg.id);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Something went wrong";
        setError(msg);
        setMessages((prev) => prev.filter((m) => m.id !== userMsg.id));
      } finally {
        setProcessing(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [expertId],
  );

  const sendText = useCallback(async () => {
    const text = textInput.trim();
    if (!text || processing) return;
    setTextInput("");
    setProcessing(true);
    setError(null);

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

      playAudio(data.replyAudio, aiMsg.id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Something went wrong";
      setError(msg);
    } finally {
      setProcessing(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expertId, textInput, processing]);

  const playAudio = useCallback(
    (src: string, msgId: string) => {
      if (audioRef.current) {
        audioRef.current.pause();
      }
      const audio = new Audio(src);
      audioRef.current = audio;
      setPlayingId(msgId);
      audio.onended = () => setPlayingId(null);
      audio.onpause = () => setPlayingId(null);
      audio.play().catch(() => setPlayingId(null));
    },
    [],
  );

  const togglePlayback = useCallback(
    (msg: Message) => {
      if (!msg.audioSrc) return;
      if (playingId === msg.id) {
        audioRef.current?.pause();
        setPlayingId(null);
      } else {
        playAudio(msg.audioSrc, msg.id);
      }
    },
    [playingId, playAudio],
  );

  const formatTime = (s: number) =>
    `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;

  if (!open) return null;

  const turnsRemaining = turnInfo.max - turnInfo.count;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-4 py-3 bg-gradient-to-r from-indigo-600 to-purple-600 text-white">
        <div className="flex items-center gap-2">
          <MessageCircle className="h-5 w-5" />
          <div>
            <h3 className="text-sm font-semibold">AI {expertName}</h3>
            <p className="text-xs text-white/70">
              {turnsRemaining > 0
                ? `${turnsRemaining} messages remaining`
                : "Limit reached"}
            </p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="rounded-full p-1.5 hover:bg-white/20 transition-colors"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground">
            <MessageCircle className="h-12 w-12 mb-3 opacity-20" />
            <p className="text-sm font-medium">Voice chat with AI {expertName}</p>
            <p className="text-xs mt-1 max-w-[250px]">
              Record a voice message or type to start.{" "}
              {hasClonedVoice
                ? `The AI will respond in ${expertName}'s voice.`
                : `The AI answers as ${expertName} using a standard voice.`}
            </p>
          </div>
        )}

        {messages.map((msg) => (
          <div
            key={msg.id}
            className={cn(
              "flex gap-2 max-w-[85%]",
              msg.role === "user" ? "ml-auto flex-row-reverse" : "mr-auto",
            )}
          >
            <div
              className={cn(
                "rounded-2xl px-3.5 py-2.5 text-sm",
                msg.role === "user"
                  ? "bg-indigo-600 text-white rounded-tr-sm"
                  : "bg-muted rounded-tl-sm",
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
                      : "bg-indigo-100 hover:bg-indigo-200 text-indigo-700",
                  )}
                >
                  {playingId === msg.id ? (
                    <Pause className="h-3 w-3" />
                  ) : (
                    <Play className="h-3 w-3" />
                  )}
                  {playingId === msg.id ? "Pause" : "Play voice"}
                </button>
              )}
            </div>
          </div>
        ))}

        {processing && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground mr-auto">
            <div className="bg-muted rounded-2xl rounded-tl-sm px-3.5 py-2.5 flex items-center gap-2">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Thinking...
            </div>
          </div>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="px-4 py-2 bg-red-50 border-t border-red-200">
          <p className="text-xs text-red-600">{error}</p>
        </div>
      )}

      {/* Input area */}
      <div className="border-t bg-background px-4 py-3 safe-area-inset-bottom">
        {turnsRemaining <= 0 ? (
          <p className="text-center text-sm text-muted-foreground">
            Message limit reached. Book a full session for more.
          </p>
        ) : (
          <div className="flex items-end gap-2">
            {/* Text input */}
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
                placeholder="Type a message..."
                disabled={processing || recording}
                className="w-full rounded-full border bg-muted/50 px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50"
              />
            </div>

            {/* Send text */}
            {textInput.trim() && !recording && (
              <Button
                size="icon"
                onClick={sendText}
                disabled={processing}
                className="h-10 w-10 rounded-full bg-indigo-600 hover:bg-indigo-700 shrink-0"
              >
                <Send className="h-4 w-4" />
              </Button>
            )}

            {/* Record voice */}
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
