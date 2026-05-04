import { env } from "@/lib/env";

import type { ImportMeta, MemoryEntry, MemoryProvider } from "./types";

const DEFAULT_MEM9_API_BASE = "https://api.mem9.ai";
const DEFAULT_AGENT_ID = "help-grow-platform";

function normalizedApiBase(): string {
  return (env.MEM9_API_BASE || DEFAULT_MEM9_API_BASE).replace(/\/+$/, "");
}

function agentId(): string {
  return env.MEM9_AGENT_ID?.trim() || DEFAULT_AGENT_ID;
}

function jsonHeaders(spaceId: string): HeadersInit {
  return {
    "Content-Type": "application/json",
    "X-API-Key": spaceId,
    "X-Mnemo-Agent-Id": agentId(),
  };
}

function authHeaders(spaceId: string): HeadersInit {
  return {
    "X-API-Key": spaceId,
    "X-Mnemo-Agent-Id": agentId(),
  };
}

function hostedUrl(path: string): string {
  return `${normalizedApiBase()}/v1alpha2/mem9s${path}`;
}

function legacyProvisionUrl(): string {
  return `${normalizedApiBase()}/v1alpha1/mem9s`;
}

async function readJson(res: Response): Promise<unknown> {
  if (res.status === 204) return null;
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function asObject(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function asStringArray(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }
  if (typeof value === "string" && value.trim()) {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return undefined;
}

function toMemoryEntry(value: unknown): MemoryEntry | null {
  const raw = asObject(value);
  if (!raw || typeof raw.content !== "string") return null;

  const metadata = asObject(raw.metadata) ?? undefined;
  const source =
    typeof raw.source === "string"
      ? raw.source
      : typeof metadata?.source === "string"
        ? metadata.source
        : undefined;

  return {
    id: typeof raw.id === "string" ? raw.id : undefined,
    content: raw.content,
    tags: asStringArray(raw.tags),
    source,
    metadata,
    agentId:
      typeof raw.agent_id === "string"
        ? raw.agent_id
        : typeof raw.agentId === "string"
          ? raw.agentId
          : undefined,
    sessionId:
      typeof raw.session_id === "string"
        ? raw.session_id
        : typeof raw.sessionId === "string"
          ? raw.sessionId
          : undefined,
    memoryType:
      typeof raw.memory_type === "string"
        ? raw.memory_type
        : typeof raw.memoryType === "string"
          ? raw.memoryType
          : undefined,
    state: typeof raw.state === "string" ? raw.state : undefined,
    version: typeof raw.version === "number" ? raw.version : undefined,
    createdAt:
      typeof raw.created_at === "string"
        ? raw.created_at
        : typeof raw.createdAt === "string"
          ? raw.createdAt
          : undefined,
    updatedAt:
      typeof raw.updated_at === "string"
        ? raw.updated_at
        : typeof raw.updatedAt === "string"
          ? raw.updatedAt
          : undefined,
  };
}

function memoryIdFromCreateResponse(data: unknown): string {
  const raw = asObject(data);
  if (!raw) return "accepted";
  if (typeof raw.id === "string") return raw.id;
  const memory = toMemoryEntry(raw.memory);
  if (memory?.id) return memory.id;
  const memories = Array.isArray(raw.memories) ? raw.memories : [];
  const first = toMemoryEntry(memories[0]);
  if (first?.id) return first.id;
  if (typeof raw.status === "string") return raw.status;
  return "accepted";
}

function memorySearchResults(data: unknown): MemoryEntry[] {
  if (Array.isArray(data)) {
    return data.map(toMemoryEntry).filter((entry): entry is MemoryEntry => !!entry);
  }
  const raw = asObject(data);
  const memories = Array.isArray(raw?.memories) ? raw.memories : [];
  return memories.map(toMemoryEntry).filter((entry): entry is MemoryEntry => !!entry);
}

function entryBody(entry: MemoryEntry): Record<string, unknown> {
  const metadata = {
    ...(entry.metadata ?? {}),
    ...(entry.source ? { source: entry.source } : {}),
  };
  return {
    content: entry.content,
    tags: entry.tags,
    metadata,
    agent_id: entry.agentId ?? agentId(),
    session_id: entry.sessionId,
    memory_type: entry.memoryType,
    sync: true,
  };
}

/**
 * mem9 persistent cloud memory provider.
 *
 * Hosted mem9 now uses `v1alpha2` for normal memory operations:
 * `X-API-Key` identifies the memory space, and `X-Mnemo-Agent-Id` attributes
 * writes/imports to the Help & Grow platform agent. We still provision new
 * per-expert keys via `POST /v1alpha1/mem9s`, as recommended by mem9's hosted
 * API docs.
 */
export class Mem9Provider implements MemoryProvider {
  async createSpace(): Promise<string> {
    const res = await fetch(legacyProvisionUrl(), { method: "POST" });
    const data = await readJson(res);
    if (!res.ok) {
      throw new Error(`mem9 createSpace failed (${res.status})`);
    }
    const id = asObject(data)?.id;
    if (typeof id !== "string" || !id) {
      throw new Error("mem9 createSpace returned no API key");
    }
    return id;
  }

  async store(spaceId: string, entry: MemoryEntry): Promise<string> {
    const res = await fetch(hostedUrl("/memories"), {
      method: "POST",
      headers: jsonHeaders(spaceId),
      body: JSON.stringify(entryBody(entry)),
    });
    const data = await readJson(res);
    if (!res.ok) throw new Error(`mem9 store failed (${res.status})`);
    return memoryIdFromCreateResponse(data);
  }

  async search(
    spaceId: string,
    query: string,
    limit = 10,
  ): Promise<MemoryEntry[]> {
    const params = new URLSearchParams({
      q: query,
      limit: String(limit),
    });
    const res = await fetch(hostedUrl(`/memories?${params}`), {
      headers: authHeaders(spaceId),
    });
    const data = await readJson(res);
    if (!res.ok) throw new Error(`mem9 search failed (${res.status})`);
    return memorySearchResults(data);
  }

  async get(spaceId: string, memoryId: string): Promise<MemoryEntry | null> {
    const res = await fetch(
      hostedUrl(`/memories/${encodeURIComponent(memoryId)}`),
      { headers: authHeaders(spaceId) },
    );
    if (res.status === 404) return null;
    const data = await readJson(res);
    if (!res.ok) throw new Error(`mem9 get failed (${res.status})`);
    return toMemoryEntry(data);
  }

  async update(
    spaceId: string,
    memoryId: string,
    content: string,
  ): Promise<void> {
    const res = await fetch(
      hostedUrl(`/memories/${encodeURIComponent(memoryId)}`),
      {
        method: "PUT",
        headers: jsonHeaders(spaceId),
        body: JSON.stringify({ content }),
      },
    );
    if (!res.ok) throw new Error(`mem9 update failed (${res.status})`);
  }

  async delete(spaceId: string, memoryId: string): Promise<void> {
    const res = await fetch(
      hostedUrl(`/memories/${encodeURIComponent(memoryId)}`),
      {
        method: "DELETE",
        headers: authHeaders(spaceId),
      },
    );
    if (!res.ok) throw new Error(`mem9 delete failed (${res.status})`);
  }

  async importFile(
    spaceId: string,
    file: Buffer | Uint8Array,
    meta: ImportMeta,
  ): Promise<string> {
    const formData = new FormData();
    formData.append("file", new Blob([new Uint8Array(file)]), "upload.json");
    formData.append("file_type", meta.fileType);
    formData.append("agent_id", meta.agentId ?? agentId());
    if (meta.sessionId) formData.append("session_id", meta.sessionId);

    const res = await fetch(hostedUrl("/imports"), {
      method: "POST",
      headers: authHeaders(spaceId),
      body: formData,
    });
    const data = await readJson(res);
    if (!res.ok) throw new Error(`mem9 import failed (${res.status})`);
    const id = asObject(data)?.id;
    return typeof id === "string" ? id : "accepted";
  }
}
