import { type NextRequest, NextResponse } from "next/server";

import { isErrorResponse, requireAdmin } from "@/lib/admin-auth";
import { env } from "@/lib/env";
import {
  getManagedVercelProjectConfig,
  listManagedProjectEnvs,
  triggerManagedProjectDeploy,
  upsertManagedProjectEnv,
} from "@/lib/vercel-admin";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const PROVIDERS = ["qwen", "gemini", "openai", "zai", "dedalus"] as const;
type ProviderName = (typeof PROVIDERS)[number];

type ProviderRequirement = {
  requiredAny: string[][];
  optional: string[];
};

const PROVIDER_REQUIREMENTS: Record<ProviderName, ProviderRequirement> = {
  qwen: {
    requiredAny: [["DASHSCOPE_API_KEY"]],
    optional: ["VOICE_CHAT_DEFAULT_VOICE"],
  },
  gemini: {
    requiredAny: [["GEMINI_API_KEY"], ["GOOGLE_CLOUD_PROJECT", "GOOGLE_SERVICE_ACCOUNT_KEY"]],
    optional: ["GOOGLE_CLOUD_LOCATION", "GEMINI_TEXT_MODEL", "GEMINI_IMAGE_MODEL"],
  },
  openai: {
    requiredAny: [["OPENAI_API_KEY"]],
    optional: [],
  },
  zai: {
    requiredAny: [["ZAI_API_KEY"], ["GOOGLE_CLOUD_PROJECT", "GOOGLE_SERVICE_ACCOUNT_KEY"]],
    optional: ["ZAI_BASE_URL", "ZAI_TEXT_MODEL", "ZAI_IMAGE_MODEL", "ZAI_VERTEX_LOCATION"],
  },
  dedalus: {
    requiredAny: [["DEDALUS_API_KEY"]],
    optional: ["DEDALUS_MODEL", "DEDALUS_MATCH_MODEL"],
  },
};

function computeProviderHealth(keys: Set<string>) {
  return Object.fromEntries(
    Object.entries(PROVIDER_REQUIREMENTS).map(([provider, requirement]) => {
      const configured = requirement.requiredAny.some((group) =>
        group.every((key) => keys.has(key)),
      );
      return [
        provider,
        {
          configured,
          requiredAny: requirement.requiredAny,
          optional: requirement.optional,
        },
      ];
    }),
  );
}

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (isErrorResponse(auth)) return auth;

  const cfg = getManagedVercelProjectConfig();
  if (!cfg) {
    return NextResponse.json({
      currentProvider: env.AI_PROVIDER,
      canManage: false,
      error:
        "Set VERCEL_MANAGEMENT_TOKEN, VERCEL_MANAGED_TEAM_ID, and VERCEL_MANAGED_PROJECT to manage provider switching from this admin page.",
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
    currentProvider: env.AI_PROVIDER,
    managedProject: cfg.project,
    managedTeamId: cfg.teamId,
    deployHookConfigured: Boolean(cfg.deployHookUrl),
    providerHealth: computeProviderHealth(productionKeys),
    productionKeys: Array.from(productionKeys).sort(),
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

  let body: { provider?: ProviderName; triggerDeploy?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const provider = body.provider;
  if (!provider || !PROVIDERS.includes(provider)) {
    return NextResponse.json(
      { error: `provider must be one of: ${PROVIDERS.join(", ")}` },
      { status: 400 },
    );
  }

  await upsertManagedProjectEnv(cfg, "AI_PROVIDER", provider);
  const deploy = body.triggerDeploy === false ? { triggered: false } : await triggerManagedProjectDeploy(cfg);

  return NextResponse.json({
    ok: true,
    provider,
    deployTriggered: deploy.triggered,
  });
}
