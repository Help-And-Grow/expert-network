import { View, Text, Image } from "@tarojs/components";
import Taro, {
  useDidShow,
  useLoad,
  useRouter,
  useShareAppMessage,
  useShareTimeline,
} from "@tarojs/taro";
import { useState, useCallback, useEffect, useRef } from "react";
import { get } from "../../shared/api";
import { getApiBase, getToken, isLoggedIn, wxLogin } from "../../shared/auth";
import VoiceChat from "../../components/VoiceChat";
import Icon from "../../components/Icon";
import { ENABLE_AI_VOICE, ENABLE_PAID_BOOKINGS } from "../../shared/brand";
import { countryFlagEmoji, getCountryOption } from "../../shared/countries";
import { normalizeRouteId } from "../../shared/route-params";
import type { ExpertDetail, Review, ReviewsResponse } from "../../shared/types";
import { prepareAudioForInnerAudio } from "../../shared/wechat-audio";
import "./index.scss";

function resolveExpertIdFromLaunch(loadOpts?: Record<string, unknown>): string {
  const fromOpts = normalizeRouteId(loadOpts?.id as string | string[] | undefined);
  if (fromOpts) return fromOpts;
  try {
    const p = Taro.getCurrentInstance()?.router?.params?.id;
    return normalizeRouteId(p as string | string[] | undefined);
  } catch {
    return "";
  }
}

