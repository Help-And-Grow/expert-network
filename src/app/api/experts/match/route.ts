import { type NextRequest, NextResponse } from "next/server";

import type { SessionType } from "@/generated/prisma/client";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // LLM + mem9 pipeline can take 15-20 s

import { resolveAIProvider } from "@/lib/ai";
import type { NormalizedQuery } from "@/lib/ai";
import {
  detectCountriesInQuery,
  detectStandaloneCountriesInQuery,
  normalizeCountryCodes,
} from "@/lib/expert-countries";
import {
  buildDeterministicExpertMatchReason,
  buildLLMExpertContext,
  neutralizeExpertReasonPronouns,
} from "@/lib/expert-match-context";
import {
  isExpertSearchVectorPrerankEnabled,
  rankExpertsBySemanticRelevance,
} from "@/lib/expert-match-search";
import { resolveExpertSearchRegion } from "@/lib/expert-search-region";
import {
  buildExpertFocusLabel,
  buildExpertSearchText,
  stringifyServicesOffered,
} from "@/lib/expert-topics";
import { searchExpertMemories } from "@/lib/integrations/mem9-lifecycle";
import { prisma } from "@/lib/prisma";
import { resolveUserId } from "@/lib/request-auth";
import { isWeChatOriginatedRequest } from "@/lib/request-origin";

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
  gender: string | null;
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

