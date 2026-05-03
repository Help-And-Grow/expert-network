import { type NextRequest, NextResponse } from "next/server";

import { resolveAIProvider } from "@/lib/ai";
import type { NormalizedQuery } from "@/lib/ai";
import { buildLLMExpertContext } from "@/lib/expert-match-context";
import { rankExpertsBySemanticRelevance } from "@/lib/expert-match-search";
import { resolveExpertSearchRegion } from "@/lib/expert-search-region";
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
  /**
   * Expert's intro / "about me" memo recorded during onboarding (the script
   * the avatar narrates). Often richer than the bio because it's spoken-form
   * — included in matchExperts context so the LLM can ground reasoning in
   * the expert's own narrative.
   */
  avatarScript: string | null;
  sessionType: string;
  servicesOffered: unknown;
  userId: string;
  /** Social profile URLs help the LLM signal which platforms the expert publishes on. */
  linkedIn: string | null;
  twitter: string | null;
  substack: string | null;
  instagram: string | null;
  xiaohongshu: string | null;
  /** Filename of an uploaded resume / CV PDF. We don't include the binary contents in the LLM context (too large, base64-encoded), but knowing it exists is a relevance signal. */
  documentName: string | null;
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

/**
 * English stop words + filler verbs that show up in question phrasing but
 * carry no expertise signal. The keyword fallback used to count "is", "with",
 * "familiar", "looking" as matches, so any bio that contained "I am familiar
 * with X" trivially scored — producing reasons like "profile mentions
 * 'familiar, with'" with zero relevance to what the user asked. Filter them
 * out before scoring so only meaningful tokens survive.
 *
 * Not exhaustive — the goal is high-precision matches in the fallback path,
 * not sophisticated NLP. The LLM matcher does the actual semantic work.
 */
const STOP_WORDS = new Set([
  // articles, prepositions, pronouns
  "a",
  "an",
  "the",
  "of",
  "to",
  "in",
  "on",
  "at",
  "by",
  "for",
  "with",
  "from",
  "as",
  "is",
  "am",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "do",
  "does",
  "did",
  "have",
  "has",
  "had",
  "this",
  "that",
  "these",
  "those",
  "it",
  "its",
  "i",
  "we",
  "you",
  "he",
  "she",
  "they",
  "them",
  "his",
  "her",
  "their",
  "my",
  "our",
  "your",
  "if",
  "or",
  "and",
  "but",
  "not",
  "no",
  // question fillers + generic intent verbs
  "what",
  "who",
  "when",
  "where",
  "why",
  "how",
  "which",
  "whom",
  "looking",
  "want",
  "need",
  "needing",
  "wanting",
  "find",
  "finding",
  "help",
  "helping",
  "get",
  "getting",
  "can",
  "could",
  "should",
  "would",
  "will",
  "may",
  "might",
  "must",
  "let",
  "lets",
  "show",
  "tell",
  "give",
  "make",
  "use",
  "do",
  "does",
  "doing",
  // generic role nouns
  "someone",
  "anyone",
  "anybody",
  "everyone",
  "everybody",
  "person",
  "people",
  "expert",
  "experts",
  "coach",
  "mentor",
  "advisor",
  "consultant",
  "specialist",
  // hedging / common adjectives
  "good",
  "great",
  "best",
  "really",
  "very",
  "just",
  "also",
  "more",
  "most",
  "any",
  "some",
  "all",
  "much",
  "many",
  "few",
  // Help & Grow vocabulary that every published expert mentions
  "help",
  "grow",
  "growth",
  "session",
  "meetup",
  "online",
  "offline",
  "familiar",
  "professional",
  "professionals",
]);

const MIN_KEYWORD_LENGTH = 3;

function isMeaningfulKeyword(word: string): boolean {
  return word.length >= MIN_KEYWORD_LENGTH && !STOP_WORDS.has(word);
}

