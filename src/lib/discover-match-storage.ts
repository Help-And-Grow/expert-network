/**
 * Persisted discover / match concierge state (web: sessionStorage).
 * Telegram Mini App opens `/discover` in an in-app WebView — same origin and sessionStorage as web.
 *
 * WeChat Mini Program uses the same `DISCOVER_MATCH_STORAGE_KEY` string in
 * `wechat/src/shared/discover-match-storage.ts` with Taro storage (keep keys in sync).
 */
export const DISCOVER_MATCH_STORAGE_KEY = "hg-discover-match-chat-v1";

export type DiscoverMatchRecommendation = {
  expertId: string;
  name: string;
  reason: string;
  sessionTypes: string[];
};

export type DiscoverMatchChatMessage = {
  role: "user" | "assistant";
  content?: string;
  recommendations?: DiscoverMatchRecommendation[];
  noMatchMessage?: string;
};

export type DiscoverMatchPersistedState = {
  chatMessages: DiscoverMatchChatMessage[];
  /** Free-text input (web only; WeChat may omit). */
  chatInput: string;
};

export function discoverMatchMessagesToApiHistory(
  messages: DiscoverMatchChatMessage[],
): { role: "user" | "assistant"; content: string }[] {
  return messages
    .filter(
      (m) =>
        m.role === "user" ||
        (m.role === "assistant" &&
          (Boolean(m.content) || Boolean(m.recommendations?.length) || Boolean(m.noMatchMessage))),
    )
    .map((m) => ({
      role: m.role,
      content:
        m.role === "user"
          ? m.content ?? ""
          : m.recommendations?.length
            ? `Recommended: ${m.recommendations.map((r) => r.name).join(", ")}`
            : m.noMatchMessage ?? "",
    }));
}

export function loadDiscoverMatchFromSessionStorage(): DiscoverMatchPersistedState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(DISCOVER_MATCH_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<DiscoverMatchPersistedState>;
    if (!Array.isArray(parsed.chatMessages) || typeof parsed.chatInput !== "string") return null;
    return { chatMessages: parsed.chatMessages, chatInput: parsed.chatInput };
  } catch {
    return null;
  }
}

export function saveDiscoverMatchToSessionStorage(state: DiscoverMatchPersistedState): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(DISCOVER_MATCH_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // quota or private mode
  }
}
