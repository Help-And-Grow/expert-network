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
      const name = user?.nickName || user?.name || "成员";
      return {
        title: `${name} 在 Help & Grow`,
        path: `/pages/expert/index?id=${expert.id}`,
      };
    }
    return {
      title: "Help & Grow · 专家网络",
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

  const displayName = user && (user.nickName || user.name) ? (user.nickName || user.name) : "用户";

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
            {(displayName || "用").charAt(0).toUpperCase()}
          </View>
        )}
        <Text className="profile__name">{displayName}</Text>
        {user && user.email && (
          <Text className="profile__email">{user.email}</Text>
        )}
        {isExpert && (
          <View className="profile__role-badge">社区成员</View>
        )}
      </View>

      {isExpert && expert && (
        <View className="profile__stats">
          <View className="profile__stat">
            <Text className="profile__stat-value">{expert.avgRating.toFixed(1)}</Text>
            <Text className="profile__stat-label">评分</Text>
          </View>
          <View className="profile__stat profile__stat--border">
            <Text className="profile__stat-value">{expert.reviewCount}</Text>
            <Text className="profile__stat-label">评价</Text>
          </View>
          <View className="profile__stat">
            <Text className="profile__stat-value">{expert.domains.length}</Text>
            <Text className="profile__stat-label">领域</Text>
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
                <Text className="profile__menu-label">我的公开主页</Text>
                <Text className="profile__menu-hint">查看他人看到的展示效果</Text>
              </View>
              <Text className="profile__menu-arrow">›</Text>
            </View>
            <View
              className="profile__menu-item"
              hoverClass="profile__menu-item--hover"
              onClick={() => {
                Taro.showToast({ title: "功能即将上线", icon: "none" });
              }}
            >
              <View className="profile__menu-icon-wrap profile__menu-icon-wrap--purple">
                <Text className="profile__menu-icon">✏️</Text>
              </View>
              <View className="profile__menu-content">
                <Text className="profile__menu-label">编辑主页</Text>
                <Text className="profile__menu-hint">更新介绍、价格与外部链接</Text>
              </View>
              <Text className="profile__menu-arrow">›</Text>
            </View>
            <View
              className="profile__menu-item"
              hoverClass="profile__menu-item--hover"
              onClick={() => {
                Taro.showToast({ title: "功能即将上线", icon: "none" });
              }}
            >
              <View className="profile__menu-icon-wrap profile__menu-icon-wrap--green">
                <Text className="profile__menu-icon">📅</Text>
              </View>
              <View className="profile__menu-content">
                <Text className="profile__menu-label">管理可预约时间</Text>
                <Text className="profile__menu-hint">设置可开放的咨询时段</Text>
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
              <Text className="profile__menu-label">成为专家</Text>
              <Text className="profile__menu-hint">创建主页并开始分享你的经验</Text>
            </View>
            <Text className="profile__menu-arrow">›</Text>
          </View>
        )}

        <View
          className="profile__menu-item"
          hoverClass="profile__menu-item--hover"
          onClick={() => {
            Taro.showShareMenu({ withShareTicket: true });
            Taro.showToast({ title: "请使用右上角分享", icon: "none" });
          }}
        >
          <View className="profile__menu-icon-wrap profile__menu-icon-wrap--teal">
            <Text className="profile__menu-icon">📤</Text>
          </View>
          <View className="profile__menu-content">
            <Text className="profile__menu-label">分享给朋友</Text>
            <Text className="profile__menu-hint">邀请朋友加入专家社区</Text>
          </View>
          <Text className="profile__menu-arrow">›</Text>
        </View>

        <View
          className="profile__menu-item"
          hoverClass="profile__menu-item--hover"
          onClick={() => {
            Taro.showModal({
              title: "关于 Help & Grow",
              content: "Help & Grow 是一个面向真实服务与长期关系的专家网络：人人既是专家，也是学习者。你可以提供咨询服务，也可以预约他人，在实战中学习，在帮助中成长。",
              showCancel: false,
              confirmText: "我知道了",
            });
          }}
        >
          <View className="profile__menu-icon-wrap profile__menu-icon-wrap--gray">
            <Text className="profile__menu-icon">ℹ️</Text>
          </View>
          <View className="profile__menu-content">
            <Text className="profile__menu-label">关于我们</Text>
            <Text className="profile__menu-hint">了解 Help & Grow 品牌与理念</Text>
          </View>
          <Text className="profile__menu-arrow">›</Text>
        </View>
      </View>

      <View className="profile__footer">
        <Text className="profile__footer-text">Help & Grow · 专家网络</Text>
      </View>
    </View>
  );
}
