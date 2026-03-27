/**
 * Best-effort backfill from mem9 search API into local pgvector (USE_PGVECTOR_MEMORY=1).
 * mem9 has no “list all”; we issue several search queries and dedupe by content prefix.
 */

import { prisma } from "@/lib/prisma";

import { getMemory } from "./config";
import { storeExpertMemoryChunk } from "./pgvector-memory";

const SEARCH_TERMS = [
  "profile",
  "booking",
  "review",
  "session",
  "bio",
  "client",
  "service",
  "expert",
  "meeting",
  "the",
  "a",
];

export async function backfillExpertMem9ToPgvector(
  expertId: string,
): Promise<{ stored: number; skipped: boolean; reason?: string }> {
  if (process.env.USE_PGVECTOR_MEMORY !== "1") {
    return { stored: 0, skipped: true, reason: "USE_PGVECTOR_MEMORY is not 1" };
  }

  const memory = await getMemory();
  if (!memory) {
    return { stored: 0, skipped: true, reason: "mem9 not configured" };
  }

  const expert = await prisma.expert.findUnique({
    where: { id: expertId },
    select: { mem9SpaceId: true },
  });
  if (!expert?.mem9SpaceId) {
    return { stored: 0, skipped: true, reason: "no mem9SpaceId" };
  }

  const seen = new Set<string>();
  let stored = 0;

  for (const q of SEARCH_TERMS) {
    let entries: { content: string; tags?: string[] }[];
    try {
      entries = await memory.search(expert.mem9SpaceId, q, 80);
    } catch {
      continue;
    }
    for (const e of entries) {
      const content = typeof e.content === "string" ? e.content : "";
      if (!content.trim()) continue;
      const key = content.slice(0, 240);
      if (seen.has(key)) continue;
      seen.add(key);
      await storeExpertMemoryChunk({
        expertId,
        content,
        tags: Array.isArray(e.tags) ? e.tags : [],
        source: `mem9-backfill:${expertId}`,
      });
      stored++;
    }
  }

  return { stored, skipped: false };
}

export async function backfillAllExpertsMem9ToPgvector(): Promise<{
  experts: number;
  totalStored: number;
}> {
  const experts = await prisma.expert.findMany({
    where: { mem9SpaceId: { not: null } },
    select: { id: true },
  });

  let totalStored = 0;
  for (const e of experts) {
    const r = await backfillExpertMem9ToPgvector(e.id);
    if (!r.skipped) totalStored += r.stored;
  }

  return { experts: experts.length, totalStored };
}
