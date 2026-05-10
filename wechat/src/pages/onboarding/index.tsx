import { View, Text, Input, ScrollView } from "@tarojs/components";
import Taro from "@tarojs/taro";
import { useState, useRef, useCallback, useMemo } from "react";
import { get, post, request as apiRequest } from "../../shared/api";
import { getApiBase, getToken } from "../../shared/auth";
import {
  countryFlagEmoji,
  getCountryOption,
  searchCountries,
} from "../../shared/countries";
import { DOMAINS, getDomainLabel } from "../../shared/types";
import "./index.scss";

type Step =
  | "nickname"
  | "gender"
  | "countries"
  | "social_links"
  | "optional_social"
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

type WeeklySlot = { start: string; end: string };

/** Presets for /api/onboarding weeklySchedule JSON */
const AVAIL_WEEKDAY_9_18: Record<string, WeeklySlot[]> = {
  mon: [{ start: "09:00", end: "18:00" }],
  tue: [{ start: "09:00", end: "18:00" }],
  wed: [{ start: "09:00", end: "18:00" }],
  thu: [{ start: "09:00", end: "18:00" }],
  fri: [{ start: "09:00", end: "18:00" }],
};

const AVAIL_MON_SAT_10_20: Record<string, WeeklySlot[]> = {
  mon: [{ start: "10:00", end: "20:00" }],
  tue: [{ start: "10:00", end: "20:00" }],
  wed: [{ start: "10:00", end: "20:00" }],
  thu: [{ start: "10:00", end: "20:00" }],
  fri: [{ start: "10:00", end: "20:00" }],
  sat: [{ start: "10:00", end: "20:00" }],
};

