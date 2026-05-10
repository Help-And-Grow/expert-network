import { readFileSync } from "fs";
import path from "path";

import { env } from "@/lib/env";

const TARGETS = ["production", "preview", "development"] as const;

type Target = (typeof TARGETS)[number];

export type ManagedEnvVar = {
  id: string;
  key: string;
  target?: string[];
  gitBranch?: string | null;
};

type VercelProjectConfig = {
  token: string;
  teamId: string;
  project: string;
  deployHookUrl?: string;
};

function readLocalVercelProjectJson():
  | { projectId?: string; orgId?: string }
  | null {
  try {
    const raw = readFileSync(
      path.join(process.cwd(), ".vercel", "project.json"),
      "utf-8",
    );
    return JSON.parse(raw) as { projectId?: string; orgId?: string };
  } catch {
    return null;
  }
}

function deriveProjectName(): string | undefined {
  const productionUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (productionUrl?.endsWith(".vercel.app")) {
    return productionUrl.replace(/\.vercel\.app$/, "");
  }
  return undefined;
}

export function getManagedVercelProjectConfig(): VercelProjectConfig | null {
  const local = readLocalVercelProjectJson();
  const token = env.VERCEL_MANAGEMENT_TOKEN?.trim();
  const teamId =
    env.VERCEL_MANAGED_TEAM_ID?.trim() ||
    process.env.VERCEL_ORG_ID ||
    local?.orgId ||
    "";
  const project =
    env.VERCEL_MANAGED_PROJECT?.trim() ||
    process.env.VERCEL_PROJECT_ID ||
    local?.projectId ||
    deriveProjectName() ||
    "";

  if (!token || !teamId || !project) return null;
  return {
    token,
    teamId,
    project,
    deployHookUrl: env.VERCEL_DEPLOY_HOOK_URL?.trim(),
  };
}

async function vercelRequest<T>(
  cfg: VercelProjectConfig,
  pathname: string,
  init?: RequestInit,
): Promise<T> {
  const url = new URL(`https://api.vercel.com${pathname}`);
  url.searchParams.set("teamId", cfg.teamId);

  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Vercel API ${res.status}: ${body.slice(0, 400)}`);
  }

  if (res.status === 204) return null as T;
  return (await res.json()) as T;
}

export async function listManagedProjectEnvs(
  cfg: VercelProjectConfig,
): Promise<ManagedEnvVar[]> {
  // Vercel's /v10/projects/:id/env returns `{ envs, pagination }`, NOT a bare
  // array. Older callers only used this for side-effect upserts so the wrong
  // typing never surfaced; the Phase-4 drift detector iterates the list and
  // breaks without this unwrap.
  const body = await vercelRequest<
    ManagedEnvVar[] | { envs?: ManagedEnvVar[] }
  >(cfg, `/v10/projects/${encodeURIComponent(cfg.project)}/env`);
  if (Array.isArray(body)) return body;
  return body.envs ?? [];
}

export async function upsertManagedProjectEnv(
  cfg: VercelProjectConfig,
  key: string,
  value: string,
  targets: readonly Target[] = TARGETS,
): Promise<void> {
  await vercelRequest(
    cfg,
    `/v10/projects/${encodeURIComponent(cfg.project)}/env?upsert=true`,
    {
      method: "POST",
      body: JSON.stringify({
        key,
        value,
        type: "plain",
        target: [...targets],
        comment: "Managed from /admin/ai-provider",
      }),
    },
  );
}

export async function triggerManagedProjectDeploy(
  cfg: VercelProjectConfig,
): Promise<{ triggered: boolean }> {
  if (!cfg.deployHookUrl) return { triggered: false };

  const res = await fetch(cfg.deployHookUrl, { method: "POST" });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Deploy hook ${res.status}: ${body.slice(0, 300)}`);
  }
  return { triggered: true };
}
