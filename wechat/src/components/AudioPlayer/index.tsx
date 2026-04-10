import { View, Text } from "@tarojs/components";
import Taro from "@tarojs/taro";
import { useEffect, useMemo, useRef, useState } from "react";

import { logToVercel } from "../../shared/debug-log";
import { prepareAudioForInnerAudio } from "../../shared/wechat-audio";
import "./index.scss";

interface Props {
  src: string;
  label?: string;
}

type AudioStatus = "loading" | "ready" | "playing" | "error";

export default function AudioPlayer({ src, label }: Props) {
  const [status, setStatus] = useState<AudioStatus>("loading");
  const [progress, setProgress] = useState(0);
  const [hint, setHint] = useState("正在准备语音...");
  const ctxRef = useRef<Taro.InnerAudioContext | null>(null);
  const canPlayRef = useRef(false);
  const progressRef = useRef(0);
  const playbackWatchRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cacheKey = useMemo(
    () => `intro_${src.replace(/[^a-zA-Z0-9_-]/g, "_").slice(-56)}`,
    [src],
  );

  useEffect(() => {
    let cancelled = false;

    setStatus("loading");
    setProgress(0);
    progressRef.current = 0;
    setHint("正在准备语音...");
    canPlayRef.current = false;

    ctxRef.current?.destroy();
    ctxRef.current = null;

    void (async () => {
      try {
        const localPath = await prepareAudioForInnerAudio(src, cacheKey);
        if (cancelled) return;

        const audio = Taro.createInnerAudioContext();
        audio.obeyMuteSwitch = false;
        audio.autoplay = false;
        audio.src = localPath;

        audio.onCanplay(() => {
          canPlayRef.current = true;
          setStatus((prev) => (prev === "playing" ? prev : "ready"));
          setHint("点击播放");
        });
        audio.onPlay(() => {
          setStatus("playing");
          setHint("播放中");
        });
        audio.onPause(() => {
          setStatus("ready");
          setHint("已暂停，点击继续播放");
        });
        audio.onStop(() => {
          setStatus("ready");
          setProgress(0);
          progressRef.current = 0;
          setHint("点击重新播放");
        });
        audio.onEnded(() => {
          setStatus("ready");
          setProgress(0);
          progressRef.current = 0;
          setHint("已播放完成，点击重新播放");
        });
        audio.onTimeUpdate(() => {
          if (audio.duration > 0) {
            const nextProgress = audio.currentTime / audio.duration;
            progressRef.current = nextProgress;
            setProgress(nextProgress);
          }
          if (audio.currentTime > 0.8 && !canPlayRef.current) {
            setStatus("error");
            setHint("语音已加载但播放异常，请重试");
          }
        });
        audio.onError((err) => {
          console.error("[AudioPlayer] playback", err);
          logToVercel("error", "AudioPlayer playback", err);
          setStatus("error");
          setHint("语音播放失败，请检查 downloadFile / request 合法域名");
        });

        ctxRef.current = audio;
        setStatus("ready");
        setHint("点击播放");
      } catch (err) {
        logToVercel("error", "AudioPlayer prepareAudio", err);
        if (cancelled) return;
        setStatus("error");
        setHint("语音加载失败，请检查网络与小程序后台域名配置");
      }
    })();

    return () => {
      cancelled = true;
      if (playbackWatchRef.current) {
        clearTimeout(playbackWatchRef.current);
        playbackWatchRef.current = null;
      }
      ctxRef.current?.destroy();
      ctxRef.current = null;
    };
  }, [cacheKey, src]);

  const toggle = () => {
    const audio = ctxRef.current;
    if (!audio || status === "loading") {
      Taro.showToast({ title: "语音仍在准备中", icon: "none" });
      return;
    }

    if (status === "error") {
      Taro.showToast({
        title: "语音暂不可用，请检查域名或重新进入页面",
        icon: "none",
      });
      return;
    }

    if (status === "playing") {
      audio.pause();
      return;
    }

    audio.play();
    if (playbackWatchRef.current) clearTimeout(playbackWatchRef.current);
    playbackWatchRef.current = setTimeout(() => {
      if (!canPlayRef.current || progressRef.current === 0) {
        setStatus("error");
        setHint("没有成功输出语音，请重试或检查音频域名配置");
      }
    }, 2200);
  };

  return (
    <View className="audio-player" onClick={toggle}>
      <View className={`audio-player__icon audio-player__icon--${status}`}>
        {status === "loading" ? "…" : status === "playing" ? "⏸" : status === "error" ? "⚠" : "▶"}
      </View>
      <View className="audio-player__content">
        {label && <Text className="audio-player__label">{label}</Text>}
        <Text className="audio-player__status">{hint}</Text>
        <View className="audio-player__bar">
          <View
            className="audio-player__progress"
            style={{ width: `${Math.min(progress * 100, 100)}%` }}
          />
        </View>
      </View>
    </View>
  );
}
