import Taro from "@tarojs/taro";
import type { AuthUser } from "./types";

const TOKEN_KEY = "wechat_token";
const USER_KEY = "wechat_user";

export function getToken(): string | null {
  return Taro.getStorageSync(TOKEN_KEY) || null;
}

export function setToken(token: string) {
  Taro.setStorageSync(TOKEN_KEY, token);
}

export function getUser(): AuthUser | null {
  const raw = Taro.getStorageSync(USER_KEY);
  if (!raw) return null;
  try {
    return typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    return null;
  }
}

export function setUser(user: AuthUser) {
  Taro.setStorageSync(USER_KEY, JSON.stringify(user));
}

export function clearAuth() {
  Taro.removeStorageSync(TOKEN_KEY);
  Taro.removeStorageSync(USER_KEY);
}

export function isLoggedIn(): boolean {
  return !!getToken();
}

export async function wxLogin(): Promise<{ token: string; user: AuthUser }> {
  const { code } = await Taro.login();

  let nickName: string | undefined;
  let avatarUrl: string | undefined;

  try {
    const setting = await Taro.getSetting();
    if (setting.authSetting["scope.userInfo"]) {
      const profile = await Taro.getUserProfile({
        desc: "用于完善你的个人主页信息",
      });
      nickName = profile.userInfo.nickName;
      avatarUrl = profile.userInfo.avatarUrl;
    }
  } catch {
    // User denied or API not available
  }

  const API_BASE = getApiBase();
  const res = await Taro.request({
    url: `${API_BASE}/api/auth/wechat`,
    method: "POST",
    header: { "Content-Type": "application/json" },
    data: { code, nickName, avatarUrl },
  });

  if (res.statusCode !== 200 || !(res.data as Record<string, unknown>)["token"]) {
    throw new Error((res.data as Record<string, string>)["error"] || "登录失败");
  }

  const data = res.data as { token: string; user: AuthUser };
  setToken(data.token);
  setUser(data.user);

  return { token: data.token, user: data.user };
}

export function getApiBase(): string {
  return process.env.TARO_APP_API_BASE || "https://expert-network.vercel.app";
}
