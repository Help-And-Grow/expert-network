import { View, Text, Input, ScrollView } from "@tarojs/components";
import Taro, {
  useLoad,
  useDidShow,
  usePullDownRefresh,
  useReachBottom,
} from "@tarojs/taro";
import { useState, useCallback, useRef, useEffect } from "react";
import { get, post } from "../../shared/api";
import ExpertCard from "../../components/ExpertCard";
import type {
  Expert,
  ExpertsResponse,
  MatchRecommendation,
  MatchResponse,
} from "../../shared/types";
import { DOMAINS, getDomainLabel } from "../../shared/types";
import "./index.scss";

type SessionFilter = "all" | "ONLINE" | "OFFLINE";
type SortOption = "reviews" | "newest";
type TabType = "browse" | "match";

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
  const [tab, setTab] = useState<TabType>("browse");
  const [experts, setExperts] = useState<Expert[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [selectedDomains, setSelectedDomains] = useState<string[]>([]);
  const [sessionFilter, setSessionFilter] = useState<SessionFilter>("all");
  const [sortBy, setSortBy] = useState<SortOption>("reviews");

  const [chatInput, setChatInput] = useState("");
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatLoading, setChatLoading] = useState(false);
  const chatScrollId = useRef("");

  const expertsRef = useRef<Expert[]>([]);
  expertsRef.current = experts;
  const take = 20;
  const initialLoadDone = useRef(false);

  const fetchExperts = useCallback(
    async (append = false) => {
      if (append) setLoadingMore(true);
      else setLoading(true);

      try {
        const params: Record<string, string | number | undefined> = {
          sort: sortBy,
          skip: append ? expertsRef.current.length : 0,
          take,
        };
        if (selectedDomains.length) params.domain = selectedDomains.join(",");
        if (sessionFilter !== "all") params.sessionType = sessionFilter;

        const res = await get<ExpertsResponse>("/api/experts", params);
        if (res.statusCode === 200 && res.data.experts) {
          if (append) {
            setExperts((prev) => [...prev, ...res.data.experts]);
          } else {
            setExperts(res.data.experts);
          }
          setTotal(res.data.total);
        }
      } catch {
        if (!append) setExperts([]);
      } finally {
        setLoading(false);
        setLoadingMore(false);
        Taro.stopPullDownRefresh();
      }
    },
    [selectedDomains, sessionFilter, sortBy]
  );

  useLoad(() => {
    fetchExperts();
    initialLoadDone.current = true;
  });

  useDidShow(() => {
    if (initialLoadDone.current) {
      fetchExperts();
    }
  });

  usePullDownRefresh(() => {
    fetchExperts();
  });

  useReachBottom(() => {
    if (tab === "browse" && !loadingMore && experts.length < total) {
      fetchExperts(true);
    }
  });

  const filterKey = `${selectedDomains.join(",")}|${sessionFilter}|${sortBy}`;
  const filterKeyRef = useRef(filterKey);

  if (filterKeyRef.current !== filterKey) {
    filterKeyRef.current = filterKey;
    fetchExperts();
  }

  const toggleDomain = (domain: string) => {
    setSelectedDomains((prev) =>
      prev.includes(domain)
        ? prev.filter((d) => d !== domain)
        : [...prev, domain]
    );
  };

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
      {/* Domain filters */}
      <ScrollView scrollX className="discover__domains" enableFlex enhanced showScrollbar={false}>
        {DOMAINS.map((d) => (
          <View
            key={d}
            className={`discover__domain-chip ${
              selectedDomains.includes(d) ? "discover__domain-chip--active" : ""
            }`}
            hoverClass="discover__domain-chip--hover"
            onClick={() => toggleDomain(d)}
          >
            {getDomainLabel(d)}
          </View>
        ))}
      </ScrollView>

      {/* Session type + Sort */}
      <View className="discover__filters">
        <View className="discover__session-toggle">
          {(["all", "ONLINE", "OFFLINE"] as const).map((st) => (
            <View
              key={st}
              className={`discover__session-btn ${
                sessionFilter === st ? "discover__session-btn--active" : ""
              }`}
              hoverClass="discover__session-btn--hover"
              onClick={() => setSessionFilter(st)}
            >
              {st === "all" ? "全部" : st === "ONLINE" ? "线上" : "线下"}
            </View>
          ))}
        </View>
        <View
          className="discover__sort"
          hoverClass="discover__sort--hover"
          onClick={() => setSortBy(sortBy === "reviews" ? "newest" : "reviews")}
        >
          {sortBy === "reviews" ? "按评价数排序 ↓" : "按最新排序 ↓"}
        </View>
      </View>

      {/* Tabs */}
      <View className="discover__tabs">
        <View
          className={`discover__tab ${tab === "browse" ? "discover__tab--active" : ""}`}
          hoverClass="discover__tab--hover"
          onClick={() => setTab("browse")}
        >
          浏览专家
        </View>
        <View
          className={`discover__tab ${tab === "match" ? "discover__tab--active" : ""}`}
          hoverClass="discover__tab--hover"
          onClick={() => setTab("match")}
        >
          AI 智能匹配
        </View>
      </View>

      {/* Browse tab */}
      {tab === "browse" && (
        <View className="discover__list">
          {loading ? (
            <View className="discover__loading">
              {[1, 2, 3].map((i) => (
                <View key={i} className="discover__skeleton">
                  <View className="discover__skeleton-avatar" />
                  <View className="discover__skeleton-lines">
                    <View className="discover__skeleton-line discover__skeleton-line--w60" />
                    <View className="discover__skeleton-line discover__skeleton-line--w80" />
                    <View className="discover__skeleton-line discover__skeleton-line--w40" />
                  </View>
                </View>
              ))}
            </View>
          ) : experts.length === 0 ? (
            <View className="discover__empty">
              <Text className="discover__empty-icon">🔍</Text>
              <Text className="discover__empty-text">暂无匹配结果</Text>
              <Text className="discover__empty-hint">可以尝试调整筛选条件</Text>
            </View>
          ) : (
            <>
              <View className="discover__count">
                <Text>共找到 {total} 位专家</Text>
              </View>
              {experts.map((expert) => (
                <ExpertCard key={expert.id} expert={expert} />
              ))}
              {loadingMore && (
                <View className="discover__loading-more">
                  <View className="discover__loading-dot" />
                  <View className="discover__loading-dot" />
                  <View className="discover__loading-dot" />
                </View>
              )}
              {!loadingMore && experts.length >= total && experts.length > 0 && (
                <View className="discover__end-mark">
                  <Text>— 已全部加载 —</Text>
                </View>
              )}
            </>
          )}
        </View>
      )}

      {/* AI Match tab */}
      {tab === "match" && (
        <View className="discover__match">
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
      )}
    </View>
  );
}
