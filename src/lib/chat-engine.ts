import { env } from "@/lib/env";
import { resolveAIProvider } from "@/lib/ai";
import { buildExpertFocusLabel, stringifyServicesOffered } from "@/lib/expert-topics";
import { searchExpertMemories } from "@/lib/integrations/mem9-lifecycle";
import { prisma } from "@/lib/prisma";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ExpertRecommendation {
  expertId: string;
  name: string;
  summary?: string;
  reason: string;
  sessionTypes: string[];
  profileUrl: string;
  bookUrl: string;
  priceLabel: string | null;
}

export interface ChatResponse {
  reply: string;
  experts: ExpertRecommendation[];
}

const APP_BASE_URL =
  env.NEXTAUTH_URL || "https://expert-network.vercel.app";

type ChatContext = {
  /** Optional incoming request — enables region-aware AI provider routing. */
  request?: { headers: { get(name: string): string | null } } | null;
};

/**
 * Platform-agnostic chat engine.
 * Accepts a user message + optional conversation history, returns a natural
 * language reply with expert recommendations when relevant.
 *
 * Designed to be called from any integration: Telegram, WeChat, WhatsApp, API.
 *
 * Pass `{ request }` from the route handler to drive `resolveAIProvider`'s
 * per-surface routing:
 *   - WeChat-originated requests → Hunyuan
 *   - Everything else (Web, Telegram, REST) → Qwen primary → Gemini fallback
 *
 * The `platform` parameter is kept for telemetry / future per-platform tuning
 * but no longer changes the provider chain — both Web and Telegram now share
 * the same Qwen→Gemini chain (see architecture.md §3.2).
 */
export async function chat(
  message: string,
  history: ChatMessage[] = [],
  platform?: string,
  ctx: ChatContext = {},
): Promise<ChatResponse> {
  const allExperts = await prisma.expert.findMany({
    where: { isPublished: true },
    include: {
      user: { select: { nickName: true, name: true } },
    },
  });

  if (allExperts.length === 0) {
    return {
      reply:
        "We don't have any published profiles yet. Please check back later!",
      experts: [],
    };
  }

  const memoryResults = await Promise.all(
    allExperts.map((e) =>
      searchExpertMemories(e.id, message, 3).catch(() => [] as string[])
    )
  );

  const expertSummaries = allExperts
    .map((e, i) => {
      const minPrice = Math.min(
        e.priceOnlineCents || Infinity,
        e.priceOfflineCents || Infinity
      );
      const priceStr =
        minPrice < Infinity
          ? `From ${e.currency} ${(minPrice / 100).toFixed(0)}/hr`
          : "Price not set";
      const focus = buildExpertFocusLabel(e) ?? "General professional support";
      const services = stringifyServicesOffered(e.servicesOffered) || "(none)";
      const base = `ID: ${e.id}\nName: ${e.user.nickName ?? e.user.name ?? "Unknown"}\nFocus: ${focus}\nSession types: ${e.sessionType}\nPrice: ${priceStr}\nBio: ${e.bio ?? "(none)"}\nServices: ${services}`;
      const memories = memoryResults[i];
      if (memories.length > 0) {
        return `${base}\nAgent Memory: ${memories.join("; ")}`;
      }
      return base;
    })
    .join("\n\n---\n\n");

  const historyMapped = history.map((m) => ({ role: m.role, content: m.content }));
  const ai = await resolveAIProvider({ request: ctx.request });
  // `ai` is a chain wrapper; matchExperts will fall back from Qwen → Gemini
  // on Web/Telegram, or run Hunyuan-only on WeChat surfaces.
  void platform; // reserved for future per-platform telemetry; routing is
                  // already determined by the resolved chain.
  const aiResult = await ai.matchExperts(message, expertSummaries, historyMapped);

  const experts: ExpertRecommendation[] = aiResult.recommendations.map(
    (rec) => {
      const expert = allExperts.find((e) => e.id === rec.expertId);
      const minPrice = expert
        ? Math.min(
            expert.priceOnlineCents || Infinity,
            expert.priceOfflineCents || Infinity
          )
        : Infinity;
      const bio = expert?.bio?.trim();
      const summary = bio
        ? bio.length <= 180
          ? bio
          : `${bio.slice(0, 179).trimEnd()}…`
        : undefined;
      return {
        expertId: rec.expertId,
        name: rec.name,
        summary,
        reason: rec.reason,
        sessionTypes: rec.sessionTypes,
        profileUrl: `${APP_BASE_URL}/experts/${rec.expertId}`,
        bookUrl: `${APP_BASE_URL}/experts/${rec.expertId}/book`,
        priceLabel:
          minPrice < Infinity
            ? `From ${expert?.currency || "SGD"} ${(minPrice / 100).toFixed(0)}/hr`
            : null,
      };
    }
  );

  let reply: string;
  if (experts.length > 0) {
    const lines = experts.map(
      (e, i) =>
        `${i + 1}. **${e.name}**${e.priceLabel ? ` (${e.priceLabel})` : ""}\n   ${e.reason}`
    );
    reply = `Here are the experts I'd recommend:\n\n${lines.join("\n\n")}`;
  } else {
    reply =
      aiResult.noMatchMessage ||
      "I couldn't find a perfect match right now. Could you describe what you're looking for in more detail?";
  }

  return { reply, experts };
}
