import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import {
  AI_PROVIDER_CATALOG,
  ALL_AI_PROVIDERS,
} from "@/lib/ai/provider-catalog";
import { invalidateCache } from "@/lib/admin/provider-registry";

/**
 * Idempotent seeder that mirrors the hard-coded `AI_PROVIDER_CATALOG` and
 * the storage switch in `src/lib/storage/index.ts` into the new
 * `ProviderRegistry` table. Safe to re-run.
 *
 * Strategy: only seeds rows that don't exist yet. Existing rows are
 * preserved so that operator edits via `/admin/providers` are not
 * clobbered. Run on first deploy + opt-in via:
 *   `npx tsx scripts/seed-provider-registry.ts` (or equivalent)
 *
 * Phase 1 leaves the storage seed list aligned with the current
 * `StorageProviderName` switch.
 */
export async function seedProviderRegistryIfEmpty(): Promise<{
  inserted: number;
  skipped: number;
}> {
  let inserted = 0;
  let skipped = 0;

  // ----- LLM providers ----------------------------------------------------
  let order = 0;
  for (const key of ALL_AI_PROVIDERS) {
    const meta = AI_PROVIDER_CATALOG[key];
    const existing = await safeFindUnique("llm", key);
    if (existing) {
      skipped++;
      order++;
      continue;
    }

    // Build envKeys map from `requiredAny` + `optional`. The first group of
    // `requiredAny` is treated as the canonical primary credential set;
    // additional groups are stored under `metadata.requiredAny` so the
    // alternative-credential semantics (e.g. Vertex SA fallback) survive.
    const envKeys: Record<string, string> = {};
    const primaryGroup = meta.requiredAny[0] ?? [];
    for (const envName of primaryGroup) {
      const slot = inferEnvSlot(envName);
      envKeys[slot] = envName;
    }
    for (const envName of meta.optional) {
      const slot = inferEnvSlot(envName);
      if (!envKeys[slot]) envKeys[slot] = envName;
    }

    const models: Record<string, { envKey?: string; default?: string | null }> =
      {};
    if (meta.textModelEnvKey || meta.defaultTextModel) {
      models.text = {
        envKey: meta.textModelEnvKey,
        default: meta.defaultTextModel ?? null,
      };
    }
    if (meta.imageModelEnvKey || meta.defaultImageModel) {
      models.image = {
        envKey: meta.imageModelEnvKey,
        default: meta.defaultImageModel ?? null,
      };
    }

    await prisma.providerRegistry.create({
      data: {
        category: "llm",
        key,
        displayName: meta.label,
        enabled: true,
        envKeys: envKeys as Prisma.InputJsonValue,
        models: models as Prisma.InputJsonValue,
        metadata: {
          description: meta.description,
          requiredAny: meta.requiredAny,
          optional: meta.optional,
          supportsImage: meta.supportsImage,
          capabilities: meta.supportsImage ? ["text", "image"] : ["text"],
        } as Prisma.InputJsonValue,
        sortOrder: order,
      },
    });
    inserted++;
    order++;
  }

  // ----- Storage providers ------------------------------------------------
  const storageSeed: Array<{
    key: string;
    displayName: string;
    envKeys: Record<string, string>;
    metadata: Record<string, unknown>;
  }> = [
    {
      key: "vercel",
      displayName: "Vercel Blob",
      envKeys: { token: "BLOB_READ_WRITE_TOKEN" },
      metadata: {
        description: "Vercel-hosted blob storage. Fastest path on Vercel.",
        requiredAny: [["BLOB_READ_WRITE_TOKEN"]],
      },
    },
    {
      key: "gcs",
      displayName: "Google Cloud Storage",
      envKeys: {
        bucket: "GCS_BUCKET",
        projectId: "GOOGLE_CLOUD_PROJECT",
        serviceAccountKey: "GOOGLE_SERVICE_ACCOUNT_KEY",
      },
      metadata: {
        description: "GCS bucket. Used by the asia-southeast1 deployment.",
        requiredAny: [["GCS_BUCKET", "GOOGLE_CLOUD_PROJECT"]],
      },
    },
    {
      key: "tencent-cos",
      displayName: "Tencent COS",
      envKeys: {
        secretId: "TENCENT_COS_SECRET_ID",
        secretKey: "TENCENT_COS_SECRET_KEY",
        bucket: "TENCENT_COS_BUCKET",
        region: "TENCENT_COS_REGION",
      },
      metadata: {
        description:
          "Tencent COS bucket. Auto-selected for WeChat-originated traffic.",
        requiredAny: [
          [
            "TENCENT_COS_SECRET_ID",
            "TENCENT_COS_SECRET_KEY",
            "TENCENT_COS_BUCKET",
            "TENCENT_COS_REGION",
          ],
        ],
      },
    },
    {
      key: "db",
      displayName: "Database (legacy)",
      envKeys: {},
      metadata: {
        description: "Stores small payloads inline as data URLs. No env keys.",
        requiredAny: [[]],
      },
    },
  ];

  let storageOrder = 0;
  for (const item of storageSeed) {
    const existing = await safeFindUnique("storage", item.key);
    if (existing) {
      skipped++;
      storageOrder++;
      continue;
    }
    await prisma.providerRegistry.create({
      data: {
        category: "storage",
        key: item.key,
        displayName: item.displayName,
        enabled: true,
        envKeys: item.envKeys as Prisma.InputJsonValue,
        models: {} as Prisma.InputJsonValue,
        metadata: item.metadata as Prisma.InputJsonValue,
        sortOrder: storageOrder,
      },
    });
    inserted++;
    storageOrder++;
  }

  if (inserted > 0) invalidateCache();
  return { inserted, skipped };
}

/**
 * Map an env-var name like `OPENAI_API_KEY` → semantic slot `apiKey`.
 * Best-effort; falls back to a normalized form of the env name itself.
 */
function inferEnvSlot(envName: string): string {
  const upper = envName.toUpperCase();
  if (upper.endsWith("_API_KEY") || upper === "DASHSCOPE_API_KEY") return "apiKey";
  if (upper.endsWith("_BASE_URL")) return "baseUrl";
  if (upper.includes("VERTEX_LOCATION") || upper.endsWith("_LOCATION"))
    return "location";
  if (upper === "GOOGLE_CLOUD_PROJECT") return "projectId";
  if (upper === "GOOGLE_SERVICE_ACCOUNT_KEY") return "serviceAccountKey";
  if (upper === "VOICE_CHAT_DEFAULT_VOICE") return "defaultVoice";
  // Fallback: lower-case the env name so it's still useful as a JSON slot.
  return envName.toLowerCase();
}

async function safeFindUnique(category: string, key: string) {
  try {
    return await prisma.providerRegistry.findUnique({
      where: { category_key: { category, key } },
    });
  } catch {
    return null;
  }
}