export default function OnboardingPage() {
  const [step, setStep] = useState<Step>("nickname");
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 0,
      role: "system",
      content:
        "欢迎来到 Help & Grow 青年志愿导师计划。本项目由新加坡社会企业 Help & Grow 发起，面向中国与东南亚青年。我们先为你建立一张可信的导师主页，让需要帮助的学员可以找到你。请问怎么称呼你？",
    },
  ]);
  const [input, setInput] = useState("");
  const [formData, setFormData] = useState<Record<string, string>>({});
  const [selectedDomains, setSelectedDomains] = useState<string[]>([]);
  const [, setGenerating] = useState(false);
  const [msgId, setMsgId] = useState(1);
  const scrollRef = useRef<string>("");
  const [previewExpertId, setPreviewExpertId] = useState<string | null>(null);
  const [documentReadyForPublish, setDocumentReadyForPublish] = useState(false);
  const [selectedCountries, setSelectedCountries] = useState<string[]>([]);
  const [countrySearch, setCountrySearch] = useState("");

  const countryResults = useMemo(
    () => searchCountries(countrySearch).slice(0, 12),
    [countrySearch],
  );

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
        setStep("countries");
        setTimeout(
          () =>
            addMsg(
              "system",
              "你熟悉哪些国家或地区的市场和文化？可多选，方便有同地需求的同学找到你。也可以跳过。",
            ),
          400,
        );
        break;

      case "social_links":
        if (!formData.linkedIn) {
          const normalized = text.trim().toLowerCase();
          const value =
            normalized === "skip" || text.trim() === "跳过" ? "" : text.trim();
          setFormData((p) => ({ ...p, linkedIn: value }));
          if (value) saveToServer({ linkedIn: value });
          setTimeout(
            () => addMsg("system", "如果有个人官网，也可以填写；没有的话直接跳过。"),
            400
          );
        } else {
          const normalized = text.trim().toLowerCase();
          const val =
            normalized === "skip" || text.trim() === "跳过" ? "" : text;
          setFormData((p) => ({ ...p, website: val }));
          if (val) saveToServer({ website: val });
          setStep("optional_social");
          setTimeout(
            () =>
              addMsg(
                "system",
                "其他社交链接（可选）：粘贴 X、小红书、Substack 等主页，或点「跳过」。"
              ),
            400
          );
        }
        break;

      case "optional_social": {
        const normalized = text.trim().toLowerCase();
        if (normalized === "skip" || text.trim() === "跳过") {
          addMsg("user", "跳过");
        } else if (text.trim()) {
          const line = text.trim();
          addMsg("user", line);
          const lower = line.toLowerCase();
          if (lower.includes("xiaohongshu") || lower.includes("xhslink")) {
            saveToServer({ xiaohongshu: line });
          } else {
            saveToServer({ twitter: line });
          }
        } else {
          addMsg("user", "跳过");
        }
        setStep("domains");
        setTimeout(() => addMsg("system", "如果你愿意，可以选择几个擅长方向；也可以直接下一步。"), 400);
        break;
      }

      case "pricing":
        if (!formData.priceOnline) {
          const cents = parseInt(text) * 100;
          if (isNaN(cents) || cents < 0) {
            setTimeout(() => addMsg("system", "请输入有效金额（示例：100，或输入 0 表示免费）："), 200);
            return;
          }
          setFormData((p) => ({ ...p, priceOnline: String(cents) }));
          saveToServer({ priceOnlineCents: cents });
          if (formData.sessionType !== "ONLINE") {
            setTimeout(() => addMsg("system", "请填写线下每小时价格（SGD）："), 400);
          } else {
            proceedToAvailability();
          }
        } else {
          const cents = parseInt(text) * 100;
          if (isNaN(cents) || cents < 0) {
            setTimeout(() => addMsg("system", "请输入有效金额，或输入 0 表示免费："), 200);
            return;
          }
          setFormData((p) => ({ ...p, priceOffline: String(cents) }));
          saveToServer({ priceOfflineCents: cents });
          proceedToAvailability();
        }
        break;

      default:
        break;
    }
  };

  const proceedToAvailability = () => {
    setStep("availability");
    setTimeout(
      () =>
        addMsg(
          "system",
          "设置每周可安排见面的时段。可选预设，或跳过稍后在「我的」里设置。"
        ),
      400
    );
  };

  const pickAvailability = (
    schedule: Record<string, WeeklySlot[]>,
    userLabel: string
  ) => {
    addMsg("user", userLabel);
    saveToServer({ weeklySchedule: schedule });
    proceedToDocument();
  };

  const skipAvailability = () => {
    addMsg("user", "跳过，稍后设置");
    saveToServer({ weeklySchedule: {} });
    proceedToDocument();
  };

  const proceedToDocument = () => {
    setStep("document");
    setTimeout(
      () =>
        addMsg(
          "system",
          "请上传一份服务介绍 PDF，用来展示你的专业背景、服务范围与合作方式。你可以先跳过继续生成草稿，但正式发布前必须补齐。"
        ),
      400
    );
  };

  const selectGender = (gender: "male" | "female" | "other", label: string) => {
    addMsg("user", label);
    setFormData((p) => ({ ...p, gender }));
    saveToServer({ gender });
    setStep("countries");
    setTimeout(
      () =>
        addMsg(
          "system",
          "你熟悉哪些国家或地区的市场和文化？可多选，方便有同地需求的同学找到你。也可以跳过。",
        ),
      400,
    );
  };

  const toggleCountry = (code: string) => {
    setSelectedCountries((prev) =>
      prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code],
    );
  };

  const confirmCountries = () => {
    if (selectedCountries.length > 0) {
      const labels = selectedCountries
        .map((code) => getCountryOption(code)?.nameZh ?? code)
        .join("、");
      addMsg("user", labels);
      saveToServer({ countries: selectedCountries });
    } else {
      addMsg("user", "暂不设置");
    }
    setStep("social_links");
    setTimeout(
      () => addMsg("system", "如果你愿意，可以填写一个 LinkedIn 链接；也可以直接跳过。"),
      400,
    );
  };

  const toggleDomain = (domain: string) => {
    setSelectedDomains((prev) =>
      prev.includes(domain) ? prev.filter((d) => d !== domain) : [...prev, domain]
    );
  };

  const confirmDomains = () => {
    addMsg("user", selectedDomains.length > 0 ? selectedDomains.join(", ") : "暂不设置领域");
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
      const file = chooseRes.tempFiles[0] as {
        path?: string;
        tempFilePath?: string;
        name?: string;
      };
      const filePath = file.path || file.tempFilePath;
      if (!filePath) {
        Taro.showToast({ title: "无法读取文件，请重试", icon: "none" });
        return;
      }

      Taro.showLoading({ title: "上传中..." });

      const token = getToken();
      const API_BASE = getApiBase();
      const uploadRes = await Taro.uploadFile({
        url: `${API_BASE}/api/onboarding/upload`,
        filePath,
        name: "file",
        header: token ? { "x-wechat-token": token } : {},
      });

      Taro.hideLoading();

      let ok = uploadRes.statusCode === 200;
      if (ok && uploadRes.data != null) {
        const raw = uploadRes.data as unknown;
        if (typeof raw === "string") {
          try {
            const parsed = JSON.parse(raw) as { error?: string; success?: boolean };
            ok = !parsed.error && parsed.success !== false;
          } catch {
            ok = true;
          }
        } else if (typeof raw === "object" && raw !== null && "error" in raw) {
          ok = false;
        }
      }

      if (ok) {
        addMsg("user", `📄 ${file.name || "简历.pdf"}`);
        addMsg("system", "资料已收妥，正在生成你的导师主页草稿...");
        setDocumentReadyForPublish(true);
        await generateProfile();
      } else {
        Taro.showToast({ title: "上传失败，请检查网络或 PDF 小于 5MB", icon: "none" });
      }
    } catch (err) {
      Taro.hideLoading();
      console.error("[onboarding] PDF upload", err);
      Taro.showToast({ title: "上传失败", icon: "none" });
    }
  };

  const skipDocument = async () => {
    addMsg("user", "跳过");
    addMsg("system", "我们先继续生成导师主页草稿。请注意：正式发布前仍需补充服务介绍 PDF。");
    setDocumentReadyForPublish(false);
    await generateProfile();
  };

  const generateProfile = async () => {
    setStep("generating");
    setGenerating(true);

    try {
      const res = await post<{ expertId?: string }>("/api/onboarding/generate", {});
      if (res.statusCode === 200) {
        if (res.data?.expertId) {
          setPreviewExpertId(res.data.expertId);
        }
        setStep("voice_sample");
        setTimeout(
          () =>
            addMsg(
              "system",
              "主页草稿已生成。MVP 会按性别为你生成一段默认语音介绍，你可以直接继续。"
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

  const skipVoice = async () => {
    addMsg("user", "生成默认语音并继续");
    Taro.showLoading({ title: "生成默认语音中..." });
    try {
      await post("/api/expert/generate-audio", {});
    } catch {}
    Taro.hideLoading();
    try {
      const pr = await get<{ expert?: { id: string } | null }>("/api/profile");
      if (pr.statusCode === 200 && pr.data?.expert?.id) {
        setPreviewExpertId(pr.data.expert.id);
      }
    } catch {
      /* ignore */
    }
    setStep("preview");
    setTimeout(
      () =>
        addMsg(
          "system",
          documentReadyForPublish
            ? "导师主页已就绪，请预览并发布。"
            : "导师主页已就绪，请先预览；正式发布前仍需补充服务介绍 PDF。"
        ),
      400
    );
  };

  const skipWebsite = () => {
    addMsg("user", "跳过官网");
    setFormData((p) => ({ ...p, website: "" }));
    setStep("optional_social");
    setTimeout(
      () =>
        addMsg(
          "system",
          "其他社交链接（可选）：粘贴 X、小红书、Substack 等主页，或点「跳过」。"
        ),
      400
    );
  };

  const skipOptionalSocial = () => {
    addMsg("user", "跳过");
    setStep("domains");
    setTimeout(() => addMsg("system", "请选择你的擅长领域："), 400);
  };

  const openPreviewExpert = () => {
    const id = previewExpertId;
    if (!id) {
      Taro.showLoading({ title: "加载中..." });
      get<{ expert?: { id: string } | null }>("/api/profile")
        .then((pr) => {
          Taro.hideLoading();
          if (pr.statusCode === 200 && pr.data?.expert?.id) {
            setPreviewExpertId(pr.data.expert.id);
            Taro.navigateTo({
              url: `/pages/expert/index?id=${pr.data.expert.id}`,
            });
          } else {
            Taro.showToast({ title: "暂无法打开预览", icon: "none" });
          }
        })
        .catch(() => {
          Taro.hideLoading();
          Taro.showToast({ title: "加载失败", icon: "none" });
        });
      return;
    }
    Taro.navigateTo({ url: `/pages/expert/index?id=${id}` });
  };

  const publishProfile = async () => {
    if (!documentReadyForPublish) {
      Taro.showModal({
        title: "发布前需要补充资料",
        content: "正式发布前，请先上传服务介绍 PDF，帮助用户更完整地了解你的专业背景与服务内容。",
        showCancel: false,
      });
      return;
    }

    Taro.showLoading({ title: "发布中..." });
    try {
      const res = await post("/api/onboarding/publish", {});
      if (res.statusCode === 200) {
        Taro.hideLoading();
        Taro.showToast({ title: "发布成功", icon: "success" });
        setTimeout(() => Taro.switchTab({ url: "/pages/profile/index" }), 1500);
      } else {
        const err = res.data as { error?: string };
        throw new Error(err.error || "发布失败");
      }
    } catch (err) {
      Taro.hideLoading();
      Taro.showToast({
        title: err instanceof Error ? err.message : "发布失败",
        icon: "none",
      });
    }
  };

  const showTextInput = [
    "nickname",
    "social_links",
    "optional_social",
    "pricing",
  ].includes(step);

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

        {/* Countries / regions */}
        {step === "countries" && (
          <View className="onboarding__countries">
            <Input
              className="onboarding__country-search"
              placeholder="搜索国家/地区，例如 新加坡、China、ID"
              value={countrySearch}
              onInput={(e) => setCountrySearch(e.detail.value)}
            />
            {selectedCountries.length > 0 && (
              <View className="onboarding__country-chips">
                {selectedCountries.map((code) => {
                  const opt = getCountryOption(code);
                  return (
                    <View
                      key={code}
                      className="onboarding__country-chip onboarding__country-chip--selected"
                      hoverClass="onboarding__option--hover"
                      onClick={() => toggleCountry(code)}
                    >
                      {countryFlagEmoji(code)} {opt?.nameZh ?? code} ✕
                    </View>
                  );
                })}
              </View>
            )}
            <View className="onboarding__country-list">
              {countryResults.map((c) => {
                const checked = selectedCountries.includes(c.code);
                return (
                  <View
                    key={c.code}
                    className={`onboarding__country-row ${
                      checked ? "onboarding__country-row--selected" : ""
                    }`}
                    hoverClass="onboarding__option--hover"
                    onClick={() => toggleCountry(c.code)}
                  >
                    <Text className="onboarding__country-flag">
                      {countryFlagEmoji(c.code)}
                    </Text>
                    <Text className="onboarding__country-name">{c.nameZh}</Text>
                    <Text className="onboarding__country-en">{c.name}</Text>
                    {checked && (
                      <Text className="onboarding__country-check">✓</Text>
                    )}
                  </View>
                );
              })}
              {countryResults.length === 0 && (
                <Text className="onboarding__country-empty">
                  没有找到，换个关键词试试
                </Text>
              )}
            </View>
            <View
              className="onboarding__confirm-btn"
              hoverClass="onboarding__confirm-btn--hover"
              onClick={confirmCountries}
            >
              {selectedCountries.length > 0
                ? `下一步（已选 ${selectedCountries.length} 个）`
                : "下一步（可跳过）"}
            </View>
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
              下一步（可跳过）
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

        {/* Skip website (optional) */}
        {step === "social_links" && formData.linkedIn && (
          <View className="onboarding__options">
            <View
              className="onboarding__option"
              hoverClass="onboarding__option--hover"
              onClick={skipWebsite}
            >
              跳过官网
            </View>
          </View>
        )}

        {step === "social_links" && !formData.linkedIn && (
          <View className="onboarding__options">
            <View
              className="onboarding__option"
              hoverClass="onboarding__option--hover"
              onClick={() => processInput("跳过")}
            >
              跳过 LinkedIn
            </View>
          </View>
        )}

        {/* Skip optional social links */}
        {step === "optional_social" && (
          <View className="onboarding__options">
            <View
              className="onboarding__option"
              hoverClass="onboarding__option--hover"
              onClick={skipOptionalSocial}
            >
              跳过
            </View>
          </View>
        )}

        {/* Weekly availability (after pricing) */}
        {step === "availability" && (
          <View className="onboarding__options">
            <View
              className="onboarding__option"
              hoverClass="onboarding__option--hover"
              onClick={() =>
                pickAvailability(AVAIL_WEEKDAY_9_18, "工作日 9:00–18:00")
              }
            >
              工作日 9:00–18:00（周一至周五）
            </View>
            <View
              className="onboarding__option"
              hoverClass="onboarding__option--hover"
              onClick={() =>
                pickAvailability(AVAIL_MON_SAT_10_20, "周一至周六 10:00–20:00")
              }
            >
              周一至周六 10:00–20:00
            </View>
            <View
              className="onboarding__option"
              hoverClass="onboarding__option--hover"
              onClick={skipAvailability}
            >
              跳过，稍后设置
            </View>
          </View>
        )}

        {/* Document upload */}
        {step === "document" && (
          <View className="onboarding__options">
            <View className="onboarding__option" hoverClass="onboarding__option--hover" onClick={handleDocumentUpload}>
              📄 上传服务介绍 PDF
            </View>
            <View className="onboarding__option" hoverClass="onboarding__option--hover" onClick={skipDocument}>
              先跳过，稍后补充
            </View>
          </View>
        )}

        {/* Generating indicator */}
        {step === "generating" && (
          <View className="onboarding__generating">
            <Text className="onboarding__generating-text">
              ✨ 正在生成导师主页...
            </Text>
          </View>
        )}

        {/* Voice sample */}
        {step === "voice_sample" && (
          <View className="onboarding__voice-section">
            <View className="onboarding__skip-voice" onClick={skipVoice}>
              生成默认语音并继续
            </View>
          </View>
        )}

        {/* Preview & Publish */}
        {step === "preview" && (
          <View className="onboarding__preview-actions">
            {!documentReadyForPublish && (
              <View className="onboarding__publish-note">
                发布前请先补充服务介绍 PDF。没有这份材料，主页仍可预览，但不能正式上线。
              </View>
            )}
            <View
              className="onboarding__preview-btn"
              hoverClass="onboarding__preview-btn--hover"
              onClick={openPreviewExpert}
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
                : step === "optional_social"
                ? "粘贴其他社交主页链接，或点跳过"
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
