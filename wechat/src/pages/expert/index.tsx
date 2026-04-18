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
import { getApiBase, getToken } from "../../shared/auth";
import VoiceChat from "../../components/VoiceChat";
import { normalizeRouteId } from "../../shared/route-params";
import type { ExpertDetail, Review, ReviewsResponse } from "../../shared/types";
import { prepareAudioForInnerAudio } from "../../shared/wechat-audio";
import { buildWebProfileLoginUrl } from "../../shared/web-booking";
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
      setError("无法打开主页：缺少专家信息。请返回「我的」下拉刷新后再试。");
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
  const hasMoreReviews = reviews.length < reviewsTotal;
  const API_BASE = getApiBase();
  const experience = expert.experienceCapabilities;
  const voiceReplyLimit = experience?.voiceConsult.freeReplyLimit ?? 5;
  const realtimeDurationSeconds = experience?.realtimeVoice.durationSeconds ?? 180;
  const realtimeMinutes = Math.max(1, Math.round(realtimeDurationSeconds / 60));
  const loginFirstProfileUrl =
    experience?.web.loginFirstProfileUrl ?? buildWebProfileLoginUrl(expertId);

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

  return (
    <View className="expert-profile">
      {/* Compact Hero */}
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
          {expert.hasAudio && (
            <View
              className="expert-profile__intro-btn"
              hoverClass="expert-profile__intro-btn--hover"
              onClick={toggleIntroPlayback}
            >
              <Text className="expert-profile__intro-btn-icon">{introPlaying ? "⏸" : "▶"}</Text>
              <Text className="expert-profile__intro-btn-text">
                {introPlaying ? "暂停介绍" : "听介绍"}
              </Text>
            </View>
          )}
        </View>
      </View>

      {/* Name & Info */}
      <View className="expert-profile__info">
        <Text className="expert-profile__name">{name}</Text>
        {expert.isVerified && (
          <View className="expert-profile__verified">✓ 已认证</View>
        )}
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

      {!expert.viewerIsOwner && (expert.hasVoiceChat ?? true) && (
        <View className="expert-profile__section">
          <Text className="expert-profile__section-title">与 {name} 对话</Text>
          <Text className="expert-profile__section-sub">
            先用语音讲清你的处境与问题。每次确认后，你会收到一段简洁、聚焦、带判断的专家回复。
          </Text>
          <View
            className="expert-profile__voice-chat-btn"
            hoverClass="expert-profile__voice-chat-btn--hover"
            onClick={() => setShowVoiceChat(true)}
          >
            <Text className="expert-profile__voice-chat-icon">🎙</Text>
            <View className="expert-profile__voice-chat-text">
              <Text className="expert-profile__voice-chat-title">
                开始语音提问
              </Text>
              <Text className="expert-profile__voice-chat-desc">
                免费预览 · 最多 {voiceReplyLimit} 次专家回复 · 每次回复不超过 60 秒
              </Text>
            </View>
          </View>

          <View className="expert-profile__realtime-card expert-profile__realtime-card--disabled">
            <Text className="expert-profile__realtime-badge">订阅功能</Text>
            <Text className="expert-profile__realtime-title">实时 AI 对话</Text>
            <Text className="expert-profile__realtime-desc">
              订阅后可开启，每次最多 {realtimeMinutes} 分钟。当前 demo 仅展示入口，不开放体验。
            </Text>
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
        <View className="expert-profile__section expert-profile__section--highlight">
          <Text className="expert-profile__section-title">服务介绍资料</Text>
          <Text className="expert-profile__section-sub">
            了解专家更详细的介绍、服务内容与工作方式，请先查看附件。若你希望继续深入了解或安排见面，请复制网页主页链接，在浏览器登录后继续。
          </Text>
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
            <Text className="expert-profile__document-action">查看附件</Text>
          </View>

          <View
            className="expert-profile__web-book-btn"
            hoverClass="expert-profile__web-book-btn--hover"
            onClick={() => {
              Taro.setClipboardData({
                data: loginFirstProfileUrl,
                success: () =>
                  Taro.showToast({ title: "网页主页链接已复制", icon: "success" }),
              });
            }}
          >
            复制网页主页链接
          </View>
          <Text className="expert-profile__section-hint">
            复制后请在浏览器打开，先登录，再回到当前专家主页继续浏览并安排见面。
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

      <View style={{ height: "48px" }} />
    </View>
  );
}
