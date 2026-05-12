import { View, Text, ScrollView, Input, Image } from "@tarojs/components";
import Taro, { useDidShow, useLoad } from "@tarojs/taro";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { get } from "../../shared/api";
import Icon from "../../components/Icon";
import { ENABLE_OFFLINE_BOOKINGS } from "../../shared/brand";
import { countryFlagEmoji, getCountryOption } from "../../shared/countries";
import "./index.scss";

/**
 * Discover page for the WeChat Mini Program.
 *
 * 2026-05-07 — pivoted from an AI-chat "find a mentor" experience to a
 * plain list-with-filter browse view.  WeChat platform restricts AI Q&A
 * features to mainland-CN entity-owned mini programs (rejection on
 * 2026-05-07: 「小程序服务内容涉及【ai问答】，属境外主体尚未开放服务类目」)
 * — until our Chinese company entity is provisioned, the intl MP cannot
 * surface any LLM-driven Q&A surface.
 *
 * The replacement is intentionally minimal:
 *   - Keyword search (server-side `q` filter on the public /v1/experts endpoint)
 *   - Session-type chips (全部 / 线上 / 线下)
 *   - Card list, ordered by rating then review count (server default)
 *   - Tap → mentor profile (existing /pages/expert/index?id=...)
 *
 * No AI calls.  No chat persistence.  No `/api/experts/match`.
 */

type SessionTypeFilter = "ALL" | "ONLINE" | "OFFLINE";

interface MentorListItem {
  id: string;
  name: string;
  image: string | null;
  bio: string;
  sessionType: "ONLINE" | "OFFLINE" | "BOTH";
  rating: number;
  reviewCount: number;
  countries?: string[];
}

interface ExpertsResponse {
  experts: MentorListItem[];
  total: number;
}

const SESSION_FILTERS: { label: string; value: SessionTypeFilter }[] =
  ENABLE_OFFLINE_BOOKINGS
    ? [
        { label: "全部", value: "ALL" },
        { label: "线上", value: "ONLINE" },
        { label: "线下", value: "OFFLINE" },
      ]
    : [
        // Online-only builds (intl) hide the 线下 chip entirely. The server
        // also filters OFFLINE-only experts out of WeChat responses, so this
        // is UI symmetry, not load-bearing.
        { label: "全部", value: "ALL" },
        { label: "线上", value: "ONLINE" },
      ];

const SEARCH_DEBOUNCE_MS = 350;
const PAGE_SIZE = 20;

