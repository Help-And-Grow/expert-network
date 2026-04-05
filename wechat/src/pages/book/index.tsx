import { View, Text, ScrollView } from "@tarojs/components";
import Taro, { useRouter } from "@tarojs/taro";
import { useState, useEffect, useMemo } from "react";
import { get, post } from "../../shared/api";
import type { ExpertDetail, AvailableSlot } from "../../shared/types";
import "./index.scss";

interface SlotsResponse {
  slots: AvailableSlot[];
  bookedSlots: { startTime: string; endTime: string }[];
}

type TimeRange = { start: string; end: string };
type WeeklySchedule = Record<string, TimeRange[]>;

interface GeneratedSlot {
  id: string;
  startTime: string;
  endTime: string;
}

const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const DAY_NAMES_SHORT = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function isSlotBooked(
  slot: { startTime: string; endTime: string },
  bookedSlots: { startTime: string; endTime: string }[]
): boolean {
  const sStart = new Date(slot.startTime).getTime();
  const sEnd = new Date(slot.endTime).getTime();
  return bookedSlots.some((b) => {
    const bStart = new Date(b.startTime).getTime();
    const bEnd = new Date(b.endTime).getTime();
    return sStart < bEnd && sEnd > bStart;
  });
}

function generateSlotsFromSchedule(
  date: Date,
  schedule: WeeklySchedule | null
): GeneratedSlot[] {
  if (!schedule) return [];
  const dayKey = DAY_KEYS[date.getDay()];
  const ranges = schedule[dayKey];
  if (!ranges || ranges.length === 0) return [];

  const day = startOfDay(date);
  const slots: GeneratedSlot[] = [];
  let slotIdx = 0;

  for (const range of ranges) {
    const [sh, sm] = range.start.split(":").map(Number);
    const [eh, em] = range.end.split(":").map(Number);
    let h = sh;
    let m = sm || 0;

    while (h < eh || (h === eh && m < em)) {
      const start = new Date(day);
      start.setHours(h, m, 0, 0);

      const nextM = m + 30;
      const endH = h + Math.floor(nextM / 60);
      const endM = nextM % 60;

      const end = new Date(day);
      if (endH < eh || (endH === eh && endM <= em)) {
        end.setHours(endH, endM, 0, 0);
      } else {
        end.setHours(eh, em, 0, 0);
      }

      if (end > start) {
        slots.push({
          id: `sched-${slotIdx++}`,
          startTime: start.toISOString(),
          endTime: end.toISOString(),
        });
      }

      h = endH;
      m = endM;
    }
  }

  return slots;
}

function getNextNDays(n: number): Date[] {
  const days: Date[] = [];
  const today = new Date();
  for (let i = 0; i < n; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    days.push(d);
  }
  return days;
}

