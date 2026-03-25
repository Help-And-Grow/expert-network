import { View, Text, Input, ScrollView } from "@tarojs/components";
import Taro, { useLoad } from "@tarojs/taro";
import { useState, useRef, useCallback } from "react";
import { post, get, request as apiRequest } from "../../shared/api";
import { getApiBase, getToken } from "../../shared/auth";
import VoiceRecorder from "../../components/VoiceRecorder";
import { DOMAINS } from "../../shared/types";
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

const SOCIAL_FIELDS = [
  { key: "linkedIn", label: "LinkedIn", placeholder: "https://linkedin.com/in/..." },
  { key: "website", label: "Website (optional)", placeholder: "https://..." },
];

export default function OnboardingPage() {
  const [step, setStep] = useState<Step>("nickname");
  const [messages, setMessages] = useState<ChatMessage[]>([
    { id: 0, role: "system", content: "Welcome to Help & Grow—the AI Native Expert Network! Let's create your profile. What should we call you?" },
  ]);
  const [input, setInput] = useState("");
  const [formData, setFormData] = useState<Record<string, string>>({});
  const [selectedDomains, setSelectedDomains] = useState<string[]>([]);
  const [generating, setGenerating] = useState(false);
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
        setTimeout(() => addMsg("system", "What's your gender? This helps us choose a default voice."), 400);
        break;

      case "gender":
        setFormData((p) => ({ ...p, gender: text.toLowerCase() }));
        saveToServer({ gender: text.toLowerCase() });
        setStep("social_links");
        setTimeout(() => addMsg("system", "Share your LinkedIn profile URL (required):"), 400);
        break;

      case "social_links":
        if (!formData.linkedIn) {
          setFormData((p) => ({ ...p, linkedIn: text }));
          saveToServer({ linkedIn: text });
          setTimeout(() => addMsg("system", "Official website? (type 'skip' to skip)"), 400);
        } else if (!formData.website) {
          const val = text.toLowerCase() === "skip" ? "" : text;
          setFormData((p) => ({ ...p, website: val }));
          if (val) saveToServer({ website: val });
          setStep("domains");
          setTimeout(() => addMsg("system", "Select your expertise domains:"), 400);
        }
        break;

      case "pricing":
        if (!formData.priceOnline) {
          const cents = parseInt(text) * 100;
          if (isNaN(cents) || cents <= 0) {
            setTimeout(() => addMsg("system", "Please enter a valid number (e.g. 100):"), 200);
            return;
          }
          setFormData((p) => ({ ...p, priceOnline: String(cents) }));
          saveToServer({ priceOnlineCents: cents });
          if (formData.sessionType !== "ONLINE") {
            setTimeout(() => addMsg("system", "Offline rate per hour (SGD)?"), 400);
          } else {
            proceedToDocument();
          }
        } else {
          const cents = parseInt(text) * 100;
          if (isNaN(cents) || cents <= 0) {
            setTimeout(() => addMsg("system", "Please enter a valid number:"), 200);
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
    setTimeout(() => addMsg("system", "Upload a document (PDF) about your expertise, or skip to continue."), 400);
  };

  const selectGender = (gender: string) => {
    addMsg("user", gender);
    setFormData((p) => ({ ...p, gender: gender.toLowerCase() }));
    saveToServer({ gender: gender.toLowerCase() });
    setStep("social_links");
    setTimeout(() => addMsg("system", "Share your LinkedIn profile URL (required):"), 400);
  };

  const toggleDomain = (domain: string) => {
    setSelectedDomains((prev) =>
      prev.includes(domain) ? prev.filter((d) => d !== domain) : [...prev, domain]
    );
  };

  const confirmDomains = () => {
    if (selectedDomains.length === 0) {
      Taro.showToast({ title: "Select at least one domain", icon: "none" });
      return;
    }
    addMsg("user", selectedDomains.join(", "));
    saveToServer({ domains: selectedDomains });
    setStep("session_prefs");
    setTimeout(() => addMsg("system", "What type of sessions do you offer?"), 400);
  };

  const selectSessionType = (type: string) => {
    addMsg("user", type);
    const mapped = type === "Both" ? "BOTH" : type === "Online" ? "ONLINE" : "OFFLINE";
    setFormData((p) => ({ ...p, sessionType: mapped }));
    saveToServer({ sessionType: mapped });
    setStep("pricing");
    setTimeout(() => addMsg("system", "Online rate per hour (SGD)?"), 400);
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

      Taro.showLoading({ title: "Uploading..." });

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
        addMsg("system", "Document uploaded! Generating your profile...");
        await generateProfile();
      } else {
        Taro.showToast({ title: "Upload failed", icon: "none" });
      }
    } catch {
      Taro.hideLoading();
      Taro.showToast({ title: "Upload failed", icon: "none" });
    }
  };

  const skipDocument = async () => {
    addMsg("user", "Skip");
    addMsg("system", "Generating your profile...");
    await generateProfile();
  };

  const generateProfile = async () => {
    setStep("generating");
    setGenerating(true);

    try {
      const res = await post("/api/onboarding/generate", {});
      if (res.statusCode === 200) {
        setStep("voice_sample");
        setTimeout(() => addMsg("system", "Profile generated! Now record a voice introduction (10-60 seconds). This helps others get to know you."), 800);
      } else {
        throw new Error("Generation failed");
      }
    } catch {
      addMsg("system", "Something went wrong. Please try again.");
      setStep("document");
    } finally {
      setGenerating(false);
    }
  };

  const handleVoiceComplete = async (filePath: string) => {
    addMsg("user", "🎙 Voice recorded");
    Taro.showLoading({ title: "Processing voice..." });

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
        addMsg("system", "Voice introduction created! Your profile is ready.");
      } else {
        addMsg("system", "Voice processing failed, but your profile is ready.");
      }
    } catch {
      addMsg("system", "Voice processing failed, but your profile is ready.");
    } finally {
      Taro.hideLoading();
    }

    setStep("preview");
    setTimeout(() => addMsg("system", "Review your profile and publish when ready."), 400);
  };

  const skipVoice = async () => {
    addMsg("user", "Skip voice");
    Taro.showLoading({ title: "Generating audio..." });
    try {
      await post("/api/expert/generate-audio", {});
    } catch {}
    Taro.hideLoading();
    setStep("preview");
    setTimeout(() => addMsg("system", "Your profile is ready! Review and publish."), 400);
  };

  const publishProfile = async () => {
    Taro.showLoading({ title: "Publishing..." });
    try {
      const res = await post("/api/onboarding/publish", {});
      if (res.statusCode === 200) {
        Taro.hideLoading();
        Taro.showToast({ title: "Published!", icon: "success" });
        setTimeout(() => Taro.switchTab({ url: "/pages/profile/index" }), 1500);
      } else {
        throw new Error("Publish failed");
      }
    } catch {
      Taro.hideLoading();
      Taro.showToast({ title: "Publish failed", icon: "none" });
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
            {["Male", "Female", "Other"].map((g) => (
              <View
                key={g}
                className="onboarding__option"
                hoverClass="onboarding__option--hover"
                onClick={() => selectGender(g)}
              >
                {g}
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
                {d}
              </View>
            ))}
            <View className="onboarding__confirm-btn" hoverClass="onboarding__confirm-btn--hover" onClick={confirmDomains}>
              Continue
            </View>
          </View>
        )}

        {/* Session type selection */}
        {step === "session_prefs" && (
          <View className="onboarding__options">
            {["Online", "Offline", "Both"].map((t) => (
              <View
                key={t}
                className="onboarding__option"
                hoverClass="onboarding__option--hover"
                onClick={() => selectSessionType(t)}
              >
                {t === "Online" ? "🖥 Online Only" : t === "Offline" ? "📍 Offline Only" : "🔄 Both"}
              </View>
            ))}
          </View>
        )}

        {/* Document upload */}
        {step === "document" && (
          <View className="onboarding__options">
            <View className="onboarding__option" hoverClass="onboarding__option--hover" onClick={handleDocumentUpload}>
              📄 Upload PDF
            </View>
            <View className="onboarding__option" hoverClass="onboarding__option--hover" onClick={skipDocument}>
              Skip
            </View>
          </View>
        )}

        {/* Generating indicator */}
        {step === "generating" && (
          <View className="onboarding__generating">
            <Text className="onboarding__generating-text">
              ✨ Generating your profile...
            </Text>
          </View>
        )}

        {/* Voice sample */}
        {step === "voice_sample" && (
          <View className="onboarding__voice-section">
            <VoiceRecorder onRecordingComplete={handleVoiceComplete} />
            <View className="onboarding__skip-voice" onClick={skipVoice}>
              Skip voice recording
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
              👁 Preview Profile
            </View>
            <View className="onboarding__publish-btn" hoverClass="onboarding__publish-btn--hover" onClick={publishProfile}>
              🚀 Publish Profile
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
                ? "Your display name..."
                : step === "pricing"
                ? "Amount in SGD (e.g. 100)..."
                : "Type your answer..."
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
