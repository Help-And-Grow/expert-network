import { View, Text } from "@tarojs/components";
import Taro, { useLoad, usePullDownRefresh, useDidShow } from "@tarojs/taro";
import { useState, useCallback } from "react";
import { get, post } from "../../shared/api";
import type { Booking } from "../../shared/types";
import "./index.scss";

export default function DashboardPage() {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"upcoming" | "past">("upcoming");

  const fetchBookings = useCallback(async () => {
    setLoading(true);
    try {
      const res = await get<{ bookings: Booking[] }>("/api/bookings");
      if (res.statusCode === 200) {
        setBookings(res.data.bookings || []);
      }
    } catch {
      setBookings([]);
    } finally {
      setLoading(false);
      Taro.stopPullDownRefresh();
    }
  }, []);

  useLoad(() => {
    fetchBookings();
  });

  useDidShow(() => {
    fetchBookings();
  });

  usePullDownRefresh(() => {
    fetchBookings();
  });

  const now = new Date();
  const upcomingBookings = bookings
    .filter(
      (b) =>
        new Date(b.startTime) >= now &&
        (b.status === "CONFIRMED" || b.status === "PENDING")
    )
    .sort(
      (a, b) =>
        new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
    );

  const pastBookings = bookings
    .filter(
      (b) =>
        new Date(b.startTime) < now ||
        b.status === "COMPLETED" ||
        b.status === "CANCELLED"
    )
    .sort(
      (a, b) =>
        new Date(b.startTime).getTime() - new Date(a.startTime).getTime()
    );

  const displayBookings = tab === "upcoming" ? upcomingBookings : pastBookings;

  const handleCancel = async (bookingId: string) => {
    const res = await Taro.showModal({
      title: "取消预约",
      content: "确认取消这笔预约吗？",
      confirmColor: "#dc2626",
    });
    if (!res.confirm) return;

    try {
      Taro.showLoading({ title: "取消中..." });
      const apiRes = await post(`/api/bookings/${bookingId}`, {
        action: "cancel",
        reason: "用户取消预约",
      });
      Taro.hideLoading();
      if (apiRes.statusCode === 200) {
        Taro.showToast({ title: "已取消", icon: "success" });
        fetchBookings();
      } else {
        Taro.showToast({ title: "取消失败", icon: "none" });
      }
    } catch {
      Taro.hideLoading();
      Taro.showToast({ title: "取消失败", icon: "none" });
    }
  };

  const formatDateTime = (dateStr: string, timezone?: string) => {
    const date = new Date(dateStr);
    return date.toLocaleString("zh-CN", {
      weekday: "short",
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: timezone || "Asia/Singapore",
    });
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case "CONFIRMED": return "已确认";
      case "PENDING": return "待确认";
      case "COMPLETED": return "已完成";
      case "CANCELLED": return "已取消";
      default: return status;
    }
  };

  const getStatusClass = (status: string) => {
    switch (status) {
      case "CONFIRMED": return "dashboard__status--confirmed";
      case "PENDING": return "dashboard__status--pending";
      case "COMPLETED": return "dashboard__status--completed";
      case "CANCELLED": return "dashboard__status--cancelled";
      default: return "";
    }
  };

  return (
    <View className="dashboard">
      <View className="dashboard__tabs">
        <View
          className={`dashboard__tab ${tab === "upcoming" ? "dashboard__tab--active" : ""}`}
          hoverClass="dashboard__tab--hover"
          onClick={() => setTab("upcoming")}
        >
          即将开始（{upcomingBookings.length}）
        </View>
        <View
          className={`dashboard__tab ${tab === "past" ? "dashboard__tab--active" : ""}`}
          hoverClass="dashboard__tab--hover"
          onClick={() => setTab("past")}
        >
          历史记录（{pastBookings.length}）
        </View>
      </View>

      {loading ? (
        <View className="dashboard__loading">
          {[1, 2, 3].map((i) => (
            <View key={i} className="dashboard__skeleton" />
          ))}
        </View>
      ) : displayBookings.length === 0 ? (
        <View className="dashboard__empty">
          <Text className="dashboard__empty-icon">
            {tab === "upcoming" ? "📅" : "📋"}
          </Text>
          <Text className="dashboard__empty-text">
            {tab === "upcoming"
              ? "暂无即将开始的预约"
              : "暂无历史预约"}
          </Text>
          <Text className="dashboard__empty-hint">
            {tab === "upcoming"
              ? "去发现专家并预约第一场咨询"
              : "已完成的咨询会显示在这里"}
          </Text>
          {tab === "upcoming" && (
            <View
              className="dashboard__discover-btn"
              hoverClass="dashboard__discover-btn--hover"
              onClick={() => Taro.switchTab({ url: "/pages/discover/index" })}
            >
              去发现专家
            </View>
          )}
        </View>
      ) : (
        <View className="dashboard__list">
          {displayBookings.map((booking) => {
            const expertName =
              booking.expert.user.nickName ??
              booking.expert.user.name ??
              "专家";
            return (
              <View
                key={booking.id}
                className="dashboard__card"
                hoverClass="dashboard__card--hover"
                onClick={() =>
                  Taro.navigateTo({
                    url: `/pages/expert/index?id=${booking.expertId}`,
                  })
                }
              >
                <View className="dashboard__card-header">
                  <View className="dashboard__card-avatar">
                    {expertName.charAt(0).toUpperCase()}
                  </View>
                  <View className="dashboard__card-info">
                    <Text className="dashboard__card-name">{expertName}</Text>
                    <Text className="dashboard__card-time">
                      {formatDateTime(booking.startTime, booking.timezone)}
                    </Text>
                  </View>
                  <View className={`dashboard__status ${getStatusClass(booking.status)}`}>
                    {getStatusLabel(booking.status)}
                  </View>
                </View>

                <View className="dashboard__card-details">
                  <Text className="dashboard__card-type">
                    {booking.sessionType === "OFFLINE" ? "📍 线下" : "🖥 线上"}
                  </Text>
                  {booking.depositAmountCents && (
                    <Text className="dashboard__card-deposit">
                      订金 {booking.currency} {(booking.depositAmountCents / 100).toFixed(2)}
                    </Text>
                  )}
                </View>

                {booking.meetingLink && (
                  <View
                    className="dashboard__card-link"
                    onClick={(e) => {
                      e.stopPropagation();
                      Taro.setClipboardData({
                        data: booking.meetingLink!,
                        success: () =>
                          Taro.showToast({ title: "链接已复制", icon: "success" }),
                      });
                    }}
                  >
                    <Text className="dashboard__card-link-label">会议链接</Text>
                    <Text className="dashboard__card-link-action">复制</Text>
                  </View>
                )}

                {booking.offlineAddress && (
                  <View className="dashboard__card-link">
                    <Text className="dashboard__card-link-label">📍 {booking.offlineAddress}</Text>
                  </View>
                )}

                {(booking.status === "CONFIRMED" || booking.status === "PENDING") && (() => {
                  const msUntil = new Date(booking.startTime).getTime() - Date.now();
                  const canRescheduleCancel = msUntil >= 2 * 60 * 60 * 1000;
                  if (!canRescheduleCancel) return (
                    <View className="dashboard__card-hint">
                      <Text>距离开始不足 2 小时，暂不可修改</Text>
                    </View>
                  );
                  return (
                    <View className="dashboard__card-actions">
                      {booking.status === "CONFIRMED" && (
                        <View
                          className="dashboard__action-btn dashboard__action-btn--secondary"
                          hoverClass="dashboard__action-btn--hover"
                          onClick={(e) => {
                            e.stopPropagation();
                            Taro.navigateTo({
                              url: `/pages/book/index?id=${booking.expertId}&type=${booking.sessionType}&rescheduleId=${booking.id}`,
                            });
                          }}
                        >
                          改期
                        </View>
                      )}
                      <View
                        className="dashboard__action-btn dashboard__action-btn--danger"
                        hoverClass="dashboard__action-btn--hover"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleCancel(booking.id);
                        }}
                      >
                        取消
                      </View>
                    </View>
                  );
                })()}
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}
