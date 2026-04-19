"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";

import { Pause, Play, Volume2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type AudioPlayerHandle = {
  pause: () => void;
};

interface AudioPlayerProps {
  src: string;
  label?: string;
  className?: string;
}

function resolveFetchUrl(src: string): string {
  const t = src.trim();
  if (t.startsWith("http://") || t.startsWith("https://")) return t;
  if (typeof window === "undefined") return t;
  return new URL(t, window.location.origin).href;
}

export const AudioPlayer = forwardRef<AudioPlayerHandle, AudioPlayerProps>(function AudioPlayer(
  { src, label, className },
  ref,
) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const blobUrlRef = useRef<string | null>(null);
  const [resolvedSrc, setResolvedSrc] = useState<string | null>(null);
  const [mediaLoading, setMediaLoading] = useState(true);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);

  const syncDuration = useCallback(() => {
    const el = audioRef.current;
    if (!el) return;
    const d = el.duration;
    if (Number.isFinite(d) && d > 0) {
      setDuration(d);
      setLoadError(null);
    }
  }, []);

  useEffect(() => {
    setLoadError(null);
    setDuration(0);
    setProgress(0);
    setIsPlaying(false);
    setMediaLoading(true);
    setResolvedSrc(null);

    const trimmed = src.trim();
    if (!trimmed) {
      setMediaLoading(false);
      setLoadError("Could not load this audio file.");
      return;
    }

    if (trimmed.startsWith("data:") || trimmed.startsWith("blob:")) {
      setResolvedSrc(trimmed);
      setMediaLoading(false);
      return;
    }

    const ac = new AbortController();

    const revoke = () => {
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }
    };

    revoke();

    void (async () => {
      try {
        const res = await fetch(resolveFetchUrl(trimmed), {
          credentials: "include",
          signal: ac.signal,
        });
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const blob = await res.blob();
        if (ac.signal.aborted) return;
        const objectUrl = URL.createObjectURL(blob);
        blobUrlRef.current = objectUrl;
        setResolvedSrc(objectUrl);
      } catch (e: unknown) {
        if (ac.signal.aborted || (e instanceof DOMException && e.name === "AbortError")) return;
        console.warn("[AudioPlayer] fetch failed", e);
        setLoadError("Could not load this audio file.");
      } finally {
        if (!ac.signal.aborted) {
          setMediaLoading(false);
        }
      }
    })();

    return () => {
      ac.abort();
      revoke();
    };
  }, [src]);

  useImperativeHandle(
    ref,
    () => ({
      pause: () => {
        audioRef.current?.pause();
      },
    }),
    [],
  );

  const toggle = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || loadError || !resolvedSrc || mediaLoading) return;
    if (isPlaying) {
      audio.pause();
    } else {
      void audio.play().catch((err: unknown) => {
        console.warn("[AudioPlayer] play() rejected", err);
        setLoadError("Playback was blocked or the file could not be played. Try refreshing.");
        setIsPlaying(false);
      });
    }
  }, [isPlaying, loadError, resolvedSrc, mediaLoading]);

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  return (
    <div
      className={cn(
        "surface-tint flex items-center gap-3 px-4 py-3",
        className
      )}
    >
      <audio
        ref={audioRef}
        src={resolvedSrc ?? undefined}
        preload="auto"
        onLoadedMetadata={syncDuration}
        onLoadedData={syncDuration}
        onCanPlay={syncDuration}
        onDurationChange={syncDuration}
        onTimeUpdate={() => {
          if (audioRef.current) {
            setProgress(audioRef.current.currentTime);
          }
        }}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onEnded={() => {
          setIsPlaying(false);
          setProgress(0);
        }}
        onError={() => {
          const mediaErr = audioRef.current?.error;
          if (mediaErr?.code === MediaError.MEDIA_ERR_ABORTED) return;
          console.warn("[AudioPlayer] error", mediaErr?.code, mediaErr?.message);
          setLoadError("Could not load this audio file.");
          setDuration(0);
          setIsPlaying(false);
        }}
      />

      <Button
        variant="ghost"
        size="icon"
        className="h-10 w-10 shrink-0 rounded-full bg-indigo-600 text-white hover:bg-indigo-700 hover:text-white"
        onClick={toggle}
        disabled={Boolean(loadError) || mediaLoading || !resolvedSrc}
        aria-busy={mediaLoading}
      >
        {isPlaying ? (
          <Pause className="h-4 w-4" />
        ) : (
          <Play className="h-4 w-4 ml-0.5" />
        )}
      </Button>

      <div className="flex-1 min-w-0">
        {label && (
          <p className="text-sm font-medium text-foreground truncate">
            {label}
          </p>
        )}
        {mediaLoading && !loadError && (
          <p className="text-xs text-muted-foreground mt-0.5">Loading audio…</p>
        )}
        {loadError && (
          <p className="text-xs text-destructive mt-0.5">{loadError}</p>
        )}
        <div className="flex items-center gap-2">
          <div className="flex-1 h-1.5 overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-indigo-500 transition-all duration-200"
              style={{
                width: duration ? `${(progress / duration) * 100}%` : "0%",
              }}
            />
          </div>
          <span className="text-xs text-muted-foreground tabular-nums whitespace-nowrap">
            {formatTime(progress)}/{formatTime(duration)}
          </span>
        </div>
      </div>

      <Volume2 className="h-4 w-4 shrink-0 text-muted-foreground" />
    </div>
  );
});
