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
        <Text className="landing__subtitle">Expert Network</Text>
        <Text className="landing__desc">
          在这里，专业经验以更高效的方式被看见、被连接、被兑现。你既能向合适的人求助与交流，也能把自己的经验分享出去并沉淀为长期服务。
        </Text>
      </View>

      <View className="landing__actions">
        <View
          className="landing__btn landing__btn--primary"
          hoverClass="landing__btn--hover"
          onClick={goDiscover}
        >
          发现专家
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
            <Text className="landing__feature-title">动手与互助</Text>
            <Text className="landing__feature-desc">
              快速找到真正懂业务的人，先了解，再决定是否安排正式见面
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
              把经验沉淀成可持续的专业服务，与高质量用户建立长期信任
            </Text>
          </View>
        </View>
        <View className="landing__feature" hoverClass="landing__feature--hover">
          <View className="landing__feature-icon-wrap landing__feature-icon-wrap--green">
            <Text className="landing__feature-icon">📊</Text>
          </View>
          <View className="landing__feature-text">
            <Text className="landing__feature-title">更懂业务场景的匹配</Text>
            <Text className="landing__feature-desc">
              以语音与内容沉淀构建数字分身，让服务体验更稳定、更个性化
            </Text>
          </View>
        </View>
      </View>

      <View className="landing__safe-bottom" />
    </View>
  );
}
