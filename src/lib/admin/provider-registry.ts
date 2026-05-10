import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * DB-backed provider registry. Mirrors the cache pattern in
 * `src/lib/system-config.ts` (60s TTL, in-memory). Adding a new LLM or
 * storage provider should be a single registry-row insert + thin adapter.
 */

const CACHE_TTL = 60 * 1000;

export type ProviderCategory = "llm" | "storage" | (string & {});

export type ProviderModelSpec = {
  envKey?: string;
  default?: string | null;
};

export type ProviderEnvKeys = Record<string, string>;

export type ProviderModelsConfig = Partial<{
  text: ProviderModelSpec;
  image: ProviderModelSpec;
  voice: ProviderModelSpec;
}> &
  Record<string, ProviderModelSpec | undefined>;

export type ProviderMetadata = {
  description?: string;
  capabilities?: string[];
  /** `requiredAny` → at least one of these env-key groups must be fully set */
  requiredAny?: string[][];
  optional?: string[];
  supportsImage?: boolean;
  region?: string;
  notes?: string;
} & Record<string, unknown>;

export type ProviderRegistryRow = {
  id: string;
  category: string;
  key: string;
  displayName: string;
  enabled: boolean;
  envKeys: ProviderEnvKeys;
  models: ProviderModelsConfig;
  metadata: ProviderMetadata | null;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
};

type CacheEntry = { rows: ProviderRegistryRow[]; expires: number };
const listCache: Record<string, CacheEntry> = {};

function coerceRow(row: {
  id: string;
  category: string;
  key: string;
  displayName: string;
  enabled: boolean;
  envKeys: unknown;
  models: unknown;
  metadata: unknown;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}): ProviderRegistryRow {
  return {
    id: row.id,
    category: row.category,
    key: row.key,
    displayName: row.displayName,
    enabled: row.enabled,
    envKeys: (row.envKeys ?? {}) as ProviderEnvKeys,
    models: (row.models ?? {}) as ProviderModelsConfig,
    metadata: (row.metadata ?? null) as ProviderMetadata | null,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function listProviders(
  category: ProviderCategory,
  opts: { enabledOnly?: boolean; force?: boolean } = {},
): Promise<ProviderRegistryRow[]> {
  const cacheKey = `${category}:${opts.enabledOnly ? "enabled" : "all"}`;
  const now = Date.now();
  if (!opts.force) {
    const cached = listCache[cacheKey];
    if (cached && cached.expires > now) return cached.rows;
  }

  try {
    const rows = await prisma.providerRegistry.findMany({
      where: {
        category,
        ...(opts.enabledOnly ? { enabled: true } : {}),
      },
      orderBy: [{ sortOrder: "asc" }, { key: "asc" }],
    });
    const mapped = rows.map(coerceRow);
    listCache[cacheKey] = { rows: mapped, expires: now + CACHE_TTL };
    return mapped;
  } catch (err) {
    // DB not ready / table missing → callers fall back to hard-coded constants.
    console.warn(
      `[ProviderRegistry] listProviders(${category}) failed:`,
      err instanceof Error ? err.message : err,
    );
    return [];
  }
}

export async function getProvider(
  category: ProviderCategory,
  key: string,
): Promise<ProviderRegistryRow | null> {
  try {
    const row = await prisma.providerRegistry.findUnique({
      where: { category_key: { category, key } },
    });
    return row ? coerceRow(row) : null;
  } catch (err) {
    console.warn(
      `[ProviderRegistry] getProvider(${category}, ${key}) failed:`,
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

export type UpsertProviderInput = {
  category: string;
  key: string;
  displayName: string;
  enabled?: boolean;
  envKeys?: ProviderEnvKeys;
  models?: ProviderModelsConfig;
  metadata?: ProviderMetadata | null;
  sortOrder?: number;
};

export async function upsertProvider(
  input: UpsertProviderInput,
): Promise<ProviderRegistryRow> {
  // Prisma's JSON columns are typed as InputJsonValue; cast our typed
  // shapes through `unknown` so we don't have to widen the public API.
  // Nullable JSON fields require `Prisma.JsonNull` (not raw `null`).
  const envKeysJson = (input.envKeys ?? {}) as Prisma.InputJsonValue;
  const modelsJson = (input.models ?? {}) as Prisma.InputJsonValue;
  const metaForCreate: Prisma.InputJsonValue | typeof Prisma.JsonNull =
    input.metadata == null
      ? Prisma.JsonNull
      : (input.metadata as Prisma.InputJsonValue);
  const metaForUpdate: Prisma.InputJsonValue | typeof Prisma.JsonNull =
    input.metadata == null
      ? Prisma.JsonNull
      : (input.metadata as Prisma.InputJsonValue);

  const row = await prisma.providerRegistry.upsert({
    where: { category_key: { category: input.category, key: input.key } },
    create: {
      category: input.category,
      key: input.key,
      displayName: input.displayName,
      enabled: input.enabled ?? true,
      envKeys: envKeysJson,
      models: modelsJson,
      metadata: metaForCreate,
      sortOrder: input.sortOrder ?? 0,
    },
    update: {
      displayName: input.displayName,
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
      ...(input.envKeys !== undefined ? { envKeys: envKeysJson } : {}),
      ...(input.models !== undefined ? { models: modelsJson } : {}),
      ...(input.metadata !== undefined ? { metadata: metaForUpdate } : {}),
      ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
    },
  });
  invalidateCache();
  return coerceRow(row);
}

export async function setEnabled(
  category: string,
  key: string,
  enabled: boolean,
): Promise<void> {
  await prisma.providerRegistry.update({
    where: { category_key: { category, key } },
    data: { enabled },
  });
  invalidateCache();
}

export function invalidateCache(): void {
  for (const k of Object.keys(listCache)) delete listCache[k];
}
