import { View, Text } from "@tarojs/components";
import Taro, { useLoad, useDidShow } from "@tarojs/taro";
import { useCallback, useState } from "react";

import { get, post } from "../../shared/api";
import "./index.scss";

type Plan = {
  id: string;
  tier: "BASIC" | "PRO";
  cycle: "monthly" | "yearly";
  durationDays: number;
  priceMinor: number;
  currency: "CNY" | "HKD" | "USD";
  label: string;
  description: string;
};

type StatusResponse = {
  active: boolean;
  tier: "NONE" | "BASIC" | "PRO";
  membershipUntil: string | null;
  plans: Plan[];
};

type SubscribeResponse = {
  outTradeNo: string;
  paymentParams: {
    timeStamp: string;
    nonceStr: string;
    package: string;
    signType: "RSA";
    paySign: string;
  };
};

function formatYuan(minor: number): string {
  // CNY priceMinor is in fen — divide by 100 for ¥.
  return (minor / 100).toLocaleString("zh-CN", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

function formatUntil(iso: string | null): string {
  if (!iso) return "尚未开通";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "尚未开通";
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export default function MembershipPage() {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyPlanId, setBusyPlanId] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await get<StatusResponse>("/api/membership/status");
      if (res.statusCode === 200) {
        setStatus(res.data);
      } else {
        setError("加载会员信息失败，请重试");
      }
    } catch {
      setError("网络异常，请稍后再试");
    } finally {
      setLoading(false);
    }
  }, []);

  useLoad(() => {
    fetchStatus();
  });

  useDidShow(() => {
    fetchStatus();
  });

  const handleSubscribe = useCallback(
    async (plan: Plan) => {
      if (busyPlanId) return;
      setBusyPlanId(plan.id);
      setError(null);

      try {
        const orderRes = await post<SubscribeResponse>("/api/membership/subscribe", {
          planId: plan.id,
        });

        if (orderRes.statusCode !== 200) {
          const data = orderRes.data as { error?: string } | null;
          setError(data?.error ?? "下单失败，请重试");
          return;
        }

        const { paymentParams } = orderRes.data;

        await new Promise<void>((resolve, reject) => {
          Taro.requestPayment({
            timeStamp: paymentParams.timeStamp,
            nonceStr: paymentParams.nonceStr,
            package: paymentParams.package,
            signType: paymentParams.signType,
            paySign: paymentParams.paySign,
            success: () => resolve(),
            fail: (err) => reject(err),
          });
        });

        Taro.showToast({ title: "支付成功", icon: "success", duration: 1500 });
        // The webhook extends membershipUntil — re-fetch after a short delay
        // so the UI catches up with the server.
        setTimeout(() => {
          fetchStatus();
        }, 1500);
      } catch (err) {
        const fail = err as { errMsg?: string } | undefined;
        const msg = fail?.errMsg ?? "";
        if (msg.includes("cancel")) {
          // User cancelled — silent.
        } else {
          setError(msg || "支付未完成");
        }
      } finally {
        setBusyPlanId(null);
      }
    },
    [busyPlanId, fetchStatus],
  );

  if (loading && !status) {
    return (
      <View className="membership-page">
        <View className="loading-state">加载中…</View>
      </View>
    );
  }

  return (
    <View className="membership-page">
      <View className="status-card">
        <Text className="status-tier">当前等级 · {status?.tier ?? "NONE"}</Text>
        <Text
          className={`status-headline ${status?.active ? "active" : "inactive"}`}
        >
          {status?.active ? "会员有效" : "未开通会员"}
        </Text>
        <Text className="status-until">
          {status?.active
            ? `到期日 ${formatUntil(status.membershipUntil ?? null)}`
            : "开通后可使用高清直播咨询"}
        </Text>
      </View>

      {error && <View className="error-banner">{error}</View>}

      <Text className="section-title">选择套餐</Text>

      <View className="plan-list">
        {status?.plans.map((plan) => {
          const isPro = plan.tier === "PRO";
          const busy = busyPlanId === plan.id;
          return (
            <View
              key={plan.id}
              className={`plan-card${isPro ? " pro" : ""}`}
            >
              <View className="plan-row">
                <Text className="plan-label">{plan.label}</Text>
                <Text className={`plan-price${isPro ? " pro" : ""}`}>
                  ¥{formatYuan(plan.priceMinor)}
                </Text>
              </View>
              <Text className="plan-desc">{plan.description}</Text>
              <View
                className={`plan-button${busy ? " disabled" : ""}`}
                hoverClass="plan-button--hover"
                onClick={() => handleSubscribe(plan)}
              >
                {busy
                  ? "处理中…"
                  : status?.active
                    ? plan.cycle === "monthly"
                      ? "续费 1 个月"
                      : "续费 1 年"
                    : plan.cycle === "monthly"
                      ? "开通 1 个月"
                      : "开通 1 年"}
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
}