export default function DiscoverPage() {
  const [searchInput, setSearchInput] = useState("");
  const [committedQuery, setCommittedQuery] = useState("");
  const [sessionFilter, setSessionFilter] = useState<SessionTypeFilter>("ALL");
  const [mentors, setMentors] = useState<MentorListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inflightToken = useRef(0);

  useLoad(() => {
    Taro.setNavigationBarTitle({ title: "找导师" });
  });

  useDidShow(() => {
    Taro.setNavigationBarTitle({ title: "找导师" });
  });

  // Debounced search input — commit `searchInput` to `committedQuery` after
  // the user stops typing for SEARCH_DEBOUNCE_MS, so we don't fire a fetch
  // on every keystroke.
  useEffect(() => {
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
    }
    debounceTimer.current = setTimeout(() => {
      setCommittedQuery(searchInput.trim());
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, [searchInput]);

  // Fetch mentor list whenever filters change.
  const fetchMentors = useCallback(async () => {
    const token = ++inflightToken.current;
    setLoading(true);
    setError(null);

    const params = new URLSearchParams();
    params.set("limit", String(PAGE_SIZE));
    if (committedQuery) params.set("q", committedQuery);
    if (sessionFilter !== "ALL") params.set("sessionType", sessionFilter);

    try {
      const res = await get<ExpertsResponse>(
        `/api/v1/experts?${params.toString()}`,
      );
      // Discard stale responses if a newer fetch has been kicked off.
      if (token !== inflightToken.current) return;
      if (res.statusCode !== 200) {
        throw new Error(`HTTP ${res.statusCode}`);
      }
      setMentors(Array.isArray(res.data?.experts) ? res.data.experts : []);
    } catch (err) {
      if (token !== inflightToken.current) return;
      const message =
        err instanceof Error && err.message
          ? err.message
          : "无法加载导师列表，请稍后再试";
      console.error("[discover] fetch failed", err);
      setError(message);
      setMentors([]);
    } finally {
      if (token === inflightToken.current) setLoading(false);
    }
  }, [committedQuery, sessionFilter]);

  useEffect(() => {
    fetchMentors();
  }, [fetchMentors]);

  const goExpert = useCallback((id: string) => {
    Taro.navigateTo({ url: `/pages/expert/index?id=${id}` });
  }, []);

  const sessionTypeLabel = useCallback(
    (type: MentorListItem["sessionType"]): string => {
      // Online-only build: every visible expert offers online (server filter
      // guarantees ONLINE or BOTH), so collapse the label.
      if (!ENABLE_OFFLINE_BOOKINGS) return "线上";
      if (type === "ONLINE") return "线上";
      if (type === "OFFLINE") return "线下";
      return "线上 / 线下";
    },
    [],
  );

  const headerSummary = useMemo(() => {
    if (loading) return "加载中…";
    if (error) return error;
    if (mentors.length === 0) {
      if (committedQuery || sessionFilter !== "ALL") {
        return "未找到符合条件的导师，试试调整筛选";
      }
      return "暂时还没有公开的志愿导师，过几天再来看看";
    }
    return `${mentors.length} 位志愿导师 · 全部公益`;
  }, [loading, error, mentors.length, committedQuery, sessionFilter]);

  return (
    <View className="discover">
      {/* Header */}
      <View className="discover__header">
        <Text className="discover__title">找一位志愿导师</Text>
        <Text className="discover__subtitle">
          公益项目 · 对青年学员完全免费
        </Text>
      </View>

      {/* Search input */}
      <View className="discover__search">
        <View className="discover__search-icon">
          <Icon name="search" size={18} color="#94a3b8" />
        </View>
        <Input
          className="discover__search-input"
          value={searchInput}
          onInput={(e) => setSearchInput(e.detail.value)}
          placeholder="搜索导师姓名、专业方向或关键词"
          placeholderClass="discover__search-placeholder"
          confirmType="search"
        />
        {searchInput.length > 0 && (
          <View
            className="discover__search-clear"
            hoverClass="discover__search-clear--hover"
            onClick={() => setSearchInput("")}
          >
            <Icon name="x" size={16} color="#94a3b8" />
          </View>
        )}
      </View>

      {/* Filter chips */}
      <View className="discover__filters">
        {SESSION_FILTERS.map((f) => {
          const active = sessionFilter === f.value;
          return (
            <View
              key={f.value}
              className={
                active
                  ? "discover__filter discover__filter--active"
                  : "discover__filter"
              }
              hoverClass="discover__filter--hover"
              onClick={() => setSessionFilter(f.value)}
            >
              <Text>{f.label}</Text>
            </View>
          );
        })}
      </View>

      {/* Result summary */}
      <View className="discover__summary">
        <Text className="discover__summary-text">{headerSummary}</Text>
      </View>

      {/* List */}
      <ScrollView className="discover__list" scrollY enableBackToTop>
        {loading && mentors.length === 0 ? (
          <View className="discover__empty">
            <Text className="discover__empty-text">加载中…</Text>
          </View>
        ) : mentors.length === 0 ? (
          <View className="discover__empty">
            <View className="discover__empty-icon">
              <Icon name="search" size={36} color="#cbd5e1" />
            </View>
            <Text className="discover__empty-text">
              {error || "未找到符合条件的导师"}
            </Text>
            {!error && (
              <Text className="discover__empty-hint">
                试试清空搜索或切换「全部」筛选
              </Text>
            )}
          </View>
        ) : (
          mentors.map((m) => (
            <View
              key={m.id}
              className="discover__card"
              hoverClass="discover__card--hover"
              onClick={() => goExpert(m.id)}
            >
              <View className="discover__card-avatar">
                {m.image ? (
                  <Image
                    src={m.image}
                    className="discover__card-avatar-img"
                    mode="aspectFill"
                  />
                ) : (
                  <Text className="discover__card-avatar-fallback">
                    {(m.name || "导师").slice(0, 1)}
                  </Text>
                )}
              </View>
              <View className="discover__card-body">
                <View className="discover__card-row">
                  <Text className="discover__card-name">{m.name}</Text>
                  {m.reviewCount > 0 && (
                    <Text className="discover__card-rating">
                      ⭐ {m.rating.toFixed(1)} · {m.reviewCount}
                    </Text>
                  )}
                </View>
                {m.bio && (
                  <Text className="discover__card-bio" numberOfLines={2}>
                    {m.bio}
                  </Text>
                )}
                {m.countries && m.countries.length > 0 && (
                  <View className="discover__card-countries">
                    {m.countries.slice(0, 4).map((code) => {
                      const opt = getCountryOption(code);
                      return (
                        <Text key={code} className="discover__card-country">
                          {countryFlagEmoji(code)} {opt?.nameZh ?? code}
                        </Text>
                      );
                    })}
                  </View>
                )}
                <View className="discover__card-meta">
                  <View className="discover__card-tag">
                    <Text className="discover__card-tag-text">
                      {sessionTypeLabel(m.sessionType)}
                    </Text>
                  </View>
                  <View className="discover__card-tag discover__card-tag--free">
                    <Text className="discover__card-tag-text">免费</Text>
                  </View>
                </View>
              </View>
              <View className="discover__card-arrow">
                <Text>›</Text>
              </View>
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );
}