function keywordMatch(nq: NormalizedQuery, experts: MatchExpertRow[]) {
  const allTerms = [
    nq.english.toLowerCase(),
    ...nq.keywords.map((k) => k.toLowerCase()),
    nq.original.toLowerCase(),
  ];
  const words = [
    ...new Set(
      allTerms.flatMap((t) => t.split(/\s+/)).filter(isMeaningfulKeyword),
    ),
  ];

  // No meaningful tokens left after stop-word filtering → can't fall back.
  // (Returning empty here lets the route show the LLM's noMatchMessage
  // instead of fabricating matches on stop words.)
  if (words.length === 0) {
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

  const scored = experts
    .map((e) => {
      let score = 0;
      const matched: string[] = [];
      const bio = (e.bio ?? "").toLowerCase();
      const name = (e.user.nickName ?? e.user.name ?? "").toLowerCase();
      const services = stringifyServicesOffered(
        e.servicesOffered,
      ).toLowerCase();
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
    // Require score >= 3 (one services hit, or two bio hits) — single weak
    // bio match isn't enough signal for a confident recommendation.
    .filter((r) => r.score >= 3)
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
        (b.avgRating ?? 0) - (a.avgRating ?? 0),
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
        { status: 400 },
      );
    }

    const query = typeof body.query === "string" ? body.query.trim() : "";
    if (!query) {
      return NextResponse.json({ error: "query is required" }, { status: 400 });
    }

    const history = Array.isArray(body.history)
      ? (body.history as { role: string; content: string }[]).filter(
          (m) =>
            typeof m === "object" &&
            m !== null &&
            typeof m.role === "string" &&
            typeof m.content === "string",
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
      nq = {
        english: query,
        keywords: [],
        intent: "specific_topic",
        original: query,
      };
    }

    // Step 2: Fetch expert pool. Semantic vector pre-rank is opt-in via
    // EXPERT_SEARCH_VECTOR_PRERANK; otherwise this stays on the legacy pool.
    const region = resolveExpertSearchRegion(request);
    const semanticRank = await rankExpertsBySemanticRelevance(
      nq.english || query,
      {
        region,
        limit: 10,
        excludeUserId: viewerUserId ?? undefined,
      },
    ).catch((err) => {
      console.warn("[experts/match] semantic pre-rank failed:", err);
      return {
        expertIds: [],
        source: "fallback" as const,
        reason: "semantic pre-rank threw",
      };
    });

    const baseWhere = {
      isPublished: true,
      ...(viewerUserId ? { userId: { not: viewerUserId } } : {}),
    };
    let experts = await prisma.expert.findMany({
      where: {
        ...baseWhere,
        ...(semanticRank.source === "vector"
          ? { id: { in: semanticRank.expertIds } }
          : {}),
      },
      include: {
        user: { select: { nickName: true, name: true } },
      },
    });

    if (semanticRank.source === "vector") {
      const order = new Map(
        semanticRank.expertIds.map((id, index) => [id, index]),
      );
      experts = experts.sort(
        (a, b) =>
          (order.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
          (order.get(b.id) ?? Number.MAX_SAFE_INTEGER),
      );

      if (experts.length === 0) {
        experts = await prisma.expert.findMany({
          where: baseWhere,
          include: {
            user: { select: { nickName: true, name: true } },
          },
        });
      }
    }

    console.log(
      "[experts/match] candidate pool:",
      JSON.stringify({
        source: semanticRank.source,
        reason: semanticRank.reason,
        region,
        candidates: experts.length,
      }),
    );

    if (experts.length === 0) {
      return NextResponse.json({
        recommendations: [],
        noMatchMessage:
          "No experts are available at the moment. Please check back later.",
      });
    }

    // Step 3: Enrich summaries with mem9
    const memoryResults = await Promise.all(
      experts.map((e) =>
        searchExpertMemories(e.id, nq.english || query, 3).catch(
          () => [] as string[],
        ),
      ),
    );

    const expertSummaries = experts
      .map((e, i) => buildLLMExpertContext(e, memoryResults[i]))
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

      // LLM correctly determined no expert is relevant. For SPECIFIC topic
      // queries we honour that — falling back to keyword matching here was
      // the source of "profile mentions 'familiar, with'"-style nonsense
      // (stop-word substring hits dressed up as recommendations). Better to
      // surface the LLM's noMatchMessage and let the user refine the query.
      //
      // Keyword + exploratory fallbacks only kick in for ambiguous queries
      // (greetings, broad exploration) where SOMETHING is better than nothing.
      if (nq.intent === "greeting" || nq.intent === "broad_exploration") {
        const keyword = keywordMatch(nq, experts);
        if (keyword.recommendations.length > 0) {
          return NextResponse.json({
            recommendations: keyword.recommendations,
            noMatchMessage: result.noMatchMessage,
          });
        }
        return NextResponse.json(exploratoryFallback(experts));
      }

      return NextResponse.json({
        recommendations: [],
        noMatchMessage:
          result.noMatchMessage ??
          `No published expert currently matches "${nq.english}". Try a different topic or add more detail about what you need.`,
      });
    } catch (aiError) {
      console.error("[experts/match] AI matching failed, fallback:", aiError);
      // True LLM-error path: keyword fallback is fine because we have NO
      // signal at all. Stop-word filter inside keywordMatch keeps quality
      // reasonable; if it still finds nothing, return a clean no-match.
      const fallback = keywordMatch(nq, experts);
      if (fallback.recommendations.length > 0) {
        return NextResponse.json(fallback);
      }
      if (nq.intent === "greeting" || nq.intent === "broad_exploration") {
        return NextResponse.json(exploratoryFallback(experts));
      }
      return NextResponse.json({
        recommendations: [],
        noMatchMessage: `No published expert currently matches "${nq.english}". Try a different topic or add more detail about what you need.`,
      });
    }
  } catch (error) {
    console.error("[experts/match POST]", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
