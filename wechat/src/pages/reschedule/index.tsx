/**
 * Native reschedule page — replaces the old "改期（网页）" web-link copy flow.
 *
 * Route params (passed via Taro.navigateTo):
 *   bookingId   — the booking to reschedule
 *   expertId    — the expert on the booking (to fetch available slots)
 *   sessionType — ONLINE | OFFLINE (kept from the original booking)
 *   oldTime     — ISO string of the current start time (shown as context)
 *
 * Flow: slots → confirm → success
 */
import { View, Text, Picker, ScrollView } from "@tarojs/components";
import Taro, { useLoad, useRouter } from "@tarojs/taro";
import { useState, useCallback, useEffect } from "react";
import { get, patch } from "../../shared/api";
import type { AvailableSlot } from "../../shared/types";
import "./index.scss";

// ─── types ───────────────────────────────────────────────────────────────────

type Step = "slots" | "confirm" | "success";

interface SlotItem {
  id: string;
  startTime: string;
  endTime: string;
}

interface SlotsResponse {
  slots: AvailableSlot[];
  bookedSlots: Array<{ startTime: string; endTime: string }>;
}

type WeeklySchedule = Record<string, Array<{ start: string; end: string }>>;

// ─── helpers (same as book page) ─────────────────────────────────────────────

const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseDateStr(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d, 0, 0, 0, 0);
}

function formatDateLabel(d: Date): string {
  return d.toLocaleDateString("zh-CN", { month: "long", day: "numeric", weekday: "short" });
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("zh-CN", {
    month: "numeric",
    day: "numeric",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Shanghai",
  });
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
        slots.push({ id: `sched-${idx++}`, startTime: new Date(startMs).toISOString(), endTime: new Date(endMs).toISOString() });
      }
      h = endH;
      m = endM;
    }
  }
  return slots;
}

