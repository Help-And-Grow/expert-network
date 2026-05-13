import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { isErrorResponse, requireAdmin } from "@/lib/admin-auth";
import {
  getCloudRegionSettings,
  type ResolvedCloudRegionSetting,
} from "@/lib/admin/cloud-regions";
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
import {
  seedProviderRegistryIfEmpty,
  seedRoutingScopesIfEmpty,
} from "@/lib/admin/provider-registry-seed";
import {
  deleteRouteOverride,
  listRouteOverrides,
  listRoutingScopes,
  upsertRouteOverride,
  upsertRoutingScope,
  type RouteOverrideRow,
  type RoutingScopeRow,
} from "@/lib/ai/routing";
import { prisma } from "@/lib/prisma";
import { getActiveStorageProviderName } from "@/lib/storage";
import { resolveEnvironment, setSystemConfig } from "@/lib/system-config";
import {
  getManagedVercelProjectConfig,
  listManagedProjectEnvs,
  triggerManagedProjectDeploy,
  upsertManagedProjectEnv,
} from "@/lib/vercel-admin";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Phase 2 unified admin Providers API.
 *
 * Phase 1 wrote registry rows + SystemConfig keys sequentially with no
 * isolation; if the Vercel-env push 500'd halfway through, the DB ended
 * up partially updated. Phase 2 wraps every DB write in a single
 * `$transaction` and only calls Vercel AFTER the commit. If the Vercel
 * call fails we still return 200 — the DB is consistent — and surface
 * `deployTriggered: false` plus a hint so the operator can retry via
 * POST /api/admin/providers/retry-deploy.
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

const matchRulesSchema = z
  .object({
    isWeChat: z.boolean().optional(),
    region: z.enum(["intl", "cn"]).optional(),
    userAgent: z.string().optional(),
    header: z.record(z.string(), z.string()).optional(),
  })
  .strict()
  .partial();

const scopeUpsertSchema = z.object({
  scopeKey: z.string().min(1),
  displayName: z.string().min(1),
  description: z.string().nullable().optional(),
  category: z.enum(["llm", "image", "voice", "storage"]),
  chain: z.array(z.string()),
  enabled: z.boolean().optional(),
  matchRules: matchRulesSchema,
  priority: z.number().int().optional(),
});

const overrideUpsertSchema = z.object({
  routePattern: z.string().min(1),
  category: z.enum(["llm", "image", "voice", "storage"]),
  chainOverride: z.array(z.string()),
  enabled: z.boolean().optional(),
  reason: z.string().nullable().optional(),
});

const overrideDeleteSchema = z.object({
  routePattern: z.string().min(1),
  category: z.enum(["llm", "image", "voice", "storage"]),
});

const systemConfigUpsertSchema = z.object({
  key: z
    .string()
    .min(1)
    .max(120)
    .regex(/^[A-Z0-9_]+$/, "key must be UPPER_SNAKE_CASE"),
  value: z.string().max(4000),
});

const bodySchema = z.object({
  activeLlm: z.string().optional(),
  llmTextChain: z.union([z.string(), z.array(z.string())]).optional(),
  llmImageChain: z.union([z.string(), z.array(z.string())]).optional(),
  llmVoiceChain: z.union([z.string(), z.array(z.string())]).optional(),
  activeStorage: z.enum(["vercel", "gcs", "tencent-cos", "db"]).optional(),
  providerUpserts: z.array(upsertSchema).optional(),
  routingScopeUpserts: z.array(scopeUpsertSchema).optional(),
  routeOverrideUpserts: z.array(overrideUpsertSchema).optional(),
  routeOverrideDeletes: z.array(overrideDeleteSchema).optional(),
  systemConfigUpserts: z.array(systemConfigUpsertSchema).optional(),
  triggerDeploy: z.boolean().optional(),
  /** Optional: target a specific environment. Defaults to VERCEL_ENV. */
  environment: z.enum(["production", "preview", "development"]).optional(),
  /** Optional admin note recorded in every audit row written by this apply. */
  reason: z.string().max(500).optional(),
});

function chainToString(input: string | string[] | undefined): string | null {
  if (input === undefined) return null;
  const arr = chainToArray(input);
  return arr.join(",");
}

