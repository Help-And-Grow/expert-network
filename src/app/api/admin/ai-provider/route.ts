import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { isErrorResponse, requireAdmin } from "@/lib/admin-auth";
import {
  AI_PROVIDER_CATALOG,
  ALL_AI_PROVIDERS,
  computeProviderHealth,
  getActiveAIProviderName,
  getProviderModelState,
  IMAGE_FALLBACK_ORDER,
  normalizeAIProviderName,
  type AIProviderName,
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
});

function providerDescriptor(provider: AIProviderName) {
  const meta = AI_PROVIDER_CATALOG[provider];
  const modelState = getProviderModelState(provider);
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
  if (!cfg) {
    return NextResponse.json({
      currentProvider: getActiveAIProviderName(),
      canManage: false,
      providers: ALL_AI_PROVIDERS.map(providerDescriptor),
      imageFallbackOrder: [...IMAGE_FALLBACK_ORDER],
      error:
        "Set VERCEL_MANAGEMENT_TOKEN, VERCEL_MANAGED_TEAM_ID, and VERCEL_MANAGED_PROJECT to manage AI provider settings from this admin page.",
    });
  }

  const envVars = await listManagedProjectEnvs(cfg);
  const productionKeys = new Set(
    envVars
      .filter((item) => item.target?.includes("production"))
      .map((item) => item.key),
  );

  return NextResponse.json({
    canManage: true,
    currentProvider: getActiveAIProviderName(),
    managedProject: cfg.project,
    managedTeamId: cfg.teamId,
    deployHookConfigured: Boolean(cfg.deployHookUrl),
    providerHealth: computeProviderHealth(productionKeys),
    providers: ALL_AI_PROVIDERS.map(providerDescriptor),
    imageFallbackOrder: [...IMAGE_FALLBACK_ORDER],
  });
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (isErrorResponse(auth)) return auth;

  const cfg = getManagedVercelProjectConfig();
  if (!cfg) {
    return NextResponse.json(
      {
        error:
          "Provider management is not configured. Set VERCEL_MANAGEMENT_TOKEN, VERCEL_MANAGED_TEAM_ID, and VERCEL_MANAGED_PROJECT.",
      },
      { status: 503 },
    );
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const provider =
    normalizeAIProviderName(parsed.data.provider) ?? getActiveAIProviderName();
  const providerModels = parsed.data.providerModels ?? {};
  const updatedKeys = new Set<string>(["AI_PROVIDER"]);
  const providersToUpdate = new Set<AIProviderName>([provider]);

  await upsertManagedProjectEnv(cfg, "AI_PROVIDER", provider);

  for (const key of Object.keys(providerModels)) {
    const providerName = normalizeAIProviderName(key);
    if (providerName) providersToUpdate.add(providerName);
  }

  for (const providerName of providersToUpdate) {
    const meta = AI_PROVIDER_CATALOG[providerName];
    const input = providerModels[providerName];

    if (meta.textModelEnvKey) {
      const textModel =
        nonEmpty(input?.textModel) ??
        nonEmpty(meta.defaultTextModel) ??
        nonEmpty(getProviderModelState(providerName).textModel);
      if (textModel) {
        await upsertManagedProjectEnv(cfg, meta.textModelEnvKey, textModel);
        updatedKeys.add(meta.textModelEnvKey);
      }
    }

    if (meta.imageModelEnvKey) {
      const imageModel =
        nonEmpty(input?.imageModel) ??
        nonEmpty(meta.defaultImageModel) ??
        nonEmpty(getProviderModelState(providerName).imageModel);
      if (imageModel) {
        await upsertManagedProjectEnv(cfg, meta.imageModelEnvKey, imageModel);
        updatedKeys.add(meta.imageModelEnvKey);
      }
    }
  }

  const deploy =
    parsed.data.triggerDeploy === false
      ? { triggered: false }
      : await triggerManagedProjectDeploy(cfg);

  return NextResponse.json({
    ok: true,
    provider,
    deployTriggered: deploy.triggered,
    updatedKeys: Array.from(updatedKeys).sort(),
  });
}
