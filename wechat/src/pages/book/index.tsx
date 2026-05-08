import { View, Text, Picker, ScrollView, Input } from "@tarojs/components";
import Taro, { useLoad, useRouter } from "@tarojs/taro";
import { useState, useCallback, useEffect } from "react";
import { get, post } from "../../shared/api";
import { isLoggedIn, wxLogin } from "../../shared/auth";
import type { ExpertDetail, AvailableSlot } from "../../shared/types";
import "./index.scss";

// ─── types ───────────────────────────────────────────────────────────────────

type Step = "type" | "slots" | "confirm" | "success";
type SessionType = "ONLINE" | "OFFLINE";

interface SlotItem {
  id: string;
  startTime: string; // ISO
  endTime: string;   // ISO
}

interface SlotsResponse {
  slots: AvailableSlot[];
  bookedSlots: Array<{ startTime: string; endTime: string }>;
}

type WeeklySchedule = Record<string, Array<{ start: string; end: string }>>;

// ─── helpers ─────────────────────────────────────────────────────────────────

const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

/** "YYYY-MM-DD" from a local Date */
function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Parse "YYYY-MM-DD" into a local midnight Date */
function parseDateStr(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d, 0, 0, 0, 0);
}

/** Pretty label like "5月8日 周四" */
function formatDateLabel(d: Date): string {
  return d.toLocaleDateString("zh-CN", { month: "long", day: "numeric", weekday: "short" });
}

