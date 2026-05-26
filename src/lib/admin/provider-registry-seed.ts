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
/**
 * Refresh the *structural* metadata on an existing registry row from the
 * catalog: displayName, description, env-key map, model env-key slots,
 * capabilities. Preserve every value an operator can edit via /admin/providers
 * (currently `models.*.default` and `enabled`).
 *
 * Called on every admin page load via ensureProviderSeed so that catalog
 * evolution (renames, new image-model slots, capability flags) flows to the
 * DB without manual SQL — but operator edits are never clobbered.
 */
async function refreshLlmMetadata(): Promise<{ refreshed: number }> {
  let refreshed = 0;
  for (const key of ALL_AI_PROVIDERS) {
    const meta = AI_PROVIDER_CATALOG[key];
    const existing = await safeFindUnique("llm", key);
    if (!existing) continue; // insert-path handles fresh rows

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

    // Preserve operator-edited model defaults; only refresh the envKey slot
    // (and create the slot if it didn't exist before, e.g. byteplus/volcengine
    // image fields added after the original seed).
    const existingModels =
      (existing.models as Record<string, { envKey?: string; default?: string | null }> | null) ??
      {};
    const models: Record<string, { envKey?: string; default?: string | null }> = {};
    if (meta.textModelEnvKey || meta.defaultTextModel) {
      models.text = {
        envKey: meta.textModelEnvKey,
        default:
          existingModels.text?.default !== undefined
            ? existingModels.text.default
            : meta.defaultTextModel ?? null,
      };
    }
    if (meta.imageModelEnvKey || meta.defaultImageModel) {
      models.image = {
        envKey: meta.imageModelEnvKey,
        default:
          existingModels.image?.default !== undefined
            ? existingModels.image.default
            : meta.defaultImageModel ?? null,
      };
    }

    const newMetadata = {
      description: meta.description,
      requiredAny: meta.requiredAny,
      optional: meta.optional,
      supportsImage: meta.supportsImage,
      capabilities: meta.supportsImage ? ["text", "image"] : ["text"],
    };

    // Skip the write if nothing actually changed — cheap idempotency.
    const sameDisplayName = existing.displayName === meta.label;
    const sameEnvKeys =
      JSON.stringify(existing.envKeys) === JSON.stringify(envKeys);
    const sameModels =
      JSON.stringify(existing.models) === JSON.stringify(models);
    const sameMetadata =
      JSON.stringify(existing.metadata) === JSON.stringify(newMetadata);
    if (sameDisplayName && sameEnvKeys && sameModels && sameMetadata) continue;

    await prisma.providerRegistry.update({
      where: { id: existing.id },
      data: {
        displayName: meta.label,
        envKeys: envKeys as Prisma.InputJsonValue,
        models: models as Prisma.InputJsonValue,
        metadata: newMetadata as Prisma.InputJsonValue,
      },
    });
    refreshed++;
  }
  return { refreshed };
}

export async function seedProviderRegistryIfEmpty(): Promise<{
  inserted: number;
  skipped: number;
  refreshed: number;
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

  // ----- Voice/TTS providers (Phase 3) -----------------------------------
  // Voice keys live in the LLM category but are tagged with capability
  // "voice" so the chain-picker UI can filter them out of text/image lists.
  const voiceSeed: Array<{
    key: string;
    displayName: string;
    envKeys: Record<string, string>;
    metadata: Record<string, unknown>;
    enabled?: boolean;
    models?: Record<string, { envKey?: string; default?: string | null }>;
  }> = [
    {
      key: "qwen-tts",
      displayName: "Qwen / DashScope TTS (CosyVoice)",
      envKeys: { apiKey: "DASHSCOPE_API_KEY" },
      metadata: {
        description: "DashScope CosyVoice TTS.",
        capabilities: ["voice"],
        requiredAny: [["DASHSCOPE_API_KEY"]],
      },
      enabled: true,
    },
    {
      key: "gemini-tts",
      displayName: "Gemini TTS",
      envKeys: {
        projectId: "GOOGLE_CLOUD_PROJECT",
        serviceAccountKey: "GOOGLE_SERVICE_ACCOUNT_KEY",
      },
      metadata: {
        description: "Google Gemini TTS via Vertex AI.",
        capabilities: ["voice"],
        requiredAny: [["GOOGLE_CLOUD_PROJECT", "GOOGLE_SERVICE_ACCOUNT_KEY"]],
      },
      enabled: true,
    },
    {
      key: "openai-tts",
      displayName: "OpenAI TTS",
      envKeys: { apiKey: "OPENAI_API_KEY" },
      models: { text: { envKey: "OPENAI_TTS_MODEL", default: "tts-1" } },
      metadata: {
        description: "OpenAI text-to-speech (tts-1, tts-1-hd).",
        capabilities: ["voice"],
        requiredAny: [["OPENAI_API_KEY"]],
      },
      enabled: true,
    },
    {
      key: "hunyuan-tts",
      displayName: "Tencent Hunyuan TTS",
      envKeys: { apiKey: "HUNYUAN_API_KEY" },
      metadata: {
        description: "Placeholder — Tencent Hunyuan TTS adapter not shipped yet.",
        capabilities: ["voice"],
        requiredAny: [["HUNYUAN_API_KEY"]],
      },
      enabled: false,
    },
  ];

  let voiceOrder = 100; // keep voice keys after text llm keys
  for (const item of voiceSeed) {
    const existing = await safeFindUnique("llm", item.key);
    if (existing) {
      skipped++;
      voiceOrder++;
      continue;
    }
    await prisma.providerRegistry.create({
      data: {
        category: "llm",
        key: item.key,
        displayName: item.displayName,
        enabled: item.enabled ?? true,
        envKeys: item.envKeys as Prisma.InputJsonValue,
        models: (item.models ?? {}) as Prisma.InputJsonValue,
        metadata: item.metadata as Prisma.InputJsonValue,
        sortOrder: voiceOrder,
      },
    });
    inserted++;
    voiceOrder++;
  }

  // Always refresh structural metadata for existing rows so catalog evolution
  // (renamed labels, new image-model slots, capability flags) lands without a
  // manual migration. Operator-edited model defaults are preserved by
  // refreshLlmMetadata's merge logic.
  const { refreshed } = await refreshLlmMetadata();

  if (inserted > 0 || refreshed > 0) invalidateCache();
  return { inserted, skipped, refreshed };
}

