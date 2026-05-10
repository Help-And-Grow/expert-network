import { View, Text, Image } from "@tarojs/components";
import Taro from "@tarojs/taro";
import { useState, useEffect } from "react";
import Icon from "../../components/Icon";
import { get } from "../../shared/api";
import { isLoggedIn } from "../../shared/auth";
import {
  BRAND_NAME,
  BRAND_LOGO,
  BRAND_SLOGAN,
  BRAND_PROVIDER,
  BRAND_MISSION,
} from "../../shared/brand";
import "./index.scss";

export default function IndexPage() {
  const [statusBarHeight] = useState(() => {
    const sysInfo = Taro.getSystemInfoSync();
    return sysInfo.statusBarHeight || 20;
  });
  const [onboardingDone, setOnboardingDone] = useState<boolean | null>(null);

  useEffect(() => {
    if (!isLoggedIn()) {
      setOnboardingDone(false);
      return;
    }
    get<{ expert?: { isPublished?: boolean } }>("/api/user")
      .then((res) => {
        if (res.statusCode === 200) {
          setOnboardingDone(!!res.data?.expert?.isPublished);
        } else {
          setOnboardingDone(false);
        }
      })
      .catch(() => setOnboardingDone(false));
  }, []);

  const goDiscover = () => {
    Taro.switchTab({ url: "/pages/discover/index" });
  };

  const goOnboarding = () => {
    Taro.navigateTo({ url: "/pages/onboarding/index" });
  };

  const goDashboard = () => {
    Taro.switchTab({ url: "/pages/dashboard/index" });
  };

  return (
    <View className="landing">
      <View style={{ height: `${statusBarHeight}px` }} />
      <View className="landing__hero">
        <View className="landing__logo-wrap">
          {BRAND_LOGO ? (
            <Image src={BRAND_LOGO} className="landing__logo-img" />
          ) : (
            <View className="landing__logo">H&G</View>
          )}
        </View>
        <Text className="landing__title">{BRAND_NAME}</Text>
        <Text className="landing__subtitle">{BRAND_SLOGAN}</Text>
        <Text className="landing__tagline">{BRAND_MISSION}</Text>
        <Text className="landing__desc">
          由{BRAND_PROVIDER}发起的非商业项目，面向中国与东南亚青年 —
          连接全球志愿导师，全部免费。
        </Text>
      </View>

      <View className="landing__actions">
        <View
          className="landing__btn landing__btn--primary"
          hoverClass="landing__btn--hover"
          onClick={goDiscover}
        >
          找一位导师
        </View>
        <View
          className="landing__btn landing__btn--outline"
          hoverClass="landing__btn--hover"
          onClick={onboardingDone ? goDashboard : goOnboarding}
        >
          {onboardingDone ? "我的学习见面" : "成为志愿导师"}
        </View>
      </View>

      <View className="landing__features">
        <View className="landing__feature" hoverClass="landing__feature--hover">
          <View className="landing__feature-icon-wrap landing__feature-icon-wrap--blue">
            <Icon name="zap" size={32} color="#4f46e5" />
          </View>
          <View className="landing__feature-text">
            <Text className="landing__feature-title">职业成长 · 动手实践</Text>
            <Text className="landing__feature-desc">
              与导师一对一交流真实的职业场景，把课堂知识变成解决问题的能力
            </Text>
          </View>
        </View>
        <View className="landing__feature" hoverClass="landing__feature--hover">
          <View className="landing__feature-icon-wrap landing__feature-icon-wrap--purple">
            <Icon name="sparkles" size={32} color="#7c3aed" />
          </View>
          <View className="landing__feature-text">
            <Text className="landing__feature-title">创新 · 启发未来</Text>
            <Text className="landing__feature-desc">
              带你完成第一个真实项目 —
              从产品想法到原型实现，志愿导师全程陪跑
            </Text>
          </View>
        </View>
        <View className="landing__feature" hoverClass="landing__feature--hover">
          <View className="landing__feature-icon-wrap landing__feature-icon-wrap--green">
            <Icon name="search" size={32} color="#059669" />
          </View>
          <View className="landing__feature-text">
            <Text className="landing__feature-title">免费 · 公益项目</Text>
            <Text className="landing__feature-desc">
              本项目由{BRAND_PROVIDER}资助，所有学习见面对青年学员完全免费
            </Text>
          </View>
        </View>
      </View>

      <View className="landing__about">
        <Text className="landing__about-title">关于我们</Text>
        <Text className="landing__about-text">
          {BRAND_PROVIDER} ·
          专注于通过导师网络与实战项目，帮助中国与东南亚青年面对未来职业挑战。
          本小程序为非商业平台，不收取任何费用，亦不提供商业服务。
        </Text>
      </View>

      <View className="landing__safe-bottom" />
    </View>
  );
}
