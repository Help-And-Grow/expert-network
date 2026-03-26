const API_BASE = "https://api.mem9.ai/v1alpha1/mem9s";

export async function searchMemories(spaceId, query, limit = 10) {
  const params = new URLSearchParams({ q: query, limit: String(limit) });
  const res = await fetch(`${API_BASE}/${spaceId}/memories?${params}`);
  if (!res.ok) throw new Error(`mem9 search failed (${res.status})`);
  return res.json();
}

export async function storeMemory(spaceId, { content, tags, source }) {
  const res = await fetch(`${API_BASE}/${spaceId}/memories`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content, tags, source }),
  });
  if (!res.ok) throw new Error(`mem9 store failed (${res.status})`);
  return res.json();
}

/**
 * Retrieve expert context for shadow generation.
 * Returns concatenated memory content as a single context string.
 */
function asMemoryList(memories) {
  if (Array.isArray(memories)) return memories;
  if (memories && Array.isArray(memories.memories)) return memories.memories;
  if (memories && Array.isArray(memories.items)) return memories.items;
  return [];
}

export async function getExpertContext(spaceId, query) {
  const raw = await searchMemories(spaceId, query, 15);
  const memories = asMemoryList(raw);
  return memories.map((m) => m.content).join("\n\n");
}

/**
 * Short persona summary for handoff / rehydration (fixed retrieval query).
 */
export async function getProfileSummary(spaceId) {
  const raw = await searchMemories(
    spaceId,
    "expert voice tone biography background communication style values",
    8
  );
  const memories = asMemoryList(raw);
  if (!memories.length) return "";
  return memories.map((m) => m.content).join("\n\n").slice(0, 4000);
}