/**
 * Phase 3: seed the default `ProviderRoutingScope` rows and a baseline
 * (empty) `ProviderRouteOverride` table. Idempotent — only inserts when
 * a `(scopeKey, category, environment)` row is missing.
 */
export async function seedRoutingScopesIfEmpty(
  environment: string = "production",
): Promise<{ inserted: number; skipped: number }> {
  let inserted = 0;
  let skipped = 0;

  type SeedScope = {
    scopeKey: string;
    displayName: string;
    description?: string;
    category: "llm" | "image" | "voice";
    chain: string[];
    matchRules: Record<string, unknown>;
    priority: number;
  };

  const scopes: SeedScope[] = [
    // ----- LLM ----------------------------------------------------------
    {
      scopeKey: "web-default",
      displayName: "Web / Telegram default",
      description: "Catch-all for non-WeChat traffic.",
      category: "llm",
      chain: ["qwen", "gemini"],
      matchRules: {},
      priority: 200,
    },
    {
      scopeKey: "wechat-intl",
      displayName: "WeChat (international stack)",
      description: "WeChat-Intl traffic. Hunyuan only — no cross-cloud fallback.",
      category: "llm",
      chain: ["hunyuan"],
      matchRules: { isWeChat: true, region: "intl" },
      priority: 100,
    },
    {
      scopeKey: "wechat-cn",
      displayName: "WeChat (mainland China stack)",
      description: "WeChat-CN traffic. Hunyuan only.",
      category: "llm",
      chain: ["hunyuan"],
      matchRules: { isWeChat: true, region: "cn" },
      priority: 100,
    },
    // ----- IMAGE --------------------------------------------------------
    {
      scopeKey: "web-default",
      displayName: "Web / Telegram image default",
      description: "Catch-all image chain.",
      category: "image",
      chain: ["qwen", "gemini", "openai"],
      matchRules: {},
      priority: 200,
    },
    {
      scopeKey: "wechat-intl",
      displayName: "WeChat-Intl images",
      category: "image",
      chain: ["qwen", "gemini"],
      matchRules: { isWeChat: true, region: "intl" },
      priority: 100,
    },
    {
      scopeKey: "wechat-cn",
      displayName: "WeChat-CN images",
      category: "image",
      chain: ["qwen"],
      matchRules: { isWeChat: true, region: "cn" },
      priority: 100,
    },
    // ----- VOICE --------------------------------------------------------
    {
      scopeKey: "web-default",
      displayName: "Web / Telegram voice default",
      category: "voice",
      chain: ["qwen-tts", "gemini-tts"],
      matchRules: {},
      priority: 200,
    },
    {
      scopeKey: "wechat-intl",
      displayName: "WeChat-Intl voice",
      category: "voice",
      chain: ["qwen-tts"],
      matchRules: { isWeChat: true, region: "intl" },
      priority: 100,
    },
    {
      scopeKey: "wechat-cn",
      displayName: "WeChat-CN voice",
      category: "voice",
      chain: ["qwen-tts"],
      matchRules: { isWeChat: true, region: "cn" },
      priority: 100,
    },
  ];

  for (const s of scopes) {
    try {
      const existing = await prisma.providerRoutingScope.findUnique({
        where: {
          scopeKey_category_environment: {
            scopeKey: s.scopeKey,
            category: s.category,
            environment,
          },
        },
      });
      if (existing) {
        skipped++;
        continue;
      }
      await prisma.providerRoutingScope.create({
        data: {
          scopeKey: s.scopeKey,
          displayName: s.displayName,
          description: s.description ?? null,
          category: s.category,
          chain: s.chain as unknown as Prisma.InputJsonValue,
          enabled: true,
          matchRules: s.matchRules as Prisma.InputJsonValue,
          priority: s.priority,
          environment,
        },
      });
      inserted++;
    } catch (err) {
      console.warn(
        `[seed routing scope] ${s.category}:${s.scopeKey} failed:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

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
