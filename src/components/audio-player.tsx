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

export const AudioPlayer = forwardRef<AudioPlayerHandle, AudioPlayerProps>(function AudioPlayer(
  { src, label, className },
  ref,
) {
  const audioRef = useRef<HTMLAudioElement>(null);
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
    const el = audioRef.current;
    if (el) {
      el.load();
    }
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

  const playWhenReady = useCallback((audio: HTMLAudioElement) => {
    const run = () =>
      audio.play().catch((err: unknown) => {
        console.warn("[AudioPlayer] play() rejected", err);
        setLoadError("Playback was blocked or the file could not be played. Try refreshing.");
        setIsPlaying(false);
      });

    const tryPlay = () => {
      if (audio.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) {
        void run();
        return true;
      }
      return false;
    };

    if (tryPlay()) return;

    const onCanPlay = () => {
      audio.removeEventListener("canplay", onCanPlay);
      audio.removeEventListener("error", onError);
      void run();
    };
    const onError = () => {
      audio.removeEventListener("canplay", onCanPlay);
      audio.removeEventListener("error", onError);
    };
    audio.addEventListener("canplay", onCanPlay, { once: true });
    audio.addEventListener("error", onError, { once: true });

    queueMicrotask(() => {
      if (tryPlay()) {
        audio.removeEventListener("canplay", onCanPlay);
        audio.removeEventListener("error", onError);
      }
    });
  }, []);

  const toggle = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || loadError) return;
    if (isPlaying) {
      audio.pause();
    } else {
      playWhenReady(audio);
    }
  }, [isPlaying, loadError, playWhenReady]);

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
        src={src}
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
          // Ignore abort from `load()` / src swap during React updates.
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
