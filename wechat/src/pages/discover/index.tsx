import { View, Text, ScrollView, Input } from "@tarojs/components";
import Taro, { useDidShow, useLoad } from "@tarojs/taro";
import { useCallback, useEffect, useMemo, useState } from "react";

import { get, post } from "../../shared/api";
import Icon from "../../components/Icon";
import {
  type DiscoverMatchChatMessage,
  discoverMatchMessagesToApiHistory,
  loadDiscoverMatchFromWeChatStorage,
  saveDiscoverMatchToWeChatStorage,
} from "../../shared/discover-match-storage";
import type { MatchResponse } from "../../shared/types";
import "./index.scss";

/** Short labels for quick-match chips — concise for mobile */
const QUICK_TAGS = [
  { label: "增长策略", prompt: "我正在找一位能帮我梳理产品增长策略的专家" },
  { label: "招聘优化", prompt: "我希望请教招聘负责人，优化核心岗位招聘方案" },
  { label: "法律合规", prompt: "我想尽快确认公司合同与合规风险，找法律专家" },
  { label: "融资策略", prompt: "我需要融资策略与投资人沟通建议" },
] as const;

function hasChineseText(value?: string): boolean {
  return Boolean(value && /[\u4e00-\u9fa5]/.test(value));
}

function normalizeNoMatchMessage(message?: string): string {
  if (!message) {
    return "暂时还没有找到完全贴合的专家。可以补充更具体的背景后再试。";
  }
  return hasChineseText(message)
    ? message
    : "暂时还没有找到完全贴合的专家。可以补充更具体的背景后再试。";
}

function normalizeRecommendationReason(reason?: string): string {
  if (!reason) {
    return "与你当前问题最相关的经验与服务方向。";
  }
  return hasChineseText(reason) ? reason : "与你当前问题最相关的经验与服务方向。";
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
          return;
        }
        setHasInvite(false);
        promptInviteCode();
      })
      .catch(() => setHasInvite(true));
  }, []);

  function promptInviteCode() {
    Taro.showModal({
      title: "需要邀请码",
      content: "帮助与成长当前为邀请体验制，请输入邀请码继续浏览。",
      editable: true,
      placeholderText: "请输入邀请码",
      confirmText: "提交",
      cancelText: "返回",
      success: (res) => {
        if (res.confirm && res.content) {
          const code = res.content.trim().toUpperCase();
          post<{ success?: boolean; error?: string }>("/api/invite/validate", { code })
            .then((response) => {
              if (response.statusCode === 200 && response.data?.success) {
                Taro.setStorageSync("hasInvite", "true");
                setHasInvite(true);
                Taro.showToast({ title: "欢迎加入", icon: "success" });
                return;
              }
              Taro.showToast({
                title: response.data?.error || "邀请码无效",
                icon: "none",
              });
              setTimeout(() => promptInviteCode(), 1500);
            })
            .catch(() => {
              Taro.showToast({ title: "网络异常，请重试", icon: "none" });
              setTimeout(() => promptInviteCode(), 1500);
            });
          return;
        }
        Taro.switchTab({ url: "/pages/index/index" });
      },
    });
  }

  return hasInvite;
}

