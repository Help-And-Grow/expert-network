import { View, Text, ScrollView } from "@tarojs/components";
import Taro, { useDidShow, useLoad } from "@tarojs/taro";
import { useCallback, useEffect, useMemo, useState } from "react";

import ExpertCard from "../../components/ExpertCard";
import { get, post } from "../../shared/api";
import {
  type DiscoverMatchChatMessage,
  discoverMatchMessagesToApiHistory,
  loadDiscoverMatchFromWeChatStorage,
  saveDiscoverMatchToWeChatStorage,
} from "../../shared/discover-match-storage";
import type {
  Expert,
  ExpertsResponse,
  MatchResponse,
} from "../../shared/types";
import "./index.scss";

const QUICK_MATCH_PROMPTS = [
  "我正在找一位能帮我梳理产品增长策略的专家",
  "我希望请教招聘负责人，优化核心岗位招聘方案",
  "我想尽快确认公司合同与合规风险，找法律专家",
  "我需要融资策略与投资人沟通建议",
] as const;

function hasChineseText(value?: string): boolean {
  return Boolean(value && /[\u4e00-\u9fa5]/.test(value));
}

function normalizeNoMatchMessage(message?: string): string {
  if (!message) {
    return "暂时还没有找到完全贴合的专家。你可以先浏览精选主页，或稍后补充更具体的背景。";
  }
  return hasChineseText(message)
    ? message
    : "暂时还没有找到完全贴合的专家。你可以先浏览精选主页，或稍后补充更具体的背景。";
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
  const [featuredExperts, setFeaturedExperts] = useState<Expert[]>([]);
  const [featuredLoading, setFeaturedLoading] = useState(true);
  const [featuredError, setFeaturedError] = useState("");
  const [matching, setMatching] = useState(false);
  const [chatMessages, setChatMessages] = useState<DiscoverMatchChatMessage[]>(() => {
    return loadDiscoverMatchFromWeChatStorage() ?? [];
  });

  const fetchFeaturedExperts = useCallback(async () => {
    setFeaturedLoading(true);
    setFeaturedError("");
    try {
      const res = await get<ExpertsResponse>("/api/experts", {
        take: 6,
        sort: "reviews",
      });
      if (res.statusCode === 200) {
        setFeaturedExperts(res.data.experts ?? []);
      } else {
        setFeaturedError("精选专家暂时不可用，请稍后重试。");
      }
    } catch {
      setFeaturedError("精选专家暂时不可用，请稍后重试。");
    } finally {
      setFeaturedLoading(false);
    }
  }, []);

  const runMatch = useCallback(async (query: string) => {
    if (!query || matching) return;
    const withUser: DiscoverMatchChatMessage[] = [...chatMessages, { role: "user", content: query }];
    setChatMessages(withUser);
    setMatching(true);

    const history = discoverMatchMessagesToApiHistory(withUser);

    try {
      const res = await post<MatchResponse>("/api/experts/match", {
        query,
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

  useEffect(() => {
    saveDiscoverMatchToWeChatStorage(chatMessages);
  }, [chatMessages]);

  useLoad(() => {
    Taro.setNavigationBarTitle({ title: "发现专家" });
    void fetchFeaturedExperts();
  });

  useDidShow(() => {
    Taro.setNavigationBarTitle({ title: "发现专家" });
  });

  const activeQuickPrompt = useMemo(() => {
    const lastUser = [...chatMessages].reverse().find((m) => m.role === "user" && m.content);
    const c = lastUser?.content ?? "";
    return (QUICK_MATCH_PROMPTS as readonly string[]).includes(c) ? c : "";
  }, [chatMessages]);

  const featuredSectionTitle = useMemo(() => {
    if (chatMessages.length === 0) return "本周精选";
    return "更多专家";
  }, [chatMessages.length]);

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
    <ScrollView scrollY className="discover">
      <View className="discover__hero">
        <Text className="discover__eyebrow">Expert Concierge</Text>
        <Text className="discover__title">先找到对的人，再安排一次见面。</Text>
        <Text className="discover__desc">
          先浏览可信的专家主页、听一段语音介绍，再决定是否进入网页完成登录并安排见面。
        </Text>
      </View>

      <View className="discover__voice-card">
        <View className="discover__voice-card-head">
          <Text className="discover__voice-card-badge">语音礼宾</Text>
          <Text className="discover__voice-card-status">即将开放</Text>
        </View>
        <Text className="discover__voice-card-title">
          用语音描述你的阶段、问题与目标，我们会优先为你整理合适的专家线索。
        </Text>
        <Text className="discover__voice-card-desc">
          当前 demo 先开放精选推荐与快捷匹配。实时语音礼宾将在后续订阅版本上线。
        </Text>
      </View>

      <View className="discover__section">
        <Text className="discover__section-title">快捷匹配</Text>
        <Text className="discover__section-sub">
          先选一个接近当前问题的场景，系统会给出一组优先建议。从专家主页返回本页后，对话与推荐仍会保留。
        </Text>
        <View className="discover__prompt-grid">
          {QUICK_MATCH_PROMPTS.map((prompt) => (
            <View
              key={prompt}
              className={`discover__prompt-chip ${
                activeQuickPrompt === prompt ? "discover__prompt-chip--active" : ""
              }`}
              hoverClass="discover__prompt-chip--hover"
              onClick={() => runMatch(prompt)}
            >
              {prompt}
            </View>
          ))}
        </View>
      </View>

      {(chatMessages.length > 0 || matching) && (
        <View className="discover__section">
          <View className="discover__section-head">
            <Text className="discover__section-title">匹配对话</Text>
            {matching && <Text className="discover__section-note">匹配中...</Text>}
          </View>
          {chatMessages.map((m, turnIdx) => (
            <View key={`turn-${turnIdx}`} className="discover__thread-turn">
              {m.role === "user" && m.content && (
                <View className="discover__user-turn">
                  <Text className="discover__thread-label">你的描述</Text>
                  <Text className="discover__user-turn-text">{m.content}</Text>
                </View>
              )}
              {m.role === "assistant" && (
                <View className="discover__assistant-turn">
                  {m.recommendations && m.recommendations.length > 0 ? (
                    <View className="discover__match-list">
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
                            <Text className="discover__match-reason">
                              {normalizeRecommendationReason(item.reason)}
                            </Text>
                            <View
                              className="discover__match-btn"
                              hoverClass="discover__match-btn--hover"
                              onClick={() => openExpert(item.expertId)}
                            >
                              查看专家主页
                            </View>
                          </View>
                        </View>
                      ))}
                    </View>
                  ) : m.noMatchMessage ? (
                    <View className="discover__empty-state discover__empty-state--inline">
                      <Text className="discover__empty-title">本轮匹配说明</Text>
                      <Text className="discover__empty-desc">
                        {normalizeNoMatchMessage(m.noMatchMessage)}
                      </Text>
                    </View>
                  ) : null}
                </View>
              )}
            </View>
          ))}
        </View>
      )}

      <View className="discover__section">
        <View className="discover__section-head">
          <Text className="discover__section-title">{featuredSectionTitle}</Text>
        </View>
        {featuredLoading ? (
          <View className="discover__skeleton-list">
            {[1, 2, 3].map((item) => (
              <View key={item} className="discover__skeleton-card" />
            ))}
          </View>
        ) : featuredExperts.length > 0 ? (
          <View className="discover__featured-list">
            {featuredExperts.map((expert) => (
              <ExpertCard key={expert.id} expert={expert} />
            ))}
          </View>
        ) : (
          <View className="discover__empty-state">
            <Text className="discover__empty-title">暂无可展示的专家</Text>
            <Text className="discover__empty-desc">
              {featuredError || "请稍后再回来看看。"}
            </Text>
          </View>
        )}
      </View>

      <View className="discover__footer-note">
        <Text className="discover__footer-note-text">
          正式见面、支付与排期仍在网页完成。小程序当前优先服务发现、了解与初步判断。
        </Text>
      </View>
    </ScrollView>
  );
}
