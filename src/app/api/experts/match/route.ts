import { type NextRequest, NextResponse } from "next/server";

import { resolveAIProvider } from "@/lib/ai";
import type { NormalizedQuery } from "@/lib/ai";
import {
  buildExpertFocusLabel,
  buildExpertSearchText,
  stringifyServicesOffered,
} from "@/lib/expert-topics";
import { searchExpertMemories } from "@/lib/integrations/mem9-lifecycle";
import { prisma } from "@/lib/prisma";
import { resolveUserId } from "@/lib/request-auth";

type MatchExpertRow = {
  id: string;
  bio: string | null;
  sessionType: string;
  servicesOffered: unknown;
  userId: string;
  user: { nickName: string | null; name: string | null };
  reviewCount: number;
  avgRating: number;
};

const SUMMARY_MAX_CHARS = 180;

function buildExpertSummary(expert: MatchExpertRow): string {
  const bio = expert.bio?.trim();
  if (bio) {
    if (bio.length <= SUMMARY_MAX_CHARS) return bio;
    return `${bio.slice(0, SUMMARY_MAX_CHARS - 1).trimEnd()}…`;
  }
  const focus = buildExpertFocusLabel(expert);
  if (focus) return `Offers ${focus}.`;
  const services = stringifyServicesOffered(expert.servicesOffered);
  if (services) return `Services: ${services}`;
  return "Active expert on Help & Grow.";
}

function buildKeywordReason(
  expert: MatchExpertRow,
  matchedTerms: string[],
  query: string,
): string {
  const focus = buildExpertFocusLabel(expert);
  const name = expert.user.nickName ?? expert.user.name ?? "This expert";
  const terms = matchedTerms.slice(0, 3).join(", ");
  if (terms && focus) {
    return `${name}'s profile mentions "${terms}" — focused on ${focus}, which is relevant to "${query}".`;
  }
  if (focus) {
    return `${name} focuses on ${focus} — relevant to "${query}".`;
  }
  if (terms) {
    return `${name}'s profile mentions "${terms}", relevant to "${query}".`;
  }
  return `${name} is a published expert whose profile aligns with "${query}".`;
}

