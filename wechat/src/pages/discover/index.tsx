import { View, Text, Input, ScrollView } from "@tarojs/components";
import Taro, { useLoad, useDidShow } from "@tarojs/taro";
import { useState, useRef, useEffect } from "react";
import { get, post } from "../../shared/api";
import type {
  MatchRecommendation,
  MatchResponse,
} from "../../shared/types";
import "./index.scss";

interface ChatMessage {
  role: "user" | "assistant";
  content?: string;
  recommendations?: MatchRecommendation[];
  noMatchMessage?: string;
}

function hasChineseText(value?: string): boolean {
  return Boolean(value && /[\u4e00-\u9fa5]/.test(value));
}

function normalizeNoMatchMessage(message?: string): string {
  if (!message) return "暂时没有找到完全匹配的专家，请补充更具体的需求。";
  return hasChineseText(message)
    ? message
    : "暂时没有找到完全匹配的专家，请补充更具体的需求。";
}

function normalizeRecommendationReason(reason?: string): string {
  if (!reason) return "匹配到与你需求相关的经验背景。";
  return hasChineseText(reason) ? reason : "匹配到与你需求相关的经验背景。";
}

function useInviteGuard() {
  const [hasInvite, setHasInvite] = useState<boolean | null>(null);

  useEffect(() => {
    const cached = Taro.getStorageSync("hasInvite");
    if (cached === "true") {
      setHasInvite(true);
      return;
    }
    get<{ hasInvite: boolean }>("/api/invite/status")
      .then((res) => {
        if (res.data?.hasInvite) {
          Taro.setStorageSync("hasInvite", "true");
          setHasInvite(true);
        } else {
          setHasInvite(false);
          promptInviteCode();
        }
      })
      .catch(() => setHasInvite(true));
  }, []);

  function promptInviteCode() {
    Taro.showModal({
      title: "需要邀请码",
      content: "帮助与成长当前为邀请制，请输入邀请码继续。",
      editable: true,
      placeholderText: "请输入邀请码",
      confirmText: "提交",
      cancelText: "返回",
      success: (res) => {
        if (res.confirm && res.content) {
          const code = res.content.trim().toUpperCase();
          post<{ success?: boolean; error?: string }>("/api/invite/validate", { code })
            .then((r) => {
              if (r.statusCode === 200 && r.data?.success) {
                Taro.setStorageSync("hasInvite", "true");
                setHasInvite(true);
                Taro.showToast({ title: "欢迎加入", icon: "success" });
              } else {
                Taro.showToast({ title: r.data?.error || "邀请码无效", icon: "none" });
                setTimeout(() => promptInviteCode(), 1500);
              }
            })
            .catch(() => {
              Taro.showToast({ title: "网络异常，请重试", icon: "none" });
              setTimeout(() => promptInviteCode(), 1500);
            });
        } else {
          Taro.switchTab({ url: "/pages/index/index" });
        }
      },
    });
  }

  return hasInvite;
}

