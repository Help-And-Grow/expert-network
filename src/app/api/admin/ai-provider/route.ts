import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { isErrorResponse, requireAdmin } from "@/lib/admin-auth";
import {
  AI_PROVIDER_CATALOG,
  ALL_AI_PROVIDERS,
  ALL_VOICE_PROVIDERS,
  computeProviderHealth,
  getActiveAIProviderName,
  getActiveImageProviderChain,
  getActiveVoiceProviderChain,
  getProviderModelState,
  IMAGE_FALLBACK_ORDER,
  normalizeAIProviderName,
  VOICE_FALLBACK_ORDER,
  type AIProviderName,
  type VoiceProviderName,
} from "@/lib/ai/provider-catalog";
import {
  getManagedVercelProjectConfig,
  listManagedProjectEnvs,
  triggerManagedProjectDeploy,
  upsertManagedProjectEnv,
} from "@/lib/vercel-admin";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const modelInputSchema = z
  .object({
    textModel: z.string().trim().max(128).optional(),
    imageModel: z.string().trim().max(128).optional(),
  })
  .partial();

const bodySchema = z.object({
  provider: z.string().trim().optional(),
  triggerDeploy: z.boolean().optional(),
  providerModels: z.record(z.string(), modelInputSchema).optional(),
  /** Comma-separated or array — image provider chain. Empty string clears it (revert to default). */
  imageProviderChain: z.union([z.string(), z.array(z.string())]).optional(),
  /** Comma-separated or array — voice (TTS) provider chain. Empty string clears it. */
  voiceProviderChain: z.union([z.string(), z.array(z.string())]).optional(),
});

function normalizeChainInput<T extends string>(
  raw: string | string[] | undefined,
  allowed: readonly T[],
): T[] | null {
  if (raw === undefined) return null;
  const tokens = Array.isArray(raw) ? raw : raw.split(",");
  const seen = new Set<T>();
  for (const token of tokens) {
    const value = token.trim().toLowerCase();
    if (!value) continue;
    const match = allowed.find((v) => v === value);
    if (match) seen.add(match);
  }
  return Array.from(seen);
}

async function providerDescriptor(provider: AIProviderName) {
  const meta = AI_PROVIDER_CATALOG[provider];
  const modelState = await getProviderModelState(provider);
  return {
    name: provider,
    label: meta.label,
    description: meta.description,
    requiredAny: meta.requiredAny,
    optional: meta.optional,
    supportsImage: meta.supportsImage,
    textModelEnvKey: modelState.textModelEnvKey,
    imageModelEnvKey: modelState.imageModelEnvKey,
    defaultTextModel: meta.defaultTextModel ?? null,
    defaultImageModel: meta.defaultImageModel ?? null,
    textModel: modelState.textModel,
    imageModel: modelState.imageModel,
  };
}

