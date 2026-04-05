import { View, Text } from "@tarojs/components";
import Taro from "@tarojs/taro";
import { useState, useRef, useCallback } from "react";
import { getApiBase } from "../../shared/auth";
import "./index.scss";

interface Props {
  src: string;
  label?: string;
}

export default function AudioPlayer({ src, label }: Props) {
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const audioRef = useRef<Taro.InnerAudioContext | null>(null);

  const getAudio = useCallback(() => {
    if (!audioRef.current) {
      const audio = Taro.createInnerAudioContext();
      const fullSrc = src.startsWith("http") ? src : `${getApiBase()}${src}`;
      audio.src = fullSrc;

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
        console.error("[AudioPlayer] error:", err);
        setPlaying(false);
        Taro.showToast({ title: "音频播放失败", icon: "none" });
      });

      audioRef.current = audio;
    }
    return audioRef.current;
  }, [src]);

  const toggle = () => {
    const audio = getAudio();
    if (playing) {
      audio.pause();
    } else {
      audio.play();
    }
  };

  return (
    <View className="audio-player" onClick={toggle}>
      <View className="audio-player__icon">
        {playing ? "⏸" : "▶"}
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
      </View>
    </View>
  );
}
