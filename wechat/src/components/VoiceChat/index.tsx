import { View, Text, ScrollView } from "@tarojs/components";
import Taro from "@tarojs/taro";
import { useCallback, useEffect, useRef, useState } from "react";

import { post } from "../../shared/api";
import { logToVercel } from "../../shared/debug-log";
import {
  prepareAudioForInnerAudio,
  readLocalAudioAsBase64,
} from "../../shared/wechat-audio";
import "./index.scss";

interface VoiceChatProps {
  expertId: string;
  expertName: string;
  hasClonedVoice?: boolean;
  visible: boolean;
  onClose: () => void;
}

interface Message {
  id: string;
  role: "user" | "assistant";
  title: string;
  note: string;
  audioUrl?: string;
  localAudioPath?: string;
  clipCount?: number;
}

interface DraftClip {
  id: string;
  filePath: string;
  duration: number;
}

interface ChatResponse {
  userText: string;
  replyText: string;
  replyAudio: string;
  turnCount: number;
  maxTurns: number;
}

let messageCounter = 0;
let draftCounter = 0;

function nextMessageId(): string {
  messageCounter += 1;
  return `wc-msg-${messageCounter}`;
}

function nextDraftId(): string {
  draftCounter += 1;
  return `wc-draft-${draftCounter}`;
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export default function VoiceChat(props: VoiceChatProps) {
  const { expertId, expertName, visible, onClose } = props;
  const [messages, setMessages] = useState<Message[]>([]);
  const [draftClips, setDraftClips] = useState<DraftClip[]>([]);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [processing, setProcessing] = useState(false);
  const [greetingLoading, setGreetingLoading] = useState(false);
  const [turnInfo, setTurnInfo] = useState({ count: 0, max: 5 });
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [scrollTop, setScrollTop] = useState(0);

  const recorderRef = useRef<Taro.RecorderManager | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioCtxRef = useRef<Taro.InnerAudioContext | null>(null);
  const elapsedAtStopRef = useRef(0);

  const scrollToBottom = useCallback(() => {
    setScrollTop((prev) => prev + 2000);
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, draftClips, scrollToBottom]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (audioCtxRef.current) {
        audioCtxRef.current.stop();
        audioCtxRef.current.destroy();
      }
    };
  }, []);

  const playLocalAudio = useCallback((localPath: string, targetId: string) => {
    if (audioCtxRef.current) {
      audioCtxRef.current.stop();
      audioCtxRef.current.destroy();
    }

    const ctx = Taro.createInnerAudioContext();
    ctx.obeyMuteSwitch = false;
    ctx.src = localPath;
    ctx.onEnded(() => setPlayingId(null));
    ctx.onStop(() => setPlayingId(null));
    ctx.onPause(() => setPlayingId(null));
    ctx.onError((err) => {
      logToVercel("error", "VoiceChat playback", err);
      setPlayingId(null);
      Taro.showToast({ title: "语音播放失败", icon: "none" });
    });
    ctx.play();
    audioCtxRef.current = ctx;
    setPlayingId(targetId);
  }, []);

  const ensureAudioForMessage = useCallback(
    async (message: Message): Promise<string | null> => {
      if (message.localAudioPath) return message.localAudioPath;
      if (!message.audioUrl) return null;
      const localPath = await prepareAudioForInnerAudio(message.audioUrl, message.id);
      setMessages((prev) =>
        prev.map((item) =>
          item.id === message.id ? { ...item, localAudioPath: localPath } : item,
        ),
      );
      return localPath;
    },
    [],
  );

  const toggleMessagePlayback = useCallback(
    async (message: Message) => {
      if (playingId === message.id) {
        audioCtxRef.current?.stop();
        setPlayingId(null);
        return;
      }

      try {
        const localPath = await ensureAudioForMessage(message);
        if (!localPath) {
          Taro.showToast({ title: "暂无可用语音", icon: "none" });
          return;
        }
        playLocalAudio(localPath, message.id);
      } catch (err) {
        logToVercel("error", "VoiceChat ensureAudioForMessage", err);
        Taro.showToast({ title: "语音加载失败", icon: "none" });
      }
    },
    [ensureAudioForMessage, playLocalAudio, playingId],
  );

  const toggleDraftPlayback = useCallback(
    (draft: DraftClip) => {
      if (playingId === draft.id) {
        audioCtxRef.current?.stop();
        setPlayingId(null);
        return;
      }
      playLocalAudio(draft.filePath, draft.id);
    },
    [playLocalAudio, playingId],
  );

  useEffect(() => {
    if (!visible || !expertId) return;

    setMessages([]);
    setDraftClips([]);
    setTurnInfo({ count: 0, max: 5 });
    let cancelled = false;
    const greetingMessageId = `wc-greet-${expertId}`;

    void (async () => {
      setGreetingLoading(true);
      try {
        const res = await post<{ replyText: string; replyAudio: string }>(
          "/api/voice-chat/greeting",
          { expertId },
        );
        if (cancelled || res.statusCode !== 200) return;

        const localPath = await prepareAudioForInnerAudio(
          res.data.replyAudio,
          greetingMessageId,
        );
        if (cancelled) return;

        const greetingMessage: Message = {
          id: greetingMessageId,
          role: "assistant",
          title: `${expertName} 的欢迎语音`,
          note: "打开后会自动播放一次，你也可以随时重听。",
          audioUrl: res.data.replyAudio,
          localAudioPath: localPath,
        };

        setMessages([greetingMessage]);
        setTimeout(() => {
          if (!cancelled) {
            playLocalAudio(localPath, greetingMessageId);
          }
        }, 180);
      } catch (err) {
        logToVercel("error", "voice-chat/greeting", err);
        Taro.showToast({ title: "欢迎语音加载失败", icon: "none" });
      } finally {
        if (!cancelled) setGreetingLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [expertId, expertName, playLocalAudio, visible]);

  useEffect(() => {
    if (!visible && audioCtxRef.current) {
      audioCtxRef.current.stop();
      audioCtxRef.current.destroy();
      audioCtxRef.current = null;
      setPlayingId(null);
    }
  }, [visible]);

  const getRecorder = useCallback(() => {
    if (!recorderRef.current) {
      const recorder = Taro.getRecorderManager();
      recorder.onStop((res) => {
        setRecording(false);
        if (timerRef.current) clearInterval(timerRef.current);

        if (!res.tempFilePath) return;

        const recordedDuration = Math.max(elapsedAtStopRef.current, 1);
        setDraftClips((prev) => {
          if (prev.length >= 3) {
            Taro.showToast({ title: "当前最多先整理 3 段语音", icon: "none" });
            return prev;
          }
          return [
            ...prev,
            {
              id: nextDraftId(),
              filePath: res.tempFilePath,
              duration: recordedDuration,
            },
          ];
        });
      });
      recorder.onError((err) => {
        console.error("[VoiceChat] recorder", err);
        setRecording(false);
        if (timerRef.current) clearInterval(timerRef.current);
        Taro.showToast({ title: "录音失败", icon: "none" });
      });
      recorderRef.current = recorder;
    }
    return recorderRef.current;
  }, []);

  const startRecording = useCallback(async () => {
    if (processing) return;
    if (draftClips.length >= 3) {
      Taro.showToast({ title: "当前最多先整理 3 段语音", icon: "none" });
      return;
    }

    try {
      await Taro.authorize({ scope: "scope.record" });
    } catch {
      Taro.showModal({
        title: "需要麦克风权限",
        content: "请允许使用麦克风后再录音。",
        showCancel: false,
      });
      return;
    }

    const recorder = getRecorder();
    elapsedAtStopRef.current = 0;
    setElapsed(0);
    setRecording(true);
    recorder.start({
      duration: 45000,
      format: "mp3",
      sampleRate: 16000,
      numberOfChannels: 1,
      encodeBitRate: 96000,
    });

    timerRef.current = setInterval(() => {
      setElapsed((prev) => {
        const next = prev + 1;
        elapsedAtStopRef.current = next;
        return next;
      });
    }, 1000);
  }, [draftClips.length, getRecorder, processing]);

  const stopRecording = useCallback(() => {
    const recorder = getRecorder();
    recorder.stop();
    if (timerRef.current) clearInterval(timerRef.current);
    setRecording(false);
  }, [getRecorder]);

  const removeDraftClip = useCallback((draftId: string) => {
    setDraftClips((prev) => prev.filter((item) => item.id !== draftId));
    if (playingId === draftId) {
      audioCtxRef.current?.stop();
      setPlayingId(null);
    }
  }, [playingId]);

  const submitDrafts = useCallback(async () => {
    if (draftClips.length === 0 || processing) return;
    setProcessing(true);

    try {
      const audioClips = await Promise.all(
        draftClips.map(async (clip) => {
          const payload = await readLocalAudioAsBase64(clip.filePath);
          return { ...payload, durationSeconds: clip.duration };
        }),
      );

      const res = await post<ChatResponse>("/api/voice-chat/message", {
        expertId,
        audioClips,
      });

      if (res.statusCode !== 200) {
        const errData = res.data as unknown as { error?: string };
        throw new Error(errData?.error || "发送失败");
      }

      const userMessage: Message = {
        id: nextMessageId(),
        role: "user",
        title:
          draftClips.length === 1
            ? "你的语音问题"
            : `你的语音问题（共 ${draftClips.length} 段）`,
        note: "已提交，等待专家给出一段语音判断。",
        clipCount: draftClips.length,
      };

      const replyMessageId = nextMessageId();
      const localPath = await prepareAudioForInnerAudio(
        res.data.replyAudio,
        replyMessageId,
      );

      const replyMessage: Message = {
        id: replyMessageId,
        role: "assistant",
        title: `${expertName} 的语音回复`,
        note: "已自动播放。若你想再听一遍，可点击重新播放。",
        audioUrl: res.data.replyAudio,
        localAudioPath: localPath,
      };

      setMessages((prev) => [...prev, userMessage, replyMessage]);
      setTurnInfo({ count: res.data.turnCount, max: res.data.maxTurns });
      setDraftClips([]);

      setTimeout(() => {
        playLocalAudio(localPath, replyMessageId);
      }, 150);
    } catch (err) {
      logToVercel("error", "VoiceChat submitDrafts", err);
      const message = err instanceof Error ? err.message : "发送失败";
      Taro.showToast({ title: message, icon: "none" });
    } finally {
      setProcessing(false);
    }
  }, [draftClips, expertId, expertName, playLocalAudio, processing]);

  if (!visible) return null;

  const turnsRemaining = Math.max(turnInfo.max - turnInfo.count, 0);

  return (
    <View className="vc-overlay">
      <View className="vc-container">
        <View className="vc-header">
          <View className="vc-header__info">
            <Text className="vc-header__title">与 {expertName} 对话</Text>
            <Text className="vc-header__subtitle">
              免费语音预览 · 还可获得 {turnsRemaining} 次专家回复
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

        <ScrollView
          className="vc-messages"
          scrollY
          scrollTop={scrollTop}
          scrollWithAnimation
        >
          <View className="vc-guidance">
            <Text className="vc-guidance__title">使用方式</Text>
            <Text className="vc-guidance__text">
              你可以连续补充最多 3 段语音，再点击“确认发送问题”。每次只会收到一段浓缩后的语音判断。
            </Text>
          </View>

          {greetingLoading && messages.length === 0 && (
            <View className="vc-status-card">
              <Text className="vc-status-card__text">正在准备欢迎语音...</Text>
            </View>
          )}

          {messages.map((message) => (
            <View
              key={message.id}
              className={`vc-message ${message.role === "user" ? "vc-message--user" : "vc-message--assistant"}`}
            >
              <Text className="vc-message__title">{message.title}</Text>
              <Text className="vc-message__note">{message.note}</Text>
              {(message.localAudioPath || message.audioUrl) && (
                <View
                  className="vc-message__play"
                  hoverClass="vc-message__play--hover"
                  onClick={() => toggleMessagePlayback(message)}
                >
                  <Text className="vc-message__play-icon">
                    {playingId === message.id ? "⏸" : "▶"}
                  </Text>
                  <Text className="vc-message__play-label">
                    {playingId === message.id ? "暂停语音" : "播放语音"}
                  </Text>
                </View>
              )}
            </View>
          ))}

          {draftClips.length > 0 && (
            <View className="vc-drafts">
              <Text className="vc-drafts__title">待发送的语音问题</Text>
              {draftClips.map((draft, index) => (
                <View key={draft.id} className="vc-draft-card">
                  <View className="vc-draft-card__body">
                    <Text className="vc-draft-card__title">
                      语音草稿 {index + 1}
                    </Text>
                    <Text className="vc-draft-card__meta">
                      时长 {formatDuration(draft.duration)}
                    </Text>
                  </View>
                  <View className="vc-draft-card__actions">
                    <View
                      className="vc-draft-card__btn"
                      hoverClass="vc-draft-card__btn--hover"
                      onClick={() => toggleDraftPlayback(draft)}
                    >
                      {playingId === draft.id ? "暂停" : "播放"}
                    </View>
                    <View
                      className="vc-draft-card__btn vc-draft-card__btn--danger"
                      hoverClass="vc-draft-card__btn--hover"
                      onClick={() => removeDraftClip(draft.id)}
                    >
                      删除
                    </View>
                  </View>
                </View>
              ))}
            </View>
          )}

          {processing && (
            <View className="vc-status-card">
              <Text className="vc-status-card__text">正在整理你的问题...</Text>
            </View>
          )}

          {turnsRemaining <= 0 && (
            <View className="vc-status-card vc-status-card--limit">
              <Text className="vc-status-card__text">
                免费语音预览已用完。若你需要进一步深入讨论，请在网页继续浏览并预约正式咨询。
              </Text>
            </View>
          )}
        </ScrollView>

        <View className="vc-footer">
          {recording ? (
            <View
              className="vc-footer__record vc-footer__record--recording"
              hoverClass="vc-footer__record--hover"
              onClick={stopRecording}
            >
              结束录音 · {formatDuration(elapsed)}
            </View>
          ) : (
            <View className="vc-footer__actions">
              <View
                className={`vc-footer__record ${
                  turnsRemaining <= 0 || processing || draftClips.length >= 3
                    ? "vc-footer__record--disabled"
                    : ""
                }`}
                hoverClass="vc-footer__record--hover"
                onClick={() => {
                  if (turnsRemaining <= 0 || processing || draftClips.length >= 3) return;
                  void startRecording();
                }}
              >
                {draftClips.length >= 3 ? "已达到 3 段上限" : "新增一段语音"}
              </View>

              <View
                className={`vc-footer__submit ${
                  draftClips.length === 0 || processing || turnsRemaining <= 0
                    ? "vc-footer__submit--disabled"
                    : ""
                }`}
                hoverClass="vc-footer__submit--hover"
                onClick={() => {
                  if (draftClips.length === 0 || processing || turnsRemaining <= 0) return;
                  void submitDrafts();
                }}
              >
                确认发送问题
              </View>
            </View>
          )}
        </View>
      </View>
    </View>
  );
}