export default function DiscoverPage() {
  const hasInvite = useInviteGuard();
  const [matching, setMatching] = useState(false);
  const [draft, setDraft] = useState("");
  const [scrollIntoView, setScrollIntoView] = useState("");
  const [chatMessages, setChatMessages] = useState<DiscoverMatchChatMessage[]>(() => {
    return loadDiscoverMatchFromWeChatStorage() ?? [];
  });

  const runMatch = useCallback(async (query: string) => {
    const q = query.trim();
    if (!q || matching) return;
    const withUser: DiscoverMatchChatMessage[] = [...chatMessages, { role: "user", content: q }];
    setChatMessages(withUser);
    setMatching(true);

    const history = discoverMatchMessagesToApiHistory(withUser);

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
            recommendations: res.data.recommendations ?? [],
            noMatchMessage: res.data.noMatchMessage,
          },
        ]);
      } else {
        setChatMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            noMatchMessage: "这次匹配没有成功，请稍后再试。",
          },
        ]);
      }
    } catch {
      setChatMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          noMatchMessage: "这次匹配没有成功，请稍后再试。",
        },
      ]);
    } finally {
      setMatching(false);
    }
  }, [matching, chatMessages]);

  const openExpert = useCallback((expertId: string) => {
    Taro.navigateTo({ url: `/pages/expert/index?id=${expertId}` });
  }, []);

  const sendDraft = useCallback(() => {
    const t = draft.trim();
    if (!t) return;
    setDraft("");
    void runMatch(t);
  }, [draft, runMatch]);

  useEffect(() => {
    saveDiscoverMatchToWeChatStorage(chatMessages);
  }, [chatMessages]);

  useEffect(() => {
    setScrollIntoView("discover-anchor");
    const t = setTimeout(() => setScrollIntoView(""), 200);
    return () => clearTimeout(t);
  }, [chatMessages.length, matching]);

  useLoad(() => {
    Taro.setNavigationBarTitle({ title: "发现" });
  });

  useDidShow(() => {
    Taro.setNavigationBarTitle({ title: "发现" });
  });

  const activeQuickPrompt = useMemo(() => {
    const lastUser = [...chatMessages].reverse().find((m) => m.role === "user" && m.content);
    const c = lastUser?.content ?? "";
    return (QUICK_TAGS as readonly { label: string; prompt: string }[]).some((t) => t.prompt === c) ? c : "";
  }, [chatMessages]);

  if (hasInvite === false || hasInvite === null) {
    return (
      <View className="discover discover--loading">
        <Text className="discover__loading-text">
          {hasInvite === null ? "加载中..." : "需要邀请码"}
        </Text>
      </View>
    );
  }

  return (
    <View className="discover discover--chat">
      <ScrollView
        scrollY
        className="discover__messages"
        scrollIntoView={scrollIntoView}
        scrollWithAnimation
      >
        {chatMessages.length === 0 && !matching && (
          <View className="discover__chat-hint">
            <Text className="discover__chat-hint-title">专家匹配</Text>
            <Text className="discover__chat-hint-desc">
              用一句话描述你的问题或场景，AI 为你匹配最合适的专家。
            </Text>
          </View>
        )}

        {chatMessages.map((m, turnIdx) => (
          <View key={`turn-${turnIdx}`} className="discover__thread-turn">
            {m.role === "user" && m.content && (
              <View className="discover__bubble discover__bubble--user">
                <Text className="discover__bubble-text">{m.content}</Text>
              </View>
            )}
            {m.role === "assistant" && (
              <View className="discover__bubble discover__bubble--assistant">
                {m.recommendations && m.recommendations.length > 0 ? (
                  <View className="discover__match-list">
                    <Text className="discover__match-heading">
                      为你匹配到 {m.recommendations.length} 位专家
                    </Text>
                    {m.recommendations.map((item) => (
                      <View key={item.expertId} className="discover__match-card">
                        <View className="discover__match-avatar">
                          {item.name
                            .split(" ")
                            .map((part) => part[0])
                            .join("")
                            .toUpperCase()
                            .slice(0, 2)}
                        </View>
                        <View className="discover__match-body">
                          <Text className="discover__match-name">{item.name}</Text>
                          {item.sessionTypes && item.sessionTypes.length > 0 && (
                            <View className="discover__match-domains">
                              {item.sessionTypes.slice(0, 3).map((d) => (
                                <Text key={d} className="discover__match-domain-chip">{d}</Text>
                              ))}
                            </View>
                          )}
                          <Text className="discover__match-reason">
                            {normalizeRecommendationReason(item.reason)}
                          </Text>
                          <View
                            className="discover__match-btn"
                            hoverClass="discover__match-btn--hover"
                            onClick={() => openExpert(item.expertId)}
                          >
                            <Icon name="chevronRight" size={14} color="#fff" /> 查看主页
                          </View>
                        </View>
                      </View>
                    ))}
                  </View>
                ) : m.noMatchMessage ? (
                  <View className="discover__empty-state discover__empty-state--inline">
                    <Text className="discover__empty-title">本轮说明</Text>
                    <Text className="discover__empty-desc">
                      {normalizeNoMatchMessage(m.noMatchMessage)}
                    </Text>
                  </View>
                ) : null}
              </View>
            )}
          </View>
        ))}

        {matching && (
          <View className="discover__typing">
            <Text className="discover__typing-text">正在匹配…</Text>
          </View>
        )}

        <View id="discover-anchor" className="discover__anchor" />
      </ScrollView>

      <ScrollView scrollX className="discover__quick-scroll">
        <View className="discover__quick-inner">
          {QUICK_TAGS.map((tag) => (
            <View
              key={tag.label}
              className={`discover__quick-chip ${
                activeQuickPrompt === tag.prompt ? "discover__quick-chip--active" : ""
              }`}
              hoverClass="discover__quick-chip--hover"
              onClick={() => runMatch(tag.prompt)}
            >
              <Text className="discover__quick-chip-text">{tag.label}</Text>
            </View>
          ))}
        </View>
      </ScrollView>

      <View className="discover__composer">
        <Input
          className="discover__composer-input"
          type="text"
          value={draft}
          placeholder="说说你的问题或场景…"
          confirmType="send"
          onInput={(e) => setDraft(e.detail.value)}
          onConfirm={sendDraft}
        />
        <View
          className="discover__composer-send"
          hoverClass="discover__composer-send--hover"
          onClick={sendDraft}
        >
          <Text className="discover__composer-send-text">发送</Text>
        </View>
      </View>
    </View>
  );
}