function buildFastNormalizedQuery(query: string): NormalizedQuery {
  const english = query
    .replace(/\bBD\b/gi, "business development")
    .replace(/\bexert\b/gi, "expert")
    .trim();
  const keywords = Array.from(
    new Set(
      english
        .toLowerCase()
        .match(/[a-z0-9][a-z0-9+.-]{2,}/g)
        ?.filter((term) => !STOP_WORDS.has(term)) ?? [],
    ),
  ).slice(0, 12);

  return {
    english,
    keywords,
    intent: keywords.length > 0 ? "specific_topic" : "broad_exploration",
    original: query,
  };
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
    const startedAt = Date.now();
    const viewerUserId = await resolveUserId(request).catch(() => null);
    if (!viewerUserId) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401, headers: { "Cache-Control": "private, no-store" } },
      );
    }
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
    // Detect standalone country queries (e.g. "Japan", "New Zealand") on every
    // turn — not just when history is populated. The downstream missing-fill
    // block (search for `standaloneCountries.length > 0 && countryAllowlistIds`)
    // is what surfaces country-tagged experts that pgvector misses (e.g. those
    // without a generated embedding yet). Gating that on `history.length > 0`
    // meant the very first message "Japan" silently dropped any expert without
    // an embedding row.
    const standaloneCountries = detectStandaloneCountriesInQuery(query);
    const effectiveHistory = standaloneCountries.length > 0 ? [] : history;

    // Region-aware provider: WeChat-originated traffic uses the WECHAT_AI_PROVIDER
    // (default Qwen) so inference stays inside the GFW; everything else uses the
    // global default (Gemini).
    const ai = await resolveAIProvider({ request });

    const semanticEnabled = await isExpertSearchVectorPrerankEnabled().catch(
      () => false,
    );

    // Step 1: Normalize query. When vector pre-rank is enabled, avoid a full
    // LLM call here; Gemini retrieval embeddings handle semantic expansion,
    // and the final matcher still receives the user's original query.
    let nq: NormalizedQuery;
    if (semanticEnabled) {
      nq = buildFastNormalizedQuery(query);
      console.log("[experts/match] fast-normalized:", JSON.stringify(nq));
    } else {
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
    }

    // Defense-in-depth: WeChat traffic sees only FREE + ONLINE-capable experts.
    // See src/app/api/v1/experts/route.ts for the FREE + online-only rationale.
    const baseWhere = {
      isPublished: true,
      ...(viewerUserId ? { userId: { not: viewerUserId } } : {}),
      ...(isWeChatOriginatedRequest(request)
        ? {
            priceOnlineCents: 0,
            sessionType: { in: ["ONLINE", "BOTH"] as SessionType[] },
          }
        : {}),
    };

    // Step 2a: country-first recall. If the inquiry mentions a country/region
    // we recognise (e.g. "BD expert in Singapore"), build an allowlist of
    // expert ids tagged with that country and pass it to the semantic rank
    // step below. Full country detection runs on the first turn; later turns
    // only override history when the current message is a standalone country
    // input like "Japan" or "New Zealand". If no expert claims the country
    // yet, we silently fall back to the global pool so the user sees
    // *something* rather than an empty page.
    const detectedCountries =
      standaloneCountries.length > 0
        ? standaloneCountries
        : detectCountriesInQuery(query);
    let countryAllowlistIds: string[] | null = null;
    if (detectedCountries.length > 0) {
      const allCandidates = await prisma.expert.findMany({
        where: baseWhere,
        select: { id: true, countries: true },
      });
      const matching = allCandidates.filter((e) => {
        const codes = normalizeCountryCodes(e.countries);
        return codes.some((c) => detectedCountries.includes(c));
      });
      if (matching.length > 0) {
        countryAllowlistIds = matching.map((e) => e.id);
        console.log(
          "[experts/match] country allowlist:",
          JSON.stringify({
            detectedCountries,
            allowlistSize: countryAllowlistIds.length,
          }),
        );
      } else {
        console.log(
          "[experts/match] country detected but no expert claims it; falling back to global pool:",
          JSON.stringify({ detectedCountries }),
        );
      }
    }

    // Step 2b: semantic vector pre-rank within the (optionally) country-
    // narrowed pool. Opt-in via EXPERT_SEARCH_VECTOR_PRERANK; otherwise this
    // is a no-op and we fall back to legacy keyword scoring.
    const region = resolveExpertSearchRegion(request);
    const semanticRank = await rankExpertsBySemanticRelevance(
      nq.english || query,
      {
        region,
        limit: semanticEnabled ? 4 : 10,
        excludeUserId: viewerUserId ?? undefined,
        expertIdAllowlist: countryAllowlistIds ?? undefined,
      },
    ).catch((err) => {
      console.warn("[experts/match] semantic pre-rank failed:", err);
      return {
        expertIds: [],
        source: "fallback" as const,
        reason: "semantic pre-rank threw",
      };
    });

    let experts = await prisma.expert.findMany({
      where: {
        ...baseWhere,
        // 1st preference: the semantic vector subset (already country-
        // narrowed via the allowlist passed above).
        // 2nd preference: when semantic rank is unavailable AND we have a
        // country allowlist, restrict by country directly (keyword fallback
        // path still needs to honour the country signal).
        // Otherwise: full pool (legacy behaviour).
        ...(semanticRank.source === "vector"
          ? { id: { in: semanticRank.expertIds } }
          : countryAllowlistIds
            ? { id: { in: countryAllowlistIds } }
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

    if (standaloneCountries.length > 0 && countryAllowlistIds) {
      const present = new Set(experts.map((e) => e.id));
      const missingIds = countryAllowlistIds.filter((id) => !present.has(id));
      if (missingIds.length > 0) {
        const missing = await prisma.expert.findMany({
          where: { ...baseWhere, id: { in: missingIds } },
          include: {
            user: { select: { nickName: true, name: true } },
          },
        });
        const sortedMissing = [...missing].sort(
          (a, b) =>
            b.reviewCount - a.reviewCount ||
            (b.avgRating ?? 0) - (a.avgRating ?? 0),
        );
        experts = [...experts, ...sortedMissing];
      }
    }

    console.log(
      "[experts/match] candidate pool:",
      JSON.stringify({
        source: semanticRank.source,
        reason: semanticRank.reason,
        region,
        candidates: experts.length,
        elapsedMs: Date.now() - startedAt,
      }),
    );

    if (experts.length === 0) {
      return NextResponse.json({
        recommendations: [],
        noMatchMessage:
          "No experts are available at the moment. Please check back later.",
      });
    }

    if (standaloneCountries.length > 0 && semanticRank.source !== "vector") {
      const top = [...experts]
        .sort(
          (a, b) =>
            b.reviewCount - a.reviewCount ||
            (b.avgRating ?? 0) - (a.avgRating ?? 0),
        )
        .slice(0, 3);
      return NextResponse.json({
        recommendations: top.map((expert) => ({
          expertId: expert.id,
          name: expert.user.nickName ?? expert.user.name ?? "Unknown",
          summary: buildExpertSummary(expert),
          reason: buildDeterministicExpertMatchReason(expert, query),
          sessionTypes: [expert.sessionType],
        })),
      });
    }

    if (semanticRank.source === "vector" && effectiveHistory.length === 0) {
      console.log(
        "[experts/match] vector fast response:",
        JSON.stringify({ elapsedMs: Date.now() - startedAt }),
      );
      return NextResponse.json({
        recommendations: experts.slice(0, 3).map((expert) => ({
          expertId: expert.id,
          name: expert.user.nickName ?? expert.user.name ?? "Unknown",
          summary: buildExpertSummary(expert),
          // Pass the original query so the reason can extract a sentence
          // from the expert's profile that mentions it (e.g. "Singapore"
          // → quote the sentence about Singapore tech events). Without
          // the query we'd fall back to the first sentence of the script
          // which is usually generic boilerplate.
          reason: buildDeterministicExpertMatchReason(expert, query),
          sessionTypes: [expert.sessionType],
        })),
      });
    }

    // Step 3: Enrich summaries with mem9
    const memoryResults =
      semanticRank.source === "vector"
        ? experts.map(() => [] as string[])
        : await Promise.all(
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
      R extends { expertId: string; reason: string; summary?: string },
    >(
      recs: R[] | undefined,
    ): R[] | undefined =>
      recs?.map((rec) => {
        const expert = expertById.get(rec.expertId);
        return expert
          ? {
              ...rec,
              reason: neutralizeExpertReasonPronouns(rec.reason, expert),
              summary: rec.summary ?? buildExpertSummary(expert),
            }
          : rec;
      });

    // Budget: 60 s maxDuration. Qwen→Gemini on Vercel sin1 can hang
    // indefinitely until Vercel kills the function with a 504 — the client
    // surfaces that as "Sorry, that didn't go through". Capping the LLM call
    // at 20 s guarantees the existing keyword-fallback catch fires within
    // budget and the user always gets a useful response.
    const LLM_TIMEOUT_MS = 20_000;

    try {
      const result = await Promise.race([
        ai.matchExperts(query, expertSummaries, effectiveHistory, nq),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error("[experts/match] LLM timed out after 20 s")),
            LLM_TIMEOUT_MS,
          ),
        ),
      ]);
      console.log(
        "[experts/match] llm match complete:",
        JSON.stringify({ elapsedMs: Date.now() - startedAt }),
      );
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