function chainToArray(input: string | string[]): string[] {
  const arr = Array.isArray(input) ? input : input.split(",");
  return arr.map((t) => t.trim().toLowerCase()).filter((t) => t.length > 0);
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

/**
 * Lazy auto-seed flag.
 *
 * The Phase 1 ProviderRegistry seed was authored as a one-shot script (not
 * wired to Vercel postinstall). Production ended up with an empty registry,
 * which made the active-provider dropdown blank.
 *
 * To self-heal without operator intervention, the first admin visit triggers
 * an idempotent seed (existing rows are preserved). The flag prevents repeat
 * work on every request — re-seed requires a process restart (Vercel cold
 * start) or a redeploy.
 */
let providerSeedAttempted = false;

async function ensureProviderSeed(): Promise<void> {
  if (providerSeedAttempted) return;
  providerSeedAttempted = true;
  try {
    const reg = await seedProviderRegistryIfEmpty();
    if (reg.inserted > 0 || reg.refreshed > 0) {
      console.info(
        `[admin/providers] auto-seeded registry: ${reg.inserted} inserted, ${reg.skipped} skipped, ${reg.refreshed} refreshed`,
      );
    }
    const scopes = await seedRoutingScopesIfEmpty();
    if (scopes.inserted > 0) {
      console.info(
        `[admin/providers] auto-seeded routing scopes: ${scopes.inserted} inserted, ${scopes.skipped} skipped`,
      );
    }
  } catch (err) {
    // Don't fail the admin GET — log and let the empty-state UI guide them.
    console.error("[admin/providers] auto-seed failed:", err);
  }
}

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (isErrorResponse(auth)) return auth;

  await ensureProviderSeed();

  const envParam = request.nextUrl.searchParams.get("environment");
  const env = resolveEnvironment(envParam);

  const cfg = getManagedVercelProjectConfig();
  const [
    llmRows,
    storageRows,
    activeLlm,
    activeStorage,
    imageChain,
    voiceChain,
    llmScopes,
    imageScopes,
    voiceScopes,
    storageScopes,
    llmOverrides,
    imageOverrides,
    voiceOverrides,
    storageOverrides,
    cloudRegions,
    driftCount,
  ] = await Promise.all([
    listProviders("llm"),
    listProviders("storage"),
    getActiveAIProviderName(),
    getActiveStorageProviderName(),
    getActiveImageProviderChain(),
    getActiveVoiceProviderChain(),
    listRoutingScopes("llm", env),
    listRoutingScopes("image", env),
    listRoutingScopes("voice", env),
    listRoutingScopes("storage", env),
    listRouteOverrides("llm", env),
    listRouteOverrides("image", env),
    listRouteOverrides("voice", env),
    listRouteOverrides("storage", env),
    getCloudRegionSettings(env),
    prisma.providerConfigDrift
      .count({ where: { resolved: false, environment: env } })
      .catch(() => 0),
  ]);
  // Type guard for the cloud regions tuple position.
  const cloudRegionsTyped: ResolvedCloudRegionSetting[] = cloudRegions;

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

  const voiceProviderRows = llmRows.filter((row) => {
    const caps = (row.metadata?.capabilities ?? []) as unknown[];
    return Array.isArray(caps) && caps.includes("voice");
  });
  const voiceOptionsFromRegistry = voiceProviderRows.map((r) => r.key);
  const voiceOptions =
    voiceOptionsFromRegistry.length > 0
      ? voiceOptionsFromRegistry
      : [...ALL_VOICE_PROVIDERS];

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
    routing: {
      scopes: {
        llm: llmScopes,
        image: imageScopes,
        voice: voiceScopes,
        storage: storageScopes,
      },
      overrides: {
        llm: llmOverrides,
        image: imageOverrides,
        voice: voiceOverrides,
        storage: storageOverrides,
      },
    },
    defaults: {
      llmImageChain: [...IMAGE_FALLBACK_ORDER],
      llmVoiceChain: [...VOICE_FALLBACK_ORDER],
      voiceOptions,
    },
    cloudRegions: cloudRegionsTyped,
    driftCount,
    providerHealth,
    canManage: Boolean(cfg),
    deployHookConfigured: Boolean(cfg?.deployHookUrl),
    environment: env,
    currentVercelEnv: process.env.VERCEL_ENV ?? null,
  });
}

type SystemConfigWrite = {
  key: string;
  value: string;
  vercelKey?: string; // Vercel env key (usually equal to `key`)
};

