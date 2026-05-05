import Taro from "@tarojs/taro";
import type { AuthUser } from "./types";

const TOKEN_KEY = "wechat_token";
const USER_KEY = "wechat_user";
/**
 * Default API origin when `TARO_APP_API_BASE` is not provided at build time.
 * Points at Vercel — the intl Mini Program shares Web's stack (no Tencent
 * infra on the production path, see docs/design-docs/architecture.md §1).
 *
 * The future mainland-CN MP will set `TARO_APP_API_BASE` to its CloudBase
 * URL at build time and never fall through to this default.
 */
const DEFAULT_API_BASE = "https://www.help-and-grow.com";

function withTimeout<T>(promise: Promise<T>, label: string, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

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
  const { code } = await withTimeout(Taro.login(), "wx.login", 12_000);
  if (!code) {
    throw new Error("wx.login did not return a code");
  }

  let nickName: string | undefined;
  let avatarUrl: string | undefined;

  try {
    const setting = await withTimeout(Taro.getSetting(), "wx.getSetting", 6_000);
    if (setting.authSetting["scope.userInfo"]) {
      const profile = await withTimeout(
        Taro.getUserProfile({
          desc: "用于完善你的个人主页信息",
        }),
        "wx.getUserProfile",
        10_000,
      );
      nickName = profile.userInfo.nickName;
      avatarUrl = profile.userInfo.avatarUrl;
    }
  } catch {
    // User denied or API not available
  }

  const API_BASE = getApiBase();
  const res = await withTimeout(
    Taro.request({
      url: `${API_BASE}/api/auth/wechat`,
      method: "POST",
      header: { "Content-Type": "application/json" },
      data: { code, nickName, avatarUrl },
      timeout: 15_000,
    }),
    "POST /api/auth/wechat",
    20_000,
  );

  if (res.statusCode !== 200 || !(res.data as Record<string, unknown>)["token"]) {
    throw new Error((res.data as Record<string, string>)["error"] || "登录失败");
  }

  const data = res.data as { token: string; user: AuthUser };
  setToken(data.token);
  setUser(data.user);

  return { token: data.token, user: data.user };
}

export function getApiBase(): string {
  return process.env.TARO_APP_API_BASE || DEFAULT_API_BASE;
}

/**
 * Returns the regional stack this WeChat MP build is bound to. Set at build
 * time by `scripts/build-region.mjs` (`npm run build:weapp:cn|intl`).
 *
 * - `cn`   → future mainland China stack
 * - `intl` → current international stack on Tencent CloudBase + Hunyuan
 *
 * Surfaced to support so issues can be routed to the right database without
 * guessing which stack a user is on.
 */
export function getRegion(): "cn" | "intl" | "unknown" {
  const v = (process.env.TARO_APP_REGION || "").toLowerCase();
  return v === "cn" || v === "intl" ? v : "unknown";
}
