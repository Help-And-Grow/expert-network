import { getExpertSearchPool } from "@/lib/expert-search-embeddings";
import { type ExpertSearchRegion } from "@/lib/expert-search-region";
import { fetchGeminiEmbedding, toVectorLiteral } from "@/lib/gemini-embeddings";
import { getSystemConfig } from "@/lib/system-config";

export interface SemanticRankResult {
  expertIds: string[];
  source: "vector" | "fallback";
  reason?: string;
}

function parseBooleanFlag(value: string | null | undefined): boolean {
  return ["1", "true", "yes", "on"].includes(
    (value ?? "").trim().toLowerCase(),
  );
}

export async function isExpertSearchVectorPrerankEnabled(): Promise<boolean> {
  const dbValue = await getSystemConfig("EXPERT_SEARCH_VECTOR_PRERANK");
  return parseBooleanFlag(dbValue ?? process.env.EXPERT_SEARCH_VECTOR_PRERANK);
}

export async function rankExpertsBySemanticRelevance(
  query: string,
  options: {
    region?: ExpertSearchRegion;
    limit?: number;
    excludeUserId?: string;
    /**
     * Pre-filter the candidate pool to this allowlist of Expert.id values
     * BEFORE pgvector ranks them. Used by the country-aware match flow:
     * if the inquiry mentions "Singapore", the caller fetches all expert
     * ids tagged SG and passes them here, so the vector search returns
     * the best SG-tagged semantic matches rather than the globally best
     * matches (which might not be SG-tagged at all).
     */
    expertIdAllowlist?: string[];
  } = {},
): Promise<SemanticRankResult> {
  if (!(await isExpertSearchVectorPrerankEnabled())) {
    return { expertIds: [], source: "fallback", reason: "flag disabled" };
  }

  const p = getExpertSearchPool();
  if (!p) {
    return {
      expertIds: [],
      source: "fallback",
      reason: "pgvector unavailable",
    };
  }

  const cleanQuery = query.trim();
  if (!cleanQuery) {
    return { expertIds: [], source: "fallback", reason: "empty query" };
  }

  const embedding = await fetchGeminiEmbedding(
    cleanQuery,
    "RETRIEVAL_QUERY",
    "[expert-match-search]",
  );
  if (!embedding?.length) {
    return {
      expertIds: [],
      source: "fallback",
      reason: "query embedding unavailable",
    };
  }

  const region = options.region ?? "global";
  const limit = Math.min(Math.max(options.limit ?? 10, 1), 30);

  // Optional pre-filter to a specific allowlist. NULL when the caller
  // doesn't need country/region narrowing — the SQL short-circuits the
  // ANY check in that case.
  const allowlist =
    options.expertIdAllowlist && options.expertIdAllowlist.length > 0
      ? options.expertIdAllowlist
      : null;
  if (allowlist && allowlist.length === 0) {
    // Defensive: caller signalled "narrow to nothing" — return empty so the
    // caller can fall back rather than firing a query that returns global
    // results.
    return {
      expertIds: [],
      source: "fallback",
      reason: "allowlist empty",
    };
  }

  try {
    const ranked = await p.query<{ expert_id: string }>(
      `SELECT expert_id
       FROM expert_profile_embeddings
       WHERE is_published = TRUE
         AND embedding IS NOT NULL
         AND (
           region IS NULL
           OR region = 'global'
           OR region = $2
           OR ($2 = 'global' AND region = 'wechat-intl')
         )
         AND (
           $3::text IS NULL
           OR expert_id NOT IN (
             SELECT id FROM "Expert" WHERE "userId" = $3
           )
         )
         AND (
           $5::text[] IS NULL
           OR expert_id = ANY($5::text[])
         )
       ORDER BY embedding <=> $1::vector
       LIMIT $4`,
      [
        toVectorLiteral(embedding),
        region,
        options.excludeUserId ?? null,
        limit,
        allowlist,
      ],
    );

    if (ranked.rows.length === 0) {
      return {
        expertIds: [],
        source: "fallback",
        reason: allowlist
          ? "no vector candidates within allowlist"
          : "no vector candidates",
      };
    }

    return {
      expertIds: ranked.rows.map((r) => r.expert_id),
      source: "vector",
    };
  } catch (err) {
    console.warn("[expert-match-search] vector rank failed:", err);
    return { expertIds: [], source: "fallback", reason: "vector query failed" };
  }
}
