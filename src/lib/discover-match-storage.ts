/**
 * Persisted discover / match concierge state (web: sessionStorage).
 * Telegram Mini App opens `/discover` in an in-app WebView — same origin and sessionStorage as web.
 *
 * WeChat Mini Program uses the same `DISCOVER_MATCH_STORAGE_KEY` string in
 * `wechat/src/shared/discover-match-storage.ts` with Taro storage (keep keys in sync).
 */
/**
 * Bumped to v2 (2026-05-05) to clear legacy persisted state that contained
 * orphan "Sorry, something went wrong" error rows without the new
 * `transientError` flag. Existing chats are dropped on first load — users
 * see a clean Discover screen instead of a stale error bubble.
 */
export const DISCOVER_MATCH_STORAGE_KEY = "hg-discover-match-chat-v2";

export type DiscoverMatchRecommendation = {
  expertId: string;
  name: string;
  /** Short summary of the expert (bio snippet). Preferred for the card. */
  summary?: string;
  /** AI-generated rationale for why this expert matches the query. */
  reason: string;
  sessionTypes: string[];
};

export type DiscoverMatchChatMessage = {
  role: "user" | "assistant";
  content?: string;
  recommendations?: DiscoverMatchRecommendation[];
  noMatchMessage?: string;
  /**
   * Marks transient client-side error states (e.g. "Sorry, something went
   * wrong"). Filtered out before saving to sessionStorage so a one-shot
   * network blip doesn't leave the chat looking broken on the next
   * navigation.
   */
  transientError?: boolean;
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
    // Strip transient error rows + any trailing user message that didn't get a
    // (real) reply. That way a refresh after a network blip doesn't restore the
    // half-finished round-trip — the user starts clean instead of staring at a
    // standalone "Sorry" bubble.
    const cleaned = stripTransientTail(state.chatMessages);
    sessionStorage.setItem(
      DISCOVER_MATCH_STORAGE_KEY,
      JSON.stringify({ ...state, chatMessages: cleaned }),
    );
  } catch {
    // quota or private mode
  }
}

function stripTransientTail(
  messages: DiscoverMatchChatMessage[],
): DiscoverMatchChatMessage[] {
  const clone = messages.slice();
  while (clone.length > 0) {
    const last = clone[clone.length - 1];
    if (last.role === "assistant" && last.transientError) {
      // Drop the error reply.
      clone.pop();
      // …and the user prompt that triggered it (so the input round-trip is
      // fully erased from history).
      if (clone.length > 0 && clone[clone.length - 1].role === "user") {
        clone.pop();
      }
      continue;
    }
    break;
  }
  return clone;
}