export default function BookPage() {
  const router = useRouter();
  const expertId = router.params.id || "";
  const sessionType = router.params.type || "ONLINE";
  const [expert, setExpert] = useState<ExpertDetail | null>(null);
  const [weeklySchedule, setWeeklySchedule] = useState<WeeklySchedule | null>(null);
  const [allSlots, setAllSlots] = useState<AvailableSlot[]>([]);
  const [bookedSlots, setBookedSlots] = useState<{ startTime: string; endTime: string }[]>([]);
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [selectedSlotIds, setSelectedSlotIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [booking, setBooking] = useState(false);

  const nextDays = useMemo(() => getNextNDays(14), []);

  useEffect(() => {
    if (!expertId) return;
    Promise.all([
      get<ExpertDetail>(`/api/experts/${expertId}`),
      get<SlotsResponse>(`/api/experts/${expertId}/slots`),
    ])
      .then(([expertRes, slotsRes]) => {
        if (expertRes.statusCode === 200) {
          setExpert(expertRes.data);
          if ((expertRes.data as Record<string, unknown>).weeklySchedule) {
            setWeeklySchedule(
              (expertRes.data as Record<string, unknown>).weeklySchedule as WeeklySchedule
            );
          }
        }
        if (slotsRes.statusCode === 200) {
          setAllSlots(slotsRes.data.slots || []);
          setBookedSlots(slotsRes.data.bookedSlots || []);
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [expertId]);

  const slotsForDate = useMemo(() => {
    if (!selectedDate) return [];
    const now = new Date();

    const explicitSlots = allSlots.filter(
      (s) => isSameDay(new Date(s.startTime), selectedDate) && !s.isBooked
    );

    let displaySlots: { id: string; startTime: string; endTime: string }[];
    if (explicitSlots.length > 0) {
      displaySlots = explicitSlots.filter((s) => !isSlotBooked(s, bookedSlots));
    } else {
      displaySlots = generateSlotsFromSchedule(selectedDate, weeklySchedule).filter(
        (s) => new Date(s.startTime) > now && !isSlotBooked(s, bookedSlots)
      );
    }

    return displaySlots;
  }, [selectedDate, allSlots, bookedSlots, weeklySchedule]);

  const toggleSlot = (slotId: string) => {
    setSelectedSlotIds((prev) =>
      prev.includes(slotId) ? prev.filter((id) => id !== slotId) : [...prev, slotId]
    );
  };

  const handleBook = async () => {
    if (selectedSlotIds.length === 0 || booking) return;
    setBooking(true);

    const selected = slotsForDate.filter((s) => selectedSlotIds.includes(s.id));
    if (selected.length === 0) {
      setBooking(false);
      return;
    }

    const sorted = [...selected].sort(
      (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
    );
    const firstSlot = sorted[0];
    const lastSlot = sorted[sorted.length - 1];

    try {
      const res = await post<{
        bookingId: string;
        paymentParams?: {
          timeStamp: string;
          nonceStr: string;
          package: string;
          signType: string;
          paySign: string;
        };
      }>("/api/bookings/wechat-pay", {
        expertId,
        slotId: firstSlot.id.startsWith("sched-") ? undefined : firstSlot.id,
        sessionType,
        startTime: firstSlot.startTime,
        endTime: lastSlot.endTime,
      });

      if (res.statusCode !== 200 || !(res.data as Record<string, unknown>)["bookingId"]) {
        throw new Error(
          (res.data as unknown as Record<string, string>)["error"] || "预约失败"
        );
      }

      if (res.data.paymentParams) {
        await Taro.requestPayment({
          timeStamp: res.data.paymentParams.timeStamp,
          nonceStr: res.data.paymentParams.nonceStr,
          package: res.data.paymentParams.package,
          signType: res.data.paymentParams.signType as "MD5" | "HMAC-SHA256" | "RSA",
          paySign: res.data.paymentParams.paySign,
        });
        Taro.showToast({ title: "支付成功", icon: "success" });
      } else {
        Taro.showToast({ title: "预约已创建", icon: "success" });
      }

      setTimeout(() => {
        Taro.switchTab({ url: "/pages/dashboard/index" });
      }, 1500);
    } catch (err: unknown) {
      const errObj = err as Record<string, unknown>;
      if (errObj && errObj["errMsg"] === "requestPayment:fail cancel") {
        Taro.showToast({ title: "已取消支付", icon: "none" });
      } else {
        Taro.showToast({
          title:
            (errObj && (errObj["message"] as string)) ||
            "预约失败，请稍后重试",
          icon: "none",
        });
      }
    } finally {
      setBooking(false);
    }
  };

  if (loading) {
    return (
      <View className="book-page">
        <View className="book-page__skeleton-header" />
        <View className="book-page__skeleton-dates">
          {[1, 2, 3, 4, 5].map((i) => (
            <View key={i} className="book-page__skeleton-date" />
          ))}
        </View>
        <View className="book-page__skeleton-slots">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <View key={i} className="book-page__skeleton-slot" />
          ))}
        </View>
      </View>
    );
  }

  if (!expert) {
    return (
      <View className="book-page">
        <View className="book-page__error">
          <Text className="book-page__error-icon">😔</Text>
          <Text className="book-page__error-text">未找到该专家主页</Text>
          <View
            className="book-page__error-btn"
            hoverClass="book-page__error-btn--hover"
            onClick={() => Taro.navigateBack()}
          >
            返回
          </View>
        </View>
      </View>
    );
  }

  const name = expert.user.nickName || expert.user.name || "成员";
  const priceCents =
    sessionType === "OFFLINE"
      ? expert.priceOfflineCents
      : expert.priceOnlineCents;
  const priceLabel = priceCents
    ? `${expert.currency} ${Math.round(priceCents / 100)}/场`
    : "免费";

  return (
    <View className="book-page">
      <View className="book-page__header">
        <Text className="book-page__expert-name">预约 {name}</Text>
        <View className="book-page__meta">
          <Text className="book-page__session-type">
            {sessionType === "OFFLINE" ? "📍 线下" : "🖥 线上"}
          </Text>
          {priceLabel && (
            <Text className="book-page__price">{priceLabel}</Text>
          )}
        </View>
      </View>

      {/* Date selector */}
      <View className="book-page__section">
        <Text className="book-page__section-title">选择日期</Text>
        <ScrollView scrollX className="book-page__dates" enhanced showScrollbar={false}>
          {nextDays.map((day) => {
            const isSelected = selectedDate && isSameDay(day, selectedDate);
            const isToday = isSameDay(day, new Date());
            return (
              <View
                key={day.toISOString()}
                className={`book-page__date-chip ${isSelected ? "book-page__date-chip--selected" : ""}`}
                hoverClass="book-page__date-chip--hover"
                onClick={() => {
                  setSelectedDate(day);
                  setSelectedSlotIds([]);
                }}
              >
                <Text className="book-page__date-day">
                  {isToday ? "今天" : DAY_NAMES_SHORT[day.getDay()]}
                </Text>
                <Text className="book-page__date-num">{day.getDate()}</Text>
              </View>
            );
          })}
        </ScrollView>
      </View>

      {/* Time slots */}
      <View className="book-page__section">
        <Text className="book-page__section-title">选择时间段</Text>
        <Text className="book-page__hint">每个时段 30 分钟，可多选拼接更长咨询</Text>
        {!selectedDate ? (
          <View className="book-page__no-slots-wrap">
            <Text className="book-page__no-slots-icon">📅</Text>
            <Text className="book-page__no-slots">请先选择日期以查看可预约时间</Text>
          </View>
        ) : slotsForDate.length === 0 ? (
          <View className="book-page__no-slots-wrap">
            <Text className="book-page__no-slots-icon">🕐</Text>
            <Text className="book-page__no-slots">当天暂无可预约时段</Text>
            <Text className="book-page__no-slots-hint">请尝试其他日期</Text>
          </View>
        ) : (
          <View className="book-page__slots">
            {slotsForDate.map((slot) => {
              const isSelected = selectedSlotIds.includes(slot.id);
              const startStr = new Date(slot.startTime).toLocaleTimeString("zh-CN", {
                hour: "2-digit",
                minute: "2-digit",
                hour12: false,
              });
              const endStr = new Date(slot.endTime).toLocaleTimeString("zh-CN", {
                hour: "2-digit",
                minute: "2-digit",
                hour12: false,
              });
              return (
                <View
                  key={slot.id}
                  className={`book-page__slot ${isSelected ? "book-page__slot--selected" : ""}`}
                  hoverClass="book-page__slot--hover"
                  onClick={() => toggleSlot(slot.id)}
                >
                  {startStr} - {endStr}
                  {isSelected && <Text className="book-page__slot-check"> ✓</Text>}
                </View>
              );
            })}
          </View>
        )}
      </View>

      <View className="book-page__bottom-bar">
        {selectedSlotIds.length > 0 && (
          <Text className="book-page__deposit">
            已选择 {selectedSlotIds.length} 个时段
            {priceCents ? ` · 订金 ${expert.currency} ${((priceCents * selectedSlotIds.length) / 200).toFixed(2)}` : ""}
          </Text>
        )}
        <View
          className={`book-page__confirm-btn ${
            selectedSlotIds.length === 0 || booking ? "book-page__confirm-btn--disabled" : ""
          }`}
          hoverClass={selectedSlotIds.length > 0 && !booking ? "book-page__confirm-btn--hover" : "none"}
          onClick={handleBook}
        >
          {booking ? "处理中..." : selectedSlotIds.length === 0 ? "请选择时段后继续" : "确认并支付"}
        </View>
      </View>
    </View>
  );
}
