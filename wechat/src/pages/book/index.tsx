import { View, Text } from "@tarojs/components";
import Taro, { useLoad, useRouter } from "@tarojs/taro";
import { useState, useCallback } from "react";
import { get } from "../../shared/api";
import { buildWebBookUrl } from "../../shared/web-booking";
import type { ExpertDetail } from "../../shared/types";
import "./index.scss";

export default function BookWebPage() {
  const router = useRouter();
  const expertId = router.params.id || "";
  const sessionType = router.params.type || "ONLINE";
  const [expert, setExpert] = useState<ExpertDetail | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchExpert = useCallback(async () => {
    if (!expertId) return;
    setLoading(true);
    try {
      const res = await get<ExpertDetail>(`/api/experts/${expertId}`);
      if (res.statusCode === 200) {
        setExpert(res.data);
      }
    } catch {
      setExpert(null);
    } finally {
      setLoading(false);
    }
  }, [expertId]);

  useLoad(() => {
    fetchExpert();
  });

  const bookUrl = expertId ? buildWebBookUrl(expertId, sessionType) : "";

  const copyLink = () => {
    if (!bookUrl) return;
    Taro.setClipboardData({
      data: bookUrl,
      success: () => {
        Taro.showToast({ title: "链接已复制", icon: "success" });
      },
    });
  };

  if (loading) {
    return (
      <View className="book-web">
        <Text className="book-web__loading">加载中...</Text>
      </View>
    );
  }

  if (!expert) {
    return (
      <View className="book-web">
        <Text className="book-web__error">未找到专家信息</Text>
        <View
          className="book-web__btn book-web__btn--ghost"
          hoverClass="book-web__btn--hover"
          onClick={() => Taro.navigateBack()}
        >
          返回
        </View>
      </View>
    );
  }

  const name = expert.user.nickName || expert.user.name || "导师";

  return (
    <View className="book-web">
      <Text className="book-web__title">免费预约学习见面</Text>
      <Text className="book-web__desc">
        本项目对青年学员完全免费 —
        请复制下方链接，在手机浏览器中打开，选择时段并确认见面。系统不会向你收取任何费用。
      </Text>
      <View className="book-web__card">
        <Text className="book-web__expert">{name}</Text>
        <Text className="book-web__type">
          {sessionType === "OFFLINE" ? "线下见面" : "线上见面"} · 免费
        </Text>
      </View>
      <View
        className="book-web__btn book-web__btn--primary"
        hoverClass="book-web__btn--hover"
        onClick={copyLink}
      >
        复制网页预约链接
      </View>
      <View
        className="book-web__btn book-web__btn--ghost"
        hoverClass="book-web__btn--hover"
        onClick={() =>
          Taro.navigateTo({ url: `/pages/expert/index?id=${expertId}` })
        }
      >
        返回导师主页
      </View>
    </View>
  );
}
