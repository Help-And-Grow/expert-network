import { env } from "@/lib/env";
import { createGeminiClient } from "@/lib/ai/gemini-client";

export const GEMINI_EMBEDDING_DIMENSIONS = 1536;

export type GeminiEmbeddingTaskType = "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY";

export async function fetchGeminiEmbedding(
  text: string,
  taskType: GeminiEmbeddingTaskType,
  logPrefix = "[gemini-embeddings]",
): Promise<number[] | null> {
  if (!env.GEMINI_API_KEY && !env.GOOGLE_CLOUD_PROJECT) return null;
  const input = text.slice(0, 8000);
  try {
    const client = createGeminiClient();
    const res = await client.models.embedContent({
      model: env.GEMINI_EMBEDDING_MODEL?.trim() || "gemini-embedding-001",
      contents: input,
      config: {
        outputDimensionality: GEMINI_EMBEDDING_DIMENSIONS,
        taskType,
      },
    });
    const emb = res.embeddings?.[0]?.values;
    return Array.isArray(emb) ? emb : null;
  } catch (err) {
    console.warn(`${logPrefix} Gemini embedding error:`, err);
    return null;
  }
}

export function toVectorLiteral(values: number[]): string {
  return `[${values.join(",")}]`;
}
