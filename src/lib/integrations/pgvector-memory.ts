/**
 * Optional Postgres + pgvector mirror of expert “memories” (alongside mem9).
 * Enable with USE_PGVECTOR_MEMORY=1 and a Postgres DATABASE_URL (or PGVECTOR_DATABASE_URL).
 * Requires extension `vector` and table `expert_memory_embeddings` (see admin migrate SQL).
 */

import { randomUUID } from "crypto";

import { Pool } from "pg";

let pool: Pool | null | undefined;

function getPool(): Pool | null {
  if (pool !== undefined) return pool;
  if (process.env.USE_PGVECTOR_MEMORY !== "1") {
    pool = null;
    return null;
  }
  const url =
    process.env.PGVECTOR_DATABASE_URL ||
    (process.env.DATABASE_URL?.startsWith("postgresql")
      ? process.env.DATABASE_URL
      : "");
  if (!url) {
    pool = null;
    return null;
  }
  pool = new Pool({ connectionString: url, max: 3 });
  return pool;
}

async function fetchOpenAiEmbedding(text: string): Promise<number[] | null> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  const input = text.slice(0, 8000);
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small",
      input,
    }),
  });
  if (!res.ok) {
    console.warn("[pgvector-memory] OpenAI embeddings error:", await res.text());
    return null;
  }
  const data = (await res.json()) as {
    data?: { embedding: number[] }[];
  };
  const emb = data.data?.[0]?.embedding;
  return Array.isArray(emb) ? emb : null;
}

function toVectorLiteral(values: number[]): string {
  return `[${values.join(",")}]`;
}

export async function storeExpertMemoryChunk(params: {
  expertId: string;
  content: string;
  tags: string[];
  source: string;
}): Promise<void> {
  const p = getPool();
  if (!p) return;
  try {
    const embedding = await fetchOpenAiEmbedding(params.content);
    const id = randomUUID();
    await p.query(
      `INSERT INTO expert_memory_embeddings (id, expert_id, content, tags, source, embedding)
       VALUES ($1, $2, $3, $4, $5, $6::vector)`,
      [
        id,
        params.expertId,
        params.content,
        JSON.stringify(params.tags),
        params.source,
        embedding ? toVectorLiteral(embedding) : null,
      ],
    );
  } catch (err) {
    console.warn("[pgvector-memory] storeExpertMemoryChunk:", err);
  }
}

export async function searchExpertMemoryChunks(
  expertId: string,
  query: string,
  limit = 5,
): Promise<string[]> {
  const p = getPool();
  if (!p) return [];
  try {
    const qEmb = await fetchOpenAiEmbedding(query);
    if (qEmb && qEmb.length > 0) {
      const vec = toVectorLiteral(qEmb);
      const r = await p.query<{ content: string }>(
        `SELECT content FROM expert_memory_embeddings
         WHERE expert_id = $1 AND embedding IS NOT NULL
         ORDER BY embedding <=> $2::vector
         LIMIT $3`,
        [expertId, vec, limit],
      );
      if (r.rows.length > 0) return r.rows.map((x) => x.content);
    }
    const like = `%${query.replace(/%/g, "\\%").slice(0, 200)}%`;
    const r2 = await p.query<{ content: string }>(
      `SELECT content FROM expert_memory_embeddings
       WHERE expert_id = $1 AND content ILIKE $2
       ORDER BY created_at DESC
       LIMIT $3`,
      [expertId, like, limit],
    );
    return r2.rows.map((x) => x.content);
  } catch (err) {
    console.warn("[pgvector-memory] searchExpertMemoryChunks:", err);
    return [];
  }
}
