import { View, Text, Image } from "@tarojs/components";
import Taro, { useLoad, useDidShow, useShareAppMessage } from "@tarojs/taro";
import { useState, useCallback } from "react";
import { get } from "../../shared/api";
import { getApiBase, getUser } from "../../shared/auth";
import Icon from "../../components/Icon";
import type { ExpertDetail, AuthUser, ServiceItem } from "../../shared/types";
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
      const name = user?.nickName || user?.name || "导师";
      return {
        title: `${name} · Help & Grow 青年AI 志愿导师`,
        path: `/pages/expert/index?id=${expert.id}`,
      };
    }
    return {
      title: "Help & Grow 青年AI · 免费的青年导师计划",
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
            <Text className="profile__stat-label">认可</Text>
          </View>
          <View className="profile__stat">
            <Text className="profile__stat-value">{expert.servicesOffered?.length ?? expert.domains.length}</Text>
            <Text className="profile__stat-label">服务</Text>
          </View>
        </View>
      )}

      <View className="profile__menu">
        {isExpert && (
          <>
            <View
              className="profile__menu-item"
              hoverClass="profile__menu-item--hover"
              onClick={() => {
                const id = expert?.id;
                if (!id) {
                  Taro.showToast({
                    title: "无法打开，请下拉刷新后再试",
                    icon: "none",
                  });
                  return;
                }
                Taro.navigateTo({
                  url: `/pages/expert/index?id=${encodeURIComponent(id)}`,
                });
              }}
            >
              <View className="profile__menu-icon-wrap profile__menu-icon-wrap--blue">
                <Icon name="user" size={28} color="#4f46e5" />
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
                <Icon name="edit" size={28} color="#7c3aed" />
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
                <Icon name="calendar" size={28} color="#059669" />
              </View>
              <View className="profile__menu-content">
                <Text className="profile__menu-label">管理可安排见面的时间</Text>
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
              <Icon name="star" size={28} color="#d97706" />
            </View>
            <View className="profile__menu-content">
              <Text className="profile__menu-label">成为志愿导师</Text>
              <Text className="profile__menu-hint">为青年学员分享你的 AI 经验，全部公益</Text>
            </View>
            <Text className="profile__menu-arrow">›</Text>
          </View>
        )}

        {/*
          我的会员 entry hidden until WeChat Pay merchant credentials are
          available — pending Chinese company registration. The page,
          subscribe/status endpoints, and webhook routing remain in the
          codebase; restore this menu item to re-enable.
        */}

        <View
          className="profile__menu-item"
          hoverClass="profile__menu-item--hover"
          onClick={() => {
            Taro.showShareMenu({ withShareTicket: true });
            Taro.showToast({ title: "请使用右上角分享", icon: "none" });
          }}
        >
          <View className="profile__menu-icon-wrap profile__menu-icon-wrap--teal">
            <Icon name="share" size={28} color="#0d9488" />
          </View>
          <View className="profile__menu-content">
            <Text className="profile__menu-label">分享给朋友</Text>
            <Text className="profile__menu-hint">邀请朋友加入这个公益学习社区</Text>
          </View>
          <Text className="profile__menu-arrow">›</Text>
        </View>

        <View
          className="profile__menu-item"
          hoverClass="profile__menu-item--hover"
          onClick={() => {
            Taro.showModal({
              title: "关于 Help & Grow 青年AI",
              content:
                "Help & Grow 青年AI 是新加坡社会企业 Help & Grow 发起的公益项目，面向中国与东南亚青年，连接全球志愿导师，帮助大家学AI、用AI、在真实场景中创新。\n\n本小程序对青年学员完全免费，不提供任何商业服务。",
              showCancel: false,
              confirmText: "我知道了",
            });
          }}
        >
          <View className="profile__menu-icon-wrap profile__menu-icon-wrap--gray">
            <Icon name="info" size={28} color="#64748b" />
          </View>
          <View className="profile__menu-content">
            <Text className="profile__menu-label">关于我们</Text>
            <Text className="profile__menu-hint">新加坡社会企业 Help & Grow · 公益项目</Text>
          </View>
          <Text className="profile__menu-arrow">›</Text>
        </View>
      </View>

      <View className="profile__footer">
        <Text className="profile__footer-text">
          Help & Grow 青年AI · 新加坡社会企业公益项目 · 完全免费
        </Text>
      </View>
    </View>
  );
}
