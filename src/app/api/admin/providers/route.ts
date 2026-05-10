import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { isErrorResponse, requireAdmin } from "@/lib/admin-auth";
import {
  ALL_VOICE_PROVIDERS,
  computeProviderHealth,
  computeProviderHealthFromRuntime,
  getActiveAIProviderName,
  getActiveImageProviderChain,
  getActiveVoiceProviderChain,
  IMAGE_FALLBACK_ORDER,
  VOICE_FALLBACK_ORDER,
} from "@/lib/ai/provider-catalog";
import {
  listProviders,
  upsertProvider,
  type ProviderRegistryRow,
} from "@/lib/admin/provider-registry";
import { getActiveStorageProviderName } from "@/lib/storage";
import { setSystemConfig } from "@/lib/system-config";
import {
  getManagedVercelProjectConfig,
  listManagedProjectEnvs,
  triggerManagedProjectDeploy,
  upsertManagedProjectEnv,
} from "@/lib/vercel-admin";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Phase 1 unified admin Providers API. Replaces (and proxies for)
 * `/api/admin/ai-provider` + `/api/admin/system-config`. Reads the new
 * `ProviderRegistry` table; writes both the registry rows and the
 * existing `SystemConfig` keys (active selections + chains) so other
 * code paths keep working unchanged.
 */

const upsertSchema = z.object({
  category: z.string().min(1),
  key: z.string().min(1),
  displayName: z.string().min(1),
  enabled: z.boolean().optional(),
  envKeys: z.record(z.string(), z.string()).optional(),
  models: z
    .record(
      z.string(),
      z
        .object({
          envKey: z.string().optional(),
          default: z.string().nullable().optional(),
        })
        .partial(),
    )
    .optional(),
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
  sortOrder: z.number().int().optional(),
});

const bodySchema = z.object({
  activeLlm: z.string().optional(),
  llmTextChain: z.union([z.string(), z.array(z.string())]).optional(),
  llmImageChain: z.union([z.string(), z.array(z.string())]).optional(),
  llmVoiceChain: z.union([z.string(), z.array(z.string())]).optional(),
  activeStorage: z.enum(["vercel", "gcs", "tencent-cos", "db"]).optional(),
  providerUpserts: z.array(upsertSchema).optional(),
  triggerDeploy: z.boolean().optional(),
});

function chainToString(input: string | string[] | undefined): string | null {
  if (input === undefined) return null;
  const arr = Array.isArray(input) ? input : input.split(",");
  return arr
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t.length > 0)
    .join(",");
}

function parseDbHostFromUrl(url: string | undefined): string | null {
  if (!url) return null;
  try {
    // Treat postgres:// as a URL — host[:port][/db] without exposing creds.
    const u = new URL(url.replace(/^postgres(ql)?:\/\//, "https://"));
    const host = u.hostname;
    const port = u.port ? `:${u.port}` : "";
    const dbName = u.pathname && u.pathname !== "/" ? u.pathname : "";
    return `${host}${port}${dbName}`;
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (isErrorResponse(auth)) return auth;

  const cfg = getManagedVercelProjectConfig();
  const [llmRows, storageRows, activeLlm, activeStorage, imageChain, voiceChain] =
    await Promise.all([
      listProviders("llm"),
      listProviders("storage"),
      getActiveAIProviderName(),
      getActiveStorageProviderName(),
      getActiveImageProviderChain(),
      getActiveVoiceProviderChain(),
    ]);

  let providerHealth: Record<string, unknown>;
  if (cfg) {
    try {
      const envVars = await listManagedProjectEnvs(cfg);
      const productionKeys = new Set(
        envVars
          .filter((item) => item.target?.includes("production"))
          .map((item) => item.key),
      );
      providerHealth = computeProviderHealth(productionKeys);
    } catch {
      providerHealth = computeProviderHealthFromRuntime();
    }
  } else {
    providerHealth = computeProviderHealthFromRuntime();
  }

  const dbHost = parseDbHostFromUrl(
    process.env.DATABASE_URL || process.env.DIRECT_URL,
  );

  return NextResponse.json({
    llm: llmRows,
    storage: storageRows,
    db: {
      provider: process.env.DB_PROVIDER || "cloudsql",
      host: dbHost,
    },
    active: {
      llm: activeLlm,
      storage: activeStorage,
      llmImageChain: imageChain,
      llmVoiceChain: voiceChain,
    },
    defaults: {
      llmImageChain: [...IMAGE_FALLBACK_ORDER],
      llmVoiceChain: [...VOICE_FALLBACK_ORDER],
      voiceOptions: [...ALL_VOICE_PROVIDERS],
    },
    providerHealth,
    canManage: Boolean(cfg),
    deployHookConfigured: Boolean(cfg?.deployHookUrl),
  });
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (isErrorResponse(auth)) return auth;

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid JSON body", issues: parsed.error.format() },
      { status: 400 },
    );
  }

  const cfg = getManagedVercelProjectConfig();
  const updatedKeys: string[] = [];
  const upserted: ProviderRegistryRow[] = [];

  // 1. Apply registry upserts (new providers / metadata edits).
  for (const item of parsed.data.providerUpserts ?? []) {
    const row = await upsertProvider(item);
    upserted.push(row);
  }

  // 2. Active LLM provider selection.
  if (parsed.data.activeLlm) {
    await setSystemConfig("AI_PROVIDER", parsed.data.activeLlm);
    if (cfg) await upsertManagedProjectEnv(cfg, "AI_PROVIDER", parsed.data.activeLlm);
    updatedKeys.push("AI_PROVIDER");
  }

  // 3. Chain configs.
  const textChain = chainToString(parsed.data.llmTextChain);
  if (textChain !== null) {
    await setSystemConfig("AI_TEXT_PROVIDER_CHAIN", textChain);
    if (cfg) await upsertManagedProjectEnv(cfg, "AI_TEXT_PROVIDER_CHAIN", textChain);
    updatedKeys.push("AI_TEXT_PROVIDER_CHAIN");
  }
  const imgChain = chainToString(parsed.data.llmImageChain);
  if (imgChain !== null) {
    await setSystemConfig("IMAGE_PROVIDER_CHAIN", imgChain);
    if (cfg) await upsertManagedProjectEnv(cfg, "IMAGE_PROVIDER_CHAIN", imgChain);
    updatedKeys.push("IMAGE_PROVIDER_CHAIN");
  }
  const voiceChain = chainToString(parsed.data.llmVoiceChain);
  if (voiceChain !== null) {
    await setSystemConfig("VOICE_PROVIDER_CHAIN", voiceChain);
    if (cfg) await upsertManagedProjectEnv(cfg, "VOICE_PROVIDER_CHAIN", voiceChain);
    updatedKeys.push("VOICE_PROVIDER_CHAIN");
  }

  // 4. Active storage provider.
  if (parsed.data.activeStorage) {
    await setSystemConfig("STORAGE_PROVIDER", parsed.data.activeStorage);
    if (cfg)
      await upsertManagedProjectEnv(cfg, "STORAGE_PROVIDER", parsed.data.activeStorage);
    updatedKeys.push("STORAGE_PROVIDER");
  }

  let deployTriggered = false;
  if (cfg && parsed.data.triggerDeploy !== false && updatedKeys.length > 0) {
    const deploy = await triggerManagedProjectDeploy(cfg);
    deployTriggered = deploy.triggered;
  }

  return NextResponse.json({
    ok: true,
    updatedKeys: Array.from(new Set(updatedKeys)).sort(),
    upserted: upserted.map((r) => ({ category: r.category, key: r.key })),
    deployTriggered,
  });
}
