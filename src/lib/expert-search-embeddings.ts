import { createHash } from "crypto";

import { Pool } from "pg";

import {
  buildExpertEmbeddingText,
  type ExpertMatchContext,
} from "@/lib/expert-match-context";
import { fetchGeminiEmbedding, toVectorLiteral } from "@/lib/gemini-embeddings";
import { searchExpertMemories } from "@/lib/integrations/mem9-lifecycle";
import { prisma } from "@/lib/prisma";
import { resolvePrimaryDatabaseUrl } from "@/lib/env";
import {
  resolveExpertSearchRegion,
  type ExpertSearchRegion,
} from "@/lib/expert-search-region";

let pool: Pool | null | undefined;

export function getExpertSearchPool(): Pool | null {
  if (pool !== undefined) return pool;
  const primary = resolvePrimaryDatabaseUrl();
  const url =
    process.env.PGVECTOR_DATABASE_URL ||
    (primary?.startsWith("postgresql") || primary?.startsWith("postgres")
      ? primary
      : "");
  if (!url) {
    pool = null;
    return null;
  }
  pool = new Pool({ connectionString: url, max: 3 });
  return pool;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

type ExpertEmbeddingRow = ExpertMatchContext & {
  isPublished: boolean;
};

export interface EmbedExpertProfileResult {
  expertId: string;
  skipped: boolean;
  embedded: boolean;
  reason?: string;
}

export async function embedExpertProfile(
  expertId: string,
  options: {
    region?: ExpertSearchRegion;
    memories?: string[];
  } = {},
): Promise<EmbedExpertProfileResult> {
  const p = getExpertSearchPool();
  if (!p) {
    return {
      expertId,
      skipped: true,
      embedded: false,
      reason: "pgvector database unavailable",
    };
  }

  const expert = await prisma.expert.findUnique({
    where: { id: expertId },
    select: {
      id: true,
      bio: true,
      avatarScript: true,
      sessionType: true,
      servicesOffered: true,
      linkedIn: true,
      twitter: true,
      substack: true,
      instagram: true,
      xiaohongshu: true,
      documentName: true,
      isPublished: true,
      user: { select: { nickName: true, name: true } },
    },
  });

  if (!expert) {
    return { expertId, skipped: true, embedded: false, reason: "not found" };
  }

  if (!expert.isPublished) {
    await p.query(
      `UPDATE expert_profile_embeddings
       SET is_published = FALSE, embedded_at = CURRENT_TIMESTAMP
       WHERE expert_id = $1`,
      [expertId],
    );
    return {
      expertId,
      skipped: true,
      embedded: false,
      reason: "expert is not published",
    };
  }

  const memories =
    options.memories ??
    (await searchExpertMemories(
      expertId,
      "profile services expertise recent work reviews",
      5,
    ).catch(() => []));

  const source = buildExpertEmbeddingText(
    expert as ExpertEmbeddingRow,
    memories,
  );
  const contentHash = sha256(source);

  const existing = await p.query<{
    content_hash: string;
    has_embedding: boolean;
    region: ExpertSearchRegion | null;
  }>(
    `SELECT content_hash, embedding IS NOT NULL AS has_embedding, region
     FROM expert_profile_embeddings
     WHERE expert_id = $1`,
    [expertId],
  );
  const region =
    options.region ?? existing.rows[0]?.region ?? resolveExpertSearchRegion();

  if (
    existing.rows[0]?.content_hash === contentHash &&
    existing.rows[0]?.has_embedding
  ) {
    await p.query(
      `UPDATE expert_profile_embeddings
       SET is_published = TRUE, region = $2
       WHERE expert_id = $1`,
      [expertId, region],
    );
    return {
      expertId,
      skipped: true,
      embedded: false,
      reason: "content hash unchanged",
    };
  }

  const embedding = await fetchGeminiEmbedding(
    source,
    "RETRIEVAL_DOCUMENT",
    "[expert-search-embeddings]",
  );

  await p.query(
    `INSERT INTO expert_profile_embeddings
       (expert_id, content_hash, source, embedding, embedded_at, is_published, region)
     VALUES ($1, $2, $3, $4::vector, CURRENT_TIMESTAMP, TRUE, $5)
     ON CONFLICT (expert_id) DO UPDATE SET
       content_hash = EXCLUDED.content_hash,
       source = EXCLUDED.source,
       embedding = EXCLUDED.embedding,
       embedded_at = CURRENT_TIMESTAMP,
       is_published = TRUE,
       region = EXCLUDED.region`,
    [
      expertId,
      contentHash,
      source,
      embedding ? toVectorLiteral(embedding) : null,
      region,
    ],
  );

  return {
    expertId,
    skipped: false,
    embedded: Boolean(embedding),
    reason: embedding ? undefined : "embedding provider unavailable",
  };
}

export async function backfillExpertProfileEmbeddings(
  options: {
    expertId?: string;
    limit?: number;
    region?: ExpertSearchRegion;
  } = {},
): Promise<{
  experts: number;
  embedded: number;
  skipped: number;
  missingEmbedding: number;
  failed: number;
  results: EmbedExpertProfileResult[];
}> {
  const experts = await prisma.expert.findMany({
    where: {
      isPublished: true,
      ...(options.expertId ? { id: options.expertId } : {}),
    },
    select: { id: true },
    take: options.limit,
    orderBy: { updatedAt: "desc" },
  });

  const results: EmbedExpertProfileResult[] = [];
  let failed = 0;

  for (const expert of experts) {
    try {
      results.push(
        await embedExpertProfile(expert.id, { region: options.region }),
      );
    } catch (err) {
      failed++;
      const reason = err instanceof Error ? err.message : String(err);
      console.warn("[expert-search-embeddings] backfill failed:", {
        expertId: expert.id,
        reason,
      });
      results.push({
        expertId: expert.id,
        skipped: false,
        embedded: false,
        reason,
      });
    }
  }

  return {
    experts: experts.length,
    embedded: results.filter((r) => r.embedded).length,
    skipped: results.filter((r) => r.skipped).length,
    missingEmbedding: results.filter((r) => !r.embedded && !r.skipped).length,
    failed,
    results,
  };
}

export async function refreshStaleExpertProfileEmbeddings(
  options: {
    olderThanDays?: number;
    limit?: number;
    region?: ExpertSearchRegion;
  } = {},
) {
  const p = getExpertSearchPool();
  if (!p) {
    return {
      experts: 0,
      embedded: 0,
      skipped: 0,
      missingEmbedding: 0,
      failed: 0,
      results: [],
    };
  }

  const olderThanDays = options.olderThanDays ?? 30;
  const limit = options.limit ?? 100;
  const stale = await p.query<{ id: string }>(
    `SELECT e.id
     FROM "Expert" e
     LEFT JOIN expert_profile_embeddings ep ON ep.expert_id = e.id
     WHERE e."isPublished" = TRUE
       AND (
         ep.expert_id IS NULL
         OR ep.embedding IS NULL
         OR ep.embedded_at < NOW() - ($1::int * INTERVAL '1 day')
       )
     ORDER BY e."updatedAt" DESC
     LIMIT $2`,
    [olderThanDays, limit],
  );

  let embedded = 0;
  let skipped = 0;
  let missingEmbedding = 0;
  let failed = 0;
  const results: EmbedExpertProfileResult[] = [];

  for (const row of stale.rows) {
    try {
      const result = await embedExpertProfile(row.id, {
        region: options.region,
      });
      results.push(result);
      if (result.embedded) embedded++;
      else if (result.skipped) skipped++;
      else missingEmbedding++;
    } catch (err) {
      failed++;
      results.push({
        expertId: row.id,
        skipped: false,
        embedded: false,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    experts: stale.rows.length,
    embedded,
    skipped,
    missingEmbedding,
    failed,
    results,
  };
}

export async function getExpertProfileEmbeddingCoverage(): Promise<{
  publishedExperts: number;
  searchableExperts: number;
  staleExperts: number;
  tableReady: boolean;
}> {
  const publishedExperts = await prisma.expert.count({
    where: { isPublished: true },
  });
  const p = getExpertSearchPool();
  if (!p) {
    return {
      publishedExperts,
      searchableExperts: 0,
      staleExperts: publishedExperts,
      tableReady: false,
    };
  }

  try {
    const coverage = await p.query<{
      searchable_experts: string;
      stale_experts: string;
    }>(
      `SELECT
         COUNT(*) FILTER (
           WHERE ep.is_published = TRUE AND ep.embedding IS NOT NULL
         )::text AS searchable_experts,
         COUNT(*) FILTER (
           WHERE e."isPublished" = TRUE AND (
             ep.expert_id IS NULL
             OR ep.embedding IS NULL
             OR ep.embedded_at < NOW() - INTERVAL '30 days'
           )
         )::text AS stale_experts
       FROM "Expert" e
       LEFT JOIN expert_profile_embeddings ep ON ep.expert_id = e.id
       WHERE e."isPublished" = TRUE`,
    );

    return {
      publishedExperts,
      searchableExperts: Number(coverage.rows[0]?.searchable_experts ?? 0),
      staleExperts: Number(coverage.rows[0]?.stale_experts ?? publishedExperts),
      tableReady: true,
    };
  } catch (err) {
    console.warn("[expert-search-embeddings] coverage unavailable:", err);
    return {
      publishedExperts,
      searchableExperts: 0,
      staleExperts: publishedExperts,
      tableReady: false,
    };
  }
}
