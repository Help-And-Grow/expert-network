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
        <Text className="landing__title">帮助与成长</Text>
        <Text className="landing__subtitle">AI 原生专家网络</Text>
        <Text className="landing__desc">
          人人既是专家，也是学习者。预约真实咨询、分享专业经验，在互相帮助中持续成长。
        </Text>
      </View>

      <View className="landing__actions">
        <View
          className="landing__btn landing__btn--primary"
          hoverClass="landing__btn--hover"
          onClick={goDiscover}
        >
          去发现专家
        </View>
        <View
          className="landing__btn landing__btn--outline"
          hoverClass="landing__btn--hover"
          onClick={goOnboarding}
        >
          成为专家
        </View>
      </View>

      <View className="landing__features">
        <View className="landing__feature" hoverClass="landing__feature--hover">
          <View className="landing__feature-icon-wrap landing__feature-icon-wrap--blue">
            <Text className="landing__feature-icon">🚀</Text>
          </View>
          <View className="landing__feature-text">
            <Text className="landing__feature-title">学习与求助</Text>
            <Text className="landing__feature-desc">
              一键预约实战专家，覆盖增长、招聘、法务与融资等关键问题
            </Text>
          </View>
        </View>
        <View className="landing__feature" hoverClass="landing__feature--hover">
          <View className="landing__feature-icon-wrap landing__feature-icon-wrap--purple">
            <Text className="landing__feature-icon">💡</Text>
          </View>
          <View className="landing__feature-text">
            <Text className="landing__feature-title">分享专业能力</Text>
            <Text className="landing__feature-desc">
              把你的经验变成服务，同时也能向其他专家学习成长
            </Text>
          </View>
        </View>
        <View className="landing__feature" hoverClass="landing__feature--hover">
          <View className="landing__feature-icon-wrap landing__feature-icon-wrap--green">
            <Text className="landing__feature-icon">📊</Text>
          </View>
          <View className="landing__feature-text">
            <Text className="landing__feature-title">AI 原生匹配</Text>
            <Text className="landing__feature-desc">
              用自然语言描述需求，智能匹配最合适的专家，走向常在线数字专家
            </Text>
          </View>
        </View>
      </View>

      <View className="landing__safe-bottom" />
    </View>
  );
}