function nonEmpty(value?: string | null): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (isErrorResponse(auth)) return auth;

  const cfg = getManagedVercelProjectConfig();
  const currentProvider = await getActiveAIProviderName();
  const providers = await Promise.all(ALL_AI_PROVIDERS.map(providerDescriptor));
  const imageChain = await getActiveImageProviderChain();
  const voiceChain = await getActiveVoiceProviderChain();

  const baseResponse = {
    currentProvider,
    providers,
    imageProviderChain: imageChain,
    voiceProviderChain: voiceChain,
    imageProviderChainDefault: [...IMAGE_FALLBACK_ORDER],
    voiceProviderChainDefault: [...VOICE_FALLBACK_ORDER],
    voiceProviderOptions: [...ALL_VOICE_PROVIDERS],
    /** @deprecated kept for older clients — same as imageProviderChain */
    imageFallbackOrder: imageChain,
  };

  if (!cfg) {
    return NextResponse.json({
      ...baseResponse,
      canManage: false,
      notice:
        "Database-only mode. Set VERCEL_MANAGEMENT_TOKEN to also sync with Vercel environment variables.",
    });
  }

  const envVars = await listManagedProjectEnvs(cfg);
  const productionKeys = new Set(
    envVars
      .filter((item) => item.target?.includes("production"))
      .map((item) => item.key),
  );

  return NextResponse.json({
    ...baseResponse,
    canManage: true,
    managedProject: cfg.project,
    managedTeamId: cfg.teamId,
    deployHookConfigured: Boolean(cfg.deployHookUrl),
    providerHealth: computeProviderHealth(productionKeys),
  });
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (isErrorResponse(auth)) return auth;

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { setSystemConfig } = await import("@/lib/system-config");
  const currentProvider = await getActiveAIProviderName();
  const provider = normalizeAIProviderName(parsed.data.provider) ?? currentProvider;
  const providerModels = parsed.data.providerModels ?? {};
  
  const updatedKeys = new Set<string>(["AI_PROVIDER"]);
  const providersToUpdate = new Set<AIProviderName>([provider]);

  // 1. Update Database Config (Primary for Cloud Run / Multi-Cloud)
  await setSystemConfig("AI_PROVIDER", provider);

  // 2. Update Vercel Env if configured (Optional sync)
  const cfg = getManagedVercelProjectConfig();
  if (cfg) {
    await upsertManagedProjectEnv(cfg, "AI_PROVIDER", provider);
  }

  // 3. Image + voice chains — comma-separated lists driving the per-modality
  // fallback order. Empty input clears the override (reverts to defaults).
  const imageChain = normalizeChainInput(parsed.data.imageProviderChain, ALL_AI_PROVIDERS);
  if (imageChain !== null) {
    const value = imageChain.join(",");
    await setSystemConfig("IMAGE_PROVIDER_CHAIN", value);
    if (cfg) await upsertManagedProjectEnv(cfg, "IMAGE_PROVIDER_CHAIN", value);
    updatedKeys.add("IMAGE_PROVIDER_CHAIN");
  }

  const voiceChain = normalizeChainInput<VoiceProviderName>(
    parsed.data.voiceProviderChain,
    ALL_VOICE_PROVIDERS,
  );
  if (voiceChain !== null) {
    const value = voiceChain.join(",");
    await setSystemConfig("VOICE_PROVIDER_CHAIN", value);
    if (cfg) await upsertManagedProjectEnv(cfg, "VOICE_PROVIDER_CHAIN", value);
    updatedKeys.add("VOICE_PROVIDER_CHAIN");
  }

  for (const key of Object.keys(providerModels)) {
    const providerName = normalizeAIProviderName(key);
    if (providerName) providersToUpdate.add(providerName);
  }

  for (const providerName of providersToUpdate) {
    const meta = AI_PROVIDER_CATALOG[providerName];
    const input = providerModels[providerName];
    const modelState = await getProviderModelState(providerName);

    if (meta.textModelEnvKey) {
      const textModel =
        nonEmpty(input?.textModel) ??
        nonEmpty(meta.defaultTextModel) ??
        nonEmpty(modelState.textModel);
      if (textModel) {
        await setSystemConfig(meta.textModelEnvKey, textModel);
        if (cfg) await upsertManagedProjectEnv(cfg, meta.textModelEnvKey, textModel);
        updatedKeys.add(meta.textModelEnvKey);
      }
    }

    if (meta.imageModelEnvKey) {
      const imageModel =
        nonEmpty(input?.imageModel) ??
        nonEmpty(meta.defaultImageModel) ??
        nonEmpty(modelState.imageModel);
      if (imageModel) {
        await setSystemConfig(meta.imageModelEnvKey, imageModel);
        if (cfg) await upsertManagedProjectEnv(cfg, meta.imageModelEnvKey, imageModel);
        updatedKeys.add(meta.imageModelEnvKey);
      }
    }
  }

  let deployTriggered = false;
  if (cfg && parsed.data.triggerDeploy !== false) {
    const deploy = await triggerManagedProjectDeploy(cfg);
    deployTriggered = deploy.triggered;
  }

  return NextResponse.json({
    ok: true,
    provider,
    deployTriggered,
    updatedKeys: Array.from(updatedKeys).sort(),
    notice: cfg ? "Synced with Vercel and Database." : "Updated Database configuration.",
  });
}