function getSlotsForDate(
  dateStr: string,
  allDbSlots: AvailableSlot[],
  bookedSlots: Array<{ startTime: string; endTime: string }>,
  schedule: WeeklySchedule | null | undefined
): SlotItem[] {
  const date = parseDateStr(dateStr);
  const now = new Date();

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

interface ExpertSlotsData {
  weeklySchedule?: WeeklySchedule | null;
}

export default function ReschedulePage() {
  const router = useRouter();
  const bookingId = router.params.bookingId || "";
  const expertId = router.params.expertId || "";
  const sessionType = router.params.sessionType || "ONLINE";
  const oldTime = router.params.oldTime || "";

  const [dbSlots, setDbSlots] = useState<AvailableSlot[]>([]);
  const [bookedSlots, setBookedSlots] = useState<Array<{ startTime: string; endTime: string }>>([]);
  const [weeklySchedule, setWeeklySchedule] = useState<WeeklySchedule | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const [step, setStep] = useState<Step>("slots");
  const [selectedDate, setSelectedDate] = useState<string>(toDateStr(new Date()));
  const [selectedSlot, setSelectedSlot] = useState<SlotItem | null>(null);

  const loadData = useCallback(async () => {
    if (!expertId) { setError("缺少导师信息"); setLoading(false); return; }
    setLoading(true);
    setError("");
    try {
      const [eRes, sRes] = await Promise.all([
        get<ExpertSlotsData>(`/api/experts/${expertId}`),
        get<SlotsResponse>(`/api/experts/${expertId}/slots`),
      ]);
      if (eRes.statusCode === 200) {
        setWeeklySchedule((eRes.data as { weeklySchedule?: WeeklySchedule | null }).weeklySchedule ?? null);
      }
      if (sRes.statusCode === 200) {
        setDbSlots(sRes.data.slots ?? []);
        // Exclude the current booking's slot from "booked" so it's selectable again
        const filtered = (sRes.data.bookedSlots ?? []).filter(
          (b) => b.startTime !== oldTime
        );
        setBookedSlots(filtered);
      }
    } catch {
      setError("加载失败，请重试");
    } finally {
      setLoading(false);
    }
  }, [expertId, oldTime]);

  useLoad(() => { loadData(); });

  const daySlots = getSlotsForDate(selectedDate, dbSlots, bookedSlots, weeklySchedule);

  useEffect(() => { setSelectedSlot(null); }, [selectedDate]);

  const handleConfirm = useCallback(async () => {
    if (!selectedSlot || !bookingId) return;
    setSubmitting(true);
    try {
      const res = await patch<{ id?: string; error?: string }>(`/api/bookings/${bookingId}`, {
        action: "reschedule",
        startTime: selectedSlot.startTime,
        endTime: selectedSlot.endTime,
        timezone: "Asia/Shanghai",
      });
      if (res.statusCode === 200) {
        setStep("success");
      } else {
        Taro.showToast({
          title: (res.data as { error?: string })?.error || "改期失败，请重试",
          icon: "none",
          duration: 3000,
        });
      }
    } catch {
      Taro.showToast({ title: "网络错误，请重试", icon: "none" });
    } finally {
      setSubmitting(false);
    }
  }, [bookingId, selectedSlot]);

  // ── loading / error ──────────────────────────────────────────────────────
  if (loading) {
    return <View className="reschedule"><Text className="reschedule__loading">加载中...</Text></View>;
  }
  if (error) {
    return (
      <View className="reschedule">
        <Text className="reschedule__error">{error}</Text>
        <View className="reschedule__btn reschedule__btn--ghost" hoverClass="reschedule__btn--hover"
          onClick={() => Taro.navigateBack()}>返回</View>
      </View>
    );
  }

  // ── step: slots ──────────────────────────────────────────────────────────
  if (step === "slots") {
    return (
      <View className="reschedule">
        <Text className="reschedule__title">选择新时段</Text>

        {/* Current booking context */}
        {oldTime && (
          <View className="reschedule__current">
            <Text className="reschedule__current-label">当前时间</Text>
            <Text className="reschedule__current-value">{formatDateTime(oldTime)}</Text>
          </View>
        )}

        {/* Date picker */}
        <Picker
          mode="date"
          value={selectedDate}
          start={toDateStr(new Date())}
          onChange={(e) => setSelectedDate(e.detail.value)}
        >
          <View className="reschedule__date-picker">
            <Text className="reschedule__date-picker-label">📅</Text>
            <Text className="reschedule__date-picker-value">{formatDateLabel(parseDateStr(selectedDate))}</Text>
            <Text className="reschedule__date-picker-arrow">›</Text>
          </View>
        </Picker>

        {/* Slot grid */}
        {daySlots.length === 0 ? (
          <View className="reschedule__empty">
            <Text className="reschedule__empty-icon">🗓</Text>
            <Text className="reschedule__empty-text">当天暂无可用时段</Text>
            <Text className="reschedule__empty-hint">请换一天试试，或稍后再查看</Text>
          </View>
        ) : (
          <ScrollView scrollY className="reschedule__slots-scroll">
            <View className="reschedule__slots-row">
              {daySlots.map((slot) => {
                const active = selectedSlot?.id === slot.id;
                return (
                  <View
                    key={slot.id}
                    className={`reschedule__slot${active ? " reschedule__slot--active" : ""}`}
                    hoverClass="reschedule__slot--hover"
                    onClick={() => setSelectedSlot(active ? null : slot)}
                  >
                    <Text className="reschedule__slot-start">{formatTime(slot.startTime)}</Text>
                    <Text className="reschedule__slot-end">–{formatTime(slot.endTime)}</Text>
                  </View>
                );
              })}
            </View>
          </ScrollView>
        )}

        <View
          className={`reschedule__btn reschedule__btn--primary${!selectedSlot ? " reschedule__btn--disabled" : ""}`}
          hoverClass={selectedSlot ? "reschedule__btn--hover" : ""}
          onClick={() => { if (selectedSlot) setStep("confirm"); }}
        >
          {selectedSlot
            ? `确认改期至 ${formatTime(selectedSlot.startTime)} – ${formatTime(selectedSlot.endTime)}`
            : "请选择新时段"}
        </View>

        <View className="reschedule__btn reschedule__btn--ghost" hoverClass="reschedule__btn--hover"
          onClick={() => Taro.navigateBack()}>
          取消
        </View>
      </View>
    );
  }

  // ── step: confirm ────────────────────────────────────────────────────────
  if (step === "confirm" && selectedSlot) {
    return (
      <View className="reschedule">
        <Text className="reschedule__title">确认改期</Text>
        <View className="reschedule__summary">
          {oldTime && (
            <View className="reschedule__summary-row">
              <Text className="reschedule__summary-label">原时间</Text>
              <Text className="reschedule__summary-value reschedule__summary-value--old">{formatDateTime(oldTime)}</Text>
            </View>
          )}
          <View className="reschedule__summary-row">
            <Text className="reschedule__summary-label">新日期</Text>
            <Text className="reschedule__summary-value">{formatDateLabel(parseDateStr(selectedDate))}</Text>
          </View>
          <View className="reschedule__summary-row">
            <Text className="reschedule__summary-label">新时间</Text>
            <Text className="reschedule__summary-value reschedule__summary-value--new">
              {formatTime(selectedSlot.startTime)} – {formatTime(selectedSlot.endTime)}
            </Text>
          </View>
          <View className="reschedule__summary-row">
            <Text className="reschedule__summary-label">方式</Text>
            <Text className="reschedule__summary-value">
              {sessionType === "OFFLINE" ? "线下见面" : "线上见面"}
            </Text>
          </View>
        </View>

        <View
          className={`reschedule__btn reschedule__btn--primary${submitting ? " reschedule__btn--loading" : ""}`}
          hoverClass={submitting ? "" : "reschedule__btn--hover"}
          onClick={submitting ? undefined : handleConfirm}
        >
          {submitting ? "提交中..." : "确认改期"}
        </View>
        <View className="reschedule__btn reschedule__btn--ghost" hoverClass="reschedule__btn--hover"
          onClick={() => { setStep("slots"); setSelectedSlot(null); }}>
          重新选时段
        </View>
      </View>
    );
  }

  // ── step: success ────────────────────────────────────────────────────────
  return (
    <View className="reschedule">
      <View className="reschedule__success">
        <Text className="reschedule__success-icon">✅</Text>
        <Text className="reschedule__success-title">改期成功！</Text>
        <Text className="reschedule__success-desc">
          已通知对方新的见面时间，请保持微信消息畅通。
        </Text>
        {selectedSlot && (
          <Text className="reschedule__success-time">
            {formatDateLabel(parseDateStr(selectedDate))}{" "}
            {formatTime(selectedSlot.startTime)} – {formatTime(selectedSlot.endTime)}
          </Text>
        )}
      </View>
      <View className="reschedule__btn reschedule__btn--primary" hoverClass="reschedule__btn--hover"
        onClick={() => Taro.switchTab({ url: "/pages/dashboard/index" })}>
        查看我的预约
      </View>
    </View>
  );
}
