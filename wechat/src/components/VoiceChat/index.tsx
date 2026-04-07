import { View, Text, ScrollView, Input } from "@tarojs/components";
import Taro from "@tarojs/taro";
import { useState, useCallback, useRef, useEffect } from "react";
import { post } from "../../shared/api";
import { getApiBase } from "../../shared/auth";
import "./index.scss";

interface VoiceChatProps {
  expertId: string;
  expertName: string;
  /** When false, TTS uses built-in voice; persona stays the expert. */
  hasClonedVoice?: boolean;
  visible: boolean;
  onClose: () => void;
}

interface Message {
  id: string;
  role: "user" | "assistant";
  text: string;
  audioUrl?: string;
}

interface ChatResponse {
  userText: string;
  replyText: string;
  replyAudio: string;
  turnCount: number;
  maxTurns: number;
}

let msgCounter = 0;
function nextId(): string {
  return `wc-msg-${++msgCounter}`;
}

export default function VoiceChat({
  expertId,
  expertName,
  hasClonedVoice = true,
  visible,
  onClose,
}: VoiceChatProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [processing, setProcessing] = useState(false);
  const [textInput, setTextInput] = useState("");
  const [turnInfo, setTurnInfo] = useState({ count: 0, max: 10 });
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [scrollTop, setScrollTop] = useState(0);

  const recorderRef = useRef<Taro.RecorderManager | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioCtxRef = useRef<Taro.InnerAudioContext | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (audioCtxRef.current) {
        audioCtxRef.current.stop();
        audioCtxRef.current.destroy();
      }
    };
  }, []);

  const scrollToBottom = useCallback(() => {
    setScrollTop((prev) => prev + 9999);
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  const getRecorder = useCallback(() => {
    if (!recorderRef.current) {
      const recorder = Taro.getRecorderManager();
      recorder.onStop((res) => {
        setRecording(false);
        if (timerRef.current) clearInterval(timerRef.current);
        if (res.tempFilePath) {
          sendVoice(res.tempFilePath);
        }
      });
      recorder.onError(() => {
        setRecording(false);
        if (timerRef.current) clearInterval(timerRef.current);
        Taro.showToast({ title: "录音失败", icon: "none" });
      });
      recorderRef.current = recorder;
    }
    return recorderRef.current;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startRecording = useCallback(() => {
    const recorder = getRecorder();
    recorder.start({ duration: 30000, format: "mp3" });
    setRecording(true);
    setElapsed(0);
    timerRef.current = setInterval(() => {
      setElapsed((p) => p + 1);
    }, 1000);
  }, [getRecorder]);

  const stopRecording = useCallback(() => {
    const recorder = getRecorder();
    recorder.stop();
    if (timerRef.current) clearInterval(timerRef.current);
    setRecording(false);
  }, [getRecorder]);

  const sendVoice = useCallback(
    async (filePath: string) => {
      setProcessing(true);
      const userMsg: Message = { id: nextId(), role: "user", text: "..." };
      setMessages((prev) => [...prev, userMsg]);

      try {
        const API_BASE = getApiBase();
        const token = Taro.getStorageSync("token") as string;
        const uploadRes = await Taro.uploadFile({
          url: `${API_BASE}/api/voice-chat/message`,
          filePath,
          name: "audio",
          formData: { expertId },
          header: {
            "x-wechat-token": token || "",
          },
        });

        if (uploadRes.statusCode !== 200) {
          const errData = JSON.parse(uploadRes.data || "{}");
          throw new Error(errData.error || "发送失败");
        }

        const data: ChatResponse = JSON.parse(uploadRes.data);

        setMessages((prev) =>
          prev.map((m) =>
            m.id === userMsg.id ? { ...m, text: data.userText } : m,
          ),
        );

        const aiMsg: Message = {
          id: nextId(),
          role: "assistant",
          text: data.replyText,
          audioUrl: data.replyAudio,
        };
        setMessages((prev) => [...prev, aiMsg]);
        setTurnInfo({ count: data.turnCount, max: data.maxTurns });

        playAudio(data.replyAudio, aiMsg.id);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "发送失败";
        Taro.showToast({ title: msg, icon: "none" });
        setMessages((prev) => prev.filter((m) => m.id !== userMsg.id));
      } finally {
        setProcessing(false);
      }
    },
    [expertId],
  );

  const sendText = useCallback(async () => {
    const text = textInput.trim();
    if (!text || processing) return;
    setTextInput("");
    setProcessing(true);

    const userMsg: Message = { id: nextId(), role: "user", text };
    setMessages((prev) => [...prev, userMsg]);

    try {
      const res = await post<ChatResponse>("/api/voice-chat/message", {
        expertId,
        text,
      });

      if (res.statusCode !== 200) {
        const errData = res.data as unknown as { error?: string };
        throw new Error(errData?.error || "发送失败");
      }

      const aiMsg: Message = {
        id: nextId(),
        role: "assistant",
        text: res.data.replyText,
        audioUrl: res.data.replyAudio,
      };
      setMessages((prev) => [...prev, aiMsg]);
      setTurnInfo({ count: res.data.turnCount, max: res.data.maxTurns });

      playAudio(res.data.replyAudio, aiMsg.id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "发送失败";
      Taro.showToast({ title: msg, icon: "none" });
    } finally {
      setProcessing(false);
    }
  }, [expertId, textInput, processing]);

  const playAudio = useCallback((src: string, msgId: string) => {
    if (audioCtxRef.current) {
      audioCtxRef.current.stop();
      audioCtxRef.current.destroy();
    }
    const ctx = Taro.createInnerAudioContext();
    ctx.src = src;
    ctx.onEnded(() => setPlayingId(null));
    ctx.onError(() => setPlayingId(null));
    ctx.play();
    audioCtxRef.current = ctx;
    setPlayingId(msgId);
  }, []);

  const togglePlay = useCallback(
    (msg: Message) => {
      if (!msg.audioUrl) return;
      if (playingId === msg.id) {
        audioCtxRef.current?.stop();
        setPlayingId(null);
      } else {
        playAudio(msg.audioUrl, msg.id);
      }
    },
    [playingId, playAudio],
  );

  const formatTime = (s: number) =>
    `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;

  if (!visible) return null;

  const turnsRemaining = turnInfo.max - turnInfo.count;

  return (
    <View className="vc-overlay">
      <View className="vc-container">
        {/* Header */}
        <View className="vc-header">
          <View className="vc-header__info">
            <Text className="vc-header__title">AI {expertName}</Text>
            <Text className="vc-header__subtitle">
              {turnsRemaining > 0
                ? `还可发送 ${turnsRemaining} 条消息`
                : "已达上限"}
            </Text>
          </View>
          <View
            className="vc-header__close"
            hoverClass="vc-header__close--hover"
            onClick={onClose}
          >
            ✕
          </View>
        </View>

        {/* Messages */}
        <ScrollView
          className="vc-messages"
          scrollY
          scrollTop={scrollTop}
          scrollWithAnimation
        >
          {messages.length === 0 && (
            <View className="vc-empty">
              <Text className="vc-empty__icon">💬</Text>
              <Text className="vc-empty__text">
                {hasClonedVoice
                  ? `发送语音或文字，AI 将以${expertName}的声音回复`
                  : `发送语音或文字，AI 以${expertName}的身份回复（默认音色）`}
              </Text>
            </View>
          )}

          {messages.map((msg) => (
            <View
              key={msg.id}
              className={`vc-bubble ${msg.role === "user" ? "vc-bubble--user" : "vc-bubble--ai"}`}
            >
              <Text className="vc-bubble__text">{msg.text}</Text>
              {msg.audioUrl && (
                <View
                  className="vc-bubble__play"
                  hoverClass="vc-bubble__play--hover"
                  onClick={() => togglePlay(msg)}
                >
                  <Text>{playingId === msg.id ? "⏸" : "▶"}</Text>
                  <Text className="vc-bubble__play-label">
                    {playingId === msg.id ? "暂停" : "播放语音"}
                  </Text>
                </View>
              )}
            </View>
          ))}

          {processing && (
            <View className="vc-bubble vc-bubble--ai">
              <Text className="vc-bubble__text">思考中...</Text>
            </View>
          )}
        </ScrollView>

        {/* Input */}
        <View className="vc-input-bar">
          {turnsRemaining <= 0 ? (
            <Text className="vc-input-bar__limit">已达消息上限，请预约完整咨询</Text>
          ) : (
            <>
              <Input
                className="vc-input-bar__text"
                value={textInput}
                onInput={(e) => setTextInput(e.detail.value)}
                onConfirm={() => sendText()}
                confirmType="send"
                placeholder="输入文字..."
                disabled={processing || recording}
              />
              {textInput.trim() ? (
                <View
                  className="vc-input-bar__btn vc-input-bar__btn--send"
                  hoverClass="vc-input-bar__btn--hover"
                  onClick={() => sendText()}
                >
                  发送
                </View>
              ) : (
                <View
                  className={`vc-input-bar__btn ${recording ? "vc-input-bar__btn--recording" : "vc-input-bar__btn--mic"}`}
                  hoverClass="vc-input-bar__btn--hover"
                  onClick={recording ? stopRecording : startRecording}
                >
                  {recording ? "⏹" : "🎤"}
                </View>
              )}
            </>
          )}
        </View>

        {recording && (
          <View className="vc-recording-hint">
            <Text className="vc-recording-hint__text">
              录音中 {formatTime(elapsed)}
            </Text>
          </View>
        )}
      </View>
    </View>
  );
}
