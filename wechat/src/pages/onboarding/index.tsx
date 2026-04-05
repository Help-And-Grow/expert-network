import { View, Text, Input, ScrollView } from "@tarojs/components";
import Taro from "@tarojs/taro";
import { useState, useRef, useCallback } from "react";
import { post, request as apiRequest } from "../../shared/api";
import { getApiBase, getToken } from "../../shared/auth";
import VoiceRecorder from "../../components/VoiceRecorder";
import { DOMAINS, getDomainLabel } from "../../shared/types";
import "./index.scss";

type Step =
  | "nickname"
  | "gender"
  | "social_links"
  | "domains"
  | "document"
  | "session_prefs"
  | "pricing"
  | "availability"
  | "generating"
  | "voice_sample"
  | "preview";

interface ChatMessage {
  id: number;
  role: "system" | "user";
  content: string;
}

export default function OnboardingPage() {
  const [step, setStep] = useState<Step>("nickname");
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 0,
      role: "system",
      content:
        "欢迎来到 Help & Grow（AI 原生专家网络）！我们先创建你的专家主页。请问怎么称呼你？",
    },
  ]);
  const [input, setInput] = useState("");
  const [formData, setFormData] = useState<Record<string, string>>({});
  const [selectedDomains, setSelectedDomains] = useState<string[]>([]);
  const [, setGenerating] = useState(false);
  const [msgId, setMsgId] = useState(1);
  const scrollRef = useRef<string>("");

  const addMsg = useCallback(
    (role: "system" | "user", content: string) => {
      setMsgId((prev) => {
        const id = prev;
        setMessages((msgs) => [...msgs, { id, role, content }]);
        scrollRef.current = `msg-${id}`;
        return prev + 1;
      });
    },
    []
  );

  const saveToServer = useCallback(
    async (data: Record<string, unknown>) => {
      await post("/api/onboarding", data).catch(() => {});
    },
    []
  );

  const handleSend = () => {
    const text = input.trim();
    if (!text) return;
    setInput("");
    addMsg("user", text);
    processInput(text);
  };

  const processInput = (text: string) => {
    switch (step) {
      case "nickname":
        setFormData((p) => ({ ...p, nickName: text }));
        apiRequest({ url: "/api/user", method: "PATCH", data: { nickName: text } }).catch(() => {});
        setStep("gender");
        setTimeout(() => addMsg("system", "请选择性别（用于推荐默认语音）。"), 400);
        break;

      case "gender":
        setFormData((p) => ({ ...p, gender: text.toLowerCase() }));
        saveToServer({ gender: text.toLowerCase() });
        setStep("social_links");
        setTimeout(() => addMsg("system", "请填写你的 LinkedIn 链接（必填）："), 400);
        break;

      case "social_links":
        if (!formData.linkedIn) {
          setFormData((p) => ({ ...p, linkedIn: text }));
          saveToServer({ linkedIn: text });
          setTimeout(() => addMsg("system", "请填写个人官网（可选，输入“跳过”可略过）："), 400);
        } else if (!formData.website) {
          const normalized = text.trim().toLowerCase();
          const val = normalized === "skip" || text.trim() === "跳过" ? "" : text;
          setFormData((p) => ({ ...p, website: val }));
          if (val) saveToServer({ website: val });
          setStep("domains");
          setTimeout(() => addMsg("system", "请选择你的擅长领域："), 400);
        }
        break;

      case "pricing":
        if (!formData.priceOnline) {
          const cents = parseInt(text) * 100;
          if (isNaN(cents) || cents <= 0) {
            setTimeout(() => addMsg("system", "请输入有效金额（示例：100）："), 200);
            return;
          }
          setFormData((p) => ({ ...p, priceOnline: String(cents) }));
          saveToServer({ priceOnlineCents: cents });
          if (formData.sessionType !== "ONLINE") {
            setTimeout(() => addMsg("system", "请填写线下每小时价格（SGD）："), 400);
          } else {
            proceedToDocument();
          }
        } else {
          const cents = parseInt(text) * 100;
          if (isNaN(cents) || cents <= 0) {
            setTimeout(() => addMsg("system", "请输入有效金额："), 200);
            return;
          }
          setFormData((p) => ({ ...p, priceOffline: String(cents) }));
          saveToServer({ priceOfflineCents: cents });
          proceedToDocument();
        }
        break;

      default:
        break;
    }
  };

  const proceedToDocument = () => {
    setStep("document");
    setTimeout(() => addMsg("system", "请上传一份介绍你专业能力的 PDF 文档（可跳过）。"), 400);
  };

  const selectGender = (gender: "male" | "female" | "other", label: string) => {
    addMsg("user", label);
    setFormData((p) => ({ ...p, gender }));
    saveToServer({ gender });
    setStep("social_links");
    setTimeout(() => addMsg("system", "请填写你的 LinkedIn 链接（必填）："), 400);
  };

  const toggleDomain = (domain: string) => {
    setSelectedDomains((prev) =>
      prev.includes(domain) ? prev.filter((d) => d !== domain) : [...prev, domain]
    );
  };

  const confirmDomains = () => {
    if (selectedDomains.length === 0) {
      Taro.showToast({ title: "请至少选择一个领域", icon: "none" });
      return;
    }
    addMsg("user", selectedDomains.join(", "));
    saveToServer({ domains: selectedDomains });
    setStep("session_prefs");
    setTimeout(() => addMsg("system", "你提供哪种咨询方式？"), 400);
  };

  const selectSessionType = (mapped: "ONLINE" | "OFFLINE" | "BOTH", label: string) => {
    addMsg("user", label);
    setFormData((p) => ({ ...p, sessionType: mapped }));
    saveToServer({ sessionType: mapped });
    setStep("pricing");
    setTimeout(() => addMsg("system", "请填写线上每小时价格（SGD）："), 400);
  };

  const handleDocumentUpload = async () => {
    try {
      const chooseRes = await Taro.chooseMessageFile({
        count: 1,
        type: "file",
        extension: ["pdf"],
      });

      if (!chooseRes.tempFiles?.length) return;
      const file = chooseRes.tempFiles[0];

      Taro.showLoading({ title: "上传中..." });

      const token = getToken();
      const API_BASE = getApiBase();
      const uploadRes = await Taro.uploadFile({
        url: `${API_BASE}/api/onboarding/upload`,
        filePath: file.path,
        name: "file",
        header: token ? { "x-wechat-token": token } : {},
      });

      Taro.hideLoading();

      if (uploadRes.statusCode === 200) {
        addMsg("user", `📄 ${file.name}`);
        addMsg("system", "文档已上传，正在生成你的专家主页...");
        await generateProfile();
      } else {
        Taro.showToast({ title: "上传失败", icon: "none" });
      }
    } catch {
      Taro.hideLoading();
      Taro.showToast({ title: "上传失败", icon: "none" });
    }
  };

  const skipDocument = async () => {
    addMsg("user", "跳过");
    addMsg("system", "正在生成你的专家主页...");
    await generateProfile();
  };

  const generateProfile = async () => {
    setStep("generating");
    setGenerating(true);

    try {
      const res = await post("/api/onboarding/generate", {});
      if (res.statusCode === 200) {
        setStep("voice_sample");
        setTimeout(
          () =>
            addMsg(
              "system",
              "主页已生成！请录制一段 10-60 秒语音介绍，帮助他人更快了解你。"
            ),
          800
        );
      } else {
        throw new Error("生成失败");
      }
    } catch {
      addMsg("system", "生成失败，请稍后重试。");
      setStep("document");
    } finally {
      setGenerating(false);
    }
  };

  const handleVoiceComplete = async (filePath: string) => {
    addMsg("user", "🎙 已完成录音");
    Taro.showLoading({ title: "处理中..." });

    try {
      const token = getToken();
      const API_BASE = getApiBase();
      const uploadRes = await Taro.uploadFile({
        url: `${API_BASE}/api/expert/voice-clone`,
        filePath,
        name: "audio",
        header: token ? { "x-wechat-token": token } : {},
      });

      if (uploadRes.statusCode === 200) {
        await post("/api/expert/generate-audio", {});
        addMsg("system", "语音介绍已生成，专家主页已准备就绪。");
      } else {
        addMsg("system", "语音处理失败，但主页已可使用。");
      }
    } catch {
      addMsg("system", "语音处理失败，但主页已可使用。");
    } finally {
      Taro.hideLoading();
    }

    setStep("preview");
    setTimeout(() => addMsg("system", "请先预览主页，确认后即可发布。"), 400);
  };

  const skipVoice = async () => {
    addMsg("user", "跳过录音");
    Taro.showLoading({ title: "生成默认语音中..." });
    try {
      await post("/api/expert/generate-audio", {});
    } catch {}
    Taro.hideLoading();
    setStep("preview");
    setTimeout(() => addMsg("system", "专家主页已就绪，请预览并发布。"), 400);
  };

  const publishProfile = async () => {
    Taro.showLoading({ title: "发布中..." });
    try {
      const res = await post("/api/onboarding/publish", {});
      if (res.statusCode === 200) {
        Taro.hideLoading();
        Taro.showToast({ title: "发布成功", icon: "success" });
        setTimeout(() => Taro.switchTab({ url: "/pages/profile/index" }), 1500);
      } else {
        throw new Error("发布失败");
      }
    } catch {
      Taro.hideLoading();
      Taro.showToast({ title: "发布失败", icon: "none" });
    }
  };

  const showTextInput = ["nickname", "social_links", "pricing"].includes(step);

  return (
    <View className="onboarding">
      <ScrollView
        scrollY
        className="onboarding__scroll"
        scrollIntoView={scrollRef.current}
      >
        {messages.map((msg) => (
          <View
            key={msg.id}
            id={`msg-${msg.id}`}
            className={`onboarding__msg ${
              msg.role === "user"
                ? "onboarding__msg--user"
                : "onboarding__msg--system"
            }`}
          >
            <View
              className={`onboarding__bubble ${
                msg.role === "user"
                  ? "onboarding__bubble--user"
                  : "onboarding__bubble--system"
              }`}
            >
              {msg.content}
            </View>
          </View>
        ))}

        {/* Gender options */}
        {step === "gender" && (
          <View className="onboarding__options">
            {[
              { value: "male", label: "男" },
              { value: "female", label: "女" },
              { value: "other", label: "其他" },
            ].map((g) => (
              <View
                key={g.value}
                className="onboarding__option"
                hoverClass="onboarding__option--hover"
                onClick={() => selectGender(g.value as "male" | "female" | "other", g.label)}
              >
                {g.label}
              </View>
            ))}
          </View>
        )}

        {/* Domain selection */}
        {step === "domains" && (
          <View className="onboarding__options">
            {DOMAINS.map((d) => (
              <View
                key={d}
                className={`onboarding__option ${
                  selectedDomains.includes(d)
                    ? "onboarding__option--selected"
                    : ""
                }`}
                hoverClass="onboarding__option--hover"
                onClick={() => toggleDomain(d)}
              >
                {getDomainLabel(d)}
              </View>
            ))}
            <View className="onboarding__confirm-btn" hoverClass="onboarding__confirm-btn--hover" onClick={confirmDomains}>
              下一步
            </View>
          </View>
        )}

        {/* Session type selection */}
        {step === "session_prefs" && (
          <View className="onboarding__options">
            {[
              { value: "ONLINE" as const, label: "🖥 仅线上" },
              { value: "OFFLINE" as const, label: "📍 仅线下" },
              { value: "BOTH" as const, label: "🔄 线上 + 线下" },
            ].map((t) => (
              <View
                key={t.value}
                className="onboarding__option"
                hoverClass="onboarding__option--hover"
                onClick={() => selectSessionType(t.value, t.label)}
              >
                {t.label}
              </View>
            ))}
          </View>
        )}

        {/* Document upload */}
        {step === "document" && (
          <View className="onboarding__options">
            <View className="onboarding__option" hoverClass="onboarding__option--hover" onClick={handleDocumentUpload}>
              📄 上传 PDF
            </View>
            <View className="onboarding__option" hoverClass="onboarding__option--hover" onClick={skipDocument}>
              跳过
            </View>
          </View>
        )}

        {/* Generating indicator */}
        {step === "generating" && (
          <View className="onboarding__generating">
            <Text className="onboarding__generating-text">
              ✨ 正在生成专家主页...
            </Text>
          </View>
        )}

        {/* Voice sample */}
        {step === "voice_sample" && (
          <View className="onboarding__voice-section">
            <VoiceRecorder onRecordingComplete={handleVoiceComplete} />
            <View className="onboarding__skip-voice" onClick={skipVoice}>
              跳过录音
            </View>
          </View>
        )}

        {/* Preview & Publish */}
        {step === "preview" && (
          <View className="onboarding__preview-actions">
            <View
              className="onboarding__preview-btn"
              hoverClass="onboarding__preview-btn--hover"
              onClick={() =>
                Taro.navigateTo({
                  url: "/pages/profile/index",
                })
              }
            >
              👁 预览主页
            </View>
            <View className="onboarding__publish-btn" hoverClass="onboarding__publish-btn--hover" onClick={publishProfile}>
              🚀 发布主页
            </View>
          </View>
        )}

        <View style={{ height: "200px" }} />
      </ScrollView>

      {/* Text input bar */}
      {showTextInput && (
        <View className="onboarding__input-bar">
          <Input
            className="onboarding__input"
            placeholder={
              step === "nickname"
                ? "请输入你的昵称..."
                : step === "pricing"
                ? "请输入 SGD 金额（示例：100）..."
                : "请输入你的回答..."
            }
            value={input}
            onInput={(e) => setInput(e.detail.value)}
            confirmType="send"
            onConfirm={handleSend}
            adjustPosition
          />
          <View className="onboarding__send-btn" onClick={handleSend}>
            →
          </View>
        </View>
      )}
    </View>
  );
}
