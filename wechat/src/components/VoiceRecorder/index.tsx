import { View, Text } from "@tarojs/components";
import Taro from "@tarojs/taro";
import { useState, useRef, useCallback, useEffect } from "react";
import "./index.scss";

interface Props {
  onRecordingComplete: (filePath: string) => void;
  minDuration?: number;
  maxDuration?: number;
}

export default function VoiceRecorder({
  onRecordingComplete,
  minDuration = 10,
  maxDuration = 60,
}: Props) {
  const [recording, setRecording] = useState(false);
  const [duration, setDuration] = useState(0);
  const [recorded, setRecorded] = useState(false);
  const [tempFilePath, setTempFilePath] = useState("");
  const [playing, setPlaying] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recorderRef = useRef<Taro.RecorderManager | null>(null);
  const audioRef = useRef<Taro.InnerAudioContext | null>(null);

  const getRecorder = useCallback(() => {
    if (!recorderRef.current) {
      const recorder = Taro.getRecorderManager();
      recorder.onStop((res) => {
        setRecording(false);
        if (timerRef.current) clearInterval(timerRef.current);
        if (res.tempFilePath) {
          setTempFilePath(res.tempFilePath);
          setRecorded(true);
        }
      });
      recorder.onError((err) => {
        console.error("[VoiceRecorder] error:", err);
        setRecording(false);
        if (timerRef.current) clearInterval(timerRef.current);
        Taro.showToast({ title: "录音失败", icon: "none" });
      });
      recorderRef.current = recorder;
    }
    return recorderRef.current;
  }, []);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (audioRef.current) audioRef.current.destroy();
    };
  }, []);

  const startRecording = async () => {
    try {
      const setting = await Taro.authorize({ scope: "scope.record" });
    } catch {
      Taro.showModal({
        title: "需要麦克风权限",
        content: "请允许使用麦克风后再录音。",
        showCancel: false,
      });
      return;
    }

    setDuration(0);
    setRecorded(false);
    setRecording(true);

    const recorder = getRecorder();
    recorder.start({
      format: "mp3",
      sampleRate: 16000,
      numberOfChannels: 1,
      encodeBitRate: 96000,
    });

    timerRef.current = setInterval(() => {
      setDuration((prev) => {
        const next = prev + 1;
        if (next >= maxDuration) {
          recorder.stop();
          if (timerRef.current) clearInterval(timerRef.current);
        }
        return next;
      });
    }, 1000);
  };

  const stopRecording = () => {
    if (recorderRef.current) {
      recorderRef.current.stop();
    }
    if (timerRef.current) clearInterval(timerRef.current);
    setRecording(false);
  };

  const playRecording = () => {
    if (!tempFilePath) return;
    if (!audioRef.current) {
      audioRef.current = Taro.createInnerAudioContext();
      audioRef.current.onEnded(() => setPlaying(false));
      audioRef.current.onStop(() => setPlaying(false));
    }
    audioRef.current.src = tempFilePath;
    audioRef.current.play();
    setPlaying(true);
  };

  const stopPlaying = () => {
    if (audioRef.current) {
      audioRef.current.stop();
    }
    setPlaying(false);
  };

  const reRecord = () => {
    setRecorded(false);
    setTempFilePath("");
    setDuration(0);
  };

  const confirmRecording = () => {
    if (duration < minDuration) {
      Taro.showToast({
        title: `录音太短（至少 ${minDuration} 秒）`,
        icon: "none",
      });
      return;
    }
    onRecordingComplete(tempFilePath);
  };

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  return (
    <View className="voice-recorder">
      {!recorded ? (
        <View className="voice-recorder__controls">
          <View className="voice-recorder__timer">
            <Text className="voice-recorder__time">{formatTime(duration)}</Text>
            <Text className="voice-recorder__limit">/ {formatTime(maxDuration)}</Text>
          </View>
          {recording && (
            <View className="voice-recorder__indicator">
              <View className="voice-recorder__dot" />
              <Text className="voice-recorder__recording-text">录音中...</Text>
            </View>
          )}
          <View
            className={`voice-recorder__btn ${
              recording
                ? "voice-recorder__btn--stop"
                : "voice-recorder__btn--start"
            }`}
            onClick={recording ? stopRecording : startRecording}
          >
            {recording ? "⏹ 停止录音" : "🎙 开始录音"}
          </View>
          {duration > 0 && !recording && (
            <Text className="voice-recorder__hint">
              至少录制 {minDuration} 秒
            </Text>
          )}
        </View>
      ) : (
        <View className="voice-recorder__review">
          <View className="voice-recorder__timer">
            <Text className="voice-recorder__time">{formatTime(duration)}</Text>
          </View>
          <View className="voice-recorder__review-actions">
            <View
              className="voice-recorder__btn voice-recorder__btn--outline"
              onClick={playing ? stopPlaying : playRecording}
            >
              {playing ? "⏸ 暂停" : "▶ 播放"}
            </View>
            <View
              className="voice-recorder__btn voice-recorder__btn--outline"
              onClick={reRecord}
            >
              🔄 重新录制
            </View>
            <View
              className="voice-recorder__btn voice-recorder__btn--confirm"
              onClick={confirmRecording}
            >
              ✓ 使用这段录音
            </View>
          </View>
        </View>
      )}
    </View>
  );
}