export default function ExpertPage() {
  const router = useRouter();
  const [expertId, setExpertId] = useState(() =>
    normalizeRouteId(router.params?.id as string | string[] | undefined) ||
      resolveExpertIdFromLaunch(),
  );
  const [expert, setExpert] = useState<ExpertDetail | null>(null);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [reviewsTotal, setReviewsTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [reviewsLoading, setReviewsLoading] = useState(false);
  const [error, setError] = useState("");
  const [showVoiceChat, setShowVoiceChat] = useState(false);
  const [introPlaying, setIntroPlaying] = useState(false);
  const reviewsRef = useRef<Review[]>([]);
  const introAudioRef = useRef<Taro.InnerAudioContext | null>(null);
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
        setError("未找到该导师主页");
      } else {
        setError("加载导师主页失败");
      }
    } catch {
      setError("加载导师主页失败");
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

  useLoad((opts) => {
    const next = resolveExpertIdFromLaunch(opts as Record<string, unknown>);
    if (next) {
      setExpertId((prev) => (prev === next ? prev : next));
    }
    Taro.showShareMenu({ withShareTicket: true });
  });

  useDidShow(() => {
    const next = resolveExpertIdFromLaunch();
    if (next) {
      setExpertId((prev) => (prev === next ? prev : next));
    }
  });

  /** Load expert when route id is known; WeChat often omits useRouter().params on first paint. */
  useEffect(() => {
    if (!expertId) return;
    void fetchExpert().then(() => fetchReviews(false));
  }, [expertId, fetchExpert, fetchReviews]);

  /** If id is still missing after route hooks, stop loading and show an error. */
  useEffect(() => {
    if (expertId) return;
    const timer = setTimeout(() => {
      const late = resolveExpertIdFromLaunch();
      if (late) {
        setExpertId(late);
        return;
      }
      setLoading(false);
      setExpert(null);
      setError("无法打开主页：缺少导师信息。请返回「我的」下拉刷新后再试。");
    }, 200);
    return () => clearTimeout(timer);
  }, [expertId]);

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

  useEffect(() => {
    return () => {
      introAudioRef.current?.stop();
      introAudioRef.current?.destroy();
      introAudioRef.current = null;
    };
  }, []);

  const toggleIntroPlayback = useCallback(async () => {
    if (!expert?.hasAudio) return;

    if (introPlaying) {
      introAudioRef.current?.stop();
      setIntroPlaying(false);
      return;
    }

    try {
      const localPath = await prepareAudioForInnerAudio(
        `/api/experts/${expertId}/audio`,
        `expert-intro-${expertId}`,
      );

      introAudioRef.current?.stop();
      introAudioRef.current?.destroy();

      const ctx = Taro.createInnerAudioContext();
      ctx.obeyMuteSwitch = false;
      ctx.src = localPath;
      ctx.onEnded(() => setIntroPlaying(false));
      ctx.onStop(() => setIntroPlaying(false));
      ctx.onPause(() => setIntroPlaying(false));
      ctx.onError(() => {
        setIntroPlaying(false);
        Taro.showToast({ title: "语音播放失败", icon: "none" });
      });
      introAudioRef.current = ctx;
      ctx.play();
      setIntroPlaying(true);
    } catch {
      setIntroPlaying(false);
      Taro.showToast({ title: "语音加载失败", icon: "none" });
    }
  }, [expert?.hasAudio, expertId, introPlaying]);

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
          <Text className="expert-profile__error-text">{error || "未找到该导师主页"}</Text>
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
  const hasMoreReviews = reviews.length < reviewsTotal;
  const API_BASE = getApiBase();
  const experience = expert.experienceCapabilities;
  const voiceReplyLimit = experience?.voiceConsult.freeReplyLimit ?? 5;
  const hasOnlineBooking = expert.priceOnlineCents != null;
  const hasOfflineBooking = expert.priceOfflineCents != null;

  return (
    <View className="expert-profile">
      {/* Hero — centered avatar */}
      <View className="expert-profile__hero">
        <View className="expert-profile__avatar-wrap">
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
      </View>

      {/* Name, verified badge, domains, rating */}
      <View className="expert-profile__info">
        <Text className="expert-profile__name">{name}</Text>
        {expert.isVerified && (
          <View className="expert-profile__verified">
            <Icon name="verified" size={14} color="#059669" /> 已认证
          </View>
        )}
        {expert.countries && expert.countries.length > 0 && (
          <View className="expert-profile__countries">
            {expert.countries.map((code) => {
              const opt = getCountryOption(code);
              return (
                <View key={code} className="expert-profile__country-chip">
                  <Text className="expert-profile__country-flag">
                    {countryFlagEmoji(code)}
                  </Text>
                  <Text className="expert-profile__country-name">
                    {opt?.nameZh ?? code}
                  </Text>
                </View>
              );
            })}
          </View>
        )}
        {expert.servicesOffered && expert.servicesOffered.length > 0 ? (
          <View className="expert-profile__domains">
            {expert.servicesOffered.map((s) => (
              <Text key={s.title} className="expert-profile__domain-chip">{s.title}</Text>
            ))}
          </View>
        ) : expert.domains && expert.domains.length > 0 ? (
          <View className="expert-profile__domains">
            {expert.domains.map((d) => (
              <Text key={d} className="expert-profile__domain-chip">{d}</Text>
            ))}
          </View>
        ) : null}
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
            {expert.reviewCount} 条认可
          </Text>
        </View>
      </View>

      {/* Audio intro — standalone card */}
      {expert.hasAudio && (
        <View className="expert-profile__section">
          <View
            className="expert-profile__intro-card"
            hoverClass="expert-profile__intro-card--hover"
            onClick={toggleIntroPlayback}
          >
            <View className="expert-profile__intro-card-icon">
              <Icon name={introPlaying ? "pause" : "play"} size={20} color="#fff" />
            </View>
            <View className="expert-profile__intro-card-text">
              <Text className="expert-profile__intro-card-title">
                {introPlaying ? "正在播放" : "听导师介绍"}
              </Text>
              <Text className="expert-profile__intro-card-desc">
                点击{introPlaying ? "暂停" : "播放"}语音介绍
              </Text>
            </View>
          </View>
        </View>
      )}

      {expert.viewerIsOwner && (
        <View className="expert-profile__section">
          <View className="expert-profile__owner-note">
            <Text className="expert-profile__owner-note-title">这是你的公开主页</Text>
            <Text className="expert-profile__owner-note-text">
              为避免自己和自己匹配、语音聊天或预约，这些入口在这里会隐藏。
            </Text>
          </View>
        </View>
      )}

      {ENABLE_AI_VOICE && !expert.viewerIsOwner && (expert.hasVoiceChat ?? true) && (
        <View className="expert-profile__section">
          <Text className="expert-profile__section-title">AI 语音体验</Text>

          <View
            className="expert-profile__voice-chat-btn"
            hoverClass="expert-profile__voice-chat-btn--hover"
            onClick={async () => {
              if (!isLoggedIn()) {
                const { confirm } = await Taro.showModal({
                  title: "需要登录",
                  content: "语音提问需要先登录，是否现在登录？",
                  confirmText: "登录",
                  cancelText: "取消",
                });
                if (!confirm) return;
                try {
                  Taro.showLoading({ title: "登录中..." });
                  await wxLogin();
                  Taro.hideLoading();
                } catch {
                  Taro.hideLoading();
                  Taro.showToast({ title: "登录失败", icon: "none" });
                  return;
                }
              }
              setShowVoiceChat(true);
            }}
          >
            <View className="expert-profile__voice-chat-icon">
              <Icon name="microphone" size={28} color="#4f46e5" />
            </View>
            <View className="expert-profile__voice-chat-text">
              <Text className="expert-profile__voice-chat-title">
                语音提问
              </Text>
              <Text className="expert-profile__voice-chat-desc">
                免费预览 · 最多 {voiceReplyLimit} 次导师回复 · 每次回复不超过 60 秒
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

      {expert.documentName && (
        <View className="expert-profile__section">
          <Text className="expert-profile__section-title">服务介绍资料</Text>
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
            <Icon name="fileText" size={22} color="#64748b" />
            <Text className="expert-profile__document-name">
              {expert.documentName}
            </Text>
            <Text className="expert-profile__document-action">查看附件</Text>
          </View>
          <Text className="expert-profile__section-hint">
            点击查看服务介绍资料详情
          </Text>
        </View>
      )}

      {/* About */}
      <View className="expert-profile__section">
        <Text className="expert-profile__section-title">个人介绍</Text>
        <Text className="expert-profile__text">
          {expert.avatarScript || "暂未填写介绍"}
        </Text>
      </View>

      {/* Session methods. On the social-enterprise build (ENABLE_PAID_BOOKINGS=false)
          we show only the format (online / offline) with a "免费 · 公益项目" label;
          the underlying expert.priceOnline/Offline values are intentionally not
          rendered to keep the non-commercial framing clean. */}
      {(expert.priceOnlineCents != null || expert.priceOfflineCents != null) && (
        <View className="expert-profile__section">
          <Text className="expert-profile__section-title">
            {ENABLE_PAID_BOOKINGS ? "见面方式与价格" : "见面方式"}
          </Text>
          <View className="expert-profile__prices">
            {expert.priceOnlineCents != null && (
              <View className="expert-profile__price-card">
                <View className="expert-profile__price-icon">
                  <Icon name="monitor" size={20} color="#4f46e5" />
                </View>
                <Text className="expert-profile__price-label">线上见面</Text>
                <Text className="expert-profile__price-value">
                  {ENABLE_PAID_BOOKINGS
                    ? `$${(expert.priceOnlineCents / 100).toFixed(0)}`
                    : "免费"}
                </Text>
                <Text className="expert-profile__price-note">
                  {ENABLE_PAID_BOOKINGS ? "每次 30 分钟" : "公益项目 · 每次 30 分钟"}
                </Text>
              </View>
            )}
            {expert.priceOfflineCents != null && (
              <View className="expert-profile__price-card">
                <View className="expert-profile__price-icon">
                  <Icon name="mapPin" size={20} color="#059669" />
                </View>
                <Text className="expert-profile__price-label">线下见面</Text>
                <Text className="expert-profile__price-value">
                  {ENABLE_PAID_BOOKINGS
                    ? `$${(expert.priceOfflineCents / 100).toFixed(0)}`
                    : "免费"}
                </Text>
                <Text className="expert-profile__price-note">
                  {ENABLE_PAID_BOOKINGS ? "每次 30 分钟" : "公益项目 · 每次 30 分钟"}
                </Text>
              </View>
            )}
          </View>
        </View>
      )}

      {/* Appreciations */}
      <View className="expert-profile__section">
        <Text className="expert-profile__section-title">
          认可与感谢（{reviewsTotal}）
        </Text>
        {reviews.length === 0 ? (
          <Text className="expert-profile__text-muted">暂无分享反馈</Text>
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
                {reviewsLoading ? "加载中..." : "加载更多"}
              </View>
            )}
          </>
        )}
      </View>

      <View style={{ height: "100px" }} />

      {/* Fixed bottom CTA bar */}
      {!expert.viewerIsOwner && (hasOnlineBooking || hasOfflineBooking) && (
        <View className="expert-profile__bottom-bar">
          {hasOnlineBooking && hasOfflineBooking ? (
            <>
              <View
                className="expert-profile__book-btn expert-profile__book-btn--outline"
                hoverClass="expert-profile__book-btn--hover"
                onClick={() =>
                  Taro.navigateTo({ url: `/pages/book/index?id=${expertId}&type=OFFLINE` })
                }
              >
                线下预约
              </View>
              <View
                className="expert-profile__book-btn expert-profile__book-btn--primary"
                hoverClass="expert-profile__book-btn--hover"
                onClick={() =>
                  Taro.navigateTo({ url: `/pages/book/index?id=${expertId}&type=ONLINE` })
                }
              >
                线上预约（免费）
              </View>
            </>
          ) : (
            <View
              className="expert-profile__book-btn expert-profile__book-btn--primary"
              hoverClass="expert-profile__book-btn--hover"
              onClick={() => {
                const type = hasOnlineBooking ? "ONLINE" : "OFFLINE";
                Taro.navigateTo({ url: `/pages/book/index?id=${expertId}&type=${type}` });
              }}
            >
              {hasOnlineBooking ? "线上预约（免费）" : "线下预约（免费）"}
            </View>
          )}
        </View>
      )}
    </View>
  );
}
