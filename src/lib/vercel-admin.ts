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

/**
 * Trigger a fresh production deploy.
 *
 * Two paths, tried in order:
 *
 *  1. **Vercel REST API** (`POST /v13/deployments`) using the management
 *     token. This always creates a NEW deployment (we pass the latest
 *     production deployment id as `deploymentId` so the build re-uses the
 *     same Git commit + source files but starts a fresh build). Returns the
 *     new deployment URL so the admin UI can link to it.
 *
 *  2. **Deploy hook** (fire-and-forget HTTP POST). Older fallback. The hook
 *     URL is project-scoped and unauthenticated, so it works without the
 *     management token, but Vercel deduplicates hook calls if a build is
 *     already in flight — which is exactly why we hit "Apply succeeded but
 *     no new deploy appeared" three times in a row before adding the REST
 *     path. Kept as a last resort.
 *
 * Either path returns `triggered: true` once the request is accepted. The
 * REST path also returns `deploymentUrl` so the UI can deep-link.
 */
type LatestDeploymentRow = {
  uid: string;
  url?: string;
  state?: string;
  target?: string | null;
};

async function fetchLatestProductionDeploymentId(
  cfg: VercelProjectConfig,
): Promise<string | null> {
  try {
    const body = await vercelRequest<{ deployments?: LatestDeploymentRow[] }>(
      cfg,
      `/v6/deployments?projectId=${encodeURIComponent(cfg.project)}&target=production&state=READY&limit=1`,
    );
    return body.deployments?.[0]?.uid ?? null;
  } catch {
    return null;
  }
}

export async function triggerManagedProjectDeploy(
  cfg: VercelProjectConfig,
): Promise<{ triggered: boolean; deploymentUrl?: string; via: "api" | "hook" | "none" }> {
  // ---- Path 1: REST API (preferred — always creates a new build) ----------
  try {
    const previousId = await fetchLatestProductionDeploymentId(cfg);
    if (previousId) {
      const created = await vercelRequest<{
        id?: string;
        url?: string;
      }>(cfg, "/v13/deployments?forceNew=1", {
        method: "POST",
        body: JSON.stringify({
          name: cfg.project,
          deploymentId: previousId,
          target: "production",
        }),
      });
      return {
        triggered: true,
        deploymentUrl: created.url ? `https://${created.url}` : undefined,
        via: "api",
      };
    }
  } catch (err) {
    // Don't block on the API path — fall through to the hook if configured.
    console.warn(
      "[vercel-admin] REST deploy failed, falling back to deploy hook:",
      err instanceof Error ? err.message : err,
    );
  }

  // ---- Path 2: deploy hook (fallback) -------------------------------------
  if (cfg.deployHookUrl) {
    const res = await fetch(cfg.deployHookUrl, { method: "POST" });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Deploy hook ${res.status}: ${body.slice(0, 300)}`);
    }
    return { triggered: true, via: "hook" };
  }

  return { triggered: false, via: "none" };
}
