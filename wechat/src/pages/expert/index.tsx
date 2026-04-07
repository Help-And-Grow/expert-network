import { View, Text, Image } from "@tarojs/components";
import Taro, { useLoad, useRouter, useShareAppMessage, useShareTimeline } from "@tarojs/taro";
import { useState, useCallback, useRef } from "react";
import { get } from "../../shared/api";
import { getApiBase, getToken } from "../../shared/auth";
import AudioPlayer from "../../components/AudioPlayer";
import VoiceChat from "../../components/VoiceChat";
import type {
  ExpertDetail,
  ServiceItem,
  Review,
  ReviewsResponse,
} from "../../shared/types";
import { getDomainLabel } from "../../shared/types";
import "./index.scss";

const socialConfig = [
  { key: "linkedIn" as const, label: "LinkedIn" },
  { key: "website" as const, label: "官网" },
  { key: "twitter" as const, label: "X" },
  { key: "substack" as const, label: "Substack" },
  { key: "instagram" as const, label: "Instagram" },
  { key: "xiaohongshu" as const, label: "小红书" },
];

export default function ExpertPage() {
  const router = useRouter();
  const expertId = router.params.id || "";
  const [expert, setExpert] = useState<ExpertDetail | null>(null);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [reviewsTotal, setReviewsTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [reviewsLoading, setReviewsLoading] = useState(false);
  const [error, setError] = useState("");
  const [showVoiceChat, setShowVoiceChat] = useState(false);
  const reviewsRef = useRef<Review[]>([]);
  reviewsRef.current = reviews;

  const fetchExpert = useCallback(async () => {
    if (!expertId) return;
    setLoading(true);
    setError("");
    try {
      const res = await get<ExpertDetail>(`/api/experts/${expertId}`);
      if (res.statusCode === 200) {
        setExpert(res.data);
      } else if (res.statusCode === 404) {
        setError("未找到该专家主页");
      } else {
        setError("加载专家主页失败");
      }
    } catch {
      setError("加载专家主页失败");
    } finally {
      setLoading(false);
    }
  }, [expertId]);

  const fetchReviews = useCallback(
    async (append = false) => {
      if (!expertId) return;
      setReviewsLoading(true);
      const skip = append ? reviewsRef.current.length : 0;
      try {
        const res = await get<ReviewsResponse>("/api/reviews", {
          expertId,
          skip,
          take: 5,
        });
        if (res.statusCode === 200) {
          if (append) {
            setReviews((prev) => [...prev, ...res.data.reviews]);
          } else {
            setReviews(res.data.reviews);
          }
          setReviewsTotal(res.data.total);
        }
      } catch {
        if (!append) setReviews([]);
      } finally {
        setReviewsLoading(false);
      }
    },
    [expertId]
  );

  useLoad(() => {
    fetchExpert().then(() => fetchReviews());
    Taro.showShareMenu({ withShareTicket: true });
  });

  useShareAppMessage(() => {
    const name = expert?.user.nickName ?? expert?.user.name ?? "专家";
    return {
      title: `${name} 在 Help & Grow`,
      path: `/pages/expert/index?id=${expertId}`,
    };
  });

  useShareTimeline(() => {
    const name = expert?.user.nickName ?? expert?.user.name ?? "专家";
    return {
      title: `${name} 在 Help & Grow`,
      query: `id=${expertId}`,
    };
  });

  const goToBook = (type: string) => {
    Taro.navigateTo({
      url: `/pages/book/index?id=${expertId}&type=${type}&from=profile`,
    });
  };

  if (loading) {
    return (
      <View className="expert-profile">
        <View className="expert-profile__skeleton">
          <View className="expert-profile__skeleton-avatar" />
          <View className="expert-profile__skeleton-line expert-profile__skeleton-line--lg" />
          <View className="expert-profile__skeleton-line" />
          <View className="expert-profile__skeleton-line expert-profile__skeleton-line--sm" />
        </View>
      </View>
    );
  }

  if (error || !expert) {
    return (
      <View className="expert-profile">
        <View className="expert-profile__error">
          <Text className="expert-profile__error-icon">😔</Text>
          <Text className="expert-profile__error-text">{error || "未找到该专家主页"}</Text>
          <View
            className="expert-profile__error-btn"
            hoverClass="expert-profile__error-btn--hover"
            onClick={() => Taro.navigateBack()}
          >
            返回
          </View>
        </View>
      </View>
    );
  }

  const name = expert.user.nickName || expert.user.name || "成员";
  const services = (expert.servicesOffered as ServiceItem[] | null) ?? [];
  const socialLinks = socialConfig.filter((c) => {
    const url = expert[c.key];
    return url && String(url).trim() !== "";
  });
  const hasMoreReviews = reviews.length < reviewsTotal;
  const API_BASE = getApiBase();

  return (
    <View className="expert-profile">
      {/* Compact Hero */}
      <View className="expert-profile__hero">
        {expert.hasAvatar ? (
          <Image
            className="expert-profile__avatar-img"
            src={`${API_BASE}/api/experts/${expertId}/avatar`}
            mode="aspectFill"
          />
        ) : (
          <View className="expert-profile__avatar-placeholder">
            <Text className="expert-profile__avatar-placeholder-text">
              {name
                .split(" ")
                .map((n) => n[0])
                .join("")
                .toUpperCase()
                .slice(0, 2)}
            </Text>
          </View>
        )}
      </View>

      {/* Name & Info */}
      <View className="expert-profile__info">
        <Text className="expert-profile__name">{name}</Text>
        {expert.isVerified && (
          <View className="expert-profile__verified">✓ 已认证</View>
        )}
        <View className="expert-profile__domains">
          {expert.domains.map((d) => (
            <View key={d} className="expert-profile__domain-chip">{getDomainLabel(d)}</View>
          ))}
        </View>
        <View className="expert-profile__rating">
          <View className="expert-profile__stars">
            {[1, 2, 3, 4, 5].map((i) => (
              <Text
                key={i}
                className={`expert-profile__star ${
                  i <= Math.round(expert.avgRating) ? "expert-profile__star--filled" : ""
                }`}
              >
                ★
              </Text>
            ))}
          </View>
          <Text className="expert-profile__review-count">
            {expert.reviewCount} 条评价
          </Text>
        </View>
      </View>

      {/* Voice Introduction */}
      {expert.hasAudio && (
        <View className="expert-profile__section">
          <AudioPlayer
            src={`/api/experts/${expertId}/audio`}
            label={`${name}的语音介绍`}
          />
        </View>
      )}

      {/* AI Voice Chat */}
      {expert.hasClonedVoice && (
        <View className="expert-profile__section">
          <View
            className="expert-profile__voice-chat-btn"
            hoverClass="expert-profile__voice-chat-btn--hover"
            onClick={() => setShowVoiceChat(true)}
          >
            <Text className="expert-profile__voice-chat-icon">📞</Text>
            <View className="expert-profile__voice-chat-text">
              <Text className="expert-profile__voice-chat-title">
                与 AI {name} 语音聊天
              </Text>
              <Text className="expert-profile__voice-chat-desc">
                免费 5 分钟 · AI 专家语音克隆
              </Text>
            </View>
          </View>
        </View>
      )}

      {/* Voice Chat Modal */}
      <VoiceChat
        expertId={expertId}
        expertName={name}
        visible={showVoiceChat}
        onClose={() => setShowVoiceChat(false)}
      />

      {/* About */}
      <View className="expert-profile__section">
        <Text className="expert-profile__section-title">个人介绍</Text>
        <Text className="expert-profile__text">
          {expert.avatarScript || "暂未填写介绍"}
        </Text>
      </View>

      {/* Services */}
      {services.length > 0 && (
        <View className="expert-profile__section">
          <Text className="expert-profile__section-title">可提供服务</Text>
          {services.map((s, i) => (
            <View key={i} className="expert-profile__service-card">
              <Text className="expert-profile__service-title">{s.title}</Text>
              <Text className="expert-profile__service-desc">{s.description}</Text>
            </View>
          ))}
        </View>
      )}

      {/* Social Links */}
      {socialLinks.length > 0 && (
        <View className="expert-profile__section">
          <Text className="expert-profile__section-title">联系方式</Text>
          <View className="expert-profile__social-links">
            {socialLinks.map(({ key, label }) => {
              const url = String(expert[key]);
              const href = url.startsWith("http") ? url : `https://${url}`;
              return (
                <View
                  key={key}
                  className="expert-profile__social-btn"
                  hoverClass="expert-profile__social-btn--hover"
                  onClick={() => {
                    Taro.setClipboardData({
                      data: href,
                      success: () =>
                        Taro.showToast({ title: "链接已复制", icon: "success" }),
                    });
                  }}
                >
                  {label}
                </View>
              );
            })}
          </View>
        </View>
      )}

      {/* Document */}
      {expert.documentName && (
        <View className="expert-profile__section">
          <Text className="expert-profile__section-title">资料文档</Text>
          <View
            className="expert-profile__document"
            hoverClass="expert-profile__document--hover"
            onClick={() => {
              const docUrl = `${API_BASE}/api/experts/${expertId}/document`;
              const token = getToken();
              Taro.showLoading({ title: "下载中..." });
              Taro.downloadFile({
                url: docUrl,
                header: token ? { "x-wechat-token": token } : {},
                success: (res) => {
                  Taro.hideLoading();
                  if (!res.tempFilePath) {
                    Taro.showToast({
                      title: "下载失败（请配置 downloadFile 合法域名）",
                      icon: "none",
                      duration: 3200,
                    });
                    return;
                  }
                  Taro.openDocument({
                    filePath: res.tempFilePath,
                    fileType: "pdf",
                    showMenu: true,
                  });
                },
                fail: (err) => {
                  Taro.hideLoading();
                  console.error("[expert] document download", err);
                  Taro.showToast({
                    title: "下载失败，请检查网络与域名配置",
                    icon: "none",
                  });
                },
              });
            }}
          >
            <Text className="expert-profile__document-name">
              📄 {expert.documentName}
            </Text>
            <Text className="expert-profile__document-action">打开</Text>
          </View>
        </View>
      )}

      {/* Session Pricing */}
      {(expert.priceOnlineCents || expert.priceOfflineCents) && (
        <View className="expert-profile__section">
          <Text className="expert-profile__section-title">咨询价格</Text>
          <View className="expert-profile__prices">
            {expert.priceOnlineCents && expert.sessionType !== "OFFLINE" && (
              <View className="expert-profile__price-card">
                <Text className="expert-profile__price-label">🖥 线上</Text>
                <Text className="expert-profile__price-value">
                  {expert.currency} {Math.round(expert.priceOnlineCents / 100)}/小时
                </Text>
              </View>
            )}
            {expert.priceOfflineCents && expert.sessionType !== "ONLINE" && (
              <View className="expert-profile__price-card">
                <Text className="expert-profile__price-label">📍 线下</Text>
                <Text className="expert-profile__price-value">
                  {expert.currency} {Math.round(expert.priceOfflineCents / 100)}/小时
                </Text>
              </View>
            )}
          </View>
          <Text className="expert-profile__price-note">
            预约时支付 50% 订金，剩余费用在咨询结束 24 小时后扣款。
          </Text>
        </View>
      )}

      {/* Reviews */}
      <View className="expert-profile__section">
        <Text className="expert-profile__section-title">
          评价（{reviewsTotal}）
        </Text>
        {reviews.length === 0 ? (
          <Text className="expert-profile__text-muted">暂无评价</Text>
        ) : (
          <>
            {reviews.map((r) => (
              <View key={r.id} className="expert-profile__review">
                <View className="expert-profile__review-header">
                  <View className="expert-profile__review-avatar">
                    {(r.founder.nickName ?? r.founder.name ?? "访")
                      .charAt(0)
                      .toUpperCase()}
                  </View>
                  <View className="expert-profile__review-meta">
                    <Text className="expert-profile__review-name">
                      {r.founder.nickName ?? r.founder.name ?? "匿名用户"}
                    </Text>
                    <Text className="expert-profile__review-date">
                      {new Date(r.createdAt).toLocaleDateString("zh-CN")}
                    </Text>
                  </View>
                </View>
                <View className="expert-profile__review-stars">
                  {[1, 2, 3, 4, 5].map((i) => (
                    <Text
                      key={i}
                      className={`expert-profile__star ${
                        i <= r.rating ? "expert-profile__star--filled" : ""
                      }`}
                    >
                      ★
                    </Text>
                  ))}
                </View>
                {r.comment && (
                  <Text className="expert-profile__review-comment">
                    {r.comment}
                  </Text>
                )}
              </View>
            ))}
            {hasMoreReviews && (
              <View
                className="expert-profile__load-more"
                hoverClass="expert-profile__load-more--hover"
                onClick={() => fetchReviews(true)}
              >
                {reviewsLoading ? "加载中..." : "加载更多评价"}
              </View>
            )}
          </>
        )}
      </View>

      <View style={{ height: "16px" }} />

      {/* Bottom bar */}
      <View className="expert-profile__bottom-bar">
        {expert.sessionType !== "OFFLINE" && (
          <View
            className="expert-profile__book-btn expert-profile__book-btn--primary"
            hoverClass="expert-profile__book-btn--hover"
            onClick={() => goToBook("ONLINE")}
          >
            🖥 预约线上咨询
          </View>
        )}
        {expert.sessionType !== "ONLINE" && (
          <View
            className="expert-profile__book-btn expert-profile__book-btn--outline"
            hoverClass="expert-profile__book-btn--hover"
            onClick={() => goToBook("OFFLINE")}
          >
            📍 预约线下咨询
          </View>
        )}
      </View>
    </View>
  );
}
