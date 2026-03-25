import { View, Text, Image } from "@tarojs/components";
import Taro, { useLoad, useRouter, useShareAppMessage, useShareTimeline } from "@tarojs/taro";
import { useState, useCallback, useRef } from "react";
import { get } from "../../shared/api";
import { getApiBase } from "../../shared/auth";
import AudioPlayer from "../../components/AudioPlayer";
import type {
  ExpertDetail,
  ServiceItem,
  Review,
  ReviewsResponse,
} from "../../shared/types";
import "./index.scss";

const socialConfig = [
  { key: "linkedIn" as const, label: "LinkedIn" },
  { key: "website" as const, label: "Website" },
  { key: "twitter" as const, label: "X" },
  { key: "substack" as const, label: "Substack" },
  { key: "instagram" as const, label: "Instagram" },
  { key: "xiaohongshu" as const, label: "XiaoHongShu" },
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
        setError("Profile not found");
      } else {
        setError("Failed to load profile");
      }
    } catch {
      setError("Failed to load profile");
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
    const name = expert?.user.nickName ?? expert?.user.name ?? "Expert";
    return {
      title: `${name} on Help & Grow`,
      path: `/pages/expert/index?id=${expertId}`,
    };
  });

  useShareTimeline(() => {
    const name = expert?.user.nickName ?? expert?.user.name ?? "Expert";
    return {
      title: `${name} on Help & Grow`,
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
          <Text className="expert-profile__error-text">{error || "Profile not found"}</Text>
          <View
            className="expert-profile__error-btn"
            hoverClass="expert-profile__error-btn--hover"
            onClick={() => Taro.navigateBack()}
          >
            Go Back
          </View>
        </View>
      </View>
    );
  }

  const name = expert.user.nickName || expert.user.name || "Member";
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
          <View className="expert-profile__verified">✓ Verified</View>
        )}
        <View className="expert-profile__domains">
          {expert.domains.map((d) => (
            <View key={d} className="expert-profile__domain-chip">{d}</View>
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
            {expert.reviewCount} review{expert.reviewCount !== 1 ? "s" : ""}
          </Text>
        </View>
      </View>

      {/* Voice Introduction */}
      {expert.hasAudio && (
        <View className="expert-profile__section">
          <AudioPlayer
            src={`/api/experts/${expertId}/audio`}
            label={`${name}'s voice introduction`}
          />
        </View>
      )}

      {/* About */}
      <View className="expert-profile__section">
        <Text className="expert-profile__section-title">About</Text>
        <Text className="expert-profile__text">
          {expert.avatarScript || "No introduction available."}
        </Text>
      </View>

      {/* Services */}
      {services.length > 0 && (
        <View className="expert-profile__section">
          <Text className="expert-profile__section-title">Services Offered</Text>
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
          <Text className="expert-profile__section-title">Connect</Text>
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
                        Taro.showToast({ title: "Link copied", icon: "success" }),
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
          <Text className="expert-profile__section-title">Document</Text>
          <View
            className="expert-profile__document"
            hoverClass="expert-profile__document--hover"
            onClick={() => {
              Taro.showLoading({ title: "Downloading..." });
              Taro.downloadFile({
                url: `${API_BASE}/api/experts/${expertId}/document`,
                success: (res) => {
                  Taro.hideLoading();
                  if (res.statusCode === 200) {
                    Taro.openDocument({ filePath: res.tempFilePath });
                  } else {
                    Taro.showToast({ title: "Download failed", icon: "none" });
                  }
                },
                fail: () => {
                  Taro.hideLoading();
                  Taro.showToast({ title: "Download failed", icon: "none" });
                },
              });
            }}
          >
            <Text className="expert-profile__document-name">
              📄 {expert.documentName}
            </Text>
            <Text className="expert-profile__document-action">Open</Text>
          </View>
        </View>
      )}

      {/* Session Pricing */}
      {(expert.priceOnlineCents || expert.priceOfflineCents) && (
        <View className="expert-profile__section">
          <Text className="expert-profile__section-title">Session Rates</Text>
          <View className="expert-profile__prices">
            {expert.priceOnlineCents && expert.sessionType !== "OFFLINE" && (
              <View className="expert-profile__price-card">
                <Text className="expert-profile__price-label">🖥 Online</Text>
                <Text className="expert-profile__price-value">
                  {expert.currency} {Math.round(expert.priceOnlineCents / 100)}/hr
                </Text>
              </View>
            )}
            {expert.priceOfflineCents && expert.sessionType !== "ONLINE" && (
              <View className="expert-profile__price-card">
                <Text className="expert-profile__price-label">📍 Offline</Text>
                <Text className="expert-profile__price-value">
                  {expert.currency} {Math.round(expert.priceOfflineCents / 100)}/hr
                </Text>
              </View>
            )}
          </View>
          <Text className="expert-profile__price-note">
            50% deposit due at booking. Remainder charged 24h after the session.
          </Text>
        </View>
      )}

      {/* Reviews */}
      <View className="expert-profile__section">
        <Text className="expert-profile__section-title">
          Reviews ({reviewsTotal})
        </Text>
        {reviews.length === 0 ? (
          <Text className="expert-profile__text-muted">No reviews yet</Text>
        ) : (
          <>
            {reviews.map((r) => (
              <View key={r.id} className="expert-profile__review">
                <View className="expert-profile__review-header">
                  <View className="expert-profile__review-avatar">
                    {(r.founder.nickName ?? r.founder.name ?? "F")
                      .charAt(0)
                      .toUpperCase()}
                  </View>
                  <View className="expert-profile__review-meta">
                    <Text className="expert-profile__review-name">
                      {r.founder.nickName ?? r.founder.name ?? "Anonymous"}
                    </Text>
                    <Text className="expert-profile__review-date">
                      {new Date(r.createdAt).toLocaleDateString()}
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
                {reviewsLoading ? "Loading..." : "Load more reviews"}
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
            🖥 Book Online
          </View>
        )}
        {expert.sessionType !== "ONLINE" && (
          <View
            className="expert-profile__book-btn expert-profile__book-btn--outline"
            hoverClass="expert-profile__book-btn--hover"
            onClick={() => goToBook("OFFLINE")}
          >
            📍 Book Offline
          </View>
        )}
      </View>
    </View>
  );
}
