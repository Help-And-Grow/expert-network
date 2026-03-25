import { View, Text } from "@tarojs/components";
import Taro from "@tarojs/taro";
import { useState } from "react";
import "./index.scss";

export default function IndexPage() {
  const [statusBarHeight] = useState(() => {
    const sysInfo = Taro.getSystemInfoSync();
    return sysInfo.statusBarHeight || 20;
  });

  const goDiscover = () => {
    Taro.switchTab({ url: "/pages/discover/index" });
  };

  const goOnboarding = () => {
    Taro.navigateTo({ url: "/pages/onboarding/index" });
  };

  return (
    <View className="landing">
      <View style={{ height: `${statusBarHeight}px` }} />
      <View className="landing__hero">
        <View className="landing__logo-wrap">
          <View className="landing__logo">H&G</View>
        </View>
        <Text className="landing__title">Help & Grow</Text>
        <Text className="landing__subtitle">AI Native Expert Network</Text>
        <Text className="landing__desc">
          Everyone is both expert and learner—book sessions, share what you know, and grow
          together. Rooted in Singapore & Southeast Asia.
        </Text>
      </View>

      <View className="landing__actions">
        <View
          className="landing__btn landing__btn--primary"
          hoverClass="landing__btn--hover"
          onClick={goDiscover}
        >
          Explore & Learn
        </View>
        <View
          className="landing__btn landing__btn--outline"
          hoverClass="landing__btn--hover"
          onClick={goOnboarding}
        >
          Join the Community
        </View>
      </View>

      <View className="landing__features">
        <View className="landing__feature" hoverClass="landing__feature--hover">
          <View className="landing__feature-icon-wrap landing__feature-icon-wrap--blue">
            <Text className="landing__feature-icon">🚀</Text>
          </View>
          <View className="landing__feature-text">
            <Text className="landing__feature-title">Learn & get help</Text>
            <Text className="landing__feature-desc">
              Book people who’ve done it—localisation, BD, talent, fundraising in SEA
            </Text>
          </View>
        </View>
        <View className="landing__feature" hoverClass="landing__feature--hover">
          <View className="landing__feature-icon-wrap landing__feature-icon-wrap--purple">
            <Text className="landing__feature-icon">💡</Text>
          </View>
          <View className="landing__feature-text">
            <Text className="landing__feature-title">Share expertise</Text>
            <Text className="landing__feature-desc">
              Offer what you know as a service; learn from the community too
            </Text>
          </View>
        </View>
        <View className="landing__feature" hoverClass="landing__feature--hover">
          <View className="landing__feature-icon-wrap landing__feature-icon-wrap--green">
            <Text className="landing__feature-icon">📊</Text>
          </View>
          <View className="landing__feature-text">
            <Text className="landing__feature-title">AI-native network</Text>
            <Text className="landing__feature-desc">
              Natural-language matching; building toward always-on digital experts beside you
            </Text>
          </View>
        </View>
      </View>

      <View className="landing__safe-bottom" />
    </View>
  );
}
