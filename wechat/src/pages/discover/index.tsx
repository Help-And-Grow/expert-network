import { View, Text, ScrollView, Input } from "@tarojs/components";
import Taro, { useDidShow, useLoad } from "@tarojs/taro";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { post } from "../../shared/api";
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

/**
 * Maximum number of chat messages sent as conversation history.
 * Capping at 6 (3 turns) keeps the payload small, lets the server
 * hit the vector fast-path, and prevents Vercel function timeouts.
 */
const MAX_HISTORY_MESSAGES = 6;

/** Local match-result cache keyed by query to avoid redundant API calls */
// Bumped to v2 (2026-05-07): the v1 cache could pin a transient empty
// result from a server outage and never re-fetch. v2 only caches non-empty
// results — see runMatch(). The key bump also wipes any v1 stale entries
// from existing user devices on the next mini-program update.
const MATCH_CACHE_KEY = "hg-discover-match-cache-v2";
const MATCH_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

interface CachedMatch {
  query: string;
  result: MatchResponse;
  ts: number;
}

function loadMatchCache(): Map<string, CachedMatch> {
  try {
    const raw = Taro.getStorageSync(MATCH_CACHE_KEY);
    if (!raw) return new Map();
    const arr = JSON.parse(raw) as CachedMatch[];
    const map = new Map<string, CachedMatch>();
    const now = Date.now();
    for (const c of arr) {
      if (now - c.ts < MATCH_CACHE_TTL) map.set(c.query, c);
    }
    return map;
  } catch {
    return new Map();
  }
}

function saveMatchCache(map: Map<string, CachedMatch>) {
  try {
    const arr = Array.from(map.values()).slice(-30); // keep last 30 entries
    Taro.setStorageSync(MATCH_CACHE_KEY, JSON.stringify(arr));
  } catch {
    // quota
  }
}

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

function normalizeRecommendationSummary(
  summary: string | undefined,
  reason: string | undefined,
): string {
  const trimmedReason = reason?.trim();
  if (trimmedReason && hasChineseText(trimmedReason)) {
    return trimmedReason;
  }
  const trimmedSummary = summary?.trim();
  if (trimmedSummary) return trimmedSummary;
  return normalizeRecommendationReason(reason);
}

export default function DiscoverPage() {
  const [matching, setMatching] = useState(false);
  const [draft, setDraft] = useState("");
  const [scrollIntoView, setScrollIntoView] = useState("");
  const matchingRef = useRef(false);
  const cacheRef = useRef(loadMatchCache());
  const [chatMessages, setChatMessages] = useState<DiscoverMatchChatMessage[]>(() => {
    return loadDiscoverMatchFromWeChatStorage() ?? [];
  });

  const runMatch = useCallback(async (query: string) => {
    const q = query.trim();
    if (!q || matchingRef.current) return;
    matchingRef.current = true;
    setMatching(true);
    const withUser: DiscoverMatchChatMessage[] = [...chatMessages, { role: "user", content: q }];
    setChatMessages(withUser);

    // Check cache first
    const cached = cacheRef.current.get(q);
    if (cached) {
      matchingRef.current = false;
      setMatching(false);
      setChatMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          recommendations: cached.result.recommendations ?? [],
          noMatchMessage: cached.result.noMatchMessage,
        },
      ]);
      return;
    }

    // Limit history to the last MAX_HISTORY_MESSAGES to keep payload small and
    // allow the server vector fast-path, avoiding Vercel function timeouts.
    const trimmedMessages = chatMessages.slice(-MAX_HISTORY_MESSAGES);
    const history = discoverMatchMessagesToApiHistory(trimmedMessages);

    try {
      const res = await post<MatchResponse>("/api/experts/match", {
        query: q,
        history,
      });

      if (res.statusCode === 200) {
        const result = res.data;
        // Only cache non-empty results. Empty recommendations can be a
        // transient state (server cold-start, vector index warming up,
        // upstream LLM blip) and pinning that for 5 minutes makes the
        // problem look permanent to the user. If we get nothing back,
        // skip the cache so the next tap goes back to the server.
        if ((result.recommendations?.length ?? 0) > 0) {
          cacheRef.current.set(q, { query: q, result, ts: Date.now() });
          saveMatchCache(cacheRef.current);
        }

        setChatMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            recommendations: result.recommendations ?? [],
            noMatchMessage: result.noMatchMessage,
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
      matchingRef.current = false;
      setMatching(false);
    }
  }, [chatMessages]);

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
            <View className="discover__chat-hint-icon">
              <Icon name="sparkles" size={40} color="#6366f1" />
            </View>
            <Text className="discover__chat-hint-title">发现你的专家</Text>
            <Text className="discover__chat-hint-desc">
              描述你的问题或场景，AI 帮你找到最合适的专家
            </Text>
            <View className="discover__chat-hint-examples">
              <Text className="discover__chat-hint-example">"我需要融资策略建议"</Text>
              <Text className="discover__chat-hint-example">"帮我优化招聘流程"</Text>
              <Text className="discover__chat-hint-example">"新加坡公司合规咨询"</Text>
            </View>
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
                      ✨ 为你匹配到 {m.recommendations.length} 位专家
                    </Text>
                    {m.recommendations.map((item) => (
                      <View key={item.expertId} className="discover__match-card" hoverClass="discover__match-card--hover" onClick={() => openExpert(item.expertId)}>
                        <View className="discover__match-avatar">
                          {item.name
                            .split(" ")
                            .map((part) => part[0])
                            .join("")
                            .toUpperCase()
                            .slice(0, 2)}
                        </View>
                        <View className="discover__match-body">
                          <View className="discover__match-name-row">
                            <Text className="discover__match-name">{item.name}</Text>
                            <View className="discover__match-arrow">
                              <Icon name="chevronRight" size={16} color="#9ca3af" />
                            </View>
                          </View>
                          <Text className="discover__match-reason">
                            {normalizeRecommendationSummary(item.summary, item.reason)}
                          </Text>
                          <View className="discover__match-btn-row">
                            <View className="discover__match-btn">
                              查看主页
                            </View>
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
            <View className="discover__typing-dots">
              <View className="discover__typing-dot" />
              <View className="discover__typing-dot discover__typing-dot--2" />
              <View className="discover__typing-dot discover__typing-dot--3" />
            </View>
            <Text className="discover__typing-text">AI 正在为你匹配专家…</Text>
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
          placeholder="描述你的问题或场景…"
          confirmType="send"
          onInput={(e) => setDraft(e.detail.value)}
          onConfirm={sendDraft}
        />
        <View
          className="discover__composer-send"
          hoverClass="discover__composer-send--hover"
          onClick={sendDraft}
        >
          <Icon name="send" size={20} color="#fff" />
        </View>
      </View>
    </View>
  );
}
