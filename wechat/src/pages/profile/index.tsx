import { View, Text, Image } from "@tarojs/components";
import Taro, { useLoad, useDidShow, useShareAppMessage } from "@tarojs/taro";
import { useState, useCallback } from "react";
import { get } from "../../shared/api";
import { getApiBase, getUser } from "../../shared/auth";
import type { ExpertDetail, AuthUser } from "../../shared/types";
import "./index.scss";

export default function ProfilePage() {
  const [user, setUser] = useState<AuthUser | null>(getUser());
  const [expert, setExpert] = useState<ExpertDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [isExpert, setIsExpert] = useState(false);

  const fetchProfile = useCallback(async () => {
    setLoading(true);
    try {
      const res = await get<{ expert: ExpertDetail | null; user: AuthUser }>(
        "/api/profile"
      );
      if (res.statusCode === 200) {
        setUser(res.data.user);
        if (res.data.expert) {
          setExpert(res.data.expert);
          setIsExpert(true);
        }
      }
    } catch {
      // Profile fetch failed
    } finally {
      setLoading(false);
    }
  }, []);

  useLoad(() => {
    fetchProfile();
  });

  useDidShow(() => {
    fetchProfile();
  });

  useShareAppMessage(() => {
    if (isExpert && expert) {
      const name = user?.nickName || user?.name || "Member";
      return {
        title: `${name} on Help & Grow`,
        path: `/pages/expert/index?id=${expert.id}`,
      };
    }
    return {
      title: "Help & Grow — AI Native Expert Network",
      path: "/pages/index/index",
    };
  });

  const API_BASE = getApiBase();

  if (loading) {
    return (
      <View className="profile">
        <View className="profile__skeleton">
          <View className="profile__skeleton-avatar" />
          <View className="profile__skeleton-line" />
          <View className="profile__skeleton-line profile__skeleton-line--short" />
        </View>
      </View>
    );
  }

  const displayName = user && (user.nickName || user.name) ? (user.nickName || user.name) : "User";

  return (
    <View className="profile">
      <View className="profile__header">
        {expert && expert.hasAvatar ? (
          <Image
            className="profile__avatar"
            src={`${API_BASE}/api/experts/${expert.id}/avatar`}
            mode="aspectFill"
          />
        ) : (
          <View className="profile__avatar-placeholder">
            {(displayName || "U").charAt(0).toUpperCase()}
          </View>
        )}
        <Text className="profile__name">{displayName}</Text>
        {user && user.email && (
          <Text className="profile__email">{user.email}</Text>
        )}
        {isExpert && (
          <View className="profile__role-badge">Community Member</View>
        )}
      </View>

      {isExpert && expert && (
        <View className="profile__stats">
          <View className="profile__stat">
            <Text className="profile__stat-value">{expert.avgRating.toFixed(1)}</Text>
            <Text className="profile__stat-label">Rating</Text>
          </View>
          <View className="profile__stat profile__stat--border">
            <Text className="profile__stat-value">{expert.reviewCount}</Text>
            <Text className="profile__stat-label">Reviews</Text>
          </View>
          <View className="profile__stat">
            <Text className="profile__stat-value">{expert.domains.length}</Text>
            <Text className="profile__stat-label">Domains</Text>
          </View>
        </View>
      )}

      <View className="profile__menu">
        {isExpert && (
          <>
            <View
              className="profile__menu-item"
              hoverClass="profile__menu-item--hover"
              onClick={() =>
                Taro.navigateTo({
                  url: `/pages/expert/index?id=${expert && expert.id}`,
                })
              }
            >
              <View className="profile__menu-icon-wrap profile__menu-icon-wrap--blue">
                <Text className="profile__menu-icon">👤</Text>
              </View>
              <View className="profile__menu-content">
                <Text className="profile__menu-label">My Public Profile</Text>
                <Text className="profile__menu-hint">View how others see you</Text>
              </View>
              <Text className="profile__menu-arrow">›</Text>
            </View>
            <View
              className="profile__menu-item"
              hoverClass="profile__menu-item--hover"
              onClick={() => {
                Taro.showToast({ title: "Coming soon", icon: "none" });
              }}
            >
              <View className="profile__menu-icon-wrap profile__menu-icon-wrap--purple">
                <Text className="profile__menu-icon">✏️</Text>
              </View>
              <View className="profile__menu-content">
                <Text className="profile__menu-label">Edit Profile</Text>
                <Text className="profile__menu-hint">Update bio, pricing & links</Text>
              </View>
              <Text className="profile__menu-arrow">›</Text>
            </View>
            <View
              className="profile__menu-item"
              hoverClass="profile__menu-item--hover"
              onClick={() => {
                Taro.showToast({ title: "Coming soon", icon: "none" });
              }}
            >
              <View className="profile__menu-icon-wrap profile__menu-icon-wrap--green">
                <Text className="profile__menu-icon">📅</Text>
              </View>
              <View className="profile__menu-content">
                <Text className="profile__menu-label">Manage Availability</Text>
                <Text className="profile__menu-hint">Set your available time slots</Text>
              </View>
              <Text className="profile__menu-arrow">›</Text>
            </View>
          </>
        )}

        {!isExpert && (
          <View
            className="profile__menu-item"
            hoverClass="profile__menu-item--hover"
            onClick={() =>
              Taro.navigateTo({ url: "/pages/onboarding/index" })
            }
          >
            <View className="profile__menu-icon-wrap profile__menu-icon-wrap--amber">
              <Text className="profile__menu-icon">🌟</Text>
            </View>
            <View className="profile__menu-content">
              <Text className="profile__menu-label">Join the Community</Text>
              <Text className="profile__menu-hint">Create your profile & start sharing</Text>
            </View>
            <Text className="profile__menu-arrow">›</Text>
          </View>
        )}

        <View
          className="profile__menu-item"
          hoverClass="profile__menu-item--hover"
          onClick={() => {
            Taro.showShareMenu({ withShareTicket: true });
            Taro.showToast({ title: "Use share button ↗", icon: "none" });
          }}
        >
          <View className="profile__menu-icon-wrap profile__menu-icon-wrap--teal">
            <Text className="profile__menu-icon">📤</Text>
          </View>
          <View className="profile__menu-content">
            <Text className="profile__menu-label">Share Help & Grow</Text>
            <Text className="profile__menu-hint">Invite friends to the community</Text>
          </View>
          <Text className="profile__menu-arrow">›</Text>
        </View>

        <View
          className="profile__menu-item"
          hoverClass="profile__menu-item--hover"
          onClick={() => {
            Taro.showModal({
              title: "About Help & Grow",
              content: "Help & Grow is the AI Native Expert Network: everyone is both expert and learner—offer sessions, book help, learn by doing and grow by helping. Strong roots in Singapore & Southeast Asia.",
              showCancel: false,
              confirmText: "OK",
            });
          }}
        >
          <View className="profile__menu-icon-wrap profile__menu-icon-wrap--gray">
            <Text className="profile__menu-icon">ℹ️</Text>
          </View>
          <View className="profile__menu-content">
            <Text className="profile__menu-label">About</Text>
            <Text className="profile__menu-hint">Learn more about Help & Grow</Text>
          </View>
          <Text className="profile__menu-arrow">›</Text>
        </View>
      </View>

      <View className="profile__footer">
        <Text className="profile__footer-text">Help & Grow · AI Native Expert Network</Text>
      </View>
    </View>
  );
}
