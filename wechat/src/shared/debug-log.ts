import Taro from "@tarojs/taro";

import { getApiBase } from "./auth";

/** Set TARO_APP_CLIENT_LOG=1 at build time and WECHAT_CLIENT_LOG=1 on the backend to forward selected client logs. */
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
