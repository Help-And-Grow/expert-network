"use client";

import { forwardRef, useCallback, useImperativeHandle, useRef, useState } from "react";

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
    if (!audio) return;
    if (isPlaying) {
      audio.pause();
    } else {
      audio.play();
    }
  }, [isPlaying]);

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-xl border bg-gradient-to-r from-indigo-50 to-purple-50 px-4 py-3",
        className
      )}
    >
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onLoadedMetadata={() => {
          if (audioRef.current) setDuration(audioRef.current.duration);
        }}
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
          <p className="text-sm font-medium text-slate-700 truncate">
            {label}
          </p>
        )}
        <div className="flex items-center gap-2">
          <div className="flex-1 h-1.5 rounded-full bg-slate-200 overflow-hidden">
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
