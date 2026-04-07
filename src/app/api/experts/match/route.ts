import { type NextRequest, NextResponse } from "next/server";

import { matchExperts } from "@/lib/ai";
import { domainStrings } from "@/lib/domains";
import { searchExpertMemories } from "@/lib/integrations/mem9-lifecycle";
import { prisma } from "@/lib/prisma";

/** Whole-query synonyms so short inputs like "AI" still match bios/domains (substring "ai" rarely appears in domain labels). */
const QUERY_EXPANSIONS: Record<string, string> = {
  ai: "artificial intelligence machine learning ml llm data science software technology product engineering neural deep learning nlp computer vision gpt genai llm automation 人工智能",
  ml: "machine learning artificial intelligence data deep learning neural llm",
  nlp: "natural language processing machine learning artificial intelligence llm text",
  llm: "large language model artificial intelligence machine learning gpt genai",
  gpt: "openai llm generative artificial intelligence machine learning",
  data: "data science analytics machine learning sql python bi engineering",
  bd: "business development marketing partnerships sales growth",
  growth: "growth marketing product strategy gtm revenue",
  legal: "law legal compliance contract incorporation lawyer",
  funding: "fundraising venture capital investment pitch deck startup",
  hr: "hiring recruitment talent headhunter people ops",
};

function expandQueryForKeyword(query: string): string {
  const t = query.trim();
  if (!t) return "";
  const lower = t.toLowerCase();
  const extra = QUERY_EXPANSIONS[lower];
  return extra ? `${t} ${extra}` : t;
}

type MatchExpertRow = {
  id: string;
  bio: string | null;
  sessionType: string;
  servicesOffered: unknown;
  domains: { domain: string }[];
  user: { nickName: string | null; name: string | null };
  reviewCount: number;
  avgRating: number;
};

function keywordMatch(query: string, experts: MatchExpertRow[]) {
  const expanded = expandQueryForKeyword(query);
  const q = expanded.toLowerCase();
  const words = q.split(/\s+/).filter((w) => w.length >= 2);

  const scored = experts
    .map((e) => {
      let score = 0;
      const domainStr = domainStrings(e.domains).join(" ").toLowerCase();
      const bio = (e.bio ?? "").toLowerCase();
      const name = (e.user.nickName ?? e.user.name ?? "").toLowerCase();
      const services = JSON.stringify(e.servicesOffered ?? []).toLowerCase();

      if (domainStr.includes(q) || words.some((w) => domainStr.includes(w))) score += 3;
      if (
        bio.includes(q) ||
        words.some((w) => w.length >= 2 && bio.includes(w))
      )
        score += 2;
      if (
        services.includes(q) ||
        words.some((w) => w.length >= 2 && services.includes(w))
      )
        score += 1;
      if (name.includes(q) || words.some((w) => w.length >= 2 && name.includes(w)))
        score += 1;

      return { expert: e, score };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  if (scored.length === 0) {
    return {
      recommendations: [],
      noMatchMessage:
        "I couldn't find a perfect match for your query. Try describing your specific challenge — e.g. 'I need help with BD in Southeast Asia' or 'Looking for legal advice on incorporation'.",
    };
  }

  return {
    recommendations: scored.map((r) => ({
      expertId: r.expert.id,
      name: r.expert.user.nickName ?? r.expert.user.name ?? "Expert",
      reason: `Matches your search based on their expertise in ${domainStrings(r.expert.domains).join(", ")}.`,
      sessionTypes: [r.expert.sessionType],
    })),
  };
}

/** When the model returns no rows but we have a published pool, show top experts by engagement. */
function exploratoryFallback(experts: MatchExpertRow[]) {
  const top = [...experts]
    .sort(
      (a, b) =>
        b.reviewCount - a.reviewCount ||
        (b.avgRating ?? 0) - (a.avgRating ?? 0)
    )
    .slice(0, 3);

  return {
    recommendations: top.map((e) => ({
      expertId: e.id,
      name: e.user.nickName ?? e.user.name ?? "Expert",
      reason: `Active expert on Help & Grow (${domainStrings(e.domains).join(", ") || "multiple areas"}). Add more detail to your search (e.g. industry or goal) for a tighter match.`,
      sessionTypes: [e.sessionType],
    })),
    noMatchMessage:
      "That search was very broad. Here are experts you can explore — try adding a specific goal (e.g. “AI recruiting tools” or “LLM product strategy”).",
  };
}

export async function POST(request: NextRequest) {
  try {
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

    const experts = await prisma.expert.findMany({
      where: { isPublished: true },
      include: {
        domains: true,
        user: {
          select: {
            nickName: true,
            name: true,
          },
        },
      },
    });

    if (experts.length === 0) {
      return NextResponse.json({
        recommendations: [],
        noMatchMessage: "No experts are available at the moment. Please check back later.",
      });
    }

    // Enrich each expert summary with relevant memories (in parallel)
    const memoryResults = await Promise.all(
      experts.map((e) =>
        searchExpertMemories(e.id, query, 3).catch(() => [] as string[])
      )
    );

    const expertSummaries = experts
      .map((e, i) => {
        const base = `ID: ${e.id}\nName: ${e.user.nickName ?? e.user.name ?? "Unknown"}\nDomains: ${domainStrings(e.domains).join(", ")}\nSession types: ${e.sessionType}\nBio: ${e.bio ?? "(none)"}\nServices: ${JSON.stringify(e.servicesOffered ?? [])}`;
        const memories = memoryResults[i];
        if (memories.length > 0) {
          return `${base}\nAgent Memory: ${memories.join("; ")}`;
        }
        return base;
      })
      .join("\n\n---\n\n");

    try {
      const result = await matchExperts(query, expertSummaries, history);
      const aiRecs = result.recommendations?.length ?? 0;
      if (aiRecs > 0) {
        return NextResponse.json(result);
      }

      const keyword = keywordMatch(query, experts);
      if (keyword.recommendations.length > 0) {
        return NextResponse.json({
          recommendations: keyword.recommendations,
          noMatchMessage: result.noMatchMessage ?? keyword.noMatchMessage,
        });
      }

      return NextResponse.json(exploratoryFallback(experts));
    } catch (aiError) {
      console.error("[experts/match] AI matching failed, falling back to keyword:", aiError);
      const fallback = keywordMatch(query, experts);
      if (fallback.recommendations.length > 0) {
        return NextResponse.json(fallback);
      }
      return NextResponse.json(exploratoryFallback(experts));
    }
  } catch (error) {
    console.error("[experts/match POST]", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
