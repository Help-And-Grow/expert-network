import Taro from "@tarojs/taro";

import type { MatchRecommendation } from "./types";

/** Must match `DISCOVER_MATCH_STORAGE_KEY` in `src/lib/discover-match-storage.ts` (Next.js web). */
export const DISCOVER_MATCH_STORAGE_KEY = "hg-discover-match-chat-v1";

export type DiscoverMatchChatMessage = {
  role: "user" | "assistant";
  content?: string;
  recommendations?: MatchRecommendation[];
  noMatchMessage?: string;
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

function parseStored(raw: unknown): DiscoverMatchChatMessage[] | null {
  if (raw == null || raw === "") return null;
  try {
    if (typeof raw === "object" && raw !== null && "chatMessages" in raw) {
      const cm = (raw as { chatMessages: unknown }).chatMessages;
      return Array.isArray(cm) ? (cm as DiscoverMatchChatMessage[]) : null;
    }
    if (typeof raw === "string") {
      const parsed = JSON.parse(raw) as { chatMessages?: unknown };
      if (!Array.isArray(parsed.chatMessages)) return null;
      return parsed.chatMessages as DiscoverMatchChatMessage[];
    }
    return null;
  } catch {
    return null;
  }
}

export function loadDiscoverMatchFromWeChatStorage(): DiscoverMatchChatMessage[] | null {
  try {
    return parseStored(Taro.getStorageSync(DISCOVER_MATCH_STORAGE_KEY));
  } catch {
    return null;
  }
}

export function saveDiscoverMatchToWeChatStorage(chatMessages: DiscoverMatchChatMessage[]): void {
  try {
    Taro.setStorageSync(DISCOVER_MATCH_STORAGE_KEY, JSON.stringify({ chatMessages }));
  } catch {
    // quota
  }
}