/** "HH:mm" from an ISO string, device local time */
function formatTime(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function isSlotBooked(
  slot: SlotItem,
  bookedSlots: Array<{ startTime: string; endTime: string }>
): boolean {
  const sStart = new Date(slot.startTime).getTime();
  const sEnd = new Date(slot.endTime).getTime();
  return bookedSlots.some((b) => {
    const bStart = new Date(b.startTime).getTime();
    const bEnd = new Date(b.endTime).getTime();
    return sStart < bEnd && sEnd > bStart;
  });
}

/** Generate 30-min slots from the expert's weeklySchedule for a given local date */
function generateSlotsFromSchedule(date: Date, schedule: WeeklySchedule): SlotItem[] {
  const dayKey = DAY_KEYS[date.getDay()];
  const ranges = schedule[dayKey];
  if (!ranges || ranges.length === 0) return [];

  const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
  const slots: SlotItem[] = [];
  let idx = 0;

  for (const range of ranges) {
    const [sh, sm] = range.start.split(":").map(Number);
    const [eh, em] = range.end.split(":").map(Number);
    let h = sh;
    let m = sm ?? 0;

    while (h < eh || (h === eh && m < em)) {
      const startMs = dayStart.getTime() + (h * 60 + m) * 60_000;
      const nextM = m + 30;
      const endH = h + Math.floor(nextM / 60);
      const endM = nextM % 60;
      const withinRange = endH < eh || (endH === eh && endM <= em);
      const endMs = withinRange
        ? dayStart.getTime() + (endH * 60 + endM) * 60_000
        : dayStart.getTime() + (eh * 60 + em) * 60_000;

      if (endMs > startMs) {
        slots.push({
          id: `sched-${idx++}`,
          startTime: new Date(startMs).toISOString(),
          endTime: new Date(endMs).toISOString(),
        });
      }
      h = endH;
      m = endM;
    }
  }
  return slots;
}

/** Slots available on a given date, preferring DB records, falling back to schedule */
function getSlotsForDate(
  dateStr: string,
  allDbSlots: AvailableSlot[],
  bookedSlots: Array<{ startTime: string; endTime: string }>,
  schedule: WeeklySchedule | null | undefined
): SlotItem[] {
  const date = parseDateStr(dateStr);
  const now = new Date();

  // Match DB slots for this date by comparing local date components
  const explicit = allDbSlots.filter((s) => {
    const sd = new Date(s.startTime);
    return (
      sd.getFullYear() === date.getFullYear() &&
      sd.getMonth() === date.getMonth() &&
      sd.getDate() === date.getDate() &&
      !s.isBooked
    );
  });

  const source: SlotItem[] =
    explicit.length > 0
      ? explicit
      : schedule
      ? generateSlotsFromSchedule(date, schedule)
      : [];

  return source.filter(
    (s) => new Date(s.startTime) > now && !isSlotBooked(s, bookedSlots)
  );
}

// ─── component ───────────────────────────────────────────────────────────────

export default function BookPage() {
  const router = useRouter();
  const expertId = router.params.id || "";
  const initialType = router.params.type as SessionType | undefined;

  const [expert, setExpert] = useState<ExpertDetail | null>(null);
  const [dbSlots, setDbSlots] = useState<AvailableSlot[]>([]);
  const [bookedSlots, setBookedSlots] = useState<Array<{ startTime: string; endTime: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const [step, setStep] = useState<Step>(initialType ? "slots" : "type");
  const [selectedType, setSelectedType] = useState<SessionType>(initialType || "ONLINE");
  const [selectedDate, setSelectedDate] = useState<string>(toDateStr(new Date()));
  const [selectedSlot, setSelectedSlot] = useState<SlotItem | null>(null);
  const [offlineAddress, setOfflineAddress] = useState("");

  const loadData = useCallback(async () => {
    if (!expertId) return;
    setLoading(true);
    setError("");
    try {
      const [eRes, sRes] = await Promise.all([
        get<ExpertDetail>(`/api/experts/${expertId}`),
        get<SlotsResponse>(`/api/experts/${expertId}/slots`),
      ]);
      if (eRes.statusCode !== 200) { setError("未找到导师信息"); return; }
      setExpert(eRes.data);
      if (sRes.statusCode === 200) {
        setDbSlots(sRes.data.slots ?? []);
        setBookedSlots(sRes.data.bookedSlots ?? []);
      }
      // Auto-advance if only one session type is available and no type was pre-selected
      if (!initialType) {
        const online = eRes.data.priceOnlineCents != null;
        const offline = eRes.data.priceOfflineCents != null;
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

  // Slots for the currently selected date
  const daySlots = getSlotsForDate(
    selectedDate,
    dbSlots,
    bookedSlots,
    expert?.weeklySchedule
  );

  // Re-clear slot selection when date changes
  useEffect(() => { setSelectedSlot(null); }, [selectedDate]);

  const handleConfirm = useCallback(async () => {
    if (!selectedSlot) return;
    if (!isLoggedIn()) {
      Taro.showLoading({ title: "登录中..." });
      try { await wxLogin(); } catch {
        Taro.hideLoading();
        Taro.showToast({ title: "登录失败，请重试", icon: "none" });
        return;
      }
      Taro.hideLoading();
    }
    setSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        expertId,
        sessionType: selectedType,
        startTime: selectedSlot.startTime,
        endTime: selectedSlot.endTime,
        timezone: "Asia/Shanghai",
      };
      if (selectedType === "OFFLINE" && offlineAddress.trim()) {
        body.offlineAddress = offlineAddress.trim();
      }
      const res = await post<{ bookingId?: string; error?: string }>("/api/bookings/free", body);
      if (res.statusCode === 200 || res.statusCode === 201) {
        setStep("success");
      } else {
        Taro.showToast({ title: res.data?.error || "预约失败，请重试", icon: "none", duration: 3000 });
      }
    } catch {
      Taro.showToast({ title: "网络错误，请重试", icon: "none" });
    } finally {
      setSubmitting(false);
    }
  }, [expertId, selectedSlot, selectedType, offlineAddress]);

  const name = expert?.user.nickName || expert?.user.name || "导师";
  const hasOnline = !!expert && expert.priceOnlineCents != null;
  const hasOffline = !!expert && expert.priceOfflineCents != null;

  // ── loading / error ────────────────────────────────────────────────────────
  if (loading) {
    return <View className="book"><Text className="book__loading">加载中...</Text></View>;
  }
  if (error || !expert) {
    return (
      <View className="book">
        <Text className="book__error">{error || "未找到导师信息"}</Text>
        <View className="book__btn book__btn--ghost" hoverClass="book__btn--hover" onClick={() => Taro.navigateBack()}>返回</View>
      </View>
    );
  }

  // ── step: type ─────────────────────────────────────────────────────────────
  if (step === "type") {
    return (
      <View className="book">
        <Text className="book__title">预约学习见面</Text>
        <Text className="book__subtitle">与 {name} 免费见面，选择方式</Text>
        <View className="book__type-cards">
          {hasOnline && (
            <View className="book__type-card" hoverClass="book__type-card--hover"
              onClick={() => { setSelectedType("ONLINE"); setStep("slots"); }}>
              <Text className="book__type-card-icon">💻</Text>
              <Text className="book__type-card-title">线上见面</Text>
              <Text className="book__type-card-desc">视频通话 · 免费 · 30 分钟</Text>
            </View>
          )}
          {hasOffline && (
            <View className="book__type-card" hoverClass="book__type-card--hover"
              onClick={() => { setSelectedType("OFFLINE"); setStep("slots"); }}>
              <Text className="book__type-card-icon">📍</Text>
              <Text className="book__type-card-title">线下见面</Text>
              <Text className="book__type-card-desc">当面交流 · 免费 · 30 分钟</Text>
            </View>
          )}
        </View>
        <View className="book__btn book__btn--ghost" hoverClass="book__btn--hover" onClick={() => Taro.navigateBack()}>返回</View>
      </View>
    );
  }

  // ── step: slots ────────────────────────────────────────────────────────────
  if (step === "slots") {
    return (
      <View className="book">
        <Text className="book__title">{selectedType === "ONLINE" ? "线上见面" : "线下见面"}</Text>
        <Text className="book__subtitle">与 {name} 免费见面 · 选择时段</Text>

        {/* Date picker */}
        <Picker
          mode="date"
          value={selectedDate}
          start={toDateStr(new Date())}
          onChange={(e) => setSelectedDate(e.detail.value)}
        >
          <View className="book__date-picker">
            <Text className="book__date-picker-label">📅</Text>
            <Text className="book__date-picker-value">{formatDateLabel(parseDateStr(selectedDate))}</Text>
            <Text className="book__date-picker-arrow">›</Text>
          </View>
        </Picker>

        {/* Slots for selected date */}
        {daySlots.length === 0 ? (
          <View className="book__empty">
            <Text className="book__empty-icon">🗓</Text>
            <Text className="book__empty-text">当天暂无可用时段</Text>
            <Text className="book__empty-hint">请换一天试试，或稍后再查看</Text>
          </View>
        ) : (
          <ScrollView scrollY className="book__slots-scroll">
            <View className="book__slots-row">
              {daySlots.map((slot) => {
                const active = selectedSlot?.id === slot.id;
                return (
                  <View
                    key={slot.id}
                    className={`book__slot${active ? " book__slot--active" : ""}`}
                    hoverClass="book__slot--hover"
                    onClick={() => setSelectedSlot(active ? null : slot)}
                  >
                    <Text className="book__slot-start">{formatTime(slot.startTime)}</Text>
                    <Text className="book__slot-end">–{formatTime(slot.endTime)}</Text>
                  </View>
                );
              })}
            </View>
          </ScrollView>
        )}

        <View
          className={`book__btn book__btn--primary${!selectedSlot ? " book__btn--disabled" : ""}`}
          hoverClass={selectedSlot ? "book__btn--hover" : ""}
          onClick={() => { if (selectedSlot) setStep("confirm"); }}
        >
          {selectedSlot ? `确认 ${formatTime(selectedSlot.startTime)} – ${formatTime(selectedSlot.endTime)}` : "请选择一个时段"}
        </View>

        {hasOnline && hasOffline && (
          <View className="book__btn book__btn--ghost" hoverClass="book__btn--hover"
            onClick={() => { setStep("type"); setSelectedSlot(null); }}>
            换种见面方式
          </View>
        )}
        <View className="book__btn book__btn--ghost" hoverClass="book__btn--hover" onClick={() => Taro.navigateBack()}>
          返回主页
        </View>
      </View>
    );
  }

  // ── step: confirm ──────────────────────────────────────────────────────────
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
            <Text className="book__summary-value">{formatDateLabel(parseDateStr(selectedDate))}</Text>
          </View>
          <View className="book__summary-row">
            <Text className="book__summary-label">时间</Text>
            <Text className="book__summary-value">{formatTime(selectedSlot.startTime)} – {formatTime(selectedSlot.endTime)}</Text>
          </View>
          <View className="book__summary-row">
            <Text className="book__summary-label">费用</Text>
            <Text className="book__summary-value book__summary-value--free">免费</Text>
          </View>
        </View>

        {selectedType === "OFFLINE" && (
          <View className="book__address-wrap">
            <Text className="book__address-label">见面地点（可选）</Text>
            <Input
              className="book__address-input"
              value={offlineAddress}
              onInput={(e) => setOfflineAddress(e.detail.value)}
              placeholder="例：星巴克 xx 路店 / 待导师确认"
              placeholderClass="book__address-placeholder"
            />
          </View>
        )}

        <View
          className={`book__btn book__btn--primary${submitting ? " book__btn--loading" : ""}`}
          hoverClass={submitting ? "" : "book__btn--hover"}
          onClick={submitting ? undefined : handleConfirm}
        >
          {submitting ? "提交中..." : "确认预约"}
        </View>
        <View className="book__btn book__btn--ghost" hoverClass="book__btn--hover"
          onClick={() => { setStep("slots"); setSelectedSlot(null); }}>
          重新选时段
        </View>
      </View>
    );
  }

  // ── step: success ──────────────────────────────────────────────────────────
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
      <View className="book__btn book__btn--primary" hoverClass="book__btn--hover"
        onClick={() => Taro.switchTab({ url: "/pages/dashboard/index" })}>
        查看我的预约
      </View>
      <View className="book__btn book__btn--ghost" hoverClass="book__btn--hover" onClick={() => Taro.navigateBack()}>
        返回主页
      </View>
    </View>
  );
}
