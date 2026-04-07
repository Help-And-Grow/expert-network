import { View, Text, LivePusher, LivePlayer } from "@tarojs/components";
import Taro from "@tarojs/taro";
import { useState, useCallback, useRef, useEffect } from "react";
import { post } from "../../shared/api";
import "./index.scss";

interface VoiceChatProps {
  expertId: string;
  expertName: string;
  visible: boolean;
  onClose: () => void;
}

type CallState = "connecting" | "connected" | "ending" | "ended" | "error";

interface StartResponse {
  channelName: string;
  token: string;
  uid: number;
  appId: string;
  maxDurationSeconds: number;
  expertName: string;
}

function formatTimer(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default function VoiceChat({
  expertId,
  expertName,
  visible,
  onClose,
}: VoiceChatProps) {
  const [callState, setCallState] = useState<CallState>("connecting");
  const [error, setError] = useState("");
  const [muted, setMuted] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [maxDuration, setMaxDuration] = useState(300);
  const [pushUrl, setPushUrl] = useState("");
  const [pullUrl, setPullUrl] = useState("");

  const channelRef = useRef("");
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const cleanup = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const endCall = useCallback(async () => {
    if (!channelRef.current) return;
    setCallState("ending");
    cleanup();

    await post("/api/voice-chat/stop", {
      channelName: channelRef.current,
    }).catch(() => {});

    setCallState("ended");
    setPushUrl("");
    setPullUrl("");
  }, [cleanup]);

  useEffect(() => {
    if (!visible) return;

    let cancelled = false;

    async function startCall() {
      try {
        const res = await post<StartResponse>("/api/voice-chat/start", {
          expertId,
        });

        if (res.statusCode !== 200 || !res.data.channelName) {
          throw new Error(
            (res.data as unknown as { error?: string }).error || "连接失败"
          );
        }

        if (cancelled) return;

        const { channelName, token, uid, appId, maxDurationSeconds } = res.data;
        channelRef.current = channelName;
        if (maxDurationSeconds) setMaxDuration(maxDurationSeconds);

        const rtmpPush = `rtmp://vl.cdn.agora.io/live/${appId}/${channelName}/${uid}?token=${encodeURIComponent(token)}`;
        const rtmpPull = `rtmp://vl.cdn.agora.io/live/${appId}/${channelName}/0`;

        setPushUrl(rtmpPush);
        setPullUrl(rtmpPull);
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
        const msg = err instanceof Error ? err.message : "连接失败";
        setError(msg);
        setCallState("error");
      }
    }

    startCall();

    return () => {
      cancelled = true;
      cleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  if (!visible) return null;

  const remaining = Math.max(0, maxDuration - elapsed);

  return (
    <View className="voice-chat-overlay">
      <View className="voice-chat-modal">
        {/* Header */}
        <View className="voice-chat-header">
          <Text className="voice-chat-header__title">
            {callState === "connecting"
              ? "连接中..."
              : callState === "error"
                ? "连接失败"
                : callState === "ended" || callState === "ending"
                  ? "通话结束"
                  : `AI ${expertName}`}
          </Text>
          <Text className="voice-chat-header__subtitle">
            {callState === "connected"
              ? "语音聊天 · 免费体验"
              : callState === "connecting"
                ? "正在建立 AI 语音连接..."
                : callState === "error"
                  ? error
                  : "感谢您的体验"}
          </Text>
        </View>

        {/* Timer */}
        {callState === "connected" && (
          <View className="voice-chat-timer">
            <Text
              className={`voice-chat-timer__text ${remaining <= 30 ? "voice-chat-timer__text--warning" : ""}`}
            >
              {formatTimer(remaining)}
            </Text>
            <Text className="voice-chat-timer__label">剩余时间</Text>
          </View>
        )}

        {/* Connecting spinner */}
        {callState === "connecting" && (
          <View className="voice-chat-loading">
            <Text className="voice-chat-loading__icon">⏳</Text>
          </View>
        )}

        {/* Hidden live-pusher/live-player for audio */}
        {callState === "connected" && pushUrl && (
          <LivePusher
            url={pushUrl}
            mode="RTC"
            autopush
            muted={muted}
            enableCamera={false}
            enableMic={!muted}
            style={{ width: 0, height: 0 }}
          />
        )}
        {callState === "connected" && pullUrl && (
          <LivePlayer
            src={pullUrl}
            mode="RTC"
            autoplay
            style={{ width: 0, height: 0 }}
          />
        )}

        {/* Controls */}
        <View className="voice-chat-controls">
          {callState === "connected" && (
            <>
              <View
                className={`voice-chat-btn ${muted ? "voice-chat-btn--muted" : ""}`}
                hoverClass="voice-chat-btn--hover"
                onClick={() => setMuted(!muted)}
              >
                <Text className="voice-chat-btn__icon">{muted ? "🔇" : "🎤"}</Text>
                <Text className="voice-chat-btn__label">{muted ? "已静音" : "静音"}</Text>
              </View>
              <View
                className="voice-chat-btn voice-chat-btn--end"
                hoverClass="voice-chat-btn--hover"
                onClick={endCall}
              >
                <Text className="voice-chat-btn__icon">📞</Text>
                <Text className="voice-chat-btn__label">结束</Text>
              </View>
            </>
          )}

          {(callState === "ended" || callState === "ending") && (
            <View
              className="voice-chat-btn voice-chat-btn--close"
              hoverClass="voice-chat-btn--hover"
              onClick={onClose}
            >
              <Text className="voice-chat-btn__label">关闭</Text>
            </View>
          )}

          {callState === "error" && (
            <View
              className="voice-chat-btn voice-chat-btn--close"
              hoverClass="voice-chat-btn--hover"
              onClick={onClose}
            >
              <Text className="voice-chat-btn__label">关闭</Text>
            </View>
          )}

          {callState === "connecting" && (
            <View
              className="voice-chat-btn voice-chat-btn--close"
              hoverClass="voice-chat-btn--hover"
              onClick={() => {
                cleanup();
                setCallState("ended");
              }}
            >
              <Text className="voice-chat-btn__label">取消</Text>
            </View>
          )}
        </View>
      </View>
    </View>
  );
}