function keywordMatch(nq: NormalizedQuery, experts: MatchExpertRow[]) {
  const allTerms = [
    nq.english.toLowerCase(),
    ...nq.keywords.map((k) => k.toLowerCase()),
    nq.original.toLowerCase(),
  ];
  const words = [...new Set(allTerms.flatMap((t) => t.split(/\s+/)).filter((w) => w.length >= 2))];

  const scored = experts
    .map((e) => {
      let score = 0;
      const matched: string[] = [];
      const bio = (e.bio ?? "").toLowerCase();
      const name = (e.user.nickName ?? e.user.name ?? "").toLowerCase();
      const services = stringifyServicesOffered(e.servicesOffered).toLowerCase();
      const haystack = buildExpertSearchText({
        name: e.user.name,
        nickName: e.user.nickName,
        bio: e.bio,
        servicesOffered: e.servicesOffered,
      });

      for (const w of words) {
        let hit = false;
        if (services.includes(w)) {
          score += 3;
          hit = true;
        }
        if (bio.includes(w)) {
          score += 2;
          hit = true;
        }
        if (name.includes(w)) {
          score += 1;
          hit = true;
        }
        if (hit) matched.push(w);
      }
      if (haystack.includes(nq.original.toLowerCase())) score += 2;

      return { expert: e, score, matched };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  if (scored.length === 0) {
    return {
      recommendations: [] as {
        expertId: string;
        name: string;
        summary?: string;
        reason: string;
        sessionTypes: string[];
      }[],
    };
  }

  const queryLabel = nq.original || nq.english;
  return {
    recommendations: scored.map((r) => ({
      expertId: r.expert.id,
      name: r.expert.user.nickName ?? r.expert.user.name ?? "Expert",
      summary: buildExpertSummary(r.expert),
      reason: buildKeywordReason(r.expert, r.matched, queryLabel),
      sessionTypes: [r.expert.sessionType],
    })),
  };
}

function exploratoryFallback(experts: MatchExpertRow[]) {
  const top = [...experts]
    .sort(
      (a, b) =>
        b.reviewCount - a.reviewCount ||
        (b.avgRating ?? 0) - (a.avgRating ?? 0)
    )
    .slice(0, 3);

  return {
    recommendations: top.map((e) => {
      const focus = buildExpertFocusLabel(e);
      const name = e.user.nickName ?? e.user.name ?? "Expert";
      return {
        expertId: e.id,
        name,
        summary: buildExpertSummary(e),
        reason: focus
          ? `${name} focuses on ${focus}. Add more detail to your search for a tighter match.`
          : `${name} is an active expert on Help & Grow. Add more detail to your search for a tighter match.`,
        sessionTypes: [e.sessionType],
      };
    }),
    noMatchMessage:
      "Your search was very broad. Here are some active experts \u2014 try adding a specific goal for a better match.",
  };
}

export async function POST(request: NextRequest) {
  try {
    const viewerUserId = await resolveUserId(request).catch(() => null);
    const body = await request.json().catch(() => ({}));
    if (typeof body !== "object" || body === null) {
      return NextResponse.json(
        { error: "Invalid request body" },
        { status: 400 }
      );
    }

    const query = typeof body.query === "string" ? body.query.trim() : "";
    if (!query) {
      return NextResponse.json(
        { error: "query is required" },
        { status: 400 }
      );
    }

    const history = Array.isArray(body.history)
      ? (body.history as { role: string; content: string }[]).filter(
          (m) =>
            typeof m === "object" &&
            m !== null &&
            typeof m.role === "string" &&
            typeof m.content === "string"
        )
      : [];

    // Region-aware provider: WeChat-originated traffic uses the WECHAT_AI_PROVIDER
    // (default Qwen) so inference stays inside the GFW; everything else uses the
    // global default (Gemini).
    const ai = await resolveAIProvider({ request });

    // Step 1: Normalize query (translate, expand, classify intent) via LLM
    let nq: NormalizedQuery;
    try {
      nq = await ai.normalizeQuery(query);
      console.log("[experts/match] normalized:", JSON.stringify(nq));
    } catch (err) {
      console.warn("[experts/match] normalizeQuery failed, using raw:", err);
      nq = { english: query, keywords: [], intent: "specific_topic", original: query };
    }

    // Step 2: Fetch expert pool
    const experts = await prisma.expert.findMany({
      where: {
        isPublished: true,
        ...(viewerUserId ? { userId: { not: viewerUserId } } : {}),
      },
      include: {
        user: { select: { nickName: true, name: true } },
      },
    });

    if (experts.length === 0) {
      return NextResponse.json({
        recommendations: [],
        noMatchMessage: "No experts are available at the moment. Please check back later.",
      });
    }

    // Step 3: Enrich summaries with mem9
    const memoryResults = await Promise.all(
      experts.map((e) =>
        searchExpertMemories(e.id, nq.english || query, 3).catch(() => [] as string[])
      )
    );

    const expertSummaries = experts
      .map((e, i) => {
        const base = `ID: ${e.id}\nName: ${e.user.nickName ?? e.user.name ?? "Unknown"}\nFocus: ${buildExpertFocusLabel(e) ?? "General professional support"}\nSession types: ${e.sessionType}\nBio: ${e.bio ?? "(none)"}\nServices: ${stringifyServicesOffered(e.servicesOffered) || "(none)"}`;
        const memories = memoryResults[i];
        if (memories.length > 0) {
          return `${base}\nAgent Memory: ${memories.join("; ")}`;
        }
        return base;
      })
      .join("\n\n---\n\n");

    // Step 4: LLM match (with normalized context)
    const expertById = new Map(experts.map((e) => [e.id, e]));
    const enrichWithSummary = <
      R extends { expertId: string; summary?: string },
    >(
      recs: R[] | undefined,
    ): R[] | undefined =>
      recs?.map((rec) => {
        if (rec.summary) return rec;
        const expert = expertById.get(rec.expertId);
        return expert ? { ...rec, summary: buildExpertSummary(expert) } : rec;
      });

    try {
      const result = await ai.matchExperts(query, expertSummaries, history, nq);
      if ((result.recommendations?.length ?? 0) > 0) {
        return NextResponse.json({
          ...result,
          recommendations: enrichWithSummary(result.recommendations) ?? [],
        });
      }

      // Step 5: Keyword fallback using LLM-generated keywords
      const keyword = keywordMatch(nq, experts);
      if (keyword.recommendations.length > 0) {
        return NextResponse.json({
          recommendations: keyword.recommendations,
          noMatchMessage: result.noMatchMessage,
        });
      }

      // Step 6: Only show exploratory fallback for greetings/broad queries, not specific unmatched topics
      if (nq.intent === "greeting" || nq.intent === "broad_exploration") {
        return NextResponse.json(exploratoryFallback(experts));
      }

      return NextResponse.json({
        recommendations: [],
        noMatchMessage:
          result.noMatchMessage ??
          `No published expert currently matches "${nq.english}". Try a different topic or browse from the home page.`,
      });
    } catch (aiError) {
      console.error("[experts/match] AI matching failed, keyword fallback:", aiError);
      const fallback = keywordMatch(nq, experts);
      if (fallback.recommendations.length > 0) {
        return NextResponse.json(fallback);
      }
      if (nq.intent === "greeting" || nq.intent === "broad_exploration") {
        return NextResponse.json(exploratoryFallback(experts));
      }
      return NextResponse.json({
        recommendations: [],
        noMatchMessage: `No published expert currently matches "${nq.english}". Try a different topic or browse from the home page.`,
      });
    }
  } catch (error) {
    console.error("[experts/match POST]", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
