import { View, Text } from "@tarojs/components";
import Taro from "@tarojs/taro";
import { useState, useEffect, useRef, useMemo } from "react";
import { getApiBase, getToken } from "../../shared/auth";
import "./index.scss";

interface Props {
  src: string;
  label?: string;
}

/**
 * WeChat: streaming remote URL in InnerAudioContext is unreliable (domain / format).
 * Download to temp file first, then play local path — also set obeyMuteSwitch = false.
 */
export default function AudioPlayer({ src, label }: Props) {
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const ctxRef = useRef<Taro.InnerAudioContext | null>(null);

  const fullUrl = useMemo(
    () => (src.startsWith("http") ? src : `${getApiBase()}${src}`),
    [src]
  );

  useEffect(() => {
    let cancelled = false;
    setReady(false);
    setLoadError(false);
    setPlaying(false);
    setProgress(0);

    ctxRef.current?.destroy();
    ctxRef.current = null;

    const token = getToken();
    Taro.downloadFile({
      url: fullUrl,
      header: token ? { "x-wechat-token": token } : {},
      success: (res) => {
        if (cancelled) return;
        if (!res.tempFilePath) {
          setLoadError(true);
          return;
        }

        const audio = Taro.createInnerAudioContext();
        audio.obeyMuteSwitch = false;
        audio.src = res.tempFilePath;

        audio.onPlay(() => setPlaying(true));
        audio.onPause(() => setPlaying(false));
        audio.onStop(() => {
          setPlaying(false);
          setProgress(0);
        });
        audio.onEnded(() => {
          setPlaying(false);
          setProgress(0);
        });
        audio.onTimeUpdate(() => {
          if (audio.duration > 0) {
            setProgress(audio.currentTime / audio.duration);
          }
        });
        audio.onError((err) => {
          console.error("[AudioPlayer] playback", err);
          setPlaying(false);
          setLoadError(true);
          Taro.showToast({ title: "无法播放音频", icon: "none" });
        });

        ctxRef.current = audio;
        setReady(true);
      },
      fail: (err) => {
        console.error("[AudioPlayer] downloadFile", err);
        if (!cancelled) {
          setLoadError(true);
          Taro.showToast({
            title: "音频加载失败（请配置 downloadFile 合法域名）",
            icon: "none",
            duration: 3200,
          });
        }
      },
    });

    return () => {
      cancelled = true;
      ctxRef.current?.destroy();
      ctxRef.current = null;
    };
  }, [fullUrl]);

  const toggle = () => {
    const audio = ctxRef.current;
    if (!audio || !ready || loadError) {
      Taro.showToast({ title: loadError ? "音频不可用" : "加载中…", icon: "none" });
      return;
    }
    if (playing) {
      audio.pause();
    } else {
      audio.play();
    }
  };

  return (
    <View className="audio-player" onClick={toggle}>
      <View className="audio-player__icon">
        {loadError ? "⚠" : playing ? "⏸" : "▶"}
      </View>
      <View className="audio-player__content">
        {label && (
          <Text className="audio-player__label">{label}</Text>
        )}
        <View className="audio-player__bar">
          <View
            className="audio-player__progress"
            style={{ width: `${progress * 100}%` }}
          />
        </View>
        {loadError && (
          <Text className="audio-player__hint">请检查网络与 MP 后台域名</Text>
        )}
      </View>
    </View>
  );
}