export default function DiscoverPage() {
  const hasInvite = useInviteGuard();
  const [chatInput, setChatInput] = useState("");
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatLoading, setChatLoading] = useState(false);
  const chatScrollId = useRef("");

  const sendMatchQuery = async () => {
    const q = chatInput.trim();
    if (!q || chatLoading) return;

    setChatInput("");
    const msgIdx = chatMessages.length;
    setChatMessages((prev) => [...prev, { role: "user", content: q }]);
    setChatLoading(true);
    chatScrollId.current = `chat-msg-${msgIdx}`;

    const history = chatMessages
      .filter(
        (m) => m.role === "user" || (m.role === "assistant" && m.content)
      )
      .map((m) => ({
        role: m.role,
        content:
          m.role === "user"
            ? m.content!
            : m.recommendations
            ? `推荐专家：${m.recommendations.map((r) => r.name).join("、")}`
            : m.noMatchMessage ?? "",
      }));

    try {
      const res = await post<MatchResponse>("/api/experts/match", {
        query: q,
        history,
      });
      if (res.statusCode === 200) {
        setChatMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            recommendations: res.data.recommendations,
            noMatchMessage: res.data.noMatchMessage,
          },
        ]);
        chatScrollId.current = `chat-msg-${msgIdx + 1}`;
      } else {
        throw new Error("匹配失败");
      }
    } catch {
      setChatMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          noMatchMessage: "抱歉，匹配时出现问题，请稍后重试。",
        },
      ]);
    } finally {
      setChatLoading(false);
    }
  };

  const goToExpert = (expertId: string) => {
    Taro.navigateTo({ url: `/pages/expert/index?id=${expertId}` });
  };

  const goToBook = (expertId: string) => {
    Taro.navigateTo({ url: `/pages/book/index?id=${expertId}&from=match` });
  };

  useLoad(() => {
    Taro.setNavigationBarTitle({ title: "AI 智能匹配" });
  });

  useDidShow(() => {
    Taro.setNavigationBarTitle({ title: "AI 智能匹配" });
  });

  if (hasInvite === false || hasInvite === null) {
    return (
      <View className="discover" style={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: "60vh" }}>
        <Text style={{ color: "#94a3b8", fontSize: "14px" }}>
          {hasInvite === null ? "加载中..." : "需要邀请码"}
        </Text>
      </View>
    );
  }

  return (
    <View className="discover">
      <View className="discover__match discover__match--solo">
        <ScrollView
          scrollY
          className="discover__chat"
          scrollIntoView={chatScrollId.current}
          scrollWithAnimation
        >
          {chatMessages.length === 0 && (
            <View className="discover__chat-empty">
              <Text className="discover__chat-empty-icon">✨</Text>
              <Text className="discover__chat-empty-text">
                描述你的目标或问题，我们会帮你匹配合适的专家
              </Text>
              <Text className="discover__chat-empty-hint">
                例如：「我想找熟悉 AI 产品增长策略的导师」
              </Text>
            </View>
          )}
          {chatMessages.map((m, i) => (
            <View
              key={i}
              id={`chat-msg-${i}`}
              className={`discover__chat-msg ${
                m.role === "user"
                  ? "discover__chat-msg--user"
                  : "discover__chat-msg--assistant"
              }`}
            >
              {m.role === "user" && m.content && (
                <View className="discover__chat-bubble discover__chat-bubble--user">
                  {m.content}
                </View>
              )}
              {m.role === "assistant" && (
                <View className="discover__chat-results">
                  {m.recommendations && m.recommendations.length > 0
                    ? m.recommendations.map((rec) => (
                        <View key={rec.expertId} className="discover__rec-card">
                          <View className="discover__rec-avatar">
                            {rec.name
                              .split(" ")
                              .map((n) => n[0])
                              .join("")
                              .toUpperCase()
                              .slice(0, 2)}
                          </View>
                          <View className="discover__rec-info">
                            <Text className="discover__rec-name">{rec.name}</Text>
                            <Text className="discover__rec-reason">
                              {normalizeRecommendationReason(rec.reason)}
                            </Text>
                            <View className="discover__rec-actions">
                              <View
                                className="discover__rec-btn discover__rec-btn--primary"
                                hoverClass="discover__rec-btn--hover"
                                onClick={() => goToBook(rec.expertId)}
                              >
                                预约
                              </View>
                              <View
                                className="discover__rec-btn discover__rec-btn--outline"
                                hoverClass="discover__rec-btn--hover"
                                onClick={() => goToExpert(rec.expertId)}
                              >
                                查看
                              </View>
                            </View>
                          </View>
                        </View>
                      ))
                    : m.noMatchMessage && (
                        <View className="discover__chat-bubble discover__chat-bubble--system">
                          {normalizeNoMatchMessage(m.noMatchMessage)}
                        </View>
                      )}
                </View>
              )}
            </View>
          ))}
          {chatLoading && (
            <View className="discover__chat-loading">
              <View className="discover__loading-dot" />
              <View className="discover__loading-dot" />
              <View className="discover__loading-dot" />
            </View>
          )}
          <View style={{ height: "24px" }} />
        </ScrollView>

        <View className="discover__input-bar">
          <Input
            className="discover__input"
            placeholder="请输入你的需求，例如：需要融资顾问..."
            value={chatInput}
            onInput={(e) => setChatInput(e.detail.value)}
            confirmType="send"
            onConfirm={sendMatchQuery}
            disabled={chatLoading}
            adjustPosition
          />
          <View
            className={`discover__send-btn ${
              !chatInput.trim() || chatLoading ? "discover__send-btn--disabled" : ""
            }`}
            hoverClass="discover__send-btn--hover"
            onClick={sendMatchQuery}
          >
            {chatLoading ? "···" : "→"}
          </View>
        </View>
      </View>
    </View>
  );
}
