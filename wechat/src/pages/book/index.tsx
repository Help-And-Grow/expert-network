import { View, Text, ScrollView } from "@tarojs/components";
import Taro, { useLoad, useRouter } from "@tarojs/taro";
import { useState, useCallback, useMemo } from "react";
import { get, post } from "../../shared/api";
import { isLoggedIn, wxLogin } from "../../shared/auth";
import type { ExpertDetail, AvailableSlot } from "../../shared/types";
import "./index.scss";

type Step = "type" | "slots" | "confirm" | "success";

interface SlotsResponse {
  slots: AvailableSlot[];
  bookedSlots: Array<{ startTime: string; endTime: string }>;
}

const TZ = "Asia/Shanghai";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("zh-CN", {
    timeZone: TZ,
    month: "long",
    day: "numeric",
    weekday: "short",
  });
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("zh-CN", {
    timeZone: TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function slotDateKey(iso: string): string {
  return new Date(iso).toLocaleDateString("zh-CN", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

function groupSlotsByDate(slots: AvailableSlot[]) {
  const map: Record<string, AvailableSlot[]> = {};
  for (const s of slots) {
    const key = slotDateKey(s.startTime);
    (map[key] ??= []).push(s);
  }
  return Object.entries(map)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, daySlots]) => ({
      dateLabel: formatDate(daySlots[0].startTime),
      slots: daySlots,
    }));
}

export default function BookPage() {
  const router = useRouter();
  const expertId = router.params.id || "";
  const initialType = router.params.type as "ONLINE" | "OFFLINE" | undefined;

  const [expert, setExpert] = useState<ExpertDetail | null>(null);
  const [slots, setSlots] = useState<AvailableSlot[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [selectedType, setSelectedType] = useState<"ONLINE" | "OFFLINE" | "">(initialType || "");
  const [selectedSlot, setSelectedSlot] = useState<AvailableSlot | null>(null);
  const [step, setStep] = useState<Step>(initialType ? "slots" : "type");

  const loadData = useCallback(async () => {
    if (!expertId) return;
    setLoading(true);
    setError("");
    try {
      const [eRes, sRes] = await Promise.all([
        get<ExpertDetail>(`/api/experts/${expertId}`),
        get<SlotsResponse>(`/api/experts/${expertId}/slots`),
      ]);
      if (eRes.statusCode !== 200) {
        setError("未找到导师信息");
        return;
      }
      const e = eRes.data;
      setExpert(e);
      setSlots(sRes.statusCode === 200 ? (sRes.data.slots ?? []) : []);

      // Auto-advance past type selection when only one session type is available
      if (!initialType) {
        const online = e.priceOnlineCents != null;
        const offline = e.priceOfflineCents != null;
        if (online && !offline) { setSelectedType("ONLINE"); setStep("slots"); }
        else if (!online && offline) { setSelectedType("OFFLINE"); setStep("slots"); }
      }
    } catch {
      setError("加载失败，请重试");
    } finally {
      setLoading(false);
    }
  }, [expertId, initialType]);

  useLoad(() => { loadData(); });

  const slotGroups = useMemo(() => groupSlotsByDate(slots), [slots]);
  const name = expert?.user.nickName || expert?.user.name || "导师";
  const hasOnline = !!expert && expert.priceOnlineCents != null;
  const hasOffline = !!expert && expert.priceOfflineCents != null;

  const handleConfirm = useCallback(async () => {
    if (!selectedSlot || !selectedType) return;
    if (!isLoggedIn()) {
      Taro.showLoading({ title: "登录中..." });
      try {
        await wxLogin();
      } catch {
        Taro.hideLoading();
        Taro.showToast({ title: "登录失败，请重试", icon: "none" });
        return;
      }
      Taro.hideLoading();
    }
    setSubmitting(true);
    try {
      const res = await post<{ bookingId?: string; error?: string }>("/api/bookings/free", {
        expertId,
        sessionType: selectedType,
        startTime: selectedSlot.startTime,
        endTime: selectedSlot.endTime,
        timezone: TZ,
      });
      if (res.statusCode === 200 || res.statusCode === 201) {
        setStep("success");
      } else {
        const msg = res.data?.error || "预约失败，请重试";
        Taro.showToast({ title: msg, icon: "none", duration: 3000 });
      }
    } catch {
      Taro.showToast({ title: "网络错误，请重试", icon: "none" });
    } finally {
      setSubmitting(false);
    }
  }, [expertId, selectedSlot, selectedType]);

  if (loading) {
    return (
      <View className="book">
        <Text className="book__loading">加载中...</Text>
      </View>
    );
  }

  if (error || !expert) {
    return (
      <View className="book">
        <Text className="book__error">{error || "未找到导师信息"}</Text>
        <View className="book__btn book__btn--ghost" hoverClass="book__btn--hover" onClick={() => Taro.navigateBack()}>
          返回
        </View>
      </View>
    );
  }

  if (step === "type") {
    return (
      <View className="book">
        <Text className="book__title">预约学习见面</Text>
        <Text className="book__subtitle">与 {name} 免费见面，选择方式</Text>
        <View className="book__type-cards">
          {hasOnline && (
            <View
              className="book__type-card"
              hoverClass="book__type-card--hover"
              onClick={() => { setSelectedType("ONLINE"); setSelectedSlot(null); setStep("slots"); }}
            >
              <Text className="book__type-card-icon">💻</Text>
              <Text className="book__type-card-title">线上见面</Text>
              <Text className="book__type-card-desc">视频通话 · 免费 · 30 分钟</Text>
            </View>
          )}
          {hasOffline && (
            <View
              className="book__type-card"
              hoverClass="book__type-card--hover"
              onClick={() => { setSelectedType("OFFLINE"); setSelectedSlot(null); setStep("slots"); }}
            >
              <Text className="book__type-card-icon">📍</Text>
              <Text className="book__type-card-title">线下见面</Text>
              <Text className="book__type-card-desc">当面交流 · 免费 · 30 分钟</Text>
            </View>
          )}
        </View>
        <View className="book__btn book__btn--ghost" hoverClass="book__btn--hover" onClick={() => Taro.navigateBack()}>
          返回
        </View>
      </View>
    );
  }

  if (step === "slots") {
    return (
      <View className="book">
        <Text className="book__title">{selectedType === "ONLINE" ? "线上见面" : "线下见面"}</Text>
        <Text className="book__subtitle">选择与 {name} 见面的时段</Text>
        {slotGroups.length === 0 ? (
          <View className="book__empty">
            <Text className="book__empty-icon">📅</Text>
            <Text className="book__empty-text">暂无可用时段</Text>
            <Text className="book__empty-hint">导师尚未开放预约时间，请稍后再试</Text>
          </View>
        ) : (
          <ScrollView scrollY className="book__slots-scroll">
            {slotGroups.map((group) => (
              <View key={group.dateLabel} className="book__date-group">
                <Text className="book__date-label">{group.dateLabel}</Text>
                <View className="book__slots-row">
                  {group.slots.map((slot) => (
                    <View
                      key={slot.id}
                      className="book__slot"
                      hoverClass="book__slot--hover"
                      onClick={() => { setSelectedSlot(slot); setStep("confirm"); }}
                    >
                      <Text className="book__slot-start">{formatTime(slot.startTime)}</Text>
                      <Text className="book__slot-end">–{formatTime(slot.endTime)}</Text>
                    </View>
                  ))}
                </View>
              </View>
            ))}
          </ScrollView>
        )}
        {hasOnline && hasOffline && (
          <View
            className="book__btn book__btn--ghost"
            hoverClass="book__btn--hover"
            onClick={() => { setStep("type"); setSelectedSlot(null); }}
          >
            换种方式
          </View>
        )}
        <View className="book__btn book__btn--ghost" hoverClass="book__btn--hover" onClick={() => Taro.navigateBack()}>
          返回主页
        </View>
      </View>
    );
  }

  if (step === "confirm" && selectedSlot) {
    return (
      <View className="book">
        <Text className="book__title">确认预约</Text>
        <View className="book__summary">
          <View className="book__summary-row">
            <Text className="book__summary-label">导师</Text>
            <Text className="book__summary-value">{name}</Text>
          </View>
          <View className="book__summary-row">
            <Text className="book__summary-label">方式</Text>
            <Text className="book__summary-value">{selectedType === "ONLINE" ? "线上见面" : "线下见面"}</Text>
          </View>
          <View className="book__summary-row">
            <Text className="book__summary-label">日期</Text>
            <Text className="book__summary-value">{formatDate(selectedSlot.startTime)}</Text>
          </View>
          <View className="book__summary-row">
            <Text className="book__summary-label">时间</Text>
            <Text className="book__summary-value">
              {formatTime(selectedSlot.startTime)} – {formatTime(selectedSlot.endTime)}
            </Text>
          </View>
          <View className="book__summary-row">
            <Text className="book__summary-label">费用</Text>
            <Text className="book__summary-value book__summary-value--free">免费</Text>
          </View>
        </View>
        <View
          className={`book__btn book__btn--primary${submitting ? " book__btn--loading" : ""}`}
          hoverClass={submitting ? "" : "book__btn--hover"}
          onClick={submitting ? undefined : handleConfirm}
        >
          {submitting ? "提交中..." : "确认预约"}
        </View>
        <View
          className="book__btn book__btn--ghost"
          hoverClass="book__btn--hover"
          onClick={() => { setStep("slots"); setSelectedSlot(null); }}
        >
          重新选时段
        </View>
      </View>
    );
  }

  // success
  return (
    <View className="book">
      <View className="book__success">
        <Text className="book__success-icon">🎉</Text>
        <Text className="book__success-title">预约成功！</Text>
        <Text className="book__success-desc">
          已通知 {name}，请保持微信消息畅通，以便确认见面细节。
        </Text>
        {selectedType === "ONLINE" && (
          <Text className="book__success-hint">导师会在见面前发送视频链接给你。</Text>
        )}
      </View>
      <View
        className="book__btn book__btn--primary"
        hoverClass="book__btn--hover"
        onClick={() => Taro.switchTab({ url: "/pages/dashboard/index" })}
      >
        查看我的预约
      </View>
      <View
        className="book__btn book__btn--ghost"
        hoverClass="book__btn--hover"
        onClick={() => Taro.navigateBack()}
      >
        返回主页
      </View>
    </View>
  );
}
