import Taro from "@tarojs/taro";
import { getToken, getApiBase, wxLogin, isLoggedIn } from "./auth";

type Method = "GET" | "POST" | "PUT" | "DELETE" | "PATCH";

interface RequestOptions {
  url: string;
  method?: Method;
  data?: Record<string, unknown> | string;
  header?: Record<string, string>;
  skipAuth?: boolean;
}

interface ApiResponse<T = unknown> {
  data: T;
  statusCode: number;
}

async function ensureAuth(): Promise<string | null> {
  if (!isLoggedIn()) {
    try {
      const { token } = await wxLogin();
      return token;
    } catch (err) {
      console.error("[api] auto-login failed:", err);
      return null;
    }
  }
  return getToken();
}

export async function request<T = unknown>(
  options: RequestOptions
): Promise<ApiResponse<T>> {
  const API_BASE = getApiBase();
  const fullUrl = options.url.startsWith("http")
    ? options.url
    : `${API_BASE}${options.url}`;

  const header: Record<string, string> = {
    "Content-Type": "application/json",
    ...options.header,
  };

  if (!options.skipAuth) {
    const token = await ensureAuth();
    if (token) {
      header["x-wechat-token"] = token;
    }
  }

  const res = await Taro.request({
    url: fullUrl,
    method: options.method || "GET",
    data: options.data,
    header,
  });

  if (res.statusCode === 401) {
    try {
      const { token } = await wxLogin();
      header["x-wechat-token"] = token;
      const retryRes = await Taro.request({
        url: fullUrl,
        method: options.method || "GET",
        data: options.data,
        header,
      });
      return { data: retryRes.data as T, statusCode: retryRes.statusCode };
    } catch {
      Taro.showToast({ title: "登录状态失效，请重新登录", icon: "none" });
    }
  }

  return { data: res.data as T, statusCode: res.statusCode };
}

export function get<T = unknown>(url: string, params?: Record<string, string | number | undefined>) {
  let queryUrl = url;
  if (params) {
    const qs = Object.entries(params)
      .filter(([, v]) => v !== undefined && v !== "")
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
      .join("&");
    if (qs) queryUrl += `?${qs}`;
  }
  return request<T>({ url: queryUrl, method: "GET" });
}

export function post<T = unknown>(url: string, data?: Record<string, unknown>) {
  return request<T>({ url, method: "POST", data });
}

export function put<T = unknown>(url: string, data?: Record<string, unknown>) {
  return request<T>({ url, method: "PUT", data });
}

export function patch<T = unknown>(url: string, data?: Record<string, unknown>) {
  return request<T>({ url, method: "PATCH", data });
}

export function del<T = unknown>(url: string, data?: Record<string, unknown>) {
  return request<T>({ url, method: "DELETE", data });
}
