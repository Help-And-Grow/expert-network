import Taro from "@tarojs/taro";

import { getApiBase } from "./auth";

/** Set TARO_APP_CLIENT_LOG=1 in wechat/.env.* and WECHAT_CLIENT_LOG=1 on Vercel to see logs in Function logs. */
export function logToVercel(
  level: "info" | "warn" | "error",
  message: string,
  detail?: unknown,
): void {
  if (process.env.TARO_APP_CLIENT_LOG !== "1") return;
  const API_BASE = getApiBase();
  void Taro.request({
    url: `${API_BASE}/api/debug/wechat-client-log`,
    method: "POST",
    header: { "Content-Type": "application/json" },
    data: { level, message, detail },
    fail: () => {},
  });
}