export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (isErrorResponse(auth)) return auth;

  // Resolve the actor's email for the audit log.
  const actor = await prisma.user.findUnique({
    where: { id: auth.userId },
    select: { email: true },
  });
  const actorEmail = actor?.email ?? null;

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid JSON body", issues: parsed.error.format() },
      { status: 400 },
    );
  }

  const env = resolveEnvironment(parsed.data.environment);
  const reason = parsed.data.reason ?? null;
  const cfg = getManagedVercelProjectConfig();

  // Gather every SystemConfig write to apply atomically.
  const writes: SystemConfigWrite[] = [];
  if (parsed.data.activeLlm) {
    writes.push({ key: "AI_PROVIDER", value: parsed.data.activeLlm });
  }
  const textChain = chainToString(parsed.data.llmTextChain);
  if (textChain !== null) {
    writes.push({ key: "AI_TEXT_PROVIDER_CHAIN", value: textChain });
  }
  const imgChain = chainToString(parsed.data.llmImageChain);
  if (imgChain !== null) {
    writes.push({ key: "IMAGE_PROVIDER_CHAIN", value: imgChain });
  }
  const voiceChain = chainToString(parsed.data.llmVoiceChain);
  if (voiceChain !== null) {
    writes.push({ key: "VOICE_PROVIDER_CHAIN", value: voiceChain });
  }
  if (parsed.data.activeStorage) {
    writes.push({ key: "STORAGE_PROVIDER", value: parsed.data.activeStorage });
  }
  for (const item of parsed.data.systemConfigUpserts ?? []) {
    writes.push({ key: item.key, value: item.value });
  }

  // -------------------------------------------------------------------------
  // 1. Atomic DB phase: registry upserts + SystemConfig writes + audit rows.
  //    If anything throws, the transaction rolls back and no rows changed.
  // -------------------------------------------------------------------------
  let upserted: ProviderRegistryRow[] = [];
  let scopeUpserts: RoutingScopeRow[] = [];
  let overrideUpserts: RouteOverrideRow[] = [];
  const updatedKeys: string[] = [];
  try {
    const txResult = await prisma.$transaction(async (tx) => {
      const upsertedRows: ProviderRegistryRow[] = [];
      for (const item of parsed.data.providerUpserts ?? []) {
        const row = await upsertProvider(item, {
          tx,
          actorEmail,
          actorRole: "ADMIN",
          reason,
        });
        upsertedRows.push(row);
      }

      const scopeRows: RoutingScopeRow[] = [];
      for (const s of parsed.data.routingScopeUpserts ?? []) {
        const row = await upsertRoutingScope(
          { ...s, environment: env },
          { tx, actorEmail, actorRole: "ADMIN", reason },
        );
        scopeRows.push(row);
      }

      // ── Sync the legacy "Image chain" / "Voice chain" / text-chain widgets
      // at the top of the LLM tab into the `web-default` routing scope.
      // Without this, removing a provider from those widgets only updates the
      // legacy SystemConfig fallback while the routing scope (which has
      // higher precedence and is what GET returns) retains the old value, so
      // the removed item re-appears after page reload.
      //
      // The widget edits the catch-all (web-default) scope per category.
      // Non-catch-all scopes (wechat-intl, wechat-cn) are unchanged by these
      // top-level widgets and remain editable through the Routing Scopes
      // section below.
      const chainSyncs: Array<{
        category: "llm" | "image" | "voice";
        chain: string[];
      }> = [];
      if (parsed.data.llmTextChain !== undefined) {
        chainSyncs.push({
          category: "llm",
          chain: chainToArray(parsed.data.llmTextChain),
        });
      }
      if (parsed.data.llmImageChain !== undefined) {
        chainSyncs.push({
          category: "image",
          chain: chainToArray(parsed.data.llmImageChain),
        });
      }
      if (parsed.data.llmVoiceChain !== undefined) {
        chainSyncs.push({
          category: "voice",
          chain: chainToArray(parsed.data.llmVoiceChain),
        });
      }
      for (const sync of chainSyncs) {
        // Look up the existing web-default row in this category/env so we
        // preserve displayName / description / matchRules / priority / enabled.
        const existing = await tx.providerRoutingScope.findUnique({
          where: {
            scopeKey_category_environment: {
              scopeKey: "web-default",
              category: sync.category,
              environment: env,
            },
          },
        });
        const matchRules = existing
          ? (existing.matchRules as Record<string, unknown> | null) ?? {}
          : {};
        const row = await upsertRoutingScope(
          {
            scopeKey: "web-default",
            displayName:
              existing?.displayName ??
              (sync.category === "llm"
                ? "Web / Telegram default"
                : sync.category === "image"
                  ? "Web / Telegram image default"
                  : "Web / Telegram voice default"),
            description: existing?.description ?? "Catch-all for non-WeChat traffic.",
            category: sync.category,
            chain: sync.chain,
            enabled: existing?.enabled ?? true,
            matchRules,
            priority: existing?.priority ?? 200,
            environment: env,
          },
          { tx, actorEmail, actorRole: "ADMIN", reason },
        );
        // Avoid double-counting when the same scope was also explicitly in
        // routingScopeUpserts (the client doesn't currently do that, but
        // defensive against future UI changes).
        if (!scopeRows.some((r) => r.id === row.id)) scopeRows.push(row);
      }

      const overrideRows: RouteOverrideRow[] = [];
      for (const o of parsed.data.routeOverrideUpserts ?? []) {
        const row = await upsertRouteOverride(
          { ...o, environment: env },
          { tx, actorEmail, actorRole: "ADMIN", reason },
        );
        overrideRows.push(row);
      }
      for (const d of parsed.data.routeOverrideDeletes ?? []) {
        await deleteRouteOverride(d.routePattern, d.category, env, {
          tx,
          actorEmail,
          actorRole: "ADMIN",
          reason,
        });
      }

      const written: string[] = [];
      for (const w of writes) {
        await setSystemConfig(w.key, w.value, env, {
          tx,
          actorEmail,
          actorRole: "ADMIN",
          reason,
          category: storageOrLlmCategory(w.key),
        });
        written.push(w.key);
      }

      return { upsertedRows, written, scopeRows, overrideRows };
    });
    upserted = txResult.upsertedRows;
    scopeUpserts = txResult.scopeRows;
    overrideUpserts = txResult.overrideRows;
    updatedKeys.push(...txResult.written);
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: "DB write failed; no changes applied",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }

  // -------------------------------------------------------------------------
  // 2. Vercel sync phase (best-effort, post-commit). A failure here does NOT
  //    roll back the DB — we report it back so the admin can retry.
  // -------------------------------------------------------------------------
  let deployTriggered = false;
  let deployError: string | null = null;
  if (cfg) {
    try {
      for (const w of writes) {
        await upsertManagedProjectEnv(cfg, w.vercelKey ?? w.key, w.value);
      }
      if (parsed.data.triggerDeploy !== false && updatedKeys.length > 0) {
        const deploy = await triggerManagedProjectDeploy(cfg);
        deployTriggered = deploy.triggered;
      }
    } catch (err) {
      deployError = err instanceof Error ? err.message : String(err);
    }
  }

  return NextResponse.json({
    ok: true,
    updatedKeys: Array.from(new Set(updatedKeys)).sort(),
    upserted: upserted.map((r) => ({ category: r.category, key: r.key })),
    routingScopeUpserts: scopeUpserts.map((s) => ({
      category: s.category,
      scopeKey: s.scopeKey,
    })),
    routeOverrideUpserts: overrideUpserts.map((o) => ({
      category: o.category,
      routePattern: o.routePattern,
    })),
    deployTriggered,
    deployError,
    environment: env,
  });
}

function storageOrLlmCategory(key: string): string {
  if (key === "STORAGE_PROVIDER") return "storage";
  if (
    key === "AI_PROVIDER" ||
    key === "AI_TEXT_PROVIDER_CHAIN" ||
    key === "IMAGE_PROVIDER_CHAIN" ||
    key === "VOICE_PROVIDER_CHAIN"
  ) {
    return "llm";
  }
  if (
    key === "GOOGLE_CLOUD_PROJECT" ||
    key === "GOOGLE_CLOUD_LOCATION" ||
    key === "GEMINI_IMAGE_VERTEX_LOCATION" ||
    key === "ZAI_VERTEX_LOCATION" ||
    key === "GCS_BUCKET_NAME" ||
    key === "TENCENT_COS_REGION" ||
    key === "TENCENT_COS_BUCKET"
  ) {
    return "cloud-region";
  }
  return "system-config";
}
